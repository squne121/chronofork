// DEC-061: 未成立の候補は抽象ビューに留め、個別Personを記録しない。
// 成立した婚姻・近親適格性・合法王朝帰属を推定せず、CALIBRATION_ONLYの候補供給のみ行う。
import type { DecisionTraceDraft, Id, RuleOutcome, WorldState } from '../../contracts/index.ts'
import type { EvaluationContext, RuleEvaluator } from '../../engine/evaluators.ts'
import { EvaluationFailure } from '../../engine/evaluators.ts'
import { createSupportingMarriageCandidateView, validateSupportingMarriageCohorts } from '../../population/supporting-marriage.ts'
import type { SupportingMarriageCohort } from '../../population/supporting-marriage.ts'
import { isIndependentKinshipSource, validateSupportingKinshipClearances } from '../../legal/supporting-kinship-clearance.ts'
import type { SupportingKinshipClearance } from '../../legal/supporting-kinship-clearance.ts'

export const B001_SUPPORTING_VERSION = 'b001-supporting-candidates-2:CALIBRATION_ONLY'
export type B001SupportingInput = Readonly<{
  cohorts: readonly SupportingMarriageCohort[]
  /** 1年の新規記録上限。全人口のPerson化をしない。 */
  maxRecordsPerYear: number
  /** 成立時に適用する、記録済み生存補助人物の上限。抽象候補数の上限ではない。 */
  maxAliveSupporting: number
  perCohortSamples: number
  maximumPreviewAge: number
  /**
   * 任意。指定時は、人物ペア単位の禁親確認証拠(B-005/A-LEG-01が使う台帳と同じ入力。照合条件も同じ: 管轄一致・当年有効・ちょうど1件)が当年有効な
   * 候補だけを提示する。禁親審査そのものは緩和しない(審査はB-005/A-LEG-01が再実施)。
   */
  kinshipClearances?: readonly SupportingKinshipClearance[]
  /** 個別化の探索対象だけを指定する。法的証拠ではなく審査結果を変更しない。 */
  candidatePairs?: readonly (readonly [Id, Id])[]
  /** 任意。kinshipClearances指定時に、1人の探索者へ同時に保持する証拠付き未婚候補の上限(1〜8)。 */
  maxOpenCandidatesPerSeeker?: number
}>
export type B001SupportingFactory =
  | Readonly<{ ok: true; evaluator: RuleEvaluator }>
  | Readonly<{ ok: false; issues: readonly string[] }>
const validNumber = (n: number, min: number, max: number) =>
  Number.isSafeInteger(n) && n >= min && n <= max
const cmp = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0

export function createB001SupportingMarriageEvaluator(input: B001SupportingInput): B001SupportingFactory {
  if (!input || !Array.isArray(input.cohorts) ||
      !validNumber(input.maxRecordsPerYear, 1, 4) ||
      !validNumber(input.maxAliveSupporting, 1, 64) ||
      !validNumber(input.perCohortSamples, 1, 16) ||
      !validNumber(input.maximumPreviewAge, 18, 100) ||
      (input.maxOpenCandidatesPerSeeker !== undefined && !validNumber(input.maxOpenCandidatesPerSeeker, 1, 8)) ||
      (input.kinshipClearances !== undefined && validateSupportingKinshipClearances(input.kinshipClearances).length > 0) ||
      (input.candidatePairs !== undefined && (!Array.isArray(input.candidatePairs) || input.candidatePairs.some(p =>
        !Array.isArray(p) || p.length !== 2 || p.some(id => typeof id !== 'string' || !id)))))
    return {ok:false,issues:['INVALID_SUPPORTING_REGISTRATION_CALIBRATION']}
  const cohorts = structuredClone(input.cohorts) as SupportingMarriageCohort[]
  const settings = Object.freeze({
    maxRecordsPerYear: input.maxRecordsPerYear,
    maxAliveSupporting: input.maxAliveSupporting,
    perCohortSamples: input.perCohortSamples,
    maximumPreviewAge: input.maximumPreviewAge,
    maxOpenCandidatesPerSeeker: input.maxOpenCandidatesPerSeeker,
  })
  const clearanceByPair = new Map<string, SupportingKinshipClearance[]>()
  const attestedBySeeker = new Map<Id, Set<Id>>()
  for (const c of structuredClone(input.kinshipClearances ?? []) as SupportingKinshipClearance[]) {
    const k = JSON.stringify(c.personIds)
    clearanceByPair.set(k, [...(clearanceByPair.get(k) ?? []), c])
    for(const [actor,peer] of [[c.personIds[0],c.personIds[1]],[c.personIds[1],c.personIds[0]]] as const){
      const ids=attestedBySeeker.get(actor)??new Set<Id>()
      ids.add(peer)
      attestedBySeeker.set(actor,ids)
    }
  }
  const selectedBySeeker = input.candidatePairs === undefined ? undefined : new Map<Id, Set<Id>>()
  for(const [seekerId,candidateId] of input.candidatePairs??[]){
    const ids=selectedBySeeker?.get(seekerId)??new Set<Id>()
    ids.add(candidateId)
    selectedBySeeker?.set(seekerId,ids)
  }
  const selected = (a: Id, b: Id) => selectedBySeeker === undefined || selectedBySeeker.get(a)?.has(b)===true
  const evidenceBacked = input.kinshipClearances !== undefined
  const populationEvidenceIds=cohorts.flatMap(c=>[c.sourceEvidenceId,...(c.survivorAttestationId?[c.survivorAttestationId]:[])])
  // 管轄一致・当年有効・ちょうど1件・人口出典とは独立。禁親審査そのものはB-005/A-LEG-01が行う。
  const cleared = (a: Id, b: Id, year: number, countryId: Id | undefined): boolean => {
    if(countryId===undefined)return false
    const matching=(clearanceByPair.get(JSON.stringify(cmp(a, b) <= 0 ? [a, b] : [b, a])) ?? [])
      .filter(c => c.countryId === countryId && c.checkedYear <= year && year < c.validUntilYear)
    return matching.length===1&&matching[0]!.abstractFinding===undefined&&
      isIndependentKinshipSource(matching[0]!.sourceEvidenceId,populationEvidenceIds)
  }
  const evaluator: RuleEvaluator = (world: WorldState, ctx: EvaluationContext): RuleOutcome => {
    if (ctx.ruleId !== 'B-001' || ctx.phase !== 3 || ctx.year !== world.year) {
      throw new EvaluationFailure('B-001補助人物候補の供給は当年フェーズ3に限ります',[
        {code:'RULE_MISMATCH',message:String(ctx.ruleId)}])
    }
    // まだ18歳に達していないC004コホートは、現在の年に出生/成人したことにしない。
    const eligibleCohorts=cohorts.filter(c=>ctx.year-c.birthYear>=18&&
      ctx.year-c.birthYear<=settings.maximumPreviewAge)
    const checked = validateSupportingMarriageCohorts(world, eligibleCohorts)
    const evidenceMissing = new Set([
      'COHORT_SOURCE_EVIDENCE_MISSING', 'C004_SURVIVOR_ATTESTATION_MISSING',
      'C004_BIRTH_BACKING_INSUFFICIENT', 'C004_SHARED_BIRTH_CAPACITY_EXCEEDED',
      'GROUP_POPULATION_CAPACITY_EXCEEDED',
    ])
    if (checked.some(code => !evidenceMissing.has(code.split(':', 1)[0]!))) {
      throw new EvaluationFailure('人口集団の補助人物出典が不整合', checked.map(code => ({code,message:code})))
    }
    const usableCohorts=eligibleCohorts.filter((c,i)=>!checked.some(code=>
      code===`GROUP_POPULATION_CAPACITY_EXCEEDED:${c.groupId}`||
      (c.source==='C004_COHORT'&&code===`C004_SHARED_BIRTH_CAPACITY_EXCEEDED:${JSON.stringify([c.groupId,c.birthYear])}`)||
      ['COHORT_SOURCE_EVIDENCE_MISSING','C004_SURVIVOR_ATTESTATION_MISSING','C004_BIRTH_BACKING_INSUFFICIENT']
        .some(reason=>code===`${reason}:${i}`)))
    const married = new Set(world.legal.marriages.filter(m => m.status === 'ACTIVE').flatMap(m => m.personIds))
    const seekers = world.persons
      .filter(p => p.alive && p.interactionRole !== 'SUPPORTING' &&
        !married.has(p.personId) && ctx.year - p.birthYear >= 18)
      .sort((a,b) => cmp(a.personId,b.personId))
    const traceDrafts: DecisionTraceDraft[] = []
    const defer=(seekerId:Id, reasonCodes:readonly string[], omitted:readonly Id[]=[])=>{
      const key=JSON.stringify([ctx.year,seekerId,...reasonCodes])
      traceDrafts.push({
        year:ctx.year,phase:ctx.phase,ruleId:ctx.ruleId,
        actorRef:{kind:'PERSON',id:seekerId},
        candidates:[{candidateId:'b001:supporting:defer:'+key,eligible:false,
          inputs:{seekerPersonId:seekerId,provenance:'CALIBRATION_ONLY',
            ...(omitted.length>0?{budgetOmittedCandidateIds:omitted}:{})},
          reasonCodes:['CALIBRATION_ONLY',...reasonCodes]}],
        status:'DEFER',reasonCodes:['CALIBRATION_ONLY','SUPPORTING_SUPPLY_DEFERRED',...reasonCodes],
        modifierIds:[],ruleVersion:B001_SUPPORTING_VERSION,
      })
    }
    const noCandidates:ReadonlySet<Id>=new Set()
    for (const seeker of seekers) {
      // 欠けた出典だけを隔離する。共有枠が衝突した集団・出生枠は再配分しない。
      if (checked.length > 0) defer(seeker.personId, checked)
      if (checked.length > 0 && usableCohorts.length === 0) continue
      const seekerCountry = world.houses.find(h => h.houseId === seeker.houseId)?.countryId
      let candidateBudget = 32
      if (evidenceBacked && settings.maxOpenCandidatesPerSeeker !== undefined) {
        const open = world.persons.filter(p => p.alive && p.interactionRole === 'SUPPORTING' &&
          !married.has(p.personId) && p.sex !== seeker.sex && selected(seeker.personId, p.personId) && cleared(seeker.personId, p.personId, ctx.year, seekerCountry)).length
        candidateBudget = settings.maxOpenCandidatesPerSeeker - open
      }
      const supplied = createSupportingMarriageCandidateView(world, {branchId:ctx.branchId, year:ctx.year, seekerId:seeker.personId}, usableCohorts, {
        ...(selectedBySeeker?{boundedCandidateIds:selectedBySeeker.get(seeker.personId)??noCandidates}
          :evidenceBacked?{boundedCandidateIds:attestedBySeeker.get(seeker.personId)??noCandidates}:{}),
        ...((evidenceBacked || selectedBySeeker !== undefined) ? { candidateFilter: (c: { candidateId: Id }) => selected(seeker.personId, c.candidateId) && (!evidenceBacked || cleared(seeker.personId, c.candidateId, ctx.year, seekerCountry)) } : {}),
        seed: ctx.seed,
        maxCandidates: Math.max(1,candidateBudget),
        perCohortSamples: settings.perCohortSamples,
        maximumPreviewAge: settings.maximumPreviewAge,
      }).result
      // 残り0枠でも、提示できなかった候補を記録し、順位が不明になる当事者だけを特定する。
      if (candidateBudget <= 0) {
        defer(seeker.personId,['OPEN_EVIDENCE_BACKED_CANDIDATES_AT_LIMIT'],
          supplied.status==='PROPOSED'?supplied.candidates.map(c=>c.candidateId):supplied.budgetOmittedCandidateIds)
        continue
      }
      if (supplied.status !== 'PROPOSED') {
        defer(seeker.personId,supplied.reasonCodes,supplied.budgetOmittedCandidateIds)
        continue
      }
      for (const candidate of supplied.candidates) {
      const cohort = cohorts.find(c => c.cohortId === candidate.cohortId)!
      // 同じ抽象候補を複数探索者に提示できる。記録予算は成立時に検証する。
      const key = JSON.stringify([ctx.year,seeker.personId,candidate.candidateId])
      // このTraceのラベルは診断情報であり、枝・出典・存命の証明ではない。
      // 後続で使用する場合は当年のWorldStateと信頼できる入力から再導出・照合する必要がある。
      traceDrafts.push({
        year: ctx.year, phase: ctx.phase, ruleId: ctx.ruleId,
        actorRef: {kind:'GROUP',id:candidate.groupId},
        candidates: [{
          candidateId: 'b001:supporting:' + key, eligible: true,
          inputs: {
            seekerPersonId: seeker.personId, supportingCandidateId: candidate.candidateId,
            cohortId: cohort.cohortId, cohortSize: cohort.memberCount, familyPoolId: candidate.familyPoolId,
            memberOrdinal: candidate.ordinal, sourceEvidenceId: cohort.sourceEvidenceId,
            survivorAttestationId: cohort.survivorAttestationId??null,
            candidateBranchId: ctx.branchId, candidateYear: ctx.year,
            candidateGroupId: candidate.groupId, candidateHouseId: candidate.affiliationHouseId,
            candidateSex: candidate.sex, candidateBirthYear: candidate.birthYear,
            candidateTier: candidate.tier, populationSource: cohort.source,
            kinshipStatus: 'UNVERIFIED', provenance: 'CALIBRATION_ONLY',
            maxRecordsPerYear: settings.maxRecordsPerYear, maxAliveSupporting: settings.maxAliveSupporting,
          },
          reasonCodes: ['CALIBRATION_ONLY','SUPPORTING_CANDIDATE_ONLY','NOT_MARRIAGE_APPROVAL'],
        }],
        selectedCandidateId: 'b001:supporting:' + key, status: 'ACCEPT',
        reasonCodes: ['CALIBRATION_ONLY','SUPPORTING_CANDIDATE_ONLY','NOT_MARRIAGE_APPROVAL'],
        modifierIds: [], ruleVersion: B001_SUPPORTING_VERSION,
      })
      }
    }
    return {ruleId: ctx.ruleId, phase: ctx.phase, commands:[],requests:[],deferred:[],traceDrafts}
  }
  return {ok:true,evaluator}
}
