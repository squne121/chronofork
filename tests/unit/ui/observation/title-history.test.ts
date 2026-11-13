import {describe,it,expect} from 'vitest'
import {createExperimentalIntegratedWorld} from '../../../../src/scenario/experimental/index.ts'
import {buildTitleHoldingHistories,titleLabel} from '../../../../src/ui/observation/title-history.ts'
import type {EventLogEntry,WorldState} from '../../../../src/simulation/contracts/index.ts'

describe('Titleの歴代保持者記録',()=>{
  const initial=createExperimentalIntegratedWorld()
  const territorial=initial.titles.find(t=>t.titleId==='title-exp-central')!
  const crown=initial.titles.find(t=>t.titleId==='title-exp-crown-eldia')!
  it('同一地域の王位CROWNと中央領地TERRITORIALを別名・別IDで表示する',()=>{
    expect(titleLabel(crown,initial)).toContain('エルディア王位')
    expect(titleLabel(territorial,initial)).toContain('エルディア中央の領主権')
    expect(crown.titleId).not.toBe(territorial.titleId)
  })
  it('年初の保持者・未確定を連続した実期間として表示し、移転Eventの無い変化を補完しない',()=>{
    const withHolder=(year:number,holder:WorldState['titles'][number]['holder']):WorldState=>({
      ...initial,year,titles:initial.titles.map(t=>t.titleId===territorial.titleId?{...t,holder}:t),
    })
    const w1251=withHolder(1251,{status:'HELD',personId:'person-exp-02'})
    const w1252=withHolder(1252,{status:'HELD',personId:'person-exp-02'})
    const w1253=withHolder(1253,{status:'UNDETERMINED'})
    const rows=buildTitleHoldingHistories([w1253,initial,w1252,w1251],[])
    const h=rows.find(x=>x.titleId===territorial.titleId)!
    expect(h.intervals.map(x=>[x.fromYear,x.throughYear,x.holder.status])).toEqual([
      [1250,1250,'HELD'],[1251,1252,'HELD'],[1253,1253,'UNDETERMINED'],
    ])
    expect(h.intervals[1]?.holder).toMatchObject({personId:'person-exp-02'})
    expect(h.transfers).toHaveLength(0)
  })
  it('CROWNに死亡者名義が残る場合、生存中と死後の保持記録を分割し、架空の移転Eventを作らない',()=>{
    const initialCrown=initial.titles.find(x=>x.titleId==='title-exp-crown-eldia')!
    const before={...initial,year:1268}
    const dead={...initial,year:1269,persons:initial.persons.map(p=>p.personId==='person-exp-01'
      ?{...p,alive:false,deathYear:1268}:p)}
    const history=buildTitleHoldingHistories([before,dead],[])
      .find(x=>x.titleId===initialCrown.titleId)!
    expect(history.intervals).toHaveLength(2)
    expect(history.intervals[0]?.holder).toMatchObject({status:'HELD',life:'ALIVE'})
    expect(history.intervals[1]?.holder).toMatchObject({status:'HELD',life:'DEAD',deathYear:1268})
    expect(history.transfers).toHaveLength(0)
  })
  it('確認済みのTitle保持差分に対応するEventだけを出典として結びつける',()=>{
    const transfer={eventId:'e-title',eventType:'LEGAL_TITLE_TRANSFER',year:1250,
      stateChanges:[{path:'$.titles[title-exp-central].holder.personId',before:'person-exp-01',after:'person-exp-02'}]} as unknown as EventLogEntry
    const unrelated={...transfer,eventId:'e-unrelated',stateChanges:[
      {path:'$.titles[title-exp-west].holder.personId',before:'a',after:'b'}]} as EventLogEntry
    const h=buildTitleHoldingHistories([initial],[transfer,unrelated]).find(x=>x.titleId===territorial.titleId)!
    expect(h.transfers).toEqual([{year:1250,eventId:'e-title'}])
  })
})
