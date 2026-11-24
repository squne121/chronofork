// Issue #110 工程2C: applyOutcome 1 回の呼出し内でだけ有効な pairTrust 高速経路（厳密昇順の確認済み配列・
// handler の構成記録による差分/差分検証・Transaction 作業 Map）の同値・否定試験。
// 参照: 同じ unit 列を 1 unit ずつ別の applyOutcome 呼出しで適用する。各呼出しの最初の unit は必ず従来経路
// （確認済み配列が無い）で処理されるため、従来の unit ごとの意味（検証・差分・拒否・冪等性）の参照になる。
import { describe, expect, it } from 'vitest'
import type { DomainCommand, PersonPairTrust, RuleOutcome, WorldState } from '../../../../src/simulation/contracts/index.ts'
import { applyOutcome } from '../../../../src/simulation/engine/reducer/index.ts'
import type { ApplyResult, CommandTransaction, UnitResult } from '../../../../src/simulation/engine/reducer/index.ts'
import { newTx, newWorld, outcome, source, YEAR } from './helpers.ts'

const rng = (seed: number) => () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
  return seed / 0x100000000
}
const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T

// 前年（1250年）更新済みの関係を持てるよう、世界の年を 1251 年にする。
const Y = YEAR + 1
const base: WorldState = { ...newWorld(), year: Y }
const tx0 = () => newTx('main', Y)
const src = (tag: string) => source('B-009', 3, tag, Y)
const ids = base.persons.map((p) => p.personId).sort()
const pairs = ids.flatMap((a, i) => ids.slice(i + 1).map((b) => [a, b] as const))
const rel = (a: string, b: string, value: number, y = Y): PersonPairTrust => ({ personIds: [a, b], value, lastUpdatedYear: y })
const key = (x: PersonPairTrust) => JSON.stringify(x.personIds)

/** 前年に更新済みの関係（キー昇順・重複なし）。order=false なら意図的に並びを崩す（全体ソートの従来経路）。 */
function startWorld(r: () => number, sorted: boolean, withField: boolean): WorldState {
  if (!withField) return base
  const list = pairs.filter(() => r() < 0.4).map(([a, b]) => rel(a, b, Math.floor(r() * 60), Y - 1))
  list.sort((x, y) => (key(x) < key(y) ? -1 : 1))
  if (!sorted && list.length > 2) list.reverse()
  return { ...base, pairTrust: list }
}

let serial = 0
/** 正常・不正を混ぜた PERSON_PAIR_TRUST_SET。tag を共有すると commandId / requestId の重複・競合になる。 */
function command(r: () => number, tag?: string): DomainCommand {
  const [a, b] = pick(r, pairs)
  const t = tag ?? `c${serial++}`
  const x = r()
  let relation: PersonPairTrust = rel(a, b, Math.floor(r() * 60))
  if (x < 0.04) relation = rel(b, a, 5) // 非正規化
  else if (x < 0.07) relation = rel(a, 'person-ghost', 5) // 存在しない人物
  else if (x < 0.1) relation = rel(a, b, 1_000_000) // 値域外
  else if (x < 0.12) relation = rel(a, b, 5, Y - 1) // 年不一致
  else if (x < 0.14) relation = rel(a, a, 5) // 同一人物
  return { type: 'PERSON_PAIR_TRUST_SET', commandId: `cmd:${t}`, source: src(t), relation }
}

/**
 * batch を含む unit 列。prior（先行 outcome で確定済み）の command の再送（DUPLICATE）、同 commandId・別内容（CONFLICT）、
 * 同 requestId・別内容（REQUEST_ID_CONFLICT）、同一ペアの当年二重更新、不正値を含む。
 * 1 outcome 内では requestId を unit 間で共有しない（共有すると outcome 全体が拒否され unit 比較にならない）。
 */
function randomOutcome(r: () => number, prior: readonly DomainCommand[]): { o: RuleOutcome; units: DomainCommand[][] } {
  const units: DomainCommand[][] = []
  const usedRequests = new Set<string>()
  const n = 1 + Math.floor(r() * 30)
  for (let i = 0; i < n; i++) {
    const y = r()
    const old = prior.length > 0 ? pick(r, prior) : undefined
    let unit: DomainCommand[]
    if (y < 0.08 && old) unit = [{ ...old }]
    else if (y < 0.12 && old) unit = [{ ...command(r), commandId: old.commandId }]
    else if (y < 0.15 && old) unit = [{ ...command(r), source: old.source }]
    else if (y < 0.21) {
      const batchId = `batch:${serial++}`
      unit = Array.from({ length: 2 + Math.floor(r() * 3) }, () => ({ ...command(r), batchId }))
    } else unit = [command(r)]
    if (unit.some((c) => usedRequests.has(c.source.requestId))) continue
    unit.forEach((c) => usedRequests.add(c.source.requestId))
    units.push(unit)
  }
  return { o: outcome('B-009', 3, units.flat()), units }
}

const txView = (tx: CommandTransaction) => ({
  branchId: tx.branchId, year: tx.year,
  commands: [...tx.commands], batches: [...tx.batches], casualties: [...tx.casualties],
  requests: [...tx.requests].map(([k, m]) => [k, [...m]]),
})
const unitView = (u: UnitResult) => ({ ...u })

/** 1 unit ずつ別呼出しで適用した参照結果。 */
function oneByOne(world: WorldState, units: DomainCommand[][], tx: CommandTransaction) {
  let w = world, t = tx
  const results: UnitResult[] = []
  const applied: ApplyResult['applied'][number][] = []
  for (const cmds of units) {
    const r = applyOutcome(w, outcome('B-009', 3, cmds), { transaction: t })
    expect(r.units).toHaveLength(1)
    results.push(unitView(r.units[0]!))
    applied.push(...r.applied)
    w = r.world
    t = r.transaction
  }
  return { world: w, tx: t, units: results, applied }
}

describe('applyOutcome: 呼出し内の pairTrust 高速経路は unit ごとの従来経路と同一結果', () => {
  it.each([
    ['昇順の既存関係', true, true, 101],
    ['並びの崩れた既存関係（従来の全体ソート）', false, true, 202],
    ['pairTrust 未設定', true, false, 303],
  ] as const)('%s × 600 outcome', (_name, sorted, withField, seed) => {
    const r = rng(seed)
    let appliedUnits = 0, rejectedUnits = 0
    const statuses = new Set<string>()
    for (let i = 0; i < 600; i++) {
      const start = startWorld(r, sorted, withField)
      // 先行 outcome（従来経路の 1 unit ずつ）で一部を確定させ、その Transaction を引き継ぐ。
      const priorCmds = Array.from({ length: Math.floor(r() * 4) }, () => command(r))
      const prior = oneByOne(start, priorCmds.map((c) => [c]), tx0())
      const world = prior.world
      const tx = prior.tx
      const snapshot = JSON.stringify(world)
      const txBefore = txView(tx)
      const { o, units } = randomOutcome(r, priorCmds)
      const fast = applyOutcome(world, o, { transaction: tx })
      const ref = oneByOne(world, units, tx)
      expect(fast.units.map(unitView), `case ${i}`).toEqual(ref.units)
      expect(fast.applied, `case ${i}`).toEqual(ref.applied)
      expect(JSON.stringify(fast.world), `case ${i}`).toBe(JSON.stringify(ref.world))
      expect(txView(fast.transaction), `case ${i}`).toEqual(txView(ref.tx))
      // 入力 world / Transaction は変更しない。何も確定しなければ入力の Transaction をそのまま返す。
      expect(JSON.stringify(world)).toBe(snapshot)
      expect(txView(tx)).toEqual(txBefore)
      if (fast.units.every((u) => u.status !== 'APPLIED')) expect(fast.transaction).toBe(tx)
      appliedUnits += fast.units.filter((u) => u.status === 'APPLIED').length
      rejectedUnits += fast.units.filter((u) => u.status !== 'APPLIED').length
      fast.units.forEach((u) => { statuses.add(u.status); u.rejections.forEach((x) => statuses.add(x.code)) })
    }
    // 正常・拒否・重複・競合の各経路を実際に通過している。
    for (const s of ['APPLIED', 'REJECTED', 'DUPLICATE', 'CONFLICT', 'INVALID_COMMAND', 'NOT_FOUND', 'YEAR_MISMATCH', 'COMMAND_ID_CONFLICT', 'REQUEST_ID_CONFLICT']) {
      expect(statuses, s).toContain(s)
    }
    expect(appliedUnits).toBeGreaterThan(1000)
    expect(rejectedUnits).toBeGreaterThan(300)
  })

  it('先行する Transaction の Map（内側の requests Map を含む）を変更しない', () => {
    const [a, b, c, d] = ids as [string, string, string, string]
    const first = applyOutcome(base, outcome('B-009', 3, [
      { type: 'PERSON_PAIR_TRUST_SET', commandId: 'cmd:1', source: src('shared'), relation: rel(a, b, 5), batchId: 'b1' },
    ]), { transaction: tx0() })
    expect(first.status).toBe('APPLIED')
    const before = txView(first.transaction)
    const second = applyOutcome(first.world, outcome('B-009', 3, [
      { type: 'PERSON_PAIR_TRUST_SET', commandId: 'cmd:2', source: src('other'), relation: rel(c, d, 6) },
      { type: 'PERSON_PAIR_TRUST_SET', commandId: 'cmd:3', source: src('third'), relation: rel(a, c, 7) },
    ]), { transaction: first.transaction })
    expect(second.status).toBe('APPLIED')
    expect(txView(first.transaction)).toEqual(before)
    expect(second.transaction.commands).not.toBe(first.transaction.commands)
    expect(second.transaction.commands.size).toBe(3)
  })

  it('同一ペアの当年二重更新は高速経路でも従来と同じ拒否（後続 unit は適用）', () => {
    const [a, b, c, d] = ids.slice(2) as [string, string, string, string]
    const cmds: DomainCommand[] = [
      { type: 'PERSON_PAIR_TRUST_SET', commandId: 'cmd:x1', source: src('x1'), relation: rel(a, b, 5) },
      { type: 'PERSON_PAIR_TRUST_SET', commandId: 'cmd:x2', source: src('x2'), relation: rel(c, d, 5) },
      { type: 'PERSON_PAIR_TRUST_SET', commandId: 'cmd:x3', source: src('x3'), relation: rel(a, b, 9) },
      { type: 'PERSON_PAIR_TRUST_SET', commandId: 'cmd:x4', source: src('x4'), relation: rel(a, d, 9) },
    ]
    const r = applyOutcome(base, outcome('B-009', 3, cmds), { transaction: tx0() })
    expect(r.status).toBe('PARTIAL')
    expect(r.units.map((u) => u.status)).toEqual(['APPLIED', 'APPLIED', 'REJECTED', 'APPLIED'])
    expect(r.units[2]!.rejections[0]).toMatchObject({ code: 'INVALID_COMMAND', commandId: 'cmd:x3' })
    expect(r.world.pairTrust?.map(key)).toEqual([rel(a, b, 0), rel(a, d, 0), rel(c, d, 0)].map(key).sort())
  })
})

describe('呼出しをまたぐキー記憶の陳腐化（独立レビュー指摘）', () => {
  it('前の呼出し後に入力要素の personIds が書き換えられても、高速経路を使わず従来と同じ結果（重複を作らない）', () => {
    const [a, b, c, d, x, y] = ids as [string, string, string, string, string, string]
    const e: { personIds: [string, string]; value: number; lastUpdatedYear: number } = { personIds: [a, b], value: 1, lastUpdatedYear: Y - 1 }
    const w: WorldState = { ...base, pairTrust: [e] }
    const set = (p: string, q: string, tag: string): DomainCommand =>
      ({ type: 'PERSON_PAIR_TRUST_SET', commandId: 'cmd:' + tag, source: src(tag), relation: rel(p, q, 3) })
    expect(applyOutcome(w, outcome('B-009', 3, [set(a, c, 't0')]), { transaction: tx0() }).status).toBe('APPLIED')
    e.personIds = [c, d] // 呼出側による入力の書き換え（キー記憶は [a,b] のまま）
    const units = [[set(x, y, 't1')], [set(c, d, 't2')]]
    const fast = applyOutcome(w, outcome('B-009', 3, units.flat()), { transaction: tx0() })
    const ref = oneByOne(w, units, tx0())
    expect(fast.units.map(unitView)).toEqual(ref.units)
    expect(JSON.stringify(fast.world)).toBe(JSON.stringify(ref.world))
    expect(fast.world.pairTrust!.filter((r) => r.personIds[0] === c && r.personIds[1] === d)).toHaveLength(1)
  })

  it('personIds が独自の toJSON を持つ非 plain 入力でも高速経路を使わず従来と同じ結果（独立再レビュー指摘）', () => {
    const [p1, p2, p3, , , , , p8] = ids as string[]
    const e = { personIds: Object.assign([p2!, p3!], { toJSON: () => [p2, p8] }) as unknown as [string, string], value: 1, lastUpdatedYear: Y - 1 }
    const w: WorldState = { ...base, pairTrust: [e] }
    const set = (p: string, q: string, tag: string): DomainCommand =>
      ({ type: 'PERSON_PAIR_TRUST_SET', commandId: 'cmd:' + tag, source: src(tag), relation: rel(p, q, 3) })
    const units = [[set(p1!, p2!, 'j1')], [set(p2!, p3!, 'j2')]]
    const fast = applyOutcome(w, outcome('B-009', 3, units.flat()), { transaction: tx0() })
    const ref = oneByOne(w, units, tx0())
    expect(fast.units.map(unitView)).toEqual(ref.units)
    expect(fast.world.pairTrust!.map((r) => [r.personIds[0], r.personIds[1]])).toEqual(ref.world.pairTrust!.map((r) => [r.personIds[0], r.personIds[1]]))
    expect(fast.world.pairTrust!.filter((r) => r.personIds[0] === p2 && r.personIds[1] === p3)).toHaveLength(1)
  })
})
