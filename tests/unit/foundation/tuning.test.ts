import { describe, expect, it } from 'vitest'
import { EXPERIMENTAL_TUNING } from '../../../src/simulation/tuning.ts'
import { validateTuningConfig } from '../../../src/simulation/validation/index.ts'
import { codes } from './helpers.ts'

describe('TuningConfig', () => {
  it('CALIBRATION_ONLY と rulesetVersion を保持し、検証を通る', () => {
    expect(EXPERIMENTAL_TUNING.status).toBe('CALIBRATION_ONLY')
    expect(EXPERIMENTAL_TUNING.rulesetVersion).toBe('experimental-0')
    const r = validateTuningConfig(JSON.parse(JSON.stringify(EXPERIMENTAL_TUNING)))
    expect(r.ok).toBe(true)
    expect(r.tuning).toEqual(EXPERIMENTAL_TUNING)
  })

  it('由来（技術提案/仮値）を区別し、国庫 45/100 の BU 換算は未承認のまま', () => {
    expect(EXPERIMENTAL_TUNING.milliBUPerBU.origin).toBe('PROPOSED_TECHNICAL')
    expect(EXPERIMENTAL_TUNING.birthRatePermille.origin).toBe('PLACEHOLDER')
    expect(EXPERIMENTAL_TUNING.treasuryDisplayConversion.status).toBe('UNAPPROVED')
  })

  it('CALIBRATION_ONLY 以外・版欠落・不正値を拒否する', () => {
    const base = JSON.parse(JSON.stringify(EXPERIMENTAL_TUNING)) as Record<string, unknown>
    expect(codes(validateTuningConfig({ ...base, status: 'ADOPTED' }).diagnostics)).toContain('TUNING_NOT_CALIBRATION_ONLY')
    expect(codes(validateTuningConfig({ ...base, rulesetVersion: '' }).diagnostics)).toContain('MISSING_FIELD')
    expect(codes(validateTuningConfig({ ...base, milliBUPerBU: { value: NaN, origin: 'PLACEHOLDER', note: '' } }).diagnostics)).toContain('INVALID_TYPE')
    expect(codes(validateTuningConfig({ ...base, treasuryDisplayConversion: { status: 'APPROVED', note: '' } }).diagnostics)).toContain('INVALID_ENUM')
    expect(validateTuningConfig(null).ok).toBe(false)
  })
})
