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
const titleId=world.titles[0]!.titleId
const titleEvent={
  eventId:'synthetic-title-transfer',semanticEventKey:'synthetic:title',year:1250,phase:5,eventType:'LEGAL_TITLE_TRANSFER',
  involvedRefs:[],sourceTraceIds:['synthetic-title-trace'],
  stateChanges:[{path:'$.titles['+titleId+'].holder.personId',before:'synthetic-old',after:person.personId}],
} as unknown as EventLogEntry
const titleTrace={
  traceId:'synthetic-title-trace',year:1250,phase:5,ruleId:'A-TIT-07',status:'ACCEPT',
  actorRef:{kind:'PERSON',id:person.personId},eventIds:['synthetic-title-transfer'],
  reasonCodes:[],candidates:[],modifierIds:[],
} as unknown as DecisionTrace
const seedProps={seedText:'20260101',onSeedText:vi.fn(),onReset:vi.fn()}
const view:ObservationSlice={
  seed:20260101,mode:'INTEGRATED_EXPERIMENTAL',year:1250,world,events:[event,titleEvent],traces:[trace,titleTrace],
  counts:Array.from({length:101},(_,i)=>({year:1250+i,events:i===0?2:0,traces:i===0?2:0})),
  candidates:{seed:20260101,mode:'INTEGRATED_EXPERIMENTAL',candidates:[]},
  technicalGoal:{status:'NOT_ACHIEVED',assessments:[{
    titleId:'synthetic-title',holderPersonId:null,qualifies:false,
    failures:['TITLE_NOT_RECOGNIZED'],basis:null,
  }]},goal:null,status:'COMPLETED',a0Source:'COMPUTED',
}

describe('介入前の原史A0観測画面',()=>{
  it('Eventが無いDEFERと厳格な技術Goal不足を区別して表示し、実WorldStateの人物を選べる',()=>{
    const onIntervene=vi.fn()
    render(<ObservationPanel {...seedProps} observation={view} loading={false} onLoad={vi.fn()}
      onCancel={vi.fn()} onIntervene={onIntervene}/>)
    expect(screen.getByTestId('obs-year-label').textContent).toContain('1250')
    expect(screen.getByTestId('obs-trace-list').textContent).toContain('B-005')
    expect(screen.getByTestId('obs-trace-list').textContent).toContain('保留')
    expect(screen.getByTestId('obs-goal').textContent).toContain('TITLE_NOT_RECOGNIZED')
    expect(screen.getByTestId('obs-goal').textContent).toContain('正式勝敗：未成立')
    expect(screen.getByTestId('obs-event-list').textContent).toContain('出生')
    expect(screen.getByTestId('family-tree')).toBeTruthy()
    fireEvent.click(screen.getByTestId('obs-to-intervention'))
    expect(onIntervene).toHaveBeenCalledWith(1250,person.personId)
  })
  it('人間向け年表は高頻度の人口Eventを省略表示し、利用者が全記録へ戻れる',()=>{
    const pop={...event,eventId:'synthetic-pop',eventType:'POPULATION_COHORT'} as EventLogEntry
    const withPop={...view,events:[...view.events,pop],counts:view.counts.map((c,i)=>i===0?{...c,focusEvents:2}:c)}
    render(<ObservationPanel {...seedProps} observation={withPop} loading={false}
      onLoad={vi.fn()} onCancel={vi.fn()} onIntervene={vi.fn()}/>)
    expect(screen.getByTestId('obs-event-list').textContent).not.toContain('POPULATION_COHORT')
    fireEvent.click(screen.getByTestId('obs-all-events'))
    expect(screen.getByTestId('obs-event-list').textContent).toContain('POPULATION_COHORT')
  })
  it('実記録がある年のボタンは自動重大度でなく年代順に探索年を切り替える',()=>{
    const onLoad=vi.fn()
    const hints={...view,counts:view.counts.map((c,i)=>({...c,focusEvents:i===12?2:i===24?1:0}))}
    render(<ObservationPanel {...seedProps} observation={hints} loading={false}
      onLoad={onLoad} onCancel={vi.fn()} onIntervene={vi.fn()}/>)
    fireEvent.click(screen.getByTestId('obs-hint-year-1262'))
    expect(onLoad).toHaveBeenCalledWith(1262)
  })
  it('Eventを選ぶと当年初に存在する関係人物の家系と記録された判断を同時に示す',()=>{
    render(<ObservationPanel {...seedProps} observation={view} loading={false}
      onLoad={vi.fn()} onCancel={vi.fn()} onIntervene={vi.fn()}/>)
    fireEvent.click(screen.getByTestId('obs-event-list').getElementsByTagName('button')[0]!)
    expect(screen.getByTestId('obs-event-people')).toBeTruthy()
    expect(screen.getByTestId('family-tree')).toBeTruthy()
  })
  it('Titleから直接根拠のあるEventと双方向リンク済みTraceを開ける',()=>{
    render(<ObservationPanel {...seedProps} observation={view} loading={false} onLoad={vi.fn()}
      onCancel={vi.fn()} onIntervene={vi.fn()}/>)
    fireEvent.change(screen.getByTestId('obs-title-select'),{target:{value:titleId}})
    expect(screen.getByTestId('obs-title-detail').textContent).toContain(titleId)
    expect(screen.getAllByTestId('obs-title-event-link')).toHaveLength(1)
    fireEvent.click(screen.getByTestId('obs-title-event-link'))
    expect(screen.getByTestId('obs-event-detail').textContent).toContain('LEGAL_TITLE_TRANSFER')
    fireEvent.click(screen.getByTestId('obs-title-trace-link'))
    expect(screen.getByTestId('obs-trace-detail').textContent).toContain('A-TIT-07')
  })
  it('年を移動すると、その年に存在しないEvent種別フィルタを解除する',()=>{
    const onLoad=vi.fn()
    render(<ObservationPanel {...seedProps} observation={view} loading={false} onLoad={onLoad}
      onCancel={vi.fn()} onIntervene={vi.fn()}/>)
    fireEvent.change(screen.getByTestId('obs-event-type'),{target:{value:'PERSON_BIRTH'}})
    expect(screen.getByTestId('obs-event-type')).toHaveProperty('value','PERSON_BIRTH')
    fireEvent.change(screen.getByLabelText('年表・観測する年（年初）'),{target:{value:'1270'}})
    expect(onLoad).toHaveBeenCalledWith(1270)
    expect(screen.getByTestId('obs-event-type')).toHaveProperty('value','ALL')
  })
  it('表示中のseedと入力が異なる場合に介入を無効化する',()=>{
    const onSeedText=vi.fn(),onReset=vi.fn()
    render(<ObservationPanel {...seedProps} seedText="9" onSeedText={onSeedText} onReset={onReset}
      observation={view} loading={false} onLoad={vi.fn()} onCancel={vi.fn()} onIntervene={vi.fn()}/>)
    expect(screen.getByTestId('obs-seed-mismatch').textContent).toContain('20260101')
    expect(screen.getByTestId('obs-to-intervention')).toHaveProperty('disabled',true)
    fireEvent.change(screen.getByTestId('obs-seed-input'),{target:{value:'10'}})
    expect(onSeedText).toHaveBeenCalledWith('10')
    fireEvent.click(screen.getByTestId('obs-reset'))
    expect(onReset).toHaveBeenCalled()
  })
  it('選択年を変更すると正しい年を要求し、未計算の年を予測表示しない',()=>{
    const onLoad=vi.fn()
    render(<ObservationPanel {...seedProps} observation={view} loading={false} onLoad={onLoad}
      onCancel={vi.fn()} onIntervene={vi.fn()}/>)
    fireEvent.change(screen.getByLabelText('年表・観測する年（年初）'),{target:{value:'1270'}})
    expect(onLoad).toHaveBeenCalledWith(1270)
    expect(screen.getByTestId('obs-year-label').textContent).toContain('1250')
  })
  it('未実行・計算中は未来の事件やGoal成功を表示せず、取消を提供する',()=>{
    const onLoad=vi.fn(),onCancel=vi.fn()
    const {rerender}=render(<ObservationPanel {...seedProps} loading={false} onLoad={onLoad} onCancel={onCancel}
      onIntervene={vi.fn()}/>)
    fireEvent.click(screen.getByTestId('obs-start'))
    expect(onLoad).toHaveBeenCalledWith(1250)
    rerender(<ObservationPanel {...seedProps} loading onLoad={onLoad} onCancel={onCancel}
      onIntervene={vi.fn()}/>)
    expect(screen.queryByTestId('obs-year-label')).toBeNull()
    expect(screen.getByTestId('obs-loading').textContent).toContain('確定データ')
    fireEvent.click(screen.getByTestId('obs-cancel'))
    expect(onCancel).toHaveBeenCalled()
  })
})
