// 1 年分の遷移 runYear: 年初 t の WorldState → t+1 年初。フェーズ①〜⑥を固定順に評価・適用し、⑦で境界を検証する。
// 純粋・決定的。入力は変更しない。失敗（評価器の例外・不正 Outcome・拒否・検証 ERROR）は停止として返し、
// その年の部分状態は確定しない（年単位の原子性）。
import type {
  DecisionTrace,
  EventLogEntry,
  Id,
  Phase,
  RuleId,
  RuleOutcome,
  WorldState,
} from '../contracts/index.ts'
import { GOAL_YEAR, START_YEAR } from '../contracts/index.ts'
import { drawRandom } from '../random.ts'
import { getRule } from '../rule-registry.ts'
import { validateWorldState } from '../validation/index.ts'
import type { Diagnostic } from '../validation/index.ts'
import { DEFAULT_EVALUATORS } from './evaluators.ts'
import { EvaluationFailure } from './evaluators.ts'
import type { EvaluationContext, EvaluatorDiagnostic, EvaluatorMap, RuleEvaluator } from './evaluators.ts'
import { buildEvents, buildTraces } from './history.ts'
import { traceIdOf } from './ids.ts'
import { applyOutcome, createTransaction } from './reducer/index.ts'
import type { Rejection } from './reducer/index.ts'
import { cloneData } from './reducer/canonical.ts'
import { RULE_SCHEDULE, YEARLY_PHASES } from './schedule.ts'
import type { HaltCode, RunHalt, RunOptions, YearRunResult } from './types.ts'

export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const v of Object.values(value)) deepFreeze(v)
  }
  return value
}

const isImplemented = (ruleId: RuleId) => getRule(ruleId).implementationStatus === 'IMPLEMENTED'

type HaltInput = Readonly<{
  code: HaltCode
  message: string
  phase?: Phase
  ruleId?: RuleId
  rejections?: readonly Rejection[]
  diagnostics?: readonly Diagnostic[]
  evaluatorDiagnostics?: readonly EvaluatorDiagnostic[]
  traces?: readonly DecisionTrace[]
}>

function halted(world: WorldState, year: number, executedRuleIds: readonly RuleId[], h: HaltInput): YearRunResult {
  const halt: RunHalt = {
    code: h.code,
    year,
    phase: h.phase ?? null,
    ruleId: h.ruleId ?? null,
    message: h.message,
    rejections: h.rejections ?? [],
    diagnostics: h.diagnostics ?? [],
    evaluatorDiagnostics: h.evaluatorDiagnostics ?? [],
    traces: h.traces ?? [],
  }
  return { status: 'HALTED', year, world, halt, executedRuleIds }
}

/** Outcome の形と参照の検証。不備は補完せず INVALID_OUTCOME にする（偽の証拠を作らない）。 */
function checkOutcome(o: RuleOutcome, ctx: EvaluationContext): string | null {
  if (o === null || typeof o !== 'object') return 'Outcome がオブジェクトではありません'
  if (o.ruleId !== ctx.ruleId) return `Outcome.ruleId ${String(o.ruleId)} が評価対象 ${ctx.ruleId} と異なります`
  if (o.phase !== ctx.phase) return `Outcome.phase ${String(o.phase)} が評価フェーズ ${ctx.phase} と異なります`
  for (const k of ['commands', 'requests', 'deferred', 'traceDrafts'] as const) {
    if (!Array.isArray(o[k])) return `Outcome.${k} が配列ではありません`
  }
  const ids = new Set<Id>()
  for (const [i, d] of o.traceDrafts.entries()) {
    if (d.year !== ctx.year || d.phase !== ctx.phase || d.ruleId !== ctx.ruleId) {
      return `traceDrafts[${i}] の年/フェーズ/RuleID が評価対象と一致しません`
    }
    if (d.status !== 'ACCEPT' && d.status !== 'REJECT' && d.status !== 'DEFER') {
      return `traceDrafts[${i}] の status ${String(d.status)} は評価器が出せません（NOT_IMPLEMENTED はランナーが管理）`
    }
    ids.add(ctx.traceId(i))
  }
  for (const c of o.commands) {
    const s = c?.source
    if (!s || !ids.has(s.sourceTraceId)) return `command ${String(c?.commandId)} の sourceTraceId が traceDrafts に解決できません`
    const idx = o.traceDrafts.findIndex((_, i) => ctx.traceId(i) === s.sourceTraceId)
    if (o.traceDrafts[idx]?.status !== 'ACCEPT') return `command ${c.commandId} が ACCEPT 以外の判断に紐づいています`
  }
  for (const r of o.requests) {
    if (!r?.source || !ids.has(r.source.sourceTraceId)) return 'request の sourceTraceId が traceDrafts に解決できません'
  }
  return null
}

function makeContext(world: WorldState, phase: Phase, ruleId: RuleId, options: RunOptions): EvaluationContext {
  const year = world.year
  return {
    year,
    phase,
    ruleId,
    seed: options.seed,
    branchId: options.branchId ?? 'main',
    traceId: (i) => traceIdOf(year, phase, ruleId, i),
    random: (k) =>
      drawRandom(options.seed, {
        stream: k.stream,
        year,
        phase,
        ruleId,
        actorId: k.actorId ?? null,
        targetId: k.targetId ?? null,
        eventKey: k.eventKey ?? null,
      }),
  }
}

/** ⑦ Core: 年末の確定検証と t+1 年初への繰越。不足するドメイン規則は補完せず停止する。 */
function closeYear(world: WorldState): { world: WorldState } | { code: HaltCode; message: string; diagnostics?: readonly Diagnostic[] } {
  const v = validateWorldState(world)
  if (!v.ok) {
    return { code: 'YEAR_VALIDATION_ERROR', message: '年末の WorldState 検証に ERROR があります', diagnostics: v.diagnostics.filter((d) => d.severity === 'ERROR') }
  }
  const t = world.year
  if (world.resources.some((a) => a.committed > 0)) {
    return { code: 'BOUNDARY_INCOMPLETE', message: '予約済み（committed）の資源の翌年繰越規則が未定義のため、推測せず停止します' }
  }
  if (world.deferred.some((e) => e.effectiveFromYear !== t + 1)) {
    return { code: 'BOUNDARY_INCOMPLETE', message: `${t} 年に未消化の DeferredEffect があります（消化規則が未実装のため推測せず停止します）` }
  }
  if (world.demographics.cohortSlots.some((s) => s.year !== t)) {
    return { code: 'BOUNDARY_INCOMPLETE', message: `${t} 年以外の CohortSlot が残っています` }
  }
  // t 年の出生・自然死枠は t 年内で消費済み。翌年の枠は翌年 C① が確定する。
  const next = { ...world, year: t + 1, demographics: { cohortSlots: [] } }
  const nv = validateWorldState(next)
  if (!nv.ok) {
    return { code: 'YEAR_VALIDATION_ERROR', message: `${t + 1} 年初の WorldState 検証に ERROR があります`, diagnostics: nv.diagnostics.filter((d) => d.severity === 'ERROR') }
  }
  return { world: next }
}

export function runYear(input: WorldState, options: RunOptions): YearRunResult {
  const t = input.year
  const executed: RuleId[] = []
  if (!Number.isInteger(t) || t < START_YEAR || t >= GOAL_YEAR) {
    return halted(input, t, executed, { code: 'YEAR_OUT_OF_RANGE', message: `年次処理の対象は ${START_YEAR}〜${GOAL_YEAR - 1} 年です（${GOAL_YEAR} 年は評価専用）: ${t}` })
  }
  const valid = validateWorldState(input)
  if (!valid.ok) {
    return halted(input, t, executed, { code: 'INVALID_INPUT_WORLD', message: '入力 WorldState が不正です', diagnostics: valid.diagnostics.filter((d) => d.severity === 'ERROR') })
  }
  const evaluators: EvaluatorMap = { ...DEFAULT_EVALUATORS, ...options.evaluators }

  let world: WorldState = cloneData(valid.world as WorldState)
  let tx = createTransaction({ branchId: options.branchId ?? 'main', year: t })
  const events: EventLogEntry[] = []
  const traces: DecisionTrace[] = []

  for (const phase of YEARLY_PHASES) {
    for (const ruleId of RULE_SCHEDULE[phase]) {
      const evaluator: RuleEvaluator | undefined = evaluators[ruleId]
      if (!evaluator) {
        if (isImplemented(ruleId)) {
          return halted(input, t, executed, { code: 'IMPLEMENTED_RULE_WITHOUT_EVALUATOR', phase, ruleId, message: `${ruleId} は IMPLEMENTED だが評価器が登録されていません` })
        }
        continue // TODO: 呼ばない。Command・Event・Trace を作らない。
      }
      const ctx = makeContext(world, phase, ruleId, options)
      let outcome: RuleOutcome
      try {
        outcome = evaluator(deepFreeze(cloneData(world)), ctx)
        const bad = checkOutcome(outcome, ctx)
        if (bad) return halted(input, t, executed, { code: 'INVALID_OUTCOME', phase, ruleId, message: bad })
        outcome = cloneData(outcome)
      } catch (e) {
        if (e instanceof EvaluationFailure) {
          return halted(input, t, executed, { code: 'EVALUATION_FAILED', phase, ruleId, message: `${ruleId} の評価が成立しません: ${e.message}`, evaluatorDiagnostics: e.diagnostics })
        }
        return halted(input, t, executed, { code: 'EVALUATOR_EXCEPTION', phase, ruleId, message: `評価器が例外: ${e instanceof Error ? e.message : String(e)}` })
      }
      executed.push(ruleId)

      if (outcome.requests.length > 0) {
        return halted(input, t, executed, {
          code: 'UNRESOLVED_CROSS_DOMAIN_REQUEST', phase, ruleId,
          message: '領域間 request に対する応答機構が未実装のため、未応答のまま進めず停止します',
          traces: buildTraces(outcome, [], t, ['UNRESOLVED_CROSS_DOMAIN_REQUEST']),
        })
      }
      const r = applyOutcome(world, outcome, { transaction: tx })
      if (r.status !== 'APPLIED' && r.status !== 'NO_OP' && r.status !== 'DUPLICATE') {
        const rejections = [...r.rejections, ...r.units.flatMap((u) => u.rejections)]
        const codes = [...new Set(rejections.map((x) => `OUTCOME_REJECTED:${x.code}`))]
        return halted(input, t, executed, {
          code: 'OUTCOME_REJECTED', phase, ruleId, rejections,
          message: `${ruleId} の Outcome が確定しませんでした（${r.status}）`,
          traces: buildTraces(outcome, [], t, codes.length > 0 ? codes : ['OUTCOME_REJECTED']),
        })
      }
      const newEvents = buildEvents(outcome, r, r.world)
      events.push(...newEvents)
      traces.push(...buildTraces(outcome, newEvents, t))
      world = r.world
      tx = r.transaction
    }
  }

  // ID の一意性（trace / event / semanticEventKey）。
  for (const [kind, ids] of [
    ['traceId', traces.map((x) => x.traceId)],
    ['eventId', events.map((x) => x.eventId)],
    ['semanticEventKey', events.map((x) => x.semanticEventKey)],
  ] as const) {
    if (new Set(ids).size !== ids.length) {
      return halted(input, t, executed, { code: 'DUPLICATE_ID', message: `${kind} が重複しています` })
    }
  }
  const eventIds = new Set(events.map((e) => e.eventId))
  const traceIds = new Set(traces.map((x) => x.traceId))
  const dangling =
    events.some((e) => e.sourceTraceIds.some((id) => !traceIds.has(id))) ||
    traces.some((x) => x.eventIds.some((id) => !eventIds.has(id)))
  if (dangling) return halted(input, t, executed, { code: 'INVALID_OUTCOME', message: 'Trace と Event の相互参照が解決できません' })

  const closed = closeYear(world)
  if (!('world' in closed)) return halted(input, t, executed, { ...closed, phase: 7 })
  return { status: 'COMPLETED', year: t, world: closed.world, events, traces, executedRuleIds: executed }
}
