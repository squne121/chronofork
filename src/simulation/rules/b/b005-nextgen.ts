// DEC-058: B-004の当年実候補から相互に一意の相手を選び、契約案への双方同意を記録する。
// 技術スコアと家門利害の係数はCALIBRATION_ONLY。法的登録・出生・合法王朝所属はA/B別ルール。
import type { CrossDomainRequest, DecisionTrace, DecisionTraceDraft, Id, RuleOutcome, WorldState } from '../../contracts/index.ts'
import type { EvaluationContext, RuleEvaluator } from '../../engine/evaluators.ts'
import { EvaluationFailure } from '../../engine/evaluators.ts'
import { pairKey, normalizePersonPair } from '../../intervention/index.ts'
import {
  chooseNextgenContract, contractChoiceIdentity, partnerHouseInterest, EXPERIMENTAL_NEXTGEN_CONTRACT, validateNextgenContractCalibration,
} from '../../legal/nextgen-contract.ts'
import type { NextgenContractCalibration } from '../../legal/nextgen-contract.ts'
import { reviewDomesticMarriageEligibility } from '../../legal/nextgen-marriage.ts'
import { reviewSupportingKinshipClearance,supportingClearanceKey,validateSupportingKinshipClearances }
  from '../../legal/supporting-kinship-clearance.ts'
import type { SupportingKinshipClearance } from '../../legal/supporting-kinship-clearance.ts'
import { supportingAnnualMarriageEvidence, supportingPopulationEvidenceIds, inspectSupportingCandidateSupply, supportingRankingBlock } from '../../autonomy/supporting-candidate-view.ts'
import type { SupportingCandidateResolver } from '../../autonomy/supporting-candidate-view.ts'
import { B004_CALIBRATION_REASON } from './b004-candidate.ts'

export const B005_NEXTGEN_VERSION='b005-bilateral-family-contract-3:CALIBRATION_ONLY'
/** DEC-190の家門条項案を含む契約交渉。家門係数を持つ校正でのみ使う。版5: 契約案を構造化同一性の正規キーで記録し、選択案の同一性を別に保存。 */
export const B005_CHILD_HOUSE_VERSION='b005-bilateral-family-contract-5-dec190-contract-identity:CALIBRATION_ONLY'
type Query=Extract<CrossDomainRequest,{kind:'LEGAL_MARRIAGE_QUERY'}>
type Candidate=Readonly<{trace:DecisionTrace;pair:readonly [Id,Id];score:number|null}>
const cmp=(a:string,b:string)=>a<b?-1:a>b?1:0
const supportingEvidence = new WeakMap<RuleEvaluator, Readonly<{resolve: SupportingCandidateResolver | undefined; clearanceKey: (ctx:EvaluationContext,pairs:ReadonlyMap<string,string>)=>string}>>()
export const b005SupportingEvidence = (evaluator: RuleEvaluator | undefined) =>
  evaluator && supportingEvidence.get(evaluator)
export function createB005NextgenEvaluator(
  calibration:NextgenContractCalibration=EXPERIMENTAL_NEXTGEN_CONTRACT,
  supportingKinshipClearances:readonly SupportingKinshipClearance[]=[],
  resolveSupporting?:SupportingCandidateResolver,
):RuleEvaluator{
  const issues=[
    ...validateNextgenContractCalibration(calibration),
    ...validateSupportingKinshipClearances(supportingKinshipClearances),
  ]
  if(issues.length>0)throw new RangeError('B005_NEXTGEN_INVALID_CALIBRATION:'+issues.join(','))
  const stableClearances=structuredClone(supportingKinshipClearances) as SupportingKinshipClearance[]
  const clearancesFor=(ctx:EvaluationContext)=>supportingAnnualMarriageEvidence(resolveSupporting,ctx)?.clearances??stableClearances
  const fixedCalibration = structuredClone(calibration)
  const evaluator: RuleEvaluator = (world:WorldState,ctx:EvaluationContext):RuleOutcome=>{
    if(ctx.ruleId!=='B-005'||ctx.phase!==3||ctx.year!==world.year)
      throw new EvaluationFailure('B-005次世代交渉の年/RuleID/Phase不一致',[
        {code:'RULE_MISMATCH',message:'B-005 Phase3'}])
    const yearClearances=clearancesFor(ctx)
    const populationEvidenceIds=supportingPopulationEvidenceIds(resolveSupporting,ctx)
    const supply=inspectSupportingCandidateSupply(resolveSupporting,world,ctx)
    const {candidates:supplied}=supply
    const candidatesFor=(pair:readonly [Id,Id])=>supplied.filter(c=>
      pair.includes(c.person.personId)&&pair.includes(c.seekerId))
    const personsFor=(pair:readonly [Id,Id])=>candidatesFor(pair).map(c=>c.person)
    const evidence=(pair:readonly [Id,Id])=>{
      const candidates=candidatesFor(pair)
      const candidatePersons=candidates.map(c=>c.person)
      const eligibility=reviewDomesticMarriageEligibility(world,pair,candidatePersons)
      return eligibility.status==='ELIGIBLE'
        ?reviewSupportingKinshipClearance(world,pair,eligibility.countryId,world.year,yearClearances,candidatePersons,populationEvidenceIds)
        :null
    }
    const seen=new Set<string>()
    const matches:Candidate[]=(ctx.priorTraces??[])
      .filter(t=>t.ruleId==='B-004'&&t.year===ctx.year&&t.phase===3)
      .map(trace=>{
        const pair=trace.actorRef.kind==='PERSON_PAIR'
          ?normalizePersonPair(trace.actorRef.ids[0],trace.actorRef.ids[1]):null
        if(!pair)throw new EvaluationFailure('B004の人物ペアが不正',[
          {code:'INVALID_B004_PAIR',message:trace.traceId}])
        const key=pairKey(pair)
        if(seen.has(key))throw new EvaluationFailure('B004の縁談候補が重複',[
          {code:'DUPLICATE_B004_PAIR',message:key}])
        seen.add(key)
        // ACCEPTは、実際に選択された唯一の有効候補のスコアだけを使う。
        // 不完全なTraceの先頭値を信頼して交渉を成立させない。
        const candidate=trace.candidates.length===1?trace.candidates[0]:undefined
        const score=candidate?.score
        const validSelection=trace.status!=='ACCEPT'||
          (candidate?.eligible===true&&trace.selectedCandidateId===candidate.candidateId)
        return {trace,pair,score:validSelection&&typeof score==='number'&&Number.isSafeInteger(score)?score:null}
      })
      .sort((a,b)=>cmp(pairKey(a.pair),pairKey(b.pair)))
    // 全ペアで同じ比較を行う。家門支持・継承利害は信頼スコアが等しいときだけ使い、IDで同順位を解消しない。
    const eligible=matches.filter(c=>c.trace.status==='ACCEPT'&&c.trace.reasonCodes.includes(B004_CALIBRATION_REASON)&&
      c.score!==null&&evidence(c.pair)?.status==='CLEARED')
    const people=new Map([...world.persons,...supplied.map(c=>c.person)].map(p=>[p.personId,p]))
    const interests=(pair:readonly [Id,Id])=>pair.map((id,i)=>
      partnerHouseInterest(world,people.get(id)!,people.get(pair[1-i]!)!,fixedCalibration))
    const rankings=new Map<Id,Readonly<{score:number;interest:number;keys:readonly string[]}>>()
    for(const c of eligible){
      const score=c.score!
      for(const [i,interest] of interests(c.pair).entries()){
        const id=c.pair[i]!,prev=rankings.get(id)
        if(!prev||score>prev.score||(score===prev.score&&interest>prev.interest))
          rankings.set(id,{score,interest,keys:[pairKey(c.pair)]})
        else if(score===prev.score&&interest===prev.interest)
          rankings.set(id,{score,interest,keys:[...prev.keys,pairKey(c.pair)]})
      }
    }
    const requests:Query[]=[]
    const traceDrafts:DecisionTraceDraft[]=[]
    for(const {trace,pair,score} of matches){
      const key=pairKey(pair)
      const candidatePersons=personsFor(pair)
      const eligibility=reviewDomesticMarriageEligibility(world,pair,candidatePersons)
      const clearance=evidence(pair)
      const rankInterests=clearance?.status==='CLEARED'?interests(pair):[]
      const rankingBlock=supportingRankingBlock(supply,pair)
      const unique=rankingBlock===null&&score!==null&&pair.every(id=>{
        const r=rankings.get(id)
        return r!==undefined&&r.score===score&&r.keys.length===1&&r.keys[0]===key
      })
      const agreement=eligibility.status==='ELIGIBLE'&&clearance?.status==='CLEARED'&&unique&&score!==null
        ?chooseNextgenContract(world,pair,score,fixedCalibration,candidatePersons):null
      const accepted=agreement?.status==='ACCEPT'
      let why:string
      if(trace.status!=='ACCEPT')why='B004_NOT_ACCEPTED'
      else if(score===null)why='B004_SCORE_MISSING'
      else if(eligibility.status!=='ELIGIBLE')why=eligibility.reasonCode
      else if(clearance?.status!=='CLEARED')why=clearance?.reasonCode??'SUPPORTING_KINSHIP_CLEARANCE_MISSING'
      else if(rankingBlock)why=rankingBlock
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
            partnerHouseInterests:rankInterests,
            selectedContractKey:agreement?.status==='ACCEPT'?agreement.choice.key:null,
            ...(fixedCalibration.childHouse?{selectedChildHouse:agreement?.status==='ACCEPT'
              ?agreement.choice.childHouse??null:null,
            selectedContractIdentity:agreement?.status==='ACCEPT'?contractChoiceIdentity(agreement.choice):null}:{}),
            supportingKinshipClearanceId:clearance?.status==='CLEARED'?clearance.clearanceId:null,
            ...(clearance?.status==='CLEARED'&&clearance.clearanceId!==null
              ?{supportingKinshipClearanceRecordKey:clearance.clearanceRecordKey}:{}),
            ...(agreement?{contractOptions:agreement.choices.map(c=>({
              key:c.key,dynastyId:c.dynastyId,
              firstConsentScore:c.firstConsentScore,secondConsentScore:c.secondConsentScore,
              mutuallyAccepted:c.mutuallyAccepted,minimumUtility:c.minimumUtility,
              ...(c.childHouse?{childHouse:c.childHouse}:{}),
            }))}:{}),
            provenance:'CALIBRATION_ONLY',
          },
          reasonCodes:['CALIBRATION_ONLY','DEC_058_CONTRACT_NEGOTIATION',why],
        }],
        ...(accepted?{selectedCandidateId:selectedId}:{}),
        status:accepted?'ACCEPT':'DEFER',
        reasonCodes:['CALIBRATION_ONLY','DEC_058_CONTRACT_NEGOTIATION',why],
        modifierIds:trace.modifierIds,
        ruleVersion:fixedCalibration.childHouse?B005_CHILD_HOUSE_VERSION:B005_NEXTGEN_VERSION,
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
  supportingEvidence.set(evaluator, Object.freeze({
    resolve: resolveSupporting, clearanceKey: (ctx:EvaluationContext,pairs:ReadonlyMap<string,string>)=>supportingClearanceKey(clearancesFor(ctx),ctx.year,pairs),
  }))
  return evaluator
}
