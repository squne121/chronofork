// @vitest-environment jsdom
// A0の観測実行はsynthetic応答を渡す。実100年計算のE2E証拠ではない。
import {cleanup,fireEvent,render,screen} from '@testing-library/react'
import {afterEach,expect,it} from 'vitest'
import App from '../../../../src/ui/App.tsx'
import type {ObservationSlice,PlayInput,PlayView} from '../../../../src/ui/branch-play-source.ts'
import type {PlayOutcome,PlayRunner} from '../../../../src/ui/play-runner.ts'
import {createExperimentalIntegratedWorld} from '../../../../src/scenario/experimental/index.ts'
afterEach(cleanup)

it('介入前に実A0を観測すると、旧C004年表を同じ歴史と誤表示せず選択年・人物を介入へ渡す',async()=>{
  const world=createExperimentalIntegratedWorld()
  const person=world.persons.find(p=>p.interactionRole!=='SUPPORTING')!
  const observation:ObservationSlice={
    seed:20260101,mode:'INTEGRATED_EXPERIMENTAL',year:1250,world,
    events:[],traces:[],
    counts:Array.from({length:101},(_,i)=>({year:1250+i,events:0,traces:0})),
    technicalGoal:null,goal:null,status:'COMPLETED',a0Source:'COMPUTED',
  }
  const runner:PlayRunner=Object.assign(
    (_input:PlayInput):Readonly<{promise:Promise<PlayOutcome>;cancel:()=>void}>=>({
      promise:Promise.resolve({kind:'FAILED',code:'NO_COMPARISON',message:'not used'}),
      cancel:()=>{},
    }),
    {observe:()=>({
      promise:Promise.resolve({kind:'DONE',result:{ok:true,observation},computeMs:2} as const),
      cancel:()=>{},
    }),reset:()=>{}},
  )
  render(<App playRunner={runner}/>)
  expect(screen.getByTestId('history-status').textContent).toContain('原史')
  expect(screen.getByTestId('chronicle-list')).toBeTruthy()
  fireEvent.click(screen.getByTestId('obs-start'))
  await screen.findByTestId('obs-year-label')
  expect(screen.getByTestId('history-status').textContent).toContain('A0')
  expect(screen.queryByTestId('chronicle-list')).toBeNull()
  expect(screen.getByTestId('obs-goal').textContent).toContain('正式勝敗：未成立')
  expect(screen.getByTestId('obs-person')).toHaveProperty('value',person.personId)
  fireEvent.click(screen.getByTestId('obs-to-intervention'))
  expect(screen.getByTestId('play-law-mode')).toHaveProperty('value','INTEGRATED_EXPERIMENTAL')
  expect(screen.getByTestId('branch-fork-year')).toHaveProperty('value','1250')
  expect(screen.getByTestId('branch-person-one')).toHaveProperty('value',person.personId)
  expect(screen.queryByTestId('branch-results')).toBeNull()
})
