// @vitest-environment jsdom
// 通常入口は原史A0観測。旧C004試験は ?entry=legacy または明示的に開いたときだけ計算・表示する。
import {cleanup,fireEvent,render,screen} from '@testing-library/react'
import {afterEach,expect,it,vi} from 'vitest'
import App from '../../../src/ui/App.tsx'
import * as timeline from '../../../src/ui/timeline-source.ts'

afterEach(()=>{cleanup();vi.restoreAllMocks()})

it('通常入口では旧C004試験計算を実行せず、原史A0の観測入口を表示する',()=>{
  window.history.replaceState({},'','/')
  const spy=vi.spyOn(timeline,'runExperimentalTimeline')
  render(<App/>)
  expect(spy).not.toHaveBeenCalled()
  expect(screen.getByTestId('obs-start')).toBeTruthy()
  expect((screen.getByTestId('legacy-workspace') as HTMLDetailsElement).open).toBe(false)
  expect(screen.getByTestId('history-status').textContent).toContain('原史A0')
})

it('旧試験を明示的に開くと、そのとき初めて旧試験計算を行う',()=>{
  window.history.replaceState({},'','/')
  const spy=vi.spyOn(timeline,'runExperimentalTimeline')
  render(<App/>)
  const d=screen.getByTestId('legacy-workspace') as HTMLDetailsElement
  d.open=true
  fireEvent(d,new Event('toggle'))
  expect(spy).toHaveBeenCalled()
})

it('?entry=legacy では旧試験が開いた状態で計算される',()=>{
  window.history.replaceState({},'','/?entry=legacy')
  const spy=vi.spyOn(timeline,'runExperimentalTimeline')
  render(<App/>)
  expect(spy).toHaveBeenCalled()
  expect((screen.getByTestId('legacy-workspace') as HTMLDetailsElement).open).toBe(true)
})
