// Issue #77 / DEC-058: 統合済み配偶者死亡・B-001昇格・契約婚姻・家系・相続を同一1250〜1350計算で実測。
// 出生年/個人身元/法令・効用はCALIBRATION_ONLY。出生・婚姻・死亡・勝利を固定年に強制しない。
import { describe, expect, it } from 'vitest'
import { createExperimentalWorld, createExperimentalOrdinaryLegalTrial, NALVEN_DYNASTY_ID } from '../../../src/scenario/experimental/index.ts'
import { createAutonomousCalibrationEvaluators } from '../../../src/simulation/autonomy/index.ts'
import type { AutonomyCalibration } from '../../../src/simulation/autonomy/index.ts'
import type { B001PromotionInput } from '../../../src/simulation/rules/b/index.ts'
import { runTimeline } from '../../../src/simulation/engine/index.ts'
import { evaluateGoal } from '../../../src/simulation/goal.ts'
import { observeDynastyContinuity } from '../../../src/ui/dynasty-continuity.ts'
import type { NextgenContractCalibration } from '../../../src/simulation/legal/nextgen-contract.ts'
import { EXPERIMENTAL_NEXTGEN_CONTRACT } from '../../../src/simulation/legal/nextgen-contract.ts'
import { EXPERIMENTAL_B009_CALIBRATION } from '../../../src/simulation/rules/b/index.ts'

const START=1250, END=1350
const P2='person-exp-02',P5='person-exp-05'
const attestedId='person:experimental-census:east-cardon-1249'
const attested:B001PromotionInput={
  cohorts:[{
    cohortId:'experimental-census:birth-1249-east-commons',
    groupId:'group-east-commons',
    birthYear:1249,memberCount:3,recordedYear:1249,
    censusEvidenceId:'experimental-census:pre1250-age-group-evidence',
    provenance:'CALIBRATION_ONLY',
  }],
  identities:[{
    identityEvidenceId:'experimental-identity:cardon-person-1249',
    cohortId:'experimental-census:birth-1249-east-commons',
    memberOrdinal:0,personId:attestedId,
    personName:'実験用の記名候補（史実・正式設定ではない）',
    sex:'FEMALE',houseId:'house-cardon',recordedYear:1249,
    provenance:'CALIBRATION_ONLY',
  }],
}
const auto:AutonomyCalibration={
  status:'CALIBRATION_ONLY',
  birth:{minMotherAge:18,maxMotherAge:32,minFatherAge:18,chancePermille:1000},
  death:{minAge:60,riskStartAge:59,basePermille:0,increasePerYearPermille:1000,maxPermille:1000},
  marriage:{minAdultAge:18,maxCandidatePairs:500},
}
const contract:NextgenContractCalibration={
  ...EXPERIMENTAL_NEXTGEN_CONTRACT,
  ownDynastyBonus:2,otherDynastyCost:0,titleWeight:4,
  noClauseCost:5,supportWeight:0,
}
describe('DEC-058統合 / 1250〜1350年の家系・婚姻終了・人口昇格・厳格Goal',()=>{
  it('実Stateから昇格→成人婚姻→孫世代へ進み、1350年の成功/失敗を正確に診断',()=>{
    const world=createExperimentalWorld()
    expect(world.year).toBe(START)
    const trial=createExperimentalOrdinaryLegalTrial()
    const cfg=createAutonomousCalibrationEvaluators({
      branchStartWorld:world,ledger:[],trustBase:[{personIds:[P2,P5],value:80}],
      nextgenMarriage:{book:trial.book,laws:trial.laws,calibration:contract},
      reviewedLegal:{book:trial.book,ordinaryLaws:trial.laws},
      spouseDeathDissolution:true,promotion:attested,
      autonomy:auto,
      b009Calibration:{...EXPERIMENTAL_B009_CALIBRATION,
        initialTrust:25,annualDelta:1,houseSupportWeight:2,sameHouseBonus:10,maxPairs:500},
    })
    if(!cfg.ok)throw new Error('INVALID_INTEGRATED_EVALUATORS:'+cfg.issues.join('; '))
    const result=runTimeline(world,{
      seed:20260101,branchId:'A0-integrated-evidence',evaluators:cfg.evaluators,
      goal:{dynastyId:NALVEN_DYNASTY_ID},technicalGoalEvaluation:true,
    })
    expect(result.status,result.status==='HALTED'?JSON.stringify(result.halt):'').toBe('COMPLETED')
    if(result.status!=='COMPLETED')return
    expect(result.snapshots).toHaveLength(END-START+1)
    expect(result.snapshots.at(-1)?.year).toBe(END)
    expect(result.goal).toBeNull() // 37 ruleIds TODO。公認勝利と混同しない。
    expect(result.coverage.todoRuleIds).toHaveLength(37)
    const final=result.snapshots.at(-1)!
    const goal=evaluateGoal(final,{dynastyId:NALVEN_DYNASTY_ID})
    expect(result.technicalGoal).toEqual(goal)
    expect(goal.status).not.toBe('INVALID_INPUT')
    expect(goal.status).not.toBe('NOT_EVALUABLE')
    const observation=observeDynastyContinuity(world,result,NALVEN_DYNASTY_ID)
    expect(observation.status).toBe('OBSERVED')
    const promoted=final.persons.find(p=>p.personId===attestedId)
    expect(promoted).toMatchObject({
      alive:false,originGroupId:'group-east-commons',houseId:'house-cardon',
      birthYear:1249,legalDynasty:{status:'UNDETERMINED'},
    })
    const promotionEvents=result.eventLog.filter(e=>e.eventType==='PERSON_PROMOTE')
    const dissolutionEvents=result.eventLog.filter(e=>e.eventType==='MARRIAGE_DISSOLVE')
    const marriages=result.eventLog.filter(e=>e.eventType==='MARRIAGE_REGISTER')
    const births=result.eventLog.filter(e=>e.eventType==='PERSON_BIRTH')
    const legalChildren=result.eventLog.filter(e=>e.eventType==='LEGAL_DYNASTY_SET')
    const transfers=result.eventLog.filter(e=>e.eventType==='LEGAL_TITLE_TRANSFER')
    const mandates=result.eventLog.filter(e=>e.eventType==='CONTROL_MANDATE_SET')
    const familyChildren=final.persons.filter(p=>p.fatherId===P2&&p.motherId===P5)
    const grandchildren=final.persons.filter(p=>p.fatherId!==undefined||p.motherId!==undefined)
      .filter(p=>[p.fatherId,p.motherId].some(parentId=>familyChildren.some(child=>child.personId===parentId)))
    const promotedPairs=result.decisionTraces.filter(t=>t.ruleId==='B-004'&&
      t.actorRef.kind==='PERSON_PAIR'&&t.actorRef.ids.includes(attestedId))
    const audit={
      provenance:'CALIBRATION_ONLY',seed:20260101,fromYear:START,toYear:END,
      timeline:result.status,formalGoal:result.goal,technicalGoalStatus:goal.status,
      legacyRulesUnimplemented:result.coverage.todoRuleIds.length,
      promotionEvents:promotionEvents.length,dissolutionEvents:dissolutionEvents.length,
      marriages:marriages.length,births:births.length,legalDynastyEvents:legalChildren.length,
      titleTransfers:transfers.length,newMandates:mandates.length,
      promotedCandidateYear:promotionEvents[0]?.year??null,
      firstGeneration:familyChildren.length,
      biologicalGrandchildren:grandchildren.length,
      familyDepth:observation.familyDepth,
      legalNalvenDescendants:observation.legalTargetDescendants,
      livingLegalNalven:observation.livingLegalTargetMembers,
      titleAssessments:goal.status==='ACHIEVED'||goal.status==='NOT_ACHIEVED'
        ?goal.assessments.map(t=>({id:t.titleId,qualifies:t.qualifies,failures:t.failures})):[],
    }
    console.info('CHRONOFORK_100YR_INTEGRATION_AUDIT='+JSON.stringify(audit))
    expect(promotionEvents.length).toBeGreaterThanOrEqual(1)
    expect(promotedPairs.length).toBeGreaterThan(0)
    expect(dissolutionEvents.length).toBeGreaterThanOrEqual(1)
    expect(marriages.length).toBeGreaterThan(0)
    expect(births.length).toBeGreaterThan(0)
    expect(legalChildren.length).toBeGreaterThan(0)
    expect(transfers.length).toBeGreaterThan(0)
    expect(mandates.length).toBeGreaterThan(0)
    // 結果の到達度は実親子関係から検証する。新生児や勝敗をテスト用に追加しない。
    expect(observation.familyDepth).toBeGreaterThanOrEqual(2)
    expect(grandchildren.length).toBeGreaterThan(0)
    expect(promotionEvents[0]?.sourceTraceIds.every(id=>result.decisionTraces.some(t=>
      t.traceId===id&&t.eventIds.includes(promotionEvents[0]!.eventId)))).toBe(true)
    expect(dissolutionEvents[0]?.sourceTraceIds.every(id=>result.decisionTraces.some(t=>
      t.traceId===id&&t.eventIds.includes(dissolutionEvents[0]!.eventId)))).toBe(true)
    expect(final.groups.map(g=>g.groupId)).toEqual(world.groups.map(g=>g.groupId))
    expect(final.regions).toEqual(world.regions)
    // strict Goal は測定値とだけ比較する。ACHIEVED/NOT_ACHIEVEDを強制しない。
  },120000)
})
