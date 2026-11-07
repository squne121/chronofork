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

export function diffWorld(before: WorldState, after: WorldState): StateChange[] {
  const out: StateChange[] = []
  if (before === after) return out
  diffValue('$.year', before.year, after.year, out)
  for (const [path, items, key] of COLLECTIONS) {
    const itemsBefore = items(before)
    const itemsAfter = items(after)
    // 不変更新: 配列の参照が同一なら内容も同一（全要素の比較を省く）。
    if (itemsBefore === itemsAfter) continue
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
