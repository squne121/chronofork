// Issue #104: 介入対象はfork年初の実WorldStateで検査する。
import {describe,expect,it} from 'vitest'
import {interventionTargetIssue,runPlayComparison} from '../../../src/ui/branch-play-source.ts'
import type {PlayInput} from '../../../src/ui/branch-play-source.ts'
import {createExperimentalWorld} from '../../../src/scenario/experimental/index.ts'
import type {WorldState} from '../../../src/simulation/contracts/index.ts'

describe('interventionTargetIssue（GUI/CLI共通の対象適格性）',()=>{
  const base=createExperimentalWorld()
  const [a,b]=base.persons
  const withPerson=(extra:Partial<WorldState['persons'][number]>&{personId:string}):WorldState=>({
    ...base,persons:[...base.persons,{...a!,...extra}],
  })
  it('KEY・role省略は許可し、未登録は UNKNOWN_PERSON',()=>{
    expect(interventionTargetIssue(base,[a!.personId,b!.personId])).toBeNull()
    expect(interventionTargetIssue(base,[a!.personId,'person-none'])?.code).toBe('UNKNOWN_PERSON')
  })
  it('後から登録された人物はfork年初のWorldStateに居れば許可される',()=>{
    const w=withPerson({personId:'person-later',interactionRole:'KEY'})
    expect(interventionTargetIssue(w,[a!.personId,'person-later'])).toBeNull()
    expect(interventionTargetIssue(base,[a!.personId,'person-later'])?.code).toBe('UNKNOWN_PERSON')
  })
  it('SUPPORTINGは自動的に直接介入可能にならない',()=>{
    const w=withPerson({personId:'person-sup',interactionRole:'SUPPORTING'})
    expect(interventionTargetIssue(w,[a!.personId,'person-sup'])?.code).toBe('SUPPORTING_PERSON_NOT_DIRECTLY_INTERACTABLE')
  })
})

describe('既存の初期人物への介入は回帰しない',()=>{
  const INPUT:PlayInput={mode:'FIXED_APPROVAL',seed:20260101,year:1260,firstPersonId:'person-exp-04',
    secondPersonId:'person-exp-05',signedDelta:20,durationYears:5}
  it('受理される／存在しない人物は拒否',()=>{
    expect(runPlayComparison(INPUT).ok).toBe(true)
    expect(runPlayComparison({...INPUT,secondPersonId:'no-person'})).toMatchObject({ok:false,code:'UNKNOWN_PERSON'})
  })
})
