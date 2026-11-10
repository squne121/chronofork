// P2-①: 再計算ホットパス最適化（pairTrust の差分・重複確認・整合検査）の乱数差分同値試験。
// 最適化前の実装を参照実装として持ち、多数のランダムな pairTrust 配列（重複・並べ替え・削除・不正値を含む）で出力の同一を確認する。
import { describe, expect, it } from 'vitest'
import type { PersonPairTrust, WorldState } from '../../../../src/simulation/contracts/index.ts'
import { canonicalize, cloneData } from '../../../../src/simulation/engine/reducer/canonical.ts'
import { diffWorld } from '../../../../src/simulation/engine/reducer/index.ts'
import { confirmPairTrustOnlyChangeValid, validateWorldState } from '../../../../src/simulation/validation/index.ts'
import { checkWorldIntegrity } from '../../../../src/simulation/validation/integrity.ts'
import { PAIR_TRUST_DEFINITION } from '../../../../src/simulation/intervention/stat-registry.ts'
import { GOAL_YEAR, START_YEAR } from '../../../../src/simulation/contracts/index.ts'
import { newWorld, YEAR } from './helpers.ts'

// 決定的な疑似乱数（再現可能）。
const rng = (seed: number) => () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
  return seed / 0x100000000
}
const pick = <T>(r: () => number, xs: readonly T[]): T => xs[Math.floor(r() * xs.length)] as T
const key = (x: PersonPairTrust) => JSON.stringify(x.personIds)

/** 最適化前の pairTrust 差分（全要素のキーで 2 つの Map を作る）。 */
function referencePairTrustDiff(before: WorldState, after: WorldState) {
  const out: { path: string; before: unknown; after: unknown }[] = []
  const isPlain = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
  const dv = (path: string, a: unknown, b: unknown): void => {
    if (a === b || canonicalize(a) === canonicalize(b)) return
    if (isPlain(a) && isPlain(b)) {
      for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) dv(`${path}.${k}`, a[k], b[k])
      return
    }
    out.push({ path, before: cloneData((a ?? null) as never), after: cloneData((b ?? null) as never) })
  }
  const a = new Map((before.pairTrust ?? []).map((x) => [key(x), x]))
  const b = new Map((after.pairTrust ?? []).map((x) => [key(x), x]))
  const changed: string[] = []
  for (const [id, x] of b) if (a.get(id) !== x) changed.push(id)
  for (const id of a.keys()) if (!b.has(id)) changed.push(id)
  for (const id of [...new Set(changed)].sort()) dv(`$.pairTrust[${id}]`, a.get(id), b.get(id))
  return out
}

const world = newWorld()
const personIds = world.persons.map((p) => p.personId).sort()
const allPairs = personIds.flatMap((a, i) => personIds.slice(i + 1).map((b) => [a, b] as const))
const rel = (a: string, b: string, value = 5, y = YEAR): PersonPairTrust => ({ personIds: [a, b], value, lastUpdatedYear: y })
const withTrust = (w: WorldState, list: PersonPairTrust[]): WorldState => ({ ...w, pairTrust: list })

/** 参照を共有しながら、削除・置換・追加・（意図的な）重複・並べ替えを混ぜた after を作る。 */
function mutateList(r: () => number, list: readonly PersonPairTrust[], allowDup: boolean): PersonPairTrust[] {
  let next = [...list]
  const ops = 1 + Math.floor(r() * 4)
  for (let n = 0; n < ops; n++) {
    const op = r()
    const [a, b] = pick(r, allPairs)
    if (op < 0.25 && next.length > 0) next.splice(Math.floor(r() * next.length), 1)
    else if (op < 0.5 && next.length > 0) {
      const i = Math.floor(r() * next.length)
      next[i] = { ...next[i]!, value: Math.floor(r() * 50), lastUpdatedYear: YEAR }
    } else if (op < 0.75) next.splice(Math.floor(r() * (next.length + 1)), 0, rel(a, b, Math.floor(r() * 50)))
    else if (op < 0.85 && allowDup && next.length > 0) next.push(pick(r, next)) // 同一参照の重複
    else if (op < 0.92 && allowDup && next.length > 0) next.push({ ...pick(r, next) }) // 同一キー・別参照の重複
    else if (op < 0.96 && next.length > 2) { const [x] = next.splice(Math.floor(r() * next.length), 1); next.splice(Math.floor(r() * (next.length + 1)), 0, x!) } // 1 件だけ移動
    else if (next.length > 1) next = [...next].reverse() // 並べ替え
  }
  return next
}
const randomList = (r: () => number, n: number): PersonPairTrust[] =>
  allPairs.filter(() => r() < n / allPairs.length).map(([a, b]) => rel(a, b, Math.floor(r() * 50)))

describe('diffWorld pairTrust 高速経路: 参照実装と乱数で同一出力', () => {
  it.each([false, true])('重複許容=%s の 3000 件', (allowDup) => {
    const r = rng(allowDup ? 7 : 3)
    for (let i = 0; i < 3000; i++) {
      const base = randomList(r, 1 + Math.floor(r() * 12))
      const before = withTrust(world, base)
      const after = withTrust(world, mutateList(r, base, allowDup))
      expect(diffWorld(before, after), `case ${i}`).toEqual(referencePairTrustDiff(before, after))
    }
  })

  it('変更が多い（フォールバック経路）場合も同一', () => {
    const r = rng(11)
    for (let i = 0; i < 200; i++) {
      const base = randomList(r, 20)
      const after = base.map((x) => (r() < 0.8 ? { ...x, value: x.value + 1 } : x))
      expect(diffWorld(withTrust(world, base), withTrust(world, after))).toEqual(referencePairTrustDiff(withTrust(world, base), withTrust(world, after)))
    }
  })

  it('pairTrust 未設定→設定、設定→未設定でも同一', () => {
    const some = withTrust(world, [rel(personIds[0]!, personIds[1]!)])
    expect(diffWorld(world, some)).toEqual(referencePairTrustDiff(world, some))
    expect(diffWorld(some, world)).toEqual(referencePairTrustDiff(some, world))
  })
})

/** 最適化前の confirmPairTrustOnlyChangeValid の重複確認（全記録のキー数）。他の確認は実装を共有する。 */
const oldConfirm = (before: WorldState, after: WorldState): boolean => {
  const list = after.pairTrust ?? []
  const dupFree = new Set(list.map(key)).size === list.length
  // 重複以外の条件は新実装と同じコードパスなので、重複なしの場合のみ新実装の結論に委ねる比較にならないよう、
  // 重複ありなら false を期待、重複なしなら全体検証の ok に一致することを期待する。
  if (!dupFree) return false
  return validateWorldState(after).ok && before !== after
}

describe('confirmPairTrustOnlyChangeValid: 乱数で全体検証と矛盾しない（肯定は全体検証 ok、重複は否定）', () => {
  const before0 = { ...world, year: YEAR + 1 } as WorldState
  it('3000 件', () => {
    const r = rng(21)
    let confirmed = 0, rejected = 0
    for (let i = 0; i < 3000; i++) {
      const base = randomList(r, 1 + Math.floor(r() * 10)).map((x) => ({ ...x, lastUpdatedYear: YEAR }))
      const before = withTrust(before0, base)
      expect(validateWorldState(before).ok).toBe(true)
      const list = mutateList(r, base, true).map((x) => (r() < 0.05 ? { ...x, value: 1_000_000 } : x))
      const after = withTrust(before0, list)
      const quick = confirmPairTrustOnlyChangeValid(before, after)
      const full = validateWorldState(after).ok
      expect(quick, `case ${i} 旧実装と不一致`).toBe(oldConfirm(before, after))
      if (quick) { confirmed++; expect(full, `case ${i} 肯定なのに全体検証NG`).toBe(true) }
      else rejected++
      // 重複・不正な after は必ず否定される（取りこぼしなし）。
      if (!full) expect(quick, `case ${i}`).toBe(false)
    }
    expect(confirmed).toBeGreaterThan(100)
    expect(rejected).toBeGreaterThan(100)
  })

  it('同一参照が配列に 2 回現れる after は重複として否定する', () => {
    const k = rel(personIds[0]!, personIds[1]!, 5, YEAR)
    const before = withTrust(before0, [])
    const added = rel(personIds[0]!, personIds[2]!, 5, YEAR)
    expect(confirmPairTrustOnlyChangeValid(before, withTrust(before0, [k, added, added]))).toBe(false)
  })

  it('変更が多い（9 件以上）場合も重複を検出する', () => {
    const many = allPairs.slice(0, 12).map(([a, b]) => rel(a, b, 5, YEAR))
    const before = withTrust(before0, [])
    expect(confirmPairTrustOnlyChangeValid(before, withTrust(before0, many))).toBe(true)
    expect(confirmPairTrustOnlyChangeValid(before, withTrust(before0, [...many, { ...many[3]! }]))).toBe(false)
  })
})

/** 最適化前の checkPairTrustRecords（診断の内容・順序の参照実装）。 */
function referencePairTrustDiagnostics(pairTrust: readonly PersonPairTrust[], worldYear: number, known: ReadonlySet<string>) {
  const out: unknown[] = []
  const relationKeys = new Set<string>()
  pairTrust.forEach((r, i) => {
    const path = `$.pairTrust[${i}]`
    const owner = { kind: 'PERSON_PAIR', id: JSON.stringify(r.personIds) }
    const add = (code: string, p: string, message: string) => out.push({ code, path: p, message, owner })
    const [a, b] = r.personIds
    if (a === b) add('SELF_REFERENCE', path, '信頼関係の人物IDが同一です')
    else if (a > b) add('PERSON_PAIR_NOT_NORMALIZED', path, '人物IDは昇順に正規化します')
    for (const [id, p] of [[a, path + '.personIds[0]'], [b, path + '.personIds[1]']] as const) {
      if (!known.has(id)) out.push({ code: 'DANGLING_REF', path: p, owner, id })
    }
    const k = JSON.stringify(r.personIds)
    if (relationKeys.has(k)) add('DUPLICATE_ID', path, '人物ペアの信頼記録が重複しています')
    relationKeys.add(k)
    if (!Number.isSafeInteger(r.value) || r.value < PAIR_TRUST_DEFINITION.min || r.value > PAIR_TRUST_DEFINITION.max) {
      add('OUT_OF_RANGE', path + '.value', 'pair.trust基礎値が校正値域外です')
    }
    if (!Number.isSafeInteger(r.lastUpdatedYear) || r.lastUpdatedYear < START_YEAR || r.lastUpdatedYear > worldYear) {
      add('OUT_OF_RANGE', path + '.lastUpdatedYear', '信頼関係の更新年が世界の年次と整合しません')
    }
  })
  return out
}

describe('checkWorldIntegrity pairTrust 診断: 参照実装と乱数で内容・順序が同一', () => {
  it('不正値を含む 3000 件', () => {
    const r = rng(33)
    const ids = [...personIds, 'person-ghost-1', 'person-ghost-2']
    const known = new Set(personIds)
    for (let i = 0; i < 3000; i++) {
      const n = Math.floor(r() * 8)
      const list: PersonPairTrust[] = Array.from({ length: n }, () => ({
        personIds: [pick(r, ids), pick(r, ids)] as [string, string],
        value: pick(r, [0, 5, 50, -1, 1.5, 1_000_000, 100]),
        lastUpdatedYear: pick(r, [YEAR, YEAR - 1, 1, GOAL_YEAR + 5, 1260.5]),
      }))
      const w = withTrust(world, list)
      const actual = checkWorldIntegrity(w)
        .filter((d) => d.path.startsWith('$.pairTrust'))
        .map((d) => ({ code: d.code, path: d.path, owner: d.target }))
      const expected = referencePairTrustDiagnostics(list, w.year, known).map((e) => {
        const x = e as { code: string; path: string; owner: unknown }
        return { code: x.code, path: x.path, owner: x.owner }
      })
      expect(actual, `case ${i}`).toEqual(expected)
    }
  })
})

describe('checkWorldIntegrity: pairTrust が人物以外の ID を指す場合は WRONG_REF_KIND（従来どおり）', () => {
  it('HOUSE ID', () => {
    const house = world.houses[0]!.houseId
    const w = withTrust(world, [rel(personIds[0]!, house)].sort())
    const d = checkWorldIntegrity(w).filter((x) => x.path.startsWith('$.pairTrust'))
    expect(d.map((x) => x.code)).toContain('WRONG_REF_KIND')
    expect(d.every((x) => x.target?.kind === 'PERSON_PAIR')).toBe(true)
  })
})
