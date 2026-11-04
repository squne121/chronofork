// 人物の年指定イベント表ではなくWorldState由来で毎年計算する、明示注入専用の評価器合成境界。
// 法的な承認・条項は外部の明示証拠だけ。RuleRegistry/DEFAULT_EVALUATORSは変更しない。
import type { PairTrustBase, RuleOutcome, WorldState } from '../contracts/index.ts'
import type { EvaluationContext, RuleEvaluator } from '../engine/evaluators.ts'
import type { EvaluatorMap } from '../engine/index.ts'
import { createPairTrustView } from '../intervention/index.ts'
import type { StatModifierLedger } from '../intervention/index.ts'
import { createALeg01CalibrationEvaluator, createADyn02EvidenceEvaluator, createASuc04WorldStateEvaluator, createATit07EvidenceEvaluator } from '../rules/a/index.ts'
import type { MarriageApprovalEvidence } from '../rules/a/index.ts'
import { createReviewedLegalEvaluators, createALeg01OrdinaryEvaluator, createALeg01NextgenEvaluator, withSpouseDeathDissolution } from '../rules/a/index.ts'
import type { NextgenMarriageInput } from '../rules/a/index.ts'
import type { OrdinaryMarriageInput } from '../rules/a/index.ts'
import type { ReviewedLegalInput } from '../rules/a/index.ts'
import { createB002WorldStateEvaluator, createB003WorldStateEvaluator, createB004WorldStateEvaluator, createB005CalibrationEvaluator, createB005NextgenEvaluator, createB009WorldStateEvaluator, createB001PromotionEvaluator } from '../rules/b/index.ts'
import type { B009Calibration, B001PromotionInput, B001SupportingInput } from '../rules/b/index.ts'
import { createB001SupportingMarriageEvaluator } from '../rules/b/index.ts'
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
  /** DEC-057 国内通常婚姻。年指定で法的成功を強制しないオプトイン。 */
  ordinaryMarriage?: OrdinaryMarriageInput
  /** DEC-058: 実年齢・近親・双方相手選択・双方契約同意の年次法制。explicit opt-in only。 */
  nextgenMarriage?: NextgenMarriageInput
  /** DEC-024/058: 出典付き人口コホート・身元の二重照合後のみ記名Personへ昇格。 */
  promotion?: B001PromotionInput
  /** DEC-061: 重要人物昇格とは別の、人口内訳から少数SUPPORTING人物を記録する試験入力。 */
  supportingMarriage?: B001SupportingInput
  /** DEC-058: B-003で確定した当年の配偶者死亡を婚姻の法的終了へ接続。既定false。 */
  spouseDeathDissolution?: boolean
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
  // 補助人物は法的追跡できても、プレイヤーの直接介入対象にはならない。
  const supporting=new Set(input.branchStartWorld.persons.filter(p=>p.interactionRole==='SUPPORTING').map(p=>p.personId))
  if(input.ledger.some(m=>m?.targetRef?.kind==='PERSON_PAIR'&&
    Array.isArray(m.targetRef.ids)&&m.targetRef.ids.some((id:string)=>supporting.has(id))))return {ok:false,issues:['SUPPORTING_PERSON_NOT_DIRECTLY_INTERACTABLE']}
  const known=new Set(input.branchStartWorld.persons.map(p=>p.personId))
  const trust=createPairTrustView({base:input.trustBase,ledger:input.ledger,knownPersonIds:known})
  if(!trust.ok)return {ok:false,issues:trust.issues.map(x=>x.code+':'+x.path)}
  if(input.ordinaryMarriage && input.marriageEvidence?.length) return {ok:false,issues:['CANNOT_MIX_SYNTHETIC_MARRIAGE_WITH_ORDINARY']}
  if(input.nextgenMarriage && (input.ordinaryMarriage || input.marriageEvidence?.length))
    return {ok:false,issues:['CANNOT_MIX_NEXTGEN_WITH_OTHER_MARRIAGE_MODES']}
  if(input.nextgenMarriage && input.reviewedLegal &&
    (JSON.stringify(input.nextgenMarriage.book)!==JSON.stringify(input.reviewedLegal.book) ||
     JSON.stringify(input.nextgenMarriage.laws)!==JSON.stringify(input.reviewedLegal.ordinaryLaws)))
    return {ok:false,issues:['NEXTGEN_LEGAL_EVIDENCE_MISMATCH']}
  const marriage=input.nextgenMarriage?createALeg01NextgenEvaluator(input.nextgenMarriage)
    :input.ordinaryMarriage?createALeg01OrdinaryEvaluator(input.ordinaryMarriage)
    : createALeg01CalibrationEvaluator(input.marriageEvidence??[])
  if(!marriage.ok)return {ok:false,issues:marriage.issues.map(x=>typeof x==='string'?x:x.code+':'+x.path)}
  const marriageEvaluator=input.spouseDeathDissolution?withSpouseDeathDissolution(marriage.evaluator):marriage.evaluator
  const promotion=input.promotion?createB001PromotionEvaluator(input.promotion):undefined
  if(promotion&&!promotion.ok)return {ok:false,issues:[...promotion.issues]}
  const supporting=input.supportingMarriage?createB001SupportingMarriageEvaluator(input.supportingMarriage):undefined
  if(supporting&&!supporting.ok)return {ok:false,issues:[...supporting.issues]}
  // 両方のB-001評価器が選択された場合も、各CommandのTraceは同一Outcome内で一意にする。
  let b001: RuleEvaluator | undefined
  if (promotion?.ok && supporting?.ok) {
    const promoted=promotion.evaluator, recorded=supporting.evaluator
    b001=(world:WorldState, ctx:EvaluationContext):RuleOutcome=>{
      const a=promoted(world,ctx)
      const b=recorded(world,{...ctx,traceId:i=>ctx.traceId(i+a.traceDrafts.length)})
      return {...a,commands:[...a.commands,...b.commands],
        traceDrafts:[...a.traceDrafts,...b.traceDrafts]}
    }
  } else if (promotion?.ok) b001=promotion.evaluator
  else if (supporting?.ok) b001=supporting.evaluator
  const reviewed=input.reviewedLegal?createReviewedLegalEvaluators(input.reviewedLegal):undefined
  if(reviewed&&!reviewed.ok)return {ok:false,issues:[...reviewed.issues]}
  const evaluators:EvaluatorMap={
    ...createCalibrationEvaluators(input.tuning??EXPERIMENTAL_TUNING),
    'B-003':createB003WorldStateEvaluator(autonomy),
    'B-009':createB009WorldStateEvaluator(input.trustBase,input.b009Calibration),
    'B-002':createB002WorldStateEvaluator(autonomy),
    'A-DYN-02':createADyn02EvidenceEvaluator(),
    ...(b001?{'B-001':b001}:{}),
    'B-004':createB004WorldStateEvaluator(trust.view,autonomy,input.b004Calibration,input.ledger),
    'B-005':input.nextgenMarriage?createB005NextgenEvaluator(input.nextgenMarriage.calibration):createB005CalibrationEvaluator(),
    'A-LEG-01':marriageEvaluator,
    'A-SUC-04':createASuc04WorldStateEvaluator(),
    'A-TIT-07':createATit07EvidenceEvaluator(),
    ...(reviewed?.ok?reviewed.evaluators:{}),
  }
  return {ok:true,evaluators}
}
