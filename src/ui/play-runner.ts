// 再計算の実行方式。重い統合モードはWeb Workerで実行し、キャンセル(terminate)・失敗を区別して返す。
import { runPlayComparison } from './branch-play-source.ts'
import type { PlayInput, PlayResult, PlayView } from './branch-play-source.ts'
import type { WorkerRequest, WorkerResponse } from './play-worker.ts'
import { runPlayCandidates } from './play-candidates.ts'
import type { PlayCandidateSet } from './play-candidates.ts'
import type { PlayMode } from './branch-play-source.ts'
import type { PlayProgress, ProgressObserver } from './play-progress.ts'

export type PlayOutcome=
  | Readonly<{kind:'DONE';result:Readonly<{ok:true;view:PlayView}>|Extract<PlayResult,{ok:false}>;computeMs:number}>
  | Readonly<{kind:'CANCELLED'}>
  | Readonly<{kind:'FAILED';code:string;message:string}>
export type PlayRunHandle=Readonly<{promise:Promise<PlayOutcome>;cancel:()=>void}>
/** onProgress は確定済みの年次進捗だけ。完了・失敗・キャンセル後は呼ばれない。 */
export type PlayRunner=(input:PlayInput,onProgress?:ProgressObserver)=>PlayRunHandle

/** 人物選択用のA0候補の取得結果。比較結果と混ざらないよう別の型にする。 */
export type CandidatesOutcome=
  | Readonly<{kind:'DONE';result:Readonly<{ok:true;set:PlayCandidateSet}>|Readonly<{ok:false;code:string;message:string}>;computeMs:number}>
  | Readonly<{kind:'CANCELLED'}>
  | Readonly<{kind:'FAILED';code:string;message:string}>
export type CandidatesRunHandle=Readonly<{promise:Promise<CandidatesOutcome>;cancel:()=>void}>
export type CandidatesRunner=(seed:number,mode:PlayMode)=>CandidatesRunHandle

/**
 * Workerを1回だけ使う共通部分。完了・失敗・キャンセルで必ずterminateする。
 * PROGRESSは観測専用で、完了として扱わず、Workerもterminateしない（完了・失敗・キャンセル後は転送もしない）。
 */
function spawn<T extends {kind:string}>(
  request:WorkerRequest,
  onDone:(m:Exclude<WorkerResponse,Readonly<{kind:'PROGRESS'}>>)=>T,
  failed:(code:string,message:string)=>T,
  cancelled:T,
  onProgress?:(p:PlayProgress)=>void,
):Readonly<{promise:Promise<T>;cancel:()=>void}>{
  let worker:Worker|undefined
  let done=false
  let settle:(o:T)=>void=()=>{}
  const promise=new Promise<T>(resolve=>{
    settle=o=>{if(done)return;done=true;worker?.terminate();resolve(o)}
    if(typeof Worker==='undefined'){settle(failed('WORKER_UNAVAILABLE','このブラウザではWeb Workerを利用できません'));return}
    try{
      worker=new Worker(new URL('./play-worker.ts',import.meta.url),{type:'module'})
    }catch(error){
      settle(failed('WORKER_START_FAILED',error instanceof Error?error.message:String(error)));return
    }
    worker.onmessage=(e:MessageEvent<WorkerResponse>)=>{
      const m=e.data
      if('kind' in m){if(!done)onProgress?.(m.progress);return}
      settle(onDone(m))
    }
    worker.onerror=e=>settle(failed('WORKER_ERROR',e.message||'Workerで未捕捉のエラーが発生しました'))
    worker.onmessageerror=()=>settle(failed('WORKER_MESSAGE_ERROR','計算結果をWorkerから受け取れませんでした'))
    worker.postMessage(request)
  })
  return {promise,cancel:()=>settle(cancelled)}
}

/** 実ブラウザ用。実行ごとに新しいWorkerを作り、完了・失敗・キャンセルで必ず終了する。 */
export const workerPlayRunner:PlayRunner=(input,onProgress)=>spawn<PlayOutcome>({input},
  m=>'candidates' in m
    ?{kind:'FAILED',code:'WORKER_MESSAGE_ERROR',message:'想定外の応答です'}
    :{kind:'DONE',computeMs:m.computeMs,result:m.ok?{ok:true,view:m.view}:{ok:false,code:m.code,message:m.message}},
  (code,message)=>({kind:'FAILED',code,message}),{kind:'CANCELLED'},onProgress)

/** 実ブラウザ用。明示操作でA0を1回計算し、人物候補だけを受け取る（EventLog/DecisionTraceは転送しない）。 */
export const workerCandidatesRunner:CandidatesRunner=(seed,mode)=>spawn<CandidatesOutcome>({candidates:{seed,mode}},
  m=>m.ok&&'candidates' in m
    ?{kind:'DONE',computeMs:m.computeMs,result:{ok:true,set:m.candidates}}
    :!m.ok?{kind:'DONE',computeMs:m.computeMs,result:{ok:false,code:m.code,message:m.message}}
    :{kind:'FAILED',code:'WORKER_MESSAGE_ERROR',message:'想定外の応答です'},
  (code,message)=>({kind:'FAILED',code,message}),{kind:'CANCELLED'})

/** テスト用。同期で完全な計算を行い、Workerと同じ形で返す(縮約はしない)。 */
export const inlinePlayRunner:PlayRunner=(input,onProgress)=>{
  const t0=performance.now()
  const r=runPlayComparison(input,onProgress)
  const outcome:PlayOutcome={kind:'DONE',computeMs:performance.now()-t0,
    result:r.ok?{ok:true,view:r.comparison}:r}
  return {promise:Promise.resolve(outcome),cancel:()=>{}}
}

/** テスト用。同期でA0候補を計算し、Workerと同じ形で返す。 */
export const inlineCandidatesRunner:CandidatesRunner=(seed,mode)=>{
  const t0=performance.now()
  const r=runPlayCandidates(seed,mode)
  return {promise:Promise.resolve({kind:'DONE',computeMs:performance.now()-t0,result:r} as CandidatesOutcome),cancel:()=>{}}
}
