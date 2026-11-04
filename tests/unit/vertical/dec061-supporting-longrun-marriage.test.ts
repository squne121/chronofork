// Issue #83 R01: 過去年C004→禁親証拠のあるSUPPORTING→B005交渉→A婚姻→実出生を1250〜1350年実計算。
// CALIBRATION_ONLYの技術試験であり、正式世界/勝利/史料を固定していない。
import {describe,expect,it} from 'vitest'
import {createExperimentalWorld,createExperimentalOrdinaryLegalTrial,NALVEN_DYNASTY_ID}
  from '../../../src/scenario/experimental/index.ts'
import type {WorldState} from '../../../src/simulation/contracts/index.ts'
import {runTimeline} from '../../../src/simulation/engine/index.ts'
import {evaluateGoal} from '../../../src/simulation/goal.ts'
import {createCalibrationEvaluators} from '../../../src/simulation/rules/c/index.ts'
import {EXPERIMENTAL_TUNING} from '../../../src/simulation/tuning.ts'
import {
  createB001SupportingMarriageEvaluator,createB002WorldStateEvaluator,
  createB004WorldStateEvaluator,createB005NextgenEvaluator,
} from '../../../src/simulation/rules/b/index.ts'
import {createALeg01NextgenEvaluator,createADyn02EvidenceEvaluator}
  from '../../../src/simulation/rules/a/index.ts'
import {createPairTrustView} from '../../../src/simulation/intervention/index.ts'
import {EXPERIMENTAL_AUTONOMY} from '../../../src/simulation/autonomy/index.ts'
import type {SupportingMarriageCohort} from '../../../src/simulation/population/supporting-marriage.ts'
import {supportingCandidateId} from '../../../src/simulation/population/supporting-marriage.ts'
import type {SupportingKinshipClearance} from '../../../src/simulation/rules/a/index.ts'

const seed=291001
const initial=createExperimentalWorld()
const world:WorldState={...initial,demographics:{
  ...initial.demographics,anonymousBirthHistory:[],
}}
const trial=createExperimentalOrdinaryLegalTrial()
const cohort:SupportingMarriageCohort={
  cohortId:'trial:R01:year1250:east-female',
  groupId:'group-east-elite',affiliationHouseId:'house-cardon',
  familyPoolId:'trial:R01:separate-survivor-family',
  tier:'REGIONAL_LOWER_NOBILITY',sex:'FEMALE',birthYear:1250,memberCount:1,
  source:'C004_COHORT',sourceEvidenceId:'trial:R01:real-c004-1250',
  survivorAttestationId:'trial:R01:independent-adult-survivor-1268',
  provenance:'CALIBRATION_ONLY',
}
const supportingId=supportingCandidateId(cohort.cohortId,0)
const pair=['person-exp-02',supportingId].sort() as [string,string]
const clearance:SupportingKinshipClearance={
  clearanceId:'trial:R01:separate-kinship-review-1268',
  personIds:pair,countryId:'country-eldia',
  checkedYear:1268,validUntilYear:1270,
  sourceEvidenceId:'trial:R01:kinship-source-distinct-from-census',
  provenance:'CALIBRATION_ONLY',
}
const supplied=createB001SupportingMarriageEvaluator({
  cohorts:[cohort],maxRecordsPerYear:1,maxAliveSupporting:1,
  perCohortSamples:1,maximumPreviewAge:60,
})
if(!supplied.ok)throw new Error('R01_LONGRUN_SUPPLY_INVALID')
const b001=supplied.evaluator
// この「将来の匿名者との信頼ベース」はテスト専用に明示注入した関係校正値であり
// 史実関係・人物の存在・婚姻成功を予めWorldStateへ登録するものではない。
const trust=createPairTrustView({
  base:[{personIds:pair,value:40}],ledger:[],
  knownPersonIds:new Set([...initial.persons.map(p=>p.personId),supportingId]),
})
if(!trust.ok)throw new Error('R01_LONGRUN_TRUST_INVALID')
const view=trust.view
const auto={...EXPERIMENTAL_AUTONOMY,birth:{
  ...EXPERIMENTAL_AUTONOMY.birth,
  minMotherAge:18,maxMotherAge:20,minFatherAge:18,chancePermille:1000,
}}
function evaluators(clearances:readonly SupportingKinshipClearance[]){
  const legal=createALeg01NextgenEvaluator({book:trial.book,laws:trial.laws,
    supportingKinshipClearances:clearances})
  if(!legal.ok)throw new Error('R01_LONGRUN_LEGAL_INVALID:'+legal.issues.join(','))
  return {
    ...createCalibrationEvaluators(EXPERIMENTAL_TUNING),
    'B-001':b001,
    'B-002':createB002WorldStateEvaluator(auto),
    'A-DYN-02':createADyn02EvidenceEvaluator(),
    'B-004':createB004WorldStateEvaluator(view,auto),
    'B-005':createB005NextgenEvaluator(undefined,clearances),
    'A-LEG-01':legal.evaluator,
  }
}
function history(clearances:readonly SupportingKinshipClearance[]){
  return runTimeline(world,{
    seed,branchId:'R01-evidence:'+clearances.length,
    evaluators:evaluators(clearances),
    technicalGoalEvaluation:true,goal:{dynastyId:NALVEN_DYNASTY_ID},
  })
}
const events=(result:ReturnType<typeof history>,type:string)=>result.eventLog
  .filter(e=>e.eventType===type)
const pairIs=(ids:readonly string[],other:readonly string[])=>ids.join('|')===other.join('|')

describe('R01: 同じ1250〜1350年の実年次計算で補助婚姻と子の記録を検証',()=>{
  const withProof=history([clearance])
  const withoutProof=history([])
  it('別の禁親証拠がある場合のみ1268年にSUPPORTINGを婚姻し、その後B002で実出生する',()=>{
    expect(withProof.status).toBe('COMPLETED')
    expect(withProof.snapshots).toHaveLength(101)
    expect(withProof.snapshots.at(-1)?.year).toBe(1350)
    const b001Event=events(withProof,'PERSON_SUPPORTING_RECORD')
    const marriages=events(withProof,'MARRIAGE_REGISTER')
    const births=events(withProof,'PERSON_BIRTH')
    expect(b001Event).toHaveLength(1)
    expect(b001Event[0]?.year).toBe(1268)
    const marriage=withProof.snapshots.at(-1)!.legal.marriages.find(
      m=>pairIs(m.personIds,pair))
    expect(marriage).toBeDefined()
    expect(marriage?.registeredYear).toBe(1268)
    const registered=marriages.find(e=>e.year===1268&&e.involvedRefs.some(ref=>
      ref.kind==='PERSON_PAIR'&&pairIs(ref.ids,pair)))
    expect(registered).toBeDefined()
    const b005=withProof.decisionTraces.find(t=>t.year===1268&&t.ruleId==='B-005'&&
      t.actorRef.kind==='PERSON_PAIR'&&pairIs(t.actorRef.ids,pair))
    expect(b005?.status).toBe('ACCEPT')
    expect(b005?.candidates[0]?.inputs.supportingKinshipClearanceId).toBe(clearance.clearanceId)
    expect(withProof.decisionTraces.some(t=>t.year===1268&&t.ruleId==='A-LEG-01'&&
      t.status==='ACCEPT'&&t.actorRef.kind==='PERSON_PAIR'&&pairIs(t.actorRef.ids,pair))).toBe(true)
    const children=withProof.snapshots.at(-1)!.persons.filter(p=>
      p.fatherId==='person-exp-02'&&p.motherId===supportingId)
    expect(children.length).toBeGreaterThan(0)
    expect(births.some(e=>e.year===1269)).toBe(true)
    expect(children.every(p=>p.birthYear>=1269&&p.interactionRole!=='SUPPORTING')).toBe(true)
    const contractDynasty=marriage?.contract?.clauses.find(
      c=>c.kind==='CHILD_LEGAL_DYNASTY')?.dynastyId
    if(contractDynasty)expect(children.every(p=>
      p.legalDynasty.status==='DETERMINED'&&p.legalDynasty.dynastyId===contractDynasty)).toBe(true)
    else expect(children.every(p=>p.legalDynasty.status==='UNDETERMINED')).toBe(true)
    expect(withProof.snapshots.at(-1)!.groups.map(g=>g.population)).toEqual(
      withoutProof.snapshots.at(-1)!.groups.map(g=>g.population))
    const final=withProof.snapshots.at(-1)!
    expect(withProof.goal).toBeNull()
    expect(withProof.autonomousHistory.status).toBe('NOT_ESTABLISHED')
    expect(withProof.technicalGoal).toEqual(evaluateGoal(final,{dynastyId:NALVEN_DYNASTY_ID}))
    console.info('R01_SUPPORTING_LONGRUN_CALIBRATION_ONLY',JSON.stringify({
      seed,years:withProof.transitions,supportRecordYear:b001Event[0]?.year,
      legalMarriageYear:marriage?.registeredYear,
      childBirthYears:children.map(p=>p.birthYear),contractDynasty:contractDynasty??null,
      actualGoal:withProof.technicalGoal?.status,
    }))
  })
  it('同一の100年条件で禁親確認証拠が無ければB005 DEFER、A婚姻・B002子は発生しない',()=>{
    expect(withoutProof.status).toBe('COMPLETED')
    expect(withoutProof.snapshots).toHaveLength(101)
    const deferred=withoutProof.decisionTraces.find(t=>t.year===1268&&t.ruleId==='B-005'&&
      t.actorRef.kind==='PERSON_PAIR'&&pairIs(t.actorRef.ids,pair))
    expect(deferred?.status).toBe('DEFER')
    expect(deferred?.reasonCodes).toContain('SUPPORTING_KINSHIP_CLEARANCE_MISSING')
    expect(events(withoutProof,'MARRIAGE_REGISTER')).toHaveLength(0)
    expect(withoutProof.snapshots.at(-1)!.persons.some(p=>p.motherId===supportingId)).toBe(false)
    expect(withoutProof.goal).toBeNull()
  })
},120000)
