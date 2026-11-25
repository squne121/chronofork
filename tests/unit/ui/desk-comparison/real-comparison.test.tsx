// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { PLAY_DEMO_PAIR, runPlayComparison } from '../../../../src/ui/branch-play-source.ts'
import { comparisonAt, DeskComparison } from '../../../../src/ui/desk/comparison/DeskComparison.tsx'

// 100年の実再計算は資源競合を避けて明示実行する。fixtureは成功の代替ではない。
const realTest = process.env.CHRONOFORK_REAL_COMPARISON === '1' ? it : it.skip
realTest('実A0/A1の同年の記録を枝付きで開き、元文脈に戻る', () => {
  const result = runPlayComparison({ seed: 20260101, year: 1260, firstPersonId: PLAY_DEMO_PAIR[0],
    secondPersonId: PLAY_DEMO_PAIR[1], signedDelta: 20, durationYears: 5 })
  if (!result.ok) throw new Error(`${result.code}: ${result.message}`)
  const view = result.comparison
  const comparison = comparisonAt(view, 'A0_A1', 1260)!
  expect(comparison.before.ref.origin.branch).toBe('A0')
  expect(comparison.after.ref.origin.branch).toBe('A1')
  expect(comparison.changes).toBeDefined()
  const event = view.a1.result.eventLog.find(e => e.year === 1260 && e.involvedRefs.some(r => r.kind === 'PERSON'))
  expect(event).toBeDefined()
  const personRef = event!.involvedRefs.find(r => r.kind === 'PERSON')!
  if (personRef.kind !== 'PERSON') throw new Error('対象人物がありません')
  const target = { kind: 'person' as const, id: personRef.id }
  const context = { history: comparison.before, target }
  const onEvidence = vi.fn(), onReturn = vi.fn()
  render(<DeskComparison view={view} pair="A0_A1" year={1260} target={target} context={context} onEvidence={onEvidence} onReturn={onReturn}/>)
  for (const history of [comparison.before, comparison.after]) {
    const person = history.person(target.id)
    expect(within(screen.getByRole('region', { name: `${history.ref.origin.branch}の記録` })).getByText(new RegExp(person.kind))).toBeTruthy()
  }
  const traceDiffs = comparison.changes!.traces.filter(d => [d.before, d.after, ...(d.ambiguousBefore ?? []), ...(d.ambiguousAfter ?? [])].some(t => t && (t.actorRef.kind === 'PERSON' ? t.actorRef.id === target.id : t.actorRef.kind === 'PERSON_PAIR' && t.actorRef.ids.includes(target.id))))
  expect(within(screen.getByRole('region', { name: '記録差分' })).getByText(new RegExp(`判断Trace ${traceDiffs.length}件`))).toBeTruthy()
  const branch = within(screen.getByRole('region', { name: 'A1の記録' }))
  fireEvent.click(branch.getByRole('button', { name: `${event!.eventType}・${event!.eventId}` }))
  const request = onEvidence.mock.calls[0]![0]
  expect(request.history.ref).toEqual(comparison.after.ref)
  expect(request.history.event(event!.eventId).record).toEqual(event)
  fireEvent.click(screen.getByRole('button', { name: '元の調査へ戻る' }))
  expect(onReturn).toHaveBeenCalledWith(context)
}, 60_000)
afterEach(cleanup)
