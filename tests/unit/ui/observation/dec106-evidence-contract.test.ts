import {describe,expect,it} from 'vitest'
import {createExperimentalIntegratedWorld} from '../../../../src/scenario/experimental/index.ts'
import {buildTitleHoldingHistories} from '../../../../src/ui/observation/title-history.ts'
import {buildA0KnownEnding} from '../../../../src/ui/observation/a0-known-ending.ts'
import type {EventLogEntry,WorldState} from '../../../../src/simulation/contracts/index.ts'

describe('DEC-106: 逆算調査に供する証拠の決定論的な契約',()=>{
  const original=createExperimentalIntegratedWorld()
  const crown=original.titles.find(t=>t.kind==='CROWN')!
  const territory=original.titles.find(t=>t.kind==='TERRITORIAL')!

  const withHolder=(year:number,titleId:string,holder:WorldState['titles'][number]['holder']):WorldState=>({
    ...original,year,titles:original.titles.map(t=>t.titleId===titleId?{...t,holder}:t),
  })
  it('年初に保持者が未確定になっても、記録がなければ「剥奪Event」を作らない',()=>{
    const next=withHolder(1251,territory.titleId,{status:'UNDETERMINED'})
    const history=buildTitleHoldingHistories([original,next],[])
      .find(x=>x.titleId===territory.titleId)!
    expect(history.intervals).toHaveLength(2)
    expect(history.intervals[0]!.fromYear).toBe(1250)
    expect(history.intervals[1]).toMatchObject({fromYear:1251,holder:{status:'UNDETERMINED'}})
    expect(history.transfers).toEqual([])
  })
  it('王位と領主権を別の履歴として分離し、他称号の移転を誤接続しない',()=>{
    const transfer={
      eventId:'ev-title',year:1250,eventType:'LEGAL_TITLE_TRANSFER',
      stateChanges:[{path:'$.titles['+crown.titleId+'].holder.personId',before:'old',after:'new'}],
    } as unknown as EventLogEntry
    const result=buildTitleHoldingHistories([original],[transfer])
    expect(result.find(h=>h.titleId===crown.titleId)?.transfers).toMatchObject([{year:1250,eventId:'ev-title'}])
    expect(result.find(h=>h.titleId===territory.titleId)?.transfers).toEqual([])
    expect(result.find(h=>h.titleId===crown.titleId)?.kind).toBe('CROWN')
    expect(result.find(h=>h.titleId===territory.titleId)?.kind).toBe('TERRITORIAL')
  })
  it('記録にない人の運命や1350年未計算の未来を補完しない',()=>{
    expect(buildA0KnownEnding(original,undefined)).toBeNull()
    const end:WorldState={...original,year:1350,persons:original.persons.slice(1)}
    const fate=buildA0KnownEnding(original,end)!
    expect(fate.year).toBe(1350)
    expect(fate.persons.find(p=>p.personId===original.persons[0]!.personId)?.status).toBe('NOT_RECORDED')
  })
  it('翌年初の変化と当年のEventが異なる時点であることを証拠上区別する',()=>{
    const after=withHolder(1251,crown.titleId,{status:'UNDETERMINED'})
    const event={
      eventId:'confirmed',year:1250,eventType:'LEGAL_TITLE_TRANSFER',
      stateChanges:[{path:'$.titles['+crown.titleId+'].holder',before:crown.holder,after:{status:'UNDETERMINED'}}],
    } as unknown as EventLogEntry
    const history=buildTitleHoldingHistories([original,after],[event]).find(h=>h.titleId===crown.titleId)!
    expect(history.intervals[1]!.fromYear).toBe(event.year+1)
    expect(history.transfers).toMatchObject([{year:event.year,eventId:event.eventId}])
  })
})
