// @vitest-environment jsdom
// 表示のみに使うsynthetic Event/Trace。実ルールの発生を証明しない。
import {cleanup,fireEvent,render,screen} from '@testing-library/react'
import {afterEach,describe,expect,it,vi} from 'vitest'
import {createExperimentalIntegratedWorld} from '../../../../src/scenario/experimental/index.ts'
import type {ObservationSlice} from '../../../../src/ui/branch-play-source.ts'
import type {EventLogEntry,DecisionTrace} from '../../../../src/simulation/contracts/index.ts'
import {ObservationPanel} from '../../../../src/ui/observation/ObservationPanel.tsx'

afterEach(cleanup)
const world=createExperimentalIntegratedWorld()
const person=world.persons.find(p=>p.interactionRole!=='SUPPORTING')!
const event={
  eventId:'synthetic-e',semanticEventKey:'synthetic:e',year:1250,phase:2,eventType:'PERSON_BIRTH',
  involvedRefs:[{kind:'PERSON',id:person.personId}],sourceTraceIds:[],stateChanges:[],
} as unknown as EventLogEntry
const trace={
  traceId:'synthetic-t',year:1250,phase:2,ruleId:'B-005',status:'DEFER',
  actorRef:{kind:'PERSON',id:person.personId},eventIds:[],reasonCodes:['SYNTHETIC_NOT_READY'],
  candidates:[],modifierIds:[],ruleVersion:'synthetic',
} as unknown as DecisionTrace
const view:ObservationSlice={
  seed:20260101,mode:'INTEGRATED_EXPERIMENTAL',year:1250,world,events:[event],traces:[trace],
  counts:Array.from({length:101},(_,i)=>({year:1250+i,events:i===0?1:0,traces:i===0?1:0})),
  technicalGoal:{status:'NOT_ACHIEVED',assessments:[{
    titleId:'synthetic-title',holderPersonId:null,qualifies:false,
    failures:['TITLE_NOT_RECOGNIZED'],basis:null,
  }]},goal:null,status:'COMPLETED',a0Source:'COMPUTED',
}

describe('介入前の原史A0観測画面',()=>{
  it('Eventが無いDEFERと厳格な技術Goal不足を区別して表示し、実WorldStateの人物を選べる',()=>{
    const onIntervene=vi.fn()
    render(<ObservationPanel observation={view} loading={false} onLoad={vi.fn()}
      onCancel={vi.fn()} onIntervene={onIntervene}/>)
    expect(screen.getByTestId('obs-year-label').textContent).toContain('1250')
    expect(screen.getByTestId('obs-trace-list').textContent).toContain('B-005・DEFER（Event 0件）')
    expect(screen.getByTestId('obs-goal').textContent).toContain('TITLE_NOT_RECOGNIZED')
    expect(screen.getByTestId('obs-goal').textContent).toContain('正式勝敗：未成立')
    expect(screen.getByTestId('obs-event-list').textContent).toContain('PERSON_BIRTH')
    expect(screen.getByTestId('family-tree')).toBeTruthy()
    fireEvent.click(screen.getByTestId('obs-to-intervention'))
    expect(onIntervene).toHaveBeenCalledWith(1250,person.personId)
  })
  it('選択年を変更すると正しい年を要求し、未計算の年を予測表示しない',()=>{
    const onLoad=vi.fn()
    render(<ObservationPanel observation={view} loading={false} onLoad={onLoad}
      onCancel={vi.fn()} onIntervene={vi.fn()}/>)
    fireEvent.change(screen.getByLabelText('年表・観測する年（年初）'),{target:{value:'1270'}})
    expect(onLoad).toHaveBeenCalledWith(1270)
    expect(screen.getByTestId('obs-year-label').textContent).toContain('1250')
  })
  it('未実行・計算中は未来の事件やGoal成功を表示せず、取消を提供する',()=>{
    const onLoad=vi.fn(),onCancel=vi.fn()
    const {rerender}=render(<ObservationPanel loading={false} onLoad={onLoad} onCancel={onCancel}
      onIntervene={vi.fn()}/>)
    fireEvent.click(screen.getByTestId('obs-start'))
    expect(onLoad).toHaveBeenCalledWith(1250)
    rerender(<ObservationPanel loading onLoad={onLoad} onCancel={onCancel}
      onIntervene={vi.fn()}/>)
    expect(screen.queryByTestId('obs-year-label')).toBeNull()
    expect(screen.getByTestId('obs-loading').textContent).toContain('確定データ')
    fireEvent.click(screen.getByTestId('obs-cancel'))
    expect(onCancel).toHaveBeenCalled()
  })
})
