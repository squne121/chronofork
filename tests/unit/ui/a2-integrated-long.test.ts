// オプトイン(CHRONOFORK_LONG_A2=1): 統合実験構成(DEC-057/058/061, すべてCALIBRATION_ONLY)の実100年A0→A1→A2。
// 検証目的を分ける:
//  (1) A1単独: 第1介入だけで厳格技術Goalが成立する。因果をEvent/Traceで追う（第2介入は不要）。
//  (2) A2保持: 第2介入のmodifierが台帳・Traceに登録/適用されるが、本seedではA1の結果を変えない。
// 正式Goal(goal)は常にnull。技術Goalは校正用の評価であり、勝利の公式判定ではない。
// A2の勝利を「2回の介入の相乗効果」と扱わない（A1単独で成立し、A1/A2のWorldState・Eventは同一）。
import {describe,it,expect,beforeAll} from 'vitest'
import {runPlayBaseline,runPlayComparison,interventionTargetIssue} from '../../../src/ui/branch-play-source.ts'
import type {PlayComparison} from '../../../src/ui/branch-play-source.ts'
import {INTEGRATED_WITNESSED_SON_ID,INTEGRATED_ATTESTED_PERSON_ID,EXPERIMENTAL_ORDINARY_LAWS} from '../../../src/scenario/experimental/index.ts'
import type {DecisionTrace,EventLogEntry,TargetRef,WorldState} from '../../../src/simulation/contracts/index.ts'
import type {TimelineResult} from '../../../src/simulation/engine/index.ts'
const SEED=20260101,YEAR=1269
const CENTRAL='title-exp-central',CROWN='title-exp-crown-eldia'
const describeLong=process.env.CHRONOFORK_LONG_A2==='1'?describe:describe.skip
const cmp=(p:readonly string[],q:readonly string[])=>JSON.stringify(p)<JSON.stringify(q)?-1:JSON.stringify(p)>JSON.stringify(q)?1:0
const pairKey=(ids:readonly string[])=>JSON.stringify([...ids].sort())
const pairOf=(t:DecisionTrace)=>t.actorRef.kind==='PERSON_PAIR'?pairKey(t.actorRef.ids):''
const pairRefs=(e:EventLogEntry):readonly (readonly string[])[]=>
 e.involvedRefs.filter((r:TargetRef)=>r.kind==='PERSON_PAIR').map(r=>(r as {ids:readonly string[]}).ids)
const marriages=(r:TimelineResult,y:number)=>r.eventLog.filter(e=>e.year===y&&e.eventType==='MARRIAGE_REGISTER')
const titleTransfers=(r:TimelineResult,y:number,titleId:string)=>
 r.eventLog.filter(e=>e.year===y&&e.eventType==='LEGAL_TITLE_TRANSFER'&&e.stateChanges.some(s=>s.path.startsWith(`$.titles[${titleId}]`)))
const holderAfter=(e:EventLogEntry,titleId:string)=>
 e.stateChanges.find(s=>s.path===`$.titles[${titleId}].holder.personId`)?.after

describeLong('Issue #71: A0 NOT_ACHIEVED→A1 ACHIEVED（第1介入のみ）→A2（第2介入の保持）実100年、CALIBRATION_ONLY',()=>{
 let c:PlayComparison,a0Full:TimelineResult
 let pair:readonly [string,string],first:string,secondPair:readonly [string,string]
 let A0:TimelineResult,A1:TimelineResult,A2:TimelineResult,m1:string,m2:string
 beforeAll(()=>{
  // 手書きの旧ID式・固定出生年に依存せず、実A0のB-004評価Traceから介入対象ペアを導出する。
  // 1件目: YEAR年にB-004がACCEPTするペア（A0で成立し得る唯一の候補）。
  // 2件目: 同年のA0 B-004評価に現れ、1件目と人物が重ならず、直接介入可能(非SUPPORTING)なペア（辞書順最小）。
  const base=runPlayBaseline(SEED,'INTEGRATED_EXPERIMENTAL')
  if(!base.ok)throw new Error(base.code)
  a0Full=base.a0.result
  const forkWorld=a0Full.snapshots.find(w=>w.year===YEAR) as WorldState
  const pairs=a0Full.decisionTraces.filter(t=>t.ruleId==='B-004'&&t.year===YEAR&&t.actorRef.kind==='PERSON_PAIR')
   .map(t=>({status:t.status,ids:(t.actorRef as {ids:readonly [string,string]}).ids}))
  const accepted=pairs.filter(x=>x.status==='ACCEPT')
  expect(accepted,YEAR+'年のA0でACCEPTされるペアは1組').toHaveLength(1)
  pair=accepted[0]!.ids
  expect(pair).toContain(INTEGRATED_ATTESTED_PERSON_ID)
  first=pair.find(id=>id!==INTEGRATED_ATTESTED_PERSON_ID)!
  // 統合シナリオ定数(INTEGRATED_WITNESSED_SON_ID)が実A0の出生・ACCEPTペアと一致する結合点。
  expect(first).toBe(INTEGRATED_WITNESSED_SON_ID)
  expect(interventionTargetIssue(forkWorld,pair)).toBeNull()
  const second=pairs.filter(x=>interventionTargetIssue(forkWorld,x.ids)===null&&!x.ids.some(id=>pair.includes(id)))
   .map(x=>x.ids).sort(cmp)[0]
  expect(second,'1件目と重ならない実在ペアがA0に存在').toBeDefined()
  secondPair=second!
  const run=runPlayComparison({
   mode:'INTEGRATED_EXPERIMENTAL',seed:SEED,year:YEAR,firstPersonId:first,secondPersonId:INTEGRATED_ATTESTED_PERSON_ID,
   signedDelta:-200,durationYears:60,
   second:{firstPersonId:secondPair[0],secondPersonId:secondPair[1],signedDelta:-200,durationYears:60},
  })
  if(!run.ok)throw new Error(run.code+':'+run.message)
  c=run.comparison
  A0=c.a0.result;A1=c.a1.result;A2=c.second!.a1.result
  m1=c.modifier.modifierId;m2=c.second!.modifier.modifierId
 },1200000)

 it('(1) A1単独: A0 NOT_ACHIEVED→第1介入のみのA1でACHIEVED。goalはnull、1350年まで完走',()=>{
  expect(a0Full.technicalGoal?.status).toBe('NOT_ACHIEVED')
  expect(A0.technicalGoal?.status).toBe('NOT_ACHIEVED')
  // c.a1 は第1介入(m1)だけのforkであり、第2介入(m2)を一切含まない。
  expect(A1.branchId).toBe('A1-play')
  expect(A1.status).toBe('COMPLETED')
  expect(A1.technicalGoal?.status).toBe('ACHIEVED')
  expect(A1.goal).toBeNull()
  expect(A1.snapshots.at(-1)?.year).toBe(1350)
  expect(A1.decisionTraces.some(t=>t.modifierIds.includes(m1))).toBe(true)
  expect(A1.decisionTraces.some(t=>t.modifierIds.includes(m2))).toBe(false)
  expect(a0Full.decisionTraces.some(t=>t.modifierIds.length>0)).toBe(false)
 })

 it('(1) A1単独: 勝利根拠はTERRITORIALのtitle-exp-central（CROWN移転ではない）で、有効な法令由来ControlMandate',()=>{
  const goal=A1.technicalGoal
  if(goal?.status!=='ACHIEVED')throw new Error('A1 technical goal not achieved')
  const central=goal.assessments.find(x=>x.titleId===CENTRAL)!
  expect(central).toMatchObject({qualifies:true,failures:[],basis:{kind:'CONTROL_MANDATE'}})
  // 勝利に使われたのはcentralのみ。CROWN Titleは根拠にならない（qualifies:false）。
  expect(goal.assessments.filter(x=>x.qualifies).map(x=>x.titleId)).toEqual([CENTRAL])
  expect(goal.assessments.find(x=>x.titleId===CROWN)).toMatchObject({qualifies:false})
  const w=A1.snapshots.at(-1)!
  const title=w.titles.find(t=>t.titleId===CENTRAL)!
  expect(title.kind).toBe('TERRITORIAL')
  expect(w.titles.find(t=>t.titleId===CROWN)!.kind).toBe('CROWN')
  const holderId=central.holderPersonId!
  expect(title).toMatchObject({valid:true,holder:{status:'HELD',personId:holderId}})
  const holder=w.persons.find(p=>p.personId===holderId)!
  expect(holder.alive).toBe(true)
  expect(holder.legalDynasty).toEqual({status:'DETERMINED',dynastyId:'dynasty-nalven'})
  const mandateId=(central.basis as {mandateId:string}).mandateId
  const mandate=w.legal.controlMandates.find(m=>m.mandateId===mandateId)!
  expect(mandate).toMatchObject({beneficiaryPersonId:holderId,authorizingTitleId:CENTRAL})
  expect(mandate.effectiveFromYear).toBe(1348)
  expect(mandate.endExclusiveYear).toBeGreaterThan(1350)
  // 発行は実EventとA-TIT-07のTraceに閉じる。
  const ev=A1.eventLog.find(e=>e.eventType==='CONTROL_MANDATE_SET'&&e.year===1348&&JSON.stringify(e.stateChanges).includes(JSON.stringify(mandateId).slice(1,-1)))!
  expect(ev).toBeDefined()
  const traces=A1.decisionTraces.filter(t=>ev.sourceTraceIds.includes(t.traceId))
  expect(traces.length).toBe(ev.sourceTraceIds.length)
  expect(traces.length).toBeGreaterThan(0)
  expect(traces.every(t=>t.ruleId==='A-TIT-07'&&t.eventIds.includes(ev.eventId))).toBe(true)
  // 新委任の法令は正式世界設定ではなく校正用背景記録(CALIBRATION_ONLY)。
  const law=EXPERIMENTAL_ORDINARY_LAWS.find(l=>l.lawId==='exp-law-central-new-mandate')!
  expect(law).toMatchObject({action:'NEW_CONTROL_MANDATE',titleId:CENTRAL,provenance:'CALIBRATION_ONLY'})
  expect(mandateId).toContain('exp-law-central-new-mandate')
 })

 it('(1) A1単独: 1269年の婚姻抑止（B-004 ACCEPT→REJECT, B-005 ACCEPT→DEFER）が実Traceにある',()=>{
  const at=(r:TimelineResult,rule:string)=>r.decisionTraces.filter(t=>t.ruleId===rule&&t.year===YEAR&&pairOf(t)===pairKey(pair))
  const [b4a0,b4a1,b5a0,b5a1]=[at(A0,'B-004'),at(A1,'B-004'),at(A0,'B-005'),at(A1,'B-005')]
  for(const x of [b4a0,b4a1,b5a0,b5a1])expect(x).toHaveLength(1)
  expect([b4a0[0]!.status,b4a1[0]!.status]).toEqual(['ACCEPT','REJECT'])
  expect([b5a0[0]!.status,b5a1[0]!.status]).toEqual(['ACCEPT','DEFER'])
  expect(b4a0[0]!.modifierIds).toEqual([])
  expect(b4a1[0]!.modifierIds).toEqual([m1])
  const s0=b4a0[0]!.candidates[0]!,s1=b4a1[0]!.candidates[0]!
  expect(s0.score!).toBeGreaterThanOrEqual(s0.threshold!)
  expect(s1.score!).toBeLessThan(s1.threshold!)
  expect(b5a1[0]!.reasonCodes).toContain('B004_NOT_ACCEPTED')
  expect(marriages(A0,YEAR).some(e=>pairRefs(e).some(p=>pairKey(p)===pairKey(pair)))).toBe(true)
  expect(marriages(A1,YEAR)).toHaveLength(0)
 })

 it('(1) A1単独: 1272/1278の別婚姻→1291の合法ナルヴェン出生→1347相続PENDING→1348土地相続・新委任→1350達成を実Eventで追える',()=>{
  const goal=A1.technicalGoal
  if(goal?.status!=='ACHIEVED')throw new Error('A1 technical goal not achieved')
  const holderId=goal.assessments.find(x=>x.titleId===CENTRAL)!.holderPersonId!
  const w=A1.snapshots.at(-1)!
  const holder=w.persons.find(p=>p.personId===holderId)!
  // 1272: 抑止されたペアの片方(CARDON)が別の相手と婚姻（A0では同年婚姻なし）。
  expect(marriages(A0,1272)).toHaveLength(0)
  const m72=marriages(A1,1272)
  expect(m72).toHaveLength(1)
  const p72=pairRefs(m72[0]!)[0]!
  expect(p72).toContain(INTEGRATED_ATTESTED_PERSON_ID)
  expect(p72).not.toContain(first)
  // 1278: 第1介入対象本人の婚姻（A0に当該婚姻なし）。
  const wed=(r:TimelineResult)=>marriages(r,1278).filter(e=>pairRefs(e).some(p=>p.includes(first)))
  expect(wed(A1)).toHaveLength(1)
  expect(wed(A0)).toHaveLength(0)
  // 1291: Title保持者はA1のみで出生し、親は第1介入対象本人。合法王朝はナルヴェン(DETERMINED)。
  const birthOf=(r:TimelineResult)=>r.eventLog.filter(e=>e.eventType==='PERSON_BIRTH'&&e.involvedRefs.some(x=>x.kind==='PERSON'&&x.id===holderId))
  expect(birthOf(A1).map(e=>e.year)).toEqual([1291])
  expect(birthOf(A0)).toHaveLength(0)
  expect(holder.birthYear).toBe(1291)
  expect([holder.fatherId,holder.motherId]).toContain(first)
  expect(holder.legalDynasty).toEqual({status:'DETERMINED',dynastyId:'dynasty-nalven'})
  // 1347: centralが空位(UNDETERMINED)となり相続が保留される。
  const pending=titleTransfers(A1,1347,CENTRAL)
  expect(pending).toHaveLength(1)
  expect(pending[0]!.stateChanges.find(s=>s.path===`$.titles[${CENTRAL}].holder.status`)?.after).toBe('UNDETERMINED')
  // 1348: 通常の土地相続(LEGAL_TITLE_TRANSFER)でholderIdが確定し、同年に新ControlMandateが発行される。
  const inherit=titleTransfers(A1,1348,CENTRAL)
  expect(inherit).toHaveLength(1)
  expect(holderAfter(inherit[0]!,CENTRAL)).toBe(holderId)
  expect(inherit[0]!.stateChanges.find(s=>s.path===`$.titles[${CENTRAL}].holder.status`)?.after).toBe('HELD')
  expect(A1.eventLog.filter(e=>e.year===1348&&e.eventType==='CONTROL_MANDATE_SET')).toHaveLength(1)
  // A0は同じ時期にcentralの保持者が確定せず、最終的に未確定のまま。
  expect(titleTransfers(A0,1348,CENTRAL)).toHaveLength(0)
  expect(A0.snapshots.at(-1)!.titles.find(t=>t.titleId===CENTRAL)!.holder.status).toBe('UNDETERMINED')
  // 参照整合: 全Eventの出典Traceと全Traceのevent参照が閉じている。
  const eventIds=new Set(A1.eventLog.map(x=>x.eventId)),traceIds=new Set(A1.decisionTraces.map(x=>x.traceId))
  expect(A1.eventLog.every(e=>e.sourceTraceIds.every(x=>traceIds.has(x)))).toBe(true)
  expect(A1.decisionTraces.every(t=>t.eventIds.every(x=>eventIds.has(x)))).toBe(true)
 })

 it('(2) A2保持: 2件のmodifierが台帳に登録され、A2のTraceで適用される（第2介入の登録≠勝利への寄与）',()=>{
  expect(m1).not.toBe(m2)
  expect(c.second?.branch.lineage).toEqual(['A0-play','A1-play','A2-play'])
  expect(c.second?.branch.ledger).toHaveLength(2)
  expect(c.second!.branch.ledger.map(x=>x.modifierId)).toEqual([m1,m2])
  expect(A2.status).toBe('COMPLETED')
  expect(A2.technicalGoal?.status).toBe('ACHIEVED')
  expect(A2.goal).toBeNull()
  expect(A2.decisionTraces.some(t=>t.modifierIds.includes(m1))).toBe(true)
  expect(A2.decisionTraces.some(t=>t.modifierIds.includes(m2))).toBe(true)
  expect(A0.decisionTraces.some(t=>t.modifierIds.includes(m1)||t.modifierIds.includes(m2))).toBe(false)
 })

 it('(2) A1→A2差分: WorldState・Eventは同一。DecisionTraceはm2を記録するB-004/B-005のTrace(第2対象ペア)だけが異なる',()=>{
  // 実測した比較結果のみを断言する（JSON直列化の完全一致）。
  expect(JSON.stringify(A2.snapshots)).toBe(JSON.stringify(A1.snapshots))
  expect(JSON.stringify(A2.eventLog)).toBe(JSON.stringify(A1.eventLog))
  expect(A2.decisionTraces.map(t=>t.traceId)).toEqual(A1.decisionTraces.map(t=>t.traceId))
  const diff=A1.decisionTraces.map((t,i)=>({t,u:A2.decisionTraces[i]!})).filter(x=>JSON.stringify(x.t)!==JSON.stringify(x.u))
  expect(diff.length).toBeGreaterThan(0)
  for(const {t,u} of diff){
   expect(['B-004','B-005']).toContain(t.ruleId)
   expect(pairOf(t)).toBe(pairKey(secondPair))
   expect(t.modifierIds).toEqual([])
   expect(u.modifierIds).toEqual([m2])
   // 比較するのはmodifierIds・status・reasonCodes・候補のscore/reasonCodes（inputs全体の等価は主張しない）。
   expect(u.status).toBe(t.status)
   expect(u.reasonCodes).toEqual(t.reasonCodes)
   expect(u.candidates.map(x=>x.score)).toEqual(t.candidates.map(x=>x.score))
   expect(u.candidates.map(x=>x.reasonCodes)).toEqual(t.candidates.map(x=>x.reasonCodes))
  }
  // m2を参照するTraceはすべて上の差分Traceに一致する（他のTraceにm2は現れない）。
  expect(A2.decisionTraces.filter(t=>t.modifierIds.includes(m2)).length).toBe(diff.length)
 })

 it('(2) 観測（本seed・本第2ペアのみ）: 対象ペアの基礎信頼が下限-100で、-200を足しても実効信頼は-100のまま',()=>{
  const traces=A2.decisionTraces.filter(t=>t.ruleId==='B-004'&&t.modifierIds.includes(m2))
  expect(traces.length).toBeGreaterThan(0)
  for(const t of traces){
   const inp=t.candidates[0]!.inputs as {baseTrust:number;rawModifierSum:number;effectiveTrust:number}
   expect(inp.baseTrust).toBe(-100)
   expect(inp.rawModifierSum).toBe(-200)
   expect(inp.effectiveTrust).toBe(-100)
   expect(t.status).toBe('REJECT')
  }
 })

 it('世界状態の整合: 全snapshotで人物ID一意・親子/婚姻参照が閉じる',()=>{
  for(const w of [...a0Full.snapshots,...A0.snapshots,...A1.snapshots]){
   const ids=new Set(w.persons.map(p=>p.personId))
   expect(ids.size).toBe(w.persons.length)
   for(const p of w.persons){
    if(p.fatherId!==undefined)expect(ids.has(p.fatherId),w.year+' father of '+p.personId).toBe(true)
    if(p.motherId!==undefined)expect(ids.has(p.motherId),w.year+' mother of '+p.personId).toBe(true)
   }
   expect(new Set(w.legal.marriages.map(m=>m.marriageId)).size).toBe(w.legal.marriages.length)
   for(const m of w.legal.marriages)for(const id of m.personIds)expect(ids.has(id),w.year+' marriage '+m.marriageId).toBe(true)
  }
 })
},1200000)
