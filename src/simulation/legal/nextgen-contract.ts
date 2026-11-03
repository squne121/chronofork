// DEC-058: 家門契約案を当年の実人物・王朝・所領・家門支持から評価。
// 校正用効用係数は暫定。父系デフォルト、勝利対象王朝への優遇、同率のID順解消は禁止。
import type { Id, MarriageContract, Person, WorldState } from '../contracts/index.ts'

export type ContractChoice=Readonly<{
  key:string
  dynastyId:Id|null
  firstConsentScore:number
  secondConsentScore:number
  mutuallyAccepted:boolean
  minimumUtility:number
}>
export type ContractAgreement=
  | Readonly<{status:'ACCEPT';reasonCode:'BOTH_PARTIES_ACCEPT_UNIQUE_CONTRACT';choice:ContractChoice;choices:readonly ContractChoice[]}>
  | Readonly<{status:'DEFER';reasonCode:string;choices:readonly ContractChoice[]}>

export type NextgenContractCalibration=Readonly<{
  status:'CALIBRATION_ONLY'
  consentThreshold:number
  ownDynastyBonus:number
  otherDynastyCost:number
  titleWeight:number
  noClauseCost:number
  supportWeight:number
}>
export const EXPERIMENTAL_NEXTGEN_CONTRACT:NextgenContractCalibration=Object.freeze({
  status:'CALIBRATION_ONLY',
  consentThreshold:15,
  ownDynastyBonus:10,
  otherDynastyCost:9,
  titleWeight:3,
  noClauseCost:5,
  supportWeight:1,
})
const cmp=(a:string,b:string)=>a<b?-1:a>b?1:0
const int=(n:unknown):n is number=>Number.isSafeInteger(n)
export function validateNextgenContractCalibration(c:NextgenContractCalibration):readonly string[]{
  if(!c||c.status!=='CALIBRATION_ONLY')return ['CONTRACT_CALIBRATION_NOT_EXPERIMENTAL']
  const fields=[
    c.consentThreshold,c.ownDynastyBonus,c.otherDynastyCost,
    c.titleWeight,c.noClauseCost,c.supportWeight,
  ]
  return fields.every(n=>int(n)&&Math.abs(n)<=1000)?[]:['CONTRACT_CALIBRATION_OUT_OF_RANGE']
}
function dynastyOf(p:Person,world:WorldState):Id|null{
  if(p.legalDynasty.status!=='DETERMINED')return null
  const id=p.legalDynasty.dynastyId
  return world.legal.dynasties.some(d=>d.dynastyId===id)?id:null
}
function titleStrength(world:WorldState,id:Id):number{
  const people=new Map(world.persons.map(p=>[p.personId,p]))
  return world.titles.filter(t=>{
    if(!t.valid||!t.hereditary||t.recognition.status!=='ACTIVE'||t.holder.status!=='HELD')
      return false
    const holder=people.get(t.holder.personId)
    return holder!==undefined&&dynastyOf(holder,world)===id
  }).length
}
function houseSupport(world:WorldState,p:Person,id:Id):number{
  const group=world.groups.find(g=>g.groupId===p.originGroupId)
  if(!group)return 0
  const houses=new Set(world.persons.filter(x=>dynastyOf(x,world)===id).map(x=>x.houseId))
  return Math.max(0,...[...houses].map(h=>group.support.houseBps[h]??0))
}
export function chooseNextgenContract(
  world:WorldState,pair:readonly [Id,Id],trustScore:number,
  calibration:NextgenContractCalibration=EXPERIMENTAL_NEXTGEN_CONTRACT,
):ContractAgreement{
  if(validateNextgenContractCalibration(calibration).length>0||!int(trustScore)||Math.abs(trustScore)>1000)
    return {status:'DEFER',reasonCode:'CONTRACT_CALIBRATION_OR_SCORE_INVALID',choices:[]}
  const ps=pair.map(id=>world.persons.find(p=>p.personId===id))
  if(ps.some(p=>!p))return {status:'DEFER',reasonCode:'CONTRACT_PARTY_MISSING',choices:[]}
  const people=ps as [Person,Person]
  if(people.some(p=>!world.groups.some(g=>g.groupId===p.originGroupId)))
    return {status:'DEFER',reasonCode:'CONTRACT_HOUSE_SUPPORT_UNVERIFIED',choices:[]}
  const dyn=people.map(p=>dynastyOf(p,world))
  const dynasties=[...new Set(dyn.filter((v):v is Id=>v!==null))].sort(cmp)
  const options:(Id|null)[]=[null,...dynasties]
  const choices:ContractChoice[]=options.map(id=>{
    const utility=(p:Person,idx:number):number=>{
      if(id===null)return trustScore-calibration.noClauseCost
      const self=dyn[idx]===id
      const preference=self?calibration.ownDynastyBonus:-calibration.otherDynastyCost
      return trustScore+preference+
        calibration.titleWeight*titleStrength(world,id)+
        calibration.supportWeight*Math.floor(houseSupport(world,p,id)/2000)
    }
    const firstConsentScore=utility(people[0],0),secondConsentScore=utility(people[1],1)
    return {
      key:id===null?'NO_CLAUSE':'CHILD_DYNASTY:'+id,
      dynastyId:id,firstConsentScore,secondConsentScore,
      mutuallyAccepted:firstConsentScore>=calibration.consentThreshold&&
        secondConsentScore>=calibration.consentThreshold,
      minimumUtility:Math.min(firstConsentScore,secondConsentScore),
    }
  })
  const accepted=choices.filter(c=>c.mutuallyAccepted)
  if(accepted.length===0)return {status:'DEFER',reasonCode:'NO_BILATERAL_CONSENT',choices}
  const top=Math.max(...accepted.map(c=>c.minimumUtility))
  const leaders=accepted.filter(c=>c.minimumUtility===top)
  if(leaders.length!==1)return {status:'DEFER',reasonCode:'CONTRACT_CHOICE_TIE',choices}
  return {status:'ACCEPT',reasonCode:'BOTH_PARTIES_ACCEPT_UNIQUE_CONTRACT',choice:leaders[0]!,choices}
}

/** B-005がその年に合意した選択肢をAが登録するための安定した証拠。
 * B-005 Trace とA-LEG-01の再評価が一致しなければ、証拠IDだけでは登録不可。
 */
export function negotiatedMarriageContract(
  year:number,pair:readonly [Id,Id],choice:ContractChoice,sourceTraceId:Id,
):MarriageContract{
  const key=JSON.stringify([year,pair,choice.key])
  const clause=choice.dynastyId===null?[]:[{
    clauseId:'clause:nextgen:'+key,kind:'CHILD_LEGAL_DYNASTY' as const,dynastyId:choice.dynastyId,
  }]
  return {contractId:'contract:nextgen:'+key,
    evidenceId:'evidence:nextgen-agreement:'+sourceTraceId,clauses:clause}
}
