// Issue #77 / DEC-058: 統合済み配偶者死亡・B-001昇格・契約婚姻・家系・相続を同一1250〜1350計算で実測。
// 出生年/個人身元/法令・効用はCALIBRATION_ONLY。出生・婚姻・死亡・勝利を固定年に強制しない。
import { describe, expect, it } from 'vitest'
import { createExperimentalWorld, createExperimentalOrdinaryLegalTrial, NALVEN_DYNASTY_ID } from '../../../src/scenario/experimental/index.ts'
import { createAutonomousCalibrationEvaluators } from '../../../src/simulation/autonomy/index.ts'
import type { AutonomyCalibration } from '../../../src/simulation/autonomy/index.ts'
import {attested,supportingCohorts,supportingClearances,supportingPersonId,
  witnessedSonId,withC004BirthHistory} from './issue71-supporting-fixture.ts'
import { runTimeline } from '../../../src/simulation/engine/index.ts'
import { createRootBranch, forkHistory } from '../../../src/simulation/branching/index.ts'
import type { StatModifier, WorldState } from '../../../src/simulation/contracts/index.ts'
import { PAIR_TRUST_STAT_KEY, STAT_MODIFIER_RULE_VERSION } from '../../../src/simulation/contracts/index.ts'
import { auditYearlyHistory } from './issue71-yearly-diagnostics.ts'
import { evaluateGoal } from '../../../src/simulation/goal.ts'
import { observeDynastyContinuity } from '../../../src/ui/dynasty-continuity.ts'
import type { NextgenContractCalibration } from '../../../src/simulation/legal/nextgen-contract.ts'
import { EXPERIMENTAL_NEXTGEN_CONTRACT } from '../../../src/simulation/legal/nextgen-contract.ts'
import { EXPERIMENTAL_B009_CALIBRATION } from '../../../src/simulation/rules/b/index.ts'

const START=1250, END=1350
const P2='person-exp-02',P5='person-exp-05'
const attestedId='person:experimental-census:east-cardon-1249'
const auto:AutonomyCalibration={
  status:'CALIBRATION_ONLY',
  birth:{minMotherAge:18,maxMotherAge:32,minFatherAge:18,chancePermille:1000},
  death:{minAge:60,riskStartAge:59,basePermille:0,increasePerYearPermille:1000,maxPermille:1000},
  // SUPP個別化後の全pair走査で予算上限を越えないよう、校正専用枠だけ拡張。
  marriage:{minAdultAge:18,maxCandidatePairs:1600},
}
const contract:NextgenContractCalibration={
  ...EXPERIMENTAL_NEXTGEN_CONTRACT,
  ownDynastyBonus:2,otherDynastyCost:0,titleWeight:4,
  noClauseCost:5,supportWeight:0,
}
/** 同一seed、同一校正のままP2/P5の信頼のみ負の介入を行う。出生・婚姻・相続成功を固定しない。 */
const trialModifier:StatModifier={
  modifierId:'trial:issue71:pair-trust-minus-20',
  interventionId:'trial:issue71:intervene-1250',
  targetRef:{kind:'PERSON_PAIR',ids:[P2,P5]},
  statKey:PAIR_TRUST_STAT_KEY,signedDelta:-20,
  startYear:1250,endExclusiveYear:1255,
  decayPolicy:'NONE',ruleVersion:STAT_MODIFIER_RULE_VERSION,
}
// 2×100年の統合試験は所要時間が必須quick-checkの制限を超えるため、
 // tests/CLAUDE.mdに従い通常はSKIP。最新mainでの実走証拠はPR記録のCI #42338475380。
 // 実行: CHRONOFORK_ISSUE71_LONGRUN=1 npm test -- dec058-integrated-100year-audit
const integrationCase=process.env.CHRONOFORK_ISSUE71_LONGRUN==='1'?it:it.skip
describe('DEC-058統合 / 1250〜1350年の家系・婚姻終了・人口昇格・厳格Goal',()=>{
  integrationCase('実Stateから昇格→成人婚姻→孫世代へ進み、1350年の成功/失敗を正確に診断',()=>{
    const world=withC004BirthHistory(createExperimentalWorld())
    expect(world.year).toBe(START)
    const trial=createExperimentalOrdinaryLegalTrial()
    const createEvaluators=(startWorld:WorldState,ledger:readonly StatModifier[])=>{
      const cfg=createAutonomousCalibrationEvaluators({
        branchStartWorld:startWorld,ledger,trustBase:[{personIds:[P2,P5],value:80}],
        nextgenMarriage:{book:trial.book,laws:trial.laws,calibration:contract,
          supportingKinshipClearances:supportingClearances},
        reviewedLegal:{book:trial.book,ordinaryLaws:trial.laws},
        spouseDeathDissolution:true,promotion:attested,
        supportingMarriage:{cohorts:supportingCohorts,maxRecordsPerYear:1,
          maxAliveSupporting:1,perCohortSamples:1,maximumPreviewAge:65},
        autonomy:auto,
        b009Calibration:{...EXPERIMENTAL_B009_CALIBRATION,
          initialTrust:25,annualDelta:1,houseSupportWeight:2,sameHouseBonus:10,maxPairs:1600},
      })
      if(!cfg.ok)throw new Error('INVALID_INTEGRATED_EVALUATORS:'+cfg.issues.join('; '))
      return cfg.evaluators
    }
    const evaluators=createEvaluators(world,[])
    const result=runTimeline(world,{
      seed:20260101,branchId:'A0-integrated-evidence',evaluators,
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
    // C004匿名出生履歴(1260) → B001 SUPPORTING少数登録 → B004/B005 → A-LEG01 → B002/A-DYN02。
    // 成功を仮定せず、全段階を元のEvent/Trace/WorldStateから観測して比較する。
    const supportRecords=result.eventLog.filter(e=>e.eventType==='PERSON_SUPPORTING_RECORD')
    const supportedPerson=final.persons.find(p=>p.personId===supportingPersonId)
    const witnessedSon=final.persons.find(p=>p.personId===witnessedSonId)
    const supportingPairTraces=result.decisionTraces.filter(t=>t.ruleId==='B-005'&&
      t.actorRef.kind==='PERSON_PAIR'&&t.actorRef.ids[0]===witnessedSonId&&
      t.actorRef.ids[1]===supportingPersonId)
    const supportedMarriage=final.legal.marriages.find(m=>
      m.personIds.includes(witnessedSonId)&&m.personIds.includes(supportingPersonId))
    const supportingChildren=final.persons.filter(p=>
      p.fatherId===witnessedSonId&&p.motherId===supportingPersonId)
    const evidenceYears=final.demographics.anonymousBirthHistory?.filter(s=>
      s.groupId==='group-east-elite'&&s.year===1260)??[]
    const supportingStatus={
      cohortId:supportingCohorts[0]!.cohortId,
      supportingPersonId,confirmedKinshipRecordId:supportingClearances[0]!.clearanceId,
      sourceBirthYear:1260,backing:evidenceYears.map(e=>e.anonymousBirths),
      recordYears:supportRecords.map(e=>e.year),
      supportingRole:supportedPerson?.interactionRole??'UNRECORDED',
      witnessedSonBorn:witnessedSon?.birthYear??null,
      witnessedSonSex:witnessedSon?.sex??null,
      b005Yearly: supportingPairTraces.map(t=>({year:t.year,status:t.status,
        reasons:t.reasonCodes,clearanceId:t.candidates[0]?.inputs.supportingKinshipClearanceId??null})),
      legalMarriageYear:supportedMarriage?.registeredYear??null,
      marriageB002Children:supportingChildren.map(p=>({birthYear:p.birthYear,
        dynastyStatus:p.legalDynasty.status,
        dynastyId:p.legalDynasty.status==='DETERMINED'?p.legalDynasty.dynastyId:null})),
      lastBorn:Math.max(0,...supportingChildren.map(p=>p.birthYear)),
    }
    console.info('CHRONOFORK_ISSUE71_SUPPORTING_CHAIN='+JSON.stringify(supportingStatus))
    expect(evidenceYears).toHaveLength(1)
    expect(evidenceYears[0]!.anonymousBirths).toBeGreaterThan(0)
    expect(supportRecords.length).toBeGreaterThan(0)
    expect(supportedPerson?.interactionRole).toBe('SUPPORTING')
    expect(witnessedSon).toMatchObject({birthYear:1252,sex:'MALE'})
    expect(supportingPairTraces.length).toBeGreaterThan(0)
    // 同一人物の禁親確認なしでの合法婚姻や、補助人物の直接操作昇格は作らない。
    if(supportedMarriage){
      expect(supportingPairTraces.some(t=>t.status==='ACCEPT'&&
        t.candidates[0]?.inputs.supportingKinshipClearanceId===
          supportingClearances[0]!.clearanceId)).toBe(true)
      const childDynasty=supportedMarriage.contract?.clauses.find(c=>
        c.kind==='CHILD_LEGAL_DYNASTY')?.dynastyId
      if(childDynasty)expect(supportingChildren.every(p=>
        p.legalDynasty.status==='DETERMINED'&&p.legalDynasty.dynastyId===childDynasty)).toBe(true)
    }else{
      expect(supportingChildren).toHaveLength(0)
    }

    const audit={
      provenance:'CALIBRATION_ONLY',seed:20260101,fromYear:START,toYear:END,
      supportingMarriageC004:true,supportingRecords:supportRecords.length,
      supportingMarriages:supportedMarriage?1:0,supportingChildren:supportingChildren.length,
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

    // Issue #71: 生存者・候補・相続審査・Title・委任を101個の年初snapshotから読み取る。
    // B-005/A-SUC-04等の理由は本当に発生したDecisionTraceからのみ取得する。
    const a0=auditYearlyHistory(result,NALVEN_DYNASTY_ID)
    const parent=createRootBranch(result,[],evaluators)
    expect(parent.ok).toBe(true)
    if(!parent.ok)return
    const fork=forkHistory({
      parent:parent.branch,branchId:'A1-issue71-trust-reduced',forkYear:1250,
      modifiers:[trialModifier],
      evaluatorsFor:({ledger})=>createEvaluators(world,ledger),
    })
    expect(fork.ok).toBe(true)
    if(!fork.ok)return
    const a1Result=fork.branch
    expect(a1Result.status,a1Result.halt?.message??'').toBe('COMPLETED')
    expect(a1Result.seed).toBe(result.seed)
    expect(a1Result.snapshots).toHaveLength(101)
    expect(a1Result.snapshots[0]).toEqual(result.snapshots[0])
    const a1=auditYearlyHistory(a1Result,NALVEN_DYNASTY_ID)
    expect(a0.rows).toHaveLength(101)
    expect(a1.rows).toHaveLength(101)
    expect(a0.rows[0]?.year).toBe(1250)
    expect(a0.rows.at(-1)?.year).toBe(1350)
    expect(a0.rows.at(-1)?.legalNalvenAlive).toBe(
      final.persons.filter(p=>p.alive&&p.legalDynasty.status==='DETERMINED'&&
        p.legalDynasty.dynastyId===NALVEN_DYNASTY_ID).length)
    expect(a0.rows.at(-1)?.titleUndetermined).toBe(
      final.titles.filter(t=>t.kind==='TERRITORIAL'&&t.holder.status==='UNDETERMINED').length)
    expect(a0.goal).toEqual(result.technicalGoal)
    expect(a1.goal).toEqual(evaluateGoal(a1Result.snapshots.at(-1)!,{dynastyId:NALVEN_DYNASTY_ID}))
    expect(a1Result.goal).toBeNull()
    // 現在・未来のイベントを推測しない。各行のEvent/Traceは当年実ログの数に一致。
    for(const [history,report] of [[result,a0],[a1Result,a1]] as const){
      for(const row of report.rows){
        expect(row.eventCount).toBe(history.eventLog.filter(e=>e.year===row.year).length)
        expect(row.traceCount).toBe(history.decisionTraces.filter(t=>t.year===row.year).length)
      }
    }
    console.info('CHRONOFORK_ISSUE71_A0_ANNUAL='+JSON.stringify(a0))
    console.info('CHRONOFORK_ISSUE71_A1_ANNUAL='+JSON.stringify(a1))
    console.info('CHRONOFORK_ISSUE71_A0_A1_SUMMARY='+JSON.stringify({
      provenance:'CALIBRATION_ONLY',seed:result.seed,
      supportingC004:true,
      supportingRecordsA0:result.eventLog.filter(e=>e.eventType==='PERSON_SUPPORTING_RECORD').length,
      supportingRecordsA1:a1Result.eventLog.filter(e=>e.eventType==='PERSON_SUPPORTING_RECORD').length,
      intervention:trialModifier,
      a0:a0.summary,a1:a1.summary,
      exactTechnicalGoalA0:a0.goal,
      exactTechnicalGoalA1:a1.goal,
      autonomousHistory:'NOT_ESTABLISHED',
    }))
    // strict Goal は測定値とだけ比較する。ACHIEVED/NOT_ACHIEVEDを強制しない。
  },900000) // A0/A1の100年間を実再計算する長時間校正。CIで実測後、通常必須から分離する。
})
