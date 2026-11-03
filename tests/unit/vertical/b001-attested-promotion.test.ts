// B-001: 既存PopulationGroupと明示された年齢コホート・身元記録の昇格。
import { describe, expect, it } from 'vitest'
import { createExperimentalWorld } from '../../../src/scenario/experimental/index.ts'
import { createB001PromotionEvaluator } from '../../../src/simulation/rules/b/index.ts'
import type { B001PromotionInput } from '../../../src/simulation/rules/b/index.ts'
import { runYear } from '../../../src/simulation/engine/index.ts'
import { createAutonomousCalibrationEvaluators } from '../../../src/simulation/autonomy/index.ts'
import type { WorldState } from '../../../src/simulation/contracts/index.ts'

const personId='person:attested:east-commons-001'
const COHORT={
  cohortId:'census-east-1240-born',
  groupId:'group-east-commons',
  birthYear:1240, memberCount:5,
  censusEvidenceId:'census:eldia-east-1245-age-cohort',
  recordedYear:1245,provenance:'CALIBRATION_ONLY' as const,
}
const INDIVIDUAL={
  identityEvidenceId:'identity:east-commons-woman-001',
  cohortId:COHORT.cohortId,memberOrdinal:1,
  personId,personName:'試験用・東部人口集団の身元証人',sex:'FEMALE' as const,
  houseId:'house-cardon',recordedYear:1245,
  provenance:'CALIBRATION_ONLY' as const,
}
const input=():B001PromotionInput=>({cohorts:[COHORT],identities:[INDIVIDUAL]})
const evaluator=(inData:B001PromotionInput=input())=>{
  const r=createB001PromotionEvaluator(inData)
  if(!r.ok)throw Error(r.issues.join('; '))
  return r.evaluator
}
const complete=(r:ReturnType<typeof runYear>)=>{
  if(r.status!=='COMPLETED')throw Error(JSON.stringify(r.halt))
  return r
}
describe('DEC-024/058 B-001 証拠に基づく人口集団からの人物昇格',()=>{
  it('実在する集団/Houseの人口容量を照合し、成人した時だけ一人を記名Personへ移す',()=>{
    const initial:WorldState={...createExperimentalWorld(),year:1257}
    const e=evaluator()
    const early=complete(runYear(initial,{seed:42,branchId:'A0',evaluators:{'B-001':e}}))
    expect(early.events.filter(ev=>ev.eventType==='PERSON_PROMOTE')).toHaveLength(0)
    expect(early.traces.some(t=>t.ruleId==='B-001'&&t.reasonCodes.includes('DOCUMENTED_COHORT_TOO_YOUNG'))).toBe(true)
    expect(early.world.persons.some(p=>p.personId===personId)).toBe(false)
    const later=complete(runYear(early.world,{seed:42,branchId:'A0',evaluators:{'B-001':e}}))
    const p=later.world.persons.find(p=>p.personId===personId)!
    expect(p).toMatchObject({
      name:INDIVIDUAL.personName,sex:'FEMALE',birthYear:1240,
      alive:true,originGroupId:COHORT.groupId,houseId:INDIVIDUAL.houseId,
      legalDynasty:{status:'UNDETERMINED'},
    })
    expect(p.fatherId).toBeUndefined()
    expect(p.motherId).toBeUndefined()
    expect(p.bloodlineDynastyId).toBeUndefined()
    const event=later.events.find(ev=>ev.eventType==='PERSON_PROMOTE')!
    expect(event).toBeDefined()
    const trace=later.traces.find(t=>t.traceId===event.sourceTraceIds[0])!
    expect(trace.ruleId).toBe('B-001')
    expect(trace.candidates[0]?.inputs).toMatchObject({
      cohortId:COHORT.cohortId,
      censusEvidenceId:COHORT.censusEvidenceId,
      identityEvidenceId:INDIVIDUAL.identityEvidenceId,
      memberOrdinal:INDIVIDUAL.memberOrdinal,
    })
    expect(trace.eventIds).toContain(event.eventId)
    expect(later.world.groups).toEqual(initial.groups)
    expect(later.world.demographics).toEqual(initial.demographics)
    expect(initial.persons.some(p=>p.personId===personId)).toBe(false)
    const after=complete(runYear(later.world,{seed:42,branchId:'A0',evaluators:{'B-001':e}}))
    expect(after.world.persons.filter(p=>p.personId===personId)).toHaveLength(1)
    expect(after.events.filter(ev=>ev.eventType==='PERSON_PROMOTE')).toHaveLength(0)
    expect(runYear(early.world,{seed:42,branchId:'A0',evaluators:{'B-001':e}})).toEqual(later)
  })
  it('人口集団・House・国の参照に矛盾があればDEFERし、架空の家系や王朝を付けない',()=>{
    const base=createExperimentalWorld()
    const missingGroup=createB001PromotionEvaluator({
      ...input(),cohorts:[{...COHORT,groupId:'not-in-world'}],
    })
    if(!missingGroup.ok)throw Error('structural validation failed unexpectedly')
    const result=complete(runYear(base,{seed:42,evaluators:{'B-001':missingGroup.evaluator}}))
    expect(result.world.persons).toEqual(base.persons)
    expect(result.traces.some(t=>t.ruleId==='B-001'&&
      t.reasonCodes.includes('EXISTING_GROUP_HOUSE_JURISDICTION_UNVERIFIED'))).toBe(true)
    expect(result.events.filter(e=>e.eventType==='PERSON_PROMOTE')).toHaveLength(0)
  })
  it('出典/年齢コホートが欠落、同一構成員の二重記録、人数範囲外はfail-closed',()=>{
    expect(createB001PromotionEvaluator({cohorts:[],identities:[INDIVIDUAL]})).toMatchObject({
      ok:false,issues:expect.arrayContaining(['B001_COHORT_MEMBER_NOT_ATTESTED:0']),
    })
    expect(createB001PromotionEvaluator({cohorts:[COHORT],identities:[INDIVIDUAL,INDIVIDUAL]}).ok).toBe(false)
    expect(createB001PromotionEvaluator({cohorts:[COHORT,{...COHORT,cohortId:'alias-same-group-year'}],identities:[INDIVIDUAL]}).ok).toBe(false)
    expect(createB001PromotionEvaluator({cohorts:[COHORT],identities:[null] as unknown as B001PromotionInput['identities']}).ok).toBe(false)
    expect(createB001PromotionEvaluator({
      cohorts:[COHORT],identities:[{...INDIVIDUAL,memberOrdinal:COHORT.memberCount}],
    }).ok).toBe(false)
  })
  it('明示した昇格人物は同年のB-009関係・B-004縁談候補へ接続する（結婚自体は強制しない）',()=>{
    const w=createExperimentalWorld()
    const evidence:B001PromotionInput={
      cohorts:[{...COHORT,birthYear:1230,censusEvidenceId:'census:eldia-east-1235',recordedYear:1235}],
      identities:[{...INDIVIDUAL,recordedYear:1235}],
    }
    const cfg=createAutonomousCalibrationEvaluators({
      branchStartWorld:w,ledger:[],trustBase:[],promotion:evidence,
    })
    if(!cfg.ok)throw Error(cfg.issues.join(','))
    const r=complete(runYear(w,{seed:42,branchId:'A0',evaluators:cfg.evaluators}))
    expect(r.world.persons.some(p=>p.personId===personId)).toBe(true)
    expect(r.events.some(e=>e.eventType==='PERSON_PROMOTE')).toBe(true)
    expect(r.traces.some(t=>t.ruleId==='B-009'&&t.actorRef.kind==='PERSON_PAIR'&&
      t.actorRef.ids.includes(personId))).toBe(true)
    expect(r.traces.some(t=>t.ruleId==='B-004'&&t.actorRef.kind==='PERSON_PAIR'&&
      t.actorRef.ids.includes(personId))).toBe(true)
    expect(r.world.legal.marriages).toEqual(w.legal.marriages)
    const without=createAutonomousCalibrationEvaluators({branchStartWorld:w,ledger:[],trustBase:[]})
    if(!without.ok)throw Error(without.issues.join(','))
    const unchanged=complete(runYear(w,{seed:42,branchId:'A0',evaluators:without.evaluators}))
    expect(unchanged.world.persons.some(p=>p.personId===personId)).toBe(false)
  })
  it('出典が一件もない世界では昇格者・Eventを捏造しない',()=>{
    const empty=evaluator({cohorts:[],identities:[]})
    const w=createExperimentalWorld()
    const r=complete(runYear(w,{seed:42,evaluators:{'B-001':empty}}))
    expect(r.world.persons).toEqual(w.persons)
    expect(r.events).toHaveLength(0)
    expect(r.traces).toHaveLength(0)
  })
})
