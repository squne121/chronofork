import { describe,expect,it } from 'vitest'
import { createExperimentalWorld } from '../../../src/scenario/experimental/index.ts'
import { createAutonomousCalibrationEvaluators } from '../../../src/simulation/autonomy/index.ts'
import { validateWorldState } from '../../../src/simulation/validation/index.ts'
import type { Person, WorldState, StatModifier } from '../../../src/simulation/contracts/index.ts'
import { STAT_MODIFIER_RULE_VERSION } from '../../../src/simulation/contracts/index.ts'

const source=createExperimentalWorld()
const supportId='support:population:["trial",0]'
const support:Person={
  personId:supportId,name:'試験用・非操作対象の婚姻補助人物',interactionRole:'SUPPORTING',
  sex:'FEMALE',birthYear:1230,alive:true,
  originGroupId:'group-east-elite',houseId:'house-cardon',
  legalDynasty:{status:'UNDETERMINED',reasonCodes:['POPULATION_AGGREGATE_NO_DYNASTY_PROOF']},
}
const withSupport:WorldState={...source,persons:[...source.persons,support]}
const personPair=[source.persons[1]!.personId,supportId].sort() as [string,string]
const modifier:StatModifier={
  modifierId:'mod:support-person-blocked',interventionId:'int:support-person-blocked',
  targetRef:{kind:'PERSON_PAIR',ids:personPair},statKey:'pair.trust',
  signedDelta:20,startYear:1250,endExclusiveYear:1255,decayPolicy:'NONE',
  ruleVersion:STAT_MODIFIER_RULE_VERSION,
}
describe('DEC-061: 法的な補助人物と直接介入可能な重要人物を分離',()=>{
  it('SUPPORTINGはPersonとして婚姻・出生の法的追跡ができるが、世界の人口は増えない',()=>{
    const v=validateWorldState(withSupport)
    expect(v.ok).toBe(true)
    expect(withSupport.groups).toEqual(source.groups)
    expect(source.persons).toHaveLength(8)
    expect(withSupport.persons).toHaveLength(9)
    expect(source.persons.every(p=>p.interactionRole===undefined)).toBe(true)
  })
  it('介入modifierはSUPPORTINGのペアを直接対象にできず、KEY同士は従来どおり',()=>{
    const r=createAutonomousCalibrationEvaluators({
      branchStartWorld:withSupport,ledger:[modifier],trustBase:[],
    })
    expect(r).toMatchObject({ok:false,issues:['SUPPORTING_PERSON_NOT_DIRECTLY_INTERACTABLE']})
    const okay=createAutonomousCalibrationEvaluators({
      branchStartWorld:withSupport,ledger:[],trustBase:[],
    })
    expect(okay.ok).toBe(true)
  })
  it('未知の人物Roleを勝手にKEYへ変換しない',()=>{
    const broken={
      ...withSupport,
      persons:[...source.persons,{...support,interactionRole:'OTHER'}],
    }
    expect(validateWorldState(broken).ok).toBe(false)
  })
})
