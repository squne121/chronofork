// @vitest-environment jsdom
// A0再利用の表示(偽の進捗を出さない)と、seed変更/新規ゲームでのrunner.reset呼び出しを検証する。
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import App from '../../../src/ui/App.tsx'
import type { PlayOutcome, PlayRunHooks, PlayRunner } from '../../../src/ui/play-runner.ts'
import type { ProgressObserver } from '../../../src/ui/play-progress.ts'

afterEach(cleanup)
function controlled() {
  const calls: { resolve: (o: PlayOutcome) => void; progress: ProgressObserver; hooks?: PlayRunHooks }[] = []
  const reset = vi.fn()
  const runner: PlayRunner = Object.assign((_i: unknown, onProgress?: ProgressObserver, hooks?: PlayRunHooks) => {
    let resolve: (o: PlayOutcome) => void = () => {}
    const promise = new Promise<PlayOutcome>((r) => { resolve = r })
    calls.push({ resolve, progress: onProgress ?? (() => {}), hooks })
    return { promise, cancel: () => resolve({ kind: 'CANCELLED' }) }
  }, { reset })
  return { runner, calls, reset }
}
const start = () => {
  const c = controlled()
  render(<App playRunner={c.runner} />)
  fireEvent.change(screen.getByTestId('play-law-mode'), { target: { value: 'INTEGRATED_EXPERIMENTAL' } })
  fireEvent.click(screen.getByTestId('branch-run'))
  return c
}

describe('A0再利用の表示', () => {
  it('再利用ではA0を「再計算していない」と表示し、年次進捗を捏造しない', () => {
    const { calls } = start()
    act(() => { calls[0]!.hooks?.onA0Reused?.() })
    const a0 = screen.getByTestId('progress-A0').textContent ?? ''
    expect(a0).toContain('再利用')
    expect(a0).toContain('再計算していません')
    expect(a0).not.toContain('年初まで計算済み')
  })

  it('キャンセルして再実行すると前回の再利用表示は消える', () => {
    const { calls } = start()
    act(() => { calls[0]!.hooks?.onA0Reused?.() })
    fireEvent.click(screen.getByTestId('branch-cancel'))
    fireEvent.click(screen.getByTestId('branch-run'))
    expect(screen.getByTestId('progress-A0').textContent).toContain('開始待ち')
    act(() => { calls[0]!.hooks?.onA0Reused?.() }) // 古いrunの通知
    expect(screen.getByTestId('progress-A0').textContent).toContain('開始待ち')
  })

  it('seed/世界の再生成(rerun)と画面破棄でrunner.resetを呼ぶ', () => {
    const { reset } = start()
    reset.mockClear()
    fireEvent.submit(screen.getByTestId('seed-input').closest('form')!)
    expect(reset).toHaveBeenCalled()
  })
})
