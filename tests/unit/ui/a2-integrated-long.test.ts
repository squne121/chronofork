// オプトイン: 既存DEC-057/058/061と2回のpair.trust介入だけで厳格技術Goalを自然に満たすか。
// UI/CLIが正式Goalを公開した証拠ではない。100年A0→A1→A2をforkHistoryで実計算する。
import {describe,it,expect} from 'vitest'
import {runPlayComparison} from '../../../src/ui/branch-play-source.ts'
import {childIdForMarriageYear} from '../../../src/simulation/rules/b/b002-worldstate.ts'
import {pairKey} from '../../../src/simulation/intervention/index.ts'
import {INTEGRATED_PAIR,INTEGRATED_WITNESSED_SON_ID,INTEGRATED_ATTESTED_PERSON_ID} from '../../../src/scenario/experimental/index.ts'
const describeLong=process.env.CHRONOFORK_LONG_A2==='1'?describe:describe.skip
describeLong('Issue #71: A0 NOT_ACHIEVED→A2 ACHIEVED（実100年、CALIBRATION_ONLY）',()=>{
 it('同年の別対象2回の介入でA1→A2、1350年の合法な土地保持・新委任が成立',()=>{
  const marriageId='marriage:normal:'+JSON.stringify([1250,pairKey(INTEGRATED_PAIR)])
  const first=childIdForMarriageYear(marriageId,INTEGRATED_PAIR[0],INTEGRATED_PAIR[1],1251)
  const second=INTEGRATED_WITNESSED_SON_ID
  const input={
   mode:'INTEGRATED_EXPERIMENTAL' as const,seed:20260101,year:1269,
   firstPersonId:first,secondPersonId:INTEGRATED_ATTESTED_PERSON_ID,signedDelta:-200,durationYears:60,
   second:{firstPersonId:second,secondPersonId:INTEGRATED_ATTESTED_PERSON_ID,signedDelta:-200,durationYears:60},
  }
  const run=runPlayComparison(input)
  expect(run.ok).toBe(true)
  if(!run.ok)return
  const c=run.comparison
  expect(c.a0.result.technicalGoal?.status).toBe('NOT_ACHIEVED')
  expect(c.second?.branch.lineage).toEqual(['A0-play','A1-play','A2-play'])
  expect(c.second?.branch.ledger).toHaveLength(2)
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
 },1200000)
},1200000)
