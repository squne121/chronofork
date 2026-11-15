// オプトイン: 既存DEC-057/058/061と2回のpair.trust介入だけで厳格技術Goalを自然に満たすか。
// UI/CLIが正式Goalを公開した証拠ではない。100年A0→A1→A2をforkHistoryで実計算する。
import {describe,it,expect} from 'vitest'
import {runPlayBaseline,runPlayComparison,interventionTargetIssue} from '../../../src/ui/branch-play-source.ts'
import {INTEGRATED_WITNESSED_SON_ID,INTEGRATED_ATTESTED_PERSON_ID} from '../../../src/scenario/experimental/index.ts'
const SEED=20260101,YEAR=1269
const describeLong=process.env.CHRONOFORK_LONG_A2==='1'?describe:describe.skip
describeLong('Issue #71: A0 NOT_ACHIEVED→A2 ACHIEVED（実100年、CALIBRATION_ONLY）',()=>{
 it('同年の別対象2回の介入でA1→A2、1350年の合法な土地保持・新委任が成立',()=>{
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
},1200000)
