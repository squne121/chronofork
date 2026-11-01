import type { WorldState } from '../contracts/index.ts'
import type { Diagnostic, ValidationResult } from './diagnostics.ts'
import { hasErrors } from './diagnostics.ts'
import { checkWorldIntegrity } from './integrity.ts'
import { parseWorldState } from './parse.ts'

export type { Diagnostic, DiagnosticCode, DiagnosticSeverity, DiagnosticTarget, ValidationResult } from './diagnostics.ts'
export { hasErrors } from './diagnostics.ts'
export { checkWorldIntegrity } from './integrity.ts'
export { parseWorldState } from './parse.ts'
export { INITIAL_SCALE, validateInitialScale } from './initial-scale.ts'
export type { TuningValidationResult } from './tuning-config.ts'
export { validateTuningConfig } from './tuning-config.ts'

/**
 * 外部入力を WorldState として受理できるか検証する（構造 → 数値・参照・法制の整合）。
 * 入力は変更しない。ok のときのみ検証済みの複製を返す。
 * 相続・承認・税権移管・人口補正は実行しない。
 */
export function validateWorldState(input: unknown): ValidationResult {
  const diagnostics: Diagnostic[] = []
  const parsed: WorldState = parseWorldState(input, diagnostics)
  // 構造が壊れている入力は整合検証に進まない（不確かな値に基づく誤診断を避ける）。
  if (!hasErrors(diagnostics)) diagnostics.push(...checkWorldIntegrity(parsed))
  const ok = !hasErrors(diagnostics)
  return { ok, world: ok ? parsed : null, diagnostics }
}
