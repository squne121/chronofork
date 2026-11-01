import { describe, expect, it } from 'vitest'
import { NALVEN_DYNASTY_ID } from '../../../../src/scenario/experimental/index.ts'
import type { WorldState } from '../../../../src/simulation/contracts/index.ts'
import { runTimeline, runYear } from '../../../../src/simulation/engine/index.ts'
import type { RuleEvaluator } from '../../../../src/simulation/engine/index.ts'
import { RULE_REGISTRY, getRule } from '../../../../src/simulation/rule-registry.ts'
import {
  createCalibrationEvaluators,
  createPopulationCohortCalibrationEvaluator,
} from '../../../../src/simulation/rules/c/index.ts'
import { EXPERIMENTAL_TUNING } from '../../../../src/simulation/tuning.ts'
import type { TuningConfig } from '../../../../src/simulation/tuning.ts'
import { deepFreeze } from '../../foundation/helpers.ts'
import { newWorld } from './fixtures.ts'

// 試験専用の係数（CALIBRATION_ONLY）。正式なゲーム法則ではない。
const TUNING: TuningConfig = {
  ...EXPERIMENTAL_TUNING,
  birthRatePermille: { value: 30, origin: 'PLACEHOLDER', note: '試験専用' },
  growthRatePermille: { value: 20, origin: 'PLACEHOLDER', note: '試験専用' },
}
const BAD_TUNING: TuningConfig = { ...TUNING, birthRatePermille: { value: -1, origin: 'PLACEHOLDER', note: '不正' } }
const evaluators = createCalibrationEvaluators(TUNING)
const total = (w: WorldState) => w.groups.reduce((s, g) => s + g.population, 0)

describe('RULE-C-004 人口コホート → runYear（1250 単年）', () => {
  const w0 = deepFreeze(newWorld())
  const r = runYear(w0, { seed: 7, evaluators })

  it('全 Group の人口が実際に変化し、入力 WorldState は不変', () => {
    expect(r.status).toBe('COMPLETED')
    if (r.status !== 'COMPLETED') return
    expect(r.world.year).toBe(1251)
    for (const g of r.world.groups) {
      const before = w0.groups.find((x) => x.groupId === g.groupId)
      expect(before).toBeDefined()
      expect(g.population).toBeGreaterThan(before!.population) // g=+20‰ なので全 Group 増加
    }
    expect(total(r.world)).toBeGreaterThan(total(w0))
    expect(r.executedRuleIds).toEqual(['RULE-C-004'])
  })

  it('Event は Group ごと・groupId 昇順で実差分のみ。Trace と双方向に結ばれる', () => {
    if (r.status !== 'COMPLETED') throw new Error('unexpected')
    const ids = w0.groups.map((g) => g.groupId).sort()
    expect(r.events).toHaveLength(ids.length)
    expect(r.traces).toHaveLength(ids.length)
    ids.forEach((id, i) => {
      const t = r.traces[i]!
      const e = r.events[i]!
      expect(t.traceId).toBe(`trace:1250:p1:RULE-C-004:${i}`)
      expect(t.actorRef).toEqual({ kind: 'GROUP', id })
      expect(t.status).toBe('ACCEPT')
      expect(t.reasonCodes).toContain('CALIBRATION_ONLY')
      expect(t.eventIds).toEqual([e.eventId])
      expect(e.sourceTraceIds).toEqual([t.traceId])
      expect(e.involvedRefs).toEqual([{ kind: 'GROUP', id }])
      expect(e.stateChanges.length).toBeGreaterThan(0)
      const pop = e.stateChanges.find((c) => c.path.endsWith('population'))
      expect(pop).toBeDefined()
      expect(pop!.before).toBe(w0.groups.find((g) => g.groupId === id)!.population)
      expect(pop!.after).toBe(r.world.groups.find((g) => g.groupId === id)!.population)
    })
    expect(new Set(r.events.map((e) => e.semanticEventKey)).size).toBe(ids.length)
  })

  it('requestId / commandId は年・RuleID・Group から決まる（決定的）', () => {
    if (r.status !== 'COMPLETED') throw new Error('unexpected')
    expect(r.events[0]!.semanticEventKey).toContain('req:1250:RULE-C-004:group-central-commons:ANNUAL_COHORT')
    expect(r.events[0]!.eventId).toBe('event:1250:p1:RULE-C-004:cmd:1250:RULE-C-004:group-central-commons:ANNUAL_COHORT')
  })

  it('Group 配列順に依存しない', () => {
    const rev = { ...newWorld(), groups: [...newWorld().groups].reverse() }
    const a = runYear(rev, { seed: 7, evaluators })
    if (a.status !== 'COMPLETED' || r.status !== 'COMPLETED') throw new Error('unexpected')
    expect(a.events).toEqual(r.events)
    expect(a.traces).toEqual(r.traces)
  })
})

describe('1250〜1350（100 遷移・101 snapshot）', () => {
  const opts = { seed: 11, evaluators, goal: { dynastyId: NALVEN_DYNASTY_ID }, technicalGoalEvaluation: true } as const
  const t = runTimeline(newWorld(), opts)

  it('100 遷移・101 snapshot で人口が単調に変化し続ける', () => {
    expect(t.status).toBe('COMPLETED')
    expect(t.transitions).toBe(100)
    expect(t.snapshots).toHaveLength(101)
    expect(t.snapshots.map((s) => s.year)).toEqual(Array.from({ length: 101 }, (_, i) => 1250 + i))
    for (let i = 1; i < 101; i++) expect(total(t.snapshots[i]!)).toBeGreaterThan(total(t.snapshots[i - 1]!))
    expect(total(t.snapshots[100]!)).toBeGreaterThan(total(t.snapshots[0]!))
    expect(t.snapshots.every((s) => s.demographics.cohortSlots.length === 0)).toBe(true)
  })

  it('Event / Trace は 100 年 × Group 数。参照は双方向に完全一致し、ID は一意', () => {
    const n = newWorld().groups.length
    expect(t.eventLog).toHaveLength(100 * n)
    expect(t.decisionTraces).toHaveLength(100 * n)
    const traceById = new Map(t.decisionTraces.map((x) => [x.traceId, x]))
    const eventById = new Map(t.eventLog.map((e) => [e.eventId, e]))
    expect(traceById.size).toBe(t.decisionTraces.length)
    expect(eventById.size).toBe(t.eventLog.length)
    for (const e of t.eventLog) for (const id of e.sourceTraceIds) expect(traceById.get(id)?.eventIds).toContain(e.eventId)
    for (const x of t.decisionTraces) {
      expect(x.eventIds.length).toBe(1)
      for (const id of x.eventIds) expect(eventById.get(id)?.sourceTraceIds).toContain(x.traceId)
    }
  })

  it('同 seed の再実行は完全一致（snapshot・Event・Trace）', () => {
    expect(runTimeline(newWorld(), opts)).toEqual(t)
  })

  it('CALIBRATION_ONLY の部分実行であり、自律歴史・勝敗は成立扱いにしない', () => {
    expect(getRule('RULE-C-004').implementationStatus).toBe('TODO')
    expect(RULE_REGISTRY.every((x) => x.implementationStatus === 'TODO')).toBe(true)
    expect(t.coverage.executedRuleIds).toEqual(['RULE-C-004'])
    expect(t.coverage.injectedTodoRuleIds).toEqual(['RULE-C-004'])
    expect(t.coverage.implementedRuleIds).toEqual([])
    expect(t.autonomousHistory.status).toBe('NOT_ESTABLISHED')
    expect(t.autonomousHistory.blockers).toEqual(expect.arrayContaining(['RULES_TODO:37', 'INJECTED_EVALUATORS_FOR_TODO_RULES:1']))
    expect(t.goal).toBeNull()
    expect(t.technicalGoal).not.toBeNull() // 非権威
  })
})

describe('CohortEvaluation.ok=false は NO_OP にせず診断付きで停止する', () => {
  const badEval = createCalibrationEvaluators(BAD_TUNING)

  it('runYear: EVALUATION_FAILED・診断あり・無 Event・WorldState 不変', () => {
    const w = deepFreeze(newWorld())
    const r = runYear(w, { seed: 1, evaluators: badEval })
    expect(r.status).toBe('HALTED')
    if (r.status !== 'HALTED') return
    expect(r.halt.code).toBe('EVALUATION_FAILED')
    expect(r.halt.ruleId).toBe('RULE-C-004')
    expect(r.halt.evaluatorDiagnostics.map((d) => d.code)).toContain('TUNING_COEFFICIENT_INVALID')
    expect(r.world).toEqual(w)
    expect(r.world.year).toBe(1250)
    expect('events' in r).toBe(false)
  })

  it('範囲外年・確定済み枠・桁あふれも停止（空 Outcome を通さない）', () => {
    const ev = createPopulationCohortCalibrationEvaluator(TUNING)
    const ctx = { year: 1250, phase: 1, ruleId: 'RULE-C-004', seed: 1, branchId: 'main', traceId: (i: number) => `t${i}`, random: () => 0 } as const
    const done = runYear(newWorld(), { seed: 1, evaluators })
    if (done.status !== 'COMPLETED') throw new Error('unexpected')
    expect(() => ev({ ...done.world, year: 1350 }, ctx)).toThrow()
    const slotted = newWorld()
    const withSlot: WorldState = { ...slotted, demographics: { cohortSlots: [{ groupId: slotted.groups[0]!.groupId, year: 1250, birthSlots: 1, deathSlots: 1, claimedBirths: 0, claimedDeaths: 0 }] } }
    expect(() => ev(withSlot, ctx)).toThrow(/COHORT_ALREADY_SET/)
  })

  it('runTimeline 途中の失敗: その年は確定せず、先行年までの履歴だけが残る（原子性）', () => {
    const good = createPopulationCohortCalibrationEvaluator(TUNING)
    const bad = createPopulationCohortCalibrationEvaluator(BAD_TUNING)
    const flaky: RuleEvaluator = (w, ctx) => (ctx.year >= 1260 ? bad(w, ctx) : good(w, ctx))
    const r = runTimeline(newWorld(), { seed: 1, evaluators: { 'RULE-C-004': flaky } })
    const n = newWorld().groups.length
    expect(r.status).toBe('HALTED')
    expect(r.halt?.code).toBe('EVALUATION_FAILED')
    expect(r.halt?.year).toBe(1260)
    expect(r.snapshots.map((s) => s.year)).toEqual(Array.from({ length: 11 }, (_, i) => 1250 + i))
    expect(r.transitions).toBe(10)
    expect(r.eventLog).toHaveLength(10 * n)
    expect(r.eventLog.every((e) => e.year < 1260)).toBe(true)
    expect(r.decisionTraces.every((x) => x.year < 1260)).toBe(true)
    expect(r.goal).toBeNull()
    expect(r.autonomousHistory.blockers).toContain('HALTED:EVALUATION_FAILED')
  })
})
