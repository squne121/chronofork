// B-009の単一書込境界。累積関係の原値だけを更新し、StatModifierの加算は行わない。
// 共通reducerが事前検証・整合検証・年単位の原子確定とEventLogの実差分を担う。
import type { PersonPairTrust, PersonPairTrustSetCommand } from '../../contracts/index.ts'
import { PAIR_TRUST_DEFINITION } from '../../intervention/stat-registry.ts'
import { pairTrustKey } from './diff.ts'
import type { Handler } from './draft.ts'
import { fail } from './draft.ts'

export const personPairTrustSet: Handler<PersonPairTrustSetCommand> = (d, c) => {
  const w = d.world
  const relation = c.relation
  if (!relation || !Array.isArray(relation.personIds) || relation.personIds.length !== 2) {
    return fail('INVALID_COMMAND', 'PERSON_PAIR_TRUST_SETには人物IDを2件指定します')
  }
  const [a, b] = relation.personIds
  if (typeof a !== 'string' || typeof b !== 'string' || a === '' || b === '' || a >= b) {
    return fail('INVALID_COMMAND', '人物IDは空でない相異なる2件を昇順で指定します')
  }
  if (!w.persons.some(p=>p.personId===a) || !w.persons.some(p=>p.personId===b)) {
    return fail('NOT_FOUND', '関係値の対象人物がWorldStateに存在しません', [a,b])
  }
  if (!Number.isSafeInteger(relation.value) ||
      relation.value < PAIR_TRUST_DEFINITION.min || relation.value > PAIR_TRUST_DEFINITION.max) {
    return fail('INVALID_COMMAND', 'pair.trustがCALIBRATION_ONLYの値域外です')
  }
  if (relation.lastUpdatedYear !== w.year) {
    return fail('YEAR_MISMATCH', '人物関係のlastUpdatedYearは当年と一致する必要があります')
  }
  const current = w.pairTrust ?? []
  // 高速経路: この呼出し内で厳密昇順と確認済みの配列なら、全走査せず二分探索で同じ位置を求める。
  // 厳密昇順では同じペアの記録は高々1件で、従来の find（先頭一致）・filter（全除去）・挿入位置と同一になる。
  if (d.scope?.sortedPairTrust.has(current)) {
    const key = pairTrustKey(relation)
    const lo = lowerBound(current, key)
    const found = lo < current.length && pairTrustKey(current[lo] as PersonPairTrust) === key ? current[lo] : undefined
    if (found?.lastUpdatedYear === w.year) {
      return fail('INVALID_COMMAND', '同一人物ペアは当年すでに更新済みです')
    }
    if (found !== relation) {
      const after = [...current.slice(0, lo), relation, ...current.slice(found ? lo + 1 : lo)]
      d.scope.sortedPairTrust.add(after)
      d.pairTrustEdit = { before: current, after, removed: found, inserted: relation }
      d.world = {...w,pairTrust:after}
      return null
    }
  }
  const previous = current.find(x=>x.personIds[0]===a && x.personIds[1]===b)
  if (previous?.lastUpdatedYear === w.year) {
    return fail('INVALID_COMMAND', '同一人物ペアは当年すでに更新済みです')
  }
  // 保有する原値だけ更新。modifierは一切保持せずB-004の年次解決に任せる。
  const next = current.filter(x=>x.personIds[0]!==a || x.personIds[1]!==b)
  const inserted = insertSorted(next,relation)
  // next が厳密昇順で relation と同じキーを含まない（filter で除去済み）なら、結果も厳密昇順。
  // pairTrustKey は要素ごとの呼出しをまたぐキャッシュのため、呼出し後に要素の personIds が書き換えられていると
  // 古いキーでの昇順にすぎない。全要素でキャッシュと現在の personIds が一致する場合だけ確認済みとする。
  if (inserted.sorted && d.scope && inserted.list.every(x=>pairTrustKey(x)===JSON.stringify(x.personIds))) {
    d.scope.sortedPairTrust.add(inserted.list)
  }
  d.world = {...w,pairTrust:inserted.list}
  return null
}

const keyLess = (x: PersonPairTrust, y: PersonPairTrust) => {
  const kx=pairTrustKey(x),ky=pairTrustKey(y)
  return kx<ky?-1:kx>ky?1:0
}

/** キーが key 以上となる最初の位置（厳密昇順の配列が前提）。 */
function lowerBound(base: readonly PersonPairTrust[], key: string): number {
  let lo = 0, hi = base.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (pairTrustKey(base[mid] as PersonPairTrust) < key) lo = mid + 1
    else hi = mid
  }
  return lo
}

/**
 * 従来の「末尾に追加して全体を JSON キー順で安定ソート」と同一の結果を返す。
 * 既存配列が既にキー順（昇順・重複なし）なら二分探索で挿入し、そうでなければ従来どおり全体をソートする。
 * sorted は、base が厳密昇順と確認でき二分挿入した場合に true。
 */
function insertSorted(base: readonly PersonPairTrust[], relation: PersonPairTrust): { list: PersonPairTrust[]; sorted: boolean } {
  let sorted = true
  for (let i = 1; i < base.length; i++) {
    if (keyLess(base[i-1] as PersonPairTrust, base[i] as PersonPairTrust) >= 0) { sorted = false; break }
  }
  if (!sorted) return { list: [...base, relation].sort(keyLess), sorted: false }
  const lo = lowerBound(base, pairTrustKey(relation))
  // lo は relation 以上の最初の位置。同一キーは除去済みのため等値は存在しない。
  return { list: [...base.slice(0, lo), relation, ...base.slice(lo)], sorted: true }
}
