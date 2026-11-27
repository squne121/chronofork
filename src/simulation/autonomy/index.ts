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
import { createCrownSuccessionEvaluators } from '../rules/a/crown-succession.ts'
import { withCountryRulerVacancy } from '../rules/a/ruler-vacancy.ts'
import { createB002WorldStateEvaluator, createB003WorldStateEvaluator, createB004WorldStateEvaluator, createB005CalibrationEvaluator, createB005NextgenEvaluator, createB009WorldStateEvaluator, createB001PromotionEvaluator } from '../rules/b/index.ts'
import type { B009Calibration, B001PromotionInput, B001SupportingInput } from '../rules/b/index.ts'
import { createB001SupportingMarriageEvaluator } from '../rules/b/index.ts'
import type { B004Calibration } from '../rules/b/index.ts'
import { createCalibrationEvaluators } from '../rules/c/index.ts'
import { EXPERIMENTAL_TUNING } from '../tuning.ts'
import type { TuningConfig } from '../tuning.ts'
import { checkAutonomyCalibration, EXPERIMENTAL_AUTONOMY } from './config.ts'
import type { AutonomyCalibration } from './config.ts'
import { createAbstractSupportingCandidateScope, createSupportingCandidateResolver } from './supporting-candidate-view.ts'
import type { AbstractMarriageSupplyConfig } from './abstract-marriage-supply.ts'

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
  abstractMarriageSupply?: AbstractMarriageSupplyConfig
  /** 未登録候補ペアの明示的信頼。省略時はNO_BASEで保留。 */
  supportingCandidateTrustBase?: readonly PairTrustBase[]
  /** DEC-058: B-003で確定した当年の配偶者死亡を婚姻の法的終了へ接続。既定false。 */
  spouseDeathDissolution?: boolean
  /** 明示されたCALIBRATION_ONLY権限に限る後年相続審査・新委任（既定は非適用）。 */
  reviewedLegal?: ReviewedLegalInput
  autonomy?: AutonomyCalibration
  tuning?: TuningConfig
  b004Calibration?: B004Calibration
  b009Calibration?: B009Calibration
  /** DEC-179: 旧全ペア評価とは別の明示オプトイン。 */
  demandDrivenPairTrust?: true
  /** DEC-190: 出生児の家門を父方原則と婚姻契約の明示条項から決める。省略は旧版（母の家門）。 */
  childHouseAffiliation?: 'DEC190_PATERNAL_PRINCIPLE'
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
  const supportingPersonIds=new Set(input.branchStartWorld.persons.filter(p=>p.interactionRole==='SUPPORTING').map(p=>p.personId))
  if(input.ledger.some(m=>m?.targetRef?.kind==='PERSON_PAIR'&&
    Array.isArray(m.targetRef.ids)&&m.targetRef.ids.some((id:string)=>supportingPersonIds.has(id))))return {ok:false,issues:['SUPPORTING_PERSON_NOT_DIRECTLY_INTERACTABLE']}
  const known=new Set(input.branchStartWorld.persons.map(p=>p.personId))
  const trust=createPairTrustView({base:input.trustBase,ledger:input.ledger,knownPersonIds:known})
  if(!trust.ok)return {ok:false,issues:trust.issues.map(x=>x.code+':'+x.path)}
  const ledger = input.demandDrivenPairTrust ? structuredClone(input.ledger) : input.ledger
  if(input.ordinaryMarriage && input.marriageEvidence?.length) return {ok:false,issues:['CANNOT_MIX_SYNTHETIC_MARRIAGE_WITH_ORDINARY']}
  if(input.nextgenMarriage && (input.ordinaryMarriage || input.marriageEvidence?.length))
    return {ok:false,issues:['CANNOT_MIX_NEXTGEN_WITH_OTHER_MARRIAGE_MODES']}
  if(input.nextgenMarriage && input.reviewedLegal &&
    (JSON.stringify(input.nextgenMarriage.book)!==JSON.stringify(input.reviewedLegal.book) ||
     JSON.stringify(input.nextgenMarriage.laws)!==JSON.stringify(input.reviewedLegal.ordinaryLaws)))
    return {ok:false,issues:['NEXTGEN_LEGAL_EVIDENCE_MISMATCH']}
  if(input.abstractMarriageSupply && (!input.nextgenMarriage || input.supportingMarriage ||
    input.supportingCandidateTrustBase || input.nextgenMarriage.supportingKinshipClearances || input.promotion))
    return {ok:false,issues:['ABSTRACT_MARRIAGE_SUPPLY_REQUIRES_INDEPENDENT_NEXTGEN_MODE']}
  // 家門条項の交渉と出生時の父方原則は一体で選ぶ。片方だけでは条項が出生へ反映されない/母方既定が残る。
  if(input.childHouseAffiliation!==undefined && input.childHouseAffiliation!=='DEC190_PATERNAL_PRINCIPLE')
    return {ok:false,issues:['INVALID_CHILD_HOUSE_AFFILIATION_MODE']}
  if((input.nextgenMarriage?.calibration?.childHouse!==undefined)!==(input.childHouseAffiliation!==undefined))
    return {ok:false,issues:['CHILD_HOUSE_MODE_MISMATCH']}
  if(input.abstractMarriageSupply && !Array.isArray(input.branchStartWorld.demographics?.anonymousBirthHistory))
    return {ok:false,issues:['ANONYMOUS_BIRTH_HISTORY_REQUIRED']}
  let annual: ReturnType<typeof createAbstractSupportingCandidateScope> | undefined
  try { if(input.abstractMarriageSupply)annual=createAbstractSupportingCandidateScope(input.abstractMarriageSupply,autonomy.marriage.minAdultAge) }
  catch(e) {return {ok:false,issues:[String(e)]}}
  const supporting=input.supportingMarriage?createB001SupportingMarriageEvaluator(input.supportingMarriage):undefined
  if(supporting&&!supporting.ok)return {ok:false,issues:[...supporting.issues]}
  const resolver=annual?annual.resolve:input.supportingMarriage?createSupportingCandidateResolver(input.supportingMarriage):undefined
  const candidateTrust=input.supportingCandidateTrustBase??[]
  const candidateIds=Array.isArray(candidateTrust)?candidateTrust.flatMap(p=>
    Array.isArray(p?.personIds)?p.personIds.filter((id:unknown):id is string=>typeof id==='string'):[]):[]
  const candidateTrustCheck=createPairTrustView({base:candidateTrust,ledger:[],knownPersonIds:new Set(candidateIds)})
  if(!candidateTrustCheck.ok)return {ok:false,issues:candidateTrustCheck.issues.map(x=>x.code+':'+x.path)}
  const marriage=input.nextgenMarriage?createALeg01NextgenEvaluator({...input.nextgenMarriage,supportingCandidateResolver:resolver})
    :input.ordinaryMarriage?createALeg01OrdinaryEvaluator(input.ordinaryMarriage)
    : createALeg01CalibrationEvaluator(input.marriageEvidence??[])
  if(!marriage.ok)return {ok:false,issues:marriage.issues.map(x=>typeof x==='string'?x:x.code+':'+x.path)}
  const marriageEvaluator=input.spouseDeathDissolution?withSpouseDeathDissolution(marriage.evaluator):marriage.evaluator
  const promotion=input.promotion?createB001PromotionEvaluator(input.promotion):undefined
  if(promotion&&!promotion.ok)return {ok:false,issues:[...promotion.issues]}
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
  else if (annual) b001=annual.evaluate
  const reviewed=input.reviewedLegal?createReviewedLegalEvaluators(input.reviewedLegal):undefined
  if(reviewed&&!reviewed.ok)return {ok:false,issues:[...reviewed.issues]}
  const crown=createCrownSuccessionEvaluators(
    reviewed?.ok ? reviewed.evaluators['A-SUC-04']! : createASuc04WorldStateEvaluator(),
    reviewed?.ok ? reviewed.evaluators['A-TIT-07']! : createATit07EvidenceEvaluator(),
    {book:input.reviewedLegal?.book,laws:input.reviewedLegal?.ordinaryLaws,
      ...(input.reviewedLegal?.heirSearch?{heirSearch:input.reviewedLegal.heirSearch}:{})},
  )
  const evaluators:EvaluatorMap={
    ...createCalibrationEvaluators(input.tuning??EXPERIMENTAL_TUNING),
    'B-003':createB003WorldStateEvaluator(autonomy),
    'B-009':createB009WorldStateEvaluator(input.trustBase,input.b009Calibration,
      input.demandDrivenPairTrust ? {marriage: autonomy.marriage, ledger} : undefined),
    'B-002':createB002WorldStateEvaluator(autonomy,input.childHouseAffiliation??'LEGACY_MATERNAL_HOUSE'),
    'A-DYN-02':createADyn02EvidenceEvaluator(),
    ...(b001?{'B-001':b001}:{}),
    'B-004':createB004WorldStateEvaluator(trust.view,autonomy,input.b004Calibration,ledger,
      resolver?{resolve:resolver,trustBase:candidateTrust}:undefined),
    'B-005':input.nextgenMarriage
      ?createB005NextgenEvaluator(input.nextgenMarriage.calibration,
        input.nextgenMarriage.supportingKinshipClearances,resolver)
      :createB005CalibrationEvaluator(),
    'A-LEG-01':marriageEvaluator,
    ...(reviewed?.ok?reviewed.evaluators:{}),
    'A-SUC-04':crown.succession,
    'A-TIT-07':withCountryRulerVacancy(crown.titleTransfer),
  }
  return {ok:true,evaluators}
}
