// @vitest-environment jsdom
// 既知の成功入力を与えず、画面の記録だけで「終点の不足 → 保持者の喪失 → 人物 → 婚姻候補・出生の理由」へ辿れるかの確認。
// 実A0（seed 20260101）の観測スライスを使う。Workerの年切り替えは同じA0の別年スライスで代替（計算は1回）。
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { useMemo, useState } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { runPlayBaseline, sliceA0Observation } from '../../../../src/ui/branch-play-source.ts'
import { ObservationPanel } from '../../../../src/ui/observation/ObservationPanel.tsx'

afterEach(cleanup)
const base = runPlayBaseline(20260101, 'INTEGRATED_EXPERIMENTAL')
if (!base.ok) throw new Error(base.message)
const a0 = base.a0
const onIntervene = vi.fn()
const loaded: number[] = []

function Harness() {
  const [year, setYear] = useState(1350)
  const view = useMemo(() => sliceA0Observation(a0, year, 'INTEGRATED_EXPERIMENTAL', 'REUSED')!, [year])
  return <ObservationPanel observation={view} loading={false} seedText="20260101" onSeedText={vi.fn()} onReset={vi.fn()}
    onLoad={y => { loaded.push(y); setYear(y) }} onCancel={vi.fn()} onIntervene={onIntervene} />
}

describe('実A0で、画面の記録から理由を探せる', () => {
  it('終点の不足 → 喪失記録 → 人物の履歴 → 婚姻候補の理由・出生判断の不在まで辿れる', () => {
    render(<Harness />)
    // 1. 終点（1350年初）の不足から、保持者を失った称号の記録が出る（年・人物は画面の実記録）。
    const loss = screen.getByTestId('obs-loss-records')
    expect(loss.textContent).toContain('最後の保持者')
    // 2. 最後の保持者の履歴を開く（年も一緒に切り替わる）。
    fireEvent.click(within(loss).getAllByTestId('obs-loss-person')[0]!)
    expect(loaded.at(-1)).toBeLessThan(1350)
    const hist = screen.getByTestId('person-history')
    expect(within(hist).getByTestId('history-marriages').textContent).toContain('婚姻の記録なし')
    expect(within(hist).getByTestId('history-children').textContent).toContain('子の記録なし')
    // 3. 婚姻候補が成立しなかった理由は、記録された判断として読める（信頼不足とは書かれない）。
    const judg = within(hist).getByTestId('history-judgments')
    expect(judg.textContent).toContain('きょうだい')
    expect(judg.textContent).toContain('共通の祖先が2世代以内')
    expect(judg.textContent).not.toContain('信頼値が採用の閾値未満')
    expect(within(hist).getByTestId('history-supply').textContent).toContain('供給できる人口の候補が、記録上いない')
    expect(within(hist).getByTestId('history-no-birth-judgment').textContent).toContain('判断の対象外')
    // 4. 候補相手の判断記録から、その年のTraceを開ける。
    expect(within(hist).getAllByTestId('history-open-trace').length).toBeGreaterThan(0)
    // 5. 両親から出生・婚姻の記録へ進める。選択人物は黙って別人にならない。
    const parents = within(hist).getByTestId('history-parents')
    const fatherBtn = within(parents).getAllByRole('button')[0]!
    const before = (screen.getByTestId('obs-person') as HTMLSelectElement).value
    fireEvent.click(fatherBtn)
    expect((screen.getByTestId('obs-person') as HTMLSelectElement).value).not.toBe(before)
    const fatherHist = screen.getByTestId('person-history')
    expect(within(fatherHist).getByTestId('history-marriages').textContent).toMatch(/\d{4}〜\d{4}年/)
    expect(within(fatherHist).getByTestId('history-judgments').textContent).toContain('親の年齢が出生判定の対象範囲外')
  })

  it('選択人物の死亡は打消し線（ft-dead）で示され、通常表示は「試験人物」に統一される', () => {
    render(<Harness />)
    fireEvent.click(within(screen.getByTestId('obs-loss-records')).getAllByTestId('obs-loss-person')[0]!)
    // 死亡した年の年初はまだ存命。翌年初の記録で死亡となり、選択中の人物にも打消し線が付く。
    fireEvent.click(screen.getByRole('button', { name: '翌年' }))
    const self = screen.getByTestId('family-tree').querySelector('[aria-current="true"]')!
    expect(self.className).toContain('ft-dead')
    expect(screen.getByTestId('obs-person').textContent).not.toMatch(/当主|嫡男/)
    expect(self.textContent).toContain('試験人物')
  })

  it('称号の移転Eventは対象称号・変更前後の保持者・確認できる判断として説明される', () => {
    render(<Harness />)
    fireEvent.click(within(screen.getByTestId('obs-loss-records')).getAllByRole('button', { name: /称号移転の記録を開く/ })[0]!)
    const detail = screen.getByTestId('obs-event-detail')
    expect(detail.textContent).toContain('対象称号')
    expect(detail.textContent).toContain('変更前の保持者')
    expect(detail.textContent).toContain('変更後の保持者')
    expect(screen.getByTestId('obs-event-reasons').textContent).toMatch(/採用|保留/)
    expect(detail.textContent).not.toContain('状態変化2件')
  })

  it('世界の閲覧タブでも同じA0・年・人物を保ち、旧runの世界を混ぜない', () => {
    render(<Harness />)
    fireEvent.click(within(screen.getByTestId('obs-loss-records')).getAllByTestId('obs-loss-person')[0]!)
    const ctx = screen.getByTestId('obs-context-line').textContent!
    fireEvent.click(screen.getByTestId('obs-tab-world'))
    expect(screen.getByTestId('obs-context-line').textContent).toBe(ctx)
    expect(screen.getByTestId('obs-world-explorer').textContent).toContain('旧試験計算のデータは混ざりません')
    expect(screen.getByTestId('region-map')).toBeTruthy()
  })
})
