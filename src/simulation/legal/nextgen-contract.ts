// DEC-058: 家門契約案を当年の実人物・王朝・所領・家門支持から評価。
// 校正用効用係数は暫定。父系デフォルト、勝利対象王朝への優遇、同率のID順解消は禁止。
import type { Id, MarriageContract, NextgenContractChildHouse, NextgenContractIdentity, Person, WorldState } from '../contracts/index.ts'
import { NEXTGEN_CONTRACT_SELECTION_VERSION } from '../contracts/index.ts'
import { marriageCandidatePersons } from './nextgen-marriage.ts'
import { childHouseClauseIssue } from './child-house.ts'
import { lineageContinuity } from './lineage-continuity.ts'
import type { LineageContinuityCalibration } from './lineage-continuity.ts'
import {
  nextgenContractIdentityKey, nextgenContractKey, nextgenMarriageContract, nextgenSelectionContract,
} from './nextgen-contract-ids.ts'

export const NEXTGEN_LINEAGE_CONTINUITY_VERSION='b005-bilateral-family-contract-6-dec197:CALIBRATION_ONLY'
type ContinuityBasis=ReturnType<typeof lineageContinuity>
type ContinuityEvidence=Readonly<{
  calibration: LineageContinuityCalibration
  consentThreshold: number
  parties: readonly [ContinuityBasis,ContinuityBasis]
}>
type ContinuityUtility=Readonly<{
  baseUtility: number
  marriageBonus: number
  preservesShortfallHouse: boolean
  preservesShortfallDynasty: boolean
  affiliationBonus: number
  consents: boolean
}>

/** DEC-190: 契約案の子の家門。PATERNAL_DEFAULTは無条項、MATERNALは母の家門を指定する明示条項。 */
export type ContractChildHouse = NextgenContractChildHouse

export type ContractChoice=Readonly<{
  /** 旧構成は NO_CLAUSE / CHILD_DYNASTY:<id>、DEC-190構成は構造化同一性の正規キー（nextgenContractIdentityKey）。 */
  key:string
  dynastyId:Id|null
  firstConsentScore:number
  secondConsentScore:number
  mutuallyAccepted:boolean
  minimumUtility:number
  /** DEC-190構成だけが持つ。旧構成の選択肢・記録は変更しない。 */
  childHouse?:ContractChildHouse
  /** 当事者順。家門・王朝の双方を維持する場合にも所属加点は1回。 */
  continuityUtility?:readonly [ContinuityUtility,ContinuityUtility]
}>
/** DEC-190構成の選択肢の構造化同一性。旧構成の選択肢はnull。 */
export const contractChoiceIdentity=(c:Pick<ContractChoice,'dynastyId'|'childHouse'>):NextgenContractIdentity|null=>
  c.childHouse===undefined?null:{dynastyId:c.dynastyId,childHouse:c.childHouse}
export type ContractAgreement=(
  | Readonly<{status:'ACCEPT';reasonCode:'BOTH_PARTIES_ACCEPT_UNIQUE_CONTRACT';choice:ContractChoice;choices:readonly ContractChoice[]}>
  | Readonly<{status:'DEFER';reasonCode:string;choices:readonly ContractChoice[]}>
) & Readonly<{continuityEvidence?:ContinuityEvidence}>

export type NextgenContractCalibration=Readonly<{
  status:'CALIBRATION_ONLY'
  consentThreshold:number
  ownDynastyBonus:number
  otherDynastyCost:number
  titleWeight:number
  noClauseCost:number
  supportWeight:number
  /** DEC-190の家門条項案。省略は旧版（王朝条項のみ）。王朝の利害係数とは別に版管理する。 */
  childHouse?:ChildHouseContractCalibration
  lineageContinuity?:LineageContinuityCalibration
}>
/** 子の家門所属に関する当事者別の利害（CALIBRATION_ONLY）。正式係数・家系存続意思ではない。 */
export type ChildHouseContractCalibration=Readonly<{
  status:'CALIBRATION_ONLY'
  version:string
  ownHouseBonus:number
  otherHouseCost:number
  /** 父方原則からの例外に双方が負う費用。 */
  exceptionCost:number
  titleWeight:number
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
  if(!fields.every(n=>int(n)&&Math.abs(n)<=1000))return ['CONTRACT_CALIBRATION_OUT_OF_RANGE']
  const h=c.childHouse
  if(h!==undefined){
    if(!h||h.status!=='CALIBRATION_ONLY'||typeof h.version!=='string'||h.version.length===0)
      return ['CHILD_HOUSE_CALIBRATION_NOT_EXPERIMENTAL']
    if(![h.ownHouseBonus,h.otherHouseCost,h.exceptionCost,h.titleWeight,h.supportWeight]
      .every(n=>int(n)&&Math.abs(n)<=1000))return ['CHILD_HOUSE_CALIBRATION_OUT_OF_RANGE']
  }
  const l=c.lineageContinuity
  if(l===undefined)return []
  if(h===undefined)return ['LINEAGE_CONTINUITY_REQUIRES_CHILD_HOUSE_CONTRACT']
  if(!l||l.status!=='CALIBRATION_ONLY'||typeof l.version!=='string'||l.version.length===0)
    return ['LINEAGE_CONTINUITY_CALIBRATION_NOT_EXPERIMENTAL']
  return [l.marriageBonus,l.affiliationBonus].every(n=>int(n)&&n>=0&&n<=1000)
    ?[]:['LINEAGE_CONTINUITY_CALIBRATION_OUT_OF_RANGE']
}
/** 当年の家門所属者が保持する有効な世襲Title数。王朝の称号強度とは別に数える。 */
function houseTitleStrength(world:WorldState,houseId:Id):number{
  const people=new Map(world.persons.map(p=>[p.personId,p]))
  return world.titles.filter(t=>t.valid&&t.hereditary&&t.recognition.status==='ACTIVE'&&
    t.holder.status==='HELD'&&people.get(t.holder.personId)?.houseId===houseId).length
}
function childHouseScore(world:WorldState,p:Person,houseId:Id,c:ChildHouseContractCalibration):number{
  const support=world.groups.find(g=>g.groupId===p.originGroupId)?.support.houseBps[houseId]??0
  return (p.houseId===houseId?c.ownHouseBonus:-c.otherHouseCost)+
    c.titleWeight*houseTitleStrength(world,houseId)+c.supportWeight*Math.floor(support/2000)
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
/** DEC-058の相手選好用。同じ信頼スコアの比較にのみ使い、契約案の同意とは分離する。 */
export function partnerHouseInterest(
  world:WorldState,person:Person,partner:Person,calibration:NextgenContractCalibration,
):number{
  const group=world.groups.find(g=>g.groupId===person.originGroupId)
  const support=group?.support.houseBps[partner.houseId]??0
  const dynasty=dynastyOf(partner,world)
  return calibration.supportWeight*Math.floor(support/2000)+
    calibration.titleWeight*(dynasty===null?0:titleStrength(world,dynasty))
}
export function chooseNextgenContract(
  world:WorldState,pair:readonly [Id,Id],trustScore:number,
  calibration:NextgenContractCalibration=EXPERIMENTAL_NEXTGEN_CONTRACT,
  candidates:readonly Person[]=[],
):ContractAgreement{
  if(validateNextgenContractCalibration(calibration).length>0||!int(trustScore)||Math.abs(trustScore)>1000)
    return {status:'DEFER',reasonCode:'CONTRACT_CALIBRATION_OR_SCORE_INVALID',choices:[]}
  const persons=marriageCandidatePersons(world,pair,candidates)
  if(!persons)return {status:'DEFER',reasonCode:'CANDIDATE_VIEW_INVALID',choices:[]}
  world={...world,persons}
  const ps=pair.map(id=>world.persons.find(p=>p.personId===id))
  if(ps.some(p=>!p))return {status:'DEFER',reasonCode:'CONTRACT_PARTY_MISSING',choices:[]}
  const people=ps as [Person,Person]
  if(people.some(p=>!world.groups.some(g=>g.groupId===p.originGroupId)))
    return {status:'DEFER',reasonCode:'CONTRACT_HOUSE_SUPPORT_UNVERIFIED',choices:[]}
  const dyn=people.map(p=>dynastyOf(p,world))
  const dynasties=[...new Set(dyn.filter((v):v is Id=>v!==null))].sort(cmp)
  const options:(Id|null)[]=[null,...dynasties]
  const legacy:ContractChoice[]=options.map(id=>{
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
      key:nextgenContractKey(id),
      dynastyId:id,firstConsentScore,secondConsentScore,
      mutuallyAccepted:firstConsentScore>=calibration.consentThreshold&&
        secondConsentScore>=calibration.consentThreshold,
      minimumUtility:Math.min(firstConsentScore,secondConsentScore),
    }
  })
  const houseCal=calibration.childHouse
  const father=people.find(p=>p.sex==='MALE'),mother=people.find(p=>p.sex==='FEMALE')
  let choices:ContractChoice[]=legacy
  if(houseCal!==undefined){
    if(!father||!mother||!world.houses.some(h=>h.houseId===father.houseId))
      return {status:'DEFER',reasonCode:'CHILD_HOUSE_PATERNAL_UNVERIFIED',choices:[]}
    const paternal:ContractChildHouse={basis:'PATERNAL_DEFAULT',houseId:father.houseId}
    const maternal:ContractChildHouse={basis:'MATERNAL_CONTRACT_CLAUSE',houseId:mother.houseId,sourcePersonId:mother.personId}
    // 母方案は当事者の実在家門で、父方と異なり同じ管轄の場合だけ。第三者家門の案は作らない。
    const maternalValid=childHouseClauseIssue(world,people,{clauseId:'candidate',
      houseId:maternal.houseId,sourcePersonId:mother.personId})===null
    const delta=people.map(p=>childHouseScore(world,p,maternal.houseId,houseCal)-
      childHouseScore(world,p,paternal.houseId,houseCal)-houseCal.exceptionCost)
    // 父方案・母方案とも、王朝案と家門選択の構造から正規キーを作る（旧キーとの連結で案を表さない）。
    choices=[
      ...legacy.map(c=>({...c,key:nextgenContractIdentityKey({dynastyId:c.dynastyId,childHouse:paternal}),childHouse:paternal})),
      ...(maternalValid?legacy.map(c=>{
        const firstConsentScore=c.firstConsentScore+delta[0]!,secondConsentScore=c.secondConsentScore+delta[1]!
        return {...c,key:nextgenContractIdentityKey({dynastyId:c.dynastyId,childHouse:maternal}),firstConsentScore,secondConsentScore,
          mutuallyAccepted:firstConsentScore>=calibration.consentThreshold&&secondConsentScore>=calibration.consentThreshold,
          minimumUtility:Math.min(firstConsentScore,secondConsentScore),childHouse:maternal}
      }):[]),
    ]
  }
  const l=calibration.lineageContinuity
  const evidence=l===undefined?{}:{continuityEvidence:{calibration:l,consentThreshold:calibration.consentThreshold,
    parties:[lineageContinuity(world,people[0]),lineageContinuity(world,people[1])] as const}}
  if(evidence.continuityEvidence){
    const {parties,consentThreshold,calibration:continuity}=evidence.continuityEvidence
    choices=choices.map(c=>{
      const assess=(basis:ContinuityBasis,baseUtility:number):ContinuityUtility=>{
        const houseShort=basis.house?.status==='RECORDED_SHORTFALL'
        const dynastyShort=basis.dynasty?.status==='RECORDED_SHORTFALL'
        const preservesShortfallHouse=houseShort&&c.childHouse?.houseId===basis.house?.ownId
        const preservesShortfallDynasty=dynastyShort&&c.dynastyId===basis.dynasty?.ownId
        const marriageBonus=houseShort||dynastyShort?continuity.marriageBonus:0
        const affiliationBonus=preservesShortfallHouse||preservesShortfallDynasty?continuity.affiliationBonus:0
        return {baseUtility,marriageBonus,preservesShortfallHouse,preservesShortfallDynasty,affiliationBonus,
          consents:baseUtility+marriageBonus+affiliationBonus>=consentThreshold}
      }
      const first=assess(parties[0],c.firstConsentScore),second=assess(parties[1],c.secondConsentScore)
      const total=(u:ContinuityUtility)=>u.baseUtility+u.marriageBonus+u.affiliationBonus
      const firstConsentScore=total(first),secondConsentScore=total(second)
      return {...c,firstConsentScore,secondConsentScore,continuityUtility:[first,second],
        mutuallyAccepted:first.consents&&second.consents,
        minimumUtility:Math.min(firstConsentScore,secondConsentScore)}
    })
  }
  const accepted=choices.filter(c=>c.mutuallyAccepted)
  if(accepted.length===0)return {status:'DEFER',reasonCode:'NO_BILATERAL_CONSENT',choices,...evidence}
  const top=Math.max(...accepted.map(c=>c.minimumUtility))
  const leaders=accepted.filter(c=>c.minimumUtility===top)
  if(leaders.length!==1)return {status:'DEFER',reasonCode:'CONTRACT_CHOICE_TIE',choices,...evidence}
  return {status:'ACCEPT',reasonCode:'BOTH_PARTIES_ACCEPT_UNIQUE_CONTRACT',choice:leaders[0]!,choices,...evidence}
}

/** B-005がその年に合意した選択肢をAが登録するための安定した証拠。
 * B-005 Trace とA-LEG-01の再評価が一致しなければ、証拠IDだけでは登録不可。
 * 旧構成は従来の契約。DEC-190構成は父方案・母方案とも、選んだ案の構造化同一性と双方合意
 * （当事者・年・Trace・双方の得点・閾値）を条項から独立した版付き選択記録として契約に保存する。
 */
export function negotiatedMarriageContract(
  year:number,pair:readonly [Id,Id],choice:ContractChoice,sourceTraceId:Id,consentThreshold?:number,
):MarriageContract{
  const identity=contractChoiceIdentity(choice)
  if(identity===null)return nextgenMarriageContract(year,pair,choice.key,choice.dynastyId,sourceTraceId)
  if(consentThreshold===undefined||!choice.mutuallyAccepted)throw new RangeError('CHILD_HOUSE_AGREEMENT_CONSENT_MISSING')
  if(choice.key!==nextgenContractIdentityKey(identity))throw new RangeError('NEXTGEN_CONTRACT_IDENTITY_KEY_MISMATCH')
  return nextgenSelectionContract({version:NEXTGEN_CONTRACT_SELECTION_VERSION,identity,
    agreement:{registeredYear:year,personIds:pair,sourceTraceId,
      firstConsentScore:choice.firstConsentScore,secondConsentScore:choice.secondConsentScore,consentThreshold}})
}
