// 1 バッチ分の作業コピー。コミットされるまで入力の WorldState / Transaction には触れない。
import type { Id, Person, Title, WorldState } from '../../contracts/index.ts'
import type { CasualtyRecord, Rejection, RejectionCode } from './types.ts'

export type Draft = {
  world: WorldState
  casualties: Map<Id, CasualtyRecord>
  /** このバッチで作成・更新した casualtyId（バッチ終端で完結性を検証）。 */
  touchedCasualties: Set<Id>
}

export type Handler<C> = (draft: Draft, command: C) => Rejection | null

export const fail = (code: RejectionCode, message: string, related?: readonly Id[]): Rejection =>
  related ? { code, message, related } : { code, message }

export const findPerson = (w: WorldState, id: Id): Person | undefined =>
  w.persons.find((p) => p.personId === id)

export const findTitle = (w: WorldState, id: Id): Title | undefined =>
  w.titles.find((t) => t.titleId === id)

/** 生存する既存人物を要求する。 */
export function requireAlivePerson(w: WorldState, id: Id): Rejection | null {
  const p = findPerson(w, id)
  if (!p) return fail('NOT_FOUND', `人物 ${id} が存在しません`, [id])
  if (!p.alive) return fail('PERSON_DEAD', `人物 ${id} は死亡済みです`, [id])
  return null
}
