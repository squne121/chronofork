// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeAll, expect, it, vi } from 'vitest'
import { createExperimentalIntegratedTimelineOptions } from '../../../src/scenario/experimental/index.ts'
import type { DecisionTrace, EventLogEntry, WorldState } from '../../../src/simulation/contracts/index.ts'
import { runYear } from '../../../src/simulation/engine/index.ts'
import { HistoryPanel, involves, targetOptions } from '../../../src/ui/HistoryPanel.tsx'
import { marriageAgreementTrace, unresolvedLabel } from '../../../src/ui/event-summary.ts'
import type { ObservationSlice } from '../../../src/ui/branch-play-source.ts'
import { indexWorld, worldWithHistoricPersons } from '../../../src/ui/inspection-source.ts'
import { eventHeadline, namesOfYear } from '../../../src/ui/integrated-overview.ts'
import { ObservationPanel } from '../../../src/ui/observation/ObservationPanel.tsx'
import { baseDisplayName, personIdTag } from '../../../src/ui/observation/person-display.ts'
import { indexHistory, pendingExperimentalRun } from '../../../src/ui/timeline-source.ts'

let before: WorldState
let after: WorldState
let event: EventLogEntry
let traces: readonly DecisionTrace[]
let support: WorldState['persons'][number]

afterEach(cleanup)
beforeAll(() => {
  const setup = createExperimentalIntegratedTimelineOptions('A0-play')
  before = setup.world
  // 成立Eventを捏造せず、統合A0の共通構成で登録が確定するまで年を進める。
  for (let year = before.year; year <= 1312; year++) {
    const r = runYear(before, setup.options)
    if (r.status !== 'COMPLETED') throw new Error(JSON.stringify(r.halt))
    const found = r.events.find(e => e.eventType === 'MARRIAGE_REGISTER' && e.supportingMarriageRegistrations?.length)
    if (found) {
      event = found
      after = r.world
      traces = r.traces
      support = found.supportingMarriageRegistrations![0]!.registration.person
      return
    }
    before = r.world
  }
  throw new Error('統合A0の確定済みSUPPORTING登録が見つからない')
}, 90_000)

function show(e: EventLogEntry, w: WorldState, next: WorldState, allTraces = traces, traceId?: string) {
  const result = { ...pendingExperimentalRun(1).result, snapshots: [w, next], eventLog: [e], decisionTraces: allTraces }
  const onTarget = vi.fn()
  const onTrace = vi.fn()
  render(<HistoryPanel result={result} history={indexHistory(result)} index={indexWorld(w)}
    refIndex={indexWorld(worldWithHistoricPersons(w, result.snapshots))} year={e.year} scope="year" targetKey=""
    events={[e]} allEvents={[e]} eventId={e.eventId} traceId={traceId} onScope={() => {}} onTarget={onTarget}
    onEvent={() => {}} onTrace={onTrace} onSelect={() => {}} />)
  return { onTarget, onTrace }
}

it('統合A0の実婚姻は一覧・詳細・対象フィルタで補助人物名を表示し、法的判断と同意の記録を保持する', () => {
  expect(support.name).toBe(support.personId)
  expect(support.personId).toMatch(/^support:population:/)
  expect(before.persons.some(p => p.personId === support.personId)).toBe(false)
  const label = baseDisplayName(support)
  const { onTarget, onTrace } = show(event, before, after)
  const list = within(screen.getByTestId('chronicle-list')).getByRole('button')
  const detail = within(screen.getByTestId('event-detail'))
  for (const node of [list, detail.getByRole('heading', { level: 3 })]) {
    expect(node.textContent).toContain(label)
    expect(node.textContent).not.toContain(support.personId)
  }
  expect(detail.getByText(new RegExp(`^${label}.*・|・${label}`)).textContent).not.toContain(support.personId)
  const filter = screen.getByTestId('event-target')
  const options = within(filter).getAllByRole<HTMLOptionElement>('option', { name: new RegExp(label) })
  expect(options).toHaveLength(2) // ペア・単独の両方
  for (const option of options) {
    expect(option.textContent).not.toContain(support.personId)
    fireEvent.change(filter, { target: { value: option.value } })
    expect(onTarget).toHaveBeenLastCalledWith(option.value)
    expect(involves(event, option.value)).toBe(true)
  }

  const legal = traces.find(t => t.traceId === event.sourceTraceIds[0])!
  expect(legal).toMatchObject({ ruleId: 'A-LEG-01', status: 'ACCEPT', eventIds: [event.eventId] })
  const marriage = after.legal.marriages.find(m => m.marriageId === event.supportingMarriageRegistrations![0]!.marriageId)!
  const agreement = traces.find(t => marriage.contract?.evidenceId === `evidence:nextgen-agreement:${t.traceId}`)!
  expect(agreement).toMatchObject({ ruleId: 'B-005', status: 'ACCEPT', eventIds: [] })
  fireEvent.click(detail.getByRole('button', { name: /法的判断.*A-LEG-01/ }))
  expect(onTrace).toHaveBeenLastCalledWith(legal.traceId)
  fireEvent.click(detail.getByRole('button', { name: /合意.*B-005/ }))
  expect(onTrace).toHaveBeenLastCalledWith(agreement.traceId)
  expect(event.sourceTraceIds).not.toContain(agreement.traceId)
  expect(marriageAgreementTrace(event, () => ({ ...agreement, actorRef: { kind: 'PERSON_PAIR', ids: [support.personId, 'unrelated-person'] } }))).toBeUndefined()
  const technical = detail.getByTestId('event-state-details') as HTMLDetailsElement
  expect(technical.open).toBe(false)
  expect(technical.textContent).toContain(support.personId)
  expect(technical.textContent).toContain(marriage.contract!.evidenceId)
})

it('統合年内表示は確定した登録を解決し、参照だけでは登録や名前を作らない', () => {
  const label = baseDisplayName(support)
  const sameYear = namesOfYear(before, [event])
  expect(sameYear.person(support.personId)).toBe(label)
  expect(eventHeadline(event, sameYear, '婚姻の成立')).toContain(label)
  expect(eventHeadline(event, sameYear, '婚姻の成立')).not.toContain(support.personId)
  const unconfirmed = { ...event, supportingMarriageRegistrations: [],
    stateChanges: event.stateChanges.filter(c => c.path !== `$.persons[${support.personId}]`) }
  const names = namesOfYear(before, [unconfirmed])
  expect(names.person(support.personId)).toBeUndefined()
  expect(eventHeadline(unconfirmed, names, '婚姻の成立')).toContain(unresolvedLabel('person', support.personId))
  expect(namesOfYear({ ...before, year: before.year - 1 }, [event]).person(support.personId)).toBeUndefined()
})

it('既存の原史観測では法的判断をEventから、当事者合意を技術Trace一覧から開ける', () => {
  const legal = traces.find(t => t.traceId === event.sourceTraceIds[0])!
  const marriage = after.legal.marriages.find(m => m.marriageId === event.supportingMarriageRegistrations![0]!.marriageId)!
  const agreement = traces.find(t => marriage.contract?.evidenceId === `evidence:nextgen-agreement:${t.traceId}`)!
  const observation: ObservationSlice = {
    seed: 20260101, mode: 'INTEGRATED_EXPERIMENTAL', year: before.year,
    world: before, events: [event], traces, counts: [],
    candidates: { seed: 20260101, mode: 'INTEGRATED_EXPERIMENTAL', candidates: [] },
    titleHistories: [], personRecords: [], titleLossRecords: [], knownA0Ending: null,
    technicalGoal: null, goal: null, status: 'COMPLETED', a0Source: 'COMPUTED',
  }
  render(<ObservationPanel observation={observation} seedText="20260101" loading={false}
    onSeedText={() => {}} onReset={() => {}} onLoad={() => {}} onCancel={() => {}} onIntervene={() => {}} />)
  const label = baseDisplayName(support)
  const row = within(screen.getByTestId('obs-event-list')).getByRole('button', { name: new RegExp(label) })
  fireEvent.click(row)
  const detail = within(screen.getByTestId('obs-event-detail'))
  expect(detail.getByRole('heading', { level: 4, name: /婚姻が成立/ }).textContent).toContain(label)
  expect(screen.getByTestId('obs-event-reasons').textContent).not.toContain(support.personId)
  fireEvent.click(detail.getByRole('button', { name: '根拠を詳しく見る' }))
  expect(JSON.parse(screen.getByTestId('obs-trace-detail').querySelector('pre')!.textContent!).traceId).toBe(legal.traceId)
  fireEvent.change(screen.getByTestId('obs-trace-filter'), { target: { value: 'ACCEPT' } })
  const traceList = within(screen.getByTestId('obs-trace-list'))
  const agreementName = new RegExp(`${label}.*規則 B-005`)
  while (!traceList.queryByRole('button', { name: agreementName })) {
    fireEvent.click(screen.getByRole('button', { name: 'Traceをさらに表示' }))
  }
  fireEvent.click(traceList.getByRole('button', { name: agreementName }))
  expect(JSON.parse(screen.getByTestId('obs-trace-detail').querySelector('pre')!.textContent!).traceId).toBe(agreement.traceId)
})

it('同名の補助人物は個別に識別し、記名人物は実名、未確認参照は未確認のまま表示する', () => {
  const duplicateId = 'support:population:["distinct-confirmed-cohort",0]'
  const ghost = 'support:population:["missing-cohort",0]'
  const named = { ...before.persons[0]!, name: 'エリザベス・ド・ヴァロワ' }
  const w = { ...before, persons: [...before.persons.filter(p => p.personId !== named.personId), named,
    support, { ...support, personId: duplicateId, name: duplicateId }] }
  const refs = [{ kind: 'PERSON_PAIR', ids: [support.personId, duplicateId] },
    { kind: 'PERSON', id: named.personId }, { kind: 'PERSON', id: ghost }] satisfies EventLogEntry['involvedRefs']
  // 不明な状態差分でも参照表示に生IDをフォールバックしない。
  const negative = { ...event, stateChanges: [], involvedRefs: refs, supportingMarriageRegistrations: [] }
  const label = baseDisplayName(support)
  const names = targetOptions([negative], indexWorld(w)).map(x => x.label).join('／')
  expect(names).toContain(`${label}・識別${personIdTag(support.personId)}・${label}・識別${personIdTag(duplicateId)}`)
  expect(names).toContain(named.name)
  expect(names).toContain(unresolvedLabel('person', ghost))
  show(negative, w, w, [])
  for (const node of [screen.getByTestId('chronicle-list'), screen.getByTestId('event-detail'), screen.getByTestId('event-target')]) {
    expect(node.textContent).toContain(named.name)
    expect(node.textContent).toContain(unresolvedLabel('person', ghost))
    expect(node.textContent).not.toMatch(/support:population:/)
  }
})
