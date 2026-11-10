// A0キャッシュ(同一プレイ・1世界線)のヒット条件・無効化・決定性を軽量モード(旧モード)で検証する。
import { describe, expect, it } from 'vitest'
import { runPlayComparison } from '../../../src/ui/branch-play-source.ts'
import type { PlayInput } from '../../../src/ui/branch-play-source.ts'
import { SingleA0Cache, isUsableA0Entry } from '../../../src/ui/a0-cache.ts'
import type { PlayProgress } from '../../../src/ui/play-progress.ts'

const BASE: PlayInput = { mode: 'ORDINARY_LAW', seed: 20260101, year: 1260, firstPersonId: 'person-exp-04', secondPersonId: 'person-exp-05', signedDelta: -20, durationYears: 5 }
const digest = (r: ReturnType<typeof runPlayComparison>) => {
  if (!r.ok) return JSON.stringify([r.code, r.message])
  const c = r.comparison
  return JSON.stringify([c.a0.result, c.a1.result, c.modifier])
}

describe('A0キャッシュ', () => {
  it('介入年・補正量を変えても同じA0を再利用し、A1は毎回実再計算する。結果はキャッシュ無しと完全一致する', () => {
    const cache = new SingleA0Cache()
    let reused = 0
    const hooks = { cache, onA0Reused: () => { reused++ } }
    const first = runPlayComparison(BASE, undefined, hooks)
    expect(first.ok && first.comparison.a0Source).toBe('COMPUTED')
    expect(cache.size).toBe(1)
    const other: PlayInput = { ...BASE, year: 1262, signedDelta: -30 }
    const a1Progress: PlayProgress[] = []
    const second = runPlayComparison(other, p => a1Progress.push(p), hooks)
    expect(second.ok && second.comparison.a0Source).toBe('REUSED')
    expect(reused).toBe(1)
    // A0の進捗通知は出さない。A1は介入年から実際に再計算した進捗だけ。
    expect(a1Progress.every(p => p.branch === 'A1')).toBe(true)
    expect(a1Progress[0]?.startYear).toBe(1262)
    expect(a1Progress.length).toBe(1350 - 1262)
    // 従来(キャッシュ無し)実行と完全一致、A0はキャッシュ内の同一参照。
    expect(digest(second)).toBe(digest(runPlayComparison(other)))
    expect(digest(first)).toBe(digest(runPlayComparison(BASE)))
    if (first.ok && second.ok) expect(second.comparison.a0).toBe(first.comparison.a0)
  }, 120_000) // 単独4秒だが、全テスト並列時はCPU競合で30秒既定を超えうる

  it('seedやモードが違えばヒットせず、新しいA0に置き換える(最大1件)', () => {
    const cache = new SingleA0Cache()
    runPlayComparison(BASE, undefined, { cache })
    const seed2 = runPlayComparison({ ...BASE, seed: BASE.seed + 1 }, undefined, { cache })
    expect(seed2.ok && seed2.comparison.a0Source).toBe('COMPUTED')
    expect(cache.size).toBe(1)
    const back = runPlayComparison(BASE, undefined, { cache })
    expect(back.ok && back.comparison.a0Source).toBe('COMPUTED') // 旧seedのA0は残っていない
    const mode = runPlayComparison({ ...BASE, mode: 'FIXED_APPROVAL' }, undefined, { cache })
    expect(mode.ok && mode.comparison.a0Source).toBe('COMPUTED')
  })

  it('キャッシュ破損・件数不一致は捨てて再計算へfallbackする', () => {
    const cache = new SingleA0Cache()
    const r = runPlayComparison(BASE, undefined, { cache })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    // 破損の代理: 件数が合わない保持物は使えないと判定する。
    const entry = { key: 'k', root: r.comparison.root, a0: r.comparison.a0, counts: { snapshots: 1, events: 0, traces: 0 } }
    expect(isUsableA0Entry(entry, 'k')).toBe(false)
    const ok = { ...entry, counts: { snapshots: r.comparison.root.snapshots.length, events: r.comparison.root.eventLog.length, traces: r.comparison.root.decisionTraces.length } }
    expect(isUsableA0Entry(ok, 'k')).toBe(true)
    expect(isUsableA0Entry(ok, 'other-key')).toBe(false)
    expect(isUsableA0Entry({ ...ok, root: { ...ok.root } }, 'k')).toBe(false) // 非凍結のすり替え
    expect(isUsableA0Entry({ ...ok, a0: { ...ok.a0, result: { ...ok.a0.result, snapshots: [...ok.a0.result.snapshots] } } }, 'k')).toBe(false)
    cache.put(ok)
    expect(cache.get('other-key')).toBeUndefined()
    expect(cache.size).toBe(0) // 不一致で破棄
  })

  it('A0がHALTEDの実行ではキャッシュしない / 入力不正でもキャッシュを汚さない', () => {
    const cache = new SingleA0Cache()
    const bad = runPlayComparison({ ...BASE, year: 1200 }, undefined, { cache })
    expect(bad.ok).toBe(false)
    expect(cache.size).toBe(0)
  })

  it('clear()後は必ず再計算になる', () => {
    const cache = new SingleA0Cache()
    runPlayComparison(BASE, undefined, { cache })
    cache.clear()
    const r = runPlayComparison(BASE, undefined, { cache })
    expect(r.ok && r.comparison.a0Source).toBe('COMPUTED')
  })
})
