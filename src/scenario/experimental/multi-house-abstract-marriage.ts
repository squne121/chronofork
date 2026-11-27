// Issue #71 工程2Bの明示オプトイン。旧multi-house-v0の入口や校正値を差し替えない。
import type { StatModifier, WorldState } from '../../simulation/contracts/index.ts'
import { createAutonomousCalibrationEvaluators } from '../../simulation/autonomy/index.ts'
import type { AbstractMarriageSupplyConfig } from '../../simulation/autonomy/abstract-marriage-supply.ts'
import type { EvaluatorMap } from '../../simulation/engine/index.ts'
import { ABSTRACT_MARRIAGE_BACKGROUND_VERSION } from '../../simulation/population/abstract-marriage-background.ts'
import { rngVersion } from '../../simulation/random.ts'
import { B009_DEMAND_RULE_VERSION, b009DemandModelKey, createB009DemandObserver } from '../../simulation/rules/b/index.ts'
import { ANCESTRAL_HEIR_SEARCH_VERSION } from '../../simulation/rules/a/legal-heirs.ts'
import { B002_PATERNAL_HOUSE_VERSION } from '../../simulation/rules/b/b002-worldstate.ts'
import { B005_CHILD_HOUSE_VERSION } from '../../simulation/rules/b/b005-nextgen.ts'
import { CHILD_HOUSE_AFFILIATION_VERSION } from '../../simulation/legal/child-house.ts'
import type { ChildHouseContractCalibration, NextgenContractCalibration } from '../../simulation/legal/nextgen-contract.ts'
import type { HeirSearchMode } from '../../simulation/rules/a/legal-heirs.ts'
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

function createAbstractEvaluators(startWorld: WorldState, ledger: readonly StatModifier[], drift?: 0 | 1,
  heirSearch?: HeirSearchMode, childHouse?: true): EvaluatorMap {
  const calibration = drift === undefined ? ABSTRACT_B009_CALIBRATION : demandCalibration(drift)
  const modelKey = drift === undefined ? undefined : b009DemandModelKey(MULTI_HOUSE_TRUST_BASE, calibration)
  if (startWorld.pairTrustDrift !== drift || startWorld.pairTrustModelKey !== modelKey)
    throw new RangeError('MULTI_HOUSE_PAIR_TRUST_MODEL_MISMATCH')
  const trial = createExperimentalOrdinaryLegalTrial()
  const result = createAutonomousCalibrationEvaluators({
    branchStartWorld: startWorld, ledger, trustBase: MULTI_HOUSE_TRUST_BASE,
    nextgenMarriage: {book: trial.book, laws: trial.laws,
      calibration: childHouse ? MULTI_HOUSE_CHILD_HOUSE_NEXTGEN_CONTRACT : MULTI_HOUSE_NEXTGEN_CONTRACT},
    reviewedLegal: {book: trial.book, ordinaryLaws: trial.laws, ...(heirSearch ? {heirSearch} : {})},
    spouseDeathDissolution: true, abstractMarriageSupply: MULTI_HOUSE_ABSTRACT_MARRIAGE,
    autonomy: MULTI_HOUSE_AUTONOMY, b009Calibration: calibration,
    ...(drift === undefined ? {} : {demandDrivenPairTrust: true}),
    ...(childHouse ? {childHouseAffiliation: MULTI_HOUSE_CHILD_HOUSE_AFFILIATION} : {}),
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

// Issue #200 / DEC-189の独立構成。v2需要構成と同じ世界・校正・法令で、相続順位の探索範囲だけを変える。
// 既存のv2構成・限定試遊のidentity/digestと既定は変更しない。
export const MULTI_HOUSE_ANCESTRAL_CONFIG_ID = 'experimental-multi-house-v3-dec189-ancestral-heirs'
export const MULTI_HOUSE_ANCESTRAL_HEIR_SEARCH: HeirSearchMode = 'RECORDED_COMMON_ANCESTOR'
const ancestralConfigId = (drift: 0 | 1) => drift === 1 ? MULTI_HOUSE_ANCESTRAL_CONFIG_ID : MULTI_HOUSE_ANCESTRAL_CONFIG_ID + '-drift-0'

/** 開始世界はv2需要構成と同一。比較時の差分は評価器の相続順位探索に限る。 */
export function createMultiHouseAncestralEvaluators(startWorld: WorldState, ledger: readonly StatModifier[] = [], drift: 0 | 1 = 1): EvaluatorMap {
  return createAbstractEvaluators(startWorld, ledger, demandCalibration(drift).annualDelta, MULTI_HOUSE_ANCESTRAL_HEIR_SEARCH)
}

export function multiHouseAncestralRunConfigIdentity(drift: 0 | 1 = 1): Readonly<Record<string, unknown>> {
  const shared = multiHouseDemandRunConfigIdentity(drift)
  return {...shared, configId: ancestralConfigId(drift), heirSearch: MULTI_HOUSE_ANCESTRAL_HEIR_SEARCH,
    ruleVersions: {...shared.ruleVersions as Record<string, unknown>, heirSearch: ANCESTRAL_HEIR_SEARCH_VERSION}}
}

export function multiHouseAncestralRunConfigDigest(drift: 0 | 1 = 1): string {
  return digestMultiHouseIdentity(multiHouseAncestralRunConfigIdentity(drift))
}

// Issue #206 / DEC-190の独立構成。v3(DEC-189)と同じ世界・法令・相続探索で、出生児の家門を父方原則とし、
// 婚姻契約の明示的な母方家門条項を交渉可能にする。v0〜v3・限定試遊のidentity/digest/既定は変更しない。
export const MULTI_HOUSE_CHILD_HOUSE_CONFIG_ID = 'experimental-multi-house-v4-dec190-paternal-house'
export const MULTI_HOUSE_CHILD_HOUSE_AFFILIATION = 'DEC190_PATERNAL_PRINCIPLE' as const
/** 家門条項の当事者別利害。王朝条項の係数（MULTI_HOUSE_NEXTGEN_CONTRACT）とは独立した試験値で、正式規則ではない。 */
export const MULTI_HOUSE_CHILD_HOUSE_CONTRACT = Object.freeze({
  status: 'CALIBRATION_ONLY', version: 'dec190-child-house-contract-calibration-0',
  ownHouseBonus: 2, otherHouseCost: 2, exceptionCost: 3, titleWeight: 4, supportWeight: 1,
}) satisfies ChildHouseContractCalibration
export const MULTI_HOUSE_CHILD_HOUSE_NEXTGEN_CONTRACT: NextgenContractCalibration = Object.freeze({
  ...MULTI_HOUSE_NEXTGEN_CONTRACT, childHouse: MULTI_HOUSE_CHILD_HOUSE_CONTRACT,
})
const childHouseConfigId = (drift: 0 | 1) => drift === 1 ? MULTI_HOUSE_CHILD_HOUSE_CONFIG_ID : MULTI_HOUSE_CHILD_HOUSE_CONFIG_ID + '-drift-0'

/** 開始世界はv2/v3と同一。差分は出生時の家門所属と、その契約条項の交渉に限る。 */
export function createMultiHouseChildHouseEvaluators(startWorld: WorldState, ledger: readonly StatModifier[] = [], drift: 0 | 1 = 1): EvaluatorMap {
  return createAbstractEvaluators(startWorld, ledger, demandCalibration(drift).annualDelta, MULTI_HOUSE_ANCESTRAL_HEIR_SEARCH, true)
}

export function multiHouseChildHouseRunConfigIdentity(drift: 0 | 1 = 1): Readonly<Record<string, unknown>> {
  const shared = multiHouseAncestralRunConfigIdentity(drift)
  return {...shared, configId: childHouseConfigId(drift), nextgenContract: MULTI_HOUSE_CHILD_HOUSE_NEXTGEN_CONTRACT,
    childHouseAffiliation: MULTI_HOUSE_CHILD_HOUSE_AFFILIATION,
    ruleVersions: {...shared.ruleVersions as Record<string, unknown>, b002: B002_PATERNAL_HOUSE_VERSION,
      b005: B005_CHILD_HOUSE_VERSION, childHouse: CHILD_HOUSE_AFFILIATION_VERSION}}
}

export function multiHouseChildHouseRunConfigDigest(drift: 0 | 1 = 1): string {
  return digestMultiHouseIdentity(multiHouseChildHouseRunConfigIdentity(drift))
}
