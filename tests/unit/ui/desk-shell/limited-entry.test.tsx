// @vitest-environment jsdom
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import App from '../../../../src/ui/App.tsx'
import type { PlayOutcome } from '../../../../src/ui/play-runner.ts'
import type { WorkerRequest, WorkerResponse } from '../../../../src/ui/play-worker.ts'

const workers: PendingWorker[] = []
class PendingWorker {
  onmessage: ((event: MessageEvent<WorkerResponse>) => void) | null = null
  postMessage = vi.fn<(request: WorkerRequest) => void>()
  terminate = vi.fn()
  constructor() { workers.push(this) }
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
  workers.length = 0
})

it('限定入口・再開始・退出で別 Worker を使い、旧世代の応答を表示しない', async () => {
  window.history.replaceState({}, '', '/')
  vi.stubGlobal('Worker', PendingWorker)
  const observeNormal = vi.fn()
  const resetNormal = vi.fn()
  const playRunner = Object.assign(() => ({ promise: new Promise<PlayOutcome>(() => {}), cancel: vi.fn() }),
    { observe: observeNormal, reset: resetNormal })
  render(<App playRunner={playRunner} />)
  const click = (name: string) => fireEvent.click(screen.getByRole('button', { name }))
  click('限定試遊を開始')
  expect(resetNormal).toHaveBeenCalledTimes(1)
  expect(workers).toHaveLength(0)
  fireEvent.click(screen.getByTestId('obs-start'))
  const request = { observe: { mode: 'MULTI_HOUSE_EXPERIMENTAL', configuration: 'LIMITED_PLAYTEST', seed: 20260303, year: 1250 } }
  expect(workers[0]?.postMessage).toHaveBeenCalledWith(request)
  const late = workers[0]?.onmessage
  expect(late).toBeTypeOf('function')
  click('限定試遊を最初からやり直す')
  expect(workers[0]?.terminate).toHaveBeenCalledTimes(1)
  expect(screen.queryByTestId('obs-loading')).toBeNull()
  fireEvent.click(screen.getByTestId('obs-start'))
  expect(workers[1]?.postMessage).toHaveBeenCalledWith(request)
  await act(() => late?.(new MessageEvent('message', { data: { ok: false, code: 'OLD', message: '旧要求の応答', computeMs: 0 } })))
  expect(screen.queryByTestId('obs-error')).toBeNull()
  expect(screen.getByTestId('obs-loading')).toBeTruthy()
  click('限定試遊を退出して通常入口へ')
  expect(workers[1]?.terminate).toHaveBeenCalledTimes(1)
  expect(observeNormal).not.toHaveBeenCalled()
  expect(resetNormal).toHaveBeenCalledTimes(1)
  expect(screen.getByTestId('obs-seed-input')).toHaveProperty('value', '20260101')
  expect(screen.getByTestId('obs-intro')).toBeTruthy()
})
