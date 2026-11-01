import { describe, expect, it } from 'vitest'
import {
  EXPERIMENTAL_EMPTY_LEDGER,
  EXPERIMENTAL_PAIR_TRUST_BASE,
  EXPERIMENTAL_TRUST_BOOST,
  createExperimentalWorld,
  experimentalKnownPersonIds,
} from '../../../../src/scenario/experimental/index.ts'
import type { DecisionTrace, WorldState } from '../../../../src/simulation/contracts/index.ts'
import { runTimeline, runYear, traceIdOf } from '../../../../src/simulation/engine/index.ts'
import type { EvaluationContext } from '../../../../src/simulation/engine/index.ts'
import { createPairTrustView } from '../../../../src/simulation/intervention/index.ts'
import type { StatModifierLedger } from '../../../../src/simulation/intervention/index.ts'
import { RULE_REGISTRY, getRule } from '../../../../src/simulation/rule-registry.ts'
import {
  B004_RULE_VERSION,
  EXPERIMENTAL_B004_CALIBRATION,
  createB004CalibrationEvaluator,
} from '../../../../src/simulation/rules/b/index.ts'
import type { B004Input } from '../../../../src/simulation/rules/b/index.ts'
import { createCalibrationEvaluators } from '../../../../src/simulation/rules/c/index.ts'
import { EXPERIMENTAL_TUNING } from '../../../../src/simulation/tuning.ts'
import { deepFreeze } from '../../foundation/helpers.ts'

const P1 = 'person-exp-01'
const P2 = 'person-exp-02'
const P3 = 'person-exp-03'
const P4 = 'person-exp-04' // 基礎値なし
const without: StatModifierLedger = EXPERIMENTAL_EMPTY_LEDGER
const withBoost: StatModifierLedger = [EXPERIMENTAL_TRUST_BOOST]

const viewOf = (ledger: StatModifierLedger) => {
  const r = createPairTrustView({ base: EXPERIMENTAL_PAIR_TRUST_BASE, ledger, knownPersonIds: experimentalKnownPersonIds() })
  if (!r.ok) throw new Error('view')
  return r.view
}
const build = (ledger: StatModifierLedger, pairs: B004Input['pairs'], extra: Partial<B004Input> = {}) => {
  const r = createB004CalibrationEvaluator({ pairs, view: viewOf(ledger), ...extra })
  if (!r.ok) throw new Error(JSON.stringify(r.issues))
  return r.evaluator
}
const ctxOf = (year: number): EvaluationContext => ({
  year, phase: 3, ruleId: 'B-004', seed: 1, branchId: 'main',
  traceId: (i) => traceIdOf(year, 3, 'B-004', i),
  random: () => { throw new Error('B-004 は乱数を使わない') },
})
const world = (): WorldState => deepFreeze(createExperimentalWorld())
const evalDrafts = (ledger: StatModifierLedger, pairs: B004Input['pairs'], year = 1250, w: WorldState = world()) =>
  build(ledger, pairs)(w, ctxOf(year)).traceDrafts

describe('B-004 CALIBRATION_ONLY: 同年・同ペアの介入なし/あり（実測）', () => {
  const [off] = evalDrafts(without, [[P1, P2]])
  const [on] = evalDrafts(withBoost, [[P1, P2]])

  it('信頼値 10→30、候補スコア 10→30、試験しきい値 30 を跨いで REJECT→ACCEPT', () => {
    const cal = EXPERIMENTAL_B004_CALIBRATION
    expect(cal).toMatchObject({ status: 'CALIBRATION_ONLY', trustWeight: 1, acceptThreshold: 30 })
    expect(off!.candidates[0]).toMatchObject({
      eligible: true, score: 10, threshold: 30,
      inputs: { baseTrust: 10, rawModifierSum: 0, effectiveTrust: 10, modifierIds: [] },
    })
    expect(on!.candidates[0]).toMatchObject({
      eligible: true, score: 30, threshold: 30,
      inputs: { baseTrust: 10, rawModifierSum: 20, effectiveTrust: 30, modifierIds: ['mod-exp-trust-boost'] },
    })
    expect(off!.status).toBe('REJECT')
    expect(off!.selectedCandidateId).toBeUndefined()
    expect(on!.status).toBe('ACCEPT')
    expect(on!.selectedCandidateId).toBe('b004:person-exp-01|person-exp-02')
    expect(off!.modifierIds).toEqual([])
    expect(on!.modifierIds).toEqual(['mod-exp-trust-boost'])
    expect(on!.reasonCodes).toEqual(expect.arrayContaining(['CALIBRATION_ONLY', 'B004_TECHNICAL_ONLY', 'NO_MARRIAGE_REGISTERED', 'SCORE_AT_OR_ABOVE_THRESHOLD']))
    expect(off!.reasonCodes).toContain('SCORE_BELOW_THRESHOLD')
    expect(on!.ruleVersion).toBe(B004_RULE_VERSION)
  })

  it('Outcome は Command/Request/Deferred を持たない（婚姻成立・法的判断・出生・勝敗を偽装しない）', () => {
    const o = build(withBoost, [[P1, P2]])(world(), ctxOf(1250))
    expect(o).toMatchObject({ ruleId: 'B-004', phase: 3, commands: [], requests: [], deferred: [] })
    expect(JSON.stringify(o)).not.toContain('"type"')
  })

  it('runYear: 実 Trace が出て Event は 0 件・TODO は維持・入力は不変', () => {
    const w = world()
    for (const [ledger, status, score] of [[without, 'REJECT', 10], [withBoost, 'ACCEPT', 30]] as const) {
      const r = runYear(w, { seed: 5, evaluators: { 'B-004': build(ledger, [[P1, P2]]) } })
      if (r.status !== 'COMPLETED') throw new Error(JSON.stringify(r))
      expect(r.executedRuleIds).toEqual(['B-004'])
      expect(r.events).toEqual([])
      expect(r.world.legal.marriages).toEqual(w.legal.marriages)
      expect(r.traces).toHaveLength(1)
      const t = r.traces[0] as DecisionTrace
      expect(t).toMatchObject({ traceId: 'trace:1250:p3:B-004:0', ruleId: 'B-004', status, eventIds: [], actorRef: { kind: 'PERSON_PAIR', ids: [P1, P2] } })
      expect(t.candidates[0]!.score).toBe(score)
    }
    expect(getRule('B-004').implementationStatus).toBe('TODO')
    expect(getRule('B-009').implementationStatus).toBe('TODO')
    expect(RULE_REGISTRY.filter((x) => x.implementationStatus === 'TODO')).toHaveLength(37)
  })

  it('他の組: 95 は介入に関係なく ACCEPT、-30 は REJECT（(B,A) 順でも同じ）', () => {
    const [lo, hi] = evalDrafts(without, [[P3, P2], [P3, P1]]) // pairKey 昇順で評価される
    expect(hi!.status).toBe('ACCEPT')
    expect(hi!.candidates[0]).toMatchObject({ score: 95 })
    expect(lo!.status).toBe('REJECT')
    expect(lo!.candidates[0]).toMatchObject({ score: -30 })
  })
})

describe('B-004 安全側処理', () => {
  it('NO_BASE は DEFER（信頼値・スコアを発明しない）', () => {
    const [d] = evalDrafts(without, [[P1, P4]])
    expect(d!.status).toBe('DEFER')
    expect(d!.candidates[0]!.eligible).toBe(false)
    expect(d!.candidates[0]!.score).toBeUndefined()
    expect(d!.reasonCodes).toContain('NO_BASE_TRUST')
    expect(d!.selectedCandidateId).toBeUndefined()
  })

  it('WorldState に存在しない人物は DEFER', () => {
    const [d] = evalDrafts(without, [[P1, 'person-ghost']])
    expect(d!.status).toBe('DEFER')
    expect(d!.reasonCodes).toContain('PERSON_NOT_FOUND')
    expect(d!.candidates[0]!.inputs).toMatchObject({ missingPersonIds: ['person-ghost'] })
  })

  it('死亡している人物は ineligible な REJECT（スコアで採択しない）', () => {
    const w = createExperimentalWorld()
    const dead = { ...w, persons: w.persons.map((p) => (p.personId === P2 ? { ...p, alive: false, deathYear: 1249 } : p)) }
    const [d] = evalDrafts(withBoost, [[P1, P2]], 1250, deepFreeze(dead))
    expect(d!.status).toBe('REJECT')
    expect(d!.candidates[0]).toMatchObject({ eligible: false, inputs: { deceasedPersonIds: [P2] } })
    expect(d!.reasonCodes).toContain('PERSON_DECEASED')
    expect(d!.selectedCandidateId).toBeUndefined()
  })

  it('View が解決できない年は DEFER', () => {
    const [d] = evalDrafts(without, [[P1, P2]], 1400, deepFreeze({ ...createExperimentalWorld(), year: 1400 }))
    expect(d!.status).toBe('DEFER')
    expect(d!.reasonCodes).toContain('TRUST_UNRESOLVED')
  })

  it('不正ペア（自己・空 ID）・不正設定は評価器を作らない', () => {
    for (const pairs of [[[P1, P1]], [['', P2]]] as B004Input['pairs'][]) {
      const r = createB004CalibrationEvaluator({ pairs, view: viewOf(without) })
      expect(r.ok).toBe(false)
    }
    const bad = { ...EXPERIMENTAL_B004_CALIBRATION, acceptThreshold: 1.5 }
    expect(createB004CalibrationEvaluator({ pairs: [[P1, P2]], view: viewOf(without), calibration: bad }).ok).toBe(false)
    expect(createB004CalibrationEvaluator({ pairs: [[P1, P2]], view: viewOf(without), calibration: { ...EXPERIMENTAL_B004_CALIBRATION, trustWeight: -1 } }).ok).toBe(false)
  })

  it('year ズレは EvaluationFailure（黙って評価しない）', () => {
    expect(() => build(without, [[P1, P2]])(world(), ctxOf(1251))).toThrow(/一致しません/)
  })

  it('重複ペア（(A,B)/(B,A)）は 1 件へ畳み、入力順・ledger 配列順に依存しない', () => {
    const a = evalDrafts(withBoost, [[P1, P2], [P2, P1], [P1, P2]])
    expect(a).toHaveLength(1)
    const x = evalDrafts(withBoost, [[P1, P2], [P3, P2], [P3, P1], [P1, P4]])
    const y = evalDrafts(withBoost, [[P4, P1], [P1, P3], [P2, P3], [P2, P1]])
    expect(y).toEqual(x)
    expect(x.map((d) => d.candidates[0]!.candidateId)).toEqual([...x.map((d) => d.candidates[0]!.candidateId)].sort())
    const two: StatModifierLedger = [EXPERIMENTAL_TRUST_BOOST, { ...EXPERIMENTAL_TRUST_BOOST, modifierId: 'mod-b', interventionId: 'int-b', startYear: 1255, endExclusiveYear: 1256 }]
    expect(evalDrafts([...two].reverse(), [[P1, P2]])).toEqual(evalDrafts(two, [[P1, P2]]))
  })

  it('外部台帳・ペア配列を後から変更しても評価結果は変わらない', () => {
    const ledger = [{ ...EXPERIMENTAL_TRUST_BOOST }]
    const pairs: [string, string][] = [[P1, P2]]
    const ev = build(ledger, pairs)
    const before = ev(world(), ctxOf(1250))
    ledger.length = 0
    pairs.push([P3, P2])
    expect(ev(world(), ctxOf(1250))).toEqual(before)
  })

  it('同 seed・同入力で完全決定的、評価器は乱数を使わない', () => {
    const ev = build(withBoost, [[P1, P2], [P3, P2]])
    expect(ev(world(), ctxOf(1250))).toEqual(ev(world(), ctxOf(1250)))
  })
})

describe('B-004 × 年次 timeline（1250〜1350）', () => {
  const tuning = { ...EXPERIMENTAL_TUNING, birthRatePermille: { value: 30, origin: 'PLACEHOLDER' as const, note: '試験専用' }, growthRatePermille: { value: 20, origin: 'PLACEHOLDER' as const, note: '試験専用' } }
  const c004 = createCalibrationEvaluators(tuning)
  const pairs: B004Input['pairs'] = [[P1, P2], [P3, P2], [P1, P3], [P1, P4]]
  const run = (ledger: StatModifierLedger) =>
    runTimeline(createExperimentalWorld(), { seed: 11, evaluators: { ...c004, 'B-004': build(ledger, pairs) } })
  const off = run(without)
  const on = run(withBoost)
  const b004 = (t: typeof on, year: number) => t.decisionTraces.filter((x) => x.ruleId === 'B-004' && x.year === year)
  const pair12 = (t: typeof on, year: number) => b004(t, year).find((x) => x.actorRef.kind === 'PERSON_PAIR' && x.actorRef.ids[1] === P2 && x.actorRef.ids[0] === P1)!

  it('介入期間 [1250,1255) だけ P1-P2 の判定が REJECT→ACCEPT。以降は両者同じ', () => {
    expect(off.status).toBe('COMPLETED')
    expect(on.status).toBe('COMPLETED')
    for (const y of [1250, 1254]) {
      expect([pair12(off, y).status, pair12(on, y).status]).toEqual(['REJECT', 'ACCEPT'])
      expect([pair12(off, y).candidates[0]!.score, pair12(on, y).candidates[0]!.score]).toEqual([10, 30])
    }
    for (const y of [1255, 1300]) expect(pair12(on, y)).toEqual(pair12(off, y))
    expect(on.decisionTraces.filter((x) => x.ruleId === 'B-004')).toHaveLength(100 * 4)
  })

  it('Trace ID は年・フェーズ・ペア昇順 index で決定的、ruleVersion 一定', () => {
    const ids = b004(on, 1250).map((x) => x.traceId)
    expect(ids).toEqual([0, 1, 2, 3].map((i) => `trace:1250:p3:B-004:${i}`))
    expect(new Set(on.decisionTraces.map((x) => x.traceId)).size).toBe(on.decisionTraces.length)
    expect(new Set(on.decisionTraces.filter((x) => x.ruleId === 'B-004').map((x) => x.ruleVersion))).toEqual(new Set([B004_RULE_VERSION]))
  })

  it('C-004 確定 Event は B-004 併用でも不変（B-004 は Event を作らず参照整合も保つ）', () => {
    const cOnly = runTimeline(createExperimentalWorld(), { seed: 11, evaluators: c004 })
    expect(on.eventLog).toEqual(cOnly.eventLog)
    expect(off.eventLog).toEqual(cOnly.eventLog)
    expect(on.snapshots).toEqual(cOnly.snapshots)
    expect(on.decisionTraces.filter((x) => x.ruleId === 'RULE-C-004')).toEqual(cOnly.decisionTraces)
    const traceIds = new Set(on.decisionTraces.map((x) => x.traceId))
    for (const e of on.eventLog) for (const id of e.sourceTraceIds) expect(traceIds.has(id)).toBe(true)
    for (const t of on.decisionTraces.filter((x) => x.ruleId === 'B-004')) expect(t.eventIds).toEqual([])
    expect(on.eventLog.every((e) => e.eventType !== 'MARRIAGE_REGISTER')).toBe(true)
    expect(on.snapshots.every((s) => s.legal.marriages.length === 0)).toBe(true)
  })

  it('同 seed 再現。TODO 維持・goal=null・自律歴史は未成立', () => {
    expect(run(withBoost)).toEqual(on)
    expect(on.coverage.executedRuleIds).toEqual(['B-004', 'RULE-C-004'].sort((a, b) => RULE_REGISTRY.findIndex((r) => r.ruleId === a) - RULE_REGISTRY.findIndex((r) => r.ruleId === b)))
    expect(on.coverage.injectedTodoRuleIds).toContain('B-004')
    expect(on.coverage.implementedRuleIds).toEqual([])
    expect(on.goal).toBeNull()
    expect(on.autonomousHistory.status).toBe('NOT_ESTABLISHED')
  })
})
