// 統合モードの結果をWeb Workerからメインスレッドへ渡すための表示用ビュー(A0/A1で同一の高頻度記録のみ省略。省略した個別詳細はUIから復元できない)。
// 100年のA0/A1は PERSON_PAIR_TRUST_SET(約3.9万件)と B-009 Trace(約3.9万件)だけで全体の約8割を占め、
// 完全な結果をタブへ複製するとメモリを使い切るおそれがある。A0/A1で完全に同一なものだけを省略し、件数は必ず保持する。
// 完全な結果はWorker内で生成済みで、同一性の検証(tests/unit/ui)は完全な結果に対して行う。
import type { DecisionTrace, EventLogEntry } from '../simulation/contracts/index.ts'
import type { TimelineResult } from '../simulation/engine/index.ts'
import type { DisplayOmission, PlayComparison, PlayView } from './branch-play-source.ts'
import type { TimelineRun } from './timeline-source.ts'

const OMITTABLE_EVENT_TYPE='PERSON_PAIR_TRUST_SET'
const OMITTABLE_RULE='B-009'
// 同一性の判定は従来どおりJSON文字列の一致。ただし(A0側,A1側)の対ごとに1回だけ判定する(判定が3段で重複していた)。
// JSON文字列そのものは保持しない(約4万件×2の巨大文字列でヒープが増えるため)。
/** JSON.stringify(a)===JSON.stringify(b) と同値な構造比較。素のJSON値(キー順序も比較)だけを直接比べ、
 *  undefined・関数・非有限数・toJSON/非plain object等、JSON化で意味が変わる値に当たったら undefined を返して呼び出し側が文字列比較へ戻す。 */
function jsonEqual(a:unknown,b:unknown):boolean|undefined{
  if(typeof a!==typeof b)return undefined
  if(a===null||b===null)return a===b?true:(typeof a==='object'&&typeof b==='object'?false:undefined)
  switch(typeof a){
    case 'string':case 'boolean':return a===b
    case 'number':return Number.isFinite(a)&&Number.isFinite(b as number)?a===b:undefined
    case 'object':break
    default:return undefined
  }
  const x=a as Record<string,unknown>,y=b as Record<string,unknown>
  const xa=Array.isArray(x),ya=Array.isArray(y)
  if(xa!==ya)return false
  if(xa){
    const p=x as unknown as unknown[],q=y as unknown as unknown[]
    if(p.length!==q.length)return false
    for(let i=0;i<p.length;i++){const r=jsonEqual(p[i],q[i]);if(r!==true)return r}
    return true
  }
  const px=Object.getPrototypeOf(x),py=Object.getPrototypeOf(y)
  if((px!==Object.prototype&&px!==null)||(py!==Object.prototype&&py!==null))return undefined
  const kx=Object.keys(x),ky=Object.keys(y)
  // JSON化で脱落・変換される値(undefined・関数・symbol・toJSON)は、キー数の比較より前に文字列比較へ任せる。
  if(typeof x.toJSON==='function'||typeof y.toJSON==='function')return undefined
  for(const o of [x,y])for(const k in o){
    const v=o[k],t=typeof v
    if(t==='undefined'||t==='function'||t==='symbol'||t==='bigint')return undefined
    if(t==='object'&&v!==null&&typeof (v as Record<string,unknown>).toJSON==='function')return undefined
  }
  if(kx.length!==ky.length)return false
  for(let i=0;i<kx.length;i++){
    if(kx[i]!==ky[i])return false
    const r=jsonEqual(x[kx[i]],y[kx[i]]);if(r!==true)return r
  }
  return true
}
export const jsonSame=(a:object,b:object):boolean=>jsonEqual(a,b)??(JSON.stringify(a)===JSON.stringify(b))

class SameJson{
  private readonly memo=new WeakMap<object,{a:object;r:boolean}>()
  same(a:object,b:object):boolean{
    if(a===b)return true
    const m=this.memo.get(b)
    if(m!==undefined&&m.a===a)return m.r
    const r=jsonSame(a,b)
    this.memo.set(b,{a,r})
    return r
  }
}

/** A0/A1の同一内容は同じオブジェクトとして共有する(構造化複製で一度だけ複製される)。 */
function shared<T extends object>(a0:readonly T[],a1:readonly T[],key:(x:T)=>string,cmp:SameJson):readonly T[]{
  const byKey=new Map(a0.map(x=>[key(x),x] as const))
  return a1.map(x=>{const o=byKey.get(key(x));return o!==undefined&&cmp.same(o,x)?o:x})
}

export function toDisplayView(c:PlayComparison):PlayView{
  const r0=c.a0.result,r1=c.a1.result
  const cmp=new SameJson()
  const ev0=new Map(r0.eventLog.map(e=>[e.eventId,e])),ev1=new Map(r1.eventLog.map(e=>[e.eventId,e]))
  const tr0=new Map(r0.decisionTraces.map(t=>[t.traceId,t])),tr1=new Map(r1.decisionTraces.map(t=>[t.traceId,t]))
  const sameEvent=(id:string)=>{const a=ev0.get(id),b=ev1.get(id);return a!==undefined&&b!==undefined&&cmp.same(a,b)}
  const sameTrace=(id:string)=>{const a=tr0.get(id),b=tr1.get(id);return a!==undefined&&b!==undefined&&cmp.same(a,b)}
  // 候補: 両枝で同一の信頼更新Eventと B-009 Trace。その上で相互参照が閉じる集合だけを省略する。
  const candEvents=new Set(r0.eventLog.filter(e=>e.eventType===OMITTABLE_EVENT_TYPE&&sameEvent(e.eventId)).map(e=>e.eventId))
  const candTraces=new Set(r0.decisionTraces.filter(t=>t.ruleId===OMITTABLE_RULE&&sameTrace(t.traceId)).map(t=>t.traceId))
  // 省略を確定する前に、A0側・A1側の両方で「残るものの参照先が残る」ことを不動点まで確認し、崩れる省略は取り消す。
  const keepE=new Set<string>(),keepT=new Set<string>()
  let omitTraces=new Set<string>(),omitEvents=new Set<string>()
  for(let round=0;round<20;round++){
    const events1=new Set(r0.eventLog.filter(e=>candEvents.has(e.eventId)&&!keepE.has(e.eventId)&&
      e.sourceTraceIds.every(id=>candTraces.has(id)&&!keepT.has(id))).map(e=>e.eventId))
    omitTraces=new Set(r0.decisionTraces.filter(t=>candTraces.has(t.traceId)&&!keepT.has(t.traceId)&&
      t.eventIds.every(id=>events1.has(id))).map(t=>t.traceId))
    omitEvents=new Set(r0.eventLog.filter(e=>events1.has(e.eventId)&&e.sourceTraceIds.every(id=>omitTraces.has(id))).map(e=>e.eventId))
    let changed=false
    for(const side of [r0,r1]){
      for(const e of side.eventLog)if(!omitEvents.has(e.eventId))for(const id of e.sourceTraceIds)
        if(omitTraces.has(id)&&!keepT.has(id)){keepT.add(id);changed=true}
      for(const t of side.decisionTraces)if(!omitTraces.has(t.traceId))for(const id of t.eventIds)
        if(omitEvents.has(id)&&!keepE.has(id)){keepE.add(id);changed=true}
    }
    if(!changed)break
  }
  const shownE=(e:EventLogEntry)=>!omitEvents.has(e.eventId)
  const shownT=(t:DecisionTrace)=>!omitTraces.has(t.traceId)
  const tally=<T,>(xs:readonly T[],k:(x:T)=>string)=>{const m:Record<string,number>={};for(const x of xs)m[k(x)]=(m[k(x)]??0)+1;return m}
  const evKept0=r0.eventLog.filter(shownE),trKept0=r0.decisionTraces.filter(shownT)
  const slim=(run:TimelineRun,events:readonly EventLogEntry[],traces:readonly DecisionTrace[]):TimelineRun=>({
    ...run,result:{...run.result,eventLog:events,decisionTraces:traces} as TimelineResult,
  })
  const a0=slim(c.a0,evKept0,trKept0)
  const a1=slim(c.a1,shared(evKept0,r1.eventLog.filter(e=>!(omitEvents.has(e.eventId)&&sameEvent(e.eventId))),e=>e.eventId,cmp),
    shared(trKept0,r1.decisionTraces.filter(t=>!(omitTraces.has(t.traceId)&&sameTrace(t.traceId))),t=>t.traceId,cmp))
  const displayOmission:DisplayOmission={
    fullEventCount:{a0:r0.eventLog.length,a1:r1.eventLog.length},
    fullTraceCount:{a0:r0.decisionTraces.length,a1:r1.decisionTraces.length},
    omittedEventsByType:tally(r0.eventLog.filter(e=>omitEvents.has(e.eventId)),e=>e.eventType),
    omittedTracesByRule:tally(r0.decisionTraces.filter(t=>omitTraces.has(t.traceId)),t=>t.ruleId),
  }
  return {mode:c.mode,input:c.input,modifier:c.modifier,a0,a1,displayOmission}
}
