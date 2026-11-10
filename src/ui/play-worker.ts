// 統合モード(100年のA0/A1再計算)を実行するWeb Worker。UIのメインスレッドを塞がない。
// 計算本体は runPlayComparison(UIアダプタ)そのもの。ここでは実行時間の計測と転送ビューへの縮約だけを行う。
import { runPlayComparison } from './branch-play-source.ts'
import type { PlayInput, PlayView } from './branch-play-source.ts'
import { toDisplayView } from './play-view.ts'
import { runPlayCandidates } from './play-candidates.ts'
import type { PlayCandidateSet } from './play-candidates.ts'
import type { PlayMode } from './branch-play-source.ts'
import type { PlayProgress } from './play-progress.ts'
import { SingleA0Cache } from './a0-cache.ts'

/** 比較の再計算(input)か、人物選択用のA0候補の取得(candidates)。候補は必要な人物情報だけを返す。 */
export type WorkerRequest=Readonly<{input:PlayInput}>|Readonly<{candidates:Readonly<{seed:number;mode:PlayMode}>}>
export type WorkerResponse=
  | Readonly<{kind:'PROGRESS';progress:PlayProgress}>
  /** A0を再計算せず保存済みを使う。A0の年次進捗は送らない(再計算したように見せない)。 */
  | Readonly<{kind:'A0_REUSED'}>
  | Readonly<{ok:true;candidates:PlayCandidateSet;computeMs:number}>
  | Readonly<{ok:true;view:PlayView;computeMs:number;viewMs:number}>
  | Readonly<{ok:false;code:string;message:string;computeMs:number}>

const ctx=self as unknown as {
  onmessage:((e:MessageEvent<WorkerRequest>)=>void)|null
  postMessage:(m:WorkerResponse)=>void
}
/** このWorkerが生きている間だけ、同一世界線のA0を1件保持する。terminateで必ず破棄される。 */
const a0Cache=new SingleA0Cache()
ctx.onmessage=e=>{
  const t0=performance.now()
  let response:WorkerResponse
  try{
    if('candidates' in e.data){
      const c=runPlayCandidates(e.data.candidates.seed,e.data.candidates.mode)
      const computeMs=performance.now()-t0
      ctx.postMessage(c.ok?{ok:true,candidates:c.set,computeMs}:{ok:false,code:c.code,message:c.message,computeMs})
      return
    }
    // 進捗は小さなDTOだけを送る。WorldState・ログは最終結果まで送らない。
    const r=runPlayComparison(e.data.input,progress=>ctx.postMessage({kind:'PROGRESS',progress}),
      {cache:a0Cache,onA0Reused:()=>ctx.postMessage({kind:'A0_REUSED'})})
    const computeMs=performance.now()-t0
    if(!r.ok)response={ok:false,code:r.code,message:r.message,computeMs}
    else{
      const t1=performance.now()
      const view=toDisplayView(r.comparison)
      response={ok:true,view,computeMs,viewMs:performance.now()-t1}
    }
  }catch(error){
    a0Cache.clear() // 失敗の原因が保持物に由来しないと言えないので捨てて再計算に倒す
    response={ok:false,code:'WORKER_EXCEPTION',message:error instanceof Error?error.message:String(error),computeMs:performance.now()-t0}
  }
  ctx.postMessage(response)
}
