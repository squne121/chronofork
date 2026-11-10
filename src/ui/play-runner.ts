// 再計算の実行方式。重い統合モードはWeb Workerで実行し、キャンセル(terminate)・失敗を区別して返す。
// Workerは同一プレイ中の原史A0キャッシュの保持場所であり、寿命はこのモジュールが管理する。
import { runPlayComparison } from './branch-play-source.ts'
import type { PlayInput, PlayResult, PlayView } from './branch-play-source.ts'
import type { WorkerRequest, WorkerResponse } from './play-worker.ts'
import { runPlayCandidates } from './play-candidates.ts'
import type { PlayCandidateSet } from './play-candidates.ts'
import type { PlayMode } from './branch-play-source.ts'
import type { ProgressObserver } from './play-progress.ts'

export type PlayOutcome=
  | Readonly<{kind:'DONE';result:Readonly<{ok:true;view:PlayView}>|Readonly<{ok:true;secondView:PlayView}>|Extract<PlayResult,{ok:false}>;computeMs:number}>
  | Readonly<{kind:'CANCELLED'}>
  | Readonly<{kind:'FAILED';code:string;message:string}>
export type PlayRunHandle=Readonly<{promise:Promise<PlayOutcome>;cancel:()=>void}>
export type PlayRunHooks=Readonly<{
  /** A0を再計算せず保存済みを使うとき一度だけ。A0の進捗通知は出ない。 */
  onA0Reused?:()=>void
}>
/** onProgress は確定済みの年次進捗だけ。完了・失敗・キャンセル後は呼ばれない。 */
export type PlayRunner=((input:PlayInput,onProgress?:ProgressObserver,hooks?:PlayRunHooks)=>PlayRunHandle)&Readonly<{
  /** 保持しているA0とWorkerを破棄する(新規ゲーム・seed変更・タブ破棄)。実行中ならキャンセル扱い。 */
  reset?:()=>void
}>

/** 最後の実行から無操作でこの時間が過ぎたら、A0ごとWorkerを解放する(数GBの常駐を避ける)。 */
export const A0_IDLE_RELEASE_MS=10*60*1000

export type WorkerLike=Readonly<{
  postMessage:(m:unknown)=>void;terminate:()=>void
}>&{
  onmessage:((e:MessageEvent<WorkerResponse>)=>void)|null
  onerror:((e:{message?:string})=>void)|null
  onmessageerror:(()=>void)|null
}
type RunnerOptions=Readonly<{createWorker?:()=>WorkerLike;idleMs?:number}>
const realWorker=():WorkerLike=>new Worker(new URL('./play-worker.ts',import.meta.url),{type:'module'}) as unknown as WorkerLike

/**
 * Workerを複数回の実行で共有する。成功・計算上の失敗(HALTED等)では保持し、
 * キャンセル・Worker障害・reset・無操作タイムアウトでは必ずterminateしてA0を捨てる。
 */
export function createWorkerPlayRunner(options:RunnerOptions={}):PlayRunner{
  const create=options.createWorker??realWorker
  const idleMs=options.idleMs??A0_IDLE_RELEASE_MS
  let worker:WorkerLike|undefined
  let active:{settle:(o:PlayOutcome)=>void}|undefined
  let idleTimer:ReturnType<typeof setTimeout>|undefined
  const dropWorker=()=>{
    if(idleTimer!==undefined){clearTimeout(idleTimer);idleTimer=undefined}
    const w=worker;worker=undefined
    if(w){w.onmessage=null;w.onerror=null;w.onmessageerror=null;w.terminate()}
  }
  const armIdle=()=>{
    if(idleTimer!==undefined)clearTimeout(idleTimer)
    idleTimer=setTimeout(()=>{if(!active)dropWorker()},idleMs)
  }
  const run=(input:PlayInput,onProgress?:ProgressObserver,hooks?:PlayRunHooks):PlayRunHandle=>{
    let done=false
    let settle:(o:PlayOutcome)=>void=()=>{}
    const promise=new Promise<PlayOutcome>(resolve=>{
      settle=o=>{
        if(done)return;done=true
        if(active?.settle===settle)active=undefined
        // 完了と計算上の失敗(HALTED等)ではWorkerとA0を残す。キャンセル・障害は破棄する。
        if(o.kind==='DONE')armIdle();else dropWorker()
        resolve(o)
      }
      if(active){done=true;resolve({kind:'FAILED',code:'RUN_IN_PROGRESS',message:'別の再計算が実行中です'});return} // 実行中のWorkerには触れない
      active={settle}
      if(idleTimer!==undefined){clearTimeout(idleTimer);idleTimer=undefined}
      try{
        worker??=create()
      }catch(error){
        const unavailable=typeof Worker==='undefined'
        settle({kind:'FAILED',code:unavailable?'WORKER_UNAVAILABLE':'WORKER_START_FAILED',
          message:unavailable?'このブラウザではWeb Workerを利用できません':error instanceof Error?error.message:String(error)})
        return
      }
      const w=worker
      w.onmessage=(e:MessageEvent<WorkerResponse>)=>{
        const m=e.data
        if('kind' in m){
          if(done)return
          if(m.kind==='PROGRESS')onProgress?.(m.progress);else hooks?.onA0Reused?.()
          return
        }
        if(m.ok&&!('view' in m)&&!('secondView' in m)){settle({kind:'FAILED',code:'WORKER_MESSAGE_ERROR',message:'想定外の応答です'});return}
        settle({kind:'DONE',computeMs:m.computeMs,
          result:m.ok?'view' in m?{ok:true,view:m.view}:{ok:true,secondView:m.secondView}
            :{ok:false,code:m.code,message:m.message}})
      }
      w.onerror=e=>done?dropWorker():settle({kind:'FAILED',code:'WORKER_ERROR',message:e.message||'Workerで未捕捉のエラーが発生しました'})
      w.onmessageerror=()=>done?dropWorker():settle({kind:'FAILED',code:'WORKER_MESSAGE_ERROR',message:'計算結果をWorkerから受け取れませんでした'})
      w.postMessage({input})
    })
    return {promise,cancel:()=>settle({kind:'CANCELLED'})}
  }
  const runner:PlayRunner=Object.assign(run,{reset:()=>{
    const a=active
    if(a)a.settle({kind:'CANCELLED'}) // 内部でdropWorker
    dropWorker()
  }})
  return runner
}

/** 実ブラウザ用。タブ(ページ)内で1つのWorkerを共有し、同一プレイのA0を再利用する。 */
export const workerPlayRunner:PlayRunner=createWorkerPlayRunner()

/** テスト用。同期で完全な計算を行い、Workerと同じ形で返す(縮約はしない)。 */
export const inlinePlayRunner:PlayRunner=(input,onProgress)=>{
  const t0=performance.now()
  const r=runPlayComparison(input,onProgress)
  const outcome:PlayOutcome={kind:'DONE',computeMs:performance.now()-t0,
    result:r.ok?{ok:true,view:r.comparison}:r}
  return {promise:Promise.resolve(outcome),cancel:()=>{}}
}

/** 人物選択用のA0候補の取得結果。比較結果と混ざらないよう別の型にする。 */
export type CandidatesOutcome=
  | Readonly<{kind:'DONE';result:Readonly<{ok:true;set:PlayCandidateSet}>|Readonly<{ok:false;code:string;message:string}>;computeMs:number}>
  | Readonly<{kind:'CANCELLED'}>
  | Readonly<{kind:'FAILED';code:string;message:string}>
export type CandidatesRunHandle=Readonly<{promise:Promise<CandidatesOutcome>;cancel:()=>void}>
export type CandidatesRunner=(seed:number,mode:PlayMode)=>CandidatesRunHandle

/**
 * 実ブラウザ用。明示操作でA0を1回計算し、人物候補だけを受け取る(EventLog/DecisionTraceは転送しない)。
 * 使い捨てのWorkerで実行し、完了・失敗・キャンセルで必ずterminateする。比較用の共有Worker・A0キャッシュには触れない。
 */
export const workerCandidatesRunner:CandidatesRunner=(seed,mode)=>{
  let worker:Worker|undefined
  let done=false
  let settle:(o:CandidatesOutcome)=>void=()=>{}
  const fail=(code:string,message:string):CandidatesOutcome=>({kind:'FAILED',code,message})
  const promise=new Promise<CandidatesOutcome>(resolve=>{
    settle=o=>{if(done)return;done=true;worker?.terminate();resolve(o)}
    if(typeof Worker==='undefined'){settle(fail('WORKER_UNAVAILABLE','このブラウザではWeb Workerを利用できません'));return}
    try{
      worker=new Worker(new URL('./play-worker.ts',import.meta.url),{type:'module'})
    }catch(error){
      settle(fail('WORKER_START_FAILED',error instanceof Error?error.message:String(error)));return
    }
    worker.onmessage=(e:MessageEvent<WorkerResponse>)=>{
      const m=e.data
      if('kind' in m)return
      settle(m.ok&&'candidates' in m
        ?{kind:'DONE',computeMs:m.computeMs,result:{ok:true,set:m.candidates}}
        :!m.ok?{kind:'DONE',computeMs:m.computeMs,result:{ok:false,code:m.code,message:m.message}}
        :fail('WORKER_MESSAGE_ERROR','想定外の応答です'))
    }
    worker.onerror=e=>settle(fail('WORKER_ERROR',e.message||'Workerで未捕捉のエラーが発生しました'))
    worker.onmessageerror=()=>settle(fail('WORKER_MESSAGE_ERROR','計算結果をWorkerから受け取れませんでした'))
    const request:WorkerRequest={candidates:{seed,mode}}
    worker.postMessage(request)
  })
  return {promise,cancel:()=>settle({kind:'CANCELLED'})}
}

/** テスト用。同期でA0候補を計算し、Workerと同じ形で返す。 */
export const inlineCandidatesRunner:CandidatesRunner=(seed,mode)=>{
  const t0=performance.now()
  const r=runPlayCandidates(seed,mode)
  return {promise:Promise.resolve({kind:'DONE',computeMs:performance.now()-t0,result:r} as CandidatesOutcome),cancel:()=>{}}
}
