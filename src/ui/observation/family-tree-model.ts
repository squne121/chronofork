// 選択人物のミニ家系図の表示用モデル（読み取り専用）。
// 入力は「選択年の年初 WorldState」と人物 ID のみ。新しいゲーム規則・関係・Event/Trace を生成しない。
// snapshot に無い参照は補完せず UNCONFIRMED として残す。血縁・家門から法的王朝を推定しない。
import type { Id, Person, Title, WorldState, Year } from '../../simulation/contracts/index.ts'

export type LifeState =
  | Readonly<{ kind: 'ALIVE' }>
  | Readonly<{ kind: 'DEAD'; deathYear?: Year }>

/** snapshot に実在する人物のノード。 */
export type PersonNode = Readonly<{
  kind: 'PERSON'
  personId: Id
  name: string
  birthYear: Year
  life: LifeState
}>

/** 参照 ID はあるが、この snapshot の人物として確認できないもの。名前などは作らない。 */
export type UnconfirmedNode = Readonly<{
  kind: 'UNCONFIRMED'
  refId: Id
  reason: 'NOT_IN_SNAPSHOT' | 'NOT_BORN_YET' | 'SELF_REFERENCE'
}>

/** 記録自体が無い（未知の親など）。ID も作らない。 */
export type NoRecordNode = Readonly<{ kind: 'NO_RECORD' }>

export type ParentSlot = PersonNode | UnconfirmedNode | NoRecordNode

export type AffiliationView = Readonly<{
  house:
    | Readonly<{ status: 'CONFIRMED'; houseId: Id; name: string }>
    | Readonly<{ status: 'UNCONFIRMED'; houseId: Id }>
  legalDynasty:
    | Readonly<{ status: 'DETERMINED'; dynastyId: Id; name: string }>
    | Readonly<{ status: 'DETERMINED_UNRESOLVED'; dynastyId: Id }>
    | Readonly<{ status: 'UNDETERMINED' }>
  /** 血統記録。法的王朝所属・家名とは別データであり、所属の根拠にしない。 */
  bloodlineDynasty?:
    | Readonly<{ status: 'CONFIRMED'; dynastyId: Id; name: string }>
    | Readonly<{ status: 'UNCONFIRMED'; dynastyId: Id }>
}>

export type TitleView = Readonly<{
  titleId: Id
  kind: Title['kind']
  regionId: Id
  regionName?: string
  valid: boolean
}>

export type FamilyTreeModel =
  | Readonly<{ status: 'PERSON_NOT_FOUND'; year: Year; personId: Id }>
  | Readonly<{ status: 'NOT_BORN_YET'; year: Year; personId: Id; birthYear: Year }>
  | Readonly<{
      status: 'OK'
      year: Year
      self: PersonNode
      father: ParentSlot
      mother: ParentSlot
      /** 当年に有効（ACTIVE）な婚姻の配偶者のみ。終了した婚姻は含めない。 */
      spouses: readonly (PersonNode | UnconfirmedNode)[]
      /** snapshot 上で fatherId/motherId が選択人物を指し、当年までに出生している人物。 */
      children: readonly PersonNode[]
      affiliation: AffiliationView
      /** holder が選択人物の HELD である Title のみ。 */
      titles: readonly TitleView[]
    }>

const lifeOf = (p: Person): LifeState =>
  p.alive ? { kind: 'ALIVE' } : p.deathYear === undefined ? { kind: 'DEAD' } : { kind: 'DEAD', deathYear: p.deathYear }

const toNode = (p: Person): PersonNode => ({
  kind: 'PERSON',
  personId: p.personId,
  name: p.name,
  birthYear: p.birthYear,
  life: lifeOf(p),
})

export function buildFamilyTreeModel(world: WorldState, personId: Id): FamilyTreeModel {
  const year = world.year
  const persons = new Map<Id, Person>()
  for (const p of world.persons) if (!persons.has(p.personId)) persons.set(p.personId, p)

  const selected = persons.get(personId)
  if (!selected) return { status: 'PERSON_NOT_FOUND', year, personId }
  if (selected.birthYear > year) return { status: 'NOT_BORN_YET', year, personId, birthYear: selected.birthYear }

  const resolve = (refId: Id): PersonNode | UnconfirmedNode => {
    if (refId === personId) return { kind: 'UNCONFIRMED', refId, reason: 'SELF_REFERENCE' }
    const p = persons.get(refId)
    if (!p) return { kind: 'UNCONFIRMED', refId, reason: 'NOT_IN_SNAPSHOT' }
    if (p.birthYear > year) return { kind: 'UNCONFIRMED', refId, reason: 'NOT_BORN_YET' }
    return toNode(p)
  }
  const parentSlot = (id: Id | undefined): ParentSlot => (id === undefined ? { kind: 'NO_RECORD' } : resolve(id))

  const spouseIds: Id[] = []
  for (const m of world.legal.marriages) {
    if (m.status !== 'ACTIVE') continue
    if (m.registeredYear > year) continue
    if (m.dissolvedYear !== undefined && m.dissolvedYear <= year) continue
    const [a, b] = m.personIds
    if (a === b) continue
    const other = a === personId ? b : b === personId ? a : undefined
    if (other !== undefined && !spouseIds.includes(other)) spouseIds.push(other)
  }

  const children = world.persons
    .filter((p) => p.personId !== personId && p.birthYear <= year && (p.fatherId === personId || p.motherId === personId))
    .filter((p, i, all) => all.findIndex((q) => q.personId === p.personId) === i)
    .sort((a, b) => a.birthYear - b.birthYear || (a.personId < b.personId ? -1 : a.personId > b.personId ? 1 : 0))
    .map(toNode)

  const house = world.houses.find((h) => h.houseId === selected.houseId)
  const dynastyName = (id: Id) => world.legal.dynasties.find((d) => d.dynastyId === id)?.name
  const legal = selected.legalDynasty
  let legalView: AffiliationView['legalDynasty'] = { status: 'UNDETERMINED' }
  if (legal.status === 'DETERMINED') {
    const name = dynastyName(legal.dynastyId)
    legalView =
      name === undefined
        ? { status: 'DETERMINED_UNRESOLVED', dynastyId: legal.dynastyId }
        : { status: 'DETERMINED', dynastyId: legal.dynastyId, name }
  }
  const bloodId = selected.bloodlineDynastyId
  const bloodName = bloodId === undefined ? undefined : dynastyName(bloodId)
  const affiliation: AffiliationView = {
    house: house
      ? { status: 'CONFIRMED', houseId: house.houseId, name: house.name }
      : { status: 'UNCONFIRMED', houseId: selected.houseId },
    legalDynasty: legalView,
    ...(bloodId === undefined
      ? {}
      : {
          bloodlineDynasty:
            bloodName === undefined
              ? ({ status: 'UNCONFIRMED', dynastyId: bloodId } as const)
              : ({ status: 'CONFIRMED', dynastyId: bloodId, name: bloodName } as const),
        }),
  }

  const titles: TitleView[] = world.titles
    .filter((t) => t.holder.status === 'HELD' && t.holder.personId === personId)
    .map((t) => {
      const region = world.regions.find((r) => r.regionId === t.regionId)
      return {
        titleId: t.titleId,
        kind: t.kind,
        regionId: t.regionId,
        ...(region ? { regionName: region.name } : {}),
        valid: t.valid,
      }
    })
    .sort((a, b) => (a.titleId < b.titleId ? -1 : a.titleId > b.titleId ? 1 : 0))

  return {
    status: 'OK',
    year,
    self: toNode(selected),
    father: parentSlot(selected.fatherId),
    mother: parentSlot(selected.motherId),
    spouses: spouseIds.map(resolve),
    children,
    affiliation,
    titles,
  }
}
