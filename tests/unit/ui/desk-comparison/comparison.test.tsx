// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { EventLogEntry, DecisionTrace } from '../../../../src/simulation/contracts/index.ts'
import { PLAY_DEFAULT_MODE, playConfigId, playModifierId } from '../../../../src/ui/branch-play-source.ts'
import type { PlayView } from '../../../../src/ui/branch-play-source.ts'
import { pendingExperimentalRun } from '../../../../src/ui/timeline-source.ts'
import { comparisonHistoryAt, investigationForIntervention, investigationFromLink } from '../../../../src/ui/desk/comparison/investigation.ts'
import { comparisonAt, DeskComparison } from '../../../../src/ui/desk/comparison/DeskComparison.tsx'

// 計算を実行しないDTO fixture。実履歴・ゲーム結果ではない。
function fixture(): PlayView {
  const seed = 1, year = 1250
  const input = { seed, year, firstPersonId: 'a', secondPersonId: 'b', signedDelta: 20, durationYears: 5 }
  const id = playModifierId(year, ['a', 'b'], 20, 5)
  const base = pendingExperimentalRun(seed)
  const event = { eventId: 'event-1', eventType: 'FIXTURE', semanticEventKey: 'fixture', stateChanges: [], sourceTraceIds: [], year, phase: 1, involvedRefs: [{ kind: 'PERSON', id: 'a' }] } as EventLogEntry
  const trace = { traceId: 'trace-1', ruleId: 'B-004', year, phase: 1, status: 'DEFER', actorRef: { kind: 'PERSON', id: 'a' }, candidates: [], eventIds: [], reasonCodes: [], modifierIds: [], ruleVersion: 'fixture' } as DecisionTrace
  const run = (branchId: string, ids: string[], withRecords: boolean) => ({
    ...base, pending: undefined, inputs: { ...base.inputs, configId: playConfigId(PLAY_DEFAULT_MODE) }, playModifierIds: ids,
    result: { ...base.result, branchId, snapshots: [base.initialWorld, { ...base.initialWorld, year: 1251 }], transitions: 1,
      eventLog: withRecords ? [event] : [], decisionTraces: withRecords ? [trace] : [] },
  })
  return { mode: PLAY_DEFAULT_MODE, input, modifier: { modifierId: id } as PlayView['modifier'],
    a0: run('A0-play', [], false), a1: run('A1-play', [id], true) }
}
afterEach(cleanup)

it('実参照境界の比較を使い枝ごとのEventとEventのない判断を区別して開き、元文脈に戻る', () => {
  const view = fixture(), comparison = comparisonAt(view, 'A0_A1', 1250)!
  const context = { history: comparison.before, target: { kind: 'person' as const, id: 'a' }, evidence: { kind: 'trace' as const, id: 'old' } }
  const onReturn = vi.fn(), onEvidence = vi.fn()
  render(<DeskComparison view={view} pair="A0_A1" year={1250} target={context.target} context={context} onReturn={onReturn} onEvidence={onEvidence}/>)
  const before = within(screen.getByRole('region', { name: 'A0の記録' }))
  const after = within(screen.getByRole('region', { name: 'A1の記録' }))
  expect(before.queryByTestId('comparison-event-event-1')).toBeNull()
  fireEvent.click(after.getByTestId('comparison-event-event-1'))
  expect(onEvidence.mock.calls[0]![0]).toMatchObject({ history: { ref: { year: 1250, origin: { branch: 'A1' } } }, kind: 'event', id: 'event-1' })
  fireEvent.click(after.getByTestId('comparison-trace-trace-1'))
  expect(onEvidence.mock.calls[1]![0]).toMatchObject({ kind: 'trace', id: 'trace-1' })
  fireEvent.click(screen.getByRole('button', { name: '元の調査へ戻る' }))
  expect(onReturn).toHaveBeenCalledWith(context)
})

it('A1→A2の元比較の省略範囲を根拠へ渡し、未記録を他枝から補わない', () => {
  const original = fixture()
  const secondInput = { ...original.input, firstPersonId: 'a', secondPersonId: 'c' }
  const id = playModifierId(1250, ['a', 'c'], 20, 5)
  const counts = { omittedEventsByType: { FIXTURE: 1 }, omittedTracesByRule: {} }
  const second: PlayView = { mode: original.mode, input: secondInput, modifier: { modifierId: id } as PlayView['modifier'],
    a0: { ...original.a1, logsOmitted: true },
    a1: { ...original.a1, playModifierIds: [original.modifier.modifierId, id], result: { ...original.a1.result, branchId: 'A2-play', eventLog: [] }, logsOmitted: true },
    displayOmission: { ...counts, fullEventCount: { a0: 2, a1: 1 }, fullTraceCount: { a0: 1, a1: 1 }, byYear: { 1250: counts } } }
  const view = { ...original, second }
  const comparison = comparisonAt(view, 'A1_A2', 1250)!
  const onEvidence = vi.fn()
  render(<DeskComparison view={view} pair="A1_A2" year={1250} context={{ history: comparison.before }} onReturn={() => {}} onEvidence={onEvidence}/>)
  const before = within(screen.getByRole('region', { name: 'A1の記録' }))
  const after = within(screen.getByRole('region', { name: 'A2の記録' }))
  fireEvent.click(before.getByTestId('comparison-event-event-1'))
  const request = onEvidence.mock.calls[0]![0]
  expect(request.history.ref.origin.branch).toBe('A1')
  expect(request.history.records.coverage.kind).toBe('TRANSFER_OMISSION')
  const fromSecond = comparisonHistoryAt({ view, pair: 'A1_A2' }, request.history.ref)
  const fromFirst = comparisonHistoryAt({ view, pair: 'A0_A1' }, request.history.ref)
  expect(fromSecond?.records).toMatchObject({ coverage: { kind: 'TRANSFER_OMISSION' } })
  expect(fromFirst?.records).toMatchObject({ coverage: { kind: 'COMPLETE' } })
  expect(comparisonHistoryAt({ view, pair: 'A1_A2' }, comparisonAt(view, 'A0_A1', 1250)!.before.ref)).toBeUndefined()
  expect(request.history.event('missing', 'FIXTURE').kind).toBe('POSSIBLY_OMITTED')
  expect(after.queryByTestId('comparison-event-event-1')).toBeNull()
  expect(comparison.after.event('event-1', 'FIXTURE').kind).toBe('POSSIBLY_OMITTED')
})

it('第1・第2介入入力年が異なる場合は各年を示し比較不能とし、未添付を推測しない', () => {
  const original = fixture()
  const year = 1251
  const input = { ...original.input, year, secondPersonId: 'c' }
  const id = playModifierId(year, ['a', 'c'], 20, 5)
  const second: PlayView = { ...original, input, modifier: { modifierId: id } as PlayView['modifier'],
    a0: original.a1, a1: { ...original.a1, playModifierIds: [original.modifier.modifierId, id], result: { ...original.a1.result, branchId: 'A2-play' } } }
  const context = { history: comparisonAt(original, 'A0_A1', 1250)!.before }
  const { rerender } = render(<DeskComparison view={{ ...original, second }} pair="A1_A2" year={1250} context={context} onReturn={() => {}} onEvidence={() => {}}/>)
  expect(screen.getByText('第1介入入力年 1250年／第2介入入力年 1251年')).toBeTruthy()
  expect(screen.getByText('この比較は取得できません。')).toBeTruthy()
  rerender(<DeskComparison view={original} pair="A1_A2" year={1250} context={context} onReturn={() => {}} onEvidence={() => {}}/>)
  expect(screen.queryByText(/第2介入入力年/)).toBeNull()
})

it('対象外の差を含めず、対象の年初実値と介入年・観測年を区別する', () => {
  const original = fixture()
  const person = original.a0.initialWorld.persons[0]!
  const changedWorld = { ...original.a1.initialWorld, persons: original.a1.initialWorld.persons.map(p => p.personId === person.personId ? { ...p, name: '状態差fixture' } : p) }
  const view: PlayView = { ...original, a1: { ...original.a1, result: { ...original.a1.result, snapshots: [changedWorld, ...original.a1.result.snapshots.slice(1)] } } }
  const comparison = comparisonAt(view, 'A0_A1', 1250)!
  render(<DeskComparison view={view} pair="A0_A1" year={1250} target={{ kind: 'person', id: person.personId }} context={{ history: comparison.before }} onReturn={() => {}} onEvidence={() => {}}/>)
  expect(screen.getByText(/対象年初状態: 実値に差あり/)).toBeTruthy()
  expect(screen.getByText(/介入年 1250年／観測年 1250年/)).toBeTruthy()
  expect(within(screen.getByRole('region', { name: '記録差分' })).getByText(/Event 0件／判断Trace 0件/)).toBeTruthy()
  expect(screen.getByRole('region', { name: 'A1の記録' }).textContent).toContain('状態差fixture')
})

it('対応不明の判断は両枝を並べ、恣意的に対応させない', () => {
  const original = fixture()
  const trace = original.a1.result.decisionTraces[0]!
  const a0 = { ...original.a0, result: { ...original.a0.result, decisionTraces: [{ ...trace, traceId: 'before-1' }, { ...trace, traceId: 'before-2' }] } }
  const a1 = { ...original.a1, result: { ...original.a1.result, decisionTraces: [{ ...trace, traceId: 'after-1' }, { ...trace, traceId: 'after-2' }] } }
  const view = { ...original, a0, a1 }
  const comparison = comparisonAt(view, 'A0_A1', 1250)!
  render(<DeskComparison view={view} pair="A0_A1" year={1250} context={{ history: comparison.before }} onReturn={() => {}} onEvidence={() => {}}/>)
  const changes = within(screen.getByRole('region', { name: '記録差分' }))
  expect(changes.getByText(/AMBIGUOUS（対応不明）/)).toBeTruthy()
  expect(changes.getByTestId('comparison-trace-before-1')).toBeTruthy()
  expect(changes.getByTestId('comparison-trace-after-2')).toBeTruthy()
})

it('片枝のEvent欠落で見かけの判断差が生じる場合も対応・内容差を暫定と明示する', () => {
  const original = fixture()
  const trace = { ...original.a1.result.decisionTraces[0]!, eventIds: ['event-1'] }
  const a0 = { ...original.a0, result: { ...original.a0.result, decisionTraces: [trace] } }
  const a1 = { ...original.a1, result: { ...original.a1.result, decisionTraces: [trace] } }
  const counts = { omittedEventsByType: { FIXTURE: 1 }, omittedTracesByRule: {} }
  const view: PlayView = { ...original, a0, a1, displayOmission: { ...counts, fullEventCount: { a0: 1, a1: 2 }, fullTraceCount: { a0: 1, a1: 1 }, byYear: { 1250: counts } } }
  const comparison = comparisonAt(view, 'A0_A1', 1250)!
  expect(comparison.changes!.traces[0]?.kind).toBe('CHANGED')
  render(<DeskComparison view={view} pair="A0_A1" year={1250} context={{ history: comparison.before }} onReturn={() => {}} onEvidence={() => {}}/>)
  const changes = within(screen.getByRole('region', { name: '記録差分' }))
  expect(changes.getByText(/判断の一対一対応・内容差も完全記録で確定できません/)).toBeTruthy()
  expect(changes.getByText(/片枝のEvent省略だけでも/)).toBeTruthy()
  expect(changes.getByText(/対応する判断に内容差/)).toBeTruthy()
})

it('評価年の年内記録を差分ゼロと表示しない', () => {
  const original = fixture()
  const evaluated = (run: PlayView['a0']) => ({ ...run, result: { ...run.result, snapshots: [{ ...run.initialWorld, year: 1350 }] } })
  const view = { ...original, a0: evaluated(original.a0), a1: evaluated(original.a1) }
  const comparison = comparisonAt(view, 'A0_A1', 1350)!
  render(<DeskComparison view={view} pair="A0_A1" year={1350} context={{ history: comparison.before }} onReturn={() => {}} onEvidence={() => {}}/>)
  expect(screen.getByText(/評価年は年内Event・Traceを比較しません/)).toBeTruthy()
  expect(screen.queryByRole('region', { name: '記録差分' })).toBeNull()
})

it('停止・省略・存在不明を空の確定履歴としない', () => {
  const original = fixture()
  const counts = { omittedEventsByType: { FIXTURE: 1 }, omittedTracesByRule: {} }
  const view: PlayView = { ...original, displayOmission: { ...counts, fullEventCount: { a0: 1, a1: 2 }, fullTraceCount: { a0: 0, a1: 1 }, byYear: { 1250: counts } } }
  const comparison = comparisonAt(view, 'A0_A1', 1250)!
  render(<DeskComparison view={view} pair="A0_A1" year={1250} target={{ kind: 'person', id: 'missing' }} context={{ history: comparison.before }} onReturn={() => {}} onEvidence={() => {}}/>)
  expect(screen.getAllByText(/転送省略あり/)).toHaveLength(2)
  expect(screen.getAllByText(/UNKNOWN/)).toHaveLength(2)
  cleanup()
  const halted: PlayView = { ...original, a0: { ...original.a0, result: { ...original.a0.result, status: 'HALTED', snapshots: [original.a0.initialWorld], halt: { year: 1250 } as NonNullable<PlayView['a0']['result']['halt']> } } }
  render(<DeskComparison view={halted} pair="A0_A1" year={1250} context={{ history: comparison.before }} onReturn={() => {}} onEvidence={() => {}}/>)
  expect(screen.getByText(/差分は表示できません/)).toBeTruthy()
  expect(screen.getByText('年内記録: 計算停止（HALTED）')).toBeTruthy()
})

it('調査リンクは元の HistoryYear を保持し、同じIDでも異なる枝の根拠を補わない', () => {
  const { before, after } = comparisonAt(fixture(), 'A0_A1', 1250)!
  const request = { ref: after.ref, source: { kind: 'person', id: 'a' }, target: { kind: 'trace', id: 'trace-1' } } as const
  expect(investigationFromLink(after, request)?.history).toBe(after)
  expect(investigationFromLink(before, request)).toBeUndefined()
  expect(investigationFromLink(before, { ...request, ref: before.ref })).toBeUndefined()
})

it('同じ人物・年でも、選んだペアと異なる根拠や曖昧な根拠は復帰に使わない', () => {
  const original = fixture()
  const trace = original.a1.result.decisionTraces[0]!
  const traces = [
    { ...trace, traceId: 'ab', actorRef: { kind: 'PERSON_PAIR', ids: ['a', 'b'] } } satisfies DecisionTrace,
    { ...trace, traceId: 'ac', actorRef: { kind: 'PERSON_PAIR', ids: ['a', 'c'] } } satisfies DecisionTrace,
  ]
  const view = { ...original, a1: { ...original.a1, result: { ...original.a1.result, decisionTraces: traces } } }
  const history = comparisonAt(view, 'A0_A1', 1250)!.after
  const contexts = traces.map(t => ({ history, target: { kind: 'person', id: 'a' }, evidence: { kind: 'trace', id: t.traceId } }) as const)
  expect(investigationForIntervention(history, contexts, 'a', 'b').evidence?.id).toBe('ab')
  expect(investigationForIntervention(history, contexts, 'a', 'c').evidence?.id).toBe('ac')
  expect(investigationForIntervention(history, contexts, 'a', 'd').evidence).toBeUndefined()
  expect(investigationForIntervention(history, contexts, 'a').evidence).toBeUndefined()
})

it('同じ保持者の表示名だけが変わっても称号の年初状態に差を作らない', () => {
  const original = fixture()
  const title = original.a0.initialWorld.titles.find(t => t.holder.status === 'HELD')!
  if (title.holder.status !== 'HELD') throw new Error('fixture の保持者が未確定')
  const holderId = title.holder.personId
  const changedWorld = { ...original.a1.initialWorld, persons: original.a1.initialWorld.persons
    .map(p => p.personId === holderId ? { ...p, name: '表示名のみ変更' } : p) }
  const view = { ...original, a1: { ...original.a1, result: { ...original.a1.result,
    snapshots: [changedWorld, ...original.a1.result.snapshots.slice(1)] } } }
  const history = comparisonAt(view, 'A0_A1', 1250)!.before
  render(<DeskComparison view={view} pair="A0_A1" year={1250} target={{ kind: 'title', id: title.titleId }} context={{ history }} onReturn={() => {}} onEvidence={() => {}}/>)
  expect(screen.getByText(/対象年初状態: 実値に差なし/)).toBeTruthy()
})
