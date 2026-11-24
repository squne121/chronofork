// Issue #71 工程2Bの明示オプトイン。旧multi-house-v0の入口や校正値を差し替えない。
import type { StatModifier, WorldState } from '../../simulation/contracts/index.ts'
import { createAutonomousCalibrationEvaluators } from '../../simulation/autonomy/index.ts'
import type { AbstractMarriageSupplyConfig } from '../../simulation/autonomy/abstract-marriage-supply.ts'
import type { EvaluatorMap } from '../../simulation/engine/index.ts'
import { ABSTRACT_MARRIAGE_BACKGROUND_VERSION } from '../../simulation/population/abstract-marriage-background.ts'
import { rngVersion } from '../../simulation/random.ts'
import { B009_DEMAND_RULE_VERSION, b009DemandModelKey, createB009DemandObserver } from '../../simulation/rules/b/index.ts'
import {
  createMultiHouseWorld, digestMultiHouseIdentity, multiHouseRunConfigIdentity, MULTI_HOUSE_RUN_CONDITIONS,
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
  return createAbstractEvaluators(startWorld, ledger)
}

function createAbstractEvaluators(startWorld: WorldState, ledger: readonly StatModifier[], drift?: 0 | 1): EvaluatorMap {
  const calibration = drift === undefined ? ABSTRACT_B009_CALIBRATION : demandCalibration(drift)
  const modelKey = drift === undefined ? undefined : b009DemandModelKey(MULTI_HOUSE_TRUST_BASE, calibration)
  if (startWorld.pairTrustDrift !== drift || startWorld.pairTrustModelKey !== modelKey)
    throw new RangeError('MULTI_HOUSE_PAIR_TRUST_MODEL_MISMATCH')
  const trial = createExperimentalOrdinaryLegalTrial()
  const result = createAutonomousCalibrationEvaluators({
    branchStartWorld: startWorld, ledger, trustBase: MULTI_HOUSE_TRUST_BASE,
    nextgenMarriage: {book: trial.book, laws: trial.laws, calibration: MULTI_HOUSE_NEXTGEN_CONTRACT},
    reviewedLegal: {book: trial.book, ordinaryLaws: trial.laws},
    spouseDeathDissolution: true, abstractMarriageSupply: MULTI_HOUSE_ABSTRACT_MARRIAGE,
    autonomy: MULTI_HOUSE_AUTONOMY, b009Calibration: calibration,
    ...(drift === undefined ? {} : {demandDrivenPairTrust: true}),
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

// 工程2Eの独立構成。annualDelta=0は反証用であり、既定の校正を置き換えない。
export const MULTI_HOUSE_DEMAND_CONFIG_ID = 'experimental-multi-house-v2-demand-relations'
const demandConfigId = (drift: 0 | 1) => drift === 1 ? MULTI_HOUSE_DEMAND_CONFIG_ID : MULTI_HOUSE_DEMAND_CONFIG_ID + '-drift-0'
function demandCalibration(drift: 0 | 1) {
  if (drift !== 0 && drift !== 1) throw new RangeError('INVALID_PAIR_TRUST_DRIFT')
  return {...ABSTRACT_B009_CALIBRATION, annualDelta: drift}
}

export function createMultiHouseDemandWorld(drift: 0 | 1 = 1): WorldState {
  const world = createMultiHouseWorld()
  const calibration = demandCalibration(drift)
  return {...world, pairTrustDrift: calibration.annualDelta, pairTrustModelKey: b009DemandModelKey(MULTI_HOUSE_TRUST_BASE, calibration),
    pairTrustThroughYear: world.year - 1, persons: world.persons.map(p => ({...p, firstPairTrustYear: world.year}))}
}

export function createMultiHouseDemandEvaluators(startWorld: WorldState, ledger: readonly StatModifier[] = [], drift: 0 | 1 = 1): EvaluatorMap {
  return createAbstractEvaluators(startWorld, ledger, demandCalibration(drift).annualDelta)
}

/** 基礎値の観測。介入の確定や過去イベントの生成はしない。 */
export function createMultiHouseDemandTrustObserver(drift: 0 | 1 = 1) {
  return createB009DemandObserver(MULTI_HOUSE_TRUST_BASE, demandCalibration(drift))
}

export function multiHouseDemandRunConfigIdentity(drift: 0 | 1 = 1): Readonly<Record<string, unknown>> {
  const shared = multiHouseAbstractRunConfigIdentity()
  return {...shared, configId: demandConfigId(drift), world: createMultiHouseDemandWorld(drift), b009: demandCalibration(drift),
    ruleVersions: {...shared.ruleVersions as Record<string, unknown>, b009: B009_DEMAND_RULE_VERSION}}
}

export function multiHouseDemandRunConfigDigest(drift: 0 | 1 = 1): string {
  return digestMultiHouseIdentity(multiHouseDemandRunConfigIdentity(drift))
}
