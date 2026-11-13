// DEC-057: 同一国家内の通常婚姻。B-005がその年に双方の意思を確認したときだけ法的照会を審査。
// 婚姻の成立年・結果を事前指定しない。法令＋個別の適格性/契約合意証拠が不足したらDEFER。
// 成年・近親の法規範は未承認なので、新しい年齢閾値や親族禁止範囲をここで追加しない。
import type {
  ControllerRef, CrossDomainResponse, DecisionTraceDraft, Id, MarriageRegisterCommand,
  RuleOutcome, WorldState, Year,
} from '../../contracts/index.ts'
import type { EvaluationContext, RuleEvaluator } from '../../engine/evaluators.ts'
import { EvaluationFailure } from '../../engine/evaluators.ts'
import { GENERATED_ID_DOMAINS, recordGeneratedIdSource, stableGeneratedId } from '../../engine/stable-generated-id.ts'
import type { LegalEvidenceBook } from '../../legal/evidence.ts'
import type { OrdinaryLaw } from '../../legal/ordinary-authority.ts'
import { reviewOrdinaryAuthority, validateOrdinaryLaws } from '../../legal/ordinary-authority.ts'

export const ORDINARY_MARRIAGE_VERSION = 'aleg01-domestic-authority-0:CALIBRATION_ONLY'
/** 正規化済みの personIds の意味的同一性から、世代数に依存しない婚姻IDを生成する。 */
export const ordinaryMarriageIdForPairYear=(year:Year,pair:readonly [Id,Id]):Id=>
  stableGeneratedId(GENERATED_ID_DOMAINS.ALEG01_MARRIAGE,[year,pair[0],pair[1]])
/** 当事者ペアについて法的適格性・合意した契約候補を確認した個別の審査記録。
 * 実際の婚姻の意思・成立はB-005当年照会が起こるまで生じない。
 * 候補なし（contractCandidateId:null）は明示的な無条項婚姻。子の王朝所属は未確定。
 */
export type OrdinaryMarriageReview = Readonly<{
  reviewId: Id
  personIds: readonly [Id,Id]
  countryId: Id
  lawId: Id
  reviewedBy: ControllerRef
  availableFromYear: Year
  endExclusiveYear: Year
  contractCandidateId: Id | null
  status: 'ELIGIBLE' | 'PENDING' | 'REJECTED'
  provenance: 'CALIBRATION_ONLY'
}>
export type OrdinaryMarriageInput = Readonly<{
  book: LegalEvidenceBook
  laws: readonly OrdinaryLaw[]
  reviews: readonly OrdinaryMarriageReview[]
}>
export type OrdinaryMarriageFactory =
  | Readonly<{ok:true;evaluator:RuleEvaluator}>
  | Readonly<{ok:false;issues:readonly string[]}>

const present=(x:unknown):x is string=>typeof x==='string'&&x.length>0
const matchingPair=(a:readonly [Id,Id],b:readonly [Id,Id])=>a[0]===b[0]&&a[1]===b[1]

export function createALeg01OrdinaryEvaluator(input:OrdinaryMarriageInput):OrdinaryMarriageFactory {
  if (!input || !input.book || !Array.isArray(input.reviews)) return {ok:false,issues:['INVALID_NORMAL_MARRIAGE_INPUT']}
  const errors=[...validateOrdinaryLaws(input.laws)]
  const ids=new Set<Id>()
  for(const [i,r] of input.reviews.entries()){
    if(!r||!present(r.reviewId)||!Array.isArray(r.personIds)||r.personIds.length!==2||
       !present(r.personIds[0])||!present(r.personIds[1])||r.personIds[0]>=r.personIds[1]||
       !present(r.countryId)||!present(r.lawId)||r.reviewedBy?.kind!=='COUNTRY'||
       r.reviewedBy.id!==r.countryId||!Number.isSafeInteger(r.availableFromYear)||
       !Number.isSafeInteger(r.endExclusiveYear)||r.availableFromYear>=r.endExclusiveYear||
       !['ELIGIBLE','PENDING','REJECTED'].includes(r.status)||
       r.provenance!=='CALIBRATION_ONLY'||(r.contractCandidateId!==null&&!present(r.contractCandidateId))){
      errors.push('INVALID_MARRIAGE_REVIEW:'+i)
    }
    if(ids.has(r?.reviewId))errors.push('DUPLICATE_MARRIAGE_REVIEW_ID:'+i)
    if(r?.reviewId)ids.add(r.reviewId)
  }
  if(errors.length>0)return {ok:false,issues:errors}
  const lawBook=structuredClone(input.book) as LegalEvidenceBook
  const laws=structuredClone(input.laws) as OrdinaryLaw[]
  const reviews=structuredClone(input.reviews) as OrdinaryMarriageReview[]
  const evaluator:RuleEvaluator=(world:WorldState,ctx:EvaluationContext):RuleOutcome=>{
    if(ctx.ruleId!=='A-LEG-01'||ctx.phase!==3||ctx.year!==world.year) {
      throw new EvaluationFailure('通常婚姻の年次境界が不一致',[{code:'RULE_MISMATCH',message:'A-LEG-01はPhase3'}])
    }
    const commands:MarriageRegisterCommand[]=[]
    const responses:CrossDomainResponse[]=[]
    const traceDrafts:DecisionTraceDraft[]=[]
    const seenGeneratedIds=new Map<Id,string>()
    const queries=ctx.marriageQueries??[]
    const simultaneous=new Map<Id,number>()
    // 同年に複数の交渉意思が同一人物へ集中する場合、ID順で配偶者を決定しない。
    for(const q of queries)for(const personId of q.payload.personIds)
      simultaneous.set(personId,(simultaneous.get(personId)??0)+1)
    const reserved=new Set<Id>()
    for(const q of queries){
      const pair=q.payload.personIds
      const [a,b]=pair.map(id=>world.persons.find(p=>p.personId===id))
      const hA=a&&world.houses.find(h=>h.houseId===a.houseId)
      const hB=b&&world.houses.find(h=>h.houseId===b.houseId)
      const countryId=hA?.countryId&&hA.countryId===hB?.countryId?hA.countryId:null
      const issuer:ControllerRef= {kind:'COUNTRY',id:countryId??''}
      const authority=countryId?reviewOrdinaryAuthority(world,lawBook,laws,{
        action:'NORMAL_MARRIAGE',sovereignCountryId:countryId,issuerRef:issuer,year:ctx.year,
      }):null
      const candidateReviews=reviews.filter(r=>matchingPair(r.personIds,pair)&&
        r.availableFromYear<=ctx.year&&ctx.year<r.endExclusiveYear)
      const rev=candidateReviews.length===1?candidateReviews[0]:undefined
      const proposed=rev?.contractCandidateId
      const candidateEntries=proposed===undefined||proposed===null?[]:
        lawBook.marriageCandidates.filter(c=>c.candidateId===proposed&&matchingPair(c.personIds,pair))
      const candidate=candidateEntries.length===1?candidateEntries[0]:undefined
      // 候補が他にも存在しても、両当事者の明示された選択IDが唯一なら恣意的に選ばない。
      const contract=proposed===null?undefined:candidate?.contract
      const kinship=!!(a&&b&&(a.fatherId===b.personId||a.motherId===b.personId||
        b.fatherId===a.personId||b.motherId===a.personId||
        (a.fatherId!==undefined&&a.fatherId===b.fatherId)||
        (a.motherId!==undefined&&a.motherId===b.motherId)))
      const occupied=world.legal.marriages.some(m=>m.status==='ACTIVE'&&m.personIds.some(id=>pair.includes(id)))||
        pair.some(id=>reserved.has(id))
      let status:'ACCEPT'|'REJECT'|'DEFER'='DEFER'
      let why: string
      if(!a||!b||!a.alive||!b.alive)why='PERSON_UNAVAILABLE'
      else if(pair.some(id=>(simultaneous.get(id)??0)>1))why='SAME_YEAR_COMPETING_PROPOSALS'
      else if(kinship)why='KNOWN_CLOSE_KINSHIP'
      else if(occupied)why='ACTIVE_MARRIAGE_EXISTS'
      else if(!countryId)why='SAME_COUNTRY_JURISDICTION_UNVERIFIED'
      else if(authority?.status!=='AUTHORIZED')why=authority?.reasonCodes[0]??'ORDINARY_LAW_MISSING'
      else if(candidateReviews.length!==1)why=candidateReviews.length===0?'ELIGIBILITY_REVIEW_MISSING':'ELIGIBILITY_REVIEW_AMBIGUOUS'
      else if(rev?.status==='REJECTED'){status='REJECT';why='ELIGIBILITY_REVIEW_REJECTED'}
      else if(rev?.status!=='ELIGIBLE')why='ELIGIBILITY_REVIEW_PENDING'
      else if(rev.countryId!==countryId||rev.lawId!==authority.lawId||
        rev.reviewedBy.kind!=='COUNTRY'||rev.reviewedBy.id!==countryId)why='ELIGIBILITY_AUTHORITY_MISMATCH'
      else if(proposed!==null&&(!candidate||!contract||candidate.registration!=='NOT_REGISTERED'))why='CONTRACT_AGREEMENT_NOT_FOUND'
      else if(contract&&(contract.clauses.some(c=>!present(c.clauseId)||
        !world.legal.dynasties.some(d=>d.dynastyId===c.dynastyId))||
        !present(contract.contractId)||!present(contract.evidenceId)))why='CONTRACT_INVALID'
      else {status='ACCEPT';why='DOMESTIC_MARRIAGE_AUTHORITY_AND_CONSENT_VERIFIED'}
      const index=traceDrafts.length
      const sourceTuple=[ctx.year,pair[0],pair[1]] as const
      const candidateId=stableGeneratedId(GENERATED_ID_DOMAINS.ALEG01_CANDIDATE,sourceTuple)
      recordGeneratedIdSource(seenGeneratedIds,candidateId,sourceTuple)
      traceDrafts.push({
        year:ctx.year,phase:ctx.phase,ruleId:ctx.ruleId,
        actorRef:{kind:'PERSON_PAIR',ids:pair},
        candidates:[{candidateId,eligible:status==='ACCEPT',inputs:{
          sourceRequestId:q.source.requestId,reviewId:rev?.reviewId??null,
          lawId:authority?.status==='AUTHORIZED'?authority.lawId:null,
          contractId:contract?.contractId??null,provenance:'CALIBRATION_ONLY',
        },reasonCodes:['CALIBRATION_ONLY',why]}],
        ...(status==='ACCEPT'?{selectedCandidateId:candidateId}:{}),
        status,reasonCodes:['CALIBRATION_ONLY','DEC_057_NORMAL_MARRIAGE',why],
        modifierIds:[],ruleVersion:ORDINARY_MARRIAGE_VERSION,
      })
      responses.push({requestId:q.source.requestId,status,reasonCodes:['CALIBRATION_ONLY',why]})
      if(status!=='ACCEPT')continue
      reserved.add(pair[0]);reserved.add(pair[1])
      const commandId=stableGeneratedId(GENERATED_ID_DOMAINS.ALEG01_COMMAND,sourceTuple)
      const marriageId=ordinaryMarriageIdForPairYear(ctx.year,pair)
      recordGeneratedIdSource(seenGeneratedIds,commandId,sourceTuple)
      recordGeneratedIdSource(seenGeneratedIds,marriageId,sourceTuple)
      commands.push({
        type:'MARRIAGE_REGISTER',
        commandId,
        source:{requestId:q.source.requestId,year:ctx.year,phase:ctx.phase,
          sourceRuleId:'A-LEG-01',sourceTraceId:ctx.traceId(index),
          sourceIntentId:q.source.sourceTraceId},
        marriage:{marriageId,personIds:pair,
          registeredYear:ctx.year,status:'ACTIVE',...(contract?{contract}:{} )},
      })
    }
    return {ruleId:ctx.ruleId,phase:ctx.phase,commands,requests:[],responses,deferred:[],traceDrafts}
  }
  return {ok:true,evaluator}
}
