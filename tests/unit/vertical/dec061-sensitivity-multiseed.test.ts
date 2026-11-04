// Issue #83: 人口候補供給 × 出生・死亡校正値 × seed の長期診断。
// 史実、正式の出生・死亡法則、勝利保証ではない。各結果をCIログへ出し、HALTEDも隠さない。
import {describe,expect,it} from 'vitest'
import {createExperimentalWorld,createExperimentalOrdinaryLegalTrial,NALVEN_DYNASTY_ID}
  from '../../../src/scenario/experimental/index.ts'
import type {StatModifier,WorldState} from '../../../src/simulation/contracts/index.ts'
import {createAutonomousCalibrationEvaluators} from '../../../src/simulation/autonomy/index.ts'
import type {AutonomyCalibration} from '../../../src/simulation/autonomy/index.ts'
import {runTimeline} from '../../../src/simulation/engine/index.ts'
import {evaluateGoal} from '../../../src/simulation/goal.ts'
import type {SupportingMarriageCohort}
  from '../../../src/simulation/population/supporting-marriage.ts'
import {TRUST_BOOST,P4,P5} from './b004-branch-fixture.ts'

const trial=createExperimentalOrdinaryLegalTrial()
const seeds=[20260101,20260102,20260103] as const
const cases=[
  {name:'BASE_FAST_DEATH_HIGH_BIRTH',birth:1000,deathIncrement:1000,deathMax:1000},
  {name:'LOW_BIRTH_FAST_DEATH',birth:300,deathIncrement:1000,deathMax:1000},
  {name:'HIGH_BIRTH_SLOW_DEATH',birth:1000,deathIncrement:120,deathMax:600},
] as const
const cohorts:SupportingMarriageCohort[]=[
  {
    cohortId:'synthetic:C004:1260:east:female',groupId:'group-east-elite',
    affiliationHouseId:'house-cardon',familyPoolId:'synthetic:survivor-house-east:1260',
    tier:'REGIONAL_LOWER_NOBILITY',sex:'FEMALE',birthYear:1260,memberCount:1,
    source:'C004_COHORT',sourceEvidenceId:'synthetic:C004:1260:east',
    survivorAttestationId:'synthetic:census-survivor:1278:east',
    provenance:'CALIBRATION_ONLY',
  },
  {
    cohortId:'synthetic:C004:1280:west:male',groupId:'group-west-elite',
    affiliationHouseId:'house-vargas',familyPoolId:'synthetic:survivor-house-west:1280',
    tier:'REGIONAL_UPPER_NOBILITY',sex:'MALE',birthYear:1280,memberCount:1,
    source:'C004_COHORT',sourceEvidenceId:'synthetic:C004:1280:west',
    survivorAttestationId:'synthetic:census-survivor:1298:west',
    provenance:'CALIBRATION_ONLY',
  },
]
const base=createExperimentalWorld()
const initial:WorldState={
  ...base,
  demographics:{...base.demographics,anonymousBirthHistory:[]},
}
const intervention:StatModifier={
  ...TRUST_BOOST,
  modifierId:'sens:trust-1250',
  interventionId:'sens:intervention-1250',
  startYear:1250,endExclusiveYear:1255,
}
type Config=typeof cases[number]
function make(config:Config,ledger:readonly StatModifier[]){
  const auto:AutonomyCalibration={
    status:'CALIBRATION_ONLY',
    birth:{minMotherAge:18,maxMotherAge:32,minFatherAge:18,
      chancePermille:config.birth},
    death:{minAge:60,riskStartAge:59,basePermille:0,
      increasePerYearPermille:config.deathIncrement,maxPermille:config.deathMax},
    marriage:{minAdultAge:18,maxCandidatePairs:500},
  }
  const r=createAutonomousCalibrationEvaluators({
    branchStartWorld:initial,ledger,
    trustBase:[{personIds:[P4,P5],value:10}],
    nextgenMarriage:{book:trial.book,laws:trial.laws},
    reviewedLegal:{book:trial.book,ordinaryLaws:trial.laws},
    supportingMarriage:{
      cohorts,maxRecordsPerYear:1,maxAliveSupporting:3,
      perCohortSamples:1,maximumPreviewAge:75,
    },
    autonomy:auto,
  })
  if(!r.ok)throw new Error('SENSITIVITY_FACTORY_INVALID:'+r.issues.join(','))
  return r.evaluators
}
const adults=(w:WorldState,role:'KEY'|'SUPPORTING')=>{
  const married=new Set(w.legal.marriages.filter(m=>m.status==='ACTIVE').flatMap(m=>m.personIds))
  const eligible=w.persons.filter(p=>
    p.alive && (role==='KEY'?p.interactionRole!=='SUPPORTING':p.interactionRole==='SUPPORTING') &&
    w.year-p.birthYear>=18 && !married.has(p.personId))
  return {
    male:eligible.filter(p=>p.sex==='MALE').length,
    female:eligible.filter(p=>p.sex==='FEMALE').length,
    total:eligible.length,
  }
}
function snapshotMetrics(r:ReturnType<typeof runTimeline>){
  const w=r.snapshots.at(-1)!
  const at1290=r.snapshots.find(s=>s.year===1290)
  const supportIds=new Set(w.persons.filter(p=>p.interactionRole==='SUPPORTING').map(p=>p.personId))
  const latePairs=r.decisionTraces.filter(t=>t.ruleId==='B-004'&&t.year>=1290&&
    t.actorRef.kind==='PERSON_PAIR'&&t.actorRef.ids.some(id=>supportIds.has(id)))
  const acceptedLate=latePairs.filter(t=>t.status==='ACCEPT').length
  const lateB005=r.decisionTraces.filter(t=>t.ruleId==='B-005'&&t.year>=1290&&t.status==='ACCEPT'&&
    t.actorRef.kind==='PERSON_PAIR'&&t.actorRef.ids.some(id=>supportIds.has(id))).length
  const supportMarriages=w.legal.marriages.filter(m=>m.personIds.some(id=>supportIds.has(id))).length
  const supportChildren=w.persons.filter(p=>
    (p.fatherId!==undefined&&supportIds.has(p.fatherId))||
    (p.motherId!==undefined&&supportIds.has(p.motherId))).length
  const goal=r.status==='COMPLETED'?evaluateGoal(w,{dynastyId:NALVEN_DYNASTY_ID}):null
  const topReasons=goal?.status==='NOT_ACHIEVED'?
    Array.from(new Set(goal.assessments.flatMap(a=>a.failures))).sort():[]
  const counts=(eventType:string)=>r.eventLog.filter(e=>e.eventType===eventType).length
  return {
    status:r.status,
    transitions:r.transitions,
    stop:r.halt?{year:r.halt.year,code:r.halt.code,rule:r.halt.ruleId,
      diagnostics:r.halt.evaluatorDiagnostics.map(d=>d.code).slice(0,3)}:null,
    at1290:at1290?{
      keyAdults:adults(at1290,'KEY'),
      supportingAdults:adults(at1290,'SUPPORTING'),
      keyAlive:at1290.persons.filter(p=>p.alive&&p.interactionRole!=='SUPPORTING').length,
    }:null,
    supportRecords:counts('PERSON_SUPPORTING_RECORD'),
    supportAliveAtEnd:w.persons.filter(p=>p.alive&&p.interactionRole==='SUPPORTING').length,
    lateSupportPairs:latePairs.length,
    lateSupportPairsAccepted:acceptedLate,
    lateSupportB005Accepted:lateB005,
    supportLegalMarriages:supportMarriages,
    supportChildren,
    totalMarriages:counts('MARRIAGE_REGISTER'),
    totalBirths:counts('PERSON_BIRTH'),
    totalDeaths:counts('PERSON_DEATH'),
    legalDynastySets:counts('LEGAL_DYNASTY_SET'),
    goal:goal?.status??'NOT_EVALUATED',
    goalBlockers:topReasons,
  }
}
describe('DEC-061: 複数seed・出生/死亡感度・候補供給の実測（CALIBRATION_ONLY）',()=>{
  it('3 seed × 3校正条件 × A0/A1を実計算しHALTEDも証跡に残す',()=>{
    const results:unknown[]=[]
    for(const scenario of cases)for(const seed of seeds)for(const branch of ['A0','A1'] as const){
      const ledger=branch==='A1'?[intervention]:[]
      const r=runTimeline(initial,{
        seed,branchId:branch,evaluators:make(scenario,ledger),
        goal:{dynastyId:NALVEN_DYNASTY_ID},technicalGoalEvaluation:true,
      })
      const report={
        seed,scenario:scenario.name,birthChancePermille:scenario.birth,
        deathIncreasePerYearPermille:scenario.deathIncrement,
        deathMaxPermille:scenario.deathMax,
        branch,...snapshotMetrics(r),
      }
      results.push(report)
      // 実測したWorldState/Event/Traceだけを出力。勝利/候補数を事前期待値へ固定しない。
      console.info('DEC061_SENSITIVITY_ROW '+JSON.stringify(report))
      expect(r.snapshots.length).toBeGreaterThan(0)
      expect(r.goal).toBeNull()
      if(r.status==='COMPLETED'){
        expect(r.snapshots.at(-1)!.year).toBe(1350)
        expect(r.technicalGoal).toEqual(
          evaluateGoal(r.snapshots.at(-1)!,{dynastyId:NALVEN_DYNASTY_ID}))
      }else expect(r.halt).not.toBeNull()
    }
    expect(results).toHaveLength(seeds.length*cases.length*2)
  },240000)
})
