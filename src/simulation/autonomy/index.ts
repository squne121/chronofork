// 人物の年指定イベント表ではなくWorldState由来で毎年計算する、明示注入専用の評価器合成境界。
// 法的な承認・条項は外部の明示証拠だけ。RuleRegistry/DEFAULT_EVALUATORSは変更しない。
import type { PairTrustBase, WorldState } from '../contracts/index.ts'
import type { EvaluatorMap } from '../engine/index.ts'
import { createPairTrustView } from '../intervention/index.ts'
import type { StatModifierLedger } from '../intervention/index.ts'
import { createALeg01CalibrationEvaluator, createADyn02EvidenceEvaluator, createASuc04WorldStateEvaluator, createATit07EvidenceEvaluator } from '../rules/a/index.ts'
import type { MarriageApprovalEvidence } from '../rules/a/index.ts'
import { createReviewedLegalEvaluators } from '../rules/a/index.ts'
import type { ReviewedLegalInput } from '../rules/a/index.ts'
import { createB002WorldStateEvaluator, createB003WorldStateEvaluator, createB004WorldStateEvaluator, createB005CalibrationEvaluator, createB009WorldStateEvaluator } from '../rules/b/index.ts'
import type { B009Calibration } from '../rules/b/index.ts'
import type { B004Calibration } from '../rules/b/index.ts'
import { createCalibrationEvaluators } from '../rules/c/index.ts'
import { EXPERIMENTAL_TUNING } from '../tuning.ts'
import type { TuningConfig } from '../tuning.ts'
import { checkAutonomyCalibration, EXPERIMENTAL_AUTONOMY } from './config.ts'
import type { AutonomyCalibration } from './config.ts'

export { EXPERIMENTAL_AUTONOMY, validateAutonomyCalibration } from './config.ts'
export type { AutonomyCalibration, AutonomyCalibrationIssue } from './config.ts'

export type AutonomousEvaluatorInput = Readonly<{
  branchStartWorld: WorldState
  ledger: StatModifierLedger
  trustBase: readonly PairTrustBase[]
  marriageEvidence?: readonly MarriageApprovalEvidence[]
  /** 明示されたCALIBRATION_ONLY権限に限る後年相続審査・新委任（既定は非適用）。 */
  reviewedLegal?: ReviewedLegalInput
  autonomy?: AutonomyCalibration
  tuning?: TuningConfig
  b004Calibration?: B004Calibration
  b009Calibration?: B009Calibration
}>
export type AutonomousEvaluatorResult =
  | Readonly<{ ok: true; evaluators: EvaluatorMap }>
  | Readonly<{ ok: false; issues: readonly string[] }>

/**
 * A0からA1へのfork時はbranchStartWorldに必ずfork年初のWorldStateと新ledgerを渡す。
 * ルールの完全性・係数同一性の自動照合はない。呼出側が同じ構成/校正パラメータを固定すること。
 * C004の人口枠、B002出生、B003自然死、B009関係値の年次確定、B004動的候補、B005法照会、A-LEG01明示審査、
 * A-DYN02明示条項、A-SUC04相続PENDING、A-TIT07未確定所有者処理を合成する。
 */
export function createAutonomousCalibrationEvaluators(input:AutonomousEvaluatorInput):AutonomousEvaluatorResult {
  let autonomy: AutonomyCalibration
  try { autonomy = checkAutonomyCalibration(input.autonomy??EXPERIMENTAL_AUTONOMY) }
  catch(e){return {ok:false,issues:['INVALID_CALIBRATION: '+String(e)]}}
  if(!input.branchStartWorld || !Array.isArray(input.branchStartWorld.persons) ||
      !Array.isArray(input.trustBase)||!Array.isArray(input.ledger)){
    return {ok:false,issues:['INVALID_INPUT_WORLD_OR_LEDGER']}
  }
  const known=new Set(input.branchStartWorld.persons.map(p=>p.personId))
  const trust=createPairTrustView({base:input.trustBase,ledger:input.ledger,knownPersonIds:known})
  if(!trust.ok)return {ok:false,issues:trust.issues.map(x=>x.code+':'+x.path)}
  const marriage=createALeg01CalibrationEvaluator(input.marriageEvidence??[])
  if(!marriage.ok)return {ok:false,issues:marriage.issues.map(x=>x.code+':'+x.path)}
  const reviewed=input.reviewedLegal?createReviewedLegalEvaluators(input.reviewedLegal):undefined
  if(reviewed&&!reviewed.ok)return {ok:false,issues:[...reviewed.issues]}
  const evaluators:EvaluatorMap={
    ...createCalibrationEvaluators(input.tuning??EXPERIMENTAL_TUNING),
    'B-003':createB003WorldStateEvaluator(autonomy),
    'B-009':createB009WorldStateEvaluator(input.trustBase,input.b009Calibration),
    'B-002':createB002WorldStateEvaluator(autonomy),
    'A-DYN-02':createADyn02EvidenceEvaluator(),
    'B-004':createB004WorldStateEvaluator(trust.view,autonomy,input.b004Calibration,input.ledger),
    'B-005':createB005CalibrationEvaluator(),
    'A-LEG-01':marriage.evaluator,
    'A-SUC-04':createASuc04WorldStateEvaluator(),
    'A-TIT-07':createATit07EvidenceEvaluator(),
    ...(reviewed?.ok?reviewed.evaluators:{}),
  }
  return {ok:true,evaluators}
}
