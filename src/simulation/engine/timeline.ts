// runTimeline: 開始年（通常 1250）→ 1350 の年初 snapshot 列を作る。1250〜1349 は runYear で 100 遷移、
// 1350 年は勝敗評価のみ（フェーズ①〜⑦を実行しない）。結果は深く凍結した読み取り専用値で、UI へ渡す境界。
import type { DecisionTrace, EventLogEntry, RuleId, WorldState } from '../contracts/index.ts'
import { GOAL_YEAR, START_YEAR } from '../contracts/index.ts'
import type { GoalOptions } from '../goal.ts'
import { evaluateGoal } from '../goal.ts'
import { rngVersion } from '../random.ts'
import { RULE_REGISTRY } from '../rule-registry.ts'
import { validateWorldState } from '../validation/index.ts'
import { cloneData } from './reducer/canonical.ts'
import type { AutonomousHistory, RuleCoverage, RunHalt, RunOptions, TimelineResult } from './types.ts'
import { deepFreeze, runYear } from './year.ts'

/**
 * 確定済みの年次進捗（観測専用）。runYear が成功し、年を跨ぐ ID 重複検査を通過して
 * snapshot に積まれた「後」にだけ通知される。未確定の未来・残り時間は含まない。
 */
export type YearProgress = Readonly<{
  branchId: string
  /** 区間の開始年（初期 WorldState の年）。 */
  startYear: number
  /** 区間の終了年（常に GOAL_YEAR）。 */
  goalYear: number
  /** 今回確定した遷移の年（この年の処理が完了した）。 */
  committedYear: number
  /** 確定した年初 snapshot の年（committedYear + 1）。ここまでが確定済み。 */
  confirmedYear: number
  /** 確定済みの遷移数 / この区間の遷移総数。 */
  transitionsDone: number
  transitionsTotal: number
  /** 確定済み区間で実際に記録された EventLog 件数の累計。 */
  eventCount: number
}>

export type TimelineOptions = RunOptions & Readonly<{
  /**
   * 観測用の任意 hook。結果・乱数・戻り値に影響しない（例外は握りつぶし、計算を止めない）。
   * 未指定時の挙動は従来と完全に同一。
   */
  onYearCommitted?: (progress: YearProgress) => void
  /** 1350 年の勝利判定に必要なシナリオ側設定。無ければ判定しない。 */
  goal?: GoalOptions
  /**
   * 技術検証用。true のとき、自律歴史が未成立でも technicalGoal に評価結果を入れる（非権威。
   * 実ルールが走っていない世界の評価は勝敗として扱わない）。
   */
  technicalGoalEvaluation?: boolean
}>

function coverageOf(executed: ReadonlySet<RuleId>): RuleCoverage {
  const ids = (status: 'IMPLEMENTED' | 'TODO') => RULE_REGISTRY.filter((r) => r.implementationStatus === status).map((r) => r.ruleId)
  const todoRuleIds = ids('TODO')
  return {
    implementedRuleIds: ids('IMPLEMENTED'),
    todoRuleIds,
    executedRuleIds: RULE_REGISTRY.map((r) => r.ruleId).filter((id) => executed.has(id)),
    injectedTodoRuleIds: todoRuleIds.filter((id) => executed.has(id)),
  }
}

function historyOf(status: TimelineResult['status'], coverage: RuleCoverage, halt: RunHalt | null, hasGoal: boolean): AutonomousHistory {
  const blockers: string[] = []
  if (coverage.todoRuleIds.length > 0) blockers.push(`RULES_TODO:${coverage.todoRuleIds.length}`)
  const unexecuted = coverage.implementedRuleIds.filter((id) => !coverage.executedRuleIds.includes(id))
  if (unexecuted.length > 0) blockers.push(`RULES_NOT_EXECUTED:${unexecuted.length}`)
  if (coverage.injectedTodoRuleIds.length > 0) blockers.push(`INJECTED_EVALUATORS_FOR_TODO_RULES:${coverage.injectedTodoRuleIds.length}`)
  if (status === 'HALTED') blockers.push(`HALTED:${halt?.code ?? 'UNKNOWN'}`)
  if (!hasGoal) blockers.push('GOAL_NOT_EVALUATED')
  return { status: blockers.length === 0 ? 'ESTABLISHED' : 'NOT_ESTABLISHED', blockers }
}

export function runTimeline(initial: WorldState, options: TimelineOptions): TimelineResult {
  const executed = new Set<RuleId>()
  const base = { seed: options.seed, branchId: options.branchId ?? 'main', rngVersion, startYear: initial.year }
  const finish = (
    snapshots: readonly WorldState[],
    eventLog: readonly EventLogEntry[],
    decisionTraces: readonly DecisionTrace[],
    halt: RunHalt | null,
    goal: TimelineResult['goal'],
    technicalGoal: TimelineResult['technicalGoal'] = null,
  ): TimelineResult => {
    const status = halt ? 'HALTED' : 'COMPLETED'
    const coverage = coverageOf(executed)
    return deepFreeze({
      status, ...base, snapshots, transitions: Math.max(0, snapshots.length - 1), eventLog, decisionTraces, goal, technicalGoal, halt, coverage,
      autonomousHistory: historyOf(status, coverage, halt, goal !== null),
    })
  }

  const valid = validateWorldState(initial)
  if (!valid.ok || initial.year < START_YEAR || initial.year > GOAL_YEAR) {
    return finish([], [], [], {
      code: valid.ok ? 'YEAR_OUT_OF_RANGE' : 'INVALID_INPUT_WORLD',
      year: initial.year, phase: null, ruleId: null,
      message: valid.ok ? `開始年は ${START_YEAR}〜${GOAL_YEAR} です` : '初期 WorldState が不正です',
      rejections: [], diagnostics: valid.diagnostics.filter((d) => d.severity === 'ERROR'), evaluatorDiagnostics: [], traces: [],
    }, null)
  }

  let world = cloneData(valid.world as WorldState)
  const snapshots: WorldState[] = [world]
  const eventLog: EventLogEntry[] = []
  const decisionTraces: DecisionTrace[] = []
  const seenIds = new Set<string>()

  while (world.year < GOAL_YEAR) {
    const r = runYear(world, options)
    r.executedRuleIds.forEach((id) => executed.add(id))
    if (r.status === 'HALTED') return finish(snapshots, eventLog, decisionTraces, r.halt, null)
    // 年を跨いだ ID の一意性（年を ID に含めるが、評価器の不整合も検出する）。
    const ids = [...r.events.map((e) => `e:${e.eventId}`), ...r.events.map((e) => `k:${e.semanticEventKey}`), ...r.traces.map((x) => `t:${x.traceId}`)]
    const dup = ids.find((id) => seenIds.has(id))
    if (dup !== undefined) {
      return finish(snapshots, eventLog, decisionTraces, {
        code: 'DUPLICATE_ID', year: r.year, phase: null, ruleId: null, message: `年を跨いで ID が重複しています: ${dup}`, rejections: [], diagnostics: [], evaluatorDiagnostics: [], traces: [],
      }, null)
    }
    ids.forEach((id) => seenIds.add(id))
    eventLog.push(...r.events)
    decisionTraces.push(...r.traces)
    world = r.world
    snapshots.push(world)
    if (options.onYearCommitted) {
      try {
        options.onYearCommitted({
          branchId: base.branchId, startYear: initial.year, goalYear: GOAL_YEAR,
          committedYear: r.year, confirmedYear: world.year,
          transitionsDone: snapshots.length - 1, transitionsTotal: GOAL_YEAR - initial.year,
          eventCount: eventLog.length,
        })
      } catch { /* 観測者の失敗で歴史計算を変えない */ }
    }
  }

  // 1350 年は評価専用: フェーズ①〜⑦を実行せず、勝敗だけを既存の evaluateGoal で判定する。
  // 自律歴史が成立していない（37 件 TODO・注入評価器のみ等）世界の評価は勝敗として公開しない。
  const evaluated = options.goal ? evaluateGoal(world, options.goal) : null
  const established = historyOf('COMPLETED', coverageOf(executed), null, true).status === 'ESTABLISHED'
  const goal = established ? evaluated : null
  const technicalGoal = !established && options.technicalGoalEvaluation ? evaluated : null
  return finish(snapshots, eventLog, decisionTraces, null, goal, technicalGoal)
}
