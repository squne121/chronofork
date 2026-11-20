// @vitest-environment jsdom
// DEC-106: 内部ID露出と、原史の結果の初期視認性の回帰。表示専用のsynthetic Event。
import {cleanup,fireEvent,render,screen} from '@testing-library/react'
import {afterEach,describe,expect,it,vi} from 'vitest'
import {createExperimentalIntegratedWorld} from '../../../../src/scenario/experimental/index.ts'
import type {ObservationSlice} from '../../../../src/ui/branch-play-source.ts'
import type {EventLogEntry,DecisionTrace} from '../../../../src/simulation/contracts/index.ts'
import {ObservationPanel} from '../../../../src/ui/observation/ObservationPanel.tsx'
import {buildTitleHoldingHistories} from '../../../../src/ui/observation/title-history.ts'
import { buildPersonRecords } from '../../../../src/ui/observation/person-record.ts'

afterEach(cleanup)
const world={...createExperimentalIntegratedWorld(),year:1252}
const dynasty=world.legal.dynasties[0]!
const BORN='person:b002:auto:1252:synthetic-child'
const birth={
  eventId:'ev-birth',semanticEventKey:'b',year:1252,phase:3,eventType:'PERSON_BIRTH',
  involvedRefs:[{kind:'PERSON',id:BORN}],sourceTraceIds:[],
  stateChanges:[{path:'$.persons['+BORN+']',before:null,after:{personId:BORN,name:'エルド・ナルヴェン (b002:auto)',
    sex:'MALE',legalDynasty:{status:'UNDETERMINED'}}}],
} as unknown as EventLogEntry
const dyn=(involved:string)=>({
  eventId:'ev-dyn-'+involved,semanticEventKey:'d',year:1252,phase:4,eventType:'LEGAL_DYNASTY_SET',
  involvedRefs:[{kind:'PERSON',id:involved}],sourceTraceIds:[],
  stateChanges:[
    {path:'$.persons['+involved+'].legalDynasty.status',before:'UNDETERMINED',after:'DETERMINED'},
    {path:'$.persons['+involved+'].legalDynasty.dynastyId',before:null,after:dynasty.dynastyId},
  ],
}) as unknown as EventLogEntry
const noTrace=[] as DecisionTrace[]
const make=(events:EventLogEntry[]):ObservationSlice=>({
  seed:20260101,mode:'INTEGRATED_EXPERIMENTAL',year:1252,world,events,traces:noTrace,
  counts:Array.from({length:101},(_,i)=>({year:1250+i,events:0,traces:0})),
  candidates:{seed:20260101,mode:'INTEGRATED_EXPERIMENTAL',candidates:[]},
  titleHistories:buildTitleHoldingHistories([world],[]),personRecords:buildPersonRecords([world],[],[],buildTitleHoldingHistories([world],[])),titleLossRecords:[],knownA0Ending:null,
  technicalGoal:{status:'NOT_ACHIEVED',assessments:[]},goal:null,status:'COMPLETED',a0Source:'COMPUTED',
})
const props={seedText:'20260101',onSeedText:vi.fn(),onReset:vi.fn(),onLoad:vi.fn(),onCancel:vi.fn(),onIntervene:vi.fn()}

describe('DEC-106 UI回帰',()=>{
  it('同年のPERSON_BIRTH Eventに裏付けられた人物名で法的王朝Eventを表示し、自動生成IDを出さない',()=>{
    render(<ObservationPanel {...props} observation={make([birth,dyn(BORN)])} loading={false}/>)
    const list=screen.getByTestId('obs-event-list').textContent!
    expect(list).toContain('エルド・ナルヴェン')
    expect(list).not.toMatch(/person:b002:auto|参照不明/)
    fireEvent.click(screen.getByText(/法的王朝が/))
    // 検証用の生JSON（<pre>）は技術証拠として保持する。通常の読み物部分だけを検査する。
    const detail=screen.getByTestId('obs-event-detail')
    const readable=[...detail.querySelectorAll('h4,p')].map(n=>n.textContent).join('\n')
    expect(readable).toContain('エルド・ナルヴェン')
    expect(readable).not.toMatch(/person:b002:auto|参照不明/)
    expect(detail.querySelector('pre')!.textContent).toContain(BORN)
  })
  it('名前を裏付けるEventが無い人物は名前を創作せず、生IDも通常表示に出さない（技術詳細にIDは残る）',()=>{
    const orphan='person:b002:auto:1252:orphan'
    const other='person:b002:auto:1252:other'
    render(<ObservationPanel {...props} observation={make([dyn(orphan),dyn(other)])} loading={false}/>)
    const list=screen.getByTestId('obs-event-list').textContent!
    expect(list).not.toContain('エルド')
    expect(list).not.toMatch(/person:|b002:auto|orphan|参照不明/)
    expect(list).toContain('名前未確認の人物')
    // 別人物は別の識別になり、同一人物と誤示しない。
    const labels=list.match(/名前未確認の人物（識別[0-9A-Z]+）/g)!
    expect(new Set(labels).size).toBe(2)
    fireEvent.click(screen.getAllByText(/法的王朝が/)[0]!)
    const detail=screen.getByTestId('obs-event-detail')
    const readable=[...detail.querySelectorAll('h4,p')].map(n=>n.textContent).join('\n')
    expect(readable).not.toMatch(/person:b002|参照不明/)
    expect(detail.querySelector('pre')!.textContent).toMatch(/person:b002:auto:1252:(orphan|other)/)
  })
  it('通常の目標欄に理由コード・goal=nullを出さず、技術詳細へ分離して保持する',()=>{
    render(<ObservationPanel {...props} observation={make([])} loading={false}/>)
    const goal=screen.getByTestId('obs-goal').cloneNode(true) as HTMLElement
    const dev=[...goal.querySelectorAll('details.dev-details')]
    dev.forEach(d=>d.remove())
    expect(goal.textContent).toContain('正式勝敗：未成立')
    expect(goal.textContent).not.toMatch(/goal=null|CALIBRATION_ONLY|[A-Z]{2,}_[A-Z_]+/)
    expect((screen.getByTestId('obs-dev-info').textContent)).toContain('goal=null')
  })
  it('原史の結果（正式勝敗・技術判定・不足条件）が年表・人物欄より前に現れる',()=>{
    render(<ObservationPanel {...props} observation={make([])} loading={false}/>)
    const goal=screen.getByTestId('obs-goal')
    const nav=screen.getByTestId('obs-year-slider')
    expect(goal.textContent).toContain('正式勝敗：未成立')
    expect(goal.compareDocumentPosition(nav)&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    expect(goal.compareDocumentPosition(screen.getByTestId('obs-event-list'))&Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  })
  it('DecisionTrace一覧は技術詳細として既定で畳まれ、内容は失われない',()=>{
    render(<ObservationPanel {...props} observation={make([])} loading={false}/>)
    const d=screen.getByTestId('obs-technical') as HTMLDetailsElement
    expect(d.open).toBe(false)
    expect(d.textContent).toContain('この年のTrace')
  })
})
