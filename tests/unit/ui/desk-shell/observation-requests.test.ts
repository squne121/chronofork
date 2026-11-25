import { expect, it, vi } from 'vitest'
import { createExperimentalIntegratedWorld } from '../../../../src/scenario/experimental/index.ts'
import { playConfigDigest, playConfigId } from '../../../../src/ui/branch-play-source.ts'
import type { ObservationInput, ObservationSlice } from '../../../../src/ui/branch-play-source.ts'
import { createObservationRequests } from '../../../../src/ui/desk/timeline/observation-requests.ts'
import { extractCandidates } from '../../../../src/ui/play-candidates.ts'
import type { ProgressObserver } from '../../../../src/ui/play-progress.ts'
import type { ObservationOutcome } from '../../../../src/ui/play-runner.ts'

const mode = 'INTEGRATED_EXPERIMENTAL'
const world = createExperimentalIntegratedWorld()
function harness() {
  const requests = createObservationRequests()
  const calls: Array<{ input: ObservationInput; finish: (outcome: ObservationOutcome) => void; progress?: ProgressObserver; cancel: () => void }> = []
  const observe = (input: ObservationInput, progress?: ProgressObserver) => {
    let resolve!: (outcome: ObservationOutcome) => void
    const promise = new Promise<ObservationOutcome>(done => { resolve = done })
    const cancel = vi.fn()
    calls.push({ input, finish: resolve, progress, cancel })
    return { promise, cancel }
  }
  const progress = vi.fn()
  const success = vi.fn()
  const failure = vi.fn()
  const load = (year: number, playback = false) => requests.request({
    input: { seed: 7, mode, year }, playback, observe, progress, success, failure,
  })
  const finish = async (n: number, fields: Partial<ObservationSlice> = {}) => {
    const call = calls[n]!
    const { seed, year } = call.input
    // Worker の入出力契約だけを検査する fixture。実計算の結果ではない。
    call.finish({ kind: 'DONE', computeMs: 5, result: { ok: true, observation: {
      seed, year, mode, world: { ...world, year }, configId: playConfigId(mode), configDigest: playConfigDigest(mode),
      events: [], traces: [], counts: [], goal: null, technicalGoal: null, status: 'COMPLETED', a0Source: 'REUSED',
      candidates: extractCandidates(seed, mode, [world]), personRecords: [], titleHistories: [], titleLossRecords: [], knownA0Ending: null,
      ...fields,
    } } })
    await vi.waitFor(() => expect(requests.busy).toBe(calls.length > n + 1))
  }
  const notify = (n: number) => calls[n]!.progress?.({
    branch: 'A0', startYear: 1250, goalYear: 1350, confirmedYear: 1251, transitionsDone: 1, transitionsTotal: 100, eventCount: 0,
  })
  return { requests, calls, load, finish, notify, progress, success, failure }
}

it('年を元に戻した場合も旧世代の結果と進捗を捨て、最新年だけを直列送信する', async () => {
  const h = harness()
  h.load(1251)
  h.load(1290)
  h.load(1251)
  expect(h.calls.map(c => c.input.year)).toEqual([1251])
  h.notify(0)
  expect(h.progress).not.toHaveBeenCalled()
  await h.finish(0)
  expect(h.success).not.toHaveBeenCalled()
  expect(h.failure).not.toHaveBeenCalled()
  expect(h.calls.map(c => c.input.year)).toEqual([1251, 1251])
  h.notify(1)
  expect(h.progress).toHaveBeenCalledTimes(1)
  await h.finish(1)
  expect(h.success).toHaveBeenCalledWith(expect.objectContaining({ year: 1251, a0Source: 'REUSED' }), 5, expect.any(Number))
  h.notify(1)
  expect(h.progress).toHaveBeenCalledTimes(1)
})

it('停止では再生中の応答を捨てるが Worker をキャンセルせず、手動の年移動を継続できる', async () => {
  const h = harness()
  h.load(1251, true)
  expect(h.requests.pause()).toBe(true)
  h.notify(0)
  h.load(1275)
  expect(h.requests.pause()).toBe(false)
  await h.finish(0)
  expect(h.calls[0]!.cancel).not.toHaveBeenCalled()
  expect(h.progress).not.toHaveBeenCalled()
  expect(h.success).not.toHaveBeenCalled()
  await h.finish(1)
  expect(h.success).toHaveBeenCalledWith(expect.objectContaining({ year: 1275 }), 5, expect.any(Number))
})

it('構成が異なる応答や WorldState の年が異なる応答は採用しない', async () => {
  const h = harness()
  h.load(1251)
  await h.finish(0, { world })
  h.load(1251)
  await h.finish(1, { configId: '別構成' })
  expect(h.success).not.toHaveBeenCalled()
  expect(h.failure).toHaveBeenCalledTimes(2)
  expect(h.failure).toHaveBeenLastCalledWith(expect.objectContaining({ code: 'OBSERVATION_IDENTITY_MISMATCH' }))
})
