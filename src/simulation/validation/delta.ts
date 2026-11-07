// 差分検証: 検証済み WorldState から pairTrust だけが変わった場合の高速な妥当性確認。
// 肯定できた場合のみ true を返す。少しでも疑わしい（pairTrust 以外が変化、診断が 1 件でも出る）場合は false を返し、
// 呼出側が従来の validateWorldState（全体検証）で正確な診断を得る。検証自体を省略するものではない。
import type { Id, WorldState } from '../contracts/index.ts'
import type { Diagnostic } from './diagnostics.ts'
import { checkPairTrustRecords } from './integrity.ts'
import { parsePairTrustRecords } from './parse.ts'

const isPlain = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** pairTrust を除く全フィールドが参照同一（入れ子のオブジェクトは 1 階層だけ要素参照の同一性を見る）。 */
function sameExceptPairTrust(before: WorldState, after: WorldState): boolean {
  const b = before as unknown as Record<string, unknown>
  const a = after as unknown as Record<string, unknown>
  for (const k of new Set([...Object.keys(b), ...Object.keys(a)])) {
    if (k === 'pairTrust' || b[k] === a[k]) continue
    const x = b[k], y = a[k]
    if (!isPlain(x) || !isPlain(y)) return false
    for (const kk of new Set([...Object.keys(x), ...Object.keys(y)])) {
      if (x[kk] !== y[kk]) return false
    }
  }
  return true
}

/** pairTrust の識別キー（personIds の JSON）。要素は不変更新で参照共有されるため参照ごとに一度だけ計算する。 */
const KEY = new WeakMap<object, string>()
const keyOf = (r: { personIds: readonly [string, string] }): string => {
  let k = KEY.get(r)
  if (k === undefined) { k = JSON.stringify(r.personIds); KEY.set(r, k) }
  return k
}

/**
 * `before` が検証済み（ERROR なし）で、`after` が pairTrust のみ異なるとき、`after` に ERROR が無いことを確認する。
 * - pairTrust 以外の検証結果は pairTrust に依存しない（pairTrust 検査は人物ID・世界年だけを参照する）。
 * - `before` に存在した記録（参照同一）は人物・年が不変なので検証済み。新規/変更された記録だけを、
 *   全体検証と同一の構造検査・整合検査コードで確認する。
 * - 人物ペアの重複は、全記録のキー数と件数の一致で全件確認する。
 */
export function confirmPairTrustOnlyChangeValid(before: WorldState, after: WorldState): boolean {
  if (before === after || !sameExceptPairTrust(before, after)) return false
  const afterList = after.pairTrust ?? []
  const known = new Set<object>(before.pairTrust ?? [])
  const changed = afterList.filter((r) => !known.has(r))
  const sink: Diagnostic[] = []
  const records = parsePairTrustRecords(changed, sink)
  if (sink.length > 0) return false
  const personIds = new Set<Id>(after.persons.map((p) => p.personId))
  let clean = true
  const flag = () => { clean = false }
  checkPairTrustRecords(records, after.year, (_kind, id) => personIds.has(id) || (flag(), false), flag)
  if (!clean) return false
  return new Set(afterList.map(keyOf)).size === afterList.length
}
