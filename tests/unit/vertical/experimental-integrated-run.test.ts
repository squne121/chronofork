// 共通実行構成(src/scenario/experimental/integrated-run.ts)の同一性検証。
// PR #78(Issue #71)の100年試験が試験内に直書きしている構成を独立の控えとして持ち、
// 共通入口が同じ設定を生成することを短い実計算区間(1250〜1252)で照合する。CALIBRATION_ONLY。
import {readFileSync} from 'node:fs'
import {describe,expect,it} from 'vitest'
import {createExperimentalWorld,createExperimentalOrdinaryLegalTrial,
  createExperimentalIntegratedWorld,createExperimentalIntegratedEvaluators,
  createExperimentalIntegratedTimelineOptions,
  INTEGRATED_SEED,INTEGRATED_TRUST_REDUCTION,INTEGRATED_SUPPORTING_CLEARANCES,
  INTEGRATED_SUPPORTING_COHORTS,INTEGRATED_SUPPORTING_PERSON_ID,INTEGRATED_WITNESSED_SON_ID,
  INTEGRATED_PROMOTION,INTEGRATED_AUTONOMY,INTEGRATED_TRUST_BASE,
  INTEGRATED_NEXTGEN_CONTRACT,INTEGRATED_B009_CALIBRATION} from '../../../src/scenario/experimental/index.ts'
import {createAutonomousCalibrationEvaluators} from '../../../src/simulation/autonomy/index.ts'
import {runYear} from '../../../src/simulation/engine/index.ts'
import type {WorldState,StatModifier} from '../../../src/simulation/contracts/index.ts'
import {EXPERIMENTAL_NEXTGEN_CONTRACT} from '../../../src/simulation/legal/nextgen-contract.ts'
import {EXPERIMENTAL_B009_CALIBRATION} from '../../../src/simulation/rules/b/index.ts'

const P2='person-exp-02',P5='person-exp-05'
// PR #78 直書きの控え(src/の定数を再利用しない独立値)。
const REF_SUPPORTING_ID='support:population:["trial:issue71:C004:1260:east-female",0]'
const REF_SON_ID='person:b002:auto:[1252,"marriage:normal:[1250,\\"[\\\\\\"person-exp-02\\\\\\",\\\\\\"person-exp-05\\\\\\"]\\"]","person-exp-02","person-exp-05"]'
const REF_COHORT={cohortId:'trial:issue71:C004:1260:east-female',groupId:'group-east-elite',
  affiliationHouseId:'house-cardon',familyPoolId:'trial:issue71:independently-attested-cardon-unrelated-family',
  tier:'REGIONAL_LOWER_NOBILITY',sex:'FEMALE',birthYear:1260,memberCount:1,source:'C004_COHORT',
  sourceEvidenceId:'trial:issue71:C004:1260:east',
  survivorAttestationId:'trial:issue71:separate-survivor-census:1278:east',provenance:'CALIBRATION_ONLY'}
const REF_PROMOTION={
  cohorts:[{cohortId:'experimental-census:birth-1249-east-commons',groupId:'group-east-commons',
    birthYear:1249,memberCount:3,recordedYear:1249,
    censusEvidenceId:'experimental-census:pre1250-age-group-evidence',provenance:'CALIBRATION_ONLY'}],
  identities:[{identityEvidenceId:'experimental-identity:cardon-person-1249',
    cohortId:'experimental-census:birth-1249-east-commons',memberOrdinal:0,
    personId:'person:experimental-census:east-cardon-1249',
    personName:'実験用の記名候補（史実・正式設定ではない）',sex:'FEMALE',houseId:'house-cardon',
    recordedYear:1249,provenance:'CALIBRATION_ONLY'}]}
/** PR #78 の dec058-integrated-100year-audit.test.ts 直書き構成の控え(独立検算用)。 */
function referenceEvaluators(startWorld:WorldState,ledger:readonly StatModifier[]){
  const trial=createExperimentalOrdinaryLegalTrial()
  const cfg=createAutonomousCalibrationEvaluators({
    branchStartWorld:startWorld,ledger,trustBase:[{personIds:[P2,P5],value:80}],
    nextgenMarriage:{book:trial.book,laws:trial.laws,
      calibration:{...EXPERIMENTAL_NEXTGEN_CONTRACT,ownDynastyBonus:2,otherDynastyCost:0,
        titleWeight:4,noClauseCost:5,supportWeight:0},
      supportingKinshipClearances:[{
        clearanceId:'trial:issue71:independent-kinship-check:1278',
        personIds:[REF_SON_ID,REF_SUPPORTING_ID],
        countryId:'country-eldia',checkedYear:1278,validUntilYear:1320,
        sourceEvidenceId:'trial:issue71:person-level-lineage-record-distinct-from-C004-and-survivor',
        provenance:'CALIBRATION_ONLY'}]},
    reviewedLegal:{book:trial.book,ordinaryLaws:trial.laws},
    spouseDeathDissolution:true,promotion:REF_PROMOTION as never,
    supportingMarriage:{cohorts:[REF_COHORT as never],maxRecordsPerYear:1,
      maxAliveSupporting:1,perCohortSamples:1,maximumPreviewAge:65},
    autonomy:{status:'CALIBRATION_ONLY',
      birth:{minMotherAge:18,maxMotherAge:32,minFatherAge:18,chancePermille:1000},
      death:{minAge:60,riskStartAge:59,basePermille:0,increasePerYearPermille:1000,maxPermille:1000},
      marriage:{minAdultAge:18,maxCandidatePairs:1600}},
    b009Calibration:{...EXPERIMENTAL_B009_CALIBRATION,initialTrust:25,annualDelta:1,
      houseSupportWeight:2,sameHouseBonus:10,maxPairs:1600},
  })
  if(!cfg.ok)throw new Error(cfg.issues.join('; '))
  return cfg.evaluators
}
function runYears(world:WorldState,make:(w:WorldState)=>ReturnType<typeof referenceEvaluators>,years:number){
  const ev=make(world)
  let w=world
  const out:unknown[]=[]
  for(let i=0;i<years;i++){
    const r=runYear(w,{seed:INTEGRATED_SEED,evaluators:ev})
    expect(r.status,r.status==='HALTED'?JSON.stringify(r.halt):'').toBe('COMPLETED')
    if(r.status!=='COMPLETED')break
    out.push([r.world,r.events,r.traces]);w=r.world
  }
  return JSON.stringify(out)
}

describe('experimental integrated run: 共通実行構成',()=>{
  it('初期世界はC004匿名出生履歴だけ空にした実験世界で、他は変更しない',()=>{
    const base=createExperimentalWorld(),w=createExperimentalIntegratedWorld()
    expect(w.year).toBe(1250)
    expect(w.demographics.anonymousBirthHistory).toEqual([])
    expect({...w,demographics:{...w.demographics,anonymousBirthHistory:undefined}})
      .toEqual({...base,demographics:{...base.demographics,anonymousBirthHistory:undefined}})
  })
  it('校正値・禁親証拠・介入は CALIBRATION_ONLY で、PR #78 の値と一致する',()=>{
    expect(INTEGRATED_AUTONOMY.status).toBe('CALIBRATION_ONLY')
    expect(INTEGRATED_SUPPORTING_CLEARANCES.every(c=>c.provenance==='CALIBRATION_ONLY')).toBe(true)
    expect(INTEGRATED_SUPPORTING_COHORTS).toHaveLength(1)
    expect(INTEGRATED_SUPPORTING_CLEARANCES[0]!.personIds)
      .toEqual([INTEGRATED_WITNESSED_SON_ID,INTEGRATED_SUPPORTING_PERSON_ID])
    expect(INTEGRATED_TRUST_REDUCTION).toMatchObject({signedDelta:-20,startYear:1250,endExclusiveYear:1255,
      statKey:'pair.trust',targetRef:{kind:'PERSON_PAIR',ids:[P2,P5]}})
    const {options}=createExperimentalIntegratedTimelineOptions('x')
    expect(options).toMatchObject({seed:20260101,technicalGoalEvaluation:true,goal:{dynastyId:'dynasty-nalven'}})
  })
  it('SUPPORTING・昇格・ID・係数の実値がPR #78と一致する(1278年経路の固定照合)',()=>{
    expect(INTEGRATED_SUPPORTING_PERSON_ID).toBe(REF_SUPPORTING_ID)
    expect(INTEGRATED_WITNESSED_SON_ID).toBe(REF_SON_ID)
    expect(INTEGRATED_SUPPORTING_COHORTS).toEqual([REF_COHORT])
    expect(INTEGRATED_PROMOTION).toEqual(REF_PROMOTION)
    expect(INTEGRATED_AUTONOMY.marriage.maxCandidatePairs).toBe(1600)
    expect(INTEGRATED_TRUST_BASE).toEqual([{personIds:[P2,P5],value:80}])
    expect(INTEGRATED_NEXTGEN_CONTRACT).toMatchObject({ownDynastyBonus:2,otherDynastyCost:0,
      titleWeight:4,noClauseCost:5,supportWeight:0})
    expect(INTEGRATED_B009_CALIBRATION).toMatchObject({initialTrust:25,annualDelta:1,
      houseSupportWeight:2,sameHouseBonus:10,maxPairs:1600})
    expect(INTEGRATED_SUPPORTING_CLEARANCES[0]).toMatchObject({
      clearanceId:'trial:issue71:independent-kinship-check:1278',checkedYear:1278,validUntilYear:1320})
  })
  it('A0: 共通入口の評価器はPR #78直書き構成と同じ年次結果(世界・Event・Trace)を出す',()=>{
    const world=createExperimentalIntegratedWorld()
    expect(runYears(world,w=>createExperimentalIntegratedEvaluators(w,[]),3))
      .toBe(runYears(world,w=>referenceEvaluators(w,[]),3))
  })
  it('A1(fork時): 新ledgerと年初Worldを渡した評価器も直書き構成と一致し、A0とは信頼値が異なる',()=>{
    const world=createExperimentalIntegratedWorld()
    const a1=runYears(world,w=>createExperimentalIntegratedEvaluators(w,[INTEGRATED_TRUST_REDUCTION]),3)
    expect(a1).toBe(runYears(world,w=>referenceEvaluators(w,[INTEGRATED_TRUST_REDUCTION]),3))
    expect(a1).not.toBe(runYears(world,w=>createExperimentalIntegratedEvaluators(w,[]),3))
  })
  it('共通構成は tests/ を import せず、評価器は呼出ごとに独立して生成される',()=>{
    const src=readFileSync(new URL('../../../src/scenario/experimental/integrated-run.ts',import.meta.url),'utf8')
    expect(src).not.toMatch(/from\s+['"][^'"]*tests\//)
    const w=createExperimentalIntegratedWorld()
    expect(createExperimentalIntegratedEvaluators(w,[])).not.toBe(createExperimentalIntegratedEvaluators(w,[]))
  })
})
