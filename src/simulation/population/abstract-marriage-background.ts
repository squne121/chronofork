// Issue #71 工程2B。個別化前の背景だけを表す。氏名・親子辺・法的王朝は生成しない。
import type { Id, PairTrustBase, Person, WorldState, Year } from '../contracts/index.ts'
import { START_YEAR } from '../contracts/index.ts'
import { reviewDomesticMarriageEligibility } from '../legal/nextgen-marriage.ts'
import type { SupportingKinshipClearance } from '../legal/supporting-kinship-clearance.ts'
import { drawRandom } from '../random.ts'
import { supportingCandidateId } from './supporting-marriage.ts'
import type { SupportingMarriageCohort } from './supporting-marriage.ts'

export const ABSTRACT_MARRIAGE_BACKGROUND_VERSION = 'abstract-marriage-background-1:CALIBRATION_ONLY'

export type AbstractMarriageCalibration = Readonly<{
  // 千分率。成人までの生存と当年の探索可能性を別の事実として扱う。
  adultSurvivalPermille: number
  annualAvailabilityPermille: number
  // 成人到達時の余命をこの範囲で一様に近似する（端点を含む）。
  minimumAdultRemainingYears: number
  maximumAdultRemainingYears: number
  // 潜在する禁親該当性は年で変化させず、調査の完了だけを当年化する。
  prohibitedPermille: number
  investigationCompletionPermille: number
  // B-009の初期値と幅を共有し、未登録時の関係値は別の乱数キーで生成する。
  initialTrust: number
  initialTrustSpread: number
}>

export type AbstractCandidateLife = Readonly<{
  survivalEvidenceId: Id
  candidateId: Id
  /** 匿名のままなら、この年以降は成人生存の根拠を出さない。WorldState上の死亡年ではない。 */
  unregisteredUntilYear: Year
  adultSurvivalBacked: boolean
  available: boolean
  provenance: 'CALIBRATION_ONLY'
}>

export type AbstractKinshipReview =
  | Readonly<{ status: 'CLEARED'; record: SupportingKinshipClearance }>
  | Readonly<{ status: 'PROHIBITED' | 'UNVERIFIED'; reasonCode: string; record?: SupportingKinshipClearance }>

/** 初期人口の仮想枠またはC004の匿名出生枠。ここでは生存・関係値を判断しない。 */
export function abstractBirthCohort(groupId: Id, houseId: Id, birthYear: Year,
  sex: 'MALE' | 'FEMALE', memberCount: number): SupportingMarriageCohort {
  const source = birthYear < START_YEAR ? 'INITIAL_POPULATION' : 'C004_COHORT'
  const key = JSON.stringify([groupId, birthYear, sex])
  const cohortId = `abstract-marriage:v1:${key}`
  return {
    cohortId, groupId, affiliationHouseId: houseId, birthYear, sex, memberCount,
    familyPoolId: `abstract-marriage:pool:${key}`, tier: 'REGIONAL_LOWER_NOBILITY',
    source, sourceEvidenceId: `abstract-marriage:${source}:${key}`,
    provenance: 'CALIBRATION_ONLY',
  }
}

/** 匿名slotの生存根拠は出生年・seed・slotで固定し、探索者や照会時点ごとに引き直さない。
 * 個別化でこの推計は打切り、以後の実在・生死は登録済みWorldStateと既存B-003だけを参照する。
 */
export function abstractCandidateLife(seed: number, cohort: SupportingMarriageCohort, ordinal: number,
  year: Year, calibration: AbstractMarriageCalibration): AbstractCandidateLife {
  const candidateId = supportingCandidateId(cohort.cohortId, ordinal)
  const birthKey = { stream: 'ENDOGENOUS', phase: 3, ruleId: 'B-001', actorId: candidateId,
    year: cohort.birthYear, targetId: null } as const
  const reachedAdulthood = drawRandom(seed, {...birthKey, eventKey: 'ABSTRACT_MARRIAGE_ADULT_SURVIVAL_V1'}) * 1000
    < calibration.adultSurvivalPermille
  const span = calibration.maximumAdultRemainingYears - calibration.minimumAdultRemainingYears + 1
  const unregisteredUntilYear = reachedAdulthood
    ? cohort.birthYear + 18 + calibration.minimumAdultRemainingYears +
      Math.floor(drawRandom(seed, {...birthKey, eventKey: 'ABSTRACT_MARRIAGE_ADULT_LIFETIME_V1'}) * span)
    : cohort.birthYear + 1 + Math.floor(drawRandom(seed, {...birthKey, eventKey: 'ABSTRACT_MARRIAGE_CHILD_LIFETIME_V1'}) * 17)
  const adultSurvivalBacked = year >= cohort.birthYear + 18 && year < unregisteredUntilYear
  const available = adultSurvivalBacked && drawRandom(seed, {...birthKey, year, eventKey: 'ABSTRACT_MARRIAGE_ANNUAL_AVAILABILITY_V1'}) * 1000
    < calibration.annualAvailabilityPermille
  return {candidateId, unregisteredUntilYear, adultSurvivalBacked, available, provenance: 'CALIBRATION_ONLY',
    survivalEvidenceId: `abstract-marriage:survival-v1:${JSON.stringify([candidateId, seed, unregisteredUntilYear])}`}
}

/** 実記録の審査が先。調査票は抽象調査の結果であり、未知の系譜を計算したとは主張しない。 */
export function abstractKinshipReview(world: WorldState, seed: number, pair: readonly [Id, Id],
  candidates: readonly Person[], calibration: AbstractMarriageCalibration): AbstractKinshipReview {
  const eligibility = reviewDomesticMarriageEligibility(world, pair, candidates)
  if (eligibility.status !== 'ELIGIBLE') {
    return {status: eligibility.reasonCode === 'DIRECT_ANCESTOR_KINSHIP' ||
      eligibility.reasonCode === 'COMMON_ANCESTOR_WITHIN_TWO_GENERATIONS' ? 'PROHIBITED' : 'UNVERIFIED',
    reasonCode: eligibility.reasonCode}
  }
  const key = { stream: 'ENDOGENOUS', phase: 3, ruleId: 'B-005', actorId: pair[0], targetId: pair[1] } as const
  const { countryId } = eligibility
  const recordKey = JSON.stringify([pair, countryId, world.year])
  const record: SupportingKinshipClearance = {
    clearanceId: `abstract-marriage:kinship-v1:${recordKey}`, personIds: pair, countryId,
    checkedYear: world.year, validUntilYear: world.year + 1,
    sourceEvidenceId: `abstract-marriage:investigation-v1:${JSON.stringify([seed, recordKey])}`,
    provenance: 'CALIBRATION_ONLY',
  }
  if (drawRandom(seed, {...key, year: world.year,
    eventKey: `ABSTRACT_MARRIAGE_INVESTIGATION_V1:${countryId}`}) * 1000 >= calibration.investigationCompletionPermille) {
    return {status: 'UNVERIFIED', reasonCode: 'ABSTRACT_KINSHIP_INVESTIGATION_INCOMPLETE',
      record: {...record, abstractFinding: 'UNVERIFIED'}}
  }
  if (drawRandom(seed, {...key, year: START_YEAR, eventKey: 'ABSTRACT_MARRIAGE_LATENT_PROHIBITION_V1'}) * 1000
    < calibration.prohibitedPermille) {
    // 抽象調査上の禁止。WorldStateに血縁・祖先・家門を付け加えるものではない。
    return {status: 'PROHIBITED', reasonCode: 'ABSTRACT_KINSHIP_PROHIBITED',
      record: {...record, abstractFinding: 'PROHIBITED'}}
  }
  return {status: 'CLEARED', record}
}

/** 初対面の関係値は年・生存・人口・禁親調査の結果に依存しない。 */
export function abstractCandidateTrust(seed: number, pair: readonly [Id, Id],
  calibration: AbstractMarriageCalibration): PairTrustBase {
  const personIds = (pair[0] < pair[1] ? pair : [pair[1], pair[0]]) as readonly [Id, Id]
  const spread = drawRandom(seed, {stream: 'ENDOGENOUS', year: START_YEAR, phase: 3, ruleId: 'B-009',
    actorId: personIds[0], targetId: personIds[1], eventKey: 'ABSTRACT_MARRIAGE_INITIAL_TRUST_V1'})
  return {personIds, value: calibration.initialTrust + Math.floor(spread * (calibration.initialTrustSpread + 1))}
}
