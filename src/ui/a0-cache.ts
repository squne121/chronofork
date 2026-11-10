// MVP限定の原史A0キャッシュ。UI・DOM・Workerに依存しない純粋な保持/検証だけを持つ。
// 同一タブ・同一プレイ中の1世界線A0(完全なroot Branch)だけを保持し、永続化しない。
// 保持するのはBranch(snapshots/eventLog/decisionTraces)1組のみ。TimelineResult側の複製は持たない。
import { GOAL_YEAR, START_YEAR } from '../simulation/contracts/index.ts'
import type { Branch } from '../simulation/branching/index.ts'
import type { TimelineRun } from './timeline-source.ts'

/** キャッシュ形式の版。保持する構造を変えたら上げ、古い保持物を一致させない。 */
export const A0_CACHE_SCHEMA = 'a0-cache-1'
export type A0Source = 'COMPUTED' | 'REUSED'
export type A0CacheEntry = Readonly<{
  /** 初期世界・seed・法令/証拠・ルール/校正・RNG版を含む完全一致キー。ハッシュ化せず文字列比較する。 */
  key: string
  root: Branch
  a0: TimelineRun
  /** 保存時の件数。保持後に内容が欠けていないかの軽量検査に使う。 */
  counts: Readonly<{ snapshots: number; events: number; traces: number }>
}>

/** 完全一致キー。介入年・人物・補正量・期間は含めない(同じA0を再利用できるため)。 */
export function buildA0CacheKey(parts: Readonly<Record<string, unknown>>): string {
  return JSON.stringify([A0_CACHE_SCHEMA, parts])
}

export const countsOf = (b: Branch) => ({ snapshots: b.snapshots.length, events: b.eventLog.length, traces: b.decisionTraces.length })

/** 保持物が使える形か。少しでも不整合ならfalse(呼び出し側は再計算へfallbackする)。 */
export function isUsableA0Entry(e: A0CacheEntry, key: string): boolean {
  const b = e.root
  if (e.key !== key || b.status !== 'COMPLETED' || b.halt !== null || b.forkYear !== null || b.parentBranchId !== null) return false
  if (b.startYear !== START_YEAR || b.snapshots.length !== GOAL_YEAR - START_YEAR + 1) return false
  if (b.snapshots[0]?.year !== START_YEAR || b.snapshots[b.snapshots.length - 1]?.year !== GOAL_YEAR) return false
  const c = countsOf(b)
  if (c.snapshots !== e.counts.snapshots || c.events !== e.counts.events || c.traces !== e.counts.traces) return false
  if (!Object.isFrozen(b) || !Object.isFrozen(b.snapshots)) return false
  // 表示用A0が同じ配列を共有していること(別の複製を持っていない/すり替わっていない)。
  const r = e.a0.result
  return r.snapshots === b.snapshots && r.eventLog === b.eventLog && r.decisionTraces === b.decisionTraces
}

/** 1世界線A0だけを保持する。キー不一致・破損は黙って捨てて undefined を返す。 */
export class SingleA0Cache {
  #entry: A0CacheEntry | undefined
  get(key: string): A0CacheEntry | undefined {
    const e = this.#entry
    if (e === undefined) return undefined
    if (!isUsableA0Entry(e, key)) { this.#entry = undefined; return undefined }
    return e
  }
  put(entry: A0CacheEntry): void { this.#entry = entry }
  clear(): void { this.#entry = undefined }
  get size(): number { return this.#entry === undefined ? 0 : 1 }
}
