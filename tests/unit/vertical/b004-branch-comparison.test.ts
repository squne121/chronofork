// A0/A1 の B-004 判断 Trace を実 runTimeline → 実 forkHistory → 実 DecisionTrace で比較する統合テスト。
// CALIBRATION_ONLY / synthetic。B-004 の ACCEPT は婚姻成立・出生・継承・勝敗を意味しない。
import { describe, expect, it } from 'vitest'
import { createRootBranch, forkHistory, readYear } from '../../../src/simulation/branching/index.ts'
import type { Branch, BranchEvaluatorFactory } from '../../../src/simulation/branching/index.ts'
import type { DecisionTrace } from '../../../src/simulation/contracts/index.ts'
import { EvaluationFailure, runTimeline } from '../../../src/simulation/engine/index.ts'
import type { EvaluatorMap } from '../../../src/simulation/engine/index.ts'
import { RULE_REGISTRY } from '../../../src/simulation/rule-registry.ts'
import { B004_RULE_VERSION } from '../../../src/simulation/rules/b/index.ts'
import {
  B004_BRANCH_CONFIG as CFG, FORK_YEAR, P4, P5, SEED, TRUST_BOOST, createSyntheticWorld, evaluatorsForLedger,
} from './b004-branch-fixture.ts'

const CID = `b004:${JSON.stringify([P4, P5])}`
const b004 = (traces: readonly DecisionTrace[], year?: number) => traces.filter((t) => t.ruleId === 'B-004' && (year === undefined || t.year === year))
const pair45 = (br: Branch, year: number) => {
  const [t] = b004(br.decisionTraces, year)
  expect(t).toBeDefined()
  return t!
}
const inputs = (t: DecisionTrace) => t.candidates[0]!.inputs as Record<string, unknown>

function buildA0() {
  const evaluators = evaluatorsForLedger([])
  const timeline = runTimeline(createSyntheticWorld(), { seed: CFG.seed, branchId: 'A0', evaluators })
  const root = createRootBranch(timeline, [], evaluators)
  if (!root.ok) throw new Error(`${root.code}: ${root.message}`)
  return { timeline, a0: root.branch }
}
const factory = (calls: { ledgerIds: string[] }[] = []): BranchEvaluatorFactory => ({ ledger }) => {
  calls.push({ ledgerIds: ledger.map((m) => m.modifierId) })
  return evaluatorsForLedger(ledger)
}
const forkA1 = (a0: Branch, evaluatorsFor: BranchEvaluatorFactory = factory()) =>
  forkHistory({ parent: a0, forkYear: FORK_YEAR, branchId: 'A1', modifiers: [TRUST_BOOST], evaluatorsFor })
const mustFork = (r: ReturnType<typeof forkA1>): Branch => {
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`)
  return r.branch
}

describe('設定の同一性（B004_RULE_VERSION だけで係数同一と見なさない）', () => {
  it('固定設定は synthetic / CALIBRATION_ONLY・閾値30・重み1で、P4/P5=10。A0 と A1 は同じ設定から生成する', () => {
    expect(CFG).toMatchObject({ provenance: 'synthetic', status: 'CALIBRATION_ONLY', seed: SEED, b004: { status: 'CALIBRATION_ONLY', trustWeight: 1, acceptThreshold: 30 } })
    expect(CFG.base).toEqual([{ personIds: [P4, P5], value: 10 }])
    expect(CFG.tuning.status).toBe('CALIBRATION_ONLY')
    expect(Object.isFrozen(CFG)).toBe(true)
    const { a0 } = buildA0()
    const calls: { ledgerIds: string[] }[] = []
    const a1 = mustFork(forkA1(a0, factory(calls)))
    expect(calls).toEqual([{ ledgerIds: [TRUST_BOOST.modifierId] }]) // fork の ledger から新しい view を構成
    for (const br of [a0, a1]) {
      for (const t of b004(br.decisionTraces)) {
        expect([inputs(t).trustWeight, inputs(t).acceptThreshold, t.ruleVersion]).toEqual([1, 30, B004_RULE_VERSION])
      }
    }
    expect(a0.seed).toBe(a1.seed)
    expect(a1.evaluatorProfile).toEqual(a0.evaluatorProfile)
    expect(a0.evaluatorProfile).toEqual({ mode: 'RULES', ruleIds: ['B-004', 'RULE-C-004'] })
  })

  it('同RuleIDで別係数の評価器は forkHistory では検知されないが、Trace の係数で比較不能と判定できる', () => {
    const { a0 } = buildA0()
    const mixed = mustFork(forkA1(a0, ({ ledger }) => evaluatorsForLedger(ledger, CFG, { b004: { status: 'CALIBRATION_ONLY', trustWeight: 2, acceptThreshold: 30 } })))
    const comparable = (a: Branch, b: Branch) => {
      const key = (br: Branch) => new Set(b004(br.decisionTraces).map((t) => JSON.stringify([inputs(t).trustWeight, inputs(t).acceptThreshold, t.ruleVersion])))
      const ka = key(a); const kb = key(b)
      return ka.size === 1 && kb.size === 1 && [...ka][0] === [...kb][0]
    }
    expect(comparable(a0, mustFork(forkA1(a0)))).toBe(true)
    expect(comparable(a0, mixed)).toBe(false)
    expect(inputs(pair45(mixed, 1260)).trustWeight).toBe(2) // 混在は Trace に露出する
  })
})

describe('A0 と A1 の B-004 Trace 比較（実 runTimeline → 実 forkHistory）', () => {
  const { timeline, a0 } = buildA0()
  const a1 = mustFork(forkA1(a0))

  it('A0 は完走し、B-004 は毎年 P4/P5 の 1 件を REJECT（信頼 10・score 10）', () => {
    expect(timeline.status).toBe('COMPLETED')
    expect(a0.snapshots).toHaveLength(101)
    expect(b004(a0.decisionTraces)).toHaveLength(100)
    for (let y = 1250; y < 1350; y++) {
      const t = pair45(a0, y)
      expect([t.status, t.candidates[0]!.score, inputs(t).effectiveTrust, t.modifierIds]).toEqual(['REJECT', 10, 10, []])
    }
  })

  it('1259年以前: snapshot・Event・全 Trace が A0 と一致し、出典は継承', () => {
    expect(a1.snapshots.slice(0, FORK_YEAR - 1250 + 1)).toEqual(a0.snapshots.slice(0, FORK_YEAR - 1250 + 1))
    expect(a1.eventLog.filter((e) => e.year < FORK_YEAR)).toEqual(a0.eventLog.filter((e) => e.year < FORK_YEAR))
    expect(a1.decisionTraces.filter((t) => t.year < FORK_YEAR)).toEqual(a0.decisionTraces.filter((t) => t.year < FORK_YEAR))
    expect(readYear(a1, 1259)).toMatchObject({ source: 'INHERITED_PREFIX' })
    expect(readYear(a1, FORK_YEAR)).toMatchObject({ source: 'FORK_POINT' })
    expect(readYear(a1, 1265)).toMatchObject({ source: 'RECOMPUTED' })
    expect(a1.forkYear).toBe(FORK_YEAR)
    expect(a1.recompute).toMatchObject({ fromYear: FORK_YEAR, status: 'COMPLETED', transitions: 90 })
  })

  it('1260〜1264年: traceId・人物ペア・係数は同じで、信頼 10→30・score 10→30・REJECT→ACCEPT・modifierIds だけ違う', () => {
    for (let y = 1260; y <= 1264; y++) {
      const t0 = pair45(a0, y); const t1 = pair45(a1, y)
      expect(t1.traceId).toBe(t0.traceId)
      expect(t1.actorRef).toEqual({ kind: 'PERSON_PAIR', ids: [P4, P5] })
      expect(t0.actorRef).toEqual(t1.actorRef)
      expect([inputs(t0).baseTrust, inputs(t0).rawModifierSum, inputs(t0).effectiveTrust]).toEqual([10, 0, 10])
      expect([inputs(t1).baseTrust, inputs(t1).rawModifierSum, inputs(t1).effectiveTrust]).toEqual([10, 20, 30])
      expect([t0.candidates[0]!.score, t1.candidates[0]!.score]).toEqual([10, 30])
      expect(t1.candidates[0]!.threshold).toBe(30)
      expect([t0.status, t1.status]).toEqual(['REJECT', 'ACCEPT'])
      expect([t0.selectedCandidateId, t1.selectedCandidateId]).toEqual([undefined, CID])
      expect([t0.modifierIds, t1.modifierIds]).toEqual([[], [TRUST_BOOST.modifierId]])
      expect(t1.ruleVersion).toBe(t0.ruleVersion)
      expect(t1.eventIds).toEqual([])
    }
  })

  it('1265年以降: B-004 を含む全 Trace が同条件・同結果（REJECT・信頼 10）', () => {
    for (let y = 1265; y < 1350; y++) {
      expect(pair45(a1, y)).toEqual(pair45(a0, y))
      expect(pair45(a1, y).status).toBe('REJECT')
    }
    expect(a1.decisionTraces.filter((t) => t.year >= 1265)).toEqual(a0.decisionTraces.filter((t) => t.year >= 1265))
  })

  it('差は 1260〜1264 年の B-004 Trace 5 件のみ。C-004 Trace は完全一致', () => {
    const differing = a0.decisionTraces.filter((t, i) => JSON.stringify(t) !== JSON.stringify(a1.decisionTraces[i]))
    expect(a0.decisionTraces).toHaveLength(a1.decisionTraces.length)
    expect(differing.map((t) => [t.ruleId, t.year])).toEqual([1260, 1261, 1262, 1263, 1264].map((y) => ['B-004', y]))
    expect(a1.decisionTraces.filter((t) => t.ruleId === 'RULE-C-004')).toEqual(a0.decisionTraces.filter((t) => t.ruleId === 'RULE-C-004'))
  })

  it('WorldState（全 snapshot）と C-004 EventLog は A0/A1 で同一。婚姻・出生・継承・勝敗を作らない', () => {
    expect(a1.snapshots).toEqual(a0.snapshots)
    expect(a1.eventLog).toEqual(a0.eventLog)
    expect(a1.eventLog.length).toBeGreaterThan(0)
    expect(a1.eventLog.every((e) => e.eventType !== 'MARRIAGE_REGISTER')).toBe(true)
    expect(a1.snapshots.every((s) => s.legal.marriages.length === 0)).toBe(true)
    expect(a1.snapshots.every((s) => s.persons.length === a0.snapshots[0]!.persons.length)).toBe(true)
    const traceIds = new Set(a1.decisionTraces.map((t) => t.traceId))
    for (const e of a1.eventLog) for (const id of e.sourceTraceIds) expect(traceIds.has(id)).toBe(true)
    expect(a0.goal).toBeNull()
    expect(a1.goal).toBeNull()
  })

  it('A0 は不変、A1 の ledger は追加した modifier のみ、同 seed で再現する', () => {
    const before = JSON.stringify(a0)
    expect(JSON.stringify(mustFork(forkA1(a0)))).toBe(JSON.stringify(a1))
    expect(JSON.stringify(a0)).toBe(before)
    expect(a0.ledger).toEqual([])
    expect(a1.ledger.map((m) => m.modifierId)).toEqual([TRUST_BOOST.modifierId])
    expect(buildA0().a0).toEqual(a0)
    expect(readYear(a1, 1350)).toMatchObject({ status: 'COMPUTED', transition: null }) // 1350 は評価専用
  })

  it('37 RuleID は TODO のまま。自律歴史は未成立・goal=null、評価器は注入扱い', () => {
    expect(RULE_REGISTRY).toHaveLength(37)
    expect(RULE_REGISTRY.every((r) => r.implementationStatus === 'TODO')).toBe(true)
    expect(timeline.coverage.todoRuleIds).toHaveLength(37)
    expect(timeline.coverage.implementedRuleIds).toEqual([])
    expect(timeline.coverage.injectedTodoRuleIds.slice().sort()).toEqual(['B-004', 'RULE-C-004'])
    expect(timeline.autonomousHistory.status).toBe('NOT_ESTABLISHED')
    expect(timeline.goal).toBeNull()
    expect(a1.recompute!.suffixCoverage.injectedTodoRuleIds.slice().sort()).toEqual(['B-004', 'RULE-C-004'])
  })
})

describe('安全性: 評価器不一致・HALTED', () => {
  const { a0 } = buildA0()

  it('B-004 を渡さない／C-004 を渡さない／余分な RuleID を足した評価器は EVALUATOR_MISMATCH', () => {
    const only = (id: string): BranchEvaluatorFactory => ({ ledger }) => ({ [id]: evaluatorsForLedger(ledger)[id as 'B-004'] }) as EvaluatorMap
    expect(forkA1(a0, only('RULE-C-004'))).toMatchObject({ ok: false, code: 'EVALUATOR_MISMATCH' })
    expect(forkA1(a0, only('B-004'))).toMatchObject({ ok: false, code: 'EVALUATOR_MISMATCH' })
    expect(forkHistory({ parent: a0, forkYear: FORK_YEAR, branchId: 'A1', modifiers: [TRUST_BOOST] })).toMatchObject({ ok: false, code: 'EVALUATOR_MISMATCH' })
    const extra: BranchEvaluatorFactory = ({ ledger }) => ({ ...evaluatorsForLedger(ledger), 'B-005': () => { throw new Error('x') } })
    expect(forkA1(a0, extra)).toMatchObject({ ok: false, code: 'EVALUATOR_MISMATCH' })
  })

  it('createRootBranch も実行済み RuleID と異なる評価器出典を拒否する', () => {
    const evaluators = evaluatorsForLedger([])
    const tl = runTimeline(createSyntheticWorld(), { seed: SEED, branchId: 'A0', evaluators })
    const wrong = { 'RULE-C-004': evaluators['RULE-C-004'] } as EvaluatorMap
    expect(createRootBranch(tl, [], wrong)).toMatchObject({ ok: false, code: 'EVALUATOR_MISMATCH' })
  })

  it('A1 再計算中に B-004 が評価不能になると HALTED。確定済みの年までで、goal=null・以降の分岐は拒否', () => {
    const halting: BranchEvaluatorFactory = ({ ledger }) => {
      const ev = evaluatorsForLedger(ledger)
      const inner = ev['B-004']!
      return { ...ev, 'B-004': (w, ctx) => {
        if (ctx.year === 1270) throw new EvaluationFailure('synthetic 評価不能', [{ code: 'SYNTHETIC', message: 'halt' }])
        return inner(w, ctx)
      } }
    }
    const h = mustFork(forkA1(a0, halting))
    expect(h.status).toBe('HALTED')
    expect(h.halt).toMatchObject({ code: 'EVALUATION_FAILED', year: 1270 })
    expect(h.goal).toBeNull()
    expect(h.snapshots.at(-1)!.year).toBeLessThanOrEqual(1270)
    expect(h.decisionTraces.every((t) => t.year < 1270)).toBe(true)
    // 1260〜1264 の差は HALTED でも確定済みで、未計算年を推測しない。
    expect(pair45(h, 1262).status).toBe('ACCEPT')
    expect(readYear(h, 1300)).toMatchObject({ status: 'UNCOMPUTED' })
    expect(forkHistory({ parent: h, forkYear: 1262, branchId: 'A2', modifiers: [{ ...TRUST_BOOST, modifierId: 'm2', interventionId: 'i2', startYear: 1262 }], evaluatorsFor: factory() })).toMatchObject({ ok: false, code: 'PARENT_HALTED' })
  })

  it('fork 年が 1350 以降、seed 矛盾は拒否', () => {
    expect(forkHistory({ parent: a0, forkYear: 1350, branchId: 'A1', modifiers: [TRUST_BOOST], evaluatorsFor: factory() })).toMatchObject({ ok: false, code: 'FORK_YEAR_AT_GOAL' })
    expect(forkHistory({ parent: a0, forkYear: FORK_YEAR, branchId: 'A1', modifiers: [TRUST_BOOST], evaluatorsFor: factory(), seed: SEED + 1 })).toMatchObject({ ok: false, code: 'SEED_MISMATCH' })
  })
})
