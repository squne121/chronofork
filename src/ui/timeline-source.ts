// runTimeline の実結果を UI の閲覧用に引く読み取り adapter。
// ゲーム規則は一切持たない: 人口の増減は EventLog の before/after、Trace の根拠は Trace の記録をそのまま示す。
// 用途は CALIBRATION_ONLY・experimental/partial の試験閲覧であり、本番の原史でも勝敗でもない。
import { createExperimentalScenario } from '../scenario/experimental/index.ts'
import type { DecisionTrace, EventLogEntry, Id, JsonValue, WorldState } from '../simulation/contracts/index.ts'
import { GOAL_YEAR, START_YEAR } from '../simulation/contracts/index.ts'
import { runTimeline } from '../simulation/engine/index.ts'
import type { TimelineResult } from '../simulation/engine/index.ts'
import { rngVersion } from '../simulation/random.ts'
import { createCalibrationEvaluators } from '../simulation/rules/c/index.ts'
import { EXPERIMENTAL_TUNING } from '../simulation/tuning.ts'

export const DEFAULT_SEED = 1

/** 画面に示す実行入力（入力・版・seed）。 */
export type RunInputs = Readonly<{
  seed: number
  scenarioId: string
  rulesetVersion: string
  rngVersion: string
  evaluatedRuleIds: readonly string[]
}>

export type TimelineRun = Readonly<{ inputs: RunInputs; result: TimelineResult; initialWorld: WorldState }>

/** 明示的な試験計算。C-004 人口コホート（CALIBRATION_ONLY）のみを注入し、勝敗評価は要求しない。 */
export function runExperimentalTimeline(seed: number): TimelineRun {
  const scenario = createExperimentalScenario()
  const evaluators = createCalibrationEvaluators(EXPERIMENTAL_TUNING)
  const result = runTimeline(scenario.world, { seed, evaluators })
  return {
    inputs: {
      seed,
      scenarioId: scenario.id,
      rulesetVersion: EXPERIMENTAL_TUNING.rulesetVersion,
      rngVersion,
      evaluatedRuleIds: Object.keys(evaluators),
    },
    result,
    initialWorld: scenario.world,
  }
}

/** 実際に計算された最後の年初 snapshot の年。snapshot が無ければ undefined。 */
export function lastComputedYear(result: TimelineResult): number | undefined {
  const last = result.snapshots[result.snapshots.length - 1]
  return last?.year
}

export function snapshotOf(result: TimelineResult, year: number): WorldState | undefined {
  return result.snapshots.find((s) => s.year === year)
}

export const YEAR_RANGE = { min: START_YEAR, max: GOAL_YEAR } as const

export type TraceIndex = Readonly<{
  trace: (id: Id) => DecisionTrace | undefined
  event: (id: Id) => EventLogEntry | undefined
  /** event.sourceTraceIds の各 Trace が eventIds に当該 Event を含むか（双方向一致）。 */
  backlinkConsistent: (event: EventLogEntry) => boolean
  /** trace.eventIds の各 Event が sourceTraceIds に当該 Trace を含むか。 */
  forwardConsistent: (trace: DecisionTrace) => boolean
}>

export function indexHistory(result: TimelineResult): TraceIndex {
  const traces = new Map(result.decisionTraces.map((t) => [t.traceId, t]))
  const events = new Map(result.eventLog.map((e) => [e.eventId, e]))
  return {
    trace: (id) => traces.get(id),
    event: (id) => events.get(id),
    backlinkConsistent: (e) =>
      e.sourceTraceIds.length > 0 && e.sourceTraceIds.every((id) => traces.get(id)?.eventIds.includes(e.eventId) === true),
    forwardConsistent: (t) =>
      t.eventIds.length > 0 && t.eventIds.every((id) => events.get(id)?.sourceTraceIds.includes(t.traceId) === true),
  }
}

export type NumericChange = Readonly<{ path: string; before: number; after: number; delta: number }>

/** 数値の状態差分のみを取り出す（表示用の引き算。規則ではない）。 */
export function numericChanges(event: EventLogEntry): readonly NumericChange[] {
  return event.stateChanges.flatMap((c) =>
    typeof c.before === 'number' && typeof c.after === 'number'
      ? [{ path: c.path, before: c.before, after: c.after, delta: c.after - c.before }]
      : [],
  )
}

export function formatJson(v: JsonValue): string {
  return typeof v === 'string' ? v : JSON.stringify(v)
}

export function formatDelta(n: number): string {
  return `${n >= 0 ? '+' : '−'}${Math.abs(n).toLocaleString('ja-JP')}`
}

export function eventsOfYear(result: TimelineResult, year: number): readonly EventLogEntry[] {
  return result.eventLog.filter((e) => e.year === year)
}

/** 正式な勝敗の表示。goal が無ければ未成立。technicalGoal は非権威で勝敗として使わない。 */
export function goalStatusLabel(result: TimelineResult): string {
  if (result.goal === null) return '正式な勝敗は未成立（goal=null・自律歴史 NOT_ESTABLISHED）'
  return `権威ある判定あり（${result.goal.status}）`
}
