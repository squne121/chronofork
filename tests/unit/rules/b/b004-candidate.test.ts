import { describe, expect, it } from 'vitest'
import {
  EXPERIMENTAL_EMPTY_LEDGER,
  EXPERIMENTAL_PAIR_TRUST_BASE,
  EXPERIMENTAL_TRUST_BOOST,
  createExperimentalWorld,
  experimentalKnownPersonIds,
} from '../../../../src/scenario/experimental/index.ts'
import type { DecisionTrace, PairTrustBase, StatModifier, WorldState } from '../../../../src/simulation/contracts/index.ts'
import { EvaluationFailure, runTimeline, runYear, traceIdOf } from '../../../../src/simulation/engine/index.ts'
import type { EvaluationContext } from '../../../../src/simulation/engine/index.ts'
import { createPairTrustView } from '../../../../src/simulation/intervention/index.ts'
import type { StatModifierLedger } from '../../../../src/simulation/intervention/index.ts'
import { RULE_REGISTRY, getRule } from '../../../../src/simulation/rule-registry.ts'
import {
  B004_MAX_TRUST_WEIGHT,
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
const P4 = 'person-exp-04'
const P5 = 'person-exp-05'
// test-local の synthetic fixture: P4(男)・P5(女) は WorldState 上に親子・兄弟姉妹の明示関係がない。
// 試験データであり、婚姻適格性を示さない。既存 experimental 世界の P1-P2（親子）・P2-P3/P1-P3 は縁談候補にしない。
const SYN_BASE: readonly PairTrustBase[] = [...EXPERIMENTAL_PAIR_TRUST_BASE, { personIds: [P4, P5], value: 10 }]
const SYN_BOOST: StatModifier = { ...EXPERIMENTAL_TRUST_BOOST, modifierId: 'mod-syn-boost', interventionId: 'int-syn-boost', targetRef: { kind: 'PERSON_PAIR', ids: [P4, P5] } }
const without: StatModifierLedger = EXPERIMENTAL_EMPTY_LEDGER
const withBoost: StatModifierLedger = [SYN_BOOST, EXPERIMENTAL_TRUST_BOOST] // 後者は親子 P1-P2 への介入（DEFER 回帰用）
const synWorld = (): WorldState => {
  const w = createExperimentalWorld()
  return { ...w, persons: w.persons.map((p) => (p.personId === P5 ? { ...p, sex: 'FEMALE' as const } : p)) }
}

const viewOf = (ledger: StatModifierLedger) => {
  const r = createPairTrustView({ base: SYN_BASE, ledger, knownPersonIds: experimentalKnownPersonIds() })
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
const world = (): WorldState => deepFreeze(synWorld())
const evalDrafts = (ledger: StatModifierLedger, pairs: B004Input['pairs'], year = 1250, w: WorldState = world()) =>
  build(ledger, pairs)(w, ctxOf(year)).traceDrafts

describe('B-004 CALIBRATION_ONLY: 同年・同ペア（P4-P5 synthetic）の介入なし/あり（実測）', () => {
  const [off] = evalDrafts(without, [[P4, P5]])
  const [on] = evalDrafts(withBoost, [[P5, P4]])
  const cid = 'b004:["person-exp-04","person-exp-05"]'

  it('信頼値 10→30、候補スコア 10→30、試験しきい値 30 を跨いで REJECT→ACCEPT', () => {
    expect(EXPERIMENTAL_B004_CALIBRATION).toMatchObject({ status: 'CALIBRATION_ONLY', trustWeight: 1, acceptThreshold: 30 })
    expect(off!.candidates[0]).toMatchObject({
      candidateId: cid, eligible: true, score: 10, threshold: 30,
      inputs: { baseTrust: 10, rawModifierSum: 0, effectiveTrust: 10, modifierIds: [], trustWeight: 1, acceptThreshold: 30 },
    })
    expect(on!.candidates[0]).toMatchObject({
      eligible: true, score: 30, threshold: 30,
      inputs: { baseTrust: 10, rawModifierSum: 20, effectiveTrust: 30, modifierIds: ['mod-syn-boost'] },
    })
    expect(off!.status).toBe('REJECT')
    expect(off!.selectedCandidateId).toBeUndefined()
    expect(on!.status).toBe('ACCEPT')
    expect(on!.selectedCandidateId).toBe(cid)
    expect(off!.modifierIds).toEqual([])
    expect(on!.modifierIds).toEqual(['mod-syn-boost'])
    // ACCEPT は信頼スコアの技術的採否のみ。婚姻適格性は未審査と明記する。
    expect(on!.reasonCodes).toEqual(expect.arrayContaining(['CALIBRATION_ONLY', 'B004_TECHNICAL_ONLY', 'NO_MARRIAGE_REGISTERED', 'MARRIAGE_ELIGIBILITY_UNREVIEWED', 'SCORE_AT_OR_ABOVE_THRESHOLD']))
    expect(off!.reasonCodes).toEqual(expect.arrayContaining(['MARRIAGE_ELIGIBILITY_UNREVIEWED', 'SCORE_BELOW_THRESHOLD']))
    expect(on!.ruleVersion).toBe(B004_RULE_VERSION)
  })

  it('既知の親子（P1-P2, P1-P3）・兄妹（P2-P3）は、介入や高信頼でも eligible:false の DEFER（適格性を確定しない）', () => {
    const ds = evalDrafts(withBoost, [[P1, P2], [P1, P3], [P2, P3]])
    expect(ds.map((d) => d.status)).toEqual(['DEFER', 'DEFER', 'DEFER'])
    expect(ds.map((d) => d.candidates[0]!.inputs.knownKinship)).toEqual(['PARENT_CHILD', 'PARENT_CHILD', 'SIBLING'])
    for (const d of ds) {
      expect(d.candidates[0]).toMatchObject({ eligible: false })
      expect(d.candidates[0]!.score).toBeUndefined()
      expect(d.selectedCandidateId).toBeUndefined()
      expect(d.reasonCodes).toEqual(expect.arrayContaining(['KINSHIP_UNREVIEWED', 'MARRIAGE_ELIGIBILITY_UNREVIEWED']))
    }
  })

  it('Outcome は Command/Request/Deferred を持たない（婚姻成立・法的判断・出生・勝敗を偽装しない）', () => {
    const o = build(withBoost, [[P4, P5]])(world(), ctxOf(1250))
    expect(o).toMatchObject({ ruleId: 'B-004', phase: 3, commands: [], requests: [], deferred: [] })
    expect(JSON.stringify(o)).not.toContain('"type"')
  })

  it('runYear: 実 Trace が出て Event は 0 件・TODO は維持・入力は不変', () => {
    const w = world()
    for (const [ledger, status, score] of [[without, 'REJECT', 10], [withBoost, 'ACCEPT', 30]] as const) {
      const r = runYear(w, { seed: 5, evaluators: { 'B-004': build(ledger, [[P4, P5]]) } })
      if (r.status !== 'COMPLETED') throw new Error(JSON.stringify(r))
      expect(r.executedRuleIds).toEqual(['B-004'])
      expect(r.events).toEqual([])
      expect(r.world.legal.marriages).toEqual(w.legal.marriages)
      expect(r.traces).toHaveLength(1)
      const t = r.traces[0] as DecisionTrace
      expect(t).toMatchObject({ traceId: 'trace:1250:p3:B-004:0', ruleId: 'B-004', status, eventIds: [], actorRef: { kind: 'PERSON_PAIR', ids: [P4, P5] } })
      expect(t.candidates[0]!.score).toBe(score)
    }
    expect(getRule('B-004').implementationStatus).toBe('TODO')
    expect(getRule('B-009').implementationStatus).toBe('TODO')
    expect(RULE_REGISTRY.filter((x) => x.implementationStatus === 'TODO')).toHaveLength(37)
  })
})

describe('B-004 誤注入・符号化・設定の拒否', () => {
  const ev = build(withBoost, [[P4, P5]])

  it('B-004 以外の RuleID／phase 3 以外では EvaluationFailure（直接呼出し）', () => {
    expect(() => ev(world(), { ...ctxOf(1250), ruleId: 'B-009' })).toThrow(/B-004/)
    expect(() => ev(world(), { ...ctxOf(1250), phase: 4 })).toThrow(/B-004/)
    try { ev(world(), { ...ctxOf(1250), ruleId: 'B-009' }) } catch (e) {
      expect(e).toBeInstanceOf(EvaluationFailure)
      expect((e as EvaluationFailure).diagnostics[0]!.code).toBe('RULE_MISMATCH')
    }
  })

  it('runYear に B-009 として誤注入すると EVALUATION_FAILED で停止し、Trace/Event を確定しない', () => {
    const w = world()
    const r = runYear(w, { seed: 1, evaluators: { 'B-009': ev } })
    expect(r.status).toBe('HALTED')
    if (r.status !== 'HALTED') return
    expect(r.halt).toMatchObject({ code: 'EVALUATION_FAILED', ruleId: 'B-009', phase: 3 })
    expect(r.halt.evaluatorDiagnostics[0]!.code).toBe('RULE_MISMATCH')
    expect(r.halt.traces).toEqual([])
    expect(r.world).toEqual(w)
  })

  it('区切り文字を含む ID でも candidateId はペアごとに別（JSON 符号化）', () => {
    const known = new Set(['a', 'b|c', 'a|b', 'c'])
    const r = createPairTrustView({ base: [], ledger: [], knownPersonIds: known })
    if (!r.ok) throw new Error('view')
    const e = createB004CalibrationEvaluator({ pairs: [['a', 'b|c'], ['a|b', 'c']], view: r.view })
    if (!e.ok) throw new Error('evaluator')
    const w = deepFreeze(createExperimentalWorld())
    const persons = [...known].map((personId) => ({ ...w.persons[0]!, personId }))
    const ds = e.evaluator({ ...w, persons }, ctxOf(1250)).traceDrafts
    const ids = ds.map((d) => d.candidates[0]!.candidateId)
    expect(new Set(ids).size).toBe(2)
    expect(ids).toContain('b004:["a","b|c"]')
  })

  it('trustWeight が過大で score が安全整数を超える設定、非整数・負・NaN は拒否。上限ちょうどは安全整数に収まる', () => {
    expect(B004_MAX_TRUST_WEIGHT * 100).toBeLessThanOrEqual(Number.MAX_SAFE_INTEGER)
    for (const trustWeight of [B004_MAX_TRUST_WEIGHT + 1, Number.MAX_SAFE_INTEGER, 1.5, -1, Number.NaN, Infinity]) {
      expect(createB004CalibrationEvaluator({ pairs: [[P4, P5]], view: viewOf(without), calibration: { ...EXPERIMENTAL_B004_CALIBRATION, trustWeight } }).ok).toBe(false)
    }
    const edge = createB004CalibrationEvaluator({ pairs: [[P4, P5]], view: viewOf(without), calibration: { ...EXPERIMENTAL_B004_CALIBRATION, trustWeight: B004_MAX_TRUST_WEIGHT } })
    expect(edge.ok).toBe(true)
    if (!edge.ok) return
    const score = edge.evaluator(world(), ctxOf(1250)).traceDrafts[0]!.candidates[0]!.score!
    expect(Number.isSafeInteger(score)).toBe(true)
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
    const w = synWorld()
    const dead = { ...w, persons: w.persons.map((p) => (p.personId === P5 ? { ...p, alive: false, deathYear: 1249 } : p)) }
    const [d] = evalDrafts(withBoost, [[P4, P5]], 1250, deepFreeze(dead))
    expect(d!.status).toBe('REJECT')
    expect(d!.candidates[0]).toMatchObject({ eligible: false, inputs: { deceasedPersonIds: [P5] } })
    expect(d!.reasonCodes).toContain('PERSON_DECEASED')
    expect(d!.selectedCandidateId).toBeUndefined()
  })

  it('View が解決できない年は DEFER', () => {
    const [d] = evalDrafts(without, [[P4, P5]], 1400, deepFreeze({ ...synWorld(), year: 1400 }))
    expect(d!.status).toBe('DEFER')
    expect(d!.reasonCodes).toContain('TRUST_UNRESOLVED')
  })

  it('不正ペア（自己・空 ID）・不正設定は評価器を作らない', () => {
    for (const pairs of [[[P1, P1]], [['', P2]]] as B004Input['pairs'][]) {
      const r = createB004CalibrationEvaluator({ pairs, view: viewOf(without) })
      expect(r.ok).toBe(false)
    }
    const bad = { ...EXPERIMENTAL_B004_CALIBRATION, acceptThreshold: 1.5 }
    expect(createB004CalibrationEvaluator({ pairs: [[P4, P5]], view: viewOf(without), calibration: bad }).ok).toBe(false)
    expect(createB004CalibrationEvaluator({ pairs: [[P1, P2]], view: viewOf(without), calibration: { ...EXPERIMENTAL_B004_CALIBRATION, trustWeight: -1 } }).ok).toBe(false)
  })

  it('year ズレは EvaluationFailure（黙って評価しない）', () => {
    expect(() => build(without, [[P4, P5]])(world(), ctxOf(1251))).toThrow(/一致しません/)
  })

  it('重複ペア（(A,B)/(B,A)）は 1 件へ畳み、入力順・ledger 配列順に依存しない', () => {
    const a = evalDrafts(withBoost, [[P4, P5], [P5, P4], [P4, P5]])
    expect(a).toHaveLength(1)
    const x = evalDrafts(withBoost, [[P4, P5], [P3, P2], [P3, P1], [P1, P4]])
    const y = evalDrafts(withBoost, [[P4, P1], [P1, P3], [P2, P3], [P5, P4]])
    expect(y).toEqual(x)
    expect(x.map((d) => d.candidates[0]!.candidateId)).toEqual([...x.map((d) => d.candidates[0]!.candidateId)].sort())
    const two: StatModifierLedger = [SYN_BOOST, { ...SYN_BOOST, modifierId: 'mod-b', interventionId: 'int-b', startYear: 1255, endExclusiveYear: 1256 }]
    expect(evalDrafts([...two].reverse(), [[P4, P5]])).toEqual(evalDrafts(two, [[P4, P5]]))
  })

  it('外部台帳・ペア配列を後から変更しても評価結果は変わらない', () => {
    const ledger = [{ ...SYN_BOOST }]
    const pairs: [string, string][] = [[P4, P5]]
    const ev = build(ledger, pairs)
    const before = ev(world(), ctxOf(1250))
    ledger.length = 0
    pairs.push([P3, P2])
    expect(ev(world(), ctxOf(1250))).toEqual(before)
  })

  it('同 seed・同入力で完全決定的、評価器は乱数を使わない', () => {
    const e2 = build(withBoost, [[P4, P5], [P3, P2]])
    expect(e2(world(), ctxOf(1250))).toEqual(e2(world(), ctxOf(1250)))
  })
})

describe('B-004 × 年次 timeline（1250〜1350）', () => {
  const tuning = { ...EXPERIMENTAL_TUNING, birthRatePermille: { value: 30, origin: 'PLACEHOLDER' as const, note: '試験専用' }, growthRatePermille: { value: 20, origin: 'PLACEHOLDER' as const, note: '試験専用' } }
  const c004 = createCalibrationEvaluators(tuning)
  const pairs: B004Input['pairs'] = [[P4, P5], [P3, P2], [P1, P3], [P1, P4]]
  const run = (ledger: StatModifierLedger) =>
    runTimeline(synWorld(), { seed: 11, evaluators: { ...c004, 'B-004': build(ledger, pairs) } })
  const off = run(without)
  const on = run(withBoost)
  const b004 = (t: typeof on, year: number) => t.decisionTraces.filter((x) => x.ruleId === 'B-004' && x.year === year)
  const pair45 = (t: typeof on, year: number) => b004(t, year).find((x) => x.actorRef.kind === 'PERSON_PAIR' && x.actorRef.ids[0] === P4 && x.actorRef.ids[1] === P5)!

  it('介入期間 [1250,1255) だけ P4-P5 の判定が REJECT→ACCEPT。以降は両者同じ', () => {
    expect(off.status).toBe('COMPLETED')
    expect(on.status).toBe('COMPLETED')
    for (const y of [1250, 1254]) {
      expect([pair45(off, y).status, pair45(on, y).status]).toEqual(['REJECT', 'ACCEPT'])
      expect([pair45(off, y).candidates[0]!.score, pair45(on, y).candidates[0]!.score]).toEqual([10, 30])
    }
    for (const y of [1255, 1300]) expect(pair45(on, y)).toEqual(pair45(off, y))
    expect(on.decisionTraces.filter((x) => x.ruleId === 'B-004')).toHaveLength(100 * 4)
  })

  it('Trace ID は年・フェーズ・ペア昇順 index で決定的、ruleVersion 一定', () => {
    const ids = b004(on, 1250).map((x) => x.traceId)
    expect(ids).toEqual([0, 1, 2, 3].map((i) => `trace:1250:p3:B-004:${i}`))
    expect(new Set(on.decisionTraces.map((x) => x.traceId)).size).toBe(on.decisionTraces.length)
    expect(new Set(on.decisionTraces.filter((x) => x.ruleId === 'B-004').map((x) => x.ruleVersion))).toEqual(new Set([B004_RULE_VERSION]))
  })

  it('C-004 確定 Event は B-004 併用でも不変（B-004 は Event を作らず参照整合も保つ）', () => {
    const cOnly = runTimeline(synWorld(), { seed: 11, evaluators: c004 })
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
