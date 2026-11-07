// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it } from 'vitest'
import { HistoryPanel } from '../../../src/ui/HistoryPanel.tsx'
import { indexWorld, worldWithHistoricPersons } from '../../../src/ui/inspection-source.ts'
import {
  PLAY_DEMO_DELTA,
  PLAY_DEMO_DURATION,
  PLAY_DEMO_PAIR,
  PLAY_DEMO_YEAR,
  runPlayComparison,
} from '../../../src/ui/branch-play-source.ts'
import { indexHistory } from '../../../src/ui/timeline-source.ts'

afterEach(cleanup)

it('実EventLogの事件種別で年表だけを絞り、件数・詳細・Traceを維持できる', () => {
  const play = runPlayComparison({
    seed: 1,
    year: PLAY_DEMO_YEAR,
    firstPersonId: PLAY_DEMO_PAIR[0],
    secondPersonId: PLAY_DEMO_PAIR[1],
    signedDelta: PLAY_DEMO_DELTA,
    durationYears: PLAY_DEMO_DURATION,
  })
  expect(play.ok).toBe(true)
  if (!play.ok) return

  const run = play.comparison.a1
  const events = run.result.eventLog
  const marriage = events.find((e) => e.eventType === 'MARRIAGE_REGISTER')
  const births = events.filter((e) => e.eventType === 'PERSON_BIRTH')
  expect(marriage).toBeDefined()
  expect(births.length).toBeGreaterThan(0)
  if (!marriage) return

  const world = run.result.snapshots[run.result.snapshots.length - 1] ?? run.initialWorld
  render(
    <HistoryPanel
      result={run.result}
      history={indexHistory(run.result)}
      index={indexWorld(world)}
      refIndex={indexWorld(worldWithHistoricPersons(world, run.result.snapshots))}
      year={PLAY_DEMO_YEAR}
      scope="all"
      targetKey=""
      events={events}
      allEvents={events}
      eventId={marriage.eventId}
      traceId={marriage.sourceTraceIds[0]}
      onScope={() => {}}
      onTarget={() => {}}
      onEvent={() => {}}
      onTrace={() => {}}
      onSelect={() => {}}
    />,
  )

  const list = () => within(screen.getByTestId('chronicle-list')).getAllByRole('button')
  expect(list()).toHaveLength(events.length)
  expect(screen.getByTestId('chronicle-count').textContent).toContain(`表示 ${events.length}件`)

  fireEvent.change(screen.getByTestId('event-type'), { target: { value: 'PERSON_BIRTH' } })
  expect(list()).toHaveLength(births.length)
  expect(screen.getByTestId('chronicle-count').textContent).toContain(`表示 ${births.length}件`)
  expect(screen.getByTestId('selected-event-outside-filter').textContent).toContain('詳細と判断根拠')
  expect(within(screen.getByTestId('event-detail')).getByTestId('event-id').textContent).toBe(marriage.eventId)
  expect(screen.getByTestId('trace-detail').textContent).toContain('DecisionTrace')

  fireEvent.change(screen.getByTestId('event-type'), { target: { value: '' } })
  expect(list()).toHaveLength(events.length)
  expect(screen.queryByTestId('selected-event-outside-filter')).toBeNull()
}, 45000)
