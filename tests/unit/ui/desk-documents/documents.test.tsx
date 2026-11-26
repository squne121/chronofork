// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest'
import { runPlayBaseline, sliceA0Observation } from '../../../../src/ui/branch-play-source.ts'
import type { ObservationSlice, PlayView } from '../../../../src/ui/branch-play-source.ts'
import type { TargetRef, WorldState } from '../../../../src/simulation/contracts/index.ts'
import { historyFromObservation } from '../../../../src/ui/desk/data/history.ts'
import { DeskDocuments } from '../../../../src/ui/desk/documents/index.tsx'

afterEach(cleanup)
function isPresentPerson(ref: TargetRef, world: WorldState): ref is TargetRef & { kind: 'PERSON'; id: string } {
  if (ref.kind !== 'PERSON') return false
  const id = ref.id
  return world.persons.some(person => person.personId === id)
}
let slice: ObservationSlice
let evidenceSlice: ObservationSlice | undefined
let initialSlice: ObservationSlice
let newborn: { slice: ObservationSlice; id: string } | undefined
let pairSlice: ObservationSlice | undefined
beforeAll(() => {
  // 既存エンジンの実A0。ゲームの成功例を仮定しない。
  const result = runPlayBaseline(20260101, 'INTEGRATED_EXPERIMENTAL')
  if (!result.ok) throw new Error(result.message)
  slice = sliceA0Observation(result.a0, 1260, 'INTEGRATED_EXPERIMENTAL', 'REUSED')!
  initialSlice = sliceA0Observation(result.a0, 1250, 'INTEGRATED_EXPERIMENTAL', 'REUSED')!
  const born = initialSlice.personRecords.find(p => p.birthEvidence.kind === 'BIRTH_EVENT' && p.firstYear > p.birthYear)
  if (born) newborn = { id: born.personId, slice: sliceA0Observation(result.a0, born.birthYear, 'INTEGRATED_EXPERIMENTAL', 'REUSED')! }
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

function dialog(kind: string, id: string) {
  const kinds: Record<string, string> = { 人物: 'person', 家系: 'family', 称号: 'title', 集団: 'group', Event: 'event', Trace: 'trace' }
  const doc = screen.getAllByTestId('desk-document').find(d => d.dataset.kind === (kinds[kind] ?? kind) && d.dataset.target === id)
  if (!doc) throw new Error(`資料がありません: ${kind}`)
  return doc
}

describe('実A0の独立資料', () => {
  it('同出典は重複せず、固定した資料を残して一枚で参照・復帰する', () => {
    const history = historyFromObservation(slice).at(slice.year)
    const [first, second] = slice.world.persons
    const common = { history, slice }
    const request = (requestId: string, id: string) => ({ requestId, ref: history.ref, target: { kind: 'person' as const, id } })
    const { rerender } = render(<DeskDocuments {...common} openRequest={request('1', first!.personId)} />)
    rerender(<DeskDocuments {...common} openRequest={request('2', second!.personId)} />)
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    fireEvent.click(within(dialog('人物', second!.personId)).getByRole('button', { name: '戻る' }))
    const fixed = dialog('人物', first!.personId)
    fireEvent.click(within(fixed).getByRole('button', { name: '固定' }))
    rerender(<DeskDocuments {...common} openRequest={request('3', second!.personId)} />)
    expect(screen.getAllByRole('dialog')).toHaveLength(2)
    rerender(<DeskDocuments {...common} openRequest={request('4', first!.personId)} />)
    expect(screen.getAllByRole('dialog')).toHaveLength(2)
    expect(document.activeElement).toBe(dialog('人物', first!.personId))
    fireEvent.click(within(dialog('人物', first!.personId)).getByRole('button', { name: '解除' }))
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
    fireEvent.click(within(dialog('人物', first!.personId)).getByRole('button', { name: '戻る' }))
    expect(dialog('人物', second!.personId)).toBeTruthy()
    fireEvent.keyDown(dialog('人物', second!.personId), { key: 'Escape' })
    expect(screen.queryByRole('dialog')).toBeNull()
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
    render(<DeskDocuments history={history} slice={slice} openRequest={{ requestId: 'person', ref: history.ref, target: { kind: 'person', id: personId } }} onResolve={related} />)
    const person = dialog('人物', personId)
    fireEvent.click(within(person).getByRole('button', { name: '家系を開く' }))
    const family = dialog('家系', personId)
    expect(family.textContent).toContain('参照元: 人物：')
    expect(related).toHaveBeenLastCalledWith(expect.objectContaining({ ref: history.ref, source: { kind: 'person', id: personId }, target: { kind: 'family', id: personId } }))
    fireEvent.click(within(family).getByTestId(`document-link-event-${event!.eventId}`))
    const eventDialog = dialog('Event', event!.eventId)
    expect(eventDialog.textContent).toContain(event!.eventType)
    const traceId = event!.sourceTraceIds.find(id => slice.traces.some(t => t.traceId === id))!
    expect(traceId).toBeDefined()
    fireEvent.click(within(eventDialog).getByTestId(`document-link-trace-${traceId}`))
    const traceDialog = dialog('Trace', traceId)
    expect(traceDialog.textContent).toContain(slice.traces.find(t => t.traceId === traceId)!.ruleId)
    expect(traceDialog.textContent).toContain('参照元: 出来事：')
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
  })

  it('実集団の資料は同じ参照で年表を絞り込み、人物資料を残す', () => {
    const history = historyFromObservation(slice).at(1260)
    const person = slice.world.persons.find(p => slice.world.groups.some(g => g.groupId === p.originGroupId))!
    expect(person).toBeDefined()
    const group = slice.world.groups.find(g => g.groupId === person.originGroupId)!
    const onFilter = vi.fn()
    render(<DeskDocuments history={history} slice={slice} onFilter={onFilter} openRequest={{ requestId: 'p', ref: history.ref, target: { kind: 'person', id: person.personId } }} />)
    const personDialog = dialog('人物', person.personId)
    fireEvent.click(within(personDialog).getByRole('button', { name: group.name }))
    const groupDoc = dialog('集団', group.groupId)
    expect(groupDoc.textContent).toContain('参照元: 人物：')
    fireEvent.click(within(groupDoc).getByRole('button', { name: '年代記で絞る' }))
    expect(onFilter).toHaveBeenCalledWith({ kind: 'group', id: group.groupId }, history.ref, undefined)
    fireEvent.click(within(groupDoc).getByRole('button', { name: '戻る' }))
    expect(screen.getByTestId('desk-document').dataset.target).toBe(person.personId)
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
    const pairDoc = dialog('Trace', trace.traceId)
    fireEvent.click(within(pairDoc).getByTestId(`document-link-person-${first}`))
    expect(dialog('人物', first)).toBeTruthy()
    fireEvent.click(within(dialog('人物', first)).getByRole('button', { name: '戻る' }))
    fireEvent.click(within(dialog('Trace', trace.traceId)).getByTestId(`document-link-person-${second}`))
    expect(dialog('人物', second)).toBeTruthy()
  })

  it('信頼を参照した実B-004だけが、取得済みの同じ原史とペアを介入フォームへ渡す', () => {
    const slice = initialSlice
    const trace = slice.traces.find(t => t.ruleId === 'B-004' && t.actorRef.kind === 'PERSON_PAIR' &&
      t.candidates.some(c => typeof c.inputs?.effectiveTrust === 'number') && t.actorRef.ids.every(id =>
        slice.world.persons.some(p => p.personId === id && p.alive && p.interactionRole !== 'SUPPORTING')))
    if (trace?.actorRef.kind !== 'PERSON_PAIR') throw new Error('介入適格な実判断がありません')
    const [left, right] = trace.actorRef.ids
    const history = historyFromObservation(slice).at(slice.year)
    const target = { kind: 'trace' as const, id: trace.traceId }
    const onIntervene = vi.fn()
    const common = { history, slice, onIntervene }
    const { rerender } = render(<DeskDocuments {...common} openRequest={{ requestId: 'actual', ref: history.ref, target }} />)
    const action = /この2人の信頼を介入として検討する/
    const live = within(screen.getByRole('dialog'))
    expect(live.getByTestId('recorded-effective-trust')).toHaveProperty('textContent', expect.stringContaining('採用の閾値'))
    fireEvent.click(live.getByRole('button', { name: action }))
    expect(onIntervene).toHaveBeenCalledExactlyOnceWith(slice.year, left, right, history.ref, { history, traceId: trace.traceId })
    // 比較が持つ同じA0参照でも、取得した出典は読み取り専用。
    rerender(<DeskDocuments {...common} openRequest={{ requestId: 'pinned', ref: history.ref, target, history, sourceHistory: history, comparison: {} as PlayView }} />)
    const pinned = within(screen.getAllByRole('dialog').at(-1)!)
    expect(pinned.queryByRole('button', { name: action })).toBeNull()
    expect(pinned.getByText('この資料は参照専用です。')).toBeTruthy()
  })

  it('同じ参照でも各窓が取得範囲の異なる判断を混ぜない', () => {
    const history = historyFromObservation(slice).at(slice.year)
    const trace = slice.traces[0]!
    expect(trace).toBeDefined()
    // 転送省略のテスト用fixture。実Traceは完全な観測から取得する。
    const omitted = { ...history, trace: () => ({ kind: 'POSSIBLY_OMITTED' as const }) }
    const target = { kind: 'trace' as const, id: trace.traceId }
    const dto = {} as PlayView, otherDto = {} as PlayView
    const { rerender } = render(<DeskDocuments history={history} openRequest={{ requestId: 'omitted', ref: history.ref, target, history: omitted, sourceHistory: omitted, comparison: dto }} />)
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '固定' }))
    rerender(<DeskDocuments history={history} openRequest={{ requestId: 'complete', ref: history.ref, target, history, sourceHistory: history, comparison: otherDto }} />)
    expect(screen.getAllByRole('dialog')).toHaveLength(2)
    expect(document.querySelector('[data-slot="fixed"]')?.textContent).toContain('転送省略の可能性')
    expect(document.querySelector('[data-slot="fixed"]')?.textContent).not.toContain('実判断:')
    expect(document.querySelector('[data-slot="work"]')?.textContent).toContain(`実判断: ${trace.ruleId}`)
    rerender(<DeskDocuments history={history} openRequest={{ requestId: 'same', ref: history.ref, target, history, sourceHistory: omitted, comparison: dto }} />)
    expect(document.activeElement?.getAttribute('data-slot')).toBe('fixed')
    expect(screen.getAllByRole('dialog')).toHaveLength(2)
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
    expect(dialog('Event', event.eventId).textContent).toContain('未計算')
    rerender(<DeskDocuments history={pending} openRequest={traceRequest} />)
    const traceDialog = dialog('Trace', trace.traceId)
    expect(traceDialog.textContent).toContain('未計算')
    rerender(<DeskDocuments history={history} openRequest={traceRequest} />)
    expect(traceDialog.textContent).toContain(`実判断: ${trace.ruleId}`)
    fireEvent.click(within(traceDialog).getByRole('button', { name: '戻る' }))
    expect(dialog('Event', event.eventId).textContent).toContain(event.eventType)
  })

  it('明示された比較由来の未取得・未計算資料を別出典の共通historyで昇格しない', () => {
    const history = historyFromObservation(slice).at(slice.year)
    const person = slice.world.persons[0]!
    const trace = slice.traces[0]!
    expect(trace).toBeDefined()
    // 比較由来DTOの取得状態を模したfixture。同一refでも出典が異なる。
    const notLoaded = { ...history, start: { kind: 'NOT_LOADED' as const }, records: { kind: 'NOT_LOADED' as const } }
    const uncomputed = { ...history, records: { kind: 'UNCOMPUTED' as const }, trace: () => ({ kind: 'UNCOMPUTED' as const }) }
    const comparison = {} as PlayView
    const first = { requestId: 'explicit-unloaded', ref: history.ref, target: { kind: 'person' as const, id: person.personId }, history: notLoaded, sourceHistory: notLoaded, comparison }
    const second = { requestId: 'explicit-uncomputed', ref: history.ref, target: { kind: 'trace' as const, id: trace.traceId }, history: uncomputed, sourceHistory: uncomputed, comparison }
    const { rerender } = render(<DeskDocuments openRequest={first} />)
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '固定' }))
    rerender(<DeskDocuments history={history} openRequest={second} />)
    expect(dialog('人物', person.personId).textContent).toContain('未取得')
    expect(dialog('人物', person.personId).textContent).not.toContain(person.name)
    expect(dialog('Trace', trace.traceId).textContent).toContain('未計算')
    expect(dialog('Trace', trace.traceId).textContent).not.toContain('実判断:')
  })

  it('明示比較資料から別年へ進む時は共通historyを混ぜず出典を通知する', () => {
    const { id, slice } = newborn!
    const history = historyFromObservation(slice).at(slice.year)
    const birth = slice.personRecords.find(p => p.personId === id)!.birthEvidence
    if (birth.kind !== 'BIRTH_EVENT') throw new Error('出生記録なし')
    const onResolve = vi.fn(), onYear = vi.fn(), comparison = {} as PlayView
    const request = { requestId: 'compare-birth', ref: history.ref, target: { kind: 'event' as const, id: birth.eventId }, history, sourceHistory: history, comparison }
    const { rerender } = render(<DeskDocuments history={history} slice={slice} openRequest={request} onResolve={onResolve} onYear={onYear} />)
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: /年初の出生人物/ }))
    const notice = onResolve.mock.calls[0]![0]
    expect(notice.ref.year).toBe(slice.year + 1)
    expect(notice.sourceHistory).toBe(history)
    expect(notice.comparison).toBe(comparison)
    expect(onYear).not.toHaveBeenCalled()
    rerender(<DeskDocuments history={{ ...history, ref: notice.ref }} openRequest={request} onResolve={onResolve} onYear={onYear} />)
    expect(dialog('人物', id).textContent).toContain('未取得')
  })

  it('比較資料の絞り込みは同じrefの通常観測と区別できる出典を渡す', () => {
    const history = historyFromObservation(slice).at(slice.year)
    const sourceHistory = { ...history }
    const target = { kind: 'person' as const, id: slice.world.persons[0]!.personId }
    const onFilter = vi.fn()
    render(<DeskDocuments history={history} slice={slice} onFilter={onFilter}
      openRequest={{ requestId: 'comparison-filter', ref: history.ref, target, history: sourceHistory, sourceHistory, comparison: {} as PlayView }} />)
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '比較で絞る' }))
    const [actualTarget, actualRef, context] = onFilter.mock.calls[0]!
    expect(actualTarget).toEqual(target)
    expect(actualRef).toBe(history.ref)
    expect(context).toBe(sourceHistory)
  })

  it('明示未取得資料の同出典結果を指定窓だけに反映する', () => {
    const history = historyFromObservation(slice).at(slice.year)
    const person = slice.world.persons[0]!
    const pending = { ...history, start: { kind: 'NOT_LOADED' as const }, records: { kind: 'NOT_LOADED' as const } }
    const comparison = {} as PlayView
    const request = { requestId: 'pinned-load', ref: history.ref, target: { kind: 'person' as const, id: person.personId }, history: pending, sourceHistory: pending, comparison }
    const onResolve = vi.fn()
    const { rerender } = render(<DeskDocuments openRequest={request} onResolve={onResolve} />)
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '取得' }))
    expect(onResolve).toHaveBeenCalledWith(expect.objectContaining(request))
    const update = { requestId: request.requestId, history, ref: history.ref, comparison }
    for (const malformed of [{ ...update, requestId: 'old' }, { ...update, comparison: {} as PlayView }]) {
      rerender(<DeskDocuments openRequest={request} historyUpdate={malformed} />)
      expect(screen.getByRole('dialog').textContent).toContain('未取得')
    }
    rerender(<DeskDocuments openRequest={request} historyUpdate={update} />)
    expect(screen.getByRole('dialog').textContent).toContain(person.name)
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
  })

  it('実枝にいない人物を実在人物の資料で置き換えない', () => {
    const history = historyFromObservation(slice).at(1260)
    const id = 'test-person-not-in-this-branch'
    render(<DeskDocuments history={history} slice={slice} openRequest={{ requestId: 'absent', ref: history.ref, target: { kind: 'person', id } }} onResolve={vi.fn()} onYear={vi.fn()} onFilter={vi.fn()} onIntervene={vi.fn()} />)
    const dialog = screen.getByRole('dialog')
    expect(dialog.textContent).toContain('この枝に存在を確認できない')
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
      { ...ref, origin: { ...ref.origin, configuration: { ...ref.origin.configuration, configIdentity: 'same-digest-different-identity' } } },
    ]
    const { rerender } = render(<DeskDocuments history={history} slice={slice} />)
    variants.forEach((wrong, index) => {
      rerender(<DeskDocuments history={history} slice={slice} openRequest={{ requestId: `mismatch-${index}`, ref: wrong, target: { kind: 'person', id: person.personId } }} />)
      const doc = screen.getByRole('dialog')
      expect(doc.textContent).toContain('未取得')
      expect(doc.textContent).not.toContain(person.name)
    })
  })

  it('既に観測中の別年を古い人物窓から開いても未取得のままにしない', () => {
    const original = historyFromObservation(slice).at(slice.year)
    const current = historyFromObservation(initialSlice).at(initialSlice.year)
    const record = slice.personRecords.find(r => slice.world.persons.some(p => p.personId === r.personId) && r.titles.some(t => t.fromYear === initialSlice.year))!
    const title = record.titles.find(t => t.fromYear === initialSlice.year)!
    const request = { requestId: 'previous', ref: original.ref, target: { kind: 'person' as const, id: record.personId } }
    const { rerender } = render(<DeskDocuments history={original} slice={slice} openRequest={request} />)
    rerender(<DeskDocuments history={current} slice={initialSlice} openRequest={request} />)
    const person = within(screen.getByRole('dialog'))
    fireEvent.click(within(person.getByTestId('history-titles')).getAllByRole('button', { name: title.label })[0]!)
    const target = dialog('称号', title.titleId)
    expect(within(target).getByTestId('document-reference').textContent).toContain('1250年')
    expect(target.textContent).toContain('年初の保持者')
    expect(target.textContent).not.toContain('未取得')
    expect(screen.getAllByRole('dialog')).toHaveLength(1)
  })

  it('実出生年の人物窓は年初の不在と初出年への導線を分ける', () => {
    expect(newborn).toBeDefined()
    const { id, slice } = newborn!
    const history = historyFromObservation(slice).at(slice.year)
    const onResolve = vi.fn(), onYear = vi.fn()
    render(<DeskDocuments history={history} slice={slice} onResolve={onResolve} onYear={onYear}
      openRequest={{ requestId: 'newborn', ref: history.ref, target: { kind: 'person', id } }} />)
    const dialog = within(screen.getByRole('dialog'))
    expect(dialog.getByText(/年初は出生前/)).toBeTruthy()
    const firstYear = slice.personRecords.find(p => p.personId === id)!.firstYear
    fireEvent.click(within(dialog.getByTestId('history-not-yet')).getByRole('button', { name: `${firstYear}年初へ移動` }))
    expect(onResolve).toHaveBeenCalledWith(expect.objectContaining({ ref: { ...history.ref, year: firstYear } }))
    expect(onYear).not.toHaveBeenCalled()
    expect(screen.getByTestId('document-reference').textContent).toContain(`${firstYear}年`)
  })

  it('同じdigestの別の完全構成を共通・明示・更新の各経路で拒否する', () => {
    const available = historyFromObservation(slice).at(slice.year)
    // digestの衝突だけを模したDTO。世界状態・人物は実A0のまま。
    const origin = available.ref.origin
    const expected = { ...available.ref, origin: { ...origin, configuration: { ...origin.configuration, configIdentity: '要求の完全構成' } } }
    const other = { ...available, ref: { ...available.ref, origin: { ...origin, configuration: { ...origin.configuration, configIdentity: '別の完全構成' } } } }
    const target = { kind: 'person' as const, id: slice.world.persons[0]!.personId }
    const comparison = {} as PlayView
    const explicit = { requestId: 'explicit', ref: expected, target, history: other, sourceHistory: other, comparison }
    const { rerender } = render(<DeskDocuments history={other} openRequest={{ requestId: 'shared', ref: expected, target }} />)
    rerender(<DeskDocuments history={other} openRequest={explicit} historyUpdate={{ requestId: 'explicit', ref: expected, history: other, comparison }} />)
    for (const dialog of screen.getAllByRole('dialog')) {
      expect(dialog.textContent).toContain('未取得')
      expect(dialog.textContent).not.toContain(slice.world.persons[0]!.name)
    }
    rerender(<DeskDocuments history={{ ...available, ref: expected }} openRequest={explicit} />)
    expect(screen.getByRole('dialog').textContent).toContain('未取得')
    fireEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '戻る' }))
    expect(screen.getByRole('dialog').textContent).toContain(slice.world.persons[0]!.name)
  })

  it('別のseedの参照を現在の記録で埋めない', () => {
    const history = historyFromObservation(slice).at(1260)
    const person = slice.world.persons[0]!
    const ref = { ...history.ref, origin: { ...history.ref.origin, seed: history.ref.origin.seed + 1 } }
    render(<DeskDocuments history={history} slice={slice} openRequest={{ requestId: 'wrong', ref, target: { kind: 'person', id: person.personId } }} onResolve={vi.fn()} onYear={vi.fn()} onFilter={vi.fn()} onIntervene={vi.fn()} />)
    expect(screen.getByRole('dialog').textContent).toContain('未取得')
  })
})
