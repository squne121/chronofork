// 第1縦断向け pair.trust の experimental 技術 fixture（CALIBRATION_ONLY）。
// 正式な人物関係設定ではない。値はすべて試験用の仮値で、B-004/005 の採否や婚姻成立を示さない。
import type { PairTrustBase, StatModifier } from '../../simulation/contracts/index.ts'
import { STAT_MODIFIER_RULE_VERSION } from '../../simulation/contracts/index.ts'
import type { StatModifierLedger } from '../../simulation/intervention/index.ts'
import type { ProvenanceEntry } from './provenance.ts'
import { createExperimentalWorld } from './world-1250.ts'

const GAP = 'docs/spec/pending-approvals.md（人物間信頼の数値は未承認）'

/** 試験用の基礎値。3 組のみで、他のペアは意図的に未登録（信頼値を発明しない）。 */
export const EXPERIMENTAL_PAIR_TRUST_BASE: readonly PairTrustBase[] = Object.freeze([
  Object.freeze({ personIds: Object.freeze(['person-exp-01', 'person-exp-02'] as const), value: 10 }),
  Object.freeze({ personIds: Object.freeze(['person-exp-01', 'person-exp-03'] as const), value: -30 }),
  Object.freeze({ personIds: Object.freeze(['person-exp-02', 'person-exp-03'] as const), value: 95 }),
])

/** 介入なしの空台帳。 */
export const EXPERIMENTAL_EMPTY_LEDGER: StatModifierLedger = Object.freeze([])

/** 仕様の初期検証例「人物間信頼 +20 / 5 年」(mvp-spec §介入)。補正量・期間は暫定で CALIBRATION_ONLY。 */
export const EXPERIMENTAL_TRUST_BOOST: StatModifier = Object.freeze({
  modifierId: 'mod-exp-trust-boost',
  interventionId: 'int-exp-trust-boost',
  targetRef: Object.freeze({ kind: 'PERSON_PAIR', ids: Object.freeze(['person-exp-01', 'person-exp-02'] as const) }),
  statKey: 'pair.trust',
  signedDelta: 20,
  startYear: 1250,
  endExclusiveYear: 1255,
  decayPolicy: 'NONE',
  ruleVersion: STAT_MODIFIER_RULE_VERSION,
})

/** 試験パラメータの明示。いずれも CALIBRATION_ONLY で仕様確定値ではない。 */
export const EXPERIMENTAL_PAIR_TRUST_CALIBRATION = Object.freeze({
  status: 'CALIBRATION_ONLY',
  range: Object.freeze({ min: -100, max: 100 }),
  rounding: 'HALF_AWAY_FROM_ZERO（合計後に一度だけ丸め・clamp）',
  linearDecay: '開始年が全量、以降 (end-t)/(end-start) へ逓減',
  sampleModifier: Object.freeze({ signedDelta: 20, years: 5, decayPolicy: 'NONE' }),
})

export const EXPERIMENTAL_PAIR_TRUST_PROVENANCE: readonly ProvenanceEntry[] = Object.freeze([
  { subject: 'pair.trust の値域 -100..100・丸め・線形減衰', origin: 'PLACEHOLDER', source: GAP, note: 'CALIBRATION_ONLY' },
  { subject: '人物ペア 3 組の基礎値（10 / -30 / 95）', origin: 'PLACEHOLDER', source: GAP, note: 'CALIBRATION_ONLY。他のペアは未登録（発明しない）' },
  { subject: '+20 / 5 年の試験 modifier', origin: 'SPEC_KNOWN', source: 'docs/spec/mvp-spec.md §5（初期検証例・暫定値）', note: '既定の補正量・期間は暫定' },
] satisfies ProvenanceEntry[])

/** experimental 世界の人物 ID 集合（modifier / 基礎値の人物検証に使う）。 */
export function experimentalKnownPersonIds(): ReadonlySet<string> {
  return new Set(createExperimentalWorld().persons.map((p) => p.personId))
}
