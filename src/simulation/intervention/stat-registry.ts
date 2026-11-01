// StatDefinition の最小登録・参照境界。現在は pair.trust 1 項目のみ。
import type { StatDefinition, StatKey } from '../contracts/index.ts'
import { PAIR_TRUST_STAT_KEY } from '../contracts/index.ts'

/**
 * pair.trust の定義。min/max は CALIBRATION_ONLY の試験値（承認済み仕様ではない）。
 * 結果・法的状態ではなく B ドメインの基礎値であり、介入は BOUNDED_MODIFIER 経由のみ。
 */
export const PAIR_TRUST_DEFINITION: StatDefinition = Object.freeze({
  statKey: PAIR_TRUST_STAT_KEY,
  targetKind: 'PERSON_PAIR',
  ownerDomain: 'B',
  unit: 'POINT',
  min: -100,
  max: 100,
  rangeStatus: 'CALIBRATION_ONLY',
  valueKind: 'BASE',
  playerEditable: true,
  editPolicy: 'BOUNDED_MODIFIER',
  referencingRuleIds: Object.freeze(['B-004', 'B-005', 'B-009'] as const),
})

const DEFINITIONS: ReadonlyMap<string, StatDefinition> = new Map([[PAIR_TRUST_STAT_KEY, PAIR_TRUST_DEFINITION]])

/** 登録済みなら定義、未登録なら undefined。 */
export function getStatDefinition(statKey: string): StatDefinition | undefined {
  return DEFINITIONS.get(statKey)
}

export function isRegisteredStatKey(statKey: string): statKey is StatKey {
  return DEFINITIONS.has(statKey)
}

export function listStatDefinitions(): readonly StatDefinition[] {
  return [...DEFINITIONS.values()]
}
