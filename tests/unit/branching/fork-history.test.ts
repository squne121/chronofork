// forkHistory の検証。評価器は CALIBRATION_ONLY / synthetic の fixture（実ルールではない。Registry は変更しない）。
// 差分は fixture 評価器が実際に runTimeline で再計算した結果であり、歴史や勝敗を手で組み立てていない。
import { describe, expect, it } from 'vitest'
import type { StatModifier, WorldState } from '../../../src/simulation/contracts/index.ts'
import { PAIR_TRUST_STAT_KEY, STAT_MODIFIER_RULE_VERSION } from '../../../src/simulation/contracts/index.ts'
import { runTimeline } from '../../../src/simulation/engine/index.ts'
import type { EvaluatorMap } from '../../../src/simulation/engine/index.ts'
import { modifierContribution, toPairRef } from '../../../src/simulation/intervention/index.ts'
import type { StatModifierLedger } from '../../../src/simulation/intervention/index.ts'
import {
  computedYears, createRootBranch, diffBranchesAtYear, forkHistory, readYear,
} from '../../../src/simulation/branching/index.ts'
import type { Branch, BranchEvaluatorFactory } from '../../../src/simulation/branching/index.ts'
import { cohortCommand, draft, GROUP, newWorld, outcomeOf } from '../engine/runner/fixtures.ts'

const SEED = 42
const personIds = newWorld().persons.map((p) => p.personId).sort()
const P = personIds
const pair = (i: number, j: number) => toPairRef(P[i]!, P[j]!)!

let seq = 0
const mod = (startYear: number, over: Partial<StatModifier> & { pair?: [number, number] } = {}): StatModifier => {
  const { pair: pr = [0, 1], ...rest } = over
  seq += 1
  return {
    modifierId: `m-${seq}`, interventionId: `i-${seq}`, targetRef: pair(pr[0], pr[1]), statKey: PAIR_TRUST_STAT_KEY,
    signedDelta: 5, startYear, endExclusiveYear: 1350, decayPolicy: 'NONE', ruleVersion: STAT_MODIFIER_RULE_VERSION, ...rest,
  }
}

type Counter = { calls: { branchId: string; year: number }[]; draws: Map<string, number> }
/** synthetic: 出生数 = 20 + 乱数(0..4) + その年に有効な modifier の signedDelta 合計。台帳に反応する唯一の因果。 */
function factory(counter: Counter, opts: { throwAtYear?: number } = {}): BranchEvaluatorFactory {
  return ({ ledger }): EvaluatorMap => ({
    'RULE-C-004': (_w, ctx) => {
      counter.calls.push({ branchId: ctx.branchId, year: ctx.year })
      if (ctx.year === opts.throwAtYear) throw new Error('synthetic failure')
      const v = ctx.random({ stream: 'EXOGENOUS', targetId: GROUP, eventKey: 'births' })
      counter.draws.set(`${ctx.year}`, v)
      const bonus = ledger.reduce((s, m) => s + modifierContribution(m, ctx.year), 0)
      return outcomeOf(ctx, { commands: [cohortCommand(ctx, 20 + Math.floor(v * 5) + bonus, 16)], traceDrafts: [draft(ctx)] })
    },
  })
}
const newCounter = (): Counter => ({ calls: [], draws: new Map() })

function makeRoot(ledger: StatModifierLedger = [], counter = newCounter(), opts: { throwAtYear?: number; seed?: number } = {}): Branch {
  const evaluators = factory(counter, opts)({
    branchId: 'A0', parentBranchId: 'none', forkYear: 1250, seed: SEED, ledger, knownPersonIds: new Set(P),
  })
  const r = createRootBranch(runTimeline(newWorld(), { seed: opts.seed ?? SEED, branchId: 'A0', evaluators }), ledger)
  if (!r.ok) throw new Error(r.message)
  return r.branch
}
const fork = (parent: Branch, forkYear: number, modifiers: StatModifier[], branchId = 'A1', counter = newCounter()) =>
  forkHistory({ parent, forkYear, branchId, modifiers, evaluatorsFor: factory(counter) })
const ok = (r: ReturnType<typeof forkHistory>): Branch => {
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`)
  return r.branch
}
const pop = (w: WorldState) => w.groups.find((g) => g.groupId === GROUP)!.population

describe('年初分岐と実再計算', () => {
  const root = makeRoot()
  it('A0 は 100 遷移・101 snapshot。t=1260 で fork: t までの履歴が一致し、t 以降だけ評価器が呼ばれる', () => {
    expect(root.snapshots).toHaveLength(101)
    const before = JSON.stringify(root)
    const counter = newCounter()
    const a1 = ok(fork(root, 1260, [mod(1260)], 'A1', counter))
    expect(a1.snapshots).toHaveLength(101)
    expect(a1.snapshots.slice(0, 11)).toEqual(root.snapshots.slice(0, 11)) // 1250..1260 年初
    expect(a1.eventLog.filter((e) => e.year < 1260)).toEqual(root.eventLog.filter((e) => e.year < 1260))
    expect(a1.decisionTraces.filter((t) => t.year < 1260)).toEqual(root.decisionTraces.filter((t) => t.year < 1260))
    expect(counter.calls.map((c) => c.year)).toEqual(Array.from({ length: 90 }, (_, i) => 1260 + i)) // 1260..1349 のみ
    expect(counter.calls.every((c) => c.branchId === 'A1')).toBe(true)
    expect(JSON.stringify(root)).toBe(before) // 親枝不変
    expect(Object.isFrozen(a1.snapshots[0])).toBe(true)
    expect(a1.goal).toBeNull()
    expect(a1.recompute).toMatchObject({ fromYear: 1260, status: 'COMPLETED', transitions: 90 })
  })

  it('再計算の差分は実イベント由来。同年の同一意味 Event ID は branch で変わらず、状態だけ分岐する', () => {
    const a1 = ok(fork(root, 1260, [mod(1260, { signedDelta: 9 })]))
    expect(diffBranchesAtYear(root, a1, 1260)).toMatchObject({ status: 'DIFFERENCE', changes: [] }) // 年初は同一
    const d = diffBranchesAtYear(root, a1, 1261)
    expect(d.status === 'DIFFERENCE' && d.changes.length).toBeGreaterThan(0)
    expect(pop(a1.snapshots[a1.snapshots.length - 1]!)).toBeGreaterThan(pop(root.snapshots[100]!))
    const e0 = root.eventLog.find((e) => e.year === 1260)!
    const e1 = a1.eventLog.find((e) => e.year === 1260)!
    expect([e1.eventId, e1.semanticEventKey]).toEqual([e0.eventId, e0.semanticEventKey])
    expect(e1.stateChanges).not.toEqual(e0.stateChanges) // 出生数が違う = 実再計算の結果
    expect(computedYears(a1)).toEqual(computedYears(root))
    const y = readYear(a1, 1300)
    expect(y.status === 'COMPUTED' && y.source).toBe('RECOMPUTED')
    expect(readYear(a1, 1259)).toMatchObject({ source: 'INHERITED_PREFIX' })
    expect(readYear(a1, 1260)).toMatchObject({ source: 'FORK_POINT' })
    expect(readYear(a1, 1350)).toMatchObject({ status: 'COMPUTED', transition: null })
    expect(readYear(root, 1300)).toMatchObject({ source: 'ROOT' })
  })

  it('同 seed の再実行は一致し、branchId は乱数・Event ID に影響しない（外生乱数は枝間で同値）', () => {
    const c1 = newCounter(); const c2 = newCounter()
    const m = mod(1260)
    const x = ok(fork(root, 1260, [m], 'A1', c1))
    const y = ok(fork(root, 1260, [m], 'zzz-別名', c2))
    const strip = (b: Branch) => ({ ...b, branchId: '', lineage: [], recompute: null, decisionTraces: b.decisionTraces })
    expect(strip(y)).toEqual(strip(x))
    expect([...c2.draws]).toEqual([...c1.draws])
    expect(x.eventLog.map((e) => e.eventId)).toEqual(y.eventLog.map((e) => e.eventId))
    expect(ok(fork(root, 1260, [m], 'A1'))).toEqual(x)
  })
})

describe('modifier 引継ぎ', () => {
  const past = mod(1255, { pair: [0, 1] })
  const sameYearOther = mod(1260, { pair: [2, 3] })
  const future = mod(1270, { pair: [0, 1] })
  const root = makeRoot([past, sameYearOther, future])

  it('開始年<t と =t の別対象は保持、>t は破棄。元台帳は不変', () => {
    const added = mod(1260, { pair: [0, 1] })
    const a1 = ok(fork(root, 1260, [added]))
    expect(a1.ledger.map((m) => m.modifierId).sort()).toEqual([past.modifierId, sameYearOther.modifierId, added.modifierId].sort())
    expect(root.ledger).toHaveLength(3)
    // 年を跨いで継続する過去 modifier（1255→1350）は 1300 年でも有効、破棄した 1270 分は寄与しない。
    expect(a1.ledger.some((m) => m.startYear === 1270)).toBe(false)
  })

  it('同年同対象同 statKey の重複は拒否（無言で置換しない）。未登録 statKey・未知人物も拒否', () => {
    const dup = fork(root, 1260, [mod(1260, { pair: [2, 3] })])
    expect(dup).toMatchObject({ ok: false, code: 'MODIFIER_REJECTED' })
    expect(!dup.ok && dup.issues.map((i) => i.code)).toContain('DUPLICATE_SAME_YEAR_TARGET_STAT')
    const bad = fork(root, 1260, [mod(1260, { statKey: 'pair.unknown' })])
    expect(!bad.ok && bad.issues.map((i) => i.code)).toContain('UNREGISTERED_STAT_KEY')
    expect(fork(root, 1260, [{ ...mod(1260), targetRef: { kind: 'PERSON_PAIR', ids: ['no-a', 'no-b'] } }])).toMatchObject({ ok: false, code: 'MODIFIER_REJECTED' })
  })

  it('既存と同一の modifier の再送は新しい介入ではないので拒否', () => {
    expect(fork(root, 1260, [sameYearOther])).toMatchObject({ ok: false, code: 'DUPLICATE_INTERVENTION' })
  })

  it('複数 branch と子 branch からの fork。子は祖先の分岐年より前では分岐できない', () => {
    const b1 = ok(fork(root, 1260, [mod(1260, { pair: [0, 1] })], 'B1'))
    const b2 = ok(fork(root, 1260, [mod(1260, { pair: [0, 2], signedDelta: 8 })], 'B2'))
    expect(b1.snapshots.at(-1)).not.toEqual(b2.snapshots.at(-1))
    const c = ok(fork(b1, 1300, [mod(1300, { pair: [1, 2] })], 'C1'))
    expect(c.parentBranchId).toBe('B1')
    expect(c.lineage).toEqual(['A0', 'B1', 'C1'])
    expect(c.snapshots.slice(0, 51)).toEqual(b1.snapshots.slice(0, 51))
    expect(c.ledger.some((m) => m.startYear === 1255)).toBe(true) // 祖先の継続 modifier も保持
    expect(readYear(c, 1270)).toMatchObject({ source: 'INHERITED_PREFIX' })
    expect(fork(b1, 1259, [mod(1259)], 'C2')).toMatchObject({ ok: false, code: 'FORK_BEFORE_PARENT_FORK' })
    expect(fork(b1, 1300, [mod(1300, { pair: [1, 2] })], 'B1')).toMatchObject({ ok: false, code: 'INVALID_BRANCH_ID' })
  })
})

/** 台帳に反応しない synthetic 評価器（modifier 以外の条件が同じなら親と同じ履歴になる）。 */
const plainFactory = (ruleIds: ('RULE-C-004' | 'RULE-C-005')[] = ['RULE-C-004']): BranchEvaluatorFactory => () =>
  Object.fromEntries(ruleIds.map((id) => [id, (_w: WorldState, ctx: Parameters<NonNullable<EvaluatorMap[typeof id]>>[1]) =>
    id === 'RULE-C-004'
      ? outcomeOf(ctx, { commands: [cohortCommand(ctx, 20 + Math.floor(ctx.random({ stream: 'EXOGENOUS', targetId: GROUP, eventKey: 'b' }) * 5), 16)], traceDrafts: [draft(ctx)] })
      : outcomeOf(ctx, { traceDrafts: [draft(ctx, 'REJECT', 'NO_ELIGIBLE_CANDIDATE')] })])) as EvaluatorMap
const rootWith = (f: BranchEvaluatorFactory | null): Branch => {
  const ev = f?.({ branchId: 'R', parentBranchId: 'n', forkYear: 1250, seed: SEED, ledger: [], knownPersonIds: new Set() }) ?? {}
  return ok(createRootBranch(runTimeline(newWorld(), { seed: SEED, branchId: 'R', evaluators: ev }), [], ev))
}

describe('評価器構成の照合（fail-closed）', () => {
  it('modifier 以外が同じなら親と同じ履歴が再現される（C004 相当の評価器あり）', () => {
    const parent = rootWith(plainFactory())
    expect(parent.evaluatorProfile).toEqual({ mode: 'RULES', ruleIds: ['RULE-C-004'] })
    const f = ok(forkHistory({ parent, forkYear: 1260, branchId: 'F', modifiers: [mod(1260)], evaluatorsFor: plainFactory() }))
    expect(f.snapshots).toEqual(parent.snapshots)
    expect(f.eventLog).toEqual(parent.eventLog)
    expect(f.decisionTraces).toEqual(parent.decisionTraces)
    expect(f.evaluatorProfile).toEqual(parent.evaluatorProfile)
  })
  it('評価器の渡し忘れ・片方だけ欠落・別ルール・余分は EVALUATOR_MISMATCH', () => {
    const one = rootWith(plainFactory())
    const m = () => [mod(1260)]
    expect(forkHistory({ parent: one, forkYear: 1260, branchId: 'F', modifiers: m() })).toMatchObject({ ok: false, code: 'EVALUATOR_MISMATCH' })
    expect(forkHistory({ parent: one, forkYear: 1260, branchId: 'F', modifiers: m(), evaluatorsFor: () => ({}) })).toMatchObject({ ok: false, code: 'EVALUATOR_MISMATCH' })
    expect(forkHistory({ parent: one, forkYear: 1260, branchId: 'F', modifiers: m(), evaluatorsFor: plainFactory(['RULE-C-005']) })).toMatchObject({ ok: false, code: 'EVALUATOR_MISMATCH' })
    expect(forkHistory({ parent: one, forkYear: 1260, branchId: 'F', modifiers: m(), evaluatorsFor: plainFactory(['RULE-C-004', 'RULE-C-005']) })).toMatchObject({ ok: false, code: 'EVALUATOR_MISMATCH' })
    const two = rootWith(plainFactory(['RULE-C-004', 'RULE-C-005']))
    expect(forkHistory({ parent: two, forkYear: 1260, branchId: 'F', modifiers: m(), evaluatorsFor: plainFactory() })).toMatchObject({ ok: false, code: 'EVALUATOR_MISMATCH' })
    expect(forkHistory({ parent: two, forkYear: 1260, branchId: 'F', modifiers: m(), evaluatorsFor: plainFactory(['RULE-C-004', 'RULE-C-005']) }).ok).toBe(true)
  })
  it('空評価器の技術試験は親も空（NONE）のときだけ通り、世界は変化しない。評価器を足すのも拒否', () => {
    const empty = rootWith(null)
    expect(empty.evaluatorProfile).toEqual({ mode: 'NONE', ruleIds: [] })
    const f = ok(forkHistory({ parent: empty, forkYear: 1260, branchId: 'F', modifiers: [mod(1260)] }))
    expect(f.evaluatorProfile.mode).toBe('NONE')
    expect(f.eventLog).toEqual([])
    expect(f.snapshots.map((s) => ({ ...s, year: 0 }))).toEqual(empty.snapshots.map((s) => ({ ...s, year: 0 })))
    expect(forkHistory({ parent: empty, forkYear: 1260, branchId: 'F', modifiers: [mod(1260)], evaluatorsFor: plainFactory() })).toMatchObject({ ok: false, code: 'EVALUATOR_MISMATCH' })
  })
})

describe('createRootBranch の評価器指定は実行済み RuleID と一致が必要', () => {
  const c004 = plainFactory()({ branchId: 'R', parentBranchId: 'n', forkYear: 1250, seed: SEED, ledger: [], knownPersonIds: new Set() })
  const c005 = plainFactory(['RULE-C-005'])({ branchId: 'R', parentBranchId: 'n', forkYear: 1250, seed: SEED, ledger: [], knownPersonIds: new Set() })
  const ran = (ev: EvaluatorMap) => runTimeline(newWorld(), { seed: SEED, branchId: 'R', evaluators: ev })
  it('C004 の実行結果へ C005 だけを指定する誤用は拒否。正しい構成は成功、省略時は coverage 由来', () => {
    expect(createRootBranch(ran(c004), [], c005)).toMatchObject({ ok: false, code: 'EVALUATOR_MISMATCH' })
    expect(createRootBranch(ran(c004), [], { ...c004, ...c005 })).toMatchObject({ ok: false, code: 'EVALUATOR_MISMATCH' })
    const good = createRootBranch(ran(c004), [], c004)
    expect(good.ok && good.branch.evaluatorProfile).toEqual({ mode: 'RULES', ruleIds: ['RULE-C-004'] })
    const omitted = createRootBranch(ran(c004))
    expect(omitted.ok && omitted.branch.evaluatorProfile.ruleIds).toEqual(['RULE-C-004'])
  })
  it('評価器なしの履歴（空）へ余分な評価器を指定すると拒否。空指定は成功', () => {
    expect(createRootBranch(ran({}), [], c004)).toMatchObject({ ok: false, code: 'EVALUATOR_MISMATCH' })
    expect(createRootBranch(ran({}), [], {}).ok).toBe(true)
  })
  it('HALTED の親は従来どおり登録でき、停止診断を保持する', () => {
    const halted = ran(factory(newCounter(), { throwAtYear: 1280 })({ branchId: 'R', parentBranchId: 'n', forkYear: 1250, seed: SEED, ledger: [], knownPersonIds: new Set() }))
    const r = createRootBranch(halted, [], c005)
    expect(r.ok && r.branch.halt).toMatchObject({ code: 'EVALUATOR_EXCEPTION', year: 1280 })
  })
})

describe('壊れた親 Branch は例外なく INVALID_PARENT', () => {
  const root = makeRoot()
  const bad = (name: string, broken: unknown) =>
    it(name, () => {
      const r = forkHistory({ parent: broken as Branch, forkYear: 1260, branchId: 'Z', modifiers: [mod(1260)], evaluatorsFor: factory(newCounter()) })
      expect(r).toMatchObject({ ok: false, code: 'INVALID_PARENT' })
    })
  const snaps = (f: (a: unknown[]) => void) => { const a = [...root.snapshots] as unknown[]; f(a); return { ...root, snapshots: a } }
  bad('lineage 欠落', { ...root, lineage: undefined })
  bad('lineage 末尾が branchId と不一致', { ...root, lineage: ['x'] })
  bad('snapshot 配列内 null', snaps((a) => { a[10] = null }))
  bad('snapshot の人物配列欠落（fork 年）', snaps((a) => { a[10] = { ...(a[10] as object), persons: undefined } }))
  bad('snapshot の人物配列欠落（別年）', snaps((a) => { a[40] = { ...(a[40] as object), persons: undefined } }))
  bad('年の不連続', snaps((a) => { a.splice(5, 1) }))
  bad('startYear 不正', { ...root, startYear: 'x' })
  bad('parentBranchId が lineage と不整合', { ...root, parentBranchId: 'q' })
  bad('forkYear が root なのに非 null', { ...root, forkYear: 1260 })
  bad('status と halt の不整合', { ...root, halt: { code: 'X' } })
  bad('eventLog 欠落', { ...root, eventLog: undefined })
  bad('evaluatorProfile 欠落', { ...root, evaluatorProfile: undefined })
  bad('null 親', null)
  bad('空オブジェクト', {})
})

describe('未来 modifier の破棄（継承分だけを fork 年の世界で検証）', () => {
  const futurePerson = 'p-synthetic-future'
  const withFuturePerson = (b: Branch): Branch => {
    const base = b.snapshots[0]!.persons[0]!
    const snapshots = b.snapshots.map((s) => (s.year >= 1300 ? { ...s, persons: [...s.persons, { ...base, personId: futurePerson }] } : s))
    return { ...b, snapshots } as Branch
  }
  const futureRef = toPairRef(P[0]!, futurePerson)!
  const futureMod = (over: Partial<StatModifier> = {}) => ({ ...mod(1300), targetRef: futureRef, ...over })

  it('t より後に初登場する人物への未来 modifier は破棄され、正当な fork を拒否しない', () => {
    const parent = withFuturePerson({ ...makeRoot(), ledger: [futureMod()] } as Branch)
    const a = ok(forkHistory({ parent, forkYear: 1260, branchId: 'F', modifiers: [mod(1260)], evaluatorsFor: factory(newCounter()) }))
    expect(a.ledger.some((m) => m.startYear === 1300)).toBe(false)
  })
  it('同じ未来人物でも継承される modifier（開始年 ≤ t）は fork 年の世界で検証され拒否される', () => {
    const parent = withFuturePerson({ ...makeRoot(), ledger: [futureMod({ startYear: 1255 })] } as Branch)
    expect(forkHistory({ parent, forkYear: 1260, branchId: 'F', modifiers: [mod(1260)], evaluatorsFor: factory(newCounter()) })).toMatchObject({ ok: false, code: 'INVALID_PARENT_LEDGER' })
  })
  it('破棄対象でも期間・重複・未登録 statKey の不正は維持して拒否する', () => {
    const run = (ledger: StatModifierLedger) =>
      forkHistory({ parent: withFuturePerson({ ...makeRoot(), ledger } as Branch), forkYear: 1260, branchId: 'F', modifiers: [mod(1260)], evaluatorsFor: factory(newCounter()) })
    expect(run([futureMod({ statKey: 'pair.unknown' })])).toMatchObject({ ok: false, code: 'INVALID_PARENT_LEDGER' })
    expect(run([futureMod({ startYear: 1300, endExclusiveYear: 1290 })])).toMatchObject({ ok: false, code: 'INVALID_PARENT_LEDGER' })
    expect(run([futureMod(), futureMod()])).toMatchObject({ ok: false, code: 'INVALID_PARENT_LEDGER' })
    expect(run([futureMod({ targetRef: { kind: 'PERSON_PAIR', ids: ['nobody-a', 'nobody-b'] } })])).toMatchObject({ ok: false, code: 'INVALID_PARENT_LEDGER' })
  })
})

describe('境界・拒否・HALTED', () => {
  const root = makeRoot()
  it('t=1349 は可、t=1350 と範囲外は拒否。1350 に介入を置かない', () => {
    const a = ok(fork(root, 1349, [mod(1349)]))
    expect(a.snapshots).toHaveLength(101)
    expect(a.recompute?.transitions).toBe(1)
    expect(fork(root, 1350, [mod(1349)])).toMatchObject({ ok: false, code: 'FORK_YEAR_AT_GOAL' })
    expect(fork(root, 1249, [mod(1249)])).toMatchObject({ ok: false, code: 'INVALID_FORK_YEAR' })
    expect(fork(root, 1260.5, [mod(1260)])).toMatchObject({ ok: false, code: 'INVALID_FORK_YEAR' })
  })
  it('t=1250（年初境界）から全再計算できる', () => {
    const a = ok(fork(root, 1250, [mod(1250)]))
    expect(a.recompute).toMatchObject({ fromYear: 1250, transitions: 100 })
    expect(a.snapshots[0]).toEqual(root.snapshots[0])
  })
  it('modifier 不備: 空・開始年≠t', () => {
    expect(fork(root, 1260, [])).toMatchObject({ ok: false, code: 'NO_MODIFIERS' })
    expect(fork(root, 1260, [mod(1261)])).toMatchObject({ ok: false, code: 'MODIFIER_START_MISMATCH' })
    expect(fork(root, 1260, [mod(1260)], '')).toMatchObject({ ok: false, code: 'INVALID_BRANCH_ID' })
  })
  it('seed / rngVersion の矛盾は拒否', () => {
    const m = mod(1260)
    expect(forkHistory({ parent: root, forkYear: 1260, branchId: 'A1', modifiers: [m], seed: SEED + 1 })).toMatchObject({ ok: false, code: 'SEED_MISMATCH' })
    expect(forkHistory({ parent: { ...root, rngVersion: 'old' }, forkYear: 1260, branchId: 'A1', modifiers: [m] })).toMatchObject({ ok: false, code: 'RNG_VERSION_MISMATCH' })
  })
  it('評価器の生成関数が例外でも拒否で返す', () => {
    const r = forkHistory({ parent: root, forkYear: 1260, branchId: 'A1', modifiers: [mod(1260)], evaluatorsFor: () => { throw new Error('boom') } })
    expect(r).toMatchObject({ ok: false, code: 'EVALUATOR_FACTORY_FAILED' })
  })
  it('suffix の HALTED は技術的失敗として保持（勝敗にしない）。未計算年は作らず、停止した親からは分岐不可', () => {
    const counter = newCounter()
    const halted = ok(forkHistory({ parent: root, forkYear: 1260, branchId: 'H1', modifiers: [mod(1260)], evaluatorsFor: factory(counter, { throwAtYear: 1300 }) }))
    expect(halted.status).toBe('HALTED')
    expect(halted.halt).toMatchObject({ code: 'EVALUATOR_EXCEPTION', year: 1300 })
    expect(halted.goal).toBeNull()
    expect(halted.snapshots.at(-1)?.year).toBe(1300)
    expect(halted.eventLog.every((e) => e.year < 1300)).toBe(true)
    expect(readYear(halted, 1301)).toMatchObject({ status: 'UNCOMPUTED', reason: 'NOT_COMPUTED_AFTER_HALT' })
    expect(readYear(halted, 1300)).toMatchObject({ status: 'COMPUTED', transition: null })
    expect(diffBranchesAtYear(root, halted, 1320)).toEqual({ status: 'UNCOMPUTED', year: 1320 })
    expect(fork(halted, 1270, [mod(1270)], 'H2')).toMatchObject({ ok: false, code: 'PARENT_HALTED' })
    // 親 root は HALTED で作れない（createRootBranch は形だけ受理: 完走していれば COMPLETED）
    const hroot = createRootBranch(runTimeline(newWorld(), { seed: SEED, branchId: 'X', evaluators: factory(newCounter(), { throwAtYear: 1280 })({ branchId: 'X', parentBranchId: 'n', forkYear: 1250, seed: SEED, ledger: [], knownPersonIds: new Set() }) }))
    expect(hroot.ok && hroot.branch.status).toBe('HALTED')
    expect(hroot.ok && fork(hroot.branch, 1260, [mod(1260)], 'Y')).toMatchObject({ ok: false, code: 'PARENT_HALTED' })
  })
  it('壊れた親（snapshot 不連続）は拒否', () => {
    const broken = { ...root, snapshots: root.snapshots.filter((_, i) => i !== 5) }
    expect(fork(broken, 1260, [mod(1260)])).toMatchObject({ ok: false, code: 'INVALID_PARENT' })
  })
  it('範囲外の readYear は UNCOMPUTED', () => {
    expect(readYear(root, 1249)).toMatchObject({ status: 'UNCOMPUTED', reason: 'OUT_OF_RANGE' })
    expect(readYear(root, 1351)).toMatchObject({ status: 'UNCOMPUTED', reason: 'OUT_OF_RANGE' })
  })
})
