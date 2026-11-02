// WorldState起点の人物自律評価器用の試験係数。ゲーム規則としては未採用。
// 年や人物IDをイベント表として指定せず、状態・年齢・決定的RNGで毎年判定する。
export type AutonomyCalibration = Readonly<{
  status: 'CALIBRATION_ONLY'
  birth: Readonly<{
    minMotherAge: number
    maxMotherAge: number
    minFatherAge: number
    chancePermille: number
  }>
  death: Readonly<{
    minAge: number
    riskStartAge: number
    basePermille: number
    increasePerYearPermille: number
    maxPermille: number
  }>
  marriage: Readonly<{
    minAdultAge: number
    maxCandidatePairs: number
  }>
}>

export const EXPERIMENTAL_AUTONOMY: AutonomyCalibration = Object.freeze({
  status: 'CALIBRATION_ONLY',
  birth: Object.freeze({ minMotherAge: 18, maxMotherAge: 44, minFatherAge: 18, chancePermille: 140 }),
  death: Object.freeze({ minAge: 1, riskStartAge: 40, basePermille: 1, increasePerYearPermille: 12, maxPermille: 900 }),
  marriage: Object.freeze({ minAdultAge: 18, maxCandidatePairs: 500 }),
})

export type AutonomyCalibrationIssue = Readonly<{ path: string; code: 'INVALID_CALIBRATION' }>

const integer = (v: unknown): v is number => Number.isSafeInteger(v) && typeof v === 'number'
const chance = (v: unknown): v is number => integer(v) && v >= 0 && v <= 1000

/** 未承認の校正値は入力検証の後に固定し、実行途中の外部書換による再現性喪失を防ぐ。 */
export function validateAutonomyCalibration(
  c: AutonomyCalibration,
): Readonly<{ ok: true; config: AutonomyCalibration }> | Readonly<{ ok: false; issues: readonly AutonomyCalibrationIssue[] }> {
  const errors: AutonomyCalibrationIssue[] = []
  const invalid = (path: string) => errors.push({ path, code: 'INVALID_CALIBRATION' })
  if (!c || c.status !== 'CALIBRATION_ONLY' || !c.birth || !c.death || !c.marriage) {
    return { ok: false, issues: [{ path: 'config', code: 'INVALID_CALIBRATION' }] }
  }
  for (const k of ['minMotherAge','maxMotherAge','minFatherAge'] as const) {
    if (!integer(c.birth[k]) || c.birth[k] < 0 || c.birth[k] > 150) invalid('birth.' + k)
  }
  if (integer(c.birth.minMotherAge) && integer(c.birth.maxMotherAge) && c.birth.minMotherAge > c.birth.maxMotherAge) invalid('birth.ageRange')
  if (!chance(c.birth.chancePermille)) invalid('birth.chancePermille')
  for (const k of ['minAge','riskStartAge'] as const) {
    if (!integer(c.death[k]) || c.death[k] < 0 || c.death[k] > 200) invalid('death.' + k)
  }
  if (!chance(c.death.basePermille)) invalid('death.basePermille')
  if (!chance(c.death.increasePerYearPermille)) invalid('death.increasePerYearPermille')
  if (!chance(c.death.maxPermille)) invalid('death.maxPermille')
  if (chance(c.death.basePermille) && chance(c.death.maxPermille) && c.death.maxPermille < c.death.basePermille) invalid('death.maxPermille')
  if (!integer(c.marriage.minAdultAge) || c.marriage.minAdultAge < 0 || c.marriage.minAdultAge > 150) invalid('marriage.minAdultAge')
  if (!integer(c.marriage.maxCandidatePairs) || c.marriage.maxCandidatePairs < 1 || c.marriage.maxCandidatePairs > 10000) invalid('marriage.maxCandidatePairs')
  if (errors.length) return { ok: false, issues: errors }
  return { ok: true, config: Object.freeze({
    status: 'CALIBRATION_ONLY',
    birth: Object.freeze({ ...c.birth }),
    death: Object.freeze({ ...c.death }),
    marriage: Object.freeze({ ...c.marriage }),
  }) }
}

export const checkAutonomyCalibration = (c: AutonomyCalibration): AutonomyCalibration => {
  const result = validateAutonomyCalibration(c)
  if (!result.ok) throw new RangeError('CALIBRATION_ONLY係数が不正: ' + JSON.stringify(result.issues))
  return result.config
}
