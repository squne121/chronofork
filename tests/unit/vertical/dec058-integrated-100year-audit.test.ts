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
import { reviewDomesticMarriageEligibility } from '../../../src/simulation/legal/nextgen-marriage.ts'
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
    // Aggregate evidence is for diagnosis only. It cannot change simulated state.
    const reasonTable=(ruleId:string,fromYear=1250,toYear=1349)=>{
      const counts=new Map<string,number>()
      for(const t of result.decisionTraces){
        if(t.ruleId!==ruleId||t.year<fromYear||t.year>toYear)continue
        const why=t.reasonCodes.at(-1)??'NONE'
        const k=t.status+'/'+why
        counts.set(k,(counts.get(k)??0)+1)
      }
      return [...counts].sort((a,b)=>b[1]-a[1]).slice(0,16).map(([k,n])=>({key:k,count:n}))
    }
    const marriageRecords=final.legal.marriages.map(m=>({
      year:m.registeredYear,ends:m.dissolvedYear??null,pair:m.personIds,
      dynastyClauses:m.contract?.clauses.map(c=>c.dynastyId)??[],
    })).sort((a,b)=>a.year-b.year)
    const descendants=final.persons.filter(p=>p.birthYear>=1250).map(p=>({
      id:p.personId,born:p.birthYear,sex:p.sex,
      dead:p.deathYear??null,father:p.fatherId??null,mother:p.motherId??null,
      dynasty:p.legalDynasty.status==='DETERMINED'?p.legalDynasty.dynastyId:'UNDETERMINED',
    }))
    const deathAges=final.persons.filter(p=>p.deathYear!==undefined)
      .reduce<Record<string,number>>((a,p)=>{const k=String(p.deathYear!-p.birthYear);a[k]=(a[k]??0)+1;return a},{})
    const yearsToAudit=[1250,1267,1275,1280,1290,1300,1310,1320,1330,1340,1349,1350]
    const yearSamples=yearsToAudit.map(y=>{
      const state=result.snapshots.find(w=>w.year===y)!
      const activeMarriageIds=new Set(state.legal.marriages.filter(m=>m.status==='ACTIVE').flatMap(m=>m.personIds))
      const living=state.persons.filter(p=>p.alive)
      const adults=living.filter(p=>y-p.birthYear>=18)
      const available=adults.filter(p=>!activeMarriageIds.has(p.personId))
      const men=available.filter(p=>p.sex==='MALE'),women=available.filter(p=>p.sex==='FEMALE')
      let eligiblePairs=0
      for(const male of men)for(const female of women){
        const pair=(male.personId<female.personId?[male.personId,female.personId]:
          [female.personId,male.personId]) as [string,string]
        if(reviewDomesticMarriageEligibility(state,pair).status==='ELIGIBLE')eligiblePairs++
      }
      return {
        year:y,people:state.persons.length,living:living.length,adults:adults.length,
        unmarriedMen:men.length,unmarriedWomen:women.length,eligiblePairs,
        activeMarriages:state.legal.marriages.filter(m=>m.status==='ACTIVE').length,
        pendingCases:state.legal.cases.filter(c=>c.kind==='SUCCESSION'&&c.status==='PENDING').length,
        validTitleHolders:state.titles.filter(t=>t.kind==='TERRITORIAL'&&t.holder.status==='HELD').length,
      }
    })
    const titleChanges=[] as {year:number,title:string,from:string,to:string}[]
    for(let i=1;i<result.snapshots.length;i++){
      const before=result.snapshots[i-1]!,after=result.snapshots[i]!
      for(const title of after.titles){
        const old=before.titles.find(t=>t.titleId===title.titleId)
        const holder=(x:typeof title)=>x.holder.status==='HELD'?x.holder.personId:'UNDETERMINED'
        if(old&&holder(title)!==holder(old)) titleChanges.push({
          year:after.year-1,title:title.titleId,from:holder(old),to:holder(title),
        })
      }
    }
    const details={
      marriages:marriageRecords,
      descendants:descendants.map(p=>({
        born:p.born,sex:p.sex,dead:p.dead,
        generation:familyChildren.some(c=>c.personId===p.id)?1:
          grandchildren.some(c=>c.personId===p.id)?2:0,
        mother:p.mother===P5?'P5':p.mother===attestedId?'PROMOTED':p.mother?.startsWith('person:b002:')?'CHILD':'OTHER',
      })).sort((a,b)=>a.born-b.born),
      deathAges,yearSamples,titleChanges,
      finalCases:final.legal.cases.map(c=>({title:c.titleId,caseId:c.caseId,
        status:c.status,candidates:c.candidatePersonIds,reasonCodes:c.reasonCodes})),
      b004Reasons:reasonTable('B-004'),
      b005Reasons:reasonTable('B-005'),
      b002Reasons:reasonTable('B-002'),
      b003Reasons:reasonTable('B-003'),
      successionReasons:reasonTable('A-SUC-04'),
      delegationReasons:reasonTable('A-TIT-07'),
      b005LateReasons:reasonTable('B-005',1300,1349),
      successionLateReasons:reasonTable('A-SUC-04',1300,1349),
      bornYears:[Math.min(...descendants.map(p=>p.born)),Math.max(...descendants.map(p=>p.born))],
      aliveByDynasty1350:final.persons.filter(p=>p.alive).map(p=>p.legalDynasty.status==='DETERMINED'?p.legalDynasty.dynastyId:'UNKNOWN'),
    }
    console.info('CHRONOFORK_100YR_CAUSAL_DIAGNOSTIC='+JSON.stringify(details))

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
