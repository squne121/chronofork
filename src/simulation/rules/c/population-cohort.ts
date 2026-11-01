// RULE-C-004 の人口コホート枠評価器（CALIBRATION_ONLY の技術試験）。
// 契約 §4 の暫定分解式 delta = round(P*(1+g)) − P; B = max(0, round(P*b), delta); N = B − delta を
// TuningConfig の係数から計算する。係数は採用済みのゲーム法則ではなく、ここにはハードコードしない。
// WorldState は変更しない。確定は共通 reducer（applyOutcome）の POPULATION_COHORT に委ねる。
import type {
  DomainCommand,
  Id,
  PopulationGroup,
  RuleOutcome,
  Source,
  WorldState,
  Year,
} from '../../contracts/index.ts'
import { GOAL_YEAR, START_YEAR } from '../../contracts/index.ts'
import type { TuningConfig } from '../../tuning.ts'
import { validateTuningConfig } from '../../validation/index.ts'

export const POPULATION_COHORT_RULE_ID = 'RULE-C-004'
/** 契約 §6: C① は Phase 1。 */
export const POPULATION_COHORT_PHASE = 1
/** 年次の枠確定という意味的原因。ID の一部に使う。 */
export const POPULATION_COHORT_CAUSE = 'ANNUAL_COHORT'

export type CohortDiagnosticCode =
  | 'INVALID_YEAR'
  | 'YEAR_OUT_OF_RANGE'
  | 'TUNING_INVALID'
  | 'TUNING_COEFFICIENT_INVALID'
  | 'INVALID_POPULATION'
  | 'COHORT_ALREADY_SET'

export type CohortDiagnostic = Readonly<{
  code: CohortDiagnosticCode
  message: string
  groupId?: Id
}>

export type CohortSlotAllocation = Readonly<{
  groupId: Id
  population: number
  delta: number
  birthSlots: number
  deathSlots: number
}>

export type CohortEvaluation = Readonly<{
  /** 診断が無い場合に限らず、評価できた Group のコマンドだけを含む。評価不能なら commands は空。 */
  outcome: RuleOutcome
  /** Group ごとの内訳（Trace 統合が #15 で確定するまでの単体確認用。共有契約ではない）。 */
  allocations: readonly CohortSlotAllocation[]
  /** 保留・拒否の理由。空でなければ当該入力は成功扱いにしない。 */
  diagnostics: readonly CohortDiagnostic[]
  ok: boolean
}>

/** 非負の分子 n と正の分母 d の四捨五入（.5 は切り上げ）。浮動小数誤差を避けて整数で計算する。 */
const roundDiv = (n: number, d: number): number => Math.floor((2 * n + d) / (2 * d))

/** 契約 §4 の暫定分解式。birth/growth は permille。P は非負整数、birth >= 0、growth >= −1000。 */
export function decomposePopulation(
  population: number,
  birthRatePermille: number,
  growthRatePermille: number,
): Omit<CohortSlotAllocation, 'groupId' | 'population'> {
  const delta = roundDiv(population * (1000 + growthRatePermille), 1000) - population
  const birthSlots = Math.max(0, roundDiv(population * birthRatePermille, 1000), delta)
  return { delta, birthSlots, deathSlots: birthSlots - delta }
}

/** 年・RuleID・Group・意味的原因から決定的に作る。配列順・乱数・時刻に依存しない。 */
export const cohortRequestId = (year: Year, groupId: Id): Id =>
  `req:${year}:${POPULATION_COHORT_RULE_ID}:${groupId}:${POPULATION_COHORT_CAUSE}`
export const cohortCommandId = (year: Year, groupId: Id): Id =>
  `cmd:${year}:${POPULATION_COHORT_RULE_ID}:${groupId}:${POPULATION_COHORT_CAUSE}`
/**
 * Source.sourceTraceId は必須項目のため決定的に埋めるが、DecisionTrace の traceId と
 * 結合された値ではない（Trace/EventLog の ID 規約は #15 が確立する。それまで接続を推測しない）。
 */
export const cohortProvisionalTraceId = (year: Year, groupId: Id): Id =>
  `provisional-trace:${year}:${POPULATION_COHORT_RULE_ID}:${groupId}:${POPULATION_COHORT_CAUSE}`

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)

function emptyOutcome(): RuleOutcome {
  return {
    ruleId: POPULATION_COHORT_RULE_ID,
    phase: POPULATION_COHORT_PHASE,
    commands: [],
    requests: [],
    deferred: [],
    traceDrafts: [],
  }
}

const failed = (diagnostics: readonly CohortDiagnostic[]): CohortEvaluation => ({
  outcome: emptyOutcome(),
  allocations: [],
  diagnostics,
  ok: false,
})

/**
 * 当年（world.year）の全 Group について出生枠・自然死枠を評価し、POPULATION_COHORT を持つ RuleOutcome を返す。
 * 純粋関数: world / tuning を変更せず、例外を投げず、診断付きで保留する。
 */
export function evaluatePopulationCohorts(world: WorldState, tuning: TuningConfig): CohortEvaluation {
  const year = world.year
  if (!Number.isInteger(year)) {
    return failed([{ code: 'INVALID_YEAR', message: `年が整数ではありません: ${String(year)}` }])
  }
  // 契約 §6/§9: 1350 年は評価のみで新年度計算（①〜⑦）を実行しない。
  if (year < START_YEAR || year >= GOAL_YEAR) {
    return failed([
      { code: 'YEAR_OUT_OF_RANGE', message: `年次計算は ${START_YEAR}..${GOAL_YEAR - 1} 年のみです: ${year}` },
    ])
  }

  const tuningCheck = validateTuningConfig(tuning)
  if (!tuningCheck.ok) {
    return failed(
      tuningCheck.diagnostics.map((d) => ({ code: 'TUNING_INVALID', message: `${d.path}: ${d.message}` })),
    )
  }
  const b = tuning.birthRatePermille.value
  const g = tuning.growthRatePermille.value
  const coefficientProblems: CohortDiagnostic[] = []
  if (!Number.isSafeInteger(b) || b < 0) {
    coefficientProblems.push({ code: 'TUNING_COEFFICIENT_INVALID', message: `birthRatePermille は非負整数です: ${b}` })
  }
  if (!Number.isSafeInteger(g) || g < -1000) {
    coefficientProblems.push({ code: 'TUNING_COEFFICIENT_INVALID', message: `growthRatePermille は −1000 以上の整数です: ${g}` })
  }
  if (coefficientProblems.length > 0) return failed(coefficientProblems)

  const diagnostics: CohortDiagnostic[] = []
  const allocations: CohortSlotAllocation[] = []
  const commands: DomainCommand[] = []
  const groups: readonly PopulationGroup[] = [...world.groups].sort((x, y) => cmp(x.groupId, y.groupId))

  for (const group of groups) {
    const { groupId, population } = group
    if (!Number.isSafeInteger(population) || population < 0) {
      diagnostics.push({ code: 'INVALID_POPULATION', groupId, message: `人口が非負整数ではありません: ${String(population)}` })
      continue
    }
    if (world.demographics.cohortSlots.some((s) => s.groupId === groupId && s.year === year)) {
      diagnostics.push({ code: 'COHORT_ALREADY_SET', groupId, message: `${year} 年の枠は確定済みです` })
      continue
    }
    const slots = decomposePopulation(population, b, g)
    const source: Source = {
      requestId: cohortRequestId(year, groupId),
      year,
      phase: POPULATION_COHORT_PHASE,
      sourceRuleId: POPULATION_COHORT_RULE_ID,
      sourceTraceId: cohortProvisionalTraceId(year, groupId),
    }
    allocations.push({ groupId, population, ...slots })
    commands.push({
      type: 'POPULATION_COHORT',
      commandId: cohortCommandId(year, groupId),
      source,
      groupId,
      year,
      birthSlots: slots.birthSlots,
      deathSlots: slots.deathSlots,
    })
  }

  return {
    outcome: { ...emptyOutcome(), commands },
    allocations,
    diagnostics,
    ok: diagnostics.length === 0,
  }
}
