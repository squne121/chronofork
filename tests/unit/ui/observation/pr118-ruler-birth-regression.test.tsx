// @vitest-environment jsdom
// PR #118 / A+B+C統合: Eventの確定stateChangeと年初WorldStateを混同しない。
import { buildPersonRecords } from '../../../../src/ui/observation/person-record.ts'
import {cleanup,fireEvent,render,screen} from '@testing-library/react'
import {afterEach,expect,it,vi} from 'vitest'
import {createExperimentalIntegratedWorld} from '../../../../src/scenario/experimental/index.ts'
import type {EventLogEntry} from '../../../../src/simulation/contracts/index.ts'
import type {ObservationSlice} from '../../../../src/ui/branch-play-source.ts'
import {EVENT_CATEGORIES,inCategory,isObservationFocusEvent,namesOf} from '../../../../src/ui/integrated-overview.ts'
import {describeEvent} from '../../../../src/ui/event-summary.ts'
import {ObservationPanel} from '../../../../src/ui/observation/ObservationPanel.tsx'

afterEach(cleanup)
const world=createExperimentalIntegratedWorld()
const category=(key:string)=>EVENT_CATEGORIES.find(c=>c.key===key)!
const rulerEvent=(kind:'COUNTRY_RULER_SET'|'COUNTRY_RULER_VACATE',
  countryId:string,before:string,after:string|null):EventLogEntry=>({
  eventId:'synthetic:'+kind+':'+countryId,semanticEventKey:'synthetic:ruler:'+kind,
  year:1268,phase:4,eventType:kind,
  involvedRefs:[{kind:'COUNTRY',id:countryId}],
  stateChanges:[{path:'$.countries['+countryId+'].rulerPersonId',before,after}],
  sourceTraceIds:['synthetic:trace'],
}) as unknown as EventLogEntry

it('CROWN/TERRITORIAL移転を中立に分類し、統治者更新・死亡後未確定化を注目Eventに含める',()=>{
  expect(category('title').label).toContain('王位・領地')
  const crown={eventType:'LEGAL_TITLE_TRANSFER'} as EventLogEntry
  expect(inCategory(crown,category('title'))).toBe(true)
  for(const kind of ['COUNTRY_RULER_SET','COUNTRY_RULER_VACATE'] as const){
    const event=rulerEvent(kind,'country-eldia','person-exp-01',
      kind==='COUNTRY_RULER_SET'?'person-exp-02':null)
    expect(inCategory(event,category('ruler'))).toBe(true)
    expect(isObservationFocusEvent(event)).toBe(true)
  }
})

it('確定stateChangeだけから、合法な統治者更新と死後の未確定化を表示する',()=>{
  const names=namesOf(world)
  const set=rulerEvent('COUNTRY_RULER_SET','country-eldia','person-exp-01','person-exp-02')
  const updated=describeEvent(set,names)
  expect(updated?.headline).toContain('エルディア')
  expect(updated?.headline).toContain(names.person('person-exp-02'))
  expect(updated?.lines.join(' ')).toContain(names.person('person-exp-01'))
  const vacate=rulerEvent('COUNTRY_RULER_VACATE','country-margald','person-exp-08',null)
  const cleared=describeEvent(vacate,names)
  expect(cleared?.headline).toContain('マルガルド')
  expect(cleared?.headline).toContain('未確定')
  expect(cleared?.lines.join(' ')).toContain('後継者を推定しません')
  expect(describeEvent({...set,stateChanges:[]},names)).toBeUndefined()
  expect(describeEvent({...vacate,stateChanges:[]},names)).toBeUndefined()
})

it('出生Eventの新生児は同年年初に捏造せず、翌年初の実WorldStateへ選択を引き継ぐ',()=>{
  const childId='person:synthetic-child-1250'
  const base=world.persons.find(p=>p.personId==='person-exp-02')!
  const child={...base,personId:childId,name:'試験新生児',birthYear:1250,
    fatherId:'person-exp-01',motherId:'person-exp-05'}
  const birth={
    eventId:'synthetic:birth:1250',semanticEventKey:'synthetic:birth:1250',
    year:1250,phase:3,eventType:'PERSON_BIRTH',
    involvedRefs:[{kind:'PERSON',id:childId}],sourceTraceIds:[],
    stateChanges:[{path:'$.persons['+childId+']',before:null,after:child}],
  } as unknown as EventLogEntry
  const view:ObservationSlice={
    seed:20260101,mode:'INTEGRATED_EXPERIMENTAL',year:1250,world,
    events:[birth],traces:[],counts:[],
    candidates:{seed:20260101,mode:'INTEGRATED_EXPERIMENTAL',candidates:[]},
    titleHistories:[],personRecords:buildPersonRecords([world],[birth],[],[]),titleLossRecords:[],knownA0Ending:null,technicalGoal:null,goal:null,
    status:'COMPLETED',a0Source:'COMPUTED',
  }
  const onLoad=vi.fn()
  const props={seedText:'20260101',onSeedText:vi.fn(),onReset:vi.fn(),
    onLoad,onCancel:vi.fn(),onIntervene:vi.fn(),loading:false} as const
  const {rerender}=render(<ObservationPanel {...props} observation={view}/>)
  expect(screen.getByTestId('obs-person').querySelector('option[value="'+childId+'"]')).toBeNull()
  fireEvent.click(screen.getByTestId('obs-event-list').querySelector('button')!)
  expect(screen.getByTestId('obs-event-detail').textContent).toContain('試験新生児')
  const link=screen.getByTestId('obs-newborn-next-year-'+childId)
  expect(link.textContent).toContain('1251年初')
  fireEvent.click(link)
  expect(onLoad).toHaveBeenCalledTimes(1)
  expect(onLoad).toHaveBeenCalledWith(1251)
  const nextWorld={...world,year:1251,persons:[...world.persons,child]}
  rerender(<ObservationPanel {...props} observation={{...view,year:1251,world:nextWorld,events:[]}}/>)
  expect((screen.getByTestId('obs-person') as HTMLSelectElement).value).toBe(childId)
  expect(screen.getByTestId('family-tree').textContent).toContain('試験新生児')
})

it('人物Refのみで出生stateChangeのないEventには翌年導線を作らない',()=>{
  const withoutProof={
    eventId:'synthetic:birth:missing',semanticEventKey:'synthetic:birth:missing',
    year:1250,phase:3,eventType:'PERSON_BIRTH',
    involvedRefs:[{kind:'PERSON',id:'person:unproven-newborn'}],
    sourceTraceIds:[],stateChanges:[],
  } as unknown as EventLogEntry
  const view:ObservationSlice={
    seed:20260101,mode:'INTEGRATED_EXPERIMENTAL',year:1250,world,
    events:[withoutProof],traces:[],counts:[],
    candidates:{seed:20260101,mode:'INTEGRATED_EXPERIMENTAL',candidates:[]},
    titleHistories:[],personRecords:buildPersonRecords([world],[],[],[]),titleLossRecords:[],knownA0Ending:null,technicalGoal:null,goal:null,
    status:'COMPLETED',a0Source:'COMPUTED',
  }
  render(<ObservationPanel observation={view} seedText="20260101"
    onSeedText={vi.fn()} onReset={vi.fn()} onLoad={vi.fn()} onCancel={vi.fn()}
    onIntervene={vi.fn()} loading={false}/>)
  fireEvent.click(screen.getByTestId('obs-event-list').querySelector('button')!)
  expect(screen.queryByTestId('obs-event-newborns')).toBeNull()
})
