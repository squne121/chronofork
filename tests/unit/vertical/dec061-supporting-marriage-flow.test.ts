// Issue #83 first integration slice: 少数SUPPORTING記録→B004/B005合意→A-LEG-01法的婚姻。
// すべてCALIBRATION_ONLYのsynthetic証拠。1350勝利・未証明の禁親非該当を偽造しない。
import { describe, expect, it } from 'vitest'
import { createExperimentalWorld, createExperimentalOrdinaryLegalTrial } from '../../../src/scenario/experimental/index.ts'
import { runYear } from '../../../src/simulation/engine/index.ts'
import { createB001SupportingMarriageEvaluator, createB004WorldStateEvaluator, createB005NextgenEvaluator } from '../../../src/simulation/rules/b/index.ts'
import { createALeg01NextgenEvaluator } from '../../../src/simulation/rules/a/index.ts'
import { createPairTrustView } from '../../../src/simulation/intervention/index.ts'
import { EXPERIMENTAL_AUTONOMY } from '../../../src/simulation/autonomy/index.ts'
import { proposeSupportingMarriageCandidates } from '../../../src/simulation/population/supporting-marriage.ts'
import type { SupportingMarriageCohort } from '../../../src/simulation/population/supporting-marriage.ts'
import type { SupportingKinshipClearance } from '../../../src/simulation/rules/a/index.ts'

const world=createExperimentalWorld()
const SEED=2026
const seeker='person-exp-01'
const cohort:SupportingMarriageCohort={
  cohortId:'synthetic:eldia-east-1230-female',groupId:'group-east-elite',
  affiliationHouseId:'house-cardon',familyPoolId:'synthetic:documented-distinct-family',
  tier:'REGIONAL_LOWER_NOBILITY',sex:'FEMALE',birthYear:1230,memberCount:4,
  source:'INITIAL_POPULATION',sourceEvidenceId:'synthetic:initial-population:1230:eldia-east',
  provenance:'CALIBRATION_ONLY',
}
const config={cohorts:[cohort],maxRecordsPerYear:1,maxAliveSupporting:2,perCohortSamples:4,maximumPreviewAge:50}
const supply=createB001SupportingMarriageEvaluator(config)
const supplyEvaluator=supply.ok?supply.evaluator:(()=>{throw new Error('SUPPLY_FACTORY:'+supply.issues.join(','))})()
const predicted=proposeSupportingMarriageCandidates(world,seeker,[cohort],{
  seed:SEED,maxCandidates:1,perCohortSamples:4,maximumPreviewAge:50,
})
if(predicted.status!=='PROPOSED')throw new Error('SYNTHETIC_SUPPLY_MISSING')
const supportId=predicted.candidates[0]!.candidateId
const pair=[seeker,supportId].sort() as [string,string]
const trial=createExperimentalOrdinaryLegalTrial()
const clearance:SupportingKinshipClearance={
  clearanceId:'synthetic:independent-kinship-review:1250',
  personIds:pair,countryId:'country-eldia',
  checkedYear:1250,validUntilYear:1251,
  sourceEvidenceId:'synthetic:independent-kinship-register:not-the-cohort-census',
  provenance:'CALIBRATION_ONLY',
}
const trust=createPairTrustView({
  base:[{personIds:pair,value:40}],ledger:[],
  knownPersonIds:new Set([...world.persons.map(p=>p.personId),supportId]),
})
const trustView=trust.ok?trust.view:(()=>{throw new Error('TRUST_FACTORY_INVALID')})()
function execute(clearances:readonly SupportingKinshipClearance[]){
  const legal=createALeg01NextgenEvaluator({
    book:trial.book,laws:trial.laws,supportingKinshipClearances:clearances,
  })
  if(!legal.ok)throw new Error('LEGAL_FACTORY:'+legal.issues.join(','))
  return runYear(world,{seed:SEED,branchId:'synthetic-A0',evaluators:{
    'B-001':supplyEvaluator,
    'B-004':createB004WorldStateEvaluator(trustView,EXPERIMENTAL_AUTONOMY),
    'B-005':createB005NextgenEvaluator(undefined,clearances),
    'A-LEG-01':legal.evaluator,
  }})
}

describe('DEC-061 Issue #83: 人口候補から非操作配偶者の法的婚姻へ（限定試験）',()=>{
  it('抽象コホート出典からB-001で1名だけSUPPORTINGとして記録し、人口・重要人物・王朝は増やさない',()=>{
    const r=execute([])
    expect(r.status).toBe('COMPLETED')
    if(r.status!=='COMPLETED')return
    const newPeople=r.world.persons.filter(p=>!world.persons.some(old=>old.personId===p.personId))
    expect(newPeople).toHaveLength(1)
    expect(newPeople[0]).toMatchObject({
      personId:supportId,interactionRole:'SUPPORTING',
      birthYear:1230,originGroupId:cohort.groupId,
      legalDynasty:{status:'UNDETERMINED'},
    })
    expect(r.world.groups).toEqual(world.groups)
    expect(r.world.titles).toEqual(world.titles)
    expect(r.world.persons.filter(p=>p.interactionRole!=='SUPPORTING')).toHaveLength(world.persons.length)
    expect(r.events.filter(e=>e.eventType==='PERSON_SUPPORTING_RECORD')).toHaveLength(1)
    expect(r.events.filter(e=>e.eventType==='MARRIAGE_REGISTER')).toHaveLength(0)
    expect(r.traces.some(t=>t.ruleId==='B-001'&&t.reasonCodes.includes('NOT_MARRIAGE_APPROVAL'))).toBe(true)
  })
  it('別個の禁親審査と当年双方合意・法令が揃った場合のみ婚姻がEvent/WorldStateに確定する',()=>{
    const r=execute([clearance])
    expect(r.status).toBe('COMPLETED')
    if(r.status!=='COMPLETED')return
    const marriages=r.world.legal.marriages.filter(m=>m.status==='ACTIVE'&&m.personIds.join('|')===pair.join('|'))
    expect(marriages).toHaveLength(1)
    const event=r.events.find(e=>e.eventType==='MARRIAGE_REGISTER'&&
      e.involvedRefs.some(ref=>ref.kind==='PERSON_PAIR'&&ref.ids.join('|')===pair.join('|')))
    expect(event).toBeDefined()
    expect(r.traces.some(t=>t.ruleId==='B-005'&&t.status==='ACCEPT'&&t.actorRef.kind==='PERSON_PAIR'&&
      t.actorRef.ids.join('|')===pair.join('|'))).toBe(true)
    expect(r.world.groups).toEqual(world.groups)
    expect(r.world.regions).toEqual(world.regions)
    expect(r.world.legal.controlMandates).toEqual(world.legal.controlMandates)
    expect(r.world.legal.taxMandates).toEqual(world.legal.taxMandates)
    expect(execute([clearance])).toEqual(r)
  })
  it('補助候補の集団出典だけ、他ペアの禁親証拠、期限切れ証拠では婚姻を成立させない',()=>{
    const unrelated:SupportingKinshipClearance={...clearance,
      clearanceId:'synthetic:wrong-pair',personIds:['person-exp-02',supportId].sort() as [string,string]}
    const expired:SupportingKinshipClearance={...clearance,checkedYear:1249,validUntilYear:1250}
    for(const refs of [[],[unrelated],[expired]]){
      const r=execute(refs)
      expect(r.status).toBe('COMPLETED')
      if(r.status!=='COMPLETED')continue
      expect(r.events.filter(e=>e.eventType==='MARRIAGE_REGISTER')).toHaveLength(0)
      expect(r.world.legal.marriages).toEqual(world.legal.marriages)
    }
  })
  it('同じ人数枠の再使用・欠けた出典・個別記録の上限違反を受け付けない',()=>{
    const invalid=createB001SupportingMarriageEvaluator({...config,maxRecordsPerYear:0})
    expect(invalid).toMatchObject({ok:false})
    const over=createB001SupportingMarriageEvaluator({...config,maxAliveSupporting:0})
    expect(over).toMatchObject({ok:false})
    const duplicated={...cohort,cohortId:'synthetic:alias-of-cohort'}
    const colliding=createB001SupportingMarriageEvaluator({...config,cohorts:[cohort,duplicated]})
    expect(colliding.ok).toBe(true) // コホート照合は実WorldState時点で評価
    if(colliding.ok){
      expect(()=>runYear(world,{seed:SEED,evaluators:{'B-001':colliding.evaluator}})).not.toThrow()
      const result=runYear(world,{seed:SEED,evaluators:{'B-001':colliding.evaluator}})
      expect(result.status).toBe('HALTED')
    }
  })
})
