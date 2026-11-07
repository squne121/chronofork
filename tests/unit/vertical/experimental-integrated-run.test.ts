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
  INTEGRATED_PROMOTION,INTEGRATED_AUTONOMY} from '../../../src/scenario/experimental/index.ts'
import {createAutonomousCalibrationEvaluators} from '../../../src/simulation/autonomy/index.ts'
import {runYear} from '../../../src/simulation/engine/index.ts'
import type {WorldState,StatModifier} from '../../../src/simulation/contracts/index.ts'
import {EXPERIMENTAL_NEXTGEN_CONTRACT} from '../../../src/simulation/legal/nextgen-contract.ts'
import {EXPERIMENTAL_B009_CALIBRATION} from '../../../src/simulation/rules/b/index.ts'

const P2='person-exp-02',P5='person-exp-05'
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
        personIds:[INTEGRATED_WITNESSED_SON_ID,INTEGRATED_SUPPORTING_PERSON_ID],
        countryId:'country-eldia',checkedYear:1278,validUntilYear:1320,
        sourceEvidenceId:'trial:issue71:person-level-lineage-record-distinct-from-C004-and-survivor',
        provenance:'CALIBRATION_ONLY'}]},
    reviewedLegal:{book:trial.book,ordinaryLaws:trial.laws},
    spouseDeathDissolution:true,promotion:INTEGRATED_PROMOTION,
    supportingMarriage:{cohorts:INTEGRATED_SUPPORTING_COHORTS,maxRecordsPerYear:1,
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
