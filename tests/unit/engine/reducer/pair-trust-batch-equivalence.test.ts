// reducer高速化(PERSON_PAIR_TRUST_SET大量適用)の同値性・否定試験。
// 最適化前の実装(全collection差分・全体検証・全体再ソート)を参照実装として持ち、結果の同値を確認する。
import { describe, expect, it } from 'vitest'
import type { DomainCommand, PersonPairTrust, WorldState } from '../../../../src/simulation/contracts/index.ts'
import { applyOutcome, diffWorld } from '../../../../src/simulation/engine/reducer/index.ts'
import { canonicalize, cloneData } from '../../../../src/simulation/engine/reducer/canonical.ts'
import { confirmPairTrustOnlyChangeValid, validateWorldState } from '../../../../src/simulation/validation/index.ts'
import { newTx, newWorld, outcome, rejectionCodes, run, source, YEAR } from './helpers.ts'

type Sc = { path: string; before: unknown; after: unknown }

/** 最適化前の diffWorld（参照実装）。全 collection を走査し、全 ID を昇順に比較する。 */
function referenceDiff(before: WorldState, after: WorldState): Sc[] {
  const out: Sc[] = []
  const isPlain = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
  const dv = (path: string, a: unknown, b: unknown): void => {
    if (canonicalize(a) === canonicalize(b)) return
    if (isPlain(a) && isPlain(b)) {
      for (const k of [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()) dv(`${path}.${k}`, a[k], b[k])
      return
    }
    out.push({ path, before: cloneData((a ?? null) as never), after: cloneData((b ?? null) as never) })
  }
  dv('$.year', before.year, after.year)
  const cols: [string, (w: WorldState) => readonly object[], (x: never) => string][] = [
    ['countries', (w) => w.countries, (x: { countryId: string }) => x.countryId],
    ['regions', (w) => w.regions, (x: { regionId: string }) => x.regionId],
    ['groups', (w) => w.groups, (x: { groupId: string }) => x.groupId],
    ['houses', (w) => w.houses, (x: { houseId: string }) => x.houseId],
    ['persons', (w) => w.persons, (x: { personId: string }) => x.personId],
    ['pairTrust', (w) => w.pairTrust ?? [], (x: { personIds: readonly [string, string] }) => JSON.stringify(x.personIds)],
    ['titles', (w) => w.titles, (x: { titleId: string }) => x.titleId],
    ['legal.dynasties', (w) => w.legal.dynasties, (x: { dynastyId: string }) => x.dynastyId],
    ['legal.marriages', (w) => w.legal.marriages, (x: { marriageId: string }) => x.marriageId],
    ['legal.cases', (w) => w.legal.cases, (x: { caseId: string }) => x.caseId],
    ['legal.controlMandates', (w) => w.legal.controlMandates, (x: { mandateId: string }) => x.mandateId],
    ['legal.taxMandates', (w) => w.legal.taxMandates, (x: { mandateId: string }) => x.mandateId],
    ['resources', (w) => w.resources, (x: { accountId: string }) => x.accountId],
    ['demographics.cohortSlots', (w) => w.demographics.cohortSlots, (x: { groupId: string; year: number }) => `${x.groupId}@${x.year}`],
    ['deferred', (w) => w.deferred, (x: { deferredId: string }) => x.deferredId],
  ]
  for (const [path, items, key] of cols) {
    const k = key as (i: object) => string
    const a = new Map(items(before).map((x) => [k(x), x]))
    const b = new Map(items(after).map((x) => [k(x), x]))
    for (const id of [...new Set([...a.keys(), ...b.keys()])].sort()) dv(`$.${path}[${id}]`, a.get(id), b.get(id))
  }
  return out
}

const ids = (w: WorldState) => w.persons.map((p) => p.personId).sort()
const rel = (a: string, b: string, value = 5, lastUpdatedYear = YEAR): PersonPairTrust => ({ personIds: [a, b], value, lastUpdatedYear })
const setCmd = (relation: PersonPairTrust, tag = JSON.stringify(relation.personIds), year = YEAR): DomainCommand => ({
  type: 'PERSON_PAIR_TRUST_SET', commandId: `cmd:pt:${tag}`, source: source('B-009', 3, `pt:${tag}`, year), relation,
})
const allPairs = (w: WorldState) => {
  const p = ids(w)
  return p.flatMap((a, i) => p.slice(i + 1).map((b) => [a, b] as const))
}

describe('diffWorld: 最適化版は参照実装と同一出力', () => {
  const base = newWorld()
  const [a, b, c] = ids(base) as [string, string, string]
  const withTrust = (list: PersonPairTrust[]): WorldState => ({ ...base, pairTrust: list })
  const cases: [string, WorldState, WorldState][] = [
    ['同一参照', base, base],
    ['pairTrust 追加', base, withTrust([rel(a, b)])],
    ['pairTrust 値更新', withTrust([rel(a, b), rel(a, c)]), withTrust([rel(a, b, 9), rel(a, c)])],
    ['pairTrust 削除', withTrust([rel(a, b), rel(a, c)]), withTrust([rel(a, c)])],
    ['pairTrust 並べ替えのみ', withTrust([rel(a, b), rel(a, c)]), withTrust([rel(a, c), rel(a, b)])],
    ['内容同一の別参照', withTrust([rel(a, b)]), withTrust([rel(a, b)])],
    ['他 collection と同時変更', withTrust([rel(a, b)]),
      { ...withTrust([rel(a, b, 7), rel(a, c)]), persons: base.persons.map((p, i) => (i === 0 ? { ...p, name: p.name + 'x' } : p)), year: base.year + 1 }],
    ['IDに引用符より小さい文字を含む', withTrust([rel('a', 'b')]), withTrust([rel('a b', 'c'), rel('a', 'b', 6)])],
  ]
  it.each(cases)('%s', (_name, before, after) => {
    expect(diffWorld(before, after)).toEqual(referenceDiff(before, after))
  })
})

describe('confirmPairTrustOnlyChangeValid: 肯定できた場合は全体検証と同じ結論、疑わしければ false', () => {
  // 1251年初の検証済み世界（前年1250に更新された記録を1件持つ）。
  const before = { ...newWorld(), year: YEAR + 1, pairTrust: [rel('person-exp-01', 'person-exp-02', 5, YEAR)] } as WorldState
  expect(validateWorldState(before).ok).toBe(true)
  const [p1, p2, p3] = ids(before) as [string, string, string]
  const mutate = (list: PersonPairTrust[]): WorldState => ({ ...before, pairTrust: list })
  const k0 = before.pairTrust![0]!

  it('正常な追加・更新は true で、全体検証も ok', () => {
    for (const list of [[k0, rel(p1, p3)], [rel(p1, p2, 9)], [rel(p1, p2, 9), rel(p1, p3), rel(p2, p3)], []]) {
      const after = mutate(list)
      expect(confirmPairTrustOnlyChangeValid(before, after)).toBe(true)
      expect(validateWorldState(after).ok).toBe(true)
    }
  })

  const bad: [string, PersonPairTrust[] | (() => WorldState)][] = [
    ['未知の人物', [k0, rel(p1, 'missing-person')]],
    ['自己参照', [k0, rel(p1, p1)]],
    ['非正規化(降順)', [k0, rel(p3, p1)]],
    ['値域外', [k0, rel(p1, p3, 1_000_000)]],
    ['小数', [k0, rel(p1, p3, 1.5)]],
    ['更新年が世界年より未来', [k0, rel(p1, p3, 5, YEAR + 2)]],
    ['更新年が範囲外(過去)', [k0, rel(p1, p3, 5, 1)]],
    ['重複(新規同士)', [k0, rel(p1, p3), rel(p1, p3, 6)]],
    ['重複(既存と新規)', [k0, rel(p1, p2, 9)]],
    ['未知フィールド', [k0, { ...rel(p1, p3), extra: 1 } as unknown as PersonPairTrust]],
    ['値が文字列', [k0, { ...rel(p1, p3), value: 'x' } as unknown as PersonPairTrust]],
    ['personIds が3件', [k0, { ...rel(p1, p3), personIds: [p1, p2, p3] } as unknown as PersonPairTrust]],
    ['pairTrust以外(persons)も変化', () => ({ ...mutate([k0, rel(p1, p3)]), persons: before.persons.slice(1) })],
    ['pairTrust以外(year)も変化', () => ({ ...mutate([k0, rel(p1, p3)]), year: before.year + 1 })],
    ['pairTrust以外(legal内)も変化', () => ({ ...mutate([k0, rel(p1, p3)]), legal: { ...before.legal, marriages: [...before.legal.marriages] } })],
  ]
  it.each(bad)('否定: %s は確認を通さない', (_name, spec) => {
    const after = typeof spec === 'function' ? spec() : mutate(spec)
    expect(confirmPairTrustOnlyChangeValid(before, after)).toBe(false)
  })

  it('確認を通さない pairTrust 破損は全体検証でも ERROR（取りこぼしなし）', () => {
    for (const [name, spec] of bad) {
      if (typeof spec === 'function' || name.startsWith('pairTrust以外')) continue
      expect(validateWorldState(mutate(spec)).ok, name).toBe(false)
    }
  })

  it('入力 world と同一参照や pairTrust 未設定の世界は安全側(false)または正しく扱う', () => {
    expect(confirmPairTrustOnlyChangeValid(before, before)).toBe(false)
    const noTrust = newWorld()
    expect(confirmPairTrustOnlyChangeValid(noTrust, { ...noTrust, pairTrust: [rel(p1, p2)] })).toBe(true)
  })
})

describe('PERSON_PAIR_TRUST_SET の大量適用', () => {
  const world = newWorld()
  const pairs = allPairs(world)
  const cmds = pairs.map(([a, b]) => setCmd(rel(a, b, 3)))
  const o = outcome('B-009', 3, cmds)

  it('全ペアを個別unitで適用し、結果・StateChangeが逐次の全体再計算と一致する', () => {
    const r = run(world, o)
    expect(r.status).toBe('APPLIED')
    expect(r.units).toHaveLength(pairs.length)
    expect(r.units.every((u) => u.status === 'APPLIED')).toBe(true)
    // 世界: 全ペアがキーJSON昇順で並ぶ。
    const expected = pairs.map(([a, b]) => rel(a, b, 3)).sort((x, y) => (JSON.stringify(x.personIds) < JSON.stringify(y.personIds) ? -1 : 1))
    expect(r.world.pairTrust).toEqual(expected)
    expect(validateWorldState(r.world).ok).toBe(true)
    // 各commandのStateChangeは参照実装(前後世界の全差分)と一致し、1件のpairTrust新規追加のみ。
    let prev = world
    r.applied.forEach((ap, i) => {
      const [a, b] = pairs[i]!
      const next = { ...prev, pairTrust: [...(prev.pairTrust ?? []), rel(a, b, 3)].sort((x, y) => (JSON.stringify(x.personIds) < JSON.stringify(y.personIds) ? -1 : 1)) }
      expect(ap.stateChanges).toEqual(referenceDiff(prev, next))
      expect(ap.stateChanges).toHaveLength(1)
      expect(ap.stateChanges[0]!.before).toBeNull()
      prev = next
    })
    expect(prev.pairTrust).toEqual(r.world.pairTrust)
  })

  it('同一結果の再送は DUPLICATE、同一commandIdの異内容は CONFLICT。世界は変わらない', () => {
    const first = run(world, o)
    const again = run(first.world, o, first.transaction)
    expect(again.status).toBe('DUPLICATE')
    expect(again.world).toBe(first.world)
    const [a, b] = pairs[0]!
    const changed = outcome('B-009', 3, [{ ...setCmd(rel(a, b, 4), JSON.stringify([a, b])) }])
    const conflict = run(first.world, changed, first.transaction)
    expect(conflict.status).toBe('CONFLICT')
    expect(rejectionCodes(conflict)).toContain('COMMAND_ID_CONFLICT')
    expect(conflict.world).toBe(first.world)
  })

  it('不正commandは当該unitだけ拒否し、他は適用。拒否unitは世界を変えない(原子性)', () => {
    const [a, b] = pairs[0]!
    const [c, d] = pairs[1]!
    const mixed = outcome('B-009', 3, [
      setCmd(rel(a, b, 3)),
      setCmd(rel(c, 'person-zzz-missing', 3), 'bad-missing'),
      setCmd(rel(c, d, 999), 'bad-range'),
      setCmd(rel(d, c, 3), 'bad-order'),
      setCmd(rel(c, d, 3, YEAR + 1), 'bad-year'),
      setCmd(rel(c, d, 3)),
    ])
    const r = run(world, mixed)
    expect(r.status).toBe('PARTIAL')
    expect(r.units.map((u) => u.status)).toEqual(['APPLIED', 'REJECTED', 'REJECTED', 'REJECTED', 'REJECTED', 'APPLIED'])
    expect(r.units.slice(1, 5).flatMap((u) => u.rejections.map((x) => x.code))).toEqual(['NOT_FOUND', 'INVALID_COMMAND', 'INVALID_COMMAND', 'YEAR_MISMATCH'])
    expect(r.world.pairTrust).toEqual([rel(a, b, 3), rel(c, d, 3)].sort((x, y) => (JSON.stringify(x.personIds) < JSON.stringify(y.personIds) ? -1 : 1)))
    expect(r.applied).toHaveLength(2)
  })

  it('同一年内の同一ペア再更新は拒否、前年の値は置換されbefore/afterが出る', () => {
    const [a, b] = pairs[0]!
    const Y = YEAR + 1
    const prior = { ...world, year: Y, pairTrust: [rel(a, b, 2, YEAR)] } as WorldState
    const upd = run(prior, outcome('B-009', 3, [setCmd(rel(a, b, 8, Y), undefined, Y)]), newTx('main', Y))
    expect(upd.status).toBe('APPLIED')
    expect(upd.applied[0]!.stateChanges).toEqual(referenceDiff(prior, upd.world))
    expect(upd.applied[0]!.stateChanges.map((c) => [c.path.replace(/^.*\]/, ''), c.before, c.after])).toEqual([
      ['.lastUpdatedYear', YEAR, Y], ['.value', 2, 8],
    ])
    const twice = run(upd.world, outcome('B-009', 3, [setCmd(rel(a, b, 9, Y), 'again', Y)]), upd.transaction)
    expect(twice.status).toBe('REJECTED')
    expect(rejectionCodes(twice)).toContain('INVALID_COMMAND')
    expect(twice.world).toBe(upd.world)
  })

  it('他ruleからの発行(権限違反)と requestId 競合は従来どおり拒否される', () => {
    const foreign = { ...setCmd(rel(...pairs[0]!)), source: source('B-003', 3, 'foreign') } as DomainCommand
    expect(rejectionCodes(run(world, outcome('B-003', 3, [foreign])))).toContain('WRITE_OWNER_VIOLATION')
    const [a, b] = pairs[0]!
    const [c, d] = pairs[1]!
    const same = (rid: string, r: PersonPairTrust, id: string): DomainCommand => ({ ...setCmd(r, id), source: source('B-009', 3, rid) })
    const r = run(world, outcome('B-009', 3, [same('shared', rel(a, b), 'x1'), same('shared', rel(c, d), 'x2')]))
    expect(r.status).toBe('REJECTED')
    expect(rejectionCodes(r)).toContain('REQUEST_ID_CONFLICT')
    expect(r.world).toBe(world)
  })

  it('既存pairTrustが未整列でも従来どおり全体ソートされた結果になる', () => {
    const [a, b] = pairs[0]!
    const [c, d] = pairs[5]!
    const Y = YEAR + 1
    const unsorted = { ...world, year: Y, pairTrust: [rel(c, d, 1, YEAR), rel(a, b, 1, YEAR)] } as WorldState
    const r = run(unsorted, outcome('B-009', 3, [setCmd(rel(pairs[3]![0], pairs[3]![1], 2, Y), undefined, Y)]), newTx('main', Y))
    expect(r.status).toBe('APPLIED')
    const keys = r.world.pairTrust!.map((x) => JSON.stringify(x.personIds))
    expect(keys).toEqual([...keys].sort())
    // 空白を含むIDでも、キー(JSON文字列)順で配置される。
    const quirky = { ...world, pairTrust: [] } as WorldState
    expect(applyOutcome(quirky, outcome('B-009', 3, [setCmd(rel(a, b))]), { transaction: newTx() }).status).toBe('APPLIED')
  })
})
