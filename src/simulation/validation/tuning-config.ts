// 外部入力の TuningConfig を検証する。CALIBRATION_ONLY と rulesetVersion を必須とする。
import type { TuningConfig, TuningOrigin, TuningParameter } from '../tuning.ts'
import type { Diagnostic, DiagnosticCode } from './diagnostics.ts'

export type TuningValidationResult = Readonly<{
  ok: boolean
  tuning: TuningConfig | null
  diagnostics: readonly Diagnostic[]
}>

const ORIGINS: readonly TuningOrigin[] = ['PROPOSED_TECHNICAL', 'PLACEHOLDER']
type ParamKey = 'milliBUPerBU' | 'birthRatePermille' | 'growthRatePermille' | 'supportSignalScaleBps'

function isRecord(v: unknown): v is Readonly<Record<string, unknown>> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export function validateTuningConfig(input: unknown): TuningValidationResult {
  const diagnostics: Diagnostic[] = []
  const err = (code: DiagnosticCode, path: string, message: string) => {
    diagnostics.push({ code, severity: 'ERROR', path, target: null, message, related: [] })
  }
  if (!isRecord(input)) {
    err('INVALID_TYPE', '$', 'オブジェクトが必要です')
    return { ok: false, tuning: null, diagnostics }
  }
  if (input['status'] !== 'CALIBRATION_ONLY') {
    err('TUNING_NOT_CALIBRATION_ONLY', '$.status', 'TuningConfig は CALIBRATION_ONLY のみ受理します')
  }
  const rulesetVersion = input['rulesetVersion']
  if (typeof rulesetVersion !== 'string' || rulesetVersion === '') {
    err('MISSING_FIELD', '$.rulesetVersion', 'rulesetVersion が必要です')
  }
  const read = (key: ParamKey): TuningParameter => {
    const v = input[key]
    const path = `$.${key}`
    const fallback: TuningParameter = { value: 0, origin: 'PLACEHOLDER', note: '' }
    if (!isRecord(v)) {
      err(v === undefined ? 'MISSING_FIELD' : 'INVALID_TYPE', path, `${key} が必要です`)
      return fallback
    }
    const value = v['value']
    const origin = ORIGINS.find((o) => o === v['origin'])
    const note = v['note']
    if (typeof value !== 'number' || !Number.isFinite(value)) err('INVALID_TYPE', `${path}.value`, '有限な数値が必要です')
    if (origin === undefined) err('INVALID_ENUM', `${path}.origin`, `${ORIGINS.join(' | ')} のいずれかが必要です`)
    if (typeof note !== 'string') err('INVALID_TYPE', `${path}.note`, '由来の説明が必要です')
    return { value: typeof value === 'number' ? value : 0, origin: origin ?? 'PLACEHOLDER', note: typeof note === 'string' ? note : '' }
  }
  const milliBUPerBU = read('milliBUPerBU')
  const birthRatePermille = read('birthRatePermille')
  const growthRatePermille = read('growthRatePermille')
  const supportSignalScaleBps = read('supportSignalScaleBps')
  if (milliBUPerBU.value <= 0 || !Number.isSafeInteger(milliBUPerBU.value)) {
    err('OUT_OF_RANGE', '$.milliBUPerBU.value', 'milliBUPerBU は正の整数です')
  }
  const conv = input['treasuryDisplayConversion']
  if (!isRecord(conv) || conv['status'] !== 'UNAPPROVED' || typeof conv['note'] !== 'string') {
    err('INVALID_ENUM', '$.treasuryDisplayConversion', '国庫表示値→BU 換算は UNAPPROVED として明示してください')
  }
  const ok = diagnostics.length === 0
  if (!ok || typeof rulesetVersion !== 'string' || !isRecord(conv) || typeof conv['note'] !== 'string') {
    return { ok: false, tuning: null, diagnostics }
  }
  return {
    ok,
    tuning: {
      status: 'CALIBRATION_ONLY',
      rulesetVersion,
      milliBUPerBU,
      birthRatePermille,
      growthRatePermille,
      supportSignalScaleBps,
      treasuryDisplayConversion: { status: 'UNAPPROVED', note: conv['note'] },
    },
    diagnostics,
  }
}
