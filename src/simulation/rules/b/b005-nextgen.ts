// DEC-058: B-004の当年実候補から相互に一意の相手を選び、契約案への双方同意を記録する。
// 技術スコアと家門利害の係数はCALIBRATION_ONLY。法的登録・出生・合法王朝所属はA/B別ルール。
import type { CrossDomainRequest, DecisionTrace, DecisionTraceDraft, Id, RuleOutcome, WorldState } from '../../contracts/index.ts'
import type { EvaluationContext, RuleEvaluator } from '../../engine/evaluators.ts'
import { EvaluationFailure } from '../../engine/evaluators.ts'
import { pairKey, normalizePersonPair } from '../../intervention/index.ts'
import {
  chooseNextgenContract, EXPERIMENTAL_NEXTGEN_CONTRACT, validateNextgenContractCalibration,
} from '../../legal/nextgen-contract.ts'
import type { NextgenContractCalibration } from '../../legal/nextgen-contract.ts'
import { reviewDomesticMarriageEligibility } from '../../legal/nextgen-marriage.ts'
import { reviewSupportingKinshipClearance,validateSupportingKinshipClearances }
  from '../../legal/supporting-kinship-clearance.ts'
import type { SupportingKinshipClearance } from '../../legal/supporting-kinship-clearance.ts'
import { B004_CALIBRATION_REASON } from './b004-candidate.ts'

export const B005_NEXTGEN_VERSION='b005-bilateral-family-contract-1:CALIBRATION_ONLY'
type Query=Extract<CrossDomainRequest,{kind:'LEGAL_MARRIAGE_QUERY'}>
type Candidate=Readonly<{trace:DecisionTrace;pair:readonly [Id,Id];score:number|null}>
const cmp=(a:string,b:string)=>a<b?-1:a>b?1:0
export function createB005NextgenEvaluator(
  calibration:NextgenContractCalibration=EXPERIMENTAL_NEXTGEN_CONTRACT,
  supportingKinshipClearances:readonly SupportingKinshipClearance[]=[],
):RuleEvaluator{
  const issues=[
    ...validateNextgenContractCalibration(calibration),
    ...validateSupportingKinshipClearances(supportingKinshipClearances),
  ]
  if(issues.length>0)throw new RangeError('B005_NEXTGEN_INVALID_CALIBRATION:'+issues.join(','))
  const stableClearances=structuredClone(supportingKinshipClearances) as SupportingKinshipClearance[]
  const evidence=(world:WorldState,pair:readonly [Id,Id])=>{
    const eligibility=reviewDomesticMarriageEligibility(world,pair)
    return eligibility.status==='ELIGIBLE'
      ?reviewSupportingKinshipClearance(world,pair,eligibility.countryId,world.year,stableClearances)
      :null
  }
  return (world:WorldState,ctx:EvaluationContext):RuleOutcome=>{
    if(ctx.ruleId!=='B-005'||ctx.phase!==3||ctx.year!==world.year)
      throw new EvaluationFailure('B-005次世代交渉の年/RuleID/Phase不一致',[
        {code:'RULE_MISMATCH',message:'B-005 Phase3'}])
    const seen=new Set<string>()
    const matches:Candidate[]=(ctx.priorTraces??[])
      .filter(t=>t.ruleId==='B-004'&&t.year===ctx.year)
      .map(trace=>{
        const pair=trace.actorRef.kind==='PERSON_PAIR'
          ?normalizePersonPair(trace.actorRef.ids[0],trace.actorRef.ids[1]):null
        if(!pair)throw new EvaluationFailure('B004の人物ペアが不正',[
          {code:'INVALID_B004_PAIR',message:trace.traceId}])
        const key=pairKey(pair)
        if(seen.has(key))throw new EvaluationFailure('B004の縁談候補が重複',[
          {code:'DUPLICATE_B004_PAIR',message:key}])
        seen.add(key)
        const score=trace.candidates[0]?.score
        return {trace,pair,score:typeof score==='number'&&Number.isSafeInteger(score)?score:null}
      })
      .sort((a,b)=>cmp(pairKey(a.pair),pairKey(b.pair)))
    // 当年の同一人物を複数案に同時成立させない。双方が「唯一の」最優先相手であること。
    const rankings=new Map<Id,Readonly<{score:number;keys:readonly string[]}>>()
    for(const c of matches){
      if(c.trace.status!=='ACCEPT'||!c.trace.reasonCodes.includes(B004_CALIBRATION_REASON)||c.score===null||
        reviewDomesticMarriageEligibility(world,c.pair).status!=='ELIGIBLE'||
        evidence(world,c.pair)?.status!=='CLEARED')continue
      for(const id of c.pair){
        const prev=rankings.get(id)
        if(!prev||c.score>prev.score)rankings.set(id,{score:c.score,keys:[pairKey(c.pair)]})
        else if(c.score===prev.score)rankings.set(id,{score:c.score,keys:[...prev.keys,pairKey(c.pair)]})
      }
    }
    const requests:Query[]=[]
    const traceDrafts:DecisionTraceDraft[]=[]
    for(const {trace,pair,score} of matches){
      const key=pairKey(pair)
      const eligibility=reviewDomesticMarriageEligibility(world,pair)
      const clearance=evidence(world,pair)
      const unique=score!==null&&pair.every(id=>{
        const r=rankings.get(id)
        return r!==undefined&&r.score===score&&r.keys.length===1&&r.keys[0]===key
      })
      const agreement=eligibility.status==='ELIGIBLE'&&clearance?.status==='CLEARED'&&unique&&score!==null
        ?chooseNextgenContract(world,pair,score,calibration):null
      const accepted=agreement?.status==='ACCEPT'
      let why:string
      if(trace.status!=='ACCEPT')why='B004_NOT_ACCEPTED'
      else if(score===null)why='B004_SCORE_MISSING'
      else if(eligibility.status!=='ELIGIBLE')why=eligibility.reasonCode
      else if(clearance?.status!=='CLEARED')why=clearance?.reasonCode??'SUPPORTING_KINSHIP_CLEARANCE_MISSING'
      else if(!unique)why='MUTUAL_UNIQUE_PARTNER_NOT_ESTABLISHED'
      else why=agreement?.reasonCode??'CONTRACT_AGREEMENT_UNVERIFIED'
      const index=traceDrafts.length
      const queryId='marriage-query:nextgen:'+JSON.stringify([ctx.year,key])
      const selectedId='b005:nextgen:'+JSON.stringify([ctx.year,key])
      traceDrafts.push({
        year:ctx.year,phase:ctx.phase,ruleId:ctx.ruleId,
        actorRef:{kind:'PERSON_PAIR',ids:pair},
        candidates:[{
          candidateId:selectedId,eligible:accepted,
          inputs:{
            sourceB004TraceId:trace.traceId,
            sourceB004Score:score,
            sourceRequestId:accepted?queryId:null,
            selectionEvidence:'RECORDED_B004_MUTUAL_UNIQUE_TOP',
            selectedContractKey:agreement?.status==='ACCEPT'?agreement.choice.key:null,
            supportingKinshipClearanceId:clearance?.status==='CLEARED'?clearance.clearanceId:null,
            ...(agreement?{contractOptions:agreement.choices.map(c=>({
              key:c.key,dynastyId:c.dynastyId,
              firstConsentScore:c.firstConsentScore,secondConsentScore:c.secondConsentScore,
              mutuallyAccepted:c.mutuallyAccepted,minimumUtility:c.minimumUtility,
            }))}:{}),
            provenance:'CALIBRATION_ONLY',
          },
          reasonCodes:['CALIBRATION_ONLY','DEC_058_CONTRACT_NEGOTIATION',why],
        }],
        ...(accepted?{selectedCandidateId:selectedId}:{}),
        status:accepted?'ACCEPT':'DEFER',
        reasonCodes:['CALIBRATION_ONLY','DEC_058_CONTRACT_NEGOTIATION',why],
        modifierIds:trace.modifierIds,
        ruleVersion:B005_NEXTGEN_VERSION,
      })
      if(!accepted)continue
      requests.push({
        kind:'LEGAL_MARRIAGE_QUERY',targetDomain:'A',requiredResponseYear:ctx.year,
        source:{requestId:queryId,year:ctx.year,phase:3,sourceRuleId:'B-005',
          sourceTraceId:ctx.traceId(index),sourceIntentId:trace.traceId},
        payload:{kind:'LEGAL_MARRIAGE_QUERY',personIds:pair},
      })
    }
    return {ruleId:ctx.ruleId,phase:ctx.phase,commands:[],requests,deferred:[],traceDrafts}
  }
}
