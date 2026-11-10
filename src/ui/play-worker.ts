// 統合モード(100年のA0/A1再計算)を実行するWeb Worker。UIのメインスレッドを塞がない。
// 計算本体は runPlayComparison(UIアダプタ)そのもの。ここでは実行時間の計測と転送ビューへの縮約だけを行う。
import { runPlayComparison } from './branch-play-source.ts'
import type { PlayInput, PlayView } from './branch-play-source.ts'
import { toDisplayView } from './play-view.ts'
import type { PlayProgress } from './play-progress.ts'

export type WorkerRequest=Readonly<{input:PlayInput}>
export type WorkerResponse=
  | Readonly<{kind:'PROGRESS';progress:PlayProgress}>
  | Readonly<{ok:true;view:PlayView;computeMs:number;viewMs:number}>
  | Readonly<{ok:false;code:string;message:string;computeMs:number}>

const ctx=self as unknown as {
  onmessage:((e:MessageEvent<WorkerRequest>)=>void)|null
  postMessage:(m:WorkerResponse)=>void
}
ctx.onmessage=e=>{
  const t0=performance.now()
  let response:WorkerResponse
  try{
    // 進捗は小さなDTOだけを送る。WorldState・ログは最終結果まで送らない。
    const r=runPlayComparison(e.data.input,progress=>ctx.postMessage({kind:'PROGRESS',progress}))
    const computeMs=performance.now()-t0
    if(!r.ok)response={ok:false,code:r.code,message:r.message,computeMs}
    else{
      const t1=performance.now()
      const view=toDisplayView(r.comparison)
      response={ok:true,view,computeMs,viewMs:performance.now()-t1}
    }
  }catch(error){
    response={ok:false,code:'WORKER_EXCEPTION',message:error instanceof Error?error.message:String(error),computeMs:performance.now()-t0}
  }
  ctx.postMessage(response)
}
