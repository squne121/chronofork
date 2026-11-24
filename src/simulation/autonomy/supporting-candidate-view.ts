// B001のTraceは出典そのものではない。エンジンの供給時snapshotと構成入力から再実行して照合する。
import type { Id, Person, SupportingPersonRegistration, WorldState } from '../contracts/index.ts'
import { supportingCandidateId } from '../population/supporting-marriage.ts'
import type { EvaluationContext } from '../engine/evaluators.ts'
import { B001_SUPPORTING_VERSION, createB001SupportingMarriageEvaluator } from '../rules/b/b001-supporting-marriage.ts'
import type { B001SupportingInput } from '../rules/b/b001-supporting-marriage.ts'
import { abstractSupportingPerson, createAnnualMarriageSupply } from './abstract-marriage-supply.ts'
import type { AbstractMarriageSupplyConfig, AnnualMarriageSupply } from './abstract-marriage-supply.ts'

export type ResolvedSupportingCandidate = Readonly<{seekerId:Id; person:Person; registration:SupportingPersonRegistration; traceId:Id; maxRecordsPerYear:number; maxAliveSupporting:number}>
export type SupportingCandidateResolver = (world:WorldState,ctx:EvaluationContext)=>readonly ResolvedSupportingCandidate[]

type SupplyInspection = Readonly<{
  candidates: readonly ResolvedSupportingCandidate[]
  verified: boolean
  budgetBlockedActors: ReadonlySet<Id>
}>
const noBlockedActors:ReadonlySet<Id>=new Set()
const unverified = {candidates:[],verified:false,budgetBlockedActors:noBlockedActors} as const
export const supportingRankingBlock = (supply:SupplyInspection,pair:readonly [Id,Id]) =>
  !supply.verified?'SUPPORTING_SUPPLY_UNVERIFIED':
    pair.some(id=>supply.budgetBlockedActors.has(id))?'SUPPORTING_CANDIDATE_BUDGET_EXCEEDED':null
const populationResolvers = new WeakMap<SupportingCandidateResolver, Readonly<{
  evidenceIds: (ctx: EvaluationContext) => readonly Id[]
  annual?: AnnualMarriageSupply
  inspect: (world:WorldState,ctx:EvaluationContext)=>SupplyInspection
}>>()
export const supportingPopulationEvidenceIds = (resolver: SupportingCandidateResolver | undefined, ctx: EvaluationContext): readonly Id[] =>
  (resolver && populationResolvers.get(resolver)?.evidenceIds(ctx)) ?? []
export const supportingAnnualMarriageEvidence = (resolver: SupportingCandidateResolver | undefined, ctx: EvaluationContext) =>
  resolver && populationResolvers.get(resolver)?.annual?.(ctx)
export const inspectSupportingCandidateSupply = (
  resolver: SupportingCandidateResolver | undefined, world:WorldState, ctx:EvaluationContext,
):SupplyInspection => resolver ? populationResolvers.get(resolver)?.inspect(world,ctx) ?? unverified
  : {candidates:[],verified:true,budgetBlockedActors:noBlockedActors}

export const isPopulationSupportingResolver = (resolve: SupportingCandidateResolver): boolean =>
  populationResolvers.has(resolve)

/** 取得不能または照合失敗時は候補を返さない。呼出側は未登録者の信頼も別途検証する。 */
export function createSupportingCandidateResolver(input:B001SupportingInput):SupportingCandidateResolver {
  if(typeof input==='function')throw new RangeError('INVALID_SUPPORTING_INPUT')
  return createCandidateResolver(input)
}

/** B-004/B-005/A-LEG-01はこのresolverで同一の供給元に束縛する。ルール別の差替え口は設けない。 */
export function createAbstractSupportingCandidateScope(config: AbstractMarriageSupplyConfig, marriageMinAge: number):
  Readonly<{resolve: SupportingCandidateResolver; evaluate: ReturnType<AnnualMarriageSupply>['evaluate']}> {
  const annual=createAnnualMarriageSupply(config,marriageMinAge)
  return {resolve:createCandidateResolver(annual),evaluate:(world,ctx)=>annual(ctx).evaluate(world,ctx)}
}

function createCandidateResolver(input:B001SupportingInput|AnnualMarriageSupply):SupportingCandidateResolver {
  const fixed=typeof input==='function'?undefined:structuredClone(input)
  const factory=fixed&&createB001SupportingMarriageEvaluator(fixed)
  if(factory&&!factory.ok)throw new RangeError('INVALID_SUPPORTING_INPUT:'+factory.issues.join(','))
  const current=typeof input==='function'?input:()=>({input:fixed!,evaluate:factory!.evaluator})
  const inspect = (world:WorldState,ctx:EvaluationContext):SupplyInspection=>{
    const snapshot=ctx.supportingCandidateSnapshot
    if(!snapshot||snapshot.branchId!==ctx.branchId||snapshot.year!==ctx.year||
      snapshot.world.year!==ctx.year||world.year!==ctx.year)return unverified
    const {input: fixed, evaluate}=current(ctx)
    const replay=evaluate(snapshot.world,{...ctx,ruleId:'B-001',phase:3})
    const actual=(ctx.priorTraces??[]).filter(t=>t.ruleId==='B-001'&&t.phase===3&&
      t.year===ctx.year&&t.ruleVersion===B001_SUPPORTING_VERSION)
    // 確定TraceはselectedCandidateIdの挿入順がdraftと異なるため、キー順を正規化して比較する。
    const canonical=(v:unknown):unknown=>Array.isArray(v)?v.map(canonical):
      v!==null&&typeof v==='object'?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a<b?-1:a>b?1:0)
        .map(([key,value])=>[key,canonical(value)])):v
    const draftKey=(d:unknown)=>JSON.stringify(canonical(d))
    const expected=replay.traceDrafts.map(draftKey).sort()
    const keyOfTrace=(t:typeof actual[number])=>draftKey(Object.fromEntries(
      Object.entries(t).filter(([key])=>key!=='traceId'&&key!=='eventIds')))
    const received=actual.map(keyOfTrace).sort()
    if(expected.length!==received.length||expected.some((v,i)=>v!==received[i]))return unverified
    const result:ResolvedSupportingCandidate[]=[]
    for(const d of replay.traceDrafts){
      if(d.status!=='ACCEPT'||d.candidates.length!==1)continue
      const c=d.candidates[0]!, v=c.inputs
      if(!c.eligible||d.selectedCandidateId!==c.candidateId||
        typeof v.seekerPersonId!=='string'||typeof v.supportingCandidateId!=='string'||
        typeof v.candidateHouseId!=='string'||typeof v.candidateGroupId!=='string'||
        (v.candidateSex!=='MALE'&&v.candidateSex!=='FEMALE')||
        typeof v.candidateBirthYear!=='number'||!Number.isSafeInteger(v.candidateBirthYear)||
        world.persons.some(p=>p.personId===v.supportingCandidateId))continue
      const cohort=fixed.cohorts.find(x=>x.cohortId===v.cohortId)
      const ordinal=v.memberOrdinal
      const trace=actual.find(t=>keyOfTrace(t)===draftKey(d))
      if(!cohort||typeof ordinal!=='number'||!Number.isSafeInteger(ordinal)||ordinal<0||ordinal>=cohort.memberCount||
        supportingCandidateId(cohort.cohortId,ordinal)!==v.supportingCandidateId||!trace)continue
      const person=abstractSupportingPerson(v.supportingCandidateId,cohort)
      const registration:SupportingPersonRegistration={person,cohortId:cohort.cohortId,
        cohortSize:cohort.memberCount,memberOrdinal:ordinal,sourceEvidenceId:cohort.sourceEvidenceId,
        familyPoolId:cohort.familyPoolId,birthBacking:cohort.source,
        ...(cohort.survivorAttestationId?{survivorAttestationId:cohort.survivorAttestationId}:{})}
      result.push({seekerId:v.seekerPersonId,person,registration,traceId:trace.traceId,
        maxRecordsPerYear:fixed.maxRecordsPerYear,maxAliveSupporting:fixed.maxAliveSupporting})
    }
    // 未提示ペアの双方に限って首位が不明。既知の順位候補は除かず、他者を繰り上げない。
    const budgetBlockedActors=new Set<Id>()
    for(const d of replay.traceDrafts){
      const omitted=d.candidates[0]?.inputs.budgetOmittedCandidateIds
      if(d.status!=='DEFER'||d.actorRef.kind!=='PERSON'||!Array.isArray(omitted)||!omitted.length)continue
      const seeker=world.persons.find(p=>d.actorRef.kind==='PERSON'&&p.personId===d.actorRef.id)
      const minAge=ctx.marriageCandidateMinAge??18
      if(!seeker?.alive||ctx.year-seeker.birthYear<minAge)continue
      for(const id of omitted){
        if(typeof id!=='string'||!id.startsWith('support:population:'))continue
        const [cohortId]=JSON.parse(id.slice('support:population:'.length)) as [Id,number]
        const cohort=fixed.cohorts.find(c=>c.cohortId===cohortId)
        if(!cohort||ctx.year-cohort.birthYear<minAge)continue
        budgetBlockedActors.add(d.actorRef.id)
        budgetBlockedActors.add(id)
      }
    }
    return {candidates:result,verified:true,budgetBlockedActors}
  }
  const resolve:SupportingCandidateResolver=(world,ctx)=>inspect(world,ctx).candidates
  const evidenceIds=(ctx:EvaluationContext)=>current(ctx).input.cohorts.flatMap(c =>
    c?.survivorAttestationId ? [c.sourceEvidenceId, c.survivorAttestationId] : c?.sourceEvidenceId?[c.sourceEvidenceId]:[])
  populationResolvers.set(resolve,{evidenceIds,inspect,...(typeof input==='function'?{annual:input}:{})})
  return resolve
}
