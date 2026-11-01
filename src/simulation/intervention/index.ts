// 介入基盤の公開境界。後続 worktree（B-009 / B-004 / B-005 / forkHistory）はここから import する。
export { normalizePersonPair, pairKey, toPairRef } from './pair.ts'
export { PAIR_TRUST_DEFINITION, getStatDefinition, isRegisteredStatKey, listStatDefinitions } from './stat-registry.ts'
export type {
  AddModifierResult,
  PairTrustView,
  PairTrustViewInput,
  StatModifierContext,
  StatModifierLedger,
  Validation,
} from './pair-trust.ts'
export {
  addStatModifier,
  createPairTrustView,
  modifierContribution,
  roundHalfAwayFromZero,
  validatePairTrustBase,
  validateStatModifier,
  validateStatModifierLedger,
} from './pair-trust.ts'
