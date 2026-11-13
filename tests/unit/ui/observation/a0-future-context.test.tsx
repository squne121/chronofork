// @vitest-environment jsdom
import {cleanup,fireEvent,render,screen} from '@testing-library/react'
import {afterEach,expect,it,vi} from 'vitest'
import type { ObservationSlice } from '../../../../src/ui/branch-play-source.ts'
import { createExperimentalIntegratedWorld } from '../../../../src/scenario/experimental/index.ts'
import { buildA0KnownEnding } from '../../../../src/ui/observation/a0-known-ending.ts'
import { buildTitleHoldingHistories } from '../../../../src/ui/observation/title-history.ts'
import { A0FutureContext } from '../../../../src/ui/observation/A0FutureContext.tsx'
afterEach(cleanup)
const initial=createExperimentalIntegratedWorld()
const final={
  ...initial,year:1350,
  persons:initial.persons.map(p=>p.personId==='person-exp-01'?{...p,alive:false,deathYear:1268}:p),
  titles:initial.titles.map(t=>t.titleId==='title-exp-central'?{...t,holder:{status:'UNDETERMINED' as const}}:t),
}
const view:ObservationSlice={
  seed:20260101,mode:'INTEGRATED_EXPERIMENTAL',year:1250,world:initial,
  events:[],traces:[],counts:[],candidates:{seed:20260101,mode:'INTEGRATED_EXPERIMENTAL',candidates:[]},
  titleHistories:buildTitleHoldingHistories([initial,final],[]),
  knownA0Ending:buildA0KnownEnding(initial,final),
  technicalGoal:null,goal:null,status:'COMPLETED',a0Source:'COMPUTED',
}
it('1250年初の存命と、原史A0の既知の死亡を別時点として示し没年へ移動できる',()=>{
  const onYear=vi.fn()
  render(<A0FutureContext observation={view} personId="person-exp-01" onYearSelect={onYear} onTitleSelect={vi.fn()}/>)
  expect(screen.getByTestId('obs-future-current').textContent).toContain('1250年')
  expect(screen.getByTestId('obs-future-current').textContent).toContain('存命')
  expect(screen.getByTestId('obs-future-ending').textContent).toContain('原史A0')
  expect(screen.getByTestId('obs-future-fate').textContent).toContain('1268年')
  fireEvent.click(screen.getByTestId('obs-future-death-jump'))
  expect(onYear).toHaveBeenCalledWith(1268)
})
it('死亡した王位の名義を合法な継承とみなさず、同年初の領主権の未確定を区別する',()=>{
  const onTitle=vi.fn()
  render(<A0FutureContext observation={view} personId="person-exp-01" onYearSelect={vi.fn()} onTitleSelect={onTitle}/>)
  const titles=screen.getByTestId('obs-future-titles')
  expect(titles.textContent).toContain('エルディア王位')
  expect(titles.textContent).toContain('故人の名義が残存')
  expect(titles.textContent).toContain('エルディア中央の領主権')
  expect(titles.textContent).toContain('保持者未確定')
  fireEvent.click(screen.getByRole('button',{name:/エルディア王位/}))
  expect(onTitle).toHaveBeenCalledWith('title-exp-crown-eldia')
})
it('1350年初のA0確定結果がない場合には未来を作らない',()=>{
  render(<A0FutureContext observation={{...view,knownA0Ending:null}} personId="person-exp-01"
    onYearSelect={vi.fn()} onTitleSelect={vi.fn()}/>)
  expect(screen.getByTestId('obs-future-fate').textContent).toContain('確定記録なし')
  expect(screen.queryByTestId('obs-future-death-jump')).toBeNull()
})
