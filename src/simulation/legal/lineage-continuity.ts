// DEC-197: 記録上の直系継続基盤。法的な後継資格・家門断絶の判定ではない。
import type { Id, Person, WorldState } from '../contracts/index.ts'
import { MVP_MARRIAGE_MIN_AGE } from './nextgen-marriage.ts'

export type LineageContinuityCalibration = Readonly<{
  status: 'CALIBRATION_ONLY'
  version: string
  marriageBonus: number
  affiliationBonus: number
}>

const cmp = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0

export function lineageContinuity(world: WorldState, subject: Person) {
  const titleIds = world.titles.filter(t => t.valid && t.hereditary && t.recognition.status === 'ACTIVE' &&
    t.holder.status === 'HELD' && t.holder.personId === subject.personId).map(t => t.titleId).sort(cmp)
  const ineligible = !subject.alive || subject.deathYear !== undefined ? 'NOT_LIVING'
    : world.year - subject.birthYear < MVP_MARRIAGE_MIN_AGE ? 'NOT_ADULT'
      : world.legal.marriages.some(m => m.status === 'ACTIVE' && m.personIds.includes(subject.personId)) ? 'ACTIVE_MARRIAGE'
        : titleIds.length === 0 ? 'NO_ACTIVE_HEREDITARY_TITLE' : null
  const common = { personId: subject.personId, birthYear: subject.birthYear, titleIds }
  if (ineligible !== null) return { ...common, eligibility: ineligible, house: null, dynasty: null }

  const houses = new Set(world.houses.map(h => h.houseId))
  const dynasties = new Set(world.legal.dynasties.map(d => d.dynastyId))
  const houseOf = (p: Person) => houses.has(p.houseId) ? p.houseId : null
  const dynastyOf = (p: Person) => p.legalDynasty.status === 'DETERMINED' && dynasties.has(p.legalDynasty.dynastyId)
    ? p.legalDynasty.dynastyId : null
  const children = new Map<Id, Person[]>()
  for (const child of world.persons) {
    for (const parentId of new Set([child.fatherId, child.motherId])) {
      if (parentId === undefined) continue // 未記録の辺を推定しない。
      const list = children.get(parentId)
      if (list) list.push(child)
      else children.set(parentId, [child])
    }
  }
  const brokenEdges: { parentId: Id; childId: Id }[] = []
  const linked = new Map<Id, Person>([[subject.personId, subject]])
  const validChildren = new Map<Id, Id[]>()
  const pending = [subject]
  for (let parent = pending.pop(); parent !== undefined; parent = pending.pop()) {
    const valid: Id[] = []
    for (const child of children.get(parent.personId) ?? []) {
      // 厳密な出生順で循環する辺を除外。親役割の矛盾した辺も根拠にしない。
      if (child.birthYear <= parent.birthYear || child.birthYear > world.year ||
        (child.fatherId === parent.personId && parent.sex !== 'MALE') ||
        (child.motherId === parent.personId && parent.sex !== 'FEMALE')) {
        brokenEdges.push({ parentId: parent.personId, childId: child.personId })
      } else valid.push(child.personId)
      if (!linked.has(child.personId)) {
        linked.set(child.personId, child)
        pending.push(child) // 死亡した枝・矛盾の先も、各軸の判定に影響するか調べる。
      }
    }
    validChildren.set(parent.personId, valid)
  }
  const verified = new Set<Id>([subject.personId])
  const verifiedQueue = [subject.personId]
  for (const id of verifiedQueue) {
    for (const childId of validChildren.get(id) ?? []) {
      if (verified.has(childId)) continue
      verified.add(childId)
      verifiedQueue.push(childId)
    }
  }
  linked.delete(subject.personId)
  const records = [...linked.values()].sort((a, b) => cmp(a.personId, b.personId)).map(p => ({
    personId: p.personId, fatherId: p.fatherId ?? null, motherId: p.motherId ?? null,
    verifiedPath: verified.has(p.personId),
    birthYear: p.birthYear, deathYear: p.deathYear ?? null,
    life: p.alive && p.deathYear === undefined ? 'LIVING'
      : !p.alive && p.deathYear !== undefined && p.deathYear >= p.birthYear && p.deathYear <= world.year ? 'DEAD' : 'UNKNOWN',
    houseId: houseOf(p), dynastyId: dynastyOf(p),
  }))
  const basis = (ownId: Id | null, axis: 'houseId' | 'dynastyId') => {
    const satisfied = ownId !== null && records.some(r => r.verifiedPath && r.life === 'LIVING' && r[axis] === ownId)
    const unknown = ownId === null || records.some(r => r.life !== 'DEAD' &&
      (r[axis] === null || (r[axis] === ownId && (!r.verifiedPath || r.life === 'UNKNOWN'))))
    return { ownId, status: satisfied ? 'SATISFIED' : unknown ? 'UNKNOWN' : 'RECORDED_SHORTFALL' } as const
  }
  return { ...common, eligibility: 'ELIGIBLE', house: basis(houseOf(subject), 'houseId'),
    dynasty: basis(dynastyOf(subject), 'dynastyId'), records,
    brokenEdges: brokenEdges.sort((a, b) => cmp(a.parentId, b.parentId) || cmp(a.childId, b.childId)) }
}
