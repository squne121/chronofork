// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import App from '../../../src/ui/App.tsx'
import { loadExperimentalSource } from '../../../src/ui/inspection-source.ts'

afterEach(cleanup)

describe('App', () => {
  it('experimental・未計算を明示し、架空の結果を表示しない', () => {
    render(<App />)
    expect(screen.getByTestId('experimental-banner').textContent).toBe('experimental / 仮データ / 歴史計算未接続')
    expect(screen.getByTestId('current-year').textContent).toContain('1250年')
    expect(screen.getByTestId('goal-status').textContent).toContain('未計算')
    expect(screen.getByTestId('chronicle-status').textContent).toContain('未接続')
    const text = document.body.textContent ?? ''
    expect(text).not.toMatch(/勝利|敗北|達成/)
    expect(text).not.toContain('参照不明')
  })

  it('機能するふりをする介入・比較ボタンを置かない', () => {
    render(<App />)
    const names = screen.getAllByRole('button').map((b) => b.textContent ?? '')
    expect(names.some((n) => /介入|比較|実行|適用|進める/.test(n))).toBe(false)
    expect((screen.getByRole('slider') as HTMLInputElement).disabled).toBe(true)
  })

  it('6地域を表示し、選択すると詳細が切り替わる', () => {
    render(<App />)
    const map = screen.getByTestId('region-map')
    expect(within(map).getAllByRole('button')).toHaveLength(6)
    fireEvent.click(screen.getByTestId('region-node-region-eldia-west'))
    const detail = screen.getByTestId('detail')
    expect(within(detail).getByRole('heading', { name: 'エルディア西部' })).toBeTruthy()
    expect(screen.getByTestId('region-node-region-eldia-west').getAttribute('aria-pressed')).toBe('true')
    fireEvent.click(screen.getByTestId('region-node-region-versa-coast'))
    expect(within(screen.getByTestId('detail')).getByRole('heading', { name: 'ヴェルサ沿岸' })).toBeTruthy()
  })

  it('リンクで地域→人口集団→地域と遷移できる', () => {
    render(<App />)
    fireEvent.click(screen.getByTestId('region-node-region-eldia-central'))
    fireEvent.click(within(screen.getByTestId('detail')).getByRole('button', { name: '中央・一般住民' }))
    expect(screen.getByRole('tab', { name: '人口集団' }).getAttribute('aria-selected')).toBe('true')
    expect(within(screen.getByTestId('detail')).getByText('家門支持')).toBeTruthy()
    fireEvent.click(within(screen.getByTestId('detail')).getByRole('button', { name: 'エルディア中央' }))
    expect(screen.getByRole('tab', { name: '地域' }).getAttribute('aria-selected')).toBe('true')
  })

  it('人物と称号を選択でき、称号から保有者へ遷移できる', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('tab', { name: '称号' }))
    fireEvent.click(screen.getByTestId('item-title-title-exp-west'))
    const detail = screen.getByTestId('detail')
    expect(within(detail).getByText('領地称号')).toBeTruthy()
    fireEvent.click(within(detail).getByRole('button', { name: /試験人物04/ }))
    expect(screen.getByRole('tab', { name: '人物' }).getAttribute('aria-selected')).toBe('true')
    expect(within(screen.getByTestId('detail')).getByRole('heading', { name: /試験人物04/ })).toBeTruthy()
  })

  it('矢印キーでタブを切り替えられる', () => {
    render(<App />)
    const first = screen.getByRole('tab', { name: '地域' })
    first.focus()
    fireEvent.keyDown(first, { key: 'ArrowRight' })
    expect(screen.getByRole('tab', { name: '人口集団' }).getAttribute('aria-selected')).toBe('true')
    fireEvent.keyDown(screen.getByRole('tab', { name: '人口集団' }), { key: 'End' })
    expect(screen.getByRole('tab', { name: '称号' }).getAttribute('aria-selected')).toBe('true')
  })

  it('将来接続: 与えられた EventLog / Goal は読み取り表示される', () => {
    const base = loadExperimentalSource()
    render(
      <App
        source={{
          ...base,
          goal: { status: 'NOT_EVALUABLE', year: 1250 },
          events: [
            {
              eventId: 'evt-test',
              semanticEventKey: 'k',
              year: 1250,
              phase: 1,
              eventType: 'TEST_EVENT',
              involvedRefs: [],
              stateChanges: [],
              sourceTraceIds: [],
            },
          ],
        }}
      />,
    )
    expect(screen.getByTestId('goal-status').textContent).toBe('1250年は判定対象外')
    expect(screen.getByTestId('chronicle-list').textContent).toContain('TEST_EVENT')
  })
})
