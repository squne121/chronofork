// Issue #71 工程2Bの明示オプトイン。旧multi-house-v0の入口や校正値を差し替えない。
import type { StatModifier, WorldState } from '../../simulation/contracts/index.ts'
import { createAutonomousCalibrationEvaluators } from '../../simulation/autonomy/index.ts'
import type { AbstractMarriageSupplyConfig } from '../../simulation/autonomy/abstract-marriage-supply.ts'
import type { EvaluatorMap } from '../../simulation/engine/index.ts'
import { ABSTRACT_MARRIAGE_BACKGROUND_VERSION } from '../../simulation/population/abstract-marriage-background.ts'
import { rngVersion } from '../../simulation/random.ts'
import {
  digestMultiHouseIdentity, multiHouseRunConfigIdentity, MULTI_HOUSE_RUN_CONDITIONS,
  MULTI_HOUSE_AUTONOMY, MULTI_HOUSE_B009_CALIBRATION, MULTI_HOUSE_NEXTGEN_CONTRACT,
  MULTI_HOUSE_SUPPLY, MULTI_HOUSE_SUPPLY_GROUPS, MULTI_HOUSE_TRUST_BASE,
} from './multi-house-playtest.ts'
import { createExperimentalOrdinaryLegalTrial } from './ordinary-legal-trial.ts'

export const MULTI_HOUSE_ABSTRACT_CONFIG_ID = 'experimental-multi-house-v1'
export const MULTI_HOUSE_ABSTRACT_RUN_CONDITIONS = Object.freeze({
  ...MULTI_HOUSE_RUN_CONDITIONS, configId: MULTI_HOUSE_ABSTRACT_CONFIG_ID,
})

export const MULTI_HOUSE_ABSTRACT_MARRIAGE = Object.freeze({
  status: 'CALIBRATION_ONLY',
  groups: Object.freeze(MULTI_HOUSE_SUPPLY_GROUPS.map(({groupId, houseId}) => Object.freeze({groupId, houseId}))),
  initialBirthYears: MULTI_HOUSE_SUPPLY.initialBirthYears,
  // 一度に調べる縁談は2件。登録上限とは独立。40歳は探索の試験範囲であり法定年齢ではない。
  offersPerSeeker: 2,
  maximumPreviewAge: 40,
  maxRecordsPerYear: MULTI_HOUSE_SUPPLY.limits.maxRecordsPerYear,
  maxAliveSupporting: MULTI_HOUSE_SUPPLY.limits.maxAliveSupporting,
  background: Object.freeze({
    adultSurvivalPermille: 700, annualAvailabilityPermille: 750,
    minimumAdultRemainingYears: 12, maximumAdultRemainingYears: 48,
    prohibitedPermille: 50, investigationCompletionPermille: 850,
    initialTrust: MULTI_HOUSE_B009_CALIBRATION.initialTrust,
    initialTrustSpread: MULTI_HOUSE_B009_CALIBRATION.initialTrustSpread,
  }),
}) satisfies AbstractMarriageSupplyConfig

// 128人規模の追跡を想定した有限の計算予算（128人の全組み合わせは8128）。
// v0の2400では登録済み人物の増加により実年次が停止した。信頼の係数や超過時の安全停止は変更しない。
const ABSTRACT_B009_CALIBRATION = Object.freeze({...MULTI_HOUSE_B009_CALIBRATION, maxPairs: 8192})

export function createMultiHouseAbstractEvaluators(startWorld: WorldState, ledger: readonly StatModifier[] = []): EvaluatorMap {
  const trial = createExperimentalOrdinaryLegalTrial()
  const result = createAutonomousCalibrationEvaluators({
    branchStartWorld: startWorld, ledger, trustBase: MULTI_HOUSE_TRUST_BASE,
    nextgenMarriage: {book: trial.book, laws: trial.laws, calibration: MULTI_HOUSE_NEXTGEN_CONTRACT},
    reviewedLegal: {book: trial.book, ordinaryLaws: trial.laws},
    spouseDeathDissolution: true, abstractMarriageSupply: MULTI_HOUSE_ABSTRACT_MARRIAGE,
    autonomy: MULTI_HOUSE_AUTONOMY, b009Calibration: ABSTRACT_B009_CALIBRATION,
  })
  if (!result.ok) throw new Error('INVALID_MULTI_HOUSE_ABSTRACT_EVALUATORS:' + result.issues.join('; '))
  return result.evaluators
}

export function multiHouseAbstractRunConfigIdentity(): Readonly<Record<string, unknown>> {
  const {supporting: _s, supportingKinshipClearances: _k, supportingCandidateTrustBase: _t, ...shared} = multiHouseRunConfigIdentity()
  void [_s, _k, _t]
  return {...shared, configId: MULTI_HOUSE_ABSTRACT_CONFIG_ID, abstractMarriageSupply: MULTI_HOUSE_ABSTRACT_MARRIAGE,
    b009: ABSTRACT_B009_CALIBRATION,
    ruleVersions: {...shared.ruleVersions as Record<string, unknown>, abstractMarriageBackground: ABSTRACT_MARRIAGE_BACKGROUND_VERSION, rngVersion}}
}

export function multiHouseAbstractRunConfigDigest(): string {
  return digestMultiHouseIdentity(multiHouseAbstractRunConfigIdentity())
}
