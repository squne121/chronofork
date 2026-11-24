// 1 バッチ分の作業コピー。コミットされるまで入力の WorldState / Transaction には触れない。
import type { Id, Person, PersonPairTrust, Title, WorldState } from '../../contracts/index.ts'
import type { CasualtyRecord, Rejection, RejectionCode } from './types.ts'

/**
 * applyOutcome 1 回の呼出し内だけで有効な作業索引。呼出しの外へ公開せず、終了時に破棄する。
 * 呼出し内で作られた配列は呼出し元に返るまで誰も変更できないため、確認済みの性質が保たれる。
 */
export type ApplyScope = {
  /**
   * 人物ペアキー（pairTrustKey）が厳密昇順（重複なし）であることを、この呼出し内で全件確認した、
   * またはその配列へキー位置に 1 件だけ挿入・置換して作った pairTrust 配列。
   */
  sortedPairTrust: WeakSet<readonly PersonPairTrust[]>
}

/**
 * PERSON_PAIR_TRUST_SET が厳密昇順の配列 before から、同じキーの要素 removed（無ければ undefined）を
 * inserted に置き換えて（または挿入して）after を作ったという構成の記録。after も厳密昇順で、
 * before と after の共有要素は同順・同数、inserted は before に含まれない。
 */
export type PairTrustEdit = Readonly<{
  before: readonly PersonPairTrust[]
  after: readonly PersonPairTrust[]
  removed: PersonPairTrust | undefined
  inserted: PersonPairTrust
}>

export type Draft = {
  world: WorldState
  casualties: Map<Id, CasualtyRecord>
  /** このバッチで作成・更新した casualtyId（バッチ終端で完結性を検証）。 */
  touchedCasualties: Set<Id>
  /** 呼出し内の作業索引（無ければ従来経路のみ）。 */
  scope?: ApplyScope
  /** 直前の handler が記録した pairTrust の構成（handler 呼出しごとに呼出側が消去する）。 */
  pairTrustEdit?: PairTrustEdit
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
