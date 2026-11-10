// A0キャッシュの実測(ローカル専用・既定CIに含めない)。1プロセスで実行する。
//   A0_BENCH_MODE=NOCACHE: 指定年を1回、キャッシュ無しで計算(従来)。
//   A0_BENCH_MODE=CACHED : 同一プロセスでキャッシュ有り。YEARS順に実行し、先頭がmiss、以降がhit。
// 例: for y in 1250 1290 1340; do CHRONOFORK_LONG_A0CACHE=1 A0_BENCH_MODE=NOCACHE YEARS=$y node --expose-gc --max-old-space-size=12288 \
//       node_modules/vitest/vitest.mjs run tests/unit/ui/a0-cache-long.test.ts; done
//     CHRONOFORK_LONG_A0CACHE=1 A0_BENCH_MODE=CACHED YEARS=1250,1290,1340,1250 node --expose-gc --max-old-space-size=12288 node_modules/vitest/vitest.mjs run ...
import { createHash } from 'node:crypto'
import v8 from 'node:v8'
import vm from 'node:vm'
import { appendFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { runPlayComparison } from '../../../src/ui/branch-play-source.ts'
import type { PlayInput } from '../../../src/ui/branch-play-source.ts'
import { SingleA0Cache } from '../../../src/ui/a0-cache.ts'
import type { PlayProgress } from '../../../src/ui/play-progress.ts'

const longTest = process.env.CHRONOFORK_LONG_A0CACHE === '1' ? describe : describe.skip
const BASE: PlayInput = { mode: 'INTEGRATED_EXPERIMENTAL', seed: 20260101, year: 1290, firstPersonId: 'person-exp-02', secondPersonId: 'person-exp-05', signedDelta: -20, durationYears: 5 }
function digest(r: ReturnType<typeof runPlayComparison>): string {
  const h = createHash('sha256')
  if (!r.ok) return h.update(JSON.stringify([r.code, r.message])).digest('hex')
  for (const run of [r.comparison.a0.result, r.comparison.a1.result]) {
    h.update(JSON.stringify([run.status, run.halt, run.goal, run.technicalGoal, run.coverage, run.autonomousHistory]))
    for (const w of run.snapshots) h.update(JSON.stringify(w))
    for (const e of run.eventLog) h.update(JSON.stringify(e))
    for (const t of run.decisionTraces) h.update(JSON.stringify(t))
  }
  return h.digest('hex')
}
const mb = (n: number) => Math.round(n / 1048576)
// vitestのワーカーではglobal.gcが無い場合があるため、v8フラグ経由で必ず使えるgcを得る。
v8.setFlagsFromString('--expose_gc')
const gc = vm.runInNewContext('gc') as () => void

/** 結果オブジェクトを関数スコープに閉じ込め、戻り値は要約だけにする(GC後の保持量にA0/A1結果を含めないため)。 */
function runOnce(year: number, cache: SingleA0Cache | undefined) {
  const notes: PlayProgress[] = []
  const t0 = performance.now()
  const r = runPlayComparison({ ...BASE, year }, p => notes.push(p), cache ? { cache } : {})
  const wallMs = performance.now() - t0
  return {
    ok: r.ok, wallMs: Math.round(wallMs), source: r.ok ? r.comparison.a0Source : 'ERR', digest: digest(r),
    a0Notices: notes.filter(p => p.branch === 'A0').length, a1Notices: notes.filter(p => p.branch === 'A1').length,
  }
}
longTest('A0キャッシュ: miss/hit/キャッシュ無しの時間・メモリ・結果ハッシュ', () => {
  it('実測行を出力する', () => {
    const cached = process.env.A0_BENCH_MODE === 'CACHED'
    const years = (process.env.YEARS ?? '1290').split(',').map(Number)
    const cache = cached ? new SingleA0Cache() : undefined
    const out = process.env.A0CACHE_OUT
    gc(); gc()
    const base = process.memoryUsage()
    years.forEach((year, i) => {
      const s = runOnce(year, cache)
      const peakRssMbCumulative = mb(process.resourceUsage().maxRSS * 1024)
      gc(); gc()
      const m = process.memoryUsage()
      const line = 'CHRONOFORK_A0CACHE=' + JSON.stringify({
        mode: cached ? 'CACHED' : 'NOCACHE', step: i, year, a0Source: s.source, wallMs: s.wallMs, a0Notices: s.a0Notices, a1Notices: s.a1Notices,
        peakRssMbCumulative, heapRetainedMb: mb(m.heapUsed - base.heapUsed), rssAfterGcMb: mb(m.rss), digest: s.digest,
      })
      console.info(line)
      if (out) appendFileSync(out, line + '\n')
      expect(s.ok).toBe(true)
      if (cached) expect(s.source).toBe(i === 0 ? 'COMPUTED' : 'REUSED')
      expect(s.a0Notices).toBe(s.source === 'REUSED' ? 0 : 100)
      expect(s.a1Notices).toBe(1350 - year)
    })
    if (cache) {
      // キャッシュ自体の保持量 = 全実行後の保持量 - キャッシュを破棄した後の保持量(GC後)。
      gc(); gc()
      const withCache = process.memoryUsage().heapUsed
      cache.clear(); gc(); gc()
      const after = process.memoryUsage()
      const line = 'CHRONOFORK_A0CACHE_RETAINED=' + JSON.stringify({
        cacheHeldMb: mb(withCache - after.heapUsed), heapAfterClearMb: mb(after.heapUsed - base.heapUsed), rssAfterClearMb: mb(after.rss) })
      console.info(line)
      if (out) appendFileSync(out, line + '\n')
    }
  }, 1_800_000)
})
