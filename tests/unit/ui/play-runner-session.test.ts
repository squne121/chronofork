// workerPlayRunner のWorker寿命管理(偽Worker): 成功では保持、キャンセル/障害/reset/無操作で破棄。
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { PlayInput } from '../../../src/ui/branch-play-source.ts'
import { createWorkerPlayRunner } from '../../../src/ui/play-runner.ts'
import type { WorkerLike } from '../../../src/ui/play-runner.ts'

class FakeWorker implements WorkerLike {
  onmessage: WorkerLike['onmessage'] = null
  onerror: WorkerLike['onerror'] = null
  onmessageerror: WorkerLike['onmessageerror'] = null
  terminated = false
  posted: unknown[] = []
  postMessage(m: unknown) { this.posted.push(m) }
  terminate() { this.terminated = true }
  emit(data: unknown) { this.onmessage?.({ data } as never) }
}
const INPUT: PlayInput = { mode: 'INTEGRATED_EXPERIMENTAL', seed: 1, year: 1250, firstPersonId: 'a', secondPersonId: 'b', signedDelta: -20, durationYears: 5 }
const DONE = { ok: false, code: 'A1_HALTED', message: 'x', computeMs: 1 }
let workers: FakeWorker[]
const make = (idleMs = 60_000) => createWorkerPlayRunner({ createWorker: () => { const w = new FakeWorker(); workers.push(w); return w }, idleMs })
beforeEach(() => { workers = []; vi.useFakeTimers() })
afterEach(() => vi.useRealTimers())

describe('Worker寿命管理', () => {
  it('DONEではWorkerを保持して次の実行で再利用し、A0_REUSEDをフックへ中継する', async () => {
    const run = make()
    const h1 = run(INPUT)
    workers[0]!.emit({ ok: true, view: {}, computeMs: 5, viewMs: 1 })
    expect((await h1.promise).kind).toBe('DONE')
    expect(workers[0]!.terminated).toBe(false)
    let reused = 0
    const h2 = run({ ...INPUT, year: 1290 }, undefined, { onA0Reused: () => reused++ })
    expect(workers).toHaveLength(1)
    workers[0]!.emit({ kind: 'A0_REUSED' })
    workers[0]!.emit(DONE)
    expect((await h2.promise).kind).toBe('DONE')
    expect(reused).toBe(1)
  })

  it('計算上の失敗(HALTED等のDONE ok:false)ではWorkerを保持するが、障害/キャンセルでは破棄する', async () => {
    const run = make()
    const h1 = run(INPUT); workers[0]!.emit(DONE); await h1.promise
    expect(workers[0]!.terminated).toBe(false)
    const h2 = run(INPUT); h2.cancel()
    expect((await h2.promise).kind).toBe('CANCELLED')
    expect(workers[0]!.terminated).toBe(true)
    const h3 = run(INPUT) // 新しいWorker=A0なし
    expect(workers).toHaveLength(2)
    workers[1]!.onerror?.({ message: 'boom' })
    expect((await h3.promise).kind).toBe('FAILED')
    expect(workers[1]!.terminated).toBe(true)
    const h4 = run(INPUT)
    expect(workers).toHaveLength(3)
    workers[2]!.onmessageerror?.()
    expect((await h4.promise).kind).toBe('FAILED')
    expect(workers[2]!.terminated).toBe(true)
  })

  it('キャンセル後の古いメッセージは新しい実行に混ざらない', async () => {
    const run = make()
    const h1 = run(INPUT); const old = workers[0]!
    h1.cancel(); await h1.promise
    const h2 = run(INPUT); const cur = workers[1]!
    old.emit({ ok: false, code: 'STALE', message: 's', computeMs: 1 })
    cur.emit(DONE)
    const o = await h2.promise
    expect(o.kind === 'DONE' && !o.result.ok && o.result.code).toBe('A1_HALTED')
  })

  it('reset()・無操作タイムアウトでA0ごとWorkerを破棄する。実行中のresetはキャンセル', async () => {
    const run = make(1000)
    const h1 = run(INPUT); workers[0]!.emit(DONE); await h1.promise
    run.reset?.()
    expect(workers[0]!.terminated).toBe(true)
    const h2 = run(INPUT); workers[1]!.emit(DONE); await h2.promise
    vi.advanceTimersByTime(999); expect(workers[1]!.terminated).toBe(false)
    vi.advanceTimersByTime(2); expect(workers[1]!.terminated).toBe(true)
    const h3 = run(INPUT); expect(workers).toHaveLength(3)
    run.reset?.()
    expect((await h3.promise).kind).toBe('CANCELLED')
    expect(workers[2]!.terminated).toBe(true)
  })

  it('実行中の二重起動は実行中のWorkerに触れず拒否する', async () => {
    const run = make()
    const h1 = run(INPUT)
    const h2 = run(INPUT)
    const o2 = await h2.promise
    expect(o2.kind === 'FAILED' && o2.code).toBe('RUN_IN_PROGRESS')
    expect(workers[0]!.terminated).toBe(false)
    workers[0]!.emit(DONE)
    expect((await h1.promise).kind).toBe('DONE')
  })
})
