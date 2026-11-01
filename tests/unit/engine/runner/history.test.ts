import { describe, expect, it } from 'vitest'
import type { RuleOutcome } from '../../../../src/simulation/contracts/index.ts'
import type { RuleEvaluator } from '../../../../src/simulation/engine/index.ts'
import { eventIdOf, runTimeline, runYear, traceIdOf } from '../../../../src/simulation/engine/index.ts'
import { cohortCommand, cohortEvaluator, draft, GROUP, judgmentOnlyEvaluator, newWorld, outcomeOf } from './fixtures.ts'

const run = (evaluators: Record<string, RuleEvaluator>, seed = 1) =>
  runTimeline(newWorld(), { seed, evaluators })

describe('RuleOutcome → applyOutcome → EventLog / DecisionTrace', () => {
  it('確定した実差分だけが EventLog になり、Trace と相互に参照できる', () => {
    const r = run({ 'RULE-C-004': cohortEvaluator })
    expect(r.eventLog).toHaveLength(100)
    expect(r.decisionTraces).toHaveLength(100)
    const e = r.eventLog[0]!
    const t = r.decisionTraces[0]!
    expect(e.eventId).toBe(eventIdOf(1250, 1, 'RULE-C-004', 'cmd:1250:RULE-C-004:cohort:' + GROUP))
    expect(t.traceId).toBe(traceIdOf(1250, 1, 'RULE-C-004', 0))
    expect(e.sourceTraceIds).toEqual([t.traceId])
    expect(t.eventIds).toEqual([e.eventId])
    expect(e.stateChanges.map((c) => c.path)).toContain(`$.groups[${GROUP}].population`)
    expect(e.involvedRefs).toContainEqual({ kind: 'GROUP', id: GROUP })
    expect(e.eventType).toBe('POPULATION_COHORT')
  })

  it('全 Event/Trace の ID と semanticEventKey は一意で、参照は解決可能', () => {
    const r = run({ 'RULE-C-004': cohortEvaluator })
    expect(new Set(r.eventLog.map((e) => e.eventId)).size).toBe(r.eventLog.length)
    expect(new Set(r.eventLog.map((e) => e.semanticEventKey)).size).toBe(r.eventLog.length)
    expect(new Set(r.decisionTraces.map((t) => t.traceId)).size).toBe(r.decisionTraces.length)
    const traceIds = new Set(r.decisionTraces.map((t) => t.traceId))
    const eventIds = new Set(r.eventLog.map((e) => e.eventId))
    expect(r.eventLog.every((e) => e.sourceTraceIds.every((id) => traceIds.has(id)))).toBe(true)
    expect(r.decisionTraces.every((t) => t.eventIds.every((id) => eventIds.has(id)))).toBe(true)
  })

  it('状態不変の判断も DecisionTrace に残るが、Event は作られない', () => {
    const r = run({ 'B-004': judgmentOnlyEvaluator })
    expect(r.status).toBe('COMPLETED')
    expect(r.eventLog).toEqual([])
    expect(r.decisionTraces).toHaveLength(100)
    expect(r.decisionTraces[0]).toMatchObject({ status: 'REJECT', eventIds: [], ruleId: 'B-004', reasonCodes: ['NO_ELIGIBLE_CANDIDATE'] })
    expect(r.snapshots[100]?.groups).toEqual(r.snapshots[0]?.groups)
  })

  it('TODO ルール（評価器なし）は NOT_IMPLEMENTED を含め Event/Trace を一切作らない', () => {
    const r = runTimeline(newWorld(), { seed: 1 })
    expect(r.decisionTraces).toEqual([])
    expect(r.eventLog).toEqual([])
  })

  it('注入評価器で動いた TODO ルールは coverage に明示され、自律歴史の成立と扱わない', () => {
    const r = run({ 'RULE-C-004': cohortEvaluator })
    expect(r.coverage.executedRuleIds).toEqual(['RULE-C-004'])
    expect(r.coverage.injectedTodoRuleIds).toEqual(['RULE-C-004'])
    expect(r.autonomousHistory.status).toBe('NOT_ESTABLISHED')
    expect(r.autonomousHistory.blockers).toContain('INJECTED_EVALUATORS_FOR_TODO_RULES:1')
  })
})

describe('拒否・停止の原子性（失敗はゲームの敗北ではない）', () => {
  const failAt = (failYear: number): RuleEvaluator => (w, ctx) =>
    ctx.year === failYear
      ? outcomeOf(ctx, { commands: [cohortCommand(ctx, 1, 0, 'group-does-not-exist')], traceDrafts: [draft(ctx)] })
      : cohortEvaluator(w, ctx)

  it('Transaction 拒否: 失敗年の状態・Event は確定せず、それ以前だけが残る', () => {
    const r = run({ 'RULE-C-004': failAt(1260) })
    expect(r.status).toBe('HALTED')
    expect(r.halt).toMatchObject({ code: 'OUTCOME_REJECTED', year: 1260, phase: 1, ruleId: 'RULE-C-004' })
    expect(r.halt?.rejections.length).toBeGreaterThan(0)
    expect(r.snapshots.map((s) => s.year)).toEqual(Array.from({ length: 11 }, (_, i) => 1250 + i))
    expect(r.transitions).toBe(10)
    expect(r.eventLog).toHaveLength(10)
    expect(r.eventLog.every((e) => e.year < 1260)).toBe(true)
    expect(r.goal).toBeNull()
    expect(r.autonomousHistory.blockers).toContain('HALTED:OUTCOME_REJECTED')
  })

  it('拒否された判断は診断用 Trace のみ（ACCEPT は REJECT に下がり、eventIds 空）', () => {
    const r = run({ 'RULE-C-004': failAt(1250) })
    expect(r.snapshots).toHaveLength(1)
    expect(r.eventLog).toEqual([])
    const t = r.halt!.traces[0]!
    expect(t.status).toBe('REJECT')
    expect(t.eventIds).toEqual([])
    expect(t.reasonCodes.some((c) => c.startsWith('OUTCOME_REJECTED:'))).toBe(true)
    expect(r.decisionTraces).toEqual([]) // 確定履歴には含めない
  })

  const haltCode = (e: RuleEvaluator) => {
    const r = runYear(newWorld(), { seed: 1, evaluators: { 'RULE-C-004': e } })
    return r.status === 'HALTED' ? r.halt.code : r.status
  }

  it('評価器の例外・凍結 world への書込は EVALUATOR_EXCEPTION', () => {
    expect(haltCode(() => { throw new Error('boom') })).toBe('EVALUATOR_EXCEPTION')
    expect(haltCode((w, ctx) => { (w.groups as unknown as unknown[]).push({}); return outcomeOf(ctx) })).toBe('EVALUATOR_EXCEPTION')
  })

  it('参照が解決できない/不正な Outcome は補完せず INVALID_OUTCOME', () => {
    const cmdWith = (ctx: Parameters<RuleEvaluator>[1], traceId: string) => {
      const c = cohortCommand(ctx, 20, 16)
      return { ...c, source: { ...c.source, sourceTraceId: traceId } }
    }
    expect(haltCode((_w, ctx) => outcomeOf(ctx, { commands: [cmdWith(ctx, 'trace:ghost')], traceDrafts: [draft(ctx)] }))).toBe('INVALID_OUTCOME')
    expect(haltCode((_w, ctx) => outcomeOf(ctx, { commands: [cohortCommand(ctx, 20, 16)] }))).toBe('INVALID_OUTCOME')
    expect(haltCode((_w, ctx) => outcomeOf(ctx, { commands: [cohortCommand(ctx, 20, 16)], traceDrafts: [draft(ctx, 'REJECT')] }))).toBe('INVALID_OUTCOME')
    expect(haltCode((_w, ctx) => outcomeOf(ctx, { traceDrafts: [draft(ctx, 'NOT_IMPLEMENTED' as 'ACCEPT')] }))).toBe('INVALID_OUTCOME')
    expect(haltCode((_w, ctx) => ({ ...outcomeOf(ctx), phase: 2 } as RuleOutcome))).toBe('INVALID_OUTCOME')
    expect(haltCode((_w, ctx) => outcomeOf(ctx, { traceDrafts: [{ ...draft(ctx), year: 1999 }] }))).toBe('INVALID_OUTCOME')
  })

  it('未応答の領域間 request は進めず UNRESOLVED_CROSS_DOMAIN_REQUEST で停止', () => {
    const e: RuleEvaluator = (_w, ctx) =>
      outcomeOf(ctx, {
        traceDrafts: [draft(ctx, 'DEFER')],
        requests: [{
          kind: 'COHORT_SLOT_CLAIM', targetDomain: 'C', requiredResponseYear: ctx.year,
          source: { requestId: 'req-x', year: ctx.year, phase: ctx.phase, sourceRuleId: ctx.ruleId, sourceTraceId: ctx.traceId(0) },
          payload: { kind: 'COHORT_SLOT_CLAIM', groupId: GROUP, year: ctx.year, births: 1, deaths: 0 },
        }],
      })
    expect(haltCode(e)).toBe('UNRESOLVED_CROSS_DOMAIN_REQUEST')
  })

  it('入力 WorldState が不正なら何も実行せず INVALID_INPUT_WORLD', () => {
    const bad = { ...newWorld(), groups: [] }
    const r = runTimeline(bad, { seed: 1 })
    expect(r.status).toBe('HALTED')
    expect(r.halt?.code).toBe('INVALID_INPUT_WORLD')
    expect(r.snapshots).toEqual([])
  })
})

describe('batch・停止条件の追加検証', () => {
  it('同一 batch の複数 command は 1 件の Event（差分は連結・refs は複数）になる', () => {
    const e: RuleEvaluator = (_w, ctx) => {
      const mk = (g: string) => ({ ...cohortCommand(ctx, 20, 16, g), batchId: `batch:${ctx.year}` })
      return outcomeOf(ctx, { commands: [mk(GROUP), mk('group-east-commons')], traceDrafts: [draft(ctx)] })
    }
    const r = runYear(newWorld(), { seed: 1, evaluators: { 'RULE-C-004': e } })
    expect(r.status).toBe('COMPLETED')
    if (r.status !== 'COMPLETED') return
    expect(r.events).toHaveLength(1)
    const ev = r.events[0]!
    expect(ev.involvedRefs).toEqual([{ kind: 'GROUP', id: 'group-east-commons' }, { kind: 'GROUP', id: GROUP }])
    expect(ev.stateChanges.filter((c) => c.path.endsWith('.population'))).toHaveLength(2)
    expect(r.traces[0]?.eventIds).toEqual([ev.eventId])
  })

  it('同一 command の再送（別評価器）は CONFLICT/DUPLICATE を Event 化せず停止または無視する', () => {
    // 同年に同 requestId を別ルールが出すと確定済み要求と衝突し、偽の Event を作らず停止する。
    const dup: RuleEvaluator = (w, ctx) => cohortEvaluator(w, ctx)
    const r = runYear(newWorld(), { seed: 1, evaluators: { 'RULE-C-004': dup, 'RULE-C-005': dup } })
    expect(r.status === 'HALTED' ? r.halt.code : r.status).toBe('OUTCOME_REJECTED')
  })
})
