// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { EventLogEntry, TargetRef } from '../../../src/simulation/contracts/index.ts'
import {
  collectChangeRecords, eventTargetKeys, HistoricalChangesExplorer,
} from '../../../src/ui/HistoricalChangesExplorer.tsx'
import { EVENT_CATEGORIES } from '../../../src/ui/integrated-overview.ts'
import type { CategoryRow } from '../../../src/ui/integrated-overview.ts'

afterEach(cleanup)

function event(id: string, year: number, type: string, refs: readonly TargetRef[] = []): EventLogEntry {
  return { eventId: id, semanticEventKey: id, year, phase: 3, eventType: type, involvedRefs: refs,
    stateChanges: [], sourceTraceIds: [] }
}
function row(key: string, a0Only: readonly EventLogEntry[] = [],
  a1Only: readonly EventLogEntry[] = [], changed: readonly EventLogEntry[] = []): CategoryRow {
  const category = EVENT_CATEGORIES.find(c => c.key === key)
  if (!category) throw new Error('カテゴリ不明: ' + key)
  return { category, a0: a0Only, a1: [...a1Only, ...changed], a0Only, a1Only, changed }
}

describe('HistoricalChangesExplorer — 認定済みEventの表示専用分類', () => {
  it('婚姻・出生・相続を、分野・年・直接関与対象で絞って元Eventへ進める', () => {
    const marriage = event('marriage-1250', 1250, 'MARRIAGE_REGISTER',
      [{ kind: 'PERSON_PAIR', ids: ['p2', 'p5'] }])
    const birth = event('birth-1260', 1260, 'PERSON_BIRTH', [{ kind: 'PERSON', id: 'p-child' }])
    const succession = event('case-1280', 1280, 'LEGAL_CASE_SET', [{ kind: 'REGION', id: 'r-east' }])
    const rows = [row('marriage', [marriage]), row('birth', [], [birth]), row('case', [], [succession])]
    const onInspect = vi.fn()
    render(<HistoricalChangesExplorer rows={rows} totalDifferences={3} worldA0={undefined} worldA1={undefined}
      onInspectEvent={onInspect}/>)

    const buttons = () => within(screen.getByTestId('change-list')).getAllByRole('button')
    expect(buttons()).toHaveLength(3)
    expect(screen.getByTestId('change-count').textContent).toContain('全3件')
    expect(eventTargetKeys(marriage)).toEqual(['PERSON:p2', 'PERSON:p5'])

    fireEvent.change(screen.getByTestId('change-category'), { target: { value: 'marriage' } })
    expect(buttons()).toHaveLength(1)
    fireEvent.change(screen.getByTestId('change-year'), { target: { value: '1250' } })
    fireEvent.change(screen.getByTestId('change-target'), { target: { value: 'PERSON:p2' } })
    expect(buttons()).toHaveLength(1)
    fireEvent.click(buttons()[0]!)
    expect(onInspect).toHaveBeenCalledWith('A0', 'marriage-1250')

    fireEvent.change(screen.getByTestId('change-year'), { target: { value: '1260' } })
    expect(screen.getByTestId('change-empty').textContent).toContain('一致するEventの記録差はありません')
    fireEvent.change(screen.getByTestId('change-year'), { target: { value: '' } })
    fireEvent.change(screen.getByTestId('change-target'), { target: { value: '' } })
    fireEvent.change(screen.getByTestId('change-category'), { target: { value: 'birth' } })
    expect(buttons()).toHaveLength(1)
    fireEvent.click(buttons()[0]!)
    expect(onInspect).toHaveBeenCalledWith('A1', 'birth-1260')
  })

  it('分類対象と分類外と全Event差分の件数を混同させない', () => {
    const rows = [row('marriage', [event('marriage-1250', 1250, 'MARRIAGE_REGISTER')])]
    render(<HistoricalChangesExplorer rows={rows} totalDifferences={3}
      worldA0={undefined} worldA1={undefined} onInspectEvent={() => {}}/>)
    const counter = screen.getByTestId('change-count').textContent ?? ''
    expect(counter).toContain('分類対象 全1件')
    expect(counter).toContain('分類外 2件')
    expect(counter).toContain('全Event記録差 3件')
    expect(counter).toContain('条件に一致する分類対象の記録差 1件')
  })

  it('同じ複合Eventのカテゴリ重複を除き、Event IDと枝で区別する', () => {
    const both = event('combined-1255', 1255, 'PERSON_BIRTH+LEGAL_DYNASTY_SET')
    const rows = [row('birth', [], [both]), row('dynasty', [], [both])]
    const records = collectChangeRecords(rows)
    expect(records).toHaveLength(1)
    expect(records[0]!.categories.map(c => c.key)).toEqual(['birth', 'dynasty'])
    expect(records[0]!.event).toBe(both)
  })

  it('大量の確定済み記録差は20件ずつ追加表示し、独立の史実を生成しない', () => {
    const birthEvents = Array.from({ length: 25 }, (_, i) =>
      event('birth-' + String(i), 1270 + (i % 3), 'PERSON_BIRTH'))
    const onInspect = vi.fn()
    render(<HistoricalChangesExplorer rows={[row('birth', [], birthEvents)]} totalDifferences={25}
      worldA0={undefined} worldA1={undefined} onInspectEvent={onInspect}/>)
    const list = screen.getByTestId('change-list')
    expect(within(list).getAllByRole('button')).toHaveLength(20)
    fireEvent.click(screen.getByTestId('change-more'))
    expect(within(list).getAllByRole('button')).toHaveLength(25)
    expect(screen.queryByTestId('change-more')).toBeNull()
    expect(screen.getByTestId('change-count').textContent).toContain('全25件')
  })
})
