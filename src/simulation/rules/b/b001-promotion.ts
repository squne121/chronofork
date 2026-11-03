// DEC-024/058: B-001では既存人口集団内の「実名が確認された未記名者」だけを昇格する。
// PopulationGroup.populationに年齢構成・親子関係は無い。コホート台帳＋身元台帳を明示で要求。
// どちらかが無い場合、人口数や支持率から年齢・性別・家系・法的王朝を生成しない。
import type { DecisionTraceDraft, Id, Person, PersonPromotionCommand, RuleOutcome, WorldState, Year } from '../../contracts/index.ts'
import type { EvaluationContext, RuleEvaluator } from '../../engine/evaluators.ts'
import { EvaluationFailure } from '../../engine/evaluators.ts'

export const B001_PROMOTION_VERSION='b001-attested-population-member-1:CALIBRATION_ONLY'
export type PopulationCohortAttestation=Readonly<{
  cohortId:Id
  groupId:Id
  birthYear:Year
  memberCount:number
  censusEvidenceId:Id
  recordedYear:Year
  provenance:'CALIBRATION_ONLY'
}>
export type PopulationIdentityAttestation=Readonly<{
  identityEvidenceId:Id
  cohortId:Id
  memberOrdinal:number
  personId:Id
  personName:string
  sex:'MALE'|'FEMALE'
  houseId:Id
  recordedYear:Year
  provenance:'CALIBRATION_ONLY'
}>
export type B001PromotionInput=Readonly<{
  cohorts:readonly PopulationCohortAttestation[]
  identities:readonly PopulationIdentityAttestation[]
  minimumAge?:number
  minimumHouseSupportBps?:number
  maxPromotionsPerYear?:number
}>
export type B001PromotionResult=
  | Readonly<{ok:true;evaluator:RuleEvaluator}>
  | Readonly<{ok:false;issues:readonly string[]}>
const cmp=(a:string,b:string)=>a<b?-1:a>b?1:0
const present=(x:unknown):x is string=>typeof x==='string'&&x.length>0
const integer=(x:unknown):x is number=>typeof x==='number'&&Number.isSafeInteger(x)

/** 入力の出典が検証不能なら評価器を作らない。sourceがない世界は何も昇格させない。 */
export function createB001PromotionEvaluator(input:B001PromotionInput):B001PromotionResult{
  if(!input||!Array.isArray(input.cohorts)||!Array.isArray(input.identities))
    return {ok:false,issues:['B001_ATTESTATION_INPUT_INVALID']}
  const issues:string[]=[]
  const minAge=input.minimumAge??18,minimumHouseSupportBps=input.minimumHouseSupportBps??0
  const maxPromotionsPerYear=input.maxPromotionsPerYear??4
  if(!integer(minAge)||minAge<18||minAge>100||
    !integer(minimumHouseSupportBps)||minimumHouseSupportBps<0||minimumHouseSupportBps>10000||
    !integer(maxPromotionsPerYear)||maxPromotionsPerYear<1||maxPromotionsPerYear>100)
    issues.push('B001_CALIBRATION_INVALID')
  const cohorts=new Map<Id,PopulationCohortAttestation>()
  for(const [i,c] of input.cohorts.entries()){
    if(!c||!present(c.cohortId)||!present(c.groupId)||!integer(c.birthYear)||
      !integer(c.memberCount)||c.memberCount<1||!present(c.censusEvidenceId)||
      !integer(c.recordedYear)||c.recordedYear<c.birthYear||
      c.provenance!=='CALIBRATION_ONLY')issues.push('B001_COHORT_RECORD_INVALID:'+i)
    if(c?.cohortId){
      if(cohorts.has(c.cohortId))issues.push('B001_COHORT_DUPLICATE:'+c.cohortId)
      cohorts.set(c.cohortId,c)
    }
  }
  const identityIds=new Set<Id>(),personIds=new Set<Id>(),ordinalIds=new Set<string>()
  for(const [i,p] of input.identities.entries()){
    if(!p||!present(p.identityEvidenceId)||!present(p.cohortId)||
      !integer(p.memberOrdinal)||p.memberOrdinal<0||!present(p.personId)||
      !present(p.personName)||!['MALE','FEMALE'].includes(p.sex)||
      !present(p.houseId)||!integer(p.recordedYear)||p.provenance!=='CALIBRATION_ONLY')
      issues.push('B001_IDENTITY_RECORD_INVALID:'+i)
    const c=cohorts.get(p?.cohortId)
    if(!c||p.memberOrdinal>=c.memberCount||p.recordedYear<c.birthYear)
      issues.push('B001_COHORT_MEMBER_NOT_ATTESTED:'+i)
    if(identityIds.has(p.identityEvidenceId)||personIds.has(p.personId))
      issues.push('B001_PERSON_EVIDENCE_DUPLICATE:'+i)
    identityIds.add(p.identityEvidenceId);personIds.add(p.personId)
    const slot=JSON.stringify([p.cohortId,p.memberOrdinal])
    if(ordinalIds.has(slot))issues.push('B001_COHORT_MEMBER_DUPLICATE:'+i)
    ordinalIds.add(slot)
  }
  if(issues.length>0)return {ok:false,issues}
  const stableCohorts=structuredClone(input.cohorts) as PopulationCohortAttestation[]
  const stableIdentities=structuredClone(input.identities) as PopulationIdentityAttestation[]
  const byCohort=new Map(stableCohorts.map(c=>[c.cohortId,c]))
  const byPerson=stableIdentities.slice().sort((a,b)=>cmp(a.personId,b.personId))
  const evaluator:RuleEvaluator=(world:WorldState,ctx:EvaluationContext):RuleOutcome=>{
    if(ctx.ruleId!=='B-001'||ctx.phase!==3||ctx.year!==world.year)
      throw new EvaluationFailure('B-001人物昇格は当年phase3だけ',[
        {code:'RULE_MISMATCH',message:'B-001 Phase3'}])
    const commands:PersonPromotionCommand[]=[]
    const traceDrafts:DecisionTraceDraft[]=[]
    const proposals=byPerson.filter(p=>!world.persons.some(x=>x.personId===p.personId))
    const ready=proposals.filter(p=>{
      const c=byCohort.get(p.cohortId)!
      return c.recordedYear<=ctx.year&&p.recordedYear<=ctx.year&&
        ctx.year-c.birthYear>=minAge
    })
    const groupTotals=new Map<Id,number>()
    for(const p of ready){const c=byCohort.get(p.cohortId)!;groupTotals.set(c.groupId,(groupTotals.get(c.groupId)??0)+1)}
    for(const p of proposals){
      const cohort=byCohort.get(p.cohortId)!
      const group=world.groups.find(g=>g.groupId===cohort.groupId)
      const house=world.houses.find(h=>h.houseId===p.houseId)
      const region=group&&world.regions.find(r=>r.regionId===group.regionId)
      const existingPeople=group?world.persons.filter(x=>x.alive&&x.originGroupId===group.groupId).length:0
      const support=group?.support.houseBps[p.houseId]
      let reason:string
      if(!group||!house||!region||!house.countryId||house.countryId!==region.sovereignCountryId||
        support===undefined)reason='EXISTING_GROUP_HOUSE_JURISDICTION_UNVERIFIED'
      else if(cohort.memberCount>group.population||existingPeople>=group.population||
        existingPeople+(groupTotals.get(cohort.groupId)??0)>group.population)
        reason='GROUP_UNNAMED_POPULATION_CAPACITY_UNVERIFIED'
      else if(cohort.recordedYear>ctx.year||p.recordedYear>ctx.year)
        reason='EVIDENCE_NOT_YET_AVAILABLE'
      else if(ctx.year-cohort.birthYear<minAge)reason='DOCUMENTED_COHORT_TOO_YOUNG'
      else if((support??0)<minimumHouseSupportBps)reason='HOUSE_SUPPORT_BELOW_CALIBRATION'
      else if(ready.length>maxPromotionsPerYear)reason='PROMOTION_CAPACITY_AMBIGUOUS'
      else reason='ATTESTED_POPULATION_MEMBER_ELIGIBLE'
      const accepted=reason==='ATTESTED_POPULATION_MEMBER_ELIGIBLE'
      const draftIndex=traceDrafts.length
      const key=JSON.stringify([ctx.year,p.cohortId,p.memberOrdinal,p.identityEvidenceId])
      traceDrafts.push({
        year:ctx.year,phase:ctx.phase,ruleId:ctx.ruleId,
        actorRef:{kind:'GROUP',id:cohort.groupId},
        candidates:[{
          candidateId:'b001:'+key,eligible:accepted,
          inputs:{groupId:cohort.groupId,houseId:p.houseId,cohortId:cohort.cohortId,
            censusEvidenceId:cohort.censusEvidenceId,identityEvidenceId:p.identityEvidenceId,
            personId:p.personId,birthYear:cohort.birthYear,memberCount:cohort.memberCount,
            memberOrdinal:p.memberOrdinal,recordedYear:Math.max(p.recordedYear,cohort.recordedYear),
            groupPopulation:group?.population??null,provenance:'CALIBRATION_ONLY'},
          reasonCodes:['CALIBRATION_ONLY',reason],
        }],
        ...(accepted?{selectedCandidateId:'b001:'+key}:{}),
        status:accepted?'ACCEPT':'DEFER',reasonCodes:['CALIBRATION_ONLY','DEC_024_058_PROMOTION',reason],
        modifierIds:[],ruleVersion:B001_PROMOTION_VERSION,
      })
      if(!accepted)continue
      const person:Person={
        personId:p.personId,name:p.personName,sex:p.sex,birthYear:cohort.birthYear,
        alive:true,originGroupId:cohort.groupId,houseId:p.houseId,
        legalDynasty:{status:'UNDETERMINED',reasonCodes:['B001_IDENTITY_ATTESTED','NO_LEGAL_DYNASTY_EVIDENCE']},
      }
      commands.push({
        type:'PERSON_PROMOTE',commandId:'cmd:b001:'+key,
        source:{requestId:'req:b001:'+key,year:ctx.year,phase:ctx.phase,
          sourceRuleId:'B-001',sourceTraceId:ctx.traceId(draftIndex),
          sourceIntentId:p.identityEvidenceId},
        person,cohortId:cohort.cohortId,cohortBirthYear:cohort.birthYear,
        cohortSize:cohort.memberCount,memberOrdinal:p.memberOrdinal,
        identityEvidenceId:p.identityEvidenceId,
      })
    }
    return {ruleId:ctx.ruleId,phase:ctx.phase,commands,requests:[],deferred:[],traceDrafts}
  }
  return {ok:true,evaluator}
}
