// @vitest-environment jsdom
// 統合モードの確定済み年次進捗表示。runner を差し替え、通知・キャンセル・HALTED・古い通知の無視を検証する。
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it , beforeEach} from 'vitest'
import App from '../../../src/ui/App.tsx'
import type { PlayOutcome, PlayRunner } from '../../../src/ui/play-runner.ts'
import type { PlayProgress, ProgressObserver } from '../../../src/ui/play-progress.ts'


beforeEach(()=>window.history.replaceState({},'', '/?entry=legacy'))
afterEach(cleanup)
type Call = { resolve: (o: PlayOutcome) => void; progress: ProgressObserver }
function controlled() {
  const calls: Call[] = []
  const runner: PlayRunner = (_input, onProgress) => {
    let resolve: (o: PlayOutcome) => void = () => {}
    const promise = new Promise<PlayOutcome>((r) => { resolve = r })
    calls.push({ resolve, progress: onProgress ?? (() => {}) })
    return { promise, cancel: () => resolve({ kind: 'CANCELLED' }) }
  }
  return { runner, calls }
}
const p = (branch: 'A0' | 'A1', startYear: number, done: number, events = 0): PlayProgress => ({
  branch, startYear, goalYear: 1350, confirmedYear: startYear + done, transitionsDone: done, transitionsTotal: 1350 - startYear, eventCount: events,
})
const start = () => {
  const c = controlled()
  render(<App playRunner={c.runner} />)
  fireEvent.change(screen.getByTestId('play-law-mode'), { target: { value: 'INTEGRATED_EXPERIMENTAL' } })
  fireEvent.click(screen.getByTestId('branch-run'))
  return c
}

describe('確定済み年次進捗の表示', () => {
  it('A0とA1を別行で、計算済み年・区間・件数のみ表示し、%・残り時間・結果断定を出さない', () => {
    const { calls } = start()
    act(() => { calls[0]!.progress(p('A0', 1250, 40, 12)) })
    const box = screen.getByTestId('branch-progress')
    expect(screen.getByTestId('progress-A0').textContent).toContain('1290年初まで計算済み')
    expect(screen.getByTestId('progress-A0').textContent).toContain('40/100')
    expect(screen.getByTestId('progress-A1').textContent).toContain('開始待ち')
    expect(box.textContent).toContain('途中経過（未確定）')
    act(() => { calls[0]!.progress(p('A0', 1250, 100, 50)); calls[0]!.progress(p('A1', 1290, 10, 3)) })
    expect(screen.getByTestId('progress-A1').textContent).toContain('1290年→1350年')
    expect(screen.getByTestId('progress-A1').textContent).toContain('10/60')
    expect(screen.getByTestId('branch-progress').textContent).not.toMatch(/%|残り|勝利|成功/)
  })

  it('キャンセル後は古い通知で表示を更新せず、キャンセルと明記する', () => {
    const { calls } = start()
    act(() => { calls[0]!.progress(p('A0', 1250, 10)) })
    fireEvent.click(screen.getByTestId('branch-cancel'))
    act(() => { calls[0]!.progress(p('A0', 1250, 90)) })
    expect(screen.getByTestId('progress-A0').textContent).toContain('1260年初')
    expect(screen.getByTestId('branch-progress').textContent).toContain('キャンセルされました')
    expect(screen.queryByTestId('branch-running')).toBeNull()
  })

  it('HALTED は途中経過を結果とせず、停止として区別する', async () => {
    const { calls } = start()
    act(() => { calls[0]!.progress(p('A0', 1250, 30)) })
    await act(async () => { calls[0]!.resolve({ kind: 'DONE', computeMs: 1, result: { ok: false, code: 'A0_HALTED', message: '{}' } }) })
    expect(screen.getByTestId('branch-progress').textContent).toContain('HALTED')
    expect(screen.getByTestId('branch-progress').textContent).toContain('未確定')
    expect(screen.getByTestId('branch-error')).toBeTruthy()
  })

  it('Workerの失敗は FAILED として区別する', async () => {
    const { calls } = start()
    act(() => { calls[0]!.progress(p('A0', 1250, 5)) })
    await act(async () => { calls[0]!.resolve({ kind: 'FAILED', code: 'WORKER_ERROR', message: 'x' }) })
    expect(screen.getByTestId('branch-progress').textContent).toContain('失敗')
  })

  it('再実行で前回の進捗は消え、新しいrunの通知だけを表示する', () => {
    const { calls } = start()
    act(() => { calls[0]!.progress(p('A0', 1250, 80)) })
    fireEvent.click(screen.getByTestId('branch-cancel'))
    fireEvent.click(screen.getByTestId('branch-run'))
    expect(screen.getByTestId('progress-A0').textContent).toContain('開始待ち')
    act(() => { calls[0]!.progress(p('A0', 1250, 99)) }) // 古いrun
    expect(screen.getByTestId('progress-A0').textContent).toContain('開始待ち')
    act(() => { calls[1]!.progress(p('A0', 1250, 2)) })
    expect(screen.getByTestId('progress-A0').textContent).toContain('1252年初')
  })
})
