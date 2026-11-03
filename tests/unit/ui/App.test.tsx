// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { createExperimentalScenario } from '../../../src/scenario/experimental/index.ts'
import { runTimeline } from '../../../src/simulation/engine/index.ts'
import { createCalibrationEvaluators } from '../../../src/simulation/rules/c/index.ts'
import { EXPERIMENTAL_TUNING } from '../../../src/simulation/tuning.ts'
import type { TuningConfig } from '../../../src/simulation/tuning.ts'
import App from '../../../src/ui/App.tsx'
import { runExperimentalTimeline } from '../../../src/ui/timeline-source.ts'
import type { TimelineRun } from '../../../src/ui/timeline-source.ts'

const BAD_TUNING: TuningConfig = { ...EXPERIMENTAL_TUNING, birthRatePermille: { value: -1, origin: 'PLACEHOLDER', note: '不正' } }
function haltedRun(): TimelineRun {
  const sc = createExperimentalScenario()
  const result = runTimeline(sc.world, { seed: 3, evaluators: createCalibrationEvaluators(BAD_TUNING) })
  return { inputs: { seed: 3, scenarioId: sc.id, rulesetVersion: 'bad', rngVersion: result.rngVersion, evaluatedRuleIds: ['RULE-C-004'] }, result, initialWorld: sc.world }
}
const setYear = (y: number) => fireEvent.change(screen.getByRole('slider'), { target: { value: String(y) } })
const groupPop = (id: string) => {
  fireEvent.click(screen.getByRole('tab', { name: '人口集団' }))
  fireEvent.click(screen.getByTestId(`item-group-${id}`))
  return within(screen.getByTestId('detail')).getByText('人口').nextElementSibling?.textContent
}

afterEach(cleanup)

describe('App', () => {
  it('experimental・partial・正式な勝敗未成立・37件TODOを明示する', () => {
    render(<App />)
    expect(screen.getByTestId('experimental-banner').textContent).toContain('試験計算')
    expect(screen.getByTestId('current-year').textContent).toContain('1250年')
    expect(screen.getByTestId('goal-status').textContent).toContain('未成立')
    expect(screen.getByTestId('autonomous-history').textContent).toContain('NOT_ESTABLISHED')
    expect(screen.getByTestId('todo-rules').textContent).toContain('TODO 37件')
    expect(screen.getByTestId('run-inputs').textContent).toMatch(/seed 1 .*experimental-0/)
    const text = document.body.textContent ?? ''
    expect(text).not.toMatch(/勝利|敗北|達成/)
    expect(text).not.toContain('参照不明')
  })

  it('介入・比較の実操作を公開し、保存・正式法制は未実装のままと示す', () => {
    render(<App />)
    expect(screen.getByTestId('branch-run')).toBeTruthy()
    expect(screen.queryByTestId('branch-results')).toBeNull()
    expect(screen.getByTestId('reserved-areas').textContent).toContain('試験版で接続済み')
    expect(screen.getByTestId('reserved-areas').textContent).toContain('未実装')
  })

  it('年スライダーで 1250→1251→1350 を選べ、人口が実際に変化する', () => {
    render(<App />)
    const slider = screen.getByRole('slider') as HTMLInputElement
    expect(slider.disabled).toBe(false)
    expect(slider.max).toBe('1350')
    const g = 'group-west-commons'
    const p1250 = groupPop(g)
    setYear(1251)
    expect(screen.getByTestId('current-year').textContent).toContain('1251年')
    const p1251 = groupPop(g)
    setYear(1350)
    const p1350 = groupPop(g)
    expect(p1250).not.toBe(p1251)
    expect(p1251).not.toBe(p1350)
    expect(screen.getByTestId('chronicle-status').textContent).toContain('該当する実計算済みの事件はありません')
  })

  it('EventLog の人口差分が次年初の人口と一致し、Event→Trace→Event を辿れる', () => {
    const run = runExperimentalTimeline(1)
    render(<App run={run} />)
    const e = run.result.eventLog.find((x) => x.year === 1250 && x.involvedRefs.some((r) => 'id' in r && r.id === 'group-west-commons'))!
    const pc = e.stateChanges.find((c) => c.path.endsWith('population'))!
    fireEvent.click(screen.getByTestId(`event-${e.eventId}`))
    const detail = screen.getByTestId('event-detail')
    expect(detail.textContent).toContain(String(pc.before))
    expect(detail.textContent).toContain(String(pc.after))
    expect(screen.getByTestId('event-backlink').textContent).toContain('一致（')
    const w1251 = run.result.snapshots[1]!.groups.find((x) => x.groupId === 'group-west-commons')!
    expect(w1251.population).toBe(pc.after)
    fireEvent.click(within(detail).getByRole('button', { name: /判断根拠を開く/ }))
    const trace = screen.getByTestId('trace-detail')
    expect(trace.textContent).toContain('RULE-C-004')
    expect(trace.textContent).toContain('CALIBRATION_ONLY')
    expect(screen.getByTestId('trace-forwardlink').textContent).toContain('一致（')
    fireEvent.click(within(trace).getByRole('button', { name: /Event を開く/ }))
    expect(screen.getByTestId(`event-${e.eventId}`).getAttribute('aria-pressed')).toBe('true')
  })

  it('年を変えると古い Event/Trace 選択を解除し、対象フィルタで絞れる', () => {
    const run = runExperimentalTimeline(1)
    render(<App run={run} />)
    const first = run.result.eventLog[0]!
    fireEvent.click(screen.getByTestId(`event-${first.eventId}`))
    fireEvent.click(screen.getByRole('button', { name: /判断根拠を開く/ }))
    setYear(1251)
    expect(screen.getByTestId('event-detail').textContent).toContain('事件を選ぶと')
    expect(screen.getByTestId('trace-detail').textContent).toContain('Event の「判断根拠を開く」')
    const items = () => within(screen.getByTestId('chronicle-list')).getAllByRole('button').length
    const all = items()
    fireEvent.change(screen.getByTestId('event-target'), { target: { value: 'GROUP:group-west-commons' } })
    expect(items()).toBe(1)
    expect(all).toBeGreaterThan(1)
    fireEvent.change(screen.getByTestId('event-scope'), { target: { value: 'all' } })
    expect(items()).toBe(100)
  })

  it('無関係な Event へ切り替えると Trace を解除し、Trace→対応 Event の往復は維持する', () => {
    const run = runExperimentalTimeline(1)
    render(<App run={run} />)
    const [a, b] = run.result.eventLog.filter((x) => x.year === 1250)
    fireEvent.click(screen.getByTestId(`event-${a!.eventId}`))
    fireEvent.click(screen.getByRole('button', { name: /判断根拠を開く/ }))
    expect(screen.getByTestId('trace-detail').textContent).toContain(a!.sourceTraceIds[0])
    // Trace→対応 Event: Trace は維持される
    fireEvent.click(within(screen.getByTestId('trace-detail')).getByRole('button', { name: /Event を開く/ }))
    expect(screen.getByTestId('trace-detail').textContent).toContain(a!.sourceTraceIds[0])
    // 無関係な Event B: Trace A は残らない
    fireEvent.click(screen.getByTestId(`event-${b!.eventId}`))
    expect(screen.getByTestId('event-detail').textContent).toContain(b!.eventId)
    expect(screen.getByTestId('trace-detail').textContent).not.toContain(a!.sourceTraceIds[0])
    expect(screen.getByTestId('trace-detail').textContent).toContain('Event の「判断根拠を開く」')
  })

  it('対象フィルタを別 Group に変えると対象外の Event/Trace 詳細を解除する', () => {
    const run = runExperimentalTimeline(1)
    render(<App run={run} />)
    const a = run.result.eventLog.find((x) => x.year === 1250)!
    fireEvent.click(screen.getByTestId(`event-${a.eventId}`))
    fireEvent.click(screen.getByRole('button', { name: /判断根拠を開く/ }))
    const other = run.result.eventLog.find((x) => x.year === 1250 && x.eventId !== a.eventId)!
    const key = (r: (typeof other.involvedRefs)[number]) => (r.kind === 'PERSON_PAIR' ? '' : `${r.kind}:${r.id}`)
    fireEvent.change(screen.getByTestId('event-target'), { target: { value: key(other.involvedRefs[0]!) } })
    expect(screen.getByTestId('event-detail').textContent).not.toContain(a.eventId)
    expect(screen.getByTestId('trace-detail').textContent).not.toContain(a.sourceTraceIds[0])
    // 関与する対象への変更では維持される
    fireEvent.click(screen.getByTestId(`event-${other.eventId}`))
    fireEvent.change(screen.getByTestId('event-target'), { target: { value: key(other.involvedRefs[0]!) } })
    expect(screen.getByTestId('event-detail').textContent).toContain(other.eventId)
  })

  it('seed は 0 以上の安全整数のみ受け付け、負数・範囲外・小数は再計算を無効化する', () => {
    render(<App />)
    const btn = screen.getByTestId('rerun') as HTMLButtonElement
    for (const bad of ['-1', '9007199254740992', '1.5', '', '1e3']) {
      fireEvent.change(screen.getByTestId('seed-input'), { target: { value: bad } })
      expect(btn.disabled).toBe(true)
    }
    for (const ok of ['0', '9007199254740991']) {
      fireEvent.change(screen.getByTestId('seed-input'), { target: { value: ok } })
      expect(btn.disabled).toBe(false)
    }
  })

  it('1350年は評価専用で、1351年初への反映を示唆しない', () => {
    render(<App />)
    setYear(1350)
    const text = screen.getByTestId('chronicle-status').closest('section')!.textContent ?? ''
    expect(text).toContain('1350年は評価専用')
    expect(text).not.toContain('1351')
  })

  it('同 seed の再計算は同一結果、別 seed は seed 表示が変わる', () => {
    expect(JSON.stringify(runExperimentalTimeline(5).result)).toBe(JSON.stringify(runExperimentalTimeline(5).result))
    render(<App />)
    fireEvent.change(screen.getByTestId('seed-input'), { target: { value: '9' } })
    fireEvent.click(screen.getByTestId('rerun'))
    expect(screen.getByTestId('run-inputs').textContent).toContain('seed 9')
    fireEvent.change(screen.getByTestId('seed-input'), { target: { value: 'abc' } })
    expect((screen.getByTestId('rerun') as HTMLButtonElement).disabled).toBe(true)
  })

  it('停止した計算は HALTED と原因を示し、敗北と表示せず、未計算年を選べない', () => {
    const run = haltedRun()
    expect(run.result.status).toBe('HALTED')
    render(<App run={run} />)
    expect(screen.getByTestId('run-status').textContent).toContain('HALTED')
    const halt = screen.getByTestId('halt-diagnostic')
    expect(halt.textContent).toContain('ゲーム内の敗北ではなく')
    expect(halt.textContent).toContain(run.result.halt!.code)
    expect(document.body.textContent).not.toMatch(/勝利|敗北して|達成/)
    const slider = screen.getByRole('slider') as HTMLInputElement
    expect(slider.disabled).toBe(true)
    setYear(1350)
    expect(screen.getByTestId('current-year').textContent).toContain('1250年')
    expect(screen.getByTestId('year-note').textContent).toContain('未計算のため選べません')
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

  it('タブ切替（クリック・キーボード）で古い選択を解除し、未選択状態を表示する', () => {
    render(<App />)
    fireEvent.click(screen.getByTestId('region-node-region-eldia-central'))
    expect(within(screen.getByTestId('detail')).getByRole('heading', { name: 'エルディア中央' })).toBeTruthy()
    fireEvent.click(screen.getByRole('tab', { name: '人物' }))
    expect(screen.getByRole('tab', { name: '人物' }).getAttribute('aria-selected')).toBe('true')
    expect(within(screen.getByTestId('detail')).queryByRole('heading', { name: 'エルディア中央' })).toBeNull()
    expect(screen.getByTestId('detail').textContent).toContain('を選ぶと詳細を表示します')
    expect(screen.getByTestId('region-node-region-eldia-central').getAttribute('aria-pressed')).toBe('false')

    fireEvent.click(screen.getByTestId('region-node-region-eldia-west'))
    const region = screen.getByRole('tab', { name: '地域' })
    fireEvent.keyDown(region, { key: 'ArrowRight' })
    expect(screen.getByTestId('detail').textContent).not.toContain('エルディア西部')
    expect(screen.getByTestId('detail').textContent).toContain('を選ぶと詳細を表示します')
    fireEvent.click(screen.getAllByTestId(/^item-group-/)[0])
    expect(screen.getByTestId('detail').textContent).not.toContain('を選ぶと詳細を表示します')
    fireEvent.keyDown(screen.getByRole('tab', { name: '人口集団' }), { key: 'Home' })
    expect(screen.getByTestId('detail').textContent).toContain('を選ぶと詳細を表示します')
  })

  it('詳細リンク移動では選択を維持してカテゴリを変更する', () => {
    render(<App />)
    fireEvent.click(screen.getByRole('tab', { name: '称号' }))
    fireEvent.click(screen.getByTestId('item-title-title-exp-west'))
    fireEvent.click(within(screen.getByTestId('detail')).getByRole('button', { name: /試験人物04/ }))
    expect(screen.getByRole('tab', { name: '人物' }).getAttribute('aria-selected')).toBe('true')
    const h = within(screen.getByTestId('detail')).getByRole('heading', { name: /試験人物04/ })
    expect(h).toBeTruthy()
    expect(screen.getByTestId('detail').textContent).not.toContain('を選ぶと詳細を表示します')
  })
})
