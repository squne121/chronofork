// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { createExperimentalIntegratedWorld } from '../../../../src/scenario/experimental/index.ts'
import type { DecisionTrace, EventLogEntry, Person } from '../../../../src/simulation/contracts/index.ts'
import { PersonHistory } from '../../../../src/ui/observation/PersonHistory.tsx'
import { buildPersonRecords } from '../../../../src/ui/observation/person-record.ts'

const initial = createExperimentalIntegratedWorld()
const seeker = initial.persons[0]!
const partner = initial.persons[1]!
const person = (personId: string, birthYear: number): Person => ({ ...seeker, personId, birthYear })
const late = person('late-with-no-evidence', 1245)
const child = person('recorded-child', 1250)
const registered: Person = { ...person('registered-at-marriage', 1252), interactionRole: 'SUPPORTING' }
const worlds = [initial, { ...initial, year: 1251, persons: [...initial.persons, late, child] }, {
  ...initial, year: 1282, persons: [...initial.persons, late, child, registered],
}]
const birth: EventLogEntry = {
  eventId: 'birth', semanticEventKey: 'birth', eventType: 'PERSON_BIRTH', year: 1250, phase: 3,
  involvedRefs: [], sourceTraceIds: [], stateChanges: [{ path: `$.persons[${child.personId}]`, before: null, after: child }],
}
const marriage: EventLogEntry = {
  eventId: 'register', semanticEventKey: 'register', eventType: 'MARRIAGE_REGISTER', year: 1281, phase: 3,
  involvedRefs: [], stateChanges: [], sourceTraceIds: ['approval'], supportingMarriageRegistrations: [{
    commandId: 'command', requestId: 'request', sourceTraceId: 'approval', marriageId: 'marriage',
    registration: { person: registered, cohortId: 'cohort', cohortSize: 3, memberOrdinal: 1,
      sourceEvidenceId: 'c004-source', familyPoolId: 'pool', birthBacking: 'C004_COHORT' },
  }],
}
const trace: DecisionTrace = {
  traceId: 'candidate-trace', ruleId: 'B-001', ruleVersion: 'test', year: 1278, phase: 3,
  actorRef: { kind: 'GROUP', id: 'group' }, status: 'ACCEPT', modifierIds: [], eventIds: [], selectedCandidateId: 'candidate',
  reasonCodes: ['SUPPORTING_CANDIDATE_ONLY', 'NOT_MARRIAGE_APPROVAL'], candidates: [{
    candidateId: 'candidate', eligible: true, reasonCodes: [], inputs: {
      candidateGroupId: 'group', candidateYear: 1278, seekerPersonId: seeker.personId, supportingCandidateId: registered.personId,
    },
  }],
}
const pair = (id: string, other: string): DecisionTrace => ({
  ...trace, traceId: id, ruleId: 'B-004', actorRef: { kind: 'PERSON_PAIR', ids: [seeker.personId, other] },
  status: 'DEFER', reasonCodes: ['NO_BASE_TRUST'],
})
const records = buildPersonRecords(worlds, [birth, marriage], [trace, pair('preview-pair', registered.personId),
  pair('unresolved-pair', 'never-registered'), pair('eligible-pair', partner.personId)], [])
const nameOf = (id: string) => records.some(r => r.personId === id) ? id : undefined
const handlers = () => ({ onFocusPerson: vi.fn(), onOpenEvent: vi.fn(), onOpenTrace: vi.fn(),
  onYear: vi.fn(), onSelectTitle: vi.fn(), onIntervene: vi.fn() })

afterEach(cleanup)

it('生年・個別化年・年初初出を区別し、分かっているEventだけ開く', () => {
  const h = handlers()
  const show = (personId: string) => <PersonHistory {...h} records={records} personId={personId} currentYear={1281} nameOf={nameOf} />
  const { rerender } = render(show(registered.personId))
  const life = screen.getByTestId('history-life')
  expect(life.textContent).toContain('1252年生')
  expect(life.textContent).toContain('C004の匿名出生コホートに由来し、1281年の婚姻成立時に個別化')
  expect(life.textContent).toContain('初出は1282年初')
  expect(within(life).queryByRole('button', { name: '出生の記録を開く' })).toBeNull()
  fireEvent.click(within(life).getByRole('button', { name: '婚姻成立時の個別化の記録を開く' }))
  expect(h.onOpenEvent).toHaveBeenCalledWith(marriage.eventId, 1281)
  fireEvent.click(within(screen.getByTestId('history-not-yet')).getByRole('button', { name: '1282年初へ移動' }))
  expect(h.onFocusPerson).toHaveBeenCalledWith(registered.personId, 1282)

  rerender(show(seeker.personId))
  expect(life.textContent).toContain('観測開始前の出生')
  rerender(show(late.personId))
  expect(life.textContent).toContain('出生・個別化の根拠を確認できません')
  expect(life.textContent).not.toContain('観測開始前の出生')
  rerender(show(child.personId))
  fireEvent.click(within(life).getByRole('button', { name: '出生の記録を開く' }))
  expect(h.onOpenEvent).toHaveBeenCalledWith(birth.eventId, 1250)
})

it('供給Traceを開けるが、未登録・補助候補ではなく実在する操作対象の組だけ介入へ渡す', () => {
  const h = handlers()
  render(<PersonHistory {...h} records={records} personId={seeker.personId} currentYear={1278} nameOf={nameOf} />)
  const supply = within(screen.getByTestId('history-supply'))
  expect(supply.getByText(/候補の提示は婚姻の承認や個人の登録ではありません/)).toBeTruthy()
  fireEvent.click(supply.getByRole('button', { name: '1278年の判断記録を開く' }))
  expect(h.onOpenTrace).toHaveBeenCalledWith(trace.traceId, 1278)
  const buttons = screen.getAllByTestId('history-intervene-pair')
  expect(buttons).toHaveLength(1)
  fireEvent.click(buttons[0]!)
  expect(h.onIntervene).toHaveBeenCalledWith(1278, seeker.personId, partner.personId)
})
