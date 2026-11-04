// Issue #83: 実1250〜1350年C004履歴→SUPPORTING人口候補→婚姻法制→GoalをA0/A1で実測。
// CALIBRATION_ONLY: 抽出から王朝存続・婚姻成功を強制せず、全37 TODOをIMPLEMENTEDとは見なさない。
import { describe,expect,it } from 'vitest'
import { createExperimentalWorld,createExperimentalOrdinaryLegalTrial,NALVEN_DYNASTY_ID } from '../../../src/scenario/experimental/index.ts'
import type { StatModifier,WorldState } from '../../../src/simulation/contracts/index.ts'
import { runTimeline } from '../../../src/simulation/engine/index.ts'
import { createAutonomousCalibrationEvaluators } from '../../../src/simulation/autonomy/index.ts'
import type { AutonomyCalibration } from '../../../src/simulation/autonomy/index.ts'
import { createRootBranch,forkHistory } from '../../../src/simulation/branching/index.ts'
import { evaluateGoal } from '../../../src/simulation/goal.ts'
import type { SupportingMarriageCohort } from '../../../src/simulation/population/supporting-marriage.ts'
import { TRUST_BOOST,P4,P5 } from './b004-branch-fixture.ts'

const trial=createExperimentalOrdinaryLegalTrial()
const initial=createExperimentalWorld()
const world:WorldState={...initial,demographics:{
  ...initial.demographics,anonymousBirthHistory:[],
}}
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
const AUTO:AutonomyCalibration={
  status:'CALIBRATION_ONLY',
  birth:{minMotherAge:18,maxMotherAge:32,minFatherAge:18,chancePermille:1000},
  death:{minAge:60,riskStartAge:59,basePermille:0,increasePerYearPermille:1000,maxPermille:1000},
  marriage:{minAdultAge:18,maxCandidatePairs:500},
}
const START=1250, END=1350, SEED=20260101
const EARLY_BOOST:StatModifier={
  ...TRUST_BOOST,modifierId:'trial:dec061:trust-1250',interventionId:'trial:dec061:int-1250',
  startYear:1250,endExclusiveYear:1255,
}
function make(w:WorldState,ledger:readonly StatModifier[]){
  const result=createAutonomousCalibrationEvaluators({
    branchStartWorld:w,ledger,
    trustBase:[{personIds:[P4,P5],value:10}],
    nextgenMarriage:{book:trial.book,laws:trial.laws},
    reviewedLegal:{book:trial.book,ordinaryLaws:trial.laws},
    supportingMarriage:{
      cohorts,maxRecordsPerYear:1,maxAliveSupporting:3,perCohortSamples:1,maximumPreviewAge:75,
    },
    autonomy:AUTO,
  })
  if(!result.ok)throw new Error('DEC061_EVALUATORS:'+result.issues.join(','))
  return result.evaluators
}
const baseEvaluators=make(world,[])
const root=runTimeline(world,{seed:SEED,branchId:'A0',evaluators:baseEvaluators,
  technicalGoalEvaluation:true,goal:{dynastyId:NALVEN_DYNASTY_ID}})
const rootBranch=createRootBranch(root,[],baseEvaluators)
const fork=rootBranch.ok?forkHistory({
  parent:rootBranch.branch,forkYear:1250,branchId:'A1',
  modifiers:[EARLY_BOOST],evaluatorsFor:({ledger})=>make(world,ledger),
}):null

const quantify=(r:Readonly<Pick<typeof root,'snapshots'|'eventLog'|'decisionTraces'>>)=>{
  const supporting=new Set(r.snapshots.at(-1)?.persons.filter(p=>p.interactionRole==='SUPPORTING')
    .map(p=>p.personId)??[])
  const events=r.eventLog
  const latePairs=r.decisionTraces.filter(t=>t.year>=1290&&t.ruleId==='B-004'&&
    t.actorRef.kind==='PERSON_PAIR'&&t.actorRef.ids.some(id=>supporting.has(id))).length
  const marriages=events.filter(e=>e.eventType==='MARRIAGE_REGISTER').length
  const births=events.filter(e=>e.eventType==='PERSON_BIRTH').length
  const legal=events.filter(e=>e.eventType==='LEGAL_DYNASTY_SET').length
  return {
    supportingRegistered:events.filter(e=>e.eventType==='PERSON_SUPPORTING_RECORD').length,
    lateSupportingB004Pairs:latePairs,marriages,births,legalDynastySets:legal,
    successionCases:events.filter(e=>e.eventType==='LEGAL_CASE_SET').length,
    titleTransfers:events.filter(e=>e.eventType==='LEGAL_TITLE_TRANSFER').length,
    technicalGoal:evaluateGoal(r.snapshots.at(-1)!,{dynastyId:NALVEN_DYNASTY_ID}).status,
  }
}

describe('Issue #83: C004由来補助婚姻供給と厳格Goalの100年A0/A1実測',()=>{
  it('1250から1350まで同seedでA0/A1の両方が実再計算し、結果を偽造しない',()=>{
    expect(root.status).toBe('COMPLETED')
    expect(root.snapshots).toHaveLength(101)
    expect(rootBranch.ok).toBe(true)
    expect(fork?.ok).toBe(true)
    if(!fork?.ok)return
    const a1=fork.branch
    expect(a1.status).toBe('COMPLETED')
    expect(a1.snapshots).toHaveLength(101)
    expect(a1.snapshots[0]).toEqual(root.snapshots[0])
    for(const history of [root,a1]){
      const end=history.snapshots.at(-1)!
      expect(end.year).toBe(END)
      expect(history.goal).toBeNull()
      expect(end.demographics.cohortSlots).toEqual([])
      expect(end.demographics.anonymousBirthHistory?.some(s=>s.year===1260)).toBe(true)
      expect(end.demographics.anonymousBirthHistory?.some(s=>s.year===1280)).toBe(true)
    }
    expect(root.autonomousHistory.status).toBe('NOT_ESTABLISHED')
    expect(root.coverage.todoRuleIds).toHaveLength(37)
    expect(root.technicalGoal).toEqual(
      evaluateGoal(root.snapshots.at(-1)!,{dynastyId:NALVEN_DYNASTY_ID}))
    const a0Metrics=quantify(root),a1Metrics=quantify(a1)
    // 少なくとも試験A0で補助Personが実WorldStateに記録されることを実証する。
    expect(a0Metrics.supportingRegistered).toBeGreaterThan(0)
    expect(root.snapshots.at(-1)!.persons.some(p=>p.interactionRole==='SUPPORTING')).toBe(true)
    // 件数・結果は事前固定せず、診断としてCIに残す（実測・非権威）。
    console.info('DEC061_CALIBRATION_ONLY_100YEAR_METRICS',
      JSON.stringify({seed:SEED,A0:a0Metrics,A1:a1Metrics}))
  },120000)
})
