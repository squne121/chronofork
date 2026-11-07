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
  const previous = current.find(x=>x.personIds[0]===a && x.personIds[1]===b)
  if (previous?.lastUpdatedYear === w.year) {
    return fail('INVALID_COMMAND', '同一人物ペアは当年すでに更新済みです')
  }
  // 保有する原値だけ更新。modifierは一切保持せずB-004の年次解決に任せる。
  const next = current.filter(x=>x.personIds[0]!==a || x.personIds[1]!==b)
  d.world = {...w,pairTrust:insertSorted(next,relation)}
  return null
}

const keyLess = (x: PersonPairTrust, y: PersonPairTrust) => {
  const kx=pairTrustKey(x),ky=pairTrustKey(y)
  return kx<ky?-1:kx>ky?1:0
}

/**
 * 従来の「末尾に追加して全体を JSON キー順で安定ソート」と同一の結果を返す。
 * 既存配列が既にキー順（昇順・重複なし）なら二分探索で挿入し、そうでなければ従来どおり全体をソートする。
 */
function insertSorted(base: readonly PersonPairTrust[], relation: PersonPairTrust): PersonPairTrust[] {
  let sorted = true
  for (let i = 1; i < base.length; i++) {
    if (keyLess(base[i-1] as PersonPairTrust, base[i] as PersonPairTrust) >= 0) { sorted = false; break }
  }
  if (!sorted) return [...base, relation].sort(keyLess)
  let lo = 0, hi = base.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (keyLess(base[mid] as PersonPairTrust, relation) < 0) lo = mid + 1
    else hi = mid
  }
  // lo は relation 以上の最初の位置。同一キーは除去済みのため等値は存在しない。
  return [...base.slice(0, lo), relation, ...base.slice(lo)]
}
