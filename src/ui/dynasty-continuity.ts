// MVP 試遊の世代継承観測。WorldState・EventLogだけを読む（法制・出生・勝敗を補完しない）。
import type { Id, Person, WorldState } from '../simulation/contracts/index.ts'
import type { TimelineResult } from '../simulation/engine/index.ts'

export type ContinuityObservation = Readonly<{
  status: 'OBSERVED' | 'UNVERIFIED'
  finalYear: number | null
  bornAfterStart: number
  familyDepth: number
  birthsInInitialFamily: number
  birthsInTargetDynastyFamily: number
  legalTargetDescendants: number
  targetDescendantsUndetermined: number
  birthsWithUndeterminedDynasty: number
  livingLegalTargetMembers: number
  successionCasesPending: number
  marriageEvents: number
  birthEvents: number
  titleTransferEvents: number
  controlMandateEvents: number
}>

const unverified=():ContinuityObservation=>({
  status:'UNVERIFIED', finalYear:null, bornAfterStart:0,familyDepth:0,
  birthsInInitialFamily:0,birthsInTargetDynastyFamily:0,
  legalTargetDescendants:0,targetDescendantsUndetermined:0,
  birthsWithUndeterminedDynasty:0,livingLegalTargetMembers:0,successionCasesPending:0,
  marriageEvents:0,birthEvents:0,titleTransferEvents:0,controlMandateEvents:0,
})

/** 実在した親子辺だけから1250年初期の人物を基点とした世代数を計算する。
 * 初期に存在する人物は血縁的に親子でも基点扱い。欠落/循環は家系の根拠を増やさない。
 */
function descendantDepths(initial:WorldState,people:readonly Person[]):ReadonlyMap<Id,number>{
  const initialIds=new Set(initial.persons.map(p=>p.personId))
  const byId=new Map(people.map(p=>[p.personId,p]))
  const cache=new Map<Id,number>()
  const depth=(personId:Id,seen:ReadonlySet<Id>):number=>{
    if(initialIds.has(personId))return 0
    const prior=cache.get(personId)
    if(prior!==undefined)return prior
    if(seen.has(personId))return -1
    const p=byId.get(personId)
    if(!p)return -1
    const nextSeen=new Set(seen)
    nextSeen.add(personId)
    const knownParents=[p.fatherId,p.motherId].filter((id):id is Id=>id!==undefined)
    const parentDepth=knownParents.map(id=>depth(id,nextSeen))
    const max=Math.max(-1,...parentDepth)
    const value=max<0?-1:max+1
    cache.set(personId,value)
    return value
  }
  for(const p of people)depth(p.personId,new Set())
  return cache
}

export function observeDynastyContinuity(
  initial:WorldState,result:TimelineResult,targetDynastyId:Id,
):ContinuityObservation{
  const final=result.snapshots.at(-1)
  if(result.status!=='COMPLETED'||!final||final.year!==1350)return unverified()
  const initialIds=new Set(initial.persons.map(p=>p.personId))
  const initialTargetIds=new Set(initial.persons.filter(p=>p.legalDynasty.status==='DETERMINED'&&
    p.legalDynasty.dynastyId===targetDynastyId).map(p=>p.personId))
  const all=new Map(final.persons.map(p=>[p.personId,p]))
  const depths=descendantDepths(initial,final.persons)
  const targetCache=new Map<Id,boolean>()
  const fromTarget=(personId:Id,seen:ReadonlySet<Id>):boolean=>{
    if(initialTargetIds.has(personId))return true
    const prior=targetCache.get(personId)
    if(prior!==undefined)return prior
    if(seen.has(personId))return false
    const p=all.get(personId)
    if(!p)return false
    const guard=new Set(seen);guard.add(personId)
    const yes=[p.fatherId,p.motherId].some(id=>id!==undefined&&fromTarget(id,guard))
    targetCache.set(personId,yes)
    return yes
  }
  const born=final.persons.filter(p=>!initialIds.has(p.personId)&&p.birthYear>=initial.year)
  const initialFamilyBorn=born.filter(p=>(depths.get(p.personId)??-1)>0)
  const targetBorn=born.filter(p=>fromTarget(p.personId,new Set()))
  const countEvents=(type:string)=>result.eventLog.filter(e=>e.eventType.split('+').includes(type)).length
  return {
    status:'OBSERVED',finalYear:final.year,bornAfterStart:born.length,
    familyDepth:Math.max(0,...initialFamilyBorn.map(p=>depths.get(p.personId)??0)),
    birthsInInitialFamily:initialFamilyBorn.length,
    birthsInTargetDynastyFamily:targetBorn.length,
    legalTargetDescendants:targetBorn.filter(p=>p.legalDynasty.status==='DETERMINED'&&
      p.legalDynasty.dynastyId===targetDynastyId).length,
    targetDescendantsUndetermined:targetBorn.filter(p=>p.legalDynasty.status==='UNDETERMINED').length,
    birthsWithUndeterminedDynasty:born.filter(p=>p.legalDynasty.status==='UNDETERMINED').length,
    livingLegalTargetMembers:final.persons.filter(p=>p.alive&&p.legalDynasty.status==='DETERMINED'&&
      p.legalDynasty.dynastyId===targetDynastyId).length,
    successionCasesPending:final.legal.cases.filter(c=>c.kind==='SUCCESSION'&&c.status==='PENDING').length,
    marriageEvents:countEvents('MARRIAGE_REGISTER'),
    birthEvents:countEvents('PERSON_BIRTH'),
    titleTransferEvents:countEvents('LEGAL_TITLE_TRANSFER'),
    controlMandateEvents:countEvents('CONTROL_MANDATE_SET'),
  }
}
