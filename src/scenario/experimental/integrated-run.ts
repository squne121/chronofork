// Issue #71 / PR #78 / DEC-057・058・061: 100年統合試験と将来のブラウザ試遊が共有する実行構成。
// すべて CALIBRATION_ONLY。史実・正式世界設定・正式Goal・婚姻/出生/相続の成立を固定しない。
// 試験(tests/)とUI(src/ui/)の双方が本ファイルを import し、tests/ からの import は作らない。
import type { PairTrustBase, StatModifier, WorldState } from '../../simulation/contracts/index.ts'
import { PAIR_TRUST_STAT_KEY, STAT_MODIFIER_RULE_VERSION } from '../../simulation/contracts/index.ts'
import { createAutonomousCalibrationEvaluators } from '../../simulation/autonomy/index.ts'
import type { AutonomyCalibration } from '../../simulation/autonomy/index.ts'
import type { EvaluatorMap } from '../../simulation/engine/index.ts'
import { EXPERIMENTAL_NEXTGEN_CONTRACT } from '../../simulation/legal/nextgen-contract.ts'
import type { NextgenContractCalibration } from '../../simulation/legal/nextgen-contract.ts'
import { EXPERIMENTAL_B009_CALIBRATION } from '../../simulation/rules/b/index.ts'
import type { B001PromotionInput } from '../../simulation/rules/b/index.ts'
import { childIdForMarriageYear } from '../../simulation/rules/b/b002-worldstate.ts'
import type { SupportingKinshipClearance } from '../../simulation/rules/a/index.ts'
import { supportingCandidateId } from '../../simulation/population/supporting-marriage.ts'
import type { SupportingMarriageCohort } from '../../simulation/population/supporting-marriage.ts'
import { pairKey } from '../../simulation/intervention/index.ts'
import { createExperimentalWorld, NALVEN_DYNASTY_ID } from './world-1250.ts'
import { createExperimentalOrdinaryLegalTrial } from './ordinary-legal-trial.ts'
import type { ProvenanceEntry } from './provenance.ts'

export const INTEGRATED_START_YEAR = 1250
export const INTEGRATED_END_YEAR = 1350
export const INTEGRATED_SEED = 20260101
export const INTEGRATED_PAIR = ['person-exp-02', 'person-exp-05'] as const

/** B-001 重要人物昇格（出典付き人口コホート×身元の二重照合）。CALIBRATION_ONLY。 */
export const INTEGRATED_ATTESTED_PERSON_ID = 'person:experimental-census:east-cardon-1249'
export const INTEGRATED_PROMOTION: B001PromotionInput = Object.freeze({
  cohorts: [{
    cohortId: 'experimental-census:birth-1249-east-commons', groupId: 'group-east-commons',
    birthYear: 1249, memberCount: 3, recordedYear: 1249,
    censusEvidenceId: 'experimental-census:pre1250-age-group-evidence', provenance: 'CALIBRATION_ONLY',
  }],
  identities: [{
    identityEvidenceId: 'experimental-identity:cardon-person-1249',
    cohortId: 'experimental-census:birth-1249-east-commons', memberOrdinal: 0,
    personId: INTEGRATED_ATTESTED_PERSON_ID,
    personName: '実験用の記名候補（史実・正式設定ではない）',
    sex: 'FEMALE', houseId: 'house-cardon', recordedYear: 1249, provenance: 'CALIBRATION_ONLY',
  }],
}) as B001PromotionInput

/** 1260年にC004が確定した匿名出生履歴を、別資料(1278)で成人確認した少数SUPPORTING供給。 */
const SUPPORTING_COHORT: SupportingMarriageCohort = {
  cohortId: 'trial:issue71:C004:1260:east-female',
  groupId: 'group-east-elite', affiliationHouseId: 'house-cardon',
  familyPoolId: 'trial:issue71:independently-attested-cardon-unrelated-family',
  tier: 'REGIONAL_LOWER_NOBILITY', sex: 'FEMALE', birthYear: 1260, memberCount: 1,
  source: 'C004_COHORT', sourceEvidenceId: 'trial:issue71:C004:1260:east',
  survivorAttestationId: 'trial:issue71:separate-survivor-census:1278:east',
  provenance: 'CALIBRATION_ONLY',
}
export const INTEGRATED_SUPPORTING_COHORTS: readonly SupportingMarriageCohort[] = Object.freeze([SUPPORTING_COHORT])
export const INTEGRATED_SUPPORTING_PERSON_ID = supportingCandidateId(SUPPORTING_COHORT.cohortId, 0)

/** SUPPORTING供給の件数・年齢上限(評価器構成と同一定数をidentityにも使う)。 */
const INTEGRATED_SUPPORTING_LIMITS = Object.freeze({
  maxRecordsPerYear: 1, maxAliveSupporting: 1, perCohortSamples: 1, maximumPreviewAge: 65,
})

/** 1250年P2×P5婚姻からB002が実出生した場合の1252年男子の安定ID(対象IDの固定のみ。出生を保証しない)。 */
const integratedMarriageId = 'marriage:normal:' + JSON.stringify([INTEGRATED_START_YEAR, pairKey(INTEGRATED_PAIR)])
export const INTEGRATED_WITNESSED_SON_ID = childIdForMarriageYear(
  integratedMarriageId, INTEGRATED_PAIR[0], INTEGRATED_PAIR[1], 1252)

/** ペア個別の禁親確認証拠(合成)。C004・生存者確認とは別個の資料として与える。 */
export const INTEGRATED_SUPPORTING_CLEARANCES: readonly SupportingKinshipClearance[] = Object.freeze([{
  clearanceId: 'trial:issue71:independent-kinship-check:1278',
  personIds: [INTEGRATED_WITNESSED_SON_ID, INTEGRATED_SUPPORTING_PERSON_ID],
  countryId: 'country-eldia', checkedYear: 1278, validUntilYear: 1320,
  sourceEvidenceId: 'trial:issue71:person-level-lineage-record-distinct-from-C004-and-survivor',
  provenance: 'CALIBRATION_ONLY',
}])

export const INTEGRATED_AUTONOMY: AutonomyCalibration = Object.freeze({
  status: 'CALIBRATION_ONLY',
  birth: { minMotherAge: 18, maxMotherAge: 32, minFatherAge: 18, chancePermille: 1000 },
  death: { minAge: 60, riskStartAge: 59, basePermille: 0, increasePerYearPermille: 1000, maxPermille: 1000 },
  // SUPPORTING個別化後の全pair走査で予算上限を越えないよう、校正専用枠だけ拡張。
  marriage: { minAdultAge: 18, maxCandidatePairs: 1600 },
}) as AutonomyCalibration

export const INTEGRATED_NEXTGEN_CONTRACT: NextgenContractCalibration = Object.freeze({
  ...EXPERIMENTAL_NEXTGEN_CONTRACT,
  ownDynastyBonus: 2, otherDynastyCost: 0, titleWeight: 4, noClauseCost: 5, supportWeight: 0,
})

export const INTEGRATED_B009_CALIBRATION = Object.freeze({
  ...EXPERIMENTAL_B009_CALIBRATION,
  initialTrust: 25, annualDelta: 1, houseSupportWeight: 2, sameHouseBonus: 10, maxPairs: 1600,
})

export const INTEGRATED_TRUST_BASE: readonly PairTrustBase[] = Object.freeze([
  Object.freeze({ personIds: Object.freeze([...INTEGRATED_PAIR] as [string, string]), value: 80 }),
]) as readonly PairTrustBase[]

/** 比較用介入: P2/P5の信頼のみ -20 / 1250〜1254。出生・婚姻・相続の成功を固定しない。 */
export const INTEGRATED_TRUST_REDUCTION: StatModifier = Object.freeze({
  modifierId: 'trial:issue71:pair-trust-minus-20',
  interventionId: 'trial:issue71:intervene-1250',
  targetRef: Object.freeze({ kind: 'PERSON_PAIR', ids: Object.freeze([...INTEGRATED_PAIR]) }),
  statKey: PAIR_TRUST_STAT_KEY, signedDelta: -20,
  startYear: 1250, endExclusiveYear: 1255, decayPolicy: 'NONE',
  ruleVersion: STAT_MODIFIER_RULE_VERSION,
}) as StatModifier

/** C004匿名出生履歴を空から蓄積させる(初期履歴を持ち込まない)初期世界。 */
export function createExperimentalIntegratedWorld(): WorldState {
  const w = createExperimentalWorld()
  return { ...w, demographics: { ...w.demographics, anonymousBirthHistory: [] } }
}

/**
 * A0/A1/fork で同一設定の評価器を生成する。fork時は必ずfork年初の startWorld と新ledgerを渡す。
 * 法令・校正値・禁親証拠・各ルール構成は呼出ごとに同一(法制は都度structuredCloneされる)。
 */
export function createExperimentalIntegratedEvaluators(
  startWorld: WorldState, ledger: readonly StatModifier[] = [],
): EvaluatorMap {
  const trial = createExperimentalOrdinaryLegalTrial()
  const cfg = createAutonomousCalibrationEvaluators({
    branchStartWorld: startWorld, ledger, trustBase: INTEGRATED_TRUST_BASE,
    nextgenMarriage: {
      book: trial.book, laws: trial.laws, calibration: INTEGRATED_NEXTGEN_CONTRACT,
      supportingKinshipClearances: INTEGRATED_SUPPORTING_CLEARANCES,
    },
    reviewedLegal: { book: trial.book, ordinaryLaws: trial.laws },
    spouseDeathDissolution: true,
    promotion: INTEGRATED_PROMOTION,
    supportingMarriage: { cohorts: INTEGRATED_SUPPORTING_COHORTS, ...INTEGRATED_SUPPORTING_LIMITS },
    autonomy: INTEGRATED_AUTONOMY,
    b009Calibration: INTEGRATED_B009_CALIBRATION,
  })
  if (!cfg.ok) throw new Error('INVALID_INTEGRATED_EVALUATORS:' + cfg.issues.join('; '))
  return cfg.evaluators
}

/**
 * 統合A0の実行構成identity(読み取り専用)。createExperimentalIntegratedEvaluators が評価器へ渡す
 * 法令・証拠・校正・SUPPORTING供給・禁親証拠・信頼基準と同じ定数/関数から都度導出し、手書きの固定値を持たない。
 * A0キャッシュの同一性判定用(JSON.stringify可能)。値の変更や計算には関与しない。
 */
export function integratedRunConfigIdentity(): Readonly<Record<string, unknown>> {
  const trial = createExperimentalOrdinaryLegalTrial()
  return {
    book: trial.book, laws: trial.laws,
    nextgenContract: INTEGRATED_NEXTGEN_CONTRACT, supportingClearances: INTEGRATED_SUPPORTING_CLEARANCES,
    trustBase: INTEGRATED_TRUST_BASE, promotion: INTEGRATED_PROMOTION,
    supporting: { cohorts: INTEGRATED_SUPPORTING_COHORTS, ...INTEGRATED_SUPPORTING_LIMITS },
    autonomy: INTEGRATED_AUTONOMY, b009: INTEGRATED_B009_CALIBRATION,
    spouseDeathDissolution: true,
  }
}

/** runTimeline 用の共通オプション。goalは正式Goalではなく技術評価(technicalGoalEvaluation)。 */
export function createExperimentalIntegratedTimelineOptions(branchId: string) {
  const world = createExperimentalIntegratedWorld()
  return {
    world,
    options: {
      seed: INTEGRATED_SEED, branchId,
      evaluators: createExperimentalIntegratedEvaluators(world, []),
      goal: { dynastyId: NALVEN_DYNASTY_ID }, technicalGoalEvaluation: true as const,
    },
  }
}

export const EXPERIMENTAL_INTEGRATED_RUN_PROVENANCE: readonly ProvenanceEntry[] = Object.freeze([
  { subject: '統合実行構成(C004→B001→B003/B009/B004/B005→A-LEG01→B002→A-DYN02→A-SUC04/A-TIT07)',
    origin: 'PLACEHOLDER', source: 'docs/decisions DEC-057/058/061',
    note: 'CALIBRATION_ONLY。SUPPORTING1名・禁親証拠・信頼介入・法令は試験値。正式な史実/世界設定/Goal達成を示さない。' },
])
