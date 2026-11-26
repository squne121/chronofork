import type { ObservationInput, ObservationSlice } from '../../branch-play-source.ts'
import { candidateSetMatches } from '../../play-candidates.ts'
import type { PlayProgress } from '../../play-progress.ts'
import type { ObservationHandle, PlayRunner } from '../../play-runner.ts'
import type { HistoryYearRef } from '../data/history.ts'
import { historyFromObservation, matchesObservation, sameHistoryYearRef } from '../data/history.ts'
import { createLatestHistoryRequest } from '../data/latest-request.ts'

export type ObservationError = Readonly<{ code: string; message: string }>
type Request = Readonly<{
  input: ObservationInput
  expectedRef?: HistoryYearRef
  playback: boolean
  document?: true
  observe: NonNullable<PlayRunner['observe']>
  progress: (progress: PlayProgress) => void
  success: (slice: ObservationSlice, computeMs: number, wallMs: number) => void
  failure: (error: ObservationError) => void
}>

/** 一つの Worker に直列発行し、待機中は最後の要求だけを残す。 */
export function createObservationRequests(onIdle?: () => void) {
  const gate = createLatestHistoryRequest()
  let latest: Request | undefined
  let queued: Readonly<{ request: Request; ticket: ReturnType<typeof gate.begin> }> | undefined
  let active: Readonly<{ handle: ObservationHandle }> | undefined

  const drain = () => {
    if (active) return
    if (!queued) { onIdle?.(); return }
    const { request, ticket } = queued
    queued = undefined
    const { input, observe, progress, success, failure } = request
    const fail = (code: string, message: string) => {
      if (!ticket.isCurrent()) return
      gate.invalidate()
      latest = undefined
      failure({ code, message })
    }
    const started = performance.now()
    let handle: ObservationHandle
    try {
      handle = observe(input, value => {
        if (ticket.isCurrent() && value.branch === 'A0') progress(value)
      })
    } catch (error) {
      fail('WORKER_START_FAILED', String(error))
      onIdle?.()
      return
    }
    const running = { handle }
    active = running
    void handle.promise.then(outcome => {
      if (!ticket.isCurrent()) return
      if (outcome.kind === 'CANCELLED') return fail('CANCELLED', '計算を中断しました')
      if (outcome.kind === 'FAILED') return fail(outcome.code, outcome.message)
      if (!outcome.result.ok) return fail(outcome.result.code, outcome.result.message)
      const adopted = ticket.commit(outcome.result.observation,
        slice => matchesObservation(input, slice) && candidateSetMatches(slice.candidates, input.seed, input.mode, input.configuration)
          && (slice.branchId === undefined || slice.branchId === 'A0-play') && (slice.playLedger?.length ?? 0) === 0
          && (!request.expectedRef || sameHistoryYearRef(request.expectedRef, historyFromObservation(slice).at(slice.year).ref)),
        slice => {
          latest = undefined
          success(slice, outcome.computeMs, performance.now() - started)
        })
      if (!adopted) fail('OBSERVATION_IDENTITY_MISMATCH', '要求したseed・年・実行構成と観測結果が一致しません')
    }, error => fail('WORKER_ERROR', String(error))).finally(() => {
      if (active !== running) return
      active = undefined
      drain()
    })
  }
  const discard = () => {
    const discarded = latest
    gate.invalidate()
    queued = undefined
    latest = undefined
    if (discarded?.document) discarded.failure({ code: 'DOCUMENT_SUPERSEDED', message: '別の要求を優先しました。資料を取得し直せます。' })
  }
  return {
    get busy() { return active !== undefined },
    request(request: Request) {
      if (latest?.document) discard()
      latest = request
      queued = { request, ticket: gate.begin() }
      drain()
    },
    discardDocument() {
      if (latest?.document) discard()
    },
    pause() {
      if (!latest?.playback) return false
      discard() // 表示への採用だけ止め、計算済み原史は Worker に残す。
      return true
    },
    cancel() {
      discard()
      const running = active
      active = undefined
      running?.handle.cancel()
    },
  }
}
