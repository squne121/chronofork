// 再計算の実行方式。重い統合モードはWeb Workerで実行し、キャンセル(terminate)・失敗を区別して返す。
import { runPlayComparison } from './branch-play-source.ts'
import type { PlayInput, PlayResult, PlayView } from './branch-play-source.ts'
import type { WorkerResponse } from './play-worker.ts'

export type PlayOutcome=
  | Readonly<{kind:'DONE';result:Readonly<{ok:true;view:PlayView}>|Extract<PlayResult,{ok:false}>;computeMs:number}>
  | Readonly<{kind:'CANCELLED'}>
  | Readonly<{kind:'FAILED';code:string;message:string}>
export type PlayRunHandle=Readonly<{promise:Promise<PlayOutcome>;cancel:()=>void}>
export type PlayRunner=(input:PlayInput)=>PlayRunHandle

/** 実ブラウザ用。実行ごとに新しいWorkerを作り、完了・失敗・キャンセルで必ず終了する。 */
export const workerPlayRunner:PlayRunner=input=>{
  let worker:Worker|undefined
  let settle:(o:PlayOutcome)=>void=()=>{}
  const promise=new Promise<PlayOutcome>(resolve=>{
    let done=false
    settle=o=>{if(done)return;done=true;worker?.terminate();resolve(o)}
    if(typeof Worker==='undefined'){settle({kind:'FAILED',code:'WORKER_UNAVAILABLE',message:'このブラウザではWeb Workerを利用できません'});return}
    try{
      worker=new Worker(new URL('./play-worker.ts',import.meta.url),{type:'module'})
    }catch(error){
      settle({kind:'FAILED',code:'WORKER_START_FAILED',message:error instanceof Error?error.message:String(error)});return
    }
    worker.onmessage=(e:MessageEvent<WorkerResponse>)=>{
      const m=e.data
      settle({kind:'DONE',computeMs:m.computeMs,
        result:m.ok?{ok:true,view:m.view}:{ok:false,code:m.code,message:m.message}})
    }
    worker.onerror=e=>settle({kind:'FAILED',code:'WORKER_ERROR',message:e.message||'Workerで未捕捉のエラーが発生しました'})
    worker.onmessageerror=()=>settle({kind:'FAILED',code:'WORKER_MESSAGE_ERROR',message:'計算結果をWorkerから受け取れませんでした'})
    worker.postMessage({input})
  })
  return {promise,cancel:()=>settle({kind:'CANCELLED'})}
}

/** テスト用。同期で完全な計算を行い、Workerと同じ形で返す(縮約はしない)。 */
export const inlinePlayRunner:PlayRunner=input=>{
  const t0=performance.now()
  const r=runPlayComparison(input)
  const outcome:PlayOutcome={kind:'DONE',computeMs:performance.now()-t0,
    result:r.ok?{ok:true,view:r.comparison}:r}
  return {promise:Promise.resolve(outcome),cancel:()=>{}}
}
