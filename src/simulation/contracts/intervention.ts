// 介入基盤の共有型（契約 §7）。後続の B-009 / B-004 / B-005 / forkHistory が依存する公開境界。
// 数値の上下限・減衰・丸めは CALIBRATION_ONLY の技術試験値であり、仕様ではない（pending-approvals 参照）。
import type { Id, TargetRef } from './primitives.ts'
import type { RuleId } from './rule-ids.ts'

/** 介入規則の版。modifier の ruleVersion はこれと一致しなければ拒否する（旧版を暗黙に新規則へ当てない）。 */
export const STAT_MODIFIER_RULE_VERSION = 'stat-modifier-calibration-0'

/** 現在登録されている statKey は `pair.trust` のみ。 */
export const PAIR_TRUST_STAT_KEY = 'pair.trust'
export type StatKey = typeof PAIR_TRUST_STAT_KEY

/** 契約 §7 の StatDefinition（pair.trust 最小版）。範囲は校正値で、仕様確定値ではない。 */
export type StatDefinition = Readonly<{
  statKey: StatKey
  targetKind: 'PERSON_PAIR'
  ownerDomain: 'B'
  unit: 'POINT'
  min: number
  max: number
  /** min / max が未承認の試験値であることの明示。 */
  rangeStatus: 'CALIBRATION_ONLY'
  valueKind: 'BASE'
  playerEditable: true
  editPolicy: 'BOUNDED_MODIFIER'
  /** 参照予定のルール。いずれも RuleRegistry では TODO のまま（実際の参照は未実装）。 */
  referencingRuleIds: readonly RuleId[]
}>

/** 契約 §7 の StatModifier（trace.ts で定義）。pair.trust では targetRef は正規化済み PERSON_PAIR。 */
export type PairTrustTargetRef = Extract<TargetRef, { kind: 'PERSON_PAIR' }>

/** 人物ペアの信頼の基礎値（不変）。personIds は ID 昇順・相異。 */
export type PairTrustBase = Readonly<{
  personIds: readonly [Id, Id]
  value: number
}>

export type StatModifierIssueCode =
  | 'UNREGISTERED_STAT_KEY'
  | 'INVALID_TARGET_KIND'
  | 'INVALID_PERSON_ID'
  | 'PERSON_PAIR_NOT_NORMALIZED'
  | 'SELF_PAIR'
  | 'UNKNOWN_PERSON'
  | 'INVALID_DELTA'
  | 'DELTA_OUT_OF_RANGE'
  | 'INVALID_PERIOD'
  | 'INVALID_DECAY_POLICY'
  | 'UNSUPPORTED_RULE_VERSION'
  | 'INVALID_ID'
  | 'DUPLICATE_MODIFIER_ID'
  | 'DUPLICATE_SAME_YEAR_TARGET_STAT'
  | 'INVALID_BASE_VALUE'
  | 'DUPLICATE_BASE_PAIR'
  | 'INVALID_YEAR'

export type StatModifierIssue = Readonly<{
  code: StatModifierIssueCode
  path: string
  message: string
}>

/** 年初 t における pair.trust の解決結果。 */
export type PairTrustResolution =
  | Readonly<{
      status: 'RESOLVED'
      personIds: readonly [Id, Id]
      year: number
      base: number
      /** 有効 modifier の寄与合計（丸め・clamp 前）。 */
      rawModifierSum: number
      /** base + 寄与合計を一度だけ丸め・clamp した値。B-009/B-004/B-005 が参照する値。 */
      effective: number
      /** 年 t に有効な modifier の ID（modifierId 昇順）。DecisionTrace.modifierIds へ渡す。 */
      modifierIds: readonly Id[]
      contributions: readonly Readonly<{ modifierId: Id; contribution: number }>[]
    }>
  /** 基礎値が未登録のペア。信頼値を発明しない。 */
  | Readonly<{ status: 'NO_BASE'; personIds: readonly [Id, Id]; year: number; modifierIds: readonly Id[] }>
