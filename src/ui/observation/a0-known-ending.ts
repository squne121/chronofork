// 計算済み原史A0の1350年初の人物生死だけを、選択年初のWorldStateと分離する。
// 原史A0のWorldStateから直接導出。A1/A2・未来の推測・勝利フラグは扱わない。
import type { Id, WorldState, Year } from '../../simulation/contracts/index.ts'
import { GOAL_YEAR } from '../../simulation/contracts/index.ts'

export type A0PersonFate=Readonly<{
  personId:Id
  status:'ALIVE'|'DEAD'|'NOT_RECORDED'
  deathYear?:Year
}>
export type A0KnownEnding=Readonly<{
  year:typeof GOAL_YEAR
  persons:readonly A0PersonFate[]
}>

/** 1350年初の確定snapshotがないときはnull（見かけの未来を生成しない）。 */
export function buildA0KnownEnding(observedWorld:WorldState,goalWorld:WorldState|undefined):A0KnownEnding|null{
  if(goalWorld?.year!==GOAL_YEAR)return null
  const endPersons=new Map(goalWorld.persons.map(p=>[p.personId,p]))
  return {
    year:GOAL_YEAR,
    persons:observedWorld.persons.filter(p=>p.birthYear<=observedWorld.year).map(p=>{
      const final=endPersons.get(p.personId)
      if(!final)return {personId:p.personId,status:'NOT_RECORDED' as const}
      return {personId:p.personId,status:final.alive?'ALIVE' as const:'DEAD' as const,
        ...(final.deathYear===undefined?{}:{deathYear:final.deathYear})}
    }),
  }
}
