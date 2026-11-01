// WorldState の前後差分。確定した実状態差分のみを path/before/after で返す（EventLog ではない）。
import type { JsonValue, WorldState } from '../../contracts/index.ts'
import { canonicalize } from './canonical.ts'
import type { StateChange } from './types.ts'

type Collection = readonly [path: string, items: (w: WorldState) => readonly object[], key: (item: never) => string]

const COLLECTIONS: readonly Collection[] = [
  ['countries', (w) => w.countries, (x: { countryId: string }) => x.countryId],
  ['regions', (w) => w.regions, (x: { regionId: string }) => x.regionId],
  ['groups', (w) => w.groups, (x: { groupId: string }) => x.groupId],
  ['houses', (w) => w.houses, (x: { houseId: string }) => x.houseId],
  ['persons', (w) => w.persons, (x: { personId: string }) => x.personId],
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
  if (canonicalize(a) === canonicalize(b)) return
  if (isPlain(a) && isPlain(b)) {
    const keys = [...new Set([...Object.keys(a), ...Object.keys(b)])].sort()
    for (const k of keys) diffValue(`${path}.${k}`, a[k], b[k], out)
    return
  }
  out.push({ path, before: (a ?? null) as JsonValue, after: (b ?? null) as JsonValue })
}

export function diffWorld(before: WorldState, after: WorldState): StateChange[] {
  const out: StateChange[] = []
  if (before === after) return out
  diffValue('$.year', before.year, after.year, out)
  for (const [path, items, key] of COLLECTIONS) {
    const keyOf = key as (item: object) => string
    const a = new Map(items(before).map((x) => [keyOf(x), x]))
    const b = new Map(items(after).map((x) => [keyOf(x), x]))
    for (const id of [...new Set([...a.keys(), ...b.keys()])].sort()) {
      diffValue(`$.${path}[${id}]`, a.get(id), b.get(id), out)
    }
  }
  return out
}
