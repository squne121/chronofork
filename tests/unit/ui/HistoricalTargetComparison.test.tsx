// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { DecisionTrace, EventLogEntry, TargetRef } from '../../../src/simulation/contracts/index.ts'
import type { PlayView } from '../../../src/ui/branch-play-source.ts'
import { HistoricalTargetComparison } from '../../../src/ui/HistoricalTargetComparison.tsx'
import { HistoricalChangesExplorer } from '../../../src/ui/HistoricalChangesExplorer.tsx'
import { EVENT_CATEGORIES } from '../../../src/ui/integrated-overview.ts'
import type { CategoryRow } from '../../../src/ui/integrated-overview.ts'

afterEach(cleanup)
const pair:TargetRef = {kind:'PERSON_PAIR',ids:['p2','p5']}
const other:TargetRef = {kind:'PERSON',id:'other'}
const ev=(id:string,year:number,type:string,refs:readonly TargetRef[]):EventLogEntry => ({
  eventId:id,semanticEventKey:id,year,phase:3,eventType:type,involvedRefs:refs,sourceTraceIds:[],stateChanges:[],
})
const tr=(id:string,year:number,status:DecisionTrace['status'],actorRef:TargetRef):DecisionTrace => ({
  traceId:id,year,phase:3,ruleId:'B-004',actorRef,status,reasonCodes:[],modifierIds:[],
  candidates:[],eventIds:[],ruleVersion:'test',
} as DecisionTrace)
const run=(events:readonly EventLogEntry[],traces:readonly DecisionTrace[]) =>
  ({result:{eventLog:events,decisionTraces:traces,snapshots:[]}} as unknown as PlayView['a0'])
const view=(a0:ReturnType<typeof run>,a1:ReturnType<typeof run>):PlayView =>
  ({a0,a1} as PlayView)

describe('DEC-073 — 選択対象のA0/A1実記録比較', () => {
  it('A0の婚姻成立Eventと、A1の不採択Traceを混同せず別々に開ける', () => {
    const a0event=ev('marriage-a0',1250,'MARRIAGE_REGISTER',[pair])
    const a1trace=tr('trace-a1',1250,'REJECT',pair)
    const onEvent=vi.fn(),onTrace=vi.fn()
    render(<HistoricalTargetComparison view={view(run([a0event],[]),run([],[a1trace]))}
      targetKey="PERSON:p2" targetLabel="人物02" year="1250" categoryKey="marriage"
      onInspectEvent={onEvent} onInspectTrace={onTrace}/>)
    expect(screen.getByTestId('target-count-a0').textContent).toContain('確定Event 1件／判断Trace 0件')
    expect(screen.getByTestId('target-count-a1').textContent).toContain('確定Event 0件／判断Trace 1件')
    fireEvent.click(within(screen.getByTestId('target-event-list-a0')).getByRole('button'))
    expect(onEvent).toHaveBeenCalledWith('A0','marriage-a0')
    fireEvent.click(within(screen.getByTestId('target-trace-list-a1')).getByRole('button'))
    expect(onTrace).toHaveBeenCalledWith('A1','trace-a1')
    expect(screen.getByTestId('target-comparison').textContent).toContain('不採択（REJECT）')
    expect(screen.getByTestId('target-comparison').textContent).toContain('判断の採択とEvent成立は同義ではありません')
  })

  it('年と分野はEventへAND適用、Traceは分野を推測で絞らない', () => {
    const a0=run([ev('birth',1250,'PERSON_BIRTH',[pair]),ev('marriage',1250,'MARRIAGE_REGISTER',[pair]),
      ev('other-year',1251,'MARRIAGE_REGISTER',[pair]),ev('other-actor',1250,'MARRIAGE_REGISTER',[other])],
      [tr('year-1250',1250,'DEFER',pair),tr('year-1251',1251,'ACCEPT',pair)])
    render(<HistoricalTargetComparison view={view(a0,run([],[]))}
      targetKey="PERSON:p5" targetLabel="人物05" year="1250" categoryKey="marriage"
      onInspectEvent={() => {}} onInspectTrace={() => {}}/>)
    expect(screen.getByTestId('target-count-a0').textContent).toContain('確定Event 1件／判断Trace 1件')
    expect(within(screen.getByTestId('target-event-list-a0')).getByRole('button').textContent).toContain('MARRIAGE_REGISTER')
    expect(within(screen.getByTestId('target-trace-list-a0')).getByRole('button').textContent).toContain('保留（DEFER）')
  })

  it('探索で対象を選ぶと両枝の根拠リンクが表示され、対象を戻すと解除される', () => {
    const a0event=ev('e0',1250,'MARRIAGE_REGISTER',[pair])
    const category=EVENT_CATEGORIES.find(c=>c.key==='marriage')!
    const rows:CategoryRow[]=[{category,a0:[a0event],a1:[],a0Only:[a0event],a1Only:[],changed:[]}]
    const onEvent=vi.fn(),onTrace=vi.fn()
    render(<HistoricalChangesExplorer rows={rows} totalDifferences={1}
      view={view(run([a0event],[]),run([],[tr('t1',1250,'REJECT',pair)]))}
      worldA0={undefined} worldA1={undefined} onInspectEvent={onEvent} onInspectTrace={onTrace}/>)
    expect(screen.queryByTestId('target-comparison')).toBeNull()
    fireEvent.change(screen.getByTestId('change-target'),{target:{value:'PERSON:p2'}})
    expect(screen.getByTestId('target-comparison')).toBeTruthy()
    expect(screen.getByTestId('target-count-a0').textContent).toContain('確定Event 1件')
    fireEvent.click(within(screen.getByTestId('target-trace-list-a1')).getByRole('button'))
    expect(onTrace).toHaveBeenCalledWith('A1','t1')
    fireEvent.change(screen.getByTestId('change-target'),{target:{value:''}})
    expect(screen.queryByTestId('target-comparison')).toBeNull()
  })

  it('表示件数を制限して必要時に追加表示する', () => {
    const events=Array.from({length:15},(_,i)=>ev('e'+i,1250,'PERSON_BIRTH',[pair]))
    render(<HistoricalTargetComparison view={view(run(events,[]),run([],[]))}
      targetKey="PERSON:p2" targetLabel="人物02" year="" categoryKey=""
      onInspectEvent={() => {}} onInspectTrace={() => {}}/>)
    expect(within(screen.getByTestId('target-event-list-a0')).getAllByRole('button')).toHaveLength(12)
    fireEvent.click(screen.getByTestId('target-event-more-a0'))
    expect(within(screen.getByTestId('target-event-list-a0')).getAllByRole('button')).toHaveLength(15)
  })
})
