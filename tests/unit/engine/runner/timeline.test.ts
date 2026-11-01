import { describe, expect, it } from 'vitest'
import { NALVEN_DYNASTY_ID } from '../../../../src/scenario/experimental/index.ts'
import { runTimeline, runYear, RULE_SCHEDULE } from '../../../../src/simulation/engine/index.ts'
import { RULE_REGISTRY } from '../../../../src/simulation/rule-registry.ts'
import { deepFreeze } from '../../foundation/helpers.ts'
import { cohortEvaluator, GROUP, newWorld, randomCohortEvaluator, recordingEvaluators } from './fixtures.ts'
import type { Call } from './fixtures.ts'

const pop = (w: { groups: readonly { groupId: string; population: number }[] }) => w.groups.find((g) => g.groupId === GROUP)?.population

describe('年度境界（100 遷移・101 snapshot・1350 は評価専用）', () => {
  it('評価器なし: 1250〜1350 の 101 snapshot・100 遷移。偽の Event/Trace を作らない', () => {
    const r = runTimeline(newWorld(), { seed: 1 })
    expect(r.status).toBe('COMPLETED')
    expect(r.transitions).toBe(100)
    expect(r.snapshots.map((s) => s.year)).toEqual(Array.from({ length: 101 }, (_, i) => 1250 + i))
    expect(r.eventLog).toEqual([])
    expect(r.decisionTraces).toEqual([])
    expect(r.coverage.executedRuleIds).toEqual([])
    // 年以外は何も変わらない（人口・人物・法制を補完しない）。
    expect({ ...r.snapshots[100], year: 0 }).toEqual({ ...r.snapshots[0], year: 0 })
  })

  it('37 RuleID は全て TODO のまま。年が進んでも自律歴史・勝敗は成立扱いにならない', () => {
    const r = runTimeline(newWorld(), { seed: 1, goal: { dynastyId: NALVEN_DYNASTY_ID } })
    expect(RULE_REGISTRY).toHaveLength(37)
    expect(RULE_REGISTRY.every((x) => x.implementationStatus === 'TODO')).toBe(true)
    expect(r.coverage.todoRuleIds).toHaveLength(37)
    expect(r.coverage.implementedRuleIds).toEqual([])
    expect(r.autonomousHistory.status).toBe('NOT_ESTABLISHED')
    expect(r.autonomousHistory.blockers).toContain('RULES_TODO:37')
    expect(r.goal).toBeNull() // 実ルールが走っていない世界の勝敗は公開しない
    expect(r.technicalGoal).toBeNull()
    const t = runTimeline(newWorld(), { seed: 1, goal: { dynastyId: NALVEN_DYNASTY_ID }, technicalGoalEvaluation: true })
    expect(t.goal).toBeNull()
    expect(t.technicalGoal).not.toBeNull() // 非権威（技術検証用）
  })

  it('1350 年はフェーズ①〜⑦を呼ばず、評価器は 1250〜1349 の各年にだけ呼ばれる', () => {
    const calls: Call[] = []
    const r = runTimeline(newWorld(), { seed: 1, evaluators: recordingEvaluators(calls) })
    expect(r.status).toBe('COMPLETED')
    expect(Math.max(...calls.map((c) => c.year))).toBe(1349)
    expect(calls.some((c) => c.year === 1350)).toBe(false)
    expect(calls).toHaveLength(100 * 37)
  })

  it('年内のフェーズ・RuleID 順は固定で、毎年同じ', () => {
    const calls: Call[] = []
    runTimeline(newWorld(), { seed: 1, evaluators: recordingEvaluators(calls) })
    const expected = ([1, 2, 3, 4, 5, 6] as const).flatMap((p) => RULE_SCHEDULE[p].map((id) => `${p}:${id}`))
    for (const year of [1250, 1300, 1349]) {
      expect(calls.filter((c) => c.year === year).map((c) => `${c.phase}:${c.ruleId}`)).toEqual(expected)
    }
  })

  it('RULE_SCHEDULE は全 37 RuleID をちょうど 1 回ずつ含む', () => {
    const all = Object.values(RULE_SCHEDULE).flat()
    expect(all).toHaveLength(37)
    expect(new Set(all)).toEqual(new Set(RULE_REGISTRY.map((r) => r.ruleId)))
  })

  it('runYear(1350) は拒否し、評価器を呼ばない。1350 開始の timeline は評価のみ', () => {
    const calls: Call[] = []
    const w1350 = { ...newWorld(), year: 1350 }
    const y = runYear(w1350, { seed: 1, evaluators: recordingEvaluators(calls) })
    expect(y.status).toBe('HALTED')
    if (y.status === 'HALTED') expect(y.halt.code).toBe('YEAR_OUT_OF_RANGE')
    const t = runTimeline(w1350, { seed: 1, evaluators: recordingEvaluators(calls), goal: { dynastyId: NALVEN_DYNASTY_ID } })
    expect(t.snapshots).toHaveLength(1)
    expect(t.transitions).toBe(0)
    expect(t.goal).toBeNull()
    expect(calls).toEqual([])
  })

  it('年次処理で前年の CohortSlot を翌年へ持ち越さない', () => {
    const r = runYear(newWorld(), { seed: 1, evaluators: { 'RULE-C-004': cohortEvaluator } })
    expect(r.status).toBe('COMPLETED')
    if (r.status === 'COMPLETED') {
      expect(r.world.year).toBe(1251)
      expect(r.world.demographics.cohortSlots).toEqual([])
      expect(pop(r.world)).toBe(30004)
    }
  })

  it('予約済み資源（committed>0）の翌年繰越規則は未定義のため補完せず停止する', () => {
    const w = newWorld()
    const acct = w.resources.find((a) => a.kind === 'FORCE_HEADCOUNT' && a.quantity > 0)
    if (!acct) return // 初期世界に兵員 Pool が無ければ対象外
    const dirty = { ...w, resources: w.resources.map((a) => (a === acct ? { ...a, committed: 1 } : a)) }
    const r = runYear(dirty, { seed: 1 })
    expect(r.status).toBe('HALTED')
    if (r.status === 'HALTED') expect(r.halt.code).toBe('BOUNDARY_INCOMPLETE')
  })
})

describe('同 seed 再現性・不変性・枝非干渉', () => {
  const opts = { seed: 42, evaluators: { 'RULE-C-004': randomCohortEvaluator } } as const

  it('同一入力・seed・評価器で snapshot/EventLog/DecisionTrace が完全一致', () => {
    const a = runTimeline(newWorld(), opts)
    const b = runTimeline(newWorld(), opts)
    expect(JSON.stringify(a)).toBe(JSON.stringify(b))
    expect(a.eventLog).toHaveLength(100)
  })

  it('別 seed では乱数に依存する結果が変わる', () => {
    const a = runTimeline(newWorld(), opts)
    const b = runTimeline(newWorld(), { ...opts, seed: 43 })
    expect(JSON.stringify(a.snapshots)).not.toBe(JSON.stringify(b.snapshots))
  })

  it('branchId は ID・乱数に影響しない（枝間で履歴が同一）', () => {
    const a = runTimeline(newWorld(), { ...opts, branchId: 'branch-a' })
    const b = runTimeline(newWorld(), { ...opts, branchId: 'branch-b' })
    expect(a.eventLog).toEqual(b.eventLog)
    expect(a.decisionTraces).toEqual(b.decisionTraces)
    expect(a.snapshots).toEqual(b.snapshots)
  })

  it('入力 WorldState を変更しない（凍結入力でも完走）し、結果は入力と参照を共有しない', () => {
    const w = deepFreeze(newWorld())
    const r = runTimeline(w, { seed: 1, evaluators: { 'RULE-C-004': cohortEvaluator } })
    expect(r.status).toBe('COMPLETED')
    expect(r.snapshots[0]).not.toBe(w)
    expect(pop(w)).toBe(30000)
    expect(pop(r.snapshots[0] as typeof w)).toBe(30000)
    expect(pop(r.snapshots[100] as typeof w)).toBe(30400)
  })

  it('結果は読み取り専用（深く凍結）', () => {
    const r = runTimeline(newWorld(), { seed: 1 })
    expect(Object.isFrozen(r)).toBe(true)
    expect(Object.isFrozen(r.snapshots[0])).toBe(true)
  })

  it('同一年の runYear を繰り返しても同じ結果（冪等・入力不変）', () => {
    const w = deepFreeze(newWorld())
    const o = { seed: 1, evaluators: { 'RULE-C-004': cohortEvaluator } } as const
    expect(JSON.stringify(runYear(w, o))).toBe(JSON.stringify(runYear(w, o)))
  })
})
