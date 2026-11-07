// A0/A1のDecisionTraceを「判断の意味」で対応付ける比較専用ヘルパー（UI専用。エンジンのID生成は変更しない）。
// traceIdは年・phase・RuleID・draftIndexの連番なので、枝が違うと別人物・別候補の判断が同じIDになりうる。
// ここではIDを同一性に使わず、年・phase・RuleID・正規化actorRefで対応付け、一意に決まる場合だけ比較する。
import type { DecisionTrace, EventLogEntry, Id, TargetRef } from '../simulation/contracts/index.ts'

export type TraceDelta=Readonly<{
  /** CHANGED=一対一に対応し内容差あり / A1_ONLY=A1で新規 / A0_ONLY=A1で消滅 / AMBIGUOUS=対応不明（比較しない） */
  kind:'CHANGED'|'A1_ONLY'|'A0_ONLY'|'AMBIGUOUS'
  /** 表示用。実際の各枝のtraceId（対応不明では代表としてA1側、無ければA0側）。 */
  traceId:Id
  ruleId:string
  before?:DecisionTrace
  after?:DecisionTrace
  /** AMBIGUOUS時のみ。対応を決められなかった各枝の全Trace。 */
  ambiguousBefore?:readonly DecisionTrace[]
  ambiguousAfter?:readonly DecisionTrace[]
}>
export type TracePair=Readonly<{before:DecisionTrace;after:DecisionTrace}>
export type TraceCorrespondence=Readonly<{
  pairs:readonly TracePair[]
  a1Only:readonly DecisionTrace[]
  a0Only:readonly DecisionTrace[]
  ambiguous:readonly Readonly<{before:readonly DecisionTrace[];after:readonly DecisionTrace[]}>[]
}>
export type TraceSummary=Readonly<{matched:number;unchanged:number;changed:number;a1Only:number;a0Only:number;ambiguousGroups:number;ambiguousTraces:number}>

/** actorRefの正規化キー。PERSON_PAIRは順序に依存させない。 */
export function actorKey(ref:TargetRef):string{
  return ref.kind==='PERSON_PAIR'?'PERSON_PAIR:'+[...ref.ids].sort().join('|'):ref.kind+':'+ref.id
}
const groupKey=(t:DecisionTrace)=>[t.year,t.phase,t.ruleId,actorKey(t.actorRef)].join('/')
const candidateSignature=(t:DecisionTrace)=>t.candidates.map(c=>c.candidateId).sort().join('\u0000')

function bucket<T>(items:readonly T[],key:(t:T)=>string):Map<string,T[]>{
  const m=new Map<string,T[]>()
  for(const it of items){const k=key(it);const a=m.get(k);if(a)a.push(it);else m.set(k,[it])}
  return m
}

/** 同じ意味の判断だけを一対一で対応付ける。曖昧なものはID順・配列順で恣意的に結ばない。 */
export function correspondTraces(a0:readonly DecisionTrace[],a1:readonly DecisionTrace[]):TraceCorrespondence{
  const pairs:TracePair[]=[],a1Only:DecisionTrace[]=[],a0Only:DecisionTrace[]=[]
  const ambiguous:{before:readonly DecisionTrace[];after:readonly DecisionTrace[]}[]=[]
  const g0=bucket(a0,groupKey),g1=bucket(a1,groupKey)
  for(const key of new Set([...g0.keys(),...g1.keys()])){
    const l0=g0.get(key)??[],l1=g1.get(key)??[]
    if(l0.length===0){a1Only.push(...l1);continue}
    if(l1.length===0){a0Only.push(...l0);continue}
    if(l0.length===1&&l1.length===1){pairs.push({before:l0[0]!,after:l1[0]!});continue}
    // 同一actor・同一ruleに複数Trace: 候補ID集合が両枝で一意に一致するものだけを対応付ける。
    const s0=bucket(l0,candidateSignature),s1=bucket(l1,candidateSignature)
    const rest0:DecisionTrace[]=[],rest1:DecisionTrace[]=[]
    for(const sig of new Set([...s0.keys(),...s1.keys()])){
      const x=s0.get(sig)??[],y=s1.get(sig)??[]
      if(x.length===1&&y.length===1)pairs.push({before:x[0]!,after:y[0]!})
      else{rest0.push(...x);rest1.push(...y)}
    }
    if(rest0.length>0&&rest1.length>0)ambiguous.push({before:rest0,after:rest1})
    else{a0Only.push(...rest0);a1Only.push(...rest1)}
  }
  return {pairs,a1Only,a0Only,ambiguous}
}

/** traceId・eventIdsの採番差を除き、判断内容と因果（Event→意味キー）を比較する。 */
function semanticView(t:DecisionTrace,events:ReadonlyMap<Id,EventLogEntry>){
  const {traceId:_t,eventIds,...rest}=t
  void _t
  // Eventは意味キーに加え、種別・関与対象・状態差分も比較する（sourceTraceIdsは採番差なので除外）。
  const ev=eventIds.map(id=>{
    const e=events.get(id)
    return e?JSON.stringify([e.semanticEventKey,e.eventType,e.involvedRefs,e.stateChanges]):'?'+id
  }).sort()
  return JSON.stringify({...rest,events:ev})
}

export function compareTraces(
  a0:readonly DecisionTrace[],a1:readonly DecisionTrace[],
  a0Events:readonly EventLogEntry[],a1Events:readonly EventLogEntry[],
):Readonly<{deltas:readonly TraceDelta[];summary:TraceSummary;correspondence:TraceCorrespondence}>{
  const c=correspondTraces(a0,a1)
  const e0=new Map(a0Events.map(e=>[e.eventId,e])),e1=new Map(a1Events.map(e=>[e.eventId,e]))
  const deltas:TraceDelta[]=[]
  let unchanged=0
  for(const p of c.pairs){
    if(semanticView(p.before,e0)===semanticView(p.after,e1))unchanged++
    else deltas.push({kind:'CHANGED',traceId:p.after.traceId,ruleId:p.after.ruleId,before:p.before,after:p.after})
  }
  for(const t of c.a1Only)deltas.push({kind:'A1_ONLY',traceId:t.traceId,ruleId:t.ruleId,after:t})
  for(const t of c.a0Only)deltas.push({kind:'A0_ONLY',traceId:t.traceId,ruleId:t.ruleId,before:t})
  for(const g of c.ambiguous){
    const rep=g.after[0]!
    deltas.push({kind:'AMBIGUOUS',traceId:rep.traceId,ruleId:rep.ruleId,ambiguousBefore:g.before,ambiguousAfter:g.after})
  }
  return {deltas,correspondence:c,summary:{
    matched:c.pairs.length,unchanged,changed:c.pairs.length-unchanged,
    a1Only:c.a1Only.length,a0Only:c.a0Only.length,
    ambiguousGroups:c.ambiguous.length,
    ambiguousTraces:c.ambiguous.reduce((n,g)=>n+g.before.length+g.after.length,0),
  }}
}
