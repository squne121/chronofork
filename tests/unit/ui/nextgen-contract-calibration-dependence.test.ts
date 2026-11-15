// オプトイン(CHRONOFORK_LONG_A2=1): INTEGRATED_NEXTGEN_CONTRACT(上書き係数, CALIBRATION_ONLY)への依存性の限定検証。
// 読取・実験用。正式係数は変更しない。seed20260101・第1介入1件のみ。複数seedや一般化は主張しない。
// 1) 実際の契約判断時点(1269年のA0)のWorldStateで、統合係数と EXPERIMENTAL_NEXTGEN_CONTRACT 既定係数を比較する。
// 2) 既定係数でA0/A1を短く再計算し(同じ統合構成・同じmodifier)、結果への影響を観測する。
import {describe,it,expect} from 'vitest'
import {runPlayBaseline} from '../../../src/ui/branch-play-source.ts'
import {
 createExperimentalIntegratedWorld,createExperimentalIntegratedEvaluators,createExperimentalOrdinaryLegalTrial,
 INTEGRATED_NEXTGEN_CONTRACT,INTEGRATED_TRUST_BASE,INTEGRATED_SUPPORTING_CLEARANCES,INTEGRATED_PROMOTION,
 INTEGRATED_SUPPORTING_COHORTS,INTEGRATED_AUTONOMY,INTEGRATED_B009_CALIBRATION,INTEGRATED_SEED,INTEGRATED_ATTESTED_PERSON_ID,
 INTEGRATED_WITNESSED_SON_ID,EXPERIMENTAL_NALVEN_GOAL,
} from '../../../src/scenario/experimental/index.ts'
import {EXPERIMENTAL_NEXTGEN_CONTRACT,chooseNextgenContract} from '../../../src/simulation/legal/nextgen-contract.ts'
import type {NextgenContractCalibration} from '../../../src/simulation/legal/nextgen-contract.ts'
import {createAutonomousCalibrationEvaluators} from '../../../src/simulation/autonomy/index.ts'
import {runTimeline} from '../../../src/simulation/engine/index.ts'
import type {EvaluatorMap} from '../../../src/simulation/engine/index.ts'
import {createRootBranch,forkHistory} from '../../../src/simulation/branching/index.ts'
import {evaluateGoal} from '../../../src/simulation/goal.ts'
import {PAIR_TRUST_STAT_KEY,STAT_MODIFIER_RULE_VERSION} from '../../../src/simulation/contracts/index.ts'
import type {StatModifier,WorldState} from '../../../src/simulation/contracts/index.ts'
const YEAR=1269,PAIR=[INTEGRATED_WITNESSED_SON_ID,INTEGRATED_ATTESTED_PERSON_ID] as const
const describeLong=process.env.CHRONOFORK_LONG_A2==='1'?describe:describe.skip
const sorted=[...PAIR].sort()
const key=(ids:readonly string[])=>JSON.stringify([...ids].sort())
const matrix=(c:ReturnType<typeof chooseNextgenContract>)=>c.choices.map(o=>[o.key,o.firstConsentScore,o.secondConsentScore,o.mutuallyAccepted,o.minimumUtility])

/** createExperimentalIntegratedEvaluators と同じ構成で、契約係数だけを差し替える試験用ファクトリ。
 * SUPPORTING供給の上限は integrated-run.ts の非公開定数と同値（下の同等性試験で保証）。 */
function evaluatorsWith(contract:NextgenContractCalibration){
 return (startWorld:WorldState,ledger:readonly StatModifier[]):EvaluatorMap=>{
  const trial=createExperimentalOrdinaryLegalTrial()
  const cfg=createAutonomousCalibrationEvaluators({
   branchStartWorld:startWorld,ledger,trustBase:INTEGRATED_TRUST_BASE,
   nextgenMarriage:{book:trial.book,laws:trial.laws,calibration:contract,supportingKinshipClearances:INTEGRATED_SUPPORTING_CLEARANCES},
   reviewedLegal:{book:trial.book,ordinaryLaws:trial.laws},spouseDeathDissolution:true,promotion:INTEGRATED_PROMOTION,
   supportingMarriage:{cohorts:INTEGRATED_SUPPORTING_COHORTS,maxRecordsPerYear:1,maxAliveSupporting:1,perCohortSamples:1,maximumPreviewAge:65},
   autonomy:INTEGRATED_AUTONOMY,b009Calibration:INTEGRATED_B009_CALIBRATION,
  })
  if(!cfg.ok)throw new Error(cfg.issues.join('; '))
  return cfg.evaluators
 }
}
const runA0=(contract:NextgenContractCalibration)=>{
 const w=createExperimentalIntegratedWorld()
 const timeline=runTimeline(w,{seed:INTEGRATED_SEED,branchId:'A0-calib',evaluators:evaluatorsWith(contract)(w,[]),
  goal:{dynastyId:'dynasty-nalven'},technicalGoalEvaluation:true})
 return {w,timeline}
}
const marriageYears=(r:{eventLog:readonly {year:number;eventType:string}[]})=>r.eventLog.filter(e=>e.eventType==='MARRIAGE_REGISTER').map(e=>e.year)

describeLong('校正依存性: INTEGRATED_NEXTGEN_CONTRACT と EXPERIMENTAL_NEXTGEN_CONTRACT 既定係数（seed20260101, 限定的）',()=>{
 it('1269年の契約判断: 統合係数は唯一の合意(CHILD_DYNASTY:nalven)、既定係数は同率でDEFER。記録されたTraceの選択肢は統合係数の再計算と一致',()=>{
  const base=runPlayBaseline(INTEGRATED_SEED,'INTEGRATED_EXPERIMENTAL')
  if(!base.ok)throw new Error(base.code)
  const a0=base.a0.result
  const world=a0.snapshots.find(w=>w.year===YEAR) as WorldState
  const b5=a0.decisionTraces.find(t=>t.ruleId==='B-005'&&t.year===YEAR&&t.actorRef.kind==='PERSON_PAIR'&&key(t.actorRef.ids)===key(PAIR))!
  const input=b5.candidates[0]!.inputs as {sourceB004Score:number;contractOptions:{key:string;firstConsentScore:number;secondConsentScore:number;mutuallyAccepted:boolean;minimumUtility:number}[]}
  const score=input.sourceB004Score
  expect(b5.status).toBe('ACCEPT')
  const integrated=chooseNextgenContract(world,sorted as unknown as [string,string],score,INTEGRATED_NEXTGEN_CONTRACT)
  const experimental=chooseNextgenContract(world,sorted as unknown as [string,string],score,EXPERIMENTAL_NEXTGEN_CONTRACT)
  // 実Traceの記録(contractOptions)と統合係数の再計算が一致する（再計算の入力が実判断時点のものである確認）。
  // ペア順(first/second)はTraceのactorRefの順序に従わせる。
  const ordered=(b5.actorRef as {ids:readonly [string,string]}).ids
  const integratedOrdered=chooseNextgenContract(world,ordered,score,INTEGRATED_NEXTGEN_CONTRACT)
  const experimentalOrdered=chooseNextgenContract(world,ordered,score,EXPERIMENTAL_NEXTGEN_CONTRACT)
  expect(input.contractOptions.map(o=>[o.key,o.firstConsentScore,o.secondConsentScore,o.mutuallyAccepted,o.minimumUtility]))
   .toEqual(matrix(integratedOrdered))
  // 統合係数: 両者合意の候補が NO_CLAUSE と nalven の2つ。minimumUtility の最大(62)で nalven が唯一の選択。
  expect(integratedOrdered.status).toBe('ACCEPT')
  expect(integratedOrdered.choices.map(o=>[o.key,o.mutuallyAccepted,o.minimumUtility])).toEqual([
   ['NO_CLAUSE',true,53],['CHILD_DYNASTY:dynasty-nalven',true,62]])
  if(integratedOrdered.status==='ACCEPT')expect(integratedOrdered.choice.key).toBe('CHILD_DYNASTY:dynasty-nalven')
  // 既定係数: nalven案の片方の効用が53に下がり NO_CLAUSE(53)と同率 → CONTRACT_CHOICE_TIE で合意不成立(DEFER)。
  expect(experimentalOrdered.status).toBe('DEFER')
  expect(experimentalOrdered.reasonCode).toBe('CONTRACT_CHOICE_TIE')
  expect(experimentalOrdered.choices.map(o=>[o.key,o.mutuallyAccepted,o.minimumUtility])).toEqual([
   ['NO_CLAUSE',true,53],['CHILD_DYNASTY:dynasty-nalven',true,53]])
  // ペア順に依らず選択結果の種別は同じ（順序は両当事者の列の入れ替えだけ）。
  expect(integrated.status).toBe(integratedOrdered.status)
  expect(experimental.status).toBe(experimentalOrdered.status)
 })

 it('試験用ファクトリの同等性: 統合係数で差し替えたA0は、公式の統合A0とEventLog・Traceが一致する',()=>{
  const base=runPlayBaseline(INTEGRATED_SEED,'INTEGRATED_EXPERIMENTAL')
  if(!base.ok)throw new Error(base.code)
  const {timeline}=runA0(INTEGRATED_NEXTGEN_CONTRACT)
  expect(timeline.status).toBe('COMPLETED')
  expect(JSON.stringify(timeline.eventLog)).toBe(JSON.stringify(base.a0.result.eventLog))
  expect(JSON.stringify(timeline.decisionTraces)).toBe(JSON.stringify(base.a0.result.decisionTraces))
  // 参照: 公式ファクトリが同一世界で使えること(型・構成の健全性)。
  expect(Object.keys(createExperimentalIntegratedEvaluators(createExperimentalIntegratedWorld(),[])).sort())
   .toEqual(Object.keys(evaluatorsWith(INTEGRATED_NEXTGEN_CONTRACT)(createExperimentalIntegratedWorld(),[])).sort())
 })

 it('既定係数での短い再計算: A0は1269年でなく1270年に同じ婚姻が成立しNOT_ACHIEVED。同じ第1介入のA1は統合係数のA1と同じ婚姻年でACHIEVED',()=>{
  const {w,timeline:a0}=runA0(EXPERIMENTAL_NEXTGEN_CONTRACT)
  expect(a0.status).toBe('COMPLETED')
  expect(a0.technicalGoal?.status).toBe('NOT_ACHIEVED')
  // 統合係数のA0: 1250/1269/1310。既定係数: 1269の合意がTIEでDEFERされ、1270年に成立（別年）。
  const years=marriageYears(a0)
  expect(years).toEqual([1250,1270,1310])
  const made=createRootBranch(a0,[],evaluatorsWith(EXPERIMENTAL_NEXTGEN_CONTRACT)(w,[]))
  if(!made.ok)throw new Error(made.code)
  const modifier:StatModifier={
   modifierId:'ui:modifier:calib-m1',interventionId:'ui:intervention:calib-m1',
   targetRef:{kind:'PERSON_PAIR',ids:[...sorted] as [string,string]},statKey:PAIR_TRUST_STAT_KEY,signedDelta:-200,
   startYear:YEAR,endExclusiveYear:YEAR+60,decayPolicy:'NONE',ruleVersion:STAT_MODIFIER_RULE_VERSION,
  }
  const forkWorld=made.branch.snapshots[YEAR-made.branch.startYear] as WorldState
  const a1=forkHistory({parent:made.branch,branchId:'A1-calib',forkYear:YEAR,modifiers:[modifier],
   evaluatorsFor:({ledger})=>evaluatorsWith(EXPERIMENTAL_NEXTGEN_CONTRACT)(forkWorld,ledger)})
  if(!a1.ok)throw new Error(a1.code+':'+a1.message)
  expect(a1.branch.status).toBe('COMPLETED')
  const fin=a1.branch.snapshots.at(-1) as WorldState
  expect(fin.year).toBe(1350)
  expect(evaluateGoal(fin,EXPERIMENTAL_NALVEN_GOAL).status).toBe('ACHIEVED')
  expect(marriageYears(a1.branch)).toEqual([1250,1272,1278])
 },1200000)
},1200000)
