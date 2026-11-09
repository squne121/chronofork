// 進捗通知の有無で100年統合モードの全結果が一致すること、およびCPU・メモリ負荷の差を測るローカル専用テスト。
// 通常の quick-check には入れない明示オプトイン(各約1分):
//   CHRONOFORK_LONG_PROGRESS=1 npx vitest run tests/unit/ui/progress-overhead-long.test.ts
import { createHash } from 'node:crypto'
import { appendFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { runPlayComparison } from '../../../src/ui/branch-play-source.ts'
import type { PlayInput, PlayProgress } from '../../../src/ui/branch-play-source.ts'

const longTest = process.env.CHRONOFORK_LONG_PROGRESS === '1' ? describe : describe.skip
const INPUT: PlayInput = {
  mode: 'INTEGRATED_EXPERIMENTAL', seed: 20260101, year: 1290,
  firstPersonId: 'person-exp-02', secondPersonId: 'person-exp-05', signedDelta: -20, durationYears: 5,
}
/** 巨大JSONを一括化せず、ハッシュへ逐次投入する。 */
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
const measure = (observer?: (p: PlayProgress) => void) => {
  globalThis.gc?.()
  const cpu0 = process.cpuUsage()
  const t0 = performance.now()
  const r = runPlayComparison(INPUT, observer)
  const wallMs = performance.now() - t0
  const cpu = process.cpuUsage(cpu0)
  return { r, wallMs, cpuMs: (cpu.user + cpu.system) / 1000, rssMb: process.memoryUsage().rss / 1048576 }
}

// 1プロセス1実行(結果を2回分保持するとOOMするため)。MODE=PLAIN|OBSERVED を環境変数で渡し、2回起動して比較する:
//   for m in PLAIN OBSERVED; do CHRONOFORK_LONG_PROGRESS=1 PROGRESS_MODE=$m node --expose-gc --max-old-space-size=12288 \
//     node_modules/vitest/vitest.mjs run tests/unit/ui/progress-overhead-long.test.ts; done
longTest('進捗通知の有無で100年統合モードの結果ハッシュと負荷を測る', () => {
  it('結果ハッシュ・通知数・CPU/メモリを出力する', () => {
    const observed = process.env.PROGRESS_MODE === 'OBSERVED'
    let a0 = 0, a1 = 0, lastA0 = 0, lastA1 = 0, monotonic = true
    const m = measure(observed ? (p) => {
      if (p.branch === 'A0') { a0++; monotonic &&= p.confirmedYear === 1250 + a0; lastA0 = p.confirmedYear } else { a1++; monotonic &&= p.confirmedYear === 1290 + a1; lastA1 = p.confirmedYear }
    } : undefined)
    const line = 'CHRONOFORK_PROGRESS_OVERHEAD=' + JSON.stringify({
      mode: observed ? 'OBSERVED' : 'PLAIN', wallMs: Math.round(m.wallMs), cpuMs: Math.round(m.cpuMs), rssMb: Math.round(m.rssMb),
      peakRssMb: Math.round(process.resourceUsage().maxRSS / 1024), ok: m.r.ok, digest: digest(m.r), a0, a1, lastA0, lastA1, monotonic,
    })
    console.info(line)
    if (process.env.PROGRESS_OUT) appendFileSync(process.env.PROGRESS_OUT, line + '\n')
    expect(m.r.ok).toBe(true)
    if (observed) { expect(a0).toBe(100); expect(a1).toBe(60); expect(monotonic).toBe(true); expect([lastA0, lastA1]).toEqual([1350, 1350]) }
  }, 900_000)
})
