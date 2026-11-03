// DEC-058: 第1縦断に限る国内通常婚姻の実WorldState適格性（BとAが同じ純粋関数で照合）。
// 未記録の親族を発明せず、参照欠落・循環はDEFER。年齢18歳はMVP限定の採用済み閾値。
import type { Id, Person, WorldState } from '../contracts/index.ts'

export type DomesticMarriageEligibility =
  | Readonly<{ status:'ELIGIBLE'; reasonCode:'DOMESTIC_MARRIAGE_ELIGIBLE'; countryId:Id }>
  | Readonly<{ status:'REJECT'|'DEFER'; reasonCode:string }>
export const MVP_MARRIAGE_MIN_AGE=18

const compare=(a:string,b:string)=>a<b?-1:a>b?1:0
const parents=(p:Person):Id[]=>[p.fatherId,p.motherId].filter((id):id is Id=>id!==undefined)

/** 祖先を根拠付きの最短距離で列挙。存在しない親IDや循環は法的事実を補わない。 */
function ancestors(personId:Id,byId:ReadonlyMap<Id,Person>):
  Readonly<{distances:ReadonlyMap<Id,number>;broken:boolean}>{
  const distances=new Map<Id,number>()
  const active=new Set<Id>()
  let broken=false
  const walk=(id:Id,depth:number):void=>{
    if(active.has(id)){broken=true;return}
    const p=byId.get(id)
    if(!p){broken=true;return}
    active.add(id)
    for(const parentId of parents(p)){
      const prior=distances.get(parentId)
      if(prior===undefined||prior>depth+1){
        distances.set(parentId,depth+1)
        walk(parentId,depth+1)
      }
    }
    active.delete(id)
  }
  walk(personId,0)
  return {distances,broken}
}

export function reviewDomesticMarriageEligibility(
  world:WorldState,pair:readonly [Id,Id],
):DomesticMarriageEligibility{
  if(pair[0]===pair[1]||!pair[0]||!pair[1]||compare(pair[0],pair[1])>0)
    return {status:'DEFER',reasonCode:'INVALID_PAIR'}
  const persons=new Map(world.persons.map(p=>[p.personId,p]))
  const a=persons.get(pair[0]),b=persons.get(pair[1])
  if(!a||!b)return {status:'DEFER',reasonCode:'PERSON_UNKNOWN'}
  if(!a.alive||!b.alive)return {status:'REJECT',reasonCode:'PERSON_DECEASED'}
  if(world.year-a.birthYear<MVP_MARRIAGE_MIN_AGE||
     world.year-b.birthYear<MVP_MARRIAGE_MIN_AGE)
    return {status:'DEFER',reasonCode:'BELOW_MVP_MARRIAGE_AGE'}
  if(a.sex===b.sex)return {status:'DEFER',reasonCode:'MVP_PARENT_MODEL_REQUIRES_MALE_FEMALE_PAIR'}
  if(world.legal.marriages.some(m=>m.status==='ACTIVE'&&
    m.personIds.some(id=>pair.includes(id))))
    return {status:'DEFER',reasonCode:'ACTIVE_MARRIAGE_EXISTS'}
  const ha=world.houses.find(h=>h.houseId===a.houseId)
  const hb=world.houses.find(h=>h.houseId===b.houseId)
  if(!ha?.countryId||ha.countryId!==hb?.countryId||
     !world.countries.some(c=>c.countryId===ha.countryId))
    return {status:'DEFER',reasonCode:'SAME_COUNTRY_JURISDICTION_UNVERIFIED'}
  const x=ancestors(a.personId,persons),y=ancestors(b.personId,persons)
  if(x.broken||y.broken)return {status:'DEFER',reasonCode:'KINSHIP_EVIDENCE_BROKEN'}
  if(x.distances.has(b.personId)||y.distances.has(a.personId))
    return {status:'REJECT',reasonCode:'DIRECT_ANCESTOR_KINSHIP'}
  for(const [ancestorId,stepsA] of x.distances){
    if(stepsA<=2&&(y.distances.get(ancestorId)??Number.POSITIVE_INFINITY)<=2)
      return {status:'REJECT',reasonCode:'COMMON_ANCESTOR_WITHIN_TWO_GENERATIONS'}
  }
  // ELIGIBLEは記録済み親子辺に限った審査結果。未記録の血縁が無いと断定するものではない。
  return {status:'ELIGIBLE',reasonCode:'DOMESTIC_MARRIAGE_ELIGIBLE',countryId:ha.countryId}
}
