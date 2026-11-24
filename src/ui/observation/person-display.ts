// 試験用仮名の通常表示。名前に埋め込まれた固定の役割（当主・嫡男等）は現在の役割ではないため表示しない。
// 実家門・法的王朝・選択年の称号は、WorldStateの実記録から別の欄に示す。元のnameは変更しない。
import type { Id } from '../../simulation/contracts/index.ts'
const shortPersonName = (name: string) => name.replace(/\s*\(.*$/, '')

/** 表示用識別タグ。内部IDそのものは変更しない。 */
export const personIdTag = (id: Id): string => {
  let h = 0x811c9dc5
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  return h.toString(16).padStart(8, '0')
}

export type DisplayablePerson = Readonly<{
  personId: Id
  name: string
  sex: 'MALE' | 'FEMALE'
  birthYear: number
  interactionRole?: 'KEY' | 'SUPPORTING'
  supporting?: boolean
}>

/** 登録時のIDと名前が一致し、正規形式である場合だけ人口由来と判断する。 */
function isPopulationSupporting(p: DisplayablePerson): boolean {
  if (p.name !== p.personId || !(p.interactionRole === 'SUPPORTING' || (p.interactionRole === undefined && p.supporting === true))) return false
  const prefix = 'support:population:'
  if (!p.personId.startsWith(prefix)) return false
  try {
    const value: unknown = JSON.parse(p.personId.slice(prefix.length))
    return Array.isArray(value) && value.length === 2 && typeof value[0] === 'string' && value[0].length > 0 &&
      Number.isSafeInteger(value[1]) && value[1] >= 0 && p.personId === prefix + JSON.stringify(value)
  } catch {
    return false
  }
}

const sexText = (s: 'MALE' | 'FEMALE') => (s === 'MALE' ? '男' : '女')

/** 1人分の基本ラベル（同名の衝突は考慮しない）。 */
export function baseDisplayName(p: DisplayablePerson): string {
  if (isPopulationSupporting(p)) return `試験人物（補助・${p.birthYear}年生・${sexText(p.sex)}）`
  const init = /^試験人物(\d+)/.exec(p.name)
  if (init) return '試験人物' + init[1]
  if (p.name.startsWith('試験用自律児')) return `試験人物（${p.birthYear}年生・${sexText(p.sex)}）`
  if (p.name.startsWith('試験用補助人物')) return `試験人物（補助・${p.birthYear}年生・${sexText(p.sex)}）`
  if (p.name.startsWith('実験用の記名候補')) return `試験人物（記名候補・${p.birthYear}年生・${sexText(p.sex)}）`
  return shortPersonName(p.name)
}

/** 全人物を渡して、同じ表示になる人物には識別タグを付ける。 */
export function personDisplayNames(persons: readonly DisplayablePerson[]): (id: Id) => string | undefined {
  const base = new Map(persons.map(p => [p.personId, baseDisplayName(p)]))
  const counts = new Map<string, number>()
  for (const v of base.values()) counts.set(v, (counts.get(v) ?? 0) + 1)
  const final = new Map<Id, string>()
  for (const [id, label] of base) final.set(id, (counts.get(label) ?? 0) > 1 ? `${label}・識別${personIdTag(id)}` : label)
  return id => final.get(id)
}

/** 単独の名前から表示名を得る（性別・出生年が分からない場面の代替）。 */
export const displayNameOf = (resolve: (id: Id) => string | undefined, id: Id, fallback: string): string => resolve(id) ?? fallback
