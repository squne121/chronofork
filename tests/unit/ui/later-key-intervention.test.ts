// Issue #104: 介入対象はfork年初の実WorldStateで検査する。
import {describe,expect,it} from 'vitest'
import {interventionTargetIssue,runPlayComparison} from '../../../src/ui/branch-play-source.ts'
import type {PlayInput} from '../../../src/ui/branch-play-source.ts'
import {createExperimentalWorld} from '../../../src/scenario/experimental/index.ts'
import type {WorldState, EventLogEntry} from '../../../src/simulation/contracts/index.ts'
import { candidateLabel } from '../../../src/ui/play-candidates.ts'
import { namesOf, namesOfYear, eventHeadline, lineageRows } from '../../../src/ui/integrated-overview.ts'
import { personDisplayNames } from '../../../src/ui/observation/person-display.ts'

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

describe('表示名は実データと枝の人物IDに基づく',()=>{
  it('同年生まれの別人を区別し、出生Event・介入候補・比較で仮名の内部キーを出さない',()=>{
    const base=createExperimentalWorld()
    const child={...base.persons[0]!,personId:'child-a',name:'試験用自律児 1260 (marriage:secret)',birthYear:1260,
      fatherId:base.persons[0]!.personId}
    const twin={...child,personId:'child-b'}
    const world={...base,persons:[...base.persons,child,twin]}
    const resolve=personDisplayNames(world.persons)
    expect(resolve(child.personId)).not.toBe(resolve(twin.personId))
    expect(namesOf(world).person(child.personId)).toBe(resolve(child.personId))
    expect(candidateLabel({id:child.personId,...child})).toContain(resolve(child.personId))
    expect(candidateLabel({id:twin.personId,...twin})).toContain(resolve(twin.personId))
    expect(candidateLabel({id:child.personId,...child})).not.toContain('marriage:')
    expect(lineageRows(base,world).find(p=>p.personId===child.personId)?.name).toBe(resolve(child.personId))
    const event={eventId:'birth',semanticEventKey:'birth',year:1260,phase:3,eventType:'PERSON_BIRTH',involvedRefs:[],
      stateChanges:[{path:'$.persons[child-a]',before:null,after:child}],sourceTraceIds:[]} as unknown as EventLogEntry
    expect(eventHeadline(event,namesOfYear(world,[event]),'出生')).toContain(resolve(child.personId))
    for (const person of [()=>child.name,()=>undefined]) {
      const headline=eventHeadline(event,{...namesOf(base),person},'出生')
      expect(headline).not.toContain('marriage:')
      expect(headline).toContain('試験人物（1260年生')
    }
    expect(namesOf(base).person(child.personId)).toBeUndefined()
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
