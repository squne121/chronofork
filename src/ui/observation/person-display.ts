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
}>

const sexText = (s: 'MALE' | 'FEMALE') => (s === 'MALE' ? '男' : '女')

/** 1人分の基本ラベル（同名の衝突は考慮しない）。 */
export function baseDisplayName(p: DisplayablePerson): string {
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
