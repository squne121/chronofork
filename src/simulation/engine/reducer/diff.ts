// WorldState の前後差分。確定した実状態差分のみを path/before/after で返す（EventLog ではない）。
import type { JsonValue, WorldState } from '../../contracts/index.ts'
import { canonicalize, cloneData } from './canonical.ts'
import type { StateChange } from './types.ts'

type Collection = readonly [path: string, items: (w: WorldState) => readonly object[], key: (item: never) => string]

/**
 * pairTrust の識別キー（JSON.stringify(personIds)）。要素は不変更新で参照共有されるため、
 * 参照ごとに一度だけ計算して再利用する（毎回の全要素 JSON.stringify を避ける）。
 */
const PAIR_KEY = new WeakMap<object, string>()
export function pairTrustKey(item: { personIds: readonly [string, string] }): string {
  let k = PAIR_KEY.get(item)
  if (k === undefined) {
    k = JSON.stringify(item.personIds)
    PAIR_KEY.set(item, k)
  }
  return k
}

const COLLECTIONS: readonly Collection[] = [
  ['countries', (w) => w.countries, (x: { countryId: string }) => x.countryId],
  ['regions', (w) => w.regions, (x: { regionId: string }) => x.regionId],
  ['groups', (w) => w.groups, (x: { groupId: string }) => x.groupId],
  ['houses', (w) => w.houses, (x: { houseId: string }) => x.houseId],
  ['persons', (w) => w.persons, (x: { personId: string }) => x.personId],
  ['pairTrust', (w) => w.pairTrust ?? [], pairTrustKey],
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

const isPlain = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

function diffValue(path: string, a: unknown, b: unknown, out: StateChange[]): void {
  // 同一参照なら内容も同一（WorldState は不変更新で未変更要素の参照を共有する）。
  if (a === b) return
  if (canonicalize(a) === canonicalize(b)) return
  if (isPlain(a) && isPlain(b)) {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()
    for (const k of keys) diffValue(`${path}.${k}`, a[k], b[k], out)
    return
  }
  out.push({ path, before: cloneData((a ?? null) as JsonValue), after: cloneData((b ?? null) as JsonValue) })
}

const isPair = (x: unknown): x is { personIds: readonly [string, string] } => {
  const ids = (x as { personIds?: unknown } | null)?.personIds
  return Array.isArray(ids) && ids.length === 2 && typeof ids[0] === 'string' && typeof ids[1] === 'string'
}
const samePair = (x: { personIds: readonly [string, string] }, y: { personIds: readonly [string, string] }) =>
  x.personIds[0] === y.personIds[0] && x.personIds[1] === y.personIds[1]

/**
 * pairTrust 専用の高速経路。要素を参照集合で突き合わせ、参照が異なる要素の識別キーだけを求める
 * （従来は全要素の識別キーで 2 つの Map を作っていた）。従来結果と完全に同一であることが示せない場合は null を返し、
 * 呼出側が従来の全キー経路にフォールバックする。
 * - 前提: 両配列の共有要素（両方に参照が存在する要素）が同じ順序・個数で並ぶ。この場合、参照が異なる要素と
 *   同じキーを持たない ID では「最後の要素」が両側で同一になるため、差分候補は参照が異なる要素のキーに限られる。
 * - 候補IDの「最後の要素」は末尾から走査して得る（Map の後勝ちと同じ）。
 */
function pairTrustChangedIds(
  itemsBefore: readonly object[],
  itemsAfter: readonly object[],
): { ids: string[]; a: Map<string, object>; b: Map<string, object> } | null {
  const inBefore = new Set<object>(itemsBefore)
  const inAfter = new Set<object>(itemsAfter)
  const onlyBefore: object[] = []
  const onlyAfter: object[] = []
  let i = 0, j = 0
  for (;;) {
    while (i < itemsBefore.length && !inAfter.has(itemsBefore[i] as object)) onlyBefore.push(itemsBefore[i++] as object)
    while (j < itemsAfter.length && !inBefore.has(itemsAfter[j] as object)) onlyAfter.push(itemsAfter[j++] as object)
    if (i === itemsBefore.length || j === itemsAfter.length) break
    if (itemsBefore[i] !== itemsAfter[j]) return null // 共有要素の順序/個数が異なる
    i++; j++
  }
  if (i !== itemsBefore.length || j !== itemsAfter.length) {
    // 残りは共有要素を含まない（含むなら順序/個数不一致）。
    for (; i < itemsBefore.length; i++) {
      if (inAfter.has(itemsBefore[i] as object)) return null
      onlyBefore.push(itemsBefore[i] as object)
    }
    for (; j < itemsAfter.length; j++) {
      if (inBefore.has(itemsAfter[j] as object)) return null
      onlyAfter.push(itemsAfter[j] as object)
    }
  }
  const a = new Map<string, object>()
  const b = new Map<string, object>()
  if (onlyBefore.length + onlyAfter.length > 32) return null // 大量変更は従来経路が適切
  const lastOf = (items: readonly object[], rep: { personIds: readonly [string, string] }): object | undefined => {
    for (let k = items.length - 1; k >= 0; k--) {
      const x = items[k]
      if (isPair(x) && samePair(x, rep)) return x
    }
    return undefined
  }
  for (const x of [...onlyBefore, ...onlyAfter]) {
    if (!isPair(x)) return null
    const id = pairTrustKey(x)
    if (a.has(id) || b.has(id)) continue
    const ra = lastOf(itemsBefore, x)
    const rb = lastOf(itemsAfter, x)
    if (ra !== undefined) a.set(id, ra)
    if (rb !== undefined) b.set(id, rb)
    if (ra === undefined && rb === undefined) return null
  }
  const ids: string[] = []
  for (const [id, x] of b) if (a.get(id) !== x) ids.push(id)
  for (const id of a.keys()) if (!b.has(id)) ids.push(id)
  return { ids, a, b }
}

export function diffWorld(before: WorldState, after: WorldState): StateChange[] {
  const out: StateChange[] = []
  if (before === after) return out
  diffValue('$.year', before.year, after.year, out)
  for (const [path, items, key] of COLLECTIONS) {
    const itemsBefore = items(before)
    const itemsAfter = items(after)
    // 不変更新: 配列の参照が同一なら内容も同一（全要素の比較を省く）。
    if (itemsBefore === itemsAfter) continue
    if (path === 'pairTrust') {
      const fast = pairTrustChangedIds(itemsBefore, itemsAfter)
      if (fast !== null) {
        for (const id of [...new Set(fast.ids)].sort()) diffValue(`$.${path}[${id}]`, fast.a.get(id), fast.b.get(id), out)
        continue
      }
    }
    const keyOf = key as (item: object) => string
    const a = new Map(itemsBefore.map((x) => [keyOf(x), x]))
    const b = new Map(itemsAfter.map((x) => [keyOf(x), x]))
    // 要素参照が同一のIDは差分を出さないため、参照が異なるIDだけを昇順に処理する（出力順・内容は従来と同一）。
    const changed: string[] = []
    for (const [id, x] of b) if (a.get(id) !== x) changed.push(id)
    for (const id of a.keys()) if (!b.has(id)) changed.push(id)
    for (const id of [...new Set(changed)].sort()) {
      diffValue(`$.${path}[${id}]`, a.get(id), b.get(id), out)
    }
  }
  return out
}
