// オプトイン: 既存DEC-057/058/061と pair.trust 介入だけで厳格技術Goalを自然に満たすか。
// UI/CLIが正式Goalを公開した証拠ではない。100年A0→A1→A2をforkHistoryで実計算する。
// A1（第1介入のみ）単独で技術Goalが成立する。A2（第2介入の追加）はA1の成立を維持するが、
// 実測ではWorldState・Event内容を変えず、DecisionTraceのmodifier記録だけが変わる（下のA1→A2差分試験）。
import {describe,it,expect} from 'vitest'
import {runPlayBaseline,runPlayComparison,interventionTargetIssue,compareYear} from '../../../src/ui/branch-play-source.ts'
import {INTEGRATED_WITNESSED_SON_ID,INTEGRATED_ATTESTED_PERSON_ID} from '../../../src/scenario/experimental/index.ts'
const SEED=20260101,YEAR=1269
const describeLong=process.env.CHRONOFORK_LONG_A2==='1'?describe:describe.skip
describeLong('Issue #71: A0 NOT_ACHIEVED→A1 ACHIEVED→A2 ACHIEVED維持（実100年、CALIBRATION_ONLY）',()=>{
 it('同年の別対象2回の介入でA2も、1350年の合法な土地保持・新委任が成立（A1単独で既に成立）',()=>{
  // 手書きの旧ID式・固定出生年に依存せず、実A0のB-004評価Traceから介入対象ペアを導出する。
  // 1件目: YEAR年にB-004がACCEPTするペア（A0で成立し得る唯一の候補）。
  // 2件目: 同年のA0 B-004評価に現れ、1件目と人物が重ならず、両者が直接介入可能(非SUPPORTING)なペア（辞書順最小）。
  const base=runPlayBaseline(SEED,'INTEGRATED_EXPERIMENTAL')
  if(!base.ok)throw new Error(base.code)
  const a0=base.a0.result
  const forkWorld=a0.snapshots.find(w=>w.year===YEAR)!
  const pairsAt=a0.decisionTraces.filter(t=>t.ruleId==='B-004'&&t.year===YEAR&&t.actorRef.kind==='PERSON_PAIR')
   .map(t=>({status:t.status,ids:(t.actorRef as {ids:readonly [string,string]}).ids}))
  const accepted=pairsAt.filter(x=>x.status==='ACCEPT')
  expect(accepted,YEAR+'年のA0でACCEPTされるペアは1組').toHaveLength(1)
  const firstPair=accepted[0]!.ids
  const secondPair=pairsAt.filter(x=>interventionTargetIssue(forkWorld,x.ids)===null&&!x.ids.some(id=>firstPair.includes(id)))
   .map(x=>x.ids).sort((p,q)=>JSON.stringify(p)<JSON.stringify(q)?-1:JSON.stringify(p)>JSON.stringify(q)?1:0)[0]
  expect(secondPair,'1件目と重ならない実在ペアがA0に存在').toBeDefined()
  expect(interventionTargetIssue(forkWorld,firstPair)).toBeNull()
  // 1件目はA0のPERSON_BIRTHイベントで生まれた人物と、統合シナリオの証明済み人物。
  const bornIds=new Set(a0.eventLog.filter(e=>e.eventType==='PERSON_BIRTH').map(e=>(e.involvedRefs.find(r=>r.kind==='PERSON') as {id:string}).id))
  const [first,attested]=firstPair.includes(INTEGRATED_ATTESTED_PERSON_ID)
   ?[firstPair.find(id=>id!==INTEGRATED_ATTESTED_PERSON_ID)!,INTEGRATED_ATTESTED_PERSON_ID]:[firstPair[0],firstPair[1]]
  expect(attested).toBe(INTEGRATED_ATTESTED_PERSON_ID)
  expect(bornIds.has(first)).toBe(true)
  // 意図した結合点: 統合シナリオ定数(INTEGRATED_WITNESSED_SON_ID)が実A0の出生・ACCEPTペアと一致すること。
  expect(first).toBe(INTEGRATED_WITNESSED_SON_ID)
  expect(secondPair![0]).not.toBe(secondPair![1])
  const input={
   mode:'INTEGRATED_EXPERIMENTAL' as const,seed:SEED,year:YEAR,
   firstPersonId:first,secondPersonId:attested,signedDelta:-200,durationYears:60,
   second:{firstPersonId:secondPair![0],secondPersonId:secondPair![1],signedDelta:-200,durationYears:60},
  }
  const run=runPlayComparison(input)
  expect(run.ok).toBe(true)
  if(!run.ok)return
  const c=run.comparison
  expect(a0.technicalGoal?.status).toBe('NOT_ACHIEVED')
  expect(c.a0.result.technicalGoal?.status).toBe('NOT_ACHIEVED')
  expect(c.second?.branch.lineage).toEqual(['A0-play','A1-play','A2-play'])
  expect(c.second?.branch.ledger).toHaveLength(2)
  // 2件とも台帳に登録され、A1/A2の実Traceから参照される（登録だけでなく適用）。
  const m1=c.modifier.modifierId,m2=c.second!.modifier.modifierId
  expect(m1).not.toBe(m2)
  expect(c.second!.branch.ledger.map(x=>x.modifierId)).toEqual([m1,m2])
  expect(c.a1.result.decisionTraces.some(t=>t.modifierIds.includes(m1))).toBe(true)
  expect(c.second!.a1.result.decisionTraces.some(t=>t.modifierIds.includes(m1))).toBe(true)
  expect(c.second!.a1.result.decisionTraces.some(t=>t.modifierIds.includes(m2))).toBe(true)
  expect(a0.decisionTraces.some(t=>t.modifierIds.includes(m1)||t.modifierIds.includes(m2))).toBe(false)
  expect(c.second?.a1.result.status).toBe('COMPLETED')
  expect(c.second?.a1.result.technicalGoal?.status).toBe('ACHIEVED')
  const r=c.second!.a1.result
  const a=r.technicalGoal
  expect(a?.status).toBe('ACHIEVED')
  if(a?.status==='ACHIEVED'){
    expect(a.assessments.find(x=>x.titleId==='title-exp-central')).toMatchObject({
      qualifies:true,failures:[],basis:{kind:'CONTROL_MANDATE'},
    })
  }
  expect(r.goal).toBeNull()
  expect(r.snapshots.at(-1)?.year).toBe(1350)
  const eventIds=new Set(r.eventLog.map(x=>x.eventId)),traceIds=new Set(r.decisionTraces.map(x=>x.traceId))
  expect(r.eventLog.every(e=>e.sourceTraceIds.every(x=>traceIds.has(x)))).toBe(true)
  expect(r.decisionTraces.every(t=>t.eventIds.every(x=>eventIds.has(x)))).toBe(true)
  // 親子・婚姻の参照整合性（全年・全人物）と、全snapshotでの人物ID一意性。
  for(const w of [...a0.snapshots,...c.a0.result.snapshots,...r.snapshots]){
   const ids=new Set(w.persons.map(p=>p.personId))
   expect(ids.size).toBe(w.persons.length)
   for(const p of w.persons){
    if(p.fatherId!==undefined)expect(ids.has(p.fatherId),w.year+' father of '+p.personId).toBe(true)
    if(p.motherId!==undefined)expect(ids.has(p.motherId),w.year+' mother of '+p.personId).toBe(true)
   }
   expect(new Set(w.legal.marriages.map(m=>m.marriageId)).size).toBe(w.legal.marriages.length)
   for(const m of w.legal.marriages)for(const id of m.personIds)expect(ids.has(id),w.year+' marriage '+m.marriageId).toBe(true)
  }
 },1200000)
 // 実A0から介入対象を導出する共通処理（手書きIDに依存しない）。
 const derive=()=>{
  const base=runPlayBaseline(SEED,'INTEGRATED_EXPERIMENTAL')
  if(!base.ok)throw new Error(base.code)
  const a0=base.a0.result
  const forkWorld=a0.snapshots.find(w=>w.year===YEAR)!
  const pairs=a0.decisionTraces.filter(t=>t.ruleId==='B-004'&&t.year===YEAR&&t.actorRef.kind==='PERSON_PAIR')
   .map(t=>({status:t.status,ids:(t.actorRef as {ids:readonly [string,string]}).ids}))
  const accepted=pairs.filter(x=>x.status==='ACCEPT')
  expect(accepted).toHaveLength(1)
  const pair=accepted[0]!.ids
  const first=pair.find(id=>id!==INTEGRATED_ATTESTED_PERSON_ID)!
  const second=pairs.filter(x=>interventionTargetIssue(forkWorld,x.ids)===null&&!x.ids.some(id=>pair.includes(id)))
   .map(x=>x.ids).sort((p,q)=>JSON.stringify(p)<JSON.stringify(q)?-1:JSON.stringify(p)>JSON.stringify(q)?1:0)[0]!
  return {a0,pair,first,second}
 }
 const pairKey=(ids:readonly string[])=>JSON.stringify([...ids].sort())
 const hasPair=(e:{involvedRefs:readonly {kind:string}[]},ids:readonly string[])=>
  e.involvedRefs.some(r=>r.kind==='PERSON_PAIR'&&pairKey((r as unknown as {ids:readonly string[]}).ids)===pairKey(ids))

 it('A1単独（第1介入のみ）で1350年の厳格技術Goalが成立し、その因果が実Event/Traceと整合する',()=>{
  const {a0,pair,first}=derive()
  const run=runPlayComparison({mode:'INTEGRATED_EXPERIMENTAL',seed:SEED,year:YEAR,firstPersonId:first,
   secondPersonId:INTEGRATED_ATTESTED_PERSON_ID,signedDelta:-200,durationYears:60})
  expect(run.ok).toBe(true)
  if(!run.ok)return
  const c=run.comparison
  expect(c.second).toBeUndefined()
  const A0=c.a0.result,A1=c.a1.result,m1=c.modifier.modifierId
  // Goal: A0不一致 / A1一致 / 1350年まで完走 / goal=null（正式Goalは捏造しない）
  expect(a0.technicalGoal?.status).toBe('NOT_ACHIEVED')
  expect(A0.technicalGoal?.status).toBe('NOT_ACHIEVED')
  expect(A1.status).toBe('COMPLETED')
  expect(A1.technicalGoal?.status).toBe('ACHIEVED')
  expect(A1.goal).toBeNull()
  expect(A1.snapshots.at(-1)?.year).toBe(1350)
  const goal=A1.technicalGoal
  if(goal?.status!=='ACHIEVED')throw new Error('unreachable')
  const central=goal.assessments.find(x=>x.titleId==='title-exp-central')
  expect(central).toMatchObject({qualifies:true,failures:[],basis:{kind:'CONTROL_MANDATE'}})
  const holderId=central!.holderPersonId!
  const w=A1.snapshots.at(-1)!
  // 中央TERRITORIAL Titleは、生存する合法ナルヴェン構成員が保持する。
  const title=w.titles.find(t=>t.titleId==='title-exp-central')!
  expect(title).toMatchObject({kind:'TERRITORIAL',valid:true,holder:{status:'HELD',personId:holderId}})
  const holder=w.persons.find(p=>p.personId===holderId)!
  expect(holder.alive).toBe(true)
  expect(holder.legalDynasty).toEqual({status:'DETERMINED',dynastyId:'dynasty-nalven'})
  // 有効なControlMandate: Goalが根拠とするmandateが1350年に有効で、実Eventと実法制Traceから発行されている。
  const mandateId=(central!.basis as {mandateId:string}).mandateId
  const mandate=w.legal.controlMandates.find(m=>m.mandateId===mandateId)!
  expect(mandate).toMatchObject({beneficiaryPersonId:holderId,authorizingTitleId:'title-exp-central'})
  expect(mandate.effectiveFromYear).toBeLessThanOrEqual(1350)
  expect(mandate.endExclusiveYear).toBeGreaterThan(1350)
  const mandateEv=A1.eventLog.find(e=>e.eventType==='CONTROL_MANDATE_SET'&&JSON.stringify(e.stateChanges).includes(JSON.stringify(mandateId).slice(1,-1)))!
  expect(mandateEv).toBeDefined()
  expect(mandateEv.sourceTraceIds.length).toBeGreaterThan(0)
  const mTraces=A1.decisionTraces.filter(t=>mandateEv.sourceTraceIds.includes(t.traceId))
  expect(mTraces.length).toBe(mandateEv.sourceTraceIds.length)
  expect(mTraces.every(t=>t.ruleId==='A-TIT-07'&&t.eventIds.includes(mandateEv.eventId))).toBe(true)
  expect(mandateEv.year).toBe(mandate.effectiveFromYear)

  // --- 因果: 1269判断変更 → 1272代替婚姻 → 1278婚姻 → 1291出生 → 1348相続・委任 ---
  // 1269: B-004がA0でACCEPT(modifierなし)、A1でREJECT(m1適用、実効信頼が閾値未満)。
  const b004=(r:typeof A0)=>r.decisionTraces.filter(t=>t.ruleId==='B-004'&&t.year===YEAR&&t.actorRef.kind==='PERSON_PAIR'
   &&pairKey((t.actorRef as {ids:readonly string[]}).ids)===pairKey(pair))
  expect(b004(A0)).toHaveLength(1)
  expect(b004(A1)).toHaveLength(1)
  const t0=b004(A0)[0]!,t1=b004(A1)[0]!
  expect([t0.status,t1.status]).toEqual(['ACCEPT','REJECT'])
  expect(t0.modifierIds).toEqual([])
  expect(t1.modifierIds).toEqual([m1])
  expect(t1.candidates[0]!.score!).toBeLessThan(t1.candidates[0]!.threshold!)
  expect(t0.candidates[0]!.score!).toBeGreaterThanOrEqual(t0.candidates[0]!.threshold!)
  const marriages=(r:typeof A0,y:number)=>r.eventLog.filter(e=>e.year===y&&e.eventType==='MARRIAGE_REGISTER')
  // A0は1269年に当該ペアが婚姻、A1は同年に婚姻しない。
  expect(marriages(A0,YEAR).some(e=>hasPair(e,pair))).toBe(true)
  expect(marriages(A1,YEAR)).toHaveLength(0)
  // 1272: A1だけが別の人物と証明済み人物(east-cardon)の代替婚姻を登録する（A0は同年婚姻なし）。
  expect(marriages(A0,1272)).toHaveLength(0)
  const alt=marriages(A1,1272)
  expect(alt).toHaveLength(1)
  expect(alt[0]!.involvedRefs.some(r=>r.kind==='PERSON_PAIR'&&(r as unknown as {ids:readonly string[]}).ids.includes(INTEGRATED_ATTESTED_PERSON_ID)&&!(r as unknown as {ids:readonly string[]}).ids.includes(first))).toBe(true)
  // 1278: A1だけが第1介入対象本人の婚姻を登録する。
  const m1278=marriages(A1,1278).filter(e=>e.involvedRefs.some(r=>r.kind==='PERSON_PAIR'&&(r as unknown as {ids:readonly string[]}).ids.includes(first)))
  expect(m1278).toHaveLength(1)
  expect(marriages(A0,1278).some(e=>e.involvedRefs.some(r=>r.kind==='PERSON_PAIR'&&(r as unknown as {ids:readonly string[]}).ids.includes(first)))).toBe(false)
  // 1291: 当該婚姻の子（Title保持者）がA1だけで出生し、親は第1介入対象本人。
  const birth=A1.eventLog.find(e=>e.year===1291&&e.eventType==='PERSON_BIRTH'&&e.involvedRefs.some(r=>r.kind==='PERSON'&&(r as {id:string}).id===holderId))
  expect(birth).toBeDefined()
  expect(A0.eventLog.some(e=>e.eventType==='PERSON_BIRTH'&&e.involvedRefs.some(r=>r.kind==='PERSON'&&(r as {id:string}).id===holderId))).toBe(false)
  expect([holder.fatherId,holder.motherId]).toContain(first)
  expect(holder.birthYear).toBe(1291)
  // 1348: 中央Titleの先代死亡後、A1だけが保持者を確定し、同年に新ControlMandateを発行する。
  const transfers=A1.eventLog.filter(e=>e.year===1348&&e.eventType==='LEGAL_TITLE_TRANSFER'&&JSON.stringify(e.stateChanges).includes('title-exp-central')&&JSON.stringify(e.stateChanges).includes(holderId))
  expect(transfers).toHaveLength(1)
  expect(mandate.effectiveFromYear).toBe(1348)
  expect(A0.eventLog.some(e=>e.year>=1347&&e.eventType==='LEGAL_TITLE_TRANSFER'&&JSON.stringify(e.stateChanges).includes('title-exp-central')&&e.stateChanges.some(sc=>sc.path==='$.titles[title-exp-central].holder.status'&&sc.after==='HELD'))).toBe(false)
  const wA0=A0.snapshots.at(-1)!
  expect(wA0.titles.find(t=>t.titleId==='title-exp-central')!.holder.status).toBe('UNDETERMINED')
 },1200000)

 it('A1→A2の実差分: 第2介入はmodifier記録とTrace内部値だけを変え、WorldState・Event・判断・Goalを変えない',()=>{
  const {pair,first,second}=derive()
  const run=runPlayComparison({mode:'INTEGRATED_EXPERIMENTAL',seed:SEED,year:YEAR,firstPersonId:first,
   secondPersonId:INTEGRATED_ATTESTED_PERSON_ID,signedDelta:-200,durationYears:60,
   second:{firstPersonId:second[0],secondPersonId:second[1],signedDelta:-200,durationYears:60}})
  expect(run.ok).toBe(true)
  if(!run.ok)return
  const c=run.comparison,s=c.second!
  const m1=c.modifier.modifierId,m2=s.modifier.modifierId
  const A1=c.a1.result,A2=s.a1.result
  expect(s.a0.result).toBe(A1) // 第2比較のA0側は、親のA1そのもの
  // 2件目は台帳に登録され、A2の実Traceに適用される（A1のTraceには現れない）。
  expect(s.branch.ledger.map(x=>x.modifierId)).toEqual([m1,m2])
  expect(A1.decisionTraces.some(t=>t.modifierIds.includes(m2))).toBe(false)
  const applied=A2.decisionTraces.filter(t=>t.modifierIds.includes(m2))
  expect(applied.length).toBeGreaterThan(0)
  // 適用先は第2介入のペアだけ。
  expect(applied.every(t=>t.actorRef.kind==='PERSON_PAIR'&&pairKey((t.actorRef as {ids:readonly string[]}).ids)===pairKey(second))).toBe(true)
  // 勝敗は同じ（A1で既に成立。A2で初めて成立したのではない）。
  expect(A1.technicalGoal?.status).toBe('ACHIEVED')
  expect(A2.technicalGoal).toEqual(A1.technicalGoal)
  // WorldState: 全年・全項目が一致。
  expect(A2.snapshots.length).toBe(A1.snapshots.length)
  for(let i=0;i<A1.snapshots.length;i++)expect(A2.snapshots[i],'WorldState '+A1.snapshots[i]!.year).toEqual(A1.snapshots[i])
  // Event: ID集合だけでなく、種別・関与対象・stateChangesまで全件一致。
  expect(A2.eventLog.map(e=>({id:e.eventId,t:e.eventType,r:e.involvedRefs,sc:e.stateChanges})))
   .toEqual(A1.eventLog.map(e=>({id:e.eventId,t:e.eventType,r:e.involvedRefs,sc:e.stateChanges})))
  let changedTraces=0
  for(let y=YEAR;y<=1350;y++){
   const d=compareYear(s,y)
   changedTraces+=d.traces.length
   expect(d.events,'Event差分 '+y).toHaveLength(0)
   expect(d.traceSummary.a1Only+d.traceSummary.a0Only+d.traceSummary.ambiguousGroups,'Trace増減/対応不明 '+y).toBe(0)
   for(const t of d.traces){
    // 変化したTraceは、B-004/B-005の第2介入ペアのうち、statusは同一。
    expect(t.kind).toBe('CHANGED')
    expect(t.before!.status,y+' '+t.ruleId).toBe(t.after!.status)
    expect(t.after!.actorRef).toEqual(t.before!.actorRef)
    expect(pairKey((t.after!.actorRef as {ids:readonly string[]}).ids)).toBe(pairKey(second))
    expect(t.after!.modifierIds).toEqual([m2])
    expect(t.before!.modifierIds).toEqual([])
    // 候補・スコアの最終値は同一。変わったのはrawModifierSum等の入力記録のみ。
    expect(t.after!.eventIds).toEqual(t.before!.eventIds)
    expect(t.after!.candidates.map(x=>[x.candidateId,x.eligible,x.score,x.threshold,x.reasonCodes]))
     .toEqual(t.before!.candidates.map(x=>[x.candidateId,x.eligible,x.score,x.threshold,x.reasonCodes]))
   }
  }
  expect(changedTraces,'Trace内部値の変化は実在する（記録のみ）').toBeGreaterThan(0)
  // 第1介入ペアのTraceは第2介入の影響を受けない（A1とA2で意味的に同一）。
  const firstTraces=(r:typeof A1)=>r.decisionTraces.filter(t=>t.actorRef.kind==='PERSON_PAIR'&&pairKey((t.actorRef as {ids:readonly string[]}).ids)===pairKey(pair))
    .map(t=>({y:t.year,r:t.ruleId,st:t.status,m:t.modifierIds,c:t.candidates}))
  expect(firstTraces(A2)).toEqual(firstTraces(A1))
  // 実効信頼は下限(-100)に飽和済みで、2件目の-200は実効値を動かせなかった（記録だけ）。
  const sample=applied.find(t=>t.ruleId==='B-004')!
  const inp=sample.candidates[0]!.inputs as {baseTrust:number;rawModifierSum:number;effectiveTrust:number}
  expect(inp.rawModifierSum).toBe(-200)
  expect(inp.effectiveTrust).toBe(inp.baseTrust)
 },1200000)
},1200000)
