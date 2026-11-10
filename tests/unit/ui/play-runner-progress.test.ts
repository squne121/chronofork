// workerPlayRunner の進捗中継(偽Worker)と、runPlayComparison の進捗有無での結果一致(軽量モード)。
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runPlayComparison } from '../../../src/ui/branch-play-source.ts'
import type { PlayInput } from '../../../src/ui/branch-play-source.ts'
import type { PlayProgress } from '../../../src/ui/play-progress.ts'
import { workerPlayRunner } from '../../../src/ui/play-runner.ts'

const prog = (n: number): PlayProgress => ({ branch: 'A0', startYear: 1250, goalYear: 1350, confirmedYear: 1250 + n, transitionsDone: n, transitionsTotal: 100, eventCount: 0 })
class FakeWorker {
  static last: FakeWorker
  onmessage: ((e: { data: unknown }) => void) | null = null
  onerror: ((e: { message: string }) => void) | null = null
  onmessageerror: (() => void) | null = null
  terminated = false
  constructor() { FakeWorker.last = this }
  postMessage() {}
  terminate() { this.terminated = true }
  emit(data: unknown) { this.onmessage?.({ data }) }
}
afterEach(() => vi.unstubAllGlobals())
const INPUT: PlayInput = { mode: 'INTEGRATED_EXPERIMENTAL', seed: 1, year: 1250, firstPersonId: 'a', secondPersonId: 'b', signedDelta: -20, durationYears: 5 }

describe('workerPlayRunner の進捗中継', () => {
  it('完了前のPROGRESSだけを中継し、DONE後・キャンセル後の通知は無視してWorkerを終了する', async () => {
    vi.stubGlobal('Worker', FakeWorker)
    const seen: number[] = []
    const h = workerPlayRunner(INPUT, (p) => seen.push(p.transitionsDone))
    const w = FakeWorker.last
    w.emit({ kind: 'PROGRESS', progress: prog(1) })
    w.emit({ kind: 'PROGRESS', progress: prog(2) })
    w.emit({ ok: false, code: 'A0_HALTED', message: 'x', computeMs: 1 })
    w.emit({ kind: 'PROGRESS', progress: prog(3) })
    expect((await h.promise).kind).toBe('DONE')
    expect(seen).toEqual([1, 2])
    expect(w.terminated).toBe(true)

    const h2 = workerPlayRunner(INPUT, (p) => seen.push(p.transitionsDone + 10))
    const w2 = FakeWorker.last
    w2.emit({ kind: 'PROGRESS', progress: prog(1) })
    h2.cancel()
    w2.emit({ kind: 'PROGRESS', progress: prog(2) })
    expect((await h2.promise).kind).toBe('CANCELLED')
    expect(seen).toEqual([1, 2, 11])
  })
})

describe('runPlayComparison: 進捗観測の有無で結果が一致する(軽量・通常法制)', () => {
  const input: PlayInput = { mode: 'ORDINARY_LAW', seed: 20260101, year: 1290, firstPersonId: 'person-exp-04', secondPersonId: 'person-exp-05', signedDelta: 20, durationYears: 5 }
  it('WorldState・EventLog・DecisionTrace・Goalが一致し、A0 100件/A1 60件の確定済み通知のみ', () => {
    const notes: PlayProgress[] = []
    const plain = runPlayComparison(input)
    const observed = runPlayComparison(input, (p) => notes.push(p))
    expect(plain.ok && observed.ok).toBe(true)
    if (!plain.ok || !observed.ok) return
    for (const k of ['a0', 'a1'] as const) {
      const a = plain.comparison[k].result, b = observed.comparison[k].result
      expect(b.snapshots).toEqual(a.snapshots)
      expect(b.eventLog).toEqual(a.eventLog)
      expect(b.decisionTraces).toEqual(a.decisionTraces)
      expect([b.status, b.halt, b.goal, b.technicalGoal]).toEqual([a.status, a.halt, a.goal, a.technicalGoal])
    }
    expect(notes.filter((p) => p.branch === 'A0')).toHaveLength(100)
    expect(notes.filter((p) => p.branch === 'A1')).toHaveLength(60)
    expect(notes.at(-1)!.confirmedYear).toBe(1350)
  })
})
