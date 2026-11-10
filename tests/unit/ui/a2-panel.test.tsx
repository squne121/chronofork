// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen} from '@testing-library/react'
import {afterEach,describe,it,expect,vi} from 'vitest'
import {FollowupInterventionPanel} from '../../../src/ui/FollowupInterventionPanel.tsx'
import type {PlayView} from '../../../src/ui/branch-play-source.ts'
import {createExperimentalWorld} from '../../../src/scenario/experimental/index.ts'

afterEach(cleanup)
const world=createExperimentalWorld()
const at={...world,year:1269}
const snapshot=Array.from({length:82},(_,i)=>({...at,year:1269+i}))
const run={
  inputs:{scenarioId:'experimental / A1'},
  initialWorld:world,
  result:{snapshots:snapshot,goal:null,technicalGoal:{status:'NOT_ACHIEVED',assessments:[]},
    eventLog:[],decisionTraces:[],status:'COMPLETED'},
} as unknown as PlayView['a1']
const base:PlayView={
  mode:'INTEGRATED_EXPERIMENTAL',
  input:{mode:'INTEGRATED_EXPERIMENTAL',seed:20260101,year:1269,
    firstPersonId:'person-exp-02',secondPersonId:'person-exp-05',signedDelta:-150,durationYears:60},
  modifier:{modifierId:'test'} as PlayView['modifier'],
  a0:run,a1:run,
}
const renderForm=(comparison=base)=>{
  const onRun=vi.fn(),onViewA2=vi.fn()
  render(<FollowupInterventionPanel comparison={comparison} year={1269} activeBranch="A1" busy={false} onRun={onRun} onViewA2={onViewA2}/>)
  return {onRun,onViewA2}
}
describe('第2介入GUIフォーム',()=>{
 it('同年の別ペア2件目をA1へ追加する入力を送る（第1介入不変）',()=>{
  const {onRun}=renderForm()
  const button=screen.getByTestId('a2-run') as HTMLButtonElement
  expect(button.disabled).toBe(true)
  fireEvent.change(screen.getByTestId('a2-person-one'),{target:{value:'person-exp-04'}})
  fireEvent.change(screen.getByTestId('a2-person-two'),{target:{value:'person-exp-05'}})
  expect(button.disabled).toBe(false)
  fireEvent.submit(button.closest('form')!)
  expect(onRun).toHaveBeenCalledOnce()
  expect(onRun).toHaveBeenCalledWith({...base.input,second:{
    firstPersonId:'person-exp-04',secondPersonId:'person-exp-05',signedDelta:-200,durationYears:60,
  }})
 })
 it('同年の同じペア（順序逆も）は重複拒否',()=>{
  const {onRun}=renderForm()
  fireEvent.change(screen.getByTestId('a2-person-one'),{target:{value:'person-exp-05'}})
  fireEvent.change(screen.getByTestId('a2-person-two'),{target:{value:'person-exp-02'}})
  expect((screen.getByTestId('a2-run') as HTMLButtonElement).disabled).toBe(true)
  expect(screen.getByTestId('a2-duplicate').textContent).toContain('重複介入')
  fireEvent.submit(screen.getByTestId('a2-run').closest('form')!)
  expect(onRun).not.toHaveBeenCalled()
 })
 it('第2介入の実計算結果だけをA1→A2差分として表示し、正式勝敗を捏造しない',()=>{
  const comparison:PlayView={...base,second:{...base,a0:base.a1,a1:base.a1}}
  const {onViewA2}=renderForm(comparison)
  expect(screen.getByTestId('a2-results').textContent).toContain('Event差分 0件')
  expect(screen.getByTestId('a2-goal-summary').textContent).toContain('正式勝敗は未成立')
  fireEvent.click(screen.getByTestId('view-a2'))
  expect(onViewA2).toHaveBeenCalledOnce()
 })
 it('比較実行中は2回目の実行を禁止',()=>{
  const onRun=vi.fn()
  render(<FollowupInterventionPanel comparison={base} year={1269} activeBranch="A1" busy onRun={onRun} onViewA2={()=>{}}/>)
  expect((screen.getByTestId('a2-run') as HTMLButtonElement).disabled).toBe(true)
 })
})
