import {describe,expect,it} from 'vitest'
import type { WorldState } from '../../../../src/simulation/contracts/index.ts'
import { createExperimentalIntegratedWorld } from '../../../../src/scenario/experimental/index.ts'
import { buildA0KnownEnding } from '../../../../src/ui/observation/a0-known-ending.ts'

describe('原史A0の既知の未来は選択年の状態と独立',()=>{
  const base=createExperimentalIntegratedWorld()
  it('1250年初には存命の人物も、A0の1350年初に死亡済みなら没年を示す。選択年状態は変更しない',()=>{
    const person=base.persons.find(p=>p.personId==='person-exp-01')!
    const goal:WorldState={...base,year:1350,persons:base.persons.map(p=>p.personId===person.personId
      ?{...p,alive:false,deathYear:1268}:p)}
    const before=JSON.stringify(base)
    const result=buildA0KnownEnding(base,goal)
    expect(person.alive).toBe(true)
    expect(result?.year).toBe(1350)
    expect(result?.persons.find(p=>p.personId===person.personId)).toEqual({
      personId:person.personId,status:'DEAD',deathYear:1268,
    })
    expect(JSON.stringify(base)).toBe(before)
  })
  it('1350年初が未計算なら既知未来を表示しない',()=>{
    expect(buildA0KnownEnding(base,undefined)).toBeNull()
    expect(buildA0KnownEnding(base,{...base,year:1300})).toBeNull()
  })
  it('最終記録に人物がないことを死亡扱いにしない',()=>{
    const goal:WorldState={...base,year:1350,persons:base.persons.slice(1)}
    const result=buildA0KnownEnding(base,goal)
    expect(result?.persons.find(p=>p.personId===base.persons[0]!.personId)?.status).toBe('NOT_RECORDED')
  })
})
