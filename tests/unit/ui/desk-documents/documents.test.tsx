// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { runPlayBaseline, sliceA0Observation } from '../../../../src/ui/branch-play-source.ts'
import type { ObservationSlice } from '../../../../src/ui/branch-play-source.ts'
import type { TargetRef, WorldState } from '../../../../src/simulation/contracts/index.ts'
import { historyFromObservation } from '../../../../src/ui/desk/data/history.ts'
import { DeskDocuments, externalDocumentWindowId } from '../../../../src/ui/desk/documents/index.tsx'

afterEach(cleanup)
function isPresentPerson(ref: TargetRef, world: WorldState): ref is TargetRef & { kind: 'PERSON'; id: string } {
  if (ref.kind !== 'PERSON') return false
  const id = ref.id
  return world.persons.some(person => person.personId === id)
}
let slice: ObservationSlice
let evidenceSlice: ObservationSlice | undefined
let pairSlice: ObservationSlice | undefined
beforeAll(() => {
  // 既存エンジンの実A0。ゲームの成功例を仮定しない。
  const result = runPlayBaseline(20260101, 'INTEGRATED_EXPERIMENTAL')
  if (!result.ok) throw new Error(result.message)
  slice = sliceA0Observation(result.a0, 1260, 'INTEGRATED_EXPERIMENTAL', 'REUSED')!
  // 人物が年初に存在し、同年の実Traceを参照するEventを実履歴全体から選ぶ。
  const run = result.a0.result
  const event = run.eventLog.find(e => {
    const world = run.snapshots.find(w => w.year === e.year)
    return world && e.sourceTraceIds.some(id => run.decisionTraces.some(t => t.traceId === id && t.year === e.year))
      && e.involvedRefs.some(r => isPresentPerson(r, world))
  })
  if (event) evidenceSlice = sliceA0Observation(result.a0, event.year, 'INTEGRATED_EXPERIMENTAL', 'REUSED')
  const pairTrace = run.decisionTraces.find(t => t.actorRef.kind === 'PERSON_PAIR' && t.year < 1350)
  if (pairTrace) pairSlice = sliceA0Observation(result.a0, pairTrace.year, 'INTEGRATED_EXPERIMENTAL', 'REUSED')
}, 60_000)

describe('実A0の独立資料', () => {
  it('異なる人物の資料を同時に開き、キーボードで移動・閉じても他の資料を保つ', () => {
    const history = historyFromObservation(slice).at(1260)
    const [first, second] = slice.world.persons
    expect(first).toBeDefined()
    expect(second).toBeDefined()
    const common = { history, slice, onOpenRelated: vi.fn(), onYear: vi.fn(), onFilter: vi.fn(), onIntervene: vi.fn() }
    const { rerender } = render(<DeskDocuments {...common} openRequest={{ requestId: '1', ref: history.ref, target: { kind: 'person', id: first!.personId } }} />)
    rerender(<DeskDocuments {...common} openRequest={{ requestId: '2', ref: history.ref, target: { kind: 'person', id: second!.personId } }} />)
    const dialogs = screen.getAllByRole('dialog')
    expect(dialogs).toHaveLength(2)
    const move = within(dialogs[0]!).getByRole('button', { name: '資料を移動' })
    fireEvent.focus(move)
    expect(Number(dialogs[0]!.style.zIndex)).toBeGreaterThan(Number(dialogs[1]!.style.zIndex))
    const before = dialogs[0]!.getAttribute('style')
    move.focus()
    fireEvent.keyDown(move, { key: 'ArrowRight' })
    expect(dialogs[0]!.getAttribute('style')).not.toBe(before)
    fireEvent.keyDown(move, { key: 'Escape' })
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
  })

  it('縦移動と画面縮小後も窓の高さを画面内に制限する', () => {
    vi.stubGlobal('innerHeight', 400)
    try {
      const history = historyFromObservation(slice).at(slice.year)
      render(<DeskDocuments history={history} openRequest={{ requestId: 'position', ref: history.ref, target: { kind: 'person', id: slice.world.persons[0]!.personId } }} />)
      const dialog = screen.getByRole('dialog')
      const move = within(dialog).getByRole('button', { name: '資料を移動' })
      for (let i = 0; i < 30; i++) fireEvent.keyDown(move, { key: 'ArrowDown' })
      const top = parseFloat(dialog.style.top)
      expect(top).toBeLessThanOrEqual(320)
      expect(dialog.style.maxHeight).toBe(`calc(100vh - ${top}px)`)
      vi.stubGlobal('innerHeight', 200)
      fireEvent(window, new Event('resize'))
      const resizedTop = parseFloat(dialog.style.top)
      expect(resizedTop).toBeLessThanOrEqual(120)
      expect(dialog.style.maxHeight).toBe(`calc(100vh - ${resizedTop}px)`)
    } finally { vi.unstubAllGlobals() }
  })

  it('人物から家系と実Event・Traceを開き、参照元と年を保つ', () => {
    expect(evidenceSlice).toBeDefined()
    const slice = evidenceSlice!
    const history = historyFromObservation(slice).at(slice.year)
    const event = slice.events.find(e => e.sourceTraceIds.some(id => slice.traces.some(t => t.traceId === id)) && e.involvedRefs.some(r => isPresentPerson(r, slice.world)))
    expect(event).toBeDefined()
    const personRef = event!.involvedRefs.find(r => isPresentPerson(r, slice.world))!
    if (personRef.kind !== 'PERSON') throw new Error('年初の人物参照がありません')
    const personId = personRef.id
    const related = vi.fn()
    render(<DeskDocuments history={history} slice={slice} openRequest={{ requestId: 'person', ref: history.ref, target: { kind: 'person', id: personId } }} onOpenRelated={related} />)
    const person = screen.getByRole('dialog', { name: `人物 ${personId}` })
    fireEvent.click(within(person).getByRole('button', { name: '家系を開く' }))
    const family = screen.getByRole('dialog', { name: `家系 ${personId}` })
    expect(family.textContent).toContain(`参照元: 人物 ${personId}`)
    expect(related).toHaveBeenLastCalledWith(expect.objectContaining({ ref: history.ref, source: { kind: 'person', id: personId }, target: { kind: 'family', id: personId } }))
    fireEvent.click(within(family).getByRole('button', { name: `Event ${event!.eventId}` }))
    const eventDialog = screen.getByRole('dialog', { name: `Event ${event!.eventId}` })
    expect(eventDialog.textContent).toContain(event!.eventType)
    const traceId = event!.sourceTraceIds.find(id => slice.traces.some(t => t.traceId === id))!
    expect(traceId).toBeDefined()
    fireEvent.click(within(eventDialog).getByRole('button', { name: `Trace ${traceId}` }))
    const traceDialog = screen.getByRole('dialog', { name: `Trace ${traceId}` })
    expect(traceDialog.textContent).toContain(slice.traces.find(t => t.traceId === traceId)!.ruleId)
    expect(traceDialog.textContent).toContain(`参照元: Event ${event!.eventId}`)
    expect(screen.getAllByRole('dialog')).toHaveLength(4)
  })

  it('実集団の資料は同じ参照で年表を絞り込み、人物資料を残す', () => {
    const history = historyFromObservation(slice).at(1260)
    const person = slice.world.persons.find(p => slice.world.groups.some(g => g.groupId === p.originGroupId))!
    expect(person).toBeDefined()
    const group = slice.world.groups.find(g => g.groupId === person.originGroupId)!
    const onFilter = vi.fn()
    render(<DeskDocuments history={history} slice={slice} onFilter={onFilter} openRequest={{ requestId: 'p', ref: history.ref, target: { kind: 'person', id: person.personId } }} />)
    const personDialog = screen.getByRole('dialog', { name: `人物 ${person.personId}` })
    fireEvent.click(within(personDialog).getByRole('button', { name: group.name }))
    const dialog = screen.getByRole('dialog', { name: `集団 ${group.groupId}` })
    expect(dialog.textContent).toContain(`参照元: 人物 ${person.personId}`)
    fireEvent.click(within(dialog).getByRole('button', { name: '年表で絞り込む' }))
    expect(onFilter).toHaveBeenCalledWith({ kind: 'group', id: group.groupId }, history.ref)
    expect(screen.getByRole('dialog', { name: `人物 ${person.personId}` })).toBeTruthy()
  })

  it('右クリックは窓を即時追加せず、文脈操作から資料を開く', () => {
    const history = historyFromObservation(slice).at(slice.year)
    const person = slice.world.persons[0]!
    render(<DeskDocuments history={history} slice={slice} openRequest={{ requestId: 'context', ref: history.ref, target: { kind: 'person', id: person.personId } }} />)
    const dialog = screen.getByRole('dialog')
    fireEvent.contextMenu(within(dialog).getByRole('button', { name: '家系を開く' }))
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    const menu = within(dialog).getByRole('menu', { name: '対象の文脈操作' })
    fireEvent.keyDown(within(menu).getByRole('menuitem', { name: '資料を開く' }), { key: 'Escape' })
    expect(within(dialog).queryByRole('menu')).toBeNull()
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    fireEvent.contextMenu(within(dialog).getByRole('button', { name: '家系を開く' }))
    fireEvent.click(within(within(dialog).getByRole('menu', { name: '対象の文脈操作' })).getByRole('menuitem', { name: '資料を開く' }))
    expect(screen.getByRole('dialog', { name: `家系 ${person.personId}` })).toBeTruthy()
  })

  it('内部関連通知と同じIDの外部要求も開く', () => {
    const history = historyFromObservation(slice).at(slice.year)
    const person = slice.world.persons[0]!
    const onOpenRelated = vi.fn()
    const common = { history, slice, onOpenRelated }
    const { rerender } = render(<DeskDocuments {...common} openRequest={{ requestId: 'first', ref: history.ref, target: { kind: 'person', id: person.personId } }} />)
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '家系を開く' }))
    const generatedId = onOpenRelated.mock.calls[0]![0].requestId as string
    rerender(<DeskDocuments {...common} openRequest={{ requestId: 'related-2', ref: history.ref, target: { kind: 'group', id: slice.world.groups[0]!.groupId } }} />)
    expect(screen.getAllByRole('dialog')).toHaveLength(3)
    if (generatedId !== 'related-2') {
      rerender(<DeskDocuments {...common} openRequest={{ requestId: generatedId, ref: history.ref, target: { kind: 'region', id: slice.world.regions[0]!.regionId } }} />)
      expect(screen.getAllByRole('dialog')).toHaveLength(4)
    }
  })

  it('親が関連通知のコピーを返しても同じ窓を二重に開かない', () => {
    const history = historyFromObservation(slice).at(slice.year)
    const person = slice.world.persons[0]!
    const onOpenRelated = vi.fn()
    const common = { history, slice, onOpenRelated }
    const { rerender } = render(<DeskDocuments {...common} openRequest={{ requestId: 'first', ref: history.ref, target: { kind: 'person', id: person.personId } }} />)
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '家系を開く' }))
    const request = onOpenRelated.mock.calls[0]![0]
    rerender(<DeskDocuments {...common} openRequest={{ ...request }} />)
    expect(screen.getAllByRole('dialog')).toHaveLength(2)
  })

  it('外部requestIdが内部ID風でも別窓を誤って閉じない', () => {
    const history = historyFromObservation(slice).at(slice.year)
    const person = slice.world.persons[0]!
    const common = { history, slice }
    const { rerender } = render(<DeskDocuments {...common} openRequest={{ requestId: 'first', ref: history.ref, target: { kind: 'person', id: person.personId } }} />)
    const personDialog = screen.getByRole('dialog', { name: `人物 ${person.personId}` })
    fireEvent.click(within(personDialog).getByRole('button', { name: '家系を開く' }))
    rerender(<DeskDocuments {...common} openRequest={{ requestId: 'internal-3-1', ref: history.ref, target: { kind: 'group', id: slice.world.groups[0]!.groupId } }} />)
    expect(screen.getAllByRole('dialog')).toHaveLength(3)
    fireEvent.click(within(screen.getByRole('dialog', { name: `家系 ${person.personId}` })).getByRole('button', { name: '資料を閉じる' }))
    expect(screen.getAllByRole('dialog')).toHaveLength(2)
    expect(screen.getByRole('dialog', { name: `集団 ${slice.world.groups[0]!.groupId}` })).toBeTruthy()
  })

  it('実Traceの人物ペアを二人の資料へ展開する', () => {
    expect(pairSlice).toBeDefined()
    const slice = pairSlice!
    const trace = slice.traces.find(t => t.actorRef.kind === 'PERSON_PAIR')!
    expect(trace).toBeDefined()
    if (trace.actorRef.kind !== 'PERSON_PAIR') throw new Error('人物ペアではありません')
    const [first, second] = trace.actorRef.ids
    const history = historyFromObservation(slice).at(slice.year)
    render(<DeskDocuments history={history} slice={slice} openRequest={{ requestId: 'pair', ref: history.ref, target: { kind: 'trace', id: trace.traceId } }} />)
    const dialog = screen.getByRole('dialog', { name: `Trace ${trace.traceId}` })
    fireEvent.click(within(dialog).getByRole('button', { name: `人物 ${first}` }))
    fireEvent.click(within(dialog).getByRole('button', { name: `人物 ${second}` }))
    expect(screen.getByRole('dialog', { name: `人物 ${first}` })).toBeTruthy()
    expect(screen.getByRole('dialog', { name: `人物 ${second}` })).toBeTruthy()
  })

  it('同じ参照でも各窓が取得範囲の異なる判断を混ぜない', () => {
    const history = historyFromObservation(slice).at(slice.year)
    const trace = slice.traces[0]!
    expect(trace).toBeDefined()
    // 転送省略のテスト用fixture。実Traceは完全な観測から取得する。
    const omitted = { ...history, trace: () => ({ kind: 'POSSIBLY_OMITTED' as const }) }
    const target = { kind: 'trace' as const, id: trace.traceId }
    const { rerender } = render(<DeskDocuments history={history} openRequest={{ requestId: 'omitted', ref: history.ref, target, history: omitted }} />)
    rerender(<DeskDocuments history={history} openRequest={{ requestId: 'complete', ref: history.ref, target, history }} />)
    const dialogs = screen.getAllByRole('dialog', { name: `Trace ${trace.traceId}` })
    expect(dialogs).toHaveLength(2)
    expect(dialogs[0]!.textContent).toContain('転送省略の可能性')
    expect(dialogs[0]!.textContent).not.toContain('実判断:')
    expect(dialogs[1]!.textContent).toContain(`実判断: ${trace.ruleId}`)
  })

  it('未計算の窓は同じ参照の確定結果を受け取ると表示を更新する', () => {
    const history = historyFromObservation(slice).at(slice.year)
    // 状態遷移だけを制御する未計算fixture。確定後は実A0を使用する。
    const pending = { ...history, start: { kind: 'UNCOMPUTED' as const }, records: { kind: 'UNCOMPUTED' as const } }
    const person = slice.world.persons[0]!
    const request = { requestId: 'pending', ref: history.ref, target: { kind: 'person' as const, id: person.personId } }
    const { rerender } = render(<DeskDocuments history={pending} openRequest={request} />)
    expect(screen.getByRole('dialog').textContent).toContain('未計算')
    rerender(<DeskDocuments history={history} openRequest={request} />)
    expect(screen.getByRole('dialog').textContent).toContain(person.name)
    expect(screen.getByRole('dialog').textContent).not.toContain('未計算')
  })

  it('年初確定・年内未計算から同refのEventとTraceが確定すると資料を更新する', () => {
    expect(evidenceSlice).toBeDefined()
    const view = evidenceSlice!
    const history = historyFromObservation(view).at(view.year)
    const event = view.events.find(e => e.sourceTraceIds.some(id => view.traces.some(t => t.traceId === id)))!
    expect(event).toBeDefined()
    const trace = view.traces.find(t => event.sourceTraceIds.includes(t.traceId))!
    // 年初は実データのまま、年内だけ未計算にした状態遷移fixture。
    const pending = { ...history, records: { kind: 'UNCOMPUTED' as const },
      event: () => ({ kind: 'UNCOMPUTED' as const }), trace: () => ({ kind: 'UNCOMPUTED' as const }) }
    const eventRequest = { requestId: 'pending-event', ref: history.ref, target: { kind: 'event' as const, id: event.eventId } }
    const traceRequest = { requestId: 'pending-trace', ref: history.ref, target: { kind: 'trace' as const, id: trace.traceId } }
    const { rerender } = render(<DeskDocuments history={pending} openRequest={eventRequest} />)
    rerender(<DeskDocuments history={pending} openRequest={traceRequest} />)
    const eventDialog = screen.getByRole('dialog', { name: `Event ${event.eventId}` })
    const traceDialog = screen.getByRole('dialog', { name: `Trace ${trace.traceId}` })
    expect(eventDialog.textContent).toContain('未計算')
    expect(traceDialog.textContent).toContain('未計算')
    rerender(<DeskDocuments history={history} openRequest={traceRequest} />)
    expect(eventDialog.textContent).toContain(event.eventType)
    expect(traceDialog.textContent).toContain(`実判断: ${trace.ruleId}`)
  })

  it('明示された比較由来の未取得・未計算資料を別出典の共通historyで昇格しない', () => {
    const history = historyFromObservation(slice).at(slice.year)
    const person = slice.world.persons[0]!
    const trace = slice.traces[0]!
    expect(trace).toBeDefined()
    // 比較由来DTOの取得状態を模したfixture。同一refでも出典が異なる。
    const notLoaded = { ...history, start: { kind: 'NOT_LOADED' as const }, records: { kind: 'NOT_LOADED' as const } }
    const uncomputed = { ...history, records: { kind: 'UNCOMPUTED' as const }, trace: () => ({ kind: 'UNCOMPUTED' as const }) }
    const first = { requestId: 'explicit-unloaded', ref: history.ref, target: { kind: 'person' as const, id: person.personId }, history: notLoaded }
    const second = { requestId: 'explicit-uncomputed', ref: history.ref, target: { kind: 'trace' as const, id: trace.traceId }, history: uncomputed }
    const { rerender } = render(<DeskDocuments openRequest={first} />)
    rerender(<DeskDocuments openRequest={second} />)
    const personDialog = screen.getByRole('dialog', { name: `人物 ${person.personId}` })
    const traceDialog = screen.getByRole('dialog', { name: `Trace ${trace.traceId}` })
    expect(personDialog.textContent).toContain('未取得')
    expect(traceDialog.textContent).toContain('未計算')
    rerender(<DeskDocuments history={history} openRequest={second} />)
    expect(personDialog.textContent).toContain('未取得')
    expect(personDialog.textContent).not.toContain(person.name)
    expect(traceDialog.textContent).toContain('未計算')
    expect(traceDialog.textContent).not.toContain('実判断:')
  })

  it('明示比較資料から別年へ進む時は共通historyを混ぜず出典を通知する', () => {
    const history = historyFromObservation(slice).at(slice.year)
    const record = slice.personRecords.find(r => slice.world.persons.some(p => p.personId === r.personId) && r.judgments.some(j => j.fromYear !== slice.year))!
    expect(record).toBeDefined()
    const onOpenRelated = vi.fn()
    const onYear = vi.fn()
    const request = { requestId: 'pinned-person', ref: history.ref, target: { kind: 'person' as const, id: record.personId }, history }
    const { rerender } = render(<DeskDocuments history={history} slice={slice} openRequest={request} onOpenRelated={onOpenRelated} onYear={onYear} />)
    const dialog = screen.getByRole('dialog')
    const buttons = within(dialog).getAllByTestId('history-open-trace')
    const differentYear = buttons.find(button => !button.textContent?.startsWith(`${slice.year}年`))!
    expect(differentYear).toBeDefined()
    fireEvent.click(differentYear)
    const notice = onOpenRelated.mock.calls[0]![0]
    expect(notice.ref.year).not.toBe(slice.year)
    expect(notice.sourceHistory).toBe(history)
    expect(onYear).toHaveBeenCalledWith(notice.ref, { windowId: notice.windowId, sourceHistory: history })
    const traceDialog = screen.getByRole('dialog', { name: `Trace ${notice.target.id}` })
    expect(traceDialog.textContent).toContain('未取得')
    // 同じrefを名乗る別出典のfixtureを混ぜない。
    const otherSource = { ...history, ref: notice.ref }
    rerender(<DeskDocuments history={otherSource} slice={slice} openRequest={request} onOpenRelated={onOpenRelated} onYear={onYear} />)
    expect(traceDialog.textContent).toContain('未取得')
  })

  it('明示未取得資料の同出典結果を指定窓だけに反映する', () => {
    const history = historyFromObservation(slice).at(slice.year)
    const person = slice.world.persons[0]!
    const pending = { ...history, start: { kind: 'NOT_LOADED' as const }, records: { kind: 'NOT_LOADED' as const } }
    const request = { requestId: 'pinned-load', ref: history.ref, target: { kind: 'person' as const, id: person.personId }, history: pending }
    const onYear = vi.fn()
    const { rerender } = render(<DeskDocuments openRequest={request} onYear={onYear} />)
    const dialog = screen.getByRole('dialog')
    expect(dialog.textContent).toContain('未取得')
    fireEvent.click(within(dialog).getByRole('button', { name: /この参照/ }))
    expect(onYear).toHaveBeenCalledWith(history.ref, { windowId: externalDocumentWindowId(request.requestId), sourceHistory: pending })
    rerender(<DeskDocuments openRequest={request} onYear={onYear} historyUpdate={{ windowId: externalDocumentWindowId(request.requestId), history }} />)
    expect(dialog.textContent).toContain(person.name)
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
  })

  it('実枝にいない人物を実在人物の資料で置き換えない', () => {
    const history = historyFromObservation(slice).at(1260)
    const id = 'test-person-not-in-this-branch'
    render(<DeskDocuments history={history} slice={slice} openRequest={{ requestId: 'absent', ref: history.ref, target: { kind: 'person', id } }} onOpenRelated={vi.fn()} onYear={vi.fn()} onFilter={vi.fn()} onIntervene={vi.fn()} />)
    const dialog = screen.getByRole('dialog')
    expect(dialog.textContent).toContain('ABSENT_FROM_BRANCH')
  })

  it('年・枝・構成・介入来歴の不一致を別々に未取得として扱う', () => {
    const history = historyFromObservation(slice).at(slice.year)
    const person = slice.world.persons[0]!
    const { ref } = history
    const variants = [
      { ...ref, year: ref.year + 1 },
      { ...ref, origin: { ...ref.origin, branch: 'A1' as const } },
      { ...ref, origin: { ...ref.origin, configuration: { ...ref.origin.configuration, configDigest: 'different-config' } } },
      { ...ref, origin: { ...ref.origin, modifierIds: ['different-modifier'] } },
    ]
    const { rerender } = render(<DeskDocuments history={history} slice={slice} />)
    variants.forEach((wrong, index) => {
      rerender(<DeskDocuments history={history} slice={slice} openRequest={{ requestId: `mismatch-${index}`, ref: wrong, target: { kind: 'person', id: person.personId } }} />)
    })
    const dialogs = screen.getAllByRole('dialog')
    expect(dialogs).toHaveLength(variants.length)
    for (const dialog of dialogs) {
      expect(dialog.textContent).toContain('未取得（参照文脈が一致しません）')
      expect(dialog.textContent).not.toContain(person.name)
    }
  })

  it('別のseedの参照を現在の記録で埋めない', () => {
    const history = historyFromObservation(slice).at(1260)
    const person = slice.world.persons[0]!
    const ref = { ...history.ref, origin: { ...history.ref.origin, seed: history.ref.origin.seed + 1 } }
    render(<DeskDocuments history={history} slice={slice} openRequest={{ requestId: 'wrong', ref, target: { kind: 'person', id: person.personId } }} onOpenRelated={vi.fn()} onYear={vi.fn()} onFilter={vi.fn()} onIntervene={vi.fn()} />)
    expect(screen.getByRole('dialog').textContent).toContain('未取得（参照文脈が一致しません）')
  })
})
