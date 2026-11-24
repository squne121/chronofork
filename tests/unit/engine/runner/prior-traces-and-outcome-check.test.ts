// Issue #110 工程2C: runYear の (1) 評価器へ渡す priorTraces（確定時の凍結複製を共有）と
// (2) checkOutcome の traceId 索引（command → 先頭一致の draft）が、従来と同じ内容・拒否を返すこと。
import { describe, expect, it } from 'vitest'
import type { DecisionTrace, RuleId } from '../../../../src/simulation/contracts/index.ts'
import { runYear } from '../../../../src/simulation/engine/index.ts'
import type { EvaluationContext, RuleEvaluator } from '../../../../src/simulation/engine/index.ts'
import { RULE_SCHEDULE, YEARLY_PHASES } from '../../../../src/simulation/engine/schedule.ts'
import { cohortCommand, draft, newWorld, outcomeOf } from './fixtures.ts'

const order = YEARLY_PHASES.flatMap((p) => RULE_SCHEDULE[p])
const first = 'RULE-C-004' as RuleId
const later = order.slice(order.indexOf(first) + 1)
const second = later[0]!, third = later[1]!

const cohort: RuleEvaluator = (_w, ctx) => outcomeOf(ctx, { commands: [cohortCommand(ctx, 20, 16)], traceDrafts: [draft(ctx)] })

describe('priorTraces: 確定済み Trace の凍結複製', () => {
  it('各評価器は直前までの確定 Trace と同一内容を受け取り、変更できず、出力の Trace とは別の値', () => {
    const seen: { ruleId: RuleId; prior: readonly DecisionTrace[] }[] = []
    const watch: RuleEvaluator = (_w, ctx: EvaluationContext) => {
      seen.push({ ruleId: ctx.ruleId, prior: ctx.priorTraces ?? [] })
      expect(Object.isFrozen(ctx.priorTraces)).toBe(true)
      for (const t of ctx.priorTraces ?? []) {
        expect(Object.isFrozen(t)).toBe(true)
        expect(Object.isFrozen(t.candidates[0])).toBe(true)
        expect(() => { (t as { status: string }).status = 'REJECT' }).toThrow(TypeError)
        expect(() => { (ctx.priorTraces as DecisionTrace[]).push(t) }).toThrow(TypeError)
      }
      return outcomeOf(ctx, { traceDrafts: [draft(ctx, 'REJECT', 'NO_ELIGIBLE_CANDIDATE'), draft(ctx, 'DEFER', 'WAIT')] })
    }
    const r = runYear(newWorld(), { seed: 1, branchId: 'A0', evaluators: {
      [first]: cohort,
      [second]: watch, [third]: watch,
    } })
    if (r.status !== 'COMPLETED') throw new Error(r.halt.message)
    expect(seen.map((s) => s.ruleId)).toEqual([second, third])
    const upTo = (ruleId: RuleId) => r.traces.slice(0, r.traces.findIndex((t) => t.ruleId === ruleId))
    expect(seen[0]!.prior).toEqual(upTo(second))
    expect(seen[1]!.prior).toEqual(upTo(third))
    expect(seen[1]!.prior).toHaveLength(3)
    // 同じ確定 Trace の凍結複製は規則間で共有するが、出力（r.traces）とは共有しない。
    expect(seen[1]!.prior[0]).toBe(seen[0]!.prior[0])
    expect(seen[1]!.prior[0]).not.toBe(r.traces[0])
    expect(Object.isFrozen(r.traces[0])).toBe(false)
  })
})

describe('checkOutcome: command の sourceTraceId → draft の解決', () => {
  const run = (pick: (ctx: EvaluationContext) => string, statuses: ('ACCEPT' | 'REJECT' | 'DEFER')[]) =>
    runYear(newWorld(), { seed: 1, branchId: 'A0', evaluators: {
      [first]: ((_w, ctx) => {
        const c = cohortCommand(ctx, 20, 16)
        return outcomeOf(ctx, { commands: [{ ...c, source: { ...c.source, sourceTraceId: pick(ctx) } }], traceDrafts: statuses.map((s) => draft(ctx, s)) })
      }) as RuleEvaluator,
    } })
  it('ACCEPT の draft を指す command は確定する', () => {
    expect(run((ctx) => ctx.traceId(1), ['REJECT', 'ACCEPT']).status).toBe('COMPLETED')
  })
  it('ACCEPT 以外の draft を指す command は INVALID_OUTCOME', () => {
    const r = run((ctx) => ctx.traceId(0), ['REJECT', 'ACCEPT'])
    expect(r.status).toBe('HALTED')
    if (r.status === 'HALTED') expect(r.halt).toMatchObject({ code: 'INVALID_OUTCOME', message: expect.stringContaining('ACCEPT 以外の判断') })
  })
  it('解決できない sourceTraceId は INVALID_OUTCOME', () => {
    const r = run((ctx) => ctx.traceId(5), ['ACCEPT'])
    expect(r.status).toBe('HALTED')
    if (r.status === 'HALTED') expect(r.halt).toMatchObject({ code: 'INVALID_OUTCOME', message: expect.stringContaining('解決できません') })
  })
})
