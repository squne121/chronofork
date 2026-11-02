// 第1縦断の最小技術統合 fixture（synthetic / CALIBRATION_ONLY）。正式 scenario・RuleRegistry は変更しない。
// A0/A1 は下の単一の固定設定 B004_BRANCH_CONFIG と評価器ファクトリ evaluatorsForLedger から生成する。
// 人物 P4(男)/P5(女) は WorldState 上に親子・兄弟姉妹の明示関係がないだけで、婚姻適格性は未審査。
import { createExperimentalWorld } from '../../../src/scenario/experimental/index.ts'
import type { PairTrustBase, StatModifier, WorldState } from '../../../src/simulation/contracts/index.ts'
import { PAIR_TRUST_STAT_KEY, STAT_MODIFIER_RULE_VERSION } from '../../../src/simulation/contracts/index.ts'
import type { EvaluatorMap } from '../../../src/simulation/engine/index.ts'
import { createPairTrustView } from '../../../src/simulation/intervention/index.ts'
import type { StatModifierLedger } from '../../../src/simulation/intervention/index.ts'
import type { B004Calibration } from '../../../src/simulation/rules/b/index.ts'
import { createB004CalibrationEvaluator, createB004EvaluatorMap } from '../../../src/simulation/rules/b/index.ts'
import { createCalibrationEvaluators } from '../../../src/simulation/rules/c/index.ts'
import type { TuningConfig } from '../../../src/simulation/tuning.ts'
import { EXPERIMENTAL_TUNING } from '../../../src/simulation/tuning.ts'

export const P4 = 'person-exp-04'
export const P5 = 'person-exp-05'
export const SEED = 20260101
export const FORK_YEAR = 1260
export const BOOST_END_EXCLUSIVE = 1265

export type B004BranchConfig = Readonly<{
  provenance: 'synthetic'
  status: 'CALIBRATION_ONLY'
  seed: number
  tuning: TuningConfig
  b004: B004Calibration
  pairs: readonly (readonly [string, string])[]
  base: readonly PairTrustBase[]
}>

/** A0/A1 共通の唯一の設定。ここから外れた係数・閾値は同一条件と見なさない。 */
export const B004_BRANCH_CONFIG: B004BranchConfig = Object.freeze({
  provenance: 'synthetic',
  status: 'CALIBRATION_ONLY',
  seed: SEED,
  tuning: EXPERIMENTAL_TUNING,
  b004: Object.freeze({ status: 'CALIBRATION_ONLY', trustWeight: 1, acceptThreshold: 30 }),
  pairs: Object.freeze([Object.freeze([P4, P5] as const)]),
  base: Object.freeze([Object.freeze({ personIds: Object.freeze([P4, P5] as const), value: 10 })]),
})

/** test-local の synthetic 世界。P5 のみ性別を FEMALE にする（P4 は MALE）。婚姻適格性は示さない。 */
export function createSyntheticWorld(): WorldState {
  const w = createExperimentalWorld()
  return { ...w, persons: w.persons.map((p) => (p.personId === P5 ? { ...p, sex: 'FEMALE' as const } : p)) }
}
export const knownPersonIds = (): ReadonlySet<string> => new Set(createSyntheticWorld().persons.map((p) => p.personId))

/** 台帳から新しい createPairTrustView を構成し、C004 と B004 を合成した EvaluatorMap を返す。 */
export function evaluatorsForLedger(ledger: StatModifierLedger, config: B004BranchConfig = B004_BRANCH_CONFIG, overrides: { b004?: B004Calibration } = {}): EvaluatorMap {
  const v = createPairTrustView({ base: config.base, ledger, knownPersonIds: knownPersonIds() })
  if (!v.ok) throw new Error(`view: ${JSON.stringify(v.issues)}`)
  const e = createB004CalibrationEvaluator({ pairs: config.pairs, view: v.view, calibration: overrides.b004 ?? config.b004 })
  if (!e.ok) throw new Error(`b004: ${JSON.stringify(e.issues)}`)
  return { ...createCalibrationEvaluators(config.tuning), ...createB004EvaluatorMap(e.evaluator) }
}

/** 1260 年に P4/P5 の pair.trust を +20、5 年間（[1260,1265)）。 */
export const TRUST_BOOST: StatModifier = Object.freeze({
  modifierId: 'mod-syn-p4p5-trust-boost',
  interventionId: 'int-syn-p4p5-trust-boost',
  targetRef: Object.freeze({ kind: 'PERSON_PAIR', ids: Object.freeze([P4, P5] as const) }),
  statKey: PAIR_TRUST_STAT_KEY,
  signedDelta: 20,
  startYear: FORK_YEAR,
  endExclusiveYear: BOOST_END_EXCLUSIVE,
  decayPolicy: 'NONE',
  ruleVersion: STAT_MODIFIER_RULE_VERSION,
})
