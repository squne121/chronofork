// PERSON_PAIR の正規化。(A,B) と (B,A) は同じペアを指す。
import type { Id, PairTrustTargetRef } from '../contracts/index.ts'

const isId = (v: unknown): v is Id => typeof v === 'string' && v !== ''

/**
 * 2 人の ID を昇順の PERSON_PAIR へ正規化する。ID が空/非文字列、または同一人物なら null（推測で補わない）。
 * 比較は UTF-16 コード単位の昇順（`<`）で、既存の Marriage.personIds / integrity と同じ。
 */
export function normalizePersonPair(a: unknown, b: unknown): readonly [Id, Id] | null {
  if (!isId(a) || !isId(b) || a === b) return null
  return a < b ? [a, b] : [b, a]
}

/** 正規化済みペアの安定キー。ID に含まれない区切りではなく JSON で曖昧さを避ける。 */
export function pairKey(ids: readonly [Id, Id]): string {
  return JSON.stringify([ids[0], ids[1]])
}

/** 任意順の 2 人から正規化済み PERSON_PAIR の TargetRef を作る。 */
export function toPairRef(a: Id, b: Id): PairTrustTargetRef | null {
  const ids = normalizePersonPair(a, b)
  return ids === null ? null : { kind: 'PERSON_PAIR', ids }
}
