// DEC-058: B-005双方合意の当年Traceを再検証し、DEC-057の法制権限を通してのみ婚姻を登録。
// 出生児の王朝所属はここで指定しない（A-DYN-02が唯一の明示契約条項から後年確定する）。
import type { Id, WorldState, Year } from '../../contracts/index.ts'
import type { EvaluationContext, RuleEvaluator } from '../../engine/evaluators.ts'
import { EvaluationFailure } from '../../engine/evaluators.ts'
import type { LegalEvidenceBook } from '../../legal/evidence.ts'
import type { OrdinaryLaw } from '../../legal/ordinary-authority.ts'
import { reviewOrdinaryAuthority } from '../../legal/ordinary-authority.ts'
import { chooseNextgenContract, negotiatedMarriageContract,
  EXPERIMENTAL_NEXTGEN_CONTRACT, validateNextgenContractCalibration } from '../../legal/nextgen-contract.ts'
import type { NextgenContractCalibration } from '../../legal/nextgen-contract.ts'
import { reviewDomesticMarriageEligibility } from '../../legal/nextgen-marriage.ts'
import { pairKey } from '../../intervention/index.ts'
import { createALeg01OrdinaryEvaluator } from './aleg01-ordinary.ts'
import type { OrdinaryMarriageReview } from './aleg01-ordinary.ts'

/** 集団ラベルとは独立した、当事者ごとの試験用禁親確認証拠。人数やcohort IDだけでは生成しない。 */
export type SupportingKinshipClearance=Readonly<{
  clearanceId:Id
  personIds:readonly [Id,Id]
  countryId:Id
  checkedYear:Year
  validUntilYear:Year
  sourceEvidenceId:Id
  provenance:'CALIBRATION_ONLY'
}>
export type NextgenMarriageInput=Readonly<{
  book:LegalEvidenceBook
  laws:readonly OrdinaryLaw[]
  calibration?:NextgenContractCalibration
  /** SUPPORTINGと婚姻する場合だけ別個に必要な血縁照合証拠。省略は保留。 */
  supportingKinshipClearances?:readonly SupportingKinshipClearance[]
}>
export type NextgenMarriageFactory=
  | Readonly<{ok:true;evaluator:RuleEvaluator}>
  | Readonly<{ok:false;issues:readonly string[]}>

export function createALeg01NextgenEvaluator(input:NextgenMarriageInput):NextgenMarriageFactory{
  const cal=input.calibration??EXPERIMENTAL_NEXTGEN_CONTRACT
  const issues=[...validateNextgenContractCalibration(cal)]
  const base=createALeg01OrdinaryEvaluator({book:input.book,laws:input.laws,reviews:[]})
  if(!base.ok)issues.push(...base.issues)
  const clearances=input.supportingKinshipClearances??[]
  if(!Array.isArray(clearances))issues.push('SUPPORTING_CLEARANCE_LIST_INVALID')
  else {
    const ids=new Set<Id>()
    for(const [i,c] of clearances.entries()){
      if(!c||!c.clearanceId||!c.sourceEvidenceId||
        !Array.isArray(c.personIds)||c.personIds.length!==2||
        !c.personIds[0]||!c.personIds[1]||c.personIds[0]>=c.personIds[1]||
        !c.countryId||!Number.isSafeInteger(c.checkedYear)||
        !Number.isSafeInteger(c.validUntilYear)||c.validUntilYear<=c.checkedYear||
        c.provenance!=='CALIBRATION_ONLY'||ids.has(c.clearanceId)){
        issues.push('SUPPORTING_CLEARANCE_INVALID:'+i)
      }
      if(c?.clearanceId)ids.add(c.clearanceId)
    }
  }
  if(issues.length>0)return {ok:false,issues}
  const stableClearances=structuredClone(clearances) as SupportingKinshipClearance[]
  const book=structuredClone(input.book) as LegalEvidenceBook
  const laws=structuredClone(input.laws) as OrdinaryLaw[]
  const evaluator:RuleEvaluator=(world:WorldState,ctx:EvaluationContext)=>{
    if(ctx.ruleId!=='A-LEG-01'||ctx.phase!==3||ctx.year!==world.year)
      throw new EvaluationFailure('A-LEG-01次世代婚姻の年/RuleID/Phase不一致',[
        {code:'RULE_MISMATCH',message:'A-LEG-01 Phase3'}])
    const reviews:OrdinaryMarriageReview[]=[]
    const candidates=[...book.marriageCandidates]
    for(const query of ctx.marriageQueries??[]){
      const pair=query.payload.personIds
      const key=pairKey(pair)
      const eligibility=reviewDomesticMarriageEligibility(world,pair)
      if(eligibility.status!=='ELIGIBLE')continue
      // 登録済み血縁の禁忌に加え、補助人物には人口/家門ラベルとは独立した禁親確認記録が必要。
      if(pair.some(id=>world.persons.find(p=>p.personId===id)?.interactionRole==='SUPPORTING')){
        const matching=stableClearances.filter(c=>
          c.personIds[0]===pair[0]&&c.personIds[1]===pair[1]&&
          c.countryId===eligibility.countryId&&
          c.checkedYear<=ctx.year&&ctx.year<c.validUntilYear)
        if(matching.length!==1)continue
      }
      const b5=(ctx.priorTraces??[]).filter(t=>t.traceId===query.source.sourceTraceId&&
        t.ruleId==='B-005'&&t.year===ctx.year&&t.status==='ACCEPT'&&
        t.reasonCodes.includes('DEC_058_CONTRACT_NEGOTIATION')&&
        t.actorRef.kind==='PERSON_PAIR'&&pairKey(t.actorRef.ids)===key)
      if(b5.length!==1)continue
      const verified=b5[0]!
      const priorId=verified.candidates[0]?.inputs.sourceB004TraceId
      const b4=(ctx.priorTraces??[]).filter(t=>t.traceId===priorId&&t.ruleId==='B-004'&&
        t.status==='ACCEPT'&&t.year===ctx.year&&t.actorRef.kind==='PERSON_PAIR'&&
        pairKey(t.actorRef.ids)===key)
      const score=b4.length===1?b4[0]!.candidates[0]?.score:undefined
      if(typeof score!=='number'||!Number.isSafeInteger(score))continue
      const agreement=chooseNextgenContract(world,pair,score,cal)
      if(agreement.status!=='ACCEPT'||verified.candidates[0]?.inputs.selectedContractKey!==agreement.choice.key)
        continue
      const law=reviewOrdinaryAuthority(world,book,laws,{
        action:'NORMAL_MARRIAGE',sovereignCountryId:eligibility.countryId,
        issuerRef:{kind:'COUNTRY',id:eligibility.countryId},year:ctx.year,
      })
      if(law.status!=='AUTHORIZED')continue
      const candidateId='candidate:nextgen:'+JSON.stringify([ctx.year,pair,agreement.choice.key])
      const contract=negotiatedMarriageContract(ctx.year,pair,agreement.choice,verified.traceId)
      // 候補は当年の同意Traceから生成したものだけ。過去・他婚姻の契約を流用しない。
      candidates.push({
        candidateId,personIds:pair,contract,
        registration:'NOT_REGISTERED',provenance:'CALIBRATION_ONLY',
      })
      reviews.push({
        reviewId:'review:nextgen:'+JSON.stringify([ctx.year,pair,verified.traceId]),
        personIds:pair,countryId:eligibility.countryId,lawId:law.lawId,
        reviewedBy:{kind:'COUNTRY',id:eligibility.countryId},
        availableFromYear:ctx.year,endExclusiveYear:ctx.year+1,
        contractCandidateId:candidateId,status:'ELIGIBLE',provenance:'CALIBRATION_ONLY',
      })
    }
    const normal=createALeg01OrdinaryEvaluator({
      book:{...book,marriageCandidates:candidates},
      laws,reviews,
    })
    if(!normal.ok)throw new EvaluationFailure('当年の婚姻法的審査の入力が不正',
      normal.issues.map(e=>({code:'INVALID_NEXTGEN_LEGAL_REVIEW',message:e})))
    return normal.evaluator(world,ctx)
  }
  return {ok:true,evaluator}
}
