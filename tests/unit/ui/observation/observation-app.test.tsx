// @vitest-environment jsdom
// A0の観測実行はsynthetic応答を渡す。実100年計算のE2E証拠ではない。
import {cleanup,fireEvent,render,screen} from '@testing-library/react'
import {afterEach,expect,it,vi, beforeEach} from 'vitest'
import App from '../../../../src/ui/App.tsx'
import type {ObservationSlice,PlayInput} from '../../../../src/ui/branch-play-source.ts'
import {extractCandidates} from '../../../../src/ui/play-candidates.ts'
import type {CandidatesRunner,ObservationOutcome} from '../../../../src/ui/play-runner.ts'
import type {PlayOutcome,PlayRunner} from '../../../../src/ui/play-runner.ts'
import {createExperimentalIntegratedWorld} from '../../../../src/scenario/experimental/index.ts'
import {buildTitleHoldingHistories} from '../../../../src/ui/observation/title-history.ts'

beforeEach(()=>window.history.replaceState({},'', '/?entry=legacy'))
afterEach(cleanup)

it('介入前に実A0を観測すると、旧C004年表を同じ歴史と誤表示せず選択年・人物を介入へ渡す',async()=>{
  const world=createExperimentalIntegratedWorld()
  const person=world.persons.find(p=>p.interactionRole!=='SUPPORTING')!
  const observation:ObservationSlice={
    seed:20260101,mode:'INTEGRATED_EXPERIMENTAL',year:1250,world,
    events:[],traces:[],
    counts:Array.from({length:101},(_,i)=>({year:1250+i,events:0,traces:0})),
    technicalGoal:null,goal:null,status:'COMPLETED',a0Source:'COMPUTED',
    candidates:extractCandidates(20260101,'INTEGRATED_EXPERIMENTAL',[world,{...world,year:1251}]),
    titleHistories:buildTitleHoldingHistories([world],[]),
  }
  const runner:PlayRunner=Object.assign(
    (input:PlayInput):Readonly<{promise:Promise<PlayOutcome>;cancel:()=>void}>=>({
      promise:Promise.resolve({kind:'FAILED',code:'NO_COMPARISON',message:'not used for '+input.year}),
      cancel:()=>{},
    }),
    {observe:()=>({
      promise:Promise.resolve({kind:'DONE',result:{ok:true,observation},computeMs:2} as const),
      cancel:()=>{},
    }),reset:()=>{}},
  )
  render(<App playRunner={runner}/>)
  expect(screen.getByTestId('history-status').textContent).toContain('原史')
  expect(screen.getByRole('heading',{name:'年表（Event）と判断根拠（DecisionTrace）'})).toBeTruthy()
  fireEvent.click(screen.getByTestId('obs-start'))
  await screen.findByTestId('obs-year-label')
  expect(screen.getByTestId('history-status').textContent).toContain('A0')
  expect(screen.queryByTestId('current-year')).toBeNull() // シークバーとの年表示重複を避ける
  expect(screen.queryByRole('heading',{name:'年表（Event）と判断根拠（DecisionTrace）'})).toBeNull()
  expect(screen.getByTestId('obs-goal').textContent).toContain('正式勝敗：未成立')
  expect(screen.getByTestId('obs-person')).toHaveProperty('value',person.personId)
  fireEvent.click(screen.getByTestId('obs-to-intervention'))
  expect(screen.getByTestId('play-law-mode')).toHaveProperty('value','INTEGRATED_EXPERIMENTAL')
  expect(screen.getByTestId('branch-fork-year')).toHaveProperty('value','1250')
  expect(screen.getByTestId('branch-person-one')).toHaveProperty('value',person.personId)
  expect(screen.queryByTestId('branch-results')).toBeNull()
})

it('観測A0の候補は1250年だけではなく、介入年1251年にも適格なKEY人物を保持する',async()=>{
  const world=createExperimentalIntegratedWorld()
  const person=world.persons.find(p=>p.interactionRole!=='SUPPORTING')!
  const candidates=extractCandidates(20260101,'INTEGRATED_EXPERIMENTAL',[world,{...world,year:1251}])
  const observation:ObservationSlice={
    seed:20260101,mode:'INTEGRATED_EXPERIMENTAL',year:1250,world,events:[],traces:[],
    counts:Array.from({length:101},(_,i)=>({year:1250+i,events:0,traces:0})),
    technicalGoal:null,goal:null,status:'COMPLETED',a0Source:'COMPUTED',candidates,
    titleHistories:buildTitleHoldingHistories([world],[]),
  }
  const runner:PlayRunner=Object.assign((input:PlayInput)=>({
    promise:Promise.resolve({kind:'FAILED',code:'NOT_USED',message:String(input.year)} as PlayOutcome),
    cancel:()=>{},
  }),{observe:()=>({promise:Promise.resolve({kind:'DONE',result:{ok:true,observation},computeMs:1} as ObservationOutcome),cancel:()=>{}}),reset:()=>{}})
  render(<App playRunner={runner}/>)
  fireEvent.click(screen.getByTestId('obs-start'))
  await screen.findByTestId('obs-year-label')
  fireEvent.click(screen.getByTestId('obs-to-intervention'))
  expect(screen.getByTestId('branch-person-one')).toHaveProperty('value',person.personId)
  fireEvent.change(screen.getByTestId('branch-fork-year'),{target:{value:'1251'}})
  expect(screen.getByTestId('branch-run')).toHaveProperty('disabled',false)
  expect(screen.queryByTestId('branch-person-invalid')).toBeNull()
})
it('A0観測中は人物候補用の第2Workerを開始せず、候補ボタンを無効化する',()=>{
  const pending=new Promise<ObservationOutcome>(()=>{})
  const candidateRunner=vi.fn() as unknown as CandidatesRunner
  const runner:PlayRunner=Object.assign((input:PlayInput)=>({
    promise:Promise.resolve({kind:'FAILED',code:'NOT_USED',message:String(input.year)} as PlayOutcome),
    cancel:()=>{},
  }),{observe:()=>({promise:pending,cancel:()=>{}}),reset:()=>{}})
  render(<App playRunner={runner} candidatesRunner={candidateRunner}/>)
  fireEvent.click(screen.getByTestId('obs-start'))
  expect(screen.getByTestId('obs-loading')).toBeTruthy()
  const button=screen.getByTestId('candidates-fetch') as HTMLButtonElement
  expect(button.disabled).toBe(true)
  fireEvent.click(button)
  expect(candidateRunner).not.toHaveBeenCalled()
  expect(screen.getByTestId('branch-run')).toHaveProperty('disabled',true)
})
it('ユーザー指定のA0 seedを使用し、観測完了後も再観測・旧試験表示への復帰ができる',async()=>{
  const world=createExperimentalIntegratedWorld()
  const called=vi.fn()
  const runner:PlayRunner=Object.assign((input:PlayInput)=>({
    promise:Promise.resolve({kind:'FAILED',code:'NOT_USED',message:String(input.year)} as PlayOutcome),
    cancel:()=>{},
  }),{observe:(input:{seed:number;year:number})=>{
    called(input)
    const observation:ObservationSlice={
      seed:input.seed,mode:'INTEGRATED_EXPERIMENTAL',year:input.year,world,
      events:[],traces:[],counts:[],technicalGoal:null,goal:null,status:'COMPLETED',a0Source:'COMPUTED',
      candidates:extractCandidates(input.seed,'INTEGRATED_EXPERIMENTAL',[world]),
      titleHistories:buildTitleHoldingHistories([world],[]),
    }
    return {promise:Promise.resolve({kind:'DONE',result:{ok:true,observation},computeMs:1} as ObservationOutcome),cancel:()=>{}}
  },reset:()=>{}})
  render(<App playRunner={runner}/>)
  fireEvent.change(screen.getByTestId('obs-seed-input'),{target:{value:'7'}})
  fireEvent.click(screen.getByTestId('obs-start'))
  await screen.findByTestId('obs-year-label')
  expect(called).toHaveBeenCalledWith(expect.objectContaining({seed:7,year:1250}))
  expect(screen.getByTestId('obs-seed-active').textContent).toContain('seed 7')
  fireEvent.change(screen.getByTestId('obs-seed-input'),{target:{value:'8'}})
  expect((screen.getByTestId('obs-to-intervention') as HTMLButtonElement).disabled).toBe(true)
  fireEvent.click(screen.getByTestId('obs-start'))
  await screen.findByTestId('obs-seed-active')
  expect(called).toHaveBeenCalledWith(expect.objectContaining({seed:8,year:1250}))
  fireEvent.click(screen.getByTestId('obs-reset'))
  expect(screen.queryByTestId('obs-year-label')).toBeNull()
  expect(screen.getByTestId('seed-input')).toHaveProperty('value','8')
})
