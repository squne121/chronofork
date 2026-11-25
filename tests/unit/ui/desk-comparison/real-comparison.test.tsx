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
  const delta = comparison.changes!.traces.find(d => d.kind === 'CHANGED' && d.before && d.after && (d.after.actorRef.kind === 'PERSON' || d.after.actorRef.kind === 'PERSON_PAIR'))
  expect(delta).toBeDefined()
  const beforeTrace = delta!.before!, trace = delta!.after!
  expect(beforeTrace).not.toEqual(trace)
  const actor = trace.actorRef
  const personId = actor.kind === 'PERSON' ? actor.id : actor.kind === 'PERSON_PAIR' ? actor.ids[0] : undefined
  if (!personId) throw new Error('判断主体の人物がありません')
  const target = { kind: 'person' as const, id: personId }
  const context = { history: comparison.before, target, evidence: { kind: 'trace' as const, id: beforeTrace.traceId } }
  const onEvidence = vi.fn(), onReturn = vi.fn()
  render(<DeskComparison view={view} pair="A0_A1" year={1260} target={target} context={context} onEvidence={onEvidence} onReturn={onReturn}/>)
  for (const history of [comparison.before, comparison.after]) {
    const person = history.person(target.id)
    expect(within(screen.getByRole('region', { name: `${history.ref.origin.branch}の記録` })).getByText(new RegExp(person.kind))).toBeTruthy()
  }
  const traceDiffs = comparison.changes!.traces.filter(d => [d.before, d.after, ...(d.ambiguousBefore ?? []), ...(d.ambiguousAfter ?? [])].some(t => t && (t.actorRef.kind === 'PERSON' ? t.actorRef.id === target.id : t.actorRef.kind === 'PERSON_PAIR' && t.actorRef.ids.includes(target.id))))
  expect(traceDiffs.length).toBeGreaterThan(0)
  expect(within(screen.getByRole('region', { name: '記録差分' })).getByText(new RegExp(`判断Trace ${traceDiffs.length}件`))).toBeTruthy()
  const changes = within(screen.getByRole('region', { name: '記録差分' }))
  for (const [history, record] of [[comparison.before, beforeTrace], [comparison.after, trace]] as const) {
    const summary = changes.getByText(`${history.ref.origin.branch}: ${record.status}・${record.traceId}`)
    const details = summary.closest('details')!
    expect(details.querySelector('pre')!.textContent).toBe(JSON.stringify(record, null, 2))
    fireEvent.click(within(details).getByRole('button', { name: 'この判断根拠を開く', hidden: true }))
    const request = onEvidence.mock.calls.at(-1)![0]
    expect(request.kind).toBe('trace')
    expect(request.id).toBe(record.traceId)
    expect(request.history.ref).toEqual(history.ref)
    expect(request.history.trace(record.traceId)).toEqual({ kind: 'RECORDED', record })
  }
  fireEvent.click(screen.getByRole('button', { name: '元の調査へ戻る' }))
  expect(onReturn).toHaveBeenCalledWith(context)
}, 60_000)
afterEach(cleanup)
