// UI の読み取り境界。既存の契約型だけを使い、表示用の参照解決を行う。
// ゲーム判断（相続・戦争・Goal 判定）はここでも実装しない。値は WorldState 等の読み取りのみ。
import type {
  ControllerRef,
  DecisionTrace,
  EventLogEntry,
  Id,
  Person,
  PopulationGroup,
  Region,
  StatModifier,
  Title,
  WorldState,
} from '../simulation/contracts/index.ts'
import type { GoalEvaluation } from '../simulation/goal.ts'
import { createExperimentalScenario } from '../scenario/experimental/index.ts'

/**
 * 画面へ渡す読み取り専用の入力。world 以外は任意で、未指定は「未接続」と表示する。
 * 年次ランナー（#15）の snapshot / Goal / EventLog / Trace が確定したら、この型へ接続する。
 */
export type InspectionSource = Readonly<{
  label: string
  world: WorldState
  /** experimental 試験データか。true の間は仮データ表示を外さない。 */
  experimental: boolean
  goal?: GoalEvaluation
  events?: readonly EventLogEntry[]
  traces?: readonly DecisionTrace[]
  modifiers?: readonly StatModifier[]
}>

/** 現行唯一の入力。1250 年の experimental 世界のみで、評価・ログ・Trace は持たない。 */
export function loadExperimentalSource(): InspectionSource {
  const scenario = createExperimentalScenario()
  return { label: scenario.id, world: scenario.world, experimental: true }
}

export type EntityKind = 'region' | 'group' | 'person' | 'title'
export type Selection = Readonly<{ kind: EntityKind; id: Id }>

/** 参照先が見つからない場合に表示する語。ID を示して欠落を隠さない。 */
export function missingLabel(id: Id): string {
  return `参照不明（${id}）`
}

export type Link = Readonly<{ kind: EntityKind | 'country' | 'house'; id: Id; label: string; resolved: boolean }>

export type WorldIndex = Readonly<{
  region: (id: Id) => Region | undefined
  group: (id: Id) => PopulationGroup | undefined
  person: (id: Id) => Person | undefined
  title: (id: Id) => Title | undefined
  countryName: (id: Id) => string
  houseName: (id: Id) => string
  link: (kind: EntityKind, id: Id) => Link
  controller: (ref: ControllerRef) => Link
}>

export function indexWorld(world: WorldState): WorldIndex {
  const regions = new Map(world.regions.map((r) => [r.regionId, r]))
  const groups = new Map(world.groups.map((g) => [g.groupId, g]))
  const persons = new Map(world.persons.map((p) => [p.personId, p]))
  const titles = new Map(world.titles.map((t) => [t.titleId, t]))
  const countries = new Map(world.countries.map((c) => [c.countryId, c]))
  const houses = new Map(world.houses.map((h) => [h.houseId, h]))

  const countryName = (id: Id) => countries.get(id)?.name ?? missingLabel(id)
  const houseName = (id: Id) => houses.get(id)?.name ?? missingLabel(id)

  const entityLabel = (kind: EntityKind, id: Id): string | undefined => {
    switch (kind) {
      case 'region':
        return regions.get(id)?.name
      case 'group':
        return groups.get(id)?.name
      case 'person':
        return persons.get(id)?.name
      case 'title':
        return titleLabel(titles.get(id), regions)
    }
  }

  return {
    region: (id) => regions.get(id),
    group: (id) => groups.get(id),
    person: (id) => persons.get(id),
    title: (id) => titles.get(id),
    countryName,
    houseName,
    link: (kind, id) => {
      const label = entityLabel(kind, id)
      return { kind, id, label: label ?? missingLabel(id), resolved: label !== undefined }
    },
    controller: (ref) => {
      if (ref.kind === 'COUNTRY') {
        const c = countries.get(ref.id)
        return { kind: 'country', id: ref.id, label: c?.name ?? missingLabel(ref.id), resolved: !!c }
      }
      if (ref.kind === 'HOUSE') {
        const h = houses.get(ref.id)
        return { kind: 'house', id: ref.id, label: h ? `${h.name}家` : missingLabel(ref.id), resolved: !!h }
      }
      const p = persons.get(ref.id)
      return { kind: 'person', id: ref.id, label: p?.name ?? missingLabel(ref.id), resolved: !!p }
    },
  }
}

export const TITLE_KIND_LABEL: Record<Title['kind'], string> = {
  CROWN: '王冠称号',
  TERRITORIAL: '領地称号',
}

export function titleLabel(title: Title | undefined, regions: ReadonlyMap<Id, Region>): string | undefined {
  if (!title) return undefined
  const regionName = regions.get(title.regionId)?.name ?? missingLabel(title.regionId)
  return `${regionName}の${TITLE_KIND_LABEL[title.kind]}`
}

export const RECOGNITION_LABEL: Record<Title['recognition']['status'], string> = {
  ACTIVE: '承認済み',
  PENDING: '承認待ち',
  REVOKED: '剥奪',
}

/** 支持 bps を小数 1 桁の % 文字列へ。表示のみで丸めた値を状態に戻さない。 */
export function bpsToPercent(bps: number): string {
  return `${(bps / 100).toFixed(1)}%`
}

export function goalLabel(goal: GoalEvaluation | undefined): string {
  if (!goal) return '未計算（評価未接続）'
  switch (goal.status) {
    case 'INVALID_INPUT':
      return '入力データ不正（評価不能）'
    case 'NOT_EVALUABLE':
      return `${goal.year}年は判定対象外`
    case 'ACHIEVED':
      return '達成'
    case 'NOT_ACHIEVED':
      return '未達'
  }
}
