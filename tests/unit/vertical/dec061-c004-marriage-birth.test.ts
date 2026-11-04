// Issue #83: C004実出生履歴を出典としたSUPPORTING成年者→禁親確認→婚姻→実出生。
import {describe,expect,it} from 'vitest'
import {createExperimentalWorld,createExperimentalOrdinaryLegalTrial} from '../../../src/scenario/experimental/index.ts'
import type {WorldState} from '../../../src/simulation/contracts/index.ts'
import {runYear} from '../../../src/simulation/engine/index.ts'
import {createCalibrationEvaluators} from '../../../src/simulation/rules/c/index.ts'
import {EXPERIMENTAL_TUNING} from '../../../src/simulation/tuning.ts'
import {createB001SupportingMarriageEvaluator,createB002WorldStateEvaluator,
  createB004WorldStateEvaluator,createB005NextgenEvaluator} from '../../../src/simulation/rules/b/index.ts'
import {createALeg01NextgenEvaluator,createADyn02EvidenceEvaluator} from '../../../src/simulation/rules/a/index.ts'
import {createPairTrustView} from '../../../src/simulation/intervention/index.ts'
import {EXPERIMENTAL_AUTONOMY} from '../../../src/simulation/autonomy/index.ts'
import {supportingCandidateId} from '../../../src/simulation/population/supporting-marriage.ts'
import type {SupportingMarriageCohort} from '../../../src/simulation/population/supporting-marriage.ts'
import type {SupportingKinshipClearance} from '../../../src/simulation/rules/a/index.ts'

const initial=createExperimentalWorld()
const seed=291001
const start:WorldState={...initial,demographics:{cohortSlots:[],anonymousBirthHistory:[]}}
const c4=createCalibrationEvaluators(EXPERIMENTAL_TUNING)
const trial=createExperimentalOrdinaryLegalTrial()
const cohort:SupportingMarriageCohort={
  cohortId:'trial:actual-C004-births-1250-east',groupId:'group-east-elite',
  affiliationHouseId:'house-cardon',familyPoolId:'trial:independently-observed-survivor',
  tier:'REGIONAL_LOWER_NOBILITY',sex:'FEMALE',birthYear:1250,memberCount:1,
  source:'C004_COHORT',sourceEvidenceId:'trial:year-1250-C004-group-east-elite',
  survivorAttestationId:'trial:year-1268-separate-census-alive',
  provenance:'CALIBRATION_ONLY',
}
const id=supportingCandidateId(cohort.cohortId,0)
const p2='person-exp-02'
const pair=[p2,id].sort() as [string,string]
const clearance:SupportingKinshipClearance={
  clearanceId:'trial:unrelated-kinship-check-1268',personIds:pair,countryId:'country-eldia',
  checkedYear:1268,validUntilYear:1270,
  sourceEvidenceId:'trial:distinct-lineage-document',provenance:'CALIBRATION_ONLY',
}
const config={cohorts:[cohort],maxRecordsPerYear:1,maxAliveSupporting:1,perCohortSamples:1,maximumPreviewAge:60}
const supply=createB001SupportingMarriageEvaluator(config)
const supportEvaluator=supply.ok?supply.evaluator:(()=>{throw new Error('SUPPLY_FACTORY')})()
const view=createPairTrustView({base:[{personIds:pair,value:40}],ledger:[],
  knownPersonIds:new Set([...start.persons.map(p=>p.personId),id])})
const trust=view.ok?view.view:(()=>{throw new Error('TRUST_VIEW')})()
const auto={...EXPERIMENTAL_AUTONOMY,birth:{
  ...EXPERIMENTAL_AUTONOMY.birth,minMotherAge:18,maxMotherAge:40,
  minFatherAge:18,chancePermille:1000,
}}
function toAdult():WorldState{
  let w=start
  for(let year=1250;year<1268;year++){
    const next=runYear(w,{seed,evaluators:c4})
    if(next.status!=='COMPLETED')throw new Error('C004_PREP:'+year+JSON.stringify(next.halt))
    w=next.world
  }
  return w
}
function calendar(clearances:readonly SupportingKinshipClearance[]){
  const l=createALeg01NextgenEvaluator({book:trial.book,laws:trial.laws,
    supportingKinshipClearances:clearances})
  if(!l.ok)throw new Error('LEGAL_CONFIG:'+l.issues.join(','))
  return {...c4,'B-001':supportEvaluator,
    'B-004':createB004WorldStateEvaluator(trust,auto),
    'B-005':createB005NextgenEvaluator(undefined,clearances),
    'A-LEG-01':l.evaluator,
    'B-002':createB002WorldStateEvaluator(auto),
    'A-DYN-02':createADyn02EvidenceEvaluator(),
  } as const
}

describe('DEC-061: 過去年C004の匿名出生→非操作配偶者→翌年実出生',()=>{
  it('禁親証拠なしの高得点補助候補が、別の適格KEY候補を順位上占有しない',()=>{
    const alternative='person-exp-05'
    const keyPair=[p2,alternative].sort() as [string,string]
    const competitor=createPairTrustView({
      base:[{personIds:pair,value:90},{personIds:keyPair,value:40}],
      ledger:[],knownPersonIds:new Set([...start.persons.map(p=>p.personId),id]),
    })
    if(!competitor.ok)throw new Error('COMPETING_VIEW_INVALID')
    const r=runYear(toAdult(),{seed,evaluators:{
      ...calendar([]),'B-004':createB004WorldStateEvaluator(competitor.view,auto),
    }})
    expect(r.status).toBe('COMPLETED')
    if(r.status!=='COMPLETED')return
    const b5=r.traces.filter(t=>t.ruleId==='B-005'&&t.actorRef.kind==='PERSON_PAIR')
    const support=b5.find(t=>t.actorRef.kind==='PERSON_PAIR'&&t.actorRef.ids.join('|')===pair.join('|'))
    const key=b5.find(t=>t.actorRef.kind==='PERSON_PAIR'&&t.actorRef.ids.join('|')===keyPair.join('|'))
    expect(support?.status).toBe('DEFER')
    expect(support?.reasonCodes).toContain('SUPPORTING_KINSHIP_CLEARANCE_MISSING')
    expect(key?.status).toBe('ACCEPT')
    expect(r.world.legal.marriages.every(m=>!m.personIds.includes(id))).toBe(true)
  })
  it('別個の禁親証拠がなければ婚姻・出生を登録しない',()=>{
    const r=runYear(toAdult(),{seed,evaluators:calendar([])})
    expect(r.status).toBe('COMPLETED')
    if(r.status!=='COMPLETED')return
    expect(r.events.filter(e=>e.eventType==='PERSON_SUPPORTING_RECORD')).toHaveLength(1)
    expect(r.events.filter(e=>e.eventType==='MARRIAGE_REGISTER')).toHaveLength(0)
    expect(r.world.legal.marriages).toEqual(initial.legal.marriages)
  })
  it('実C004出典で1268年に登録・法的婚姻、1269年に実出生と契約に応じた法的王朝を記録',()=>{
    const adult=toAdult()
    const r=runYear(adult,{seed,evaluators:calendar([clearance])})
    expect(r.status).toBe('COMPLETED')
    if(r.status!=='COMPLETED')return
    const spouse=r.world.persons.find(p=>p.personId===id)
    expect(spouse).toMatchObject({interactionRole:'SUPPORTING',birthYear:1250,
      legalDynasty:{status:'UNDETERMINED'},originGroupId:cohort.groupId})
    const marriage=r.world.legal.marriages.find(m=>m.personIds.join('|')===pair.join('|'))
    expect(marriage?.status).toBe('ACTIVE')
    expect(r.events.some(e=>e.eventType==='MARRIAGE_REGISTER')).toBe(true)
    // 1268年C004の通常人口変化だけが発生し、個別人物の登録で人口は増えない。
    const populationOnly=runYear(adult,{seed,evaluators:c4})
    if(populationOnly.status!=='COMPLETED')throw new Error('C004_COMPARISON')
    expect(r.world.groups).toEqual(populationOnly.world.groups)
    const born=runYear(r.world,{seed,evaluators:calendar([clearance])})
    expect(born.status).toBe('COMPLETED')
    if(born.status!=='COMPLETED')return
    const children=born.world.persons.filter(p=>p.birthYear===1269&&p.fatherId===p2&&p.motherId===id)
    expect(children).toHaveLength(1)
    expect(born.events.some(e=>e.eventType==='PERSON_BIRTH')).toBe(true)
    const contractDynasty=marriage?.contract?.clauses.find(c=>c.kind==='CHILD_LEGAL_DYNASTY')?.dynastyId
    if(contractDynasty){
      expect(children[0]!.legalDynasty).toEqual({status:'DETERMINED',dynastyId:contractDynasty})
      expect(born.events.some(e=>e.eventType==='LEGAL_DYNASTY_SET')).toBe(true)
    }else expect(children[0]!.legalDynasty.status).toBe('UNDETERMINED')
    expect(born.world.persons.find(p=>p.personId===id)?.interactionRole).toBe('SUPPORTING')
  },120000)
})
