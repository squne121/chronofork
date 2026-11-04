// DEC-061 / Issue #83: PopulationGroupの少数の匿名候補をB-001でSUPPORTINGとして記録。
// 成立した婚姻・近親適格性・合法王朝帰属を推定せず、CALIBRATION_ONLYの候補供給のみ行う。
import type { DecisionTraceDraft, Id, Person, PersonSupportingRecordCommand, RuleOutcome, WorldState } from '../../contracts/index.ts'
import type { EvaluationContext, RuleEvaluator } from '../../engine/evaluators.ts'
import { EvaluationFailure } from '../../engine/evaluators.ts'
import { proposeSupportingMarriageCandidates, validateSupportingMarriageCohorts } from '../../population/supporting-marriage.ts'
import type { SupportingMarriageCohort } from '../../population/supporting-marriage.ts'

export const B001_SUPPORTING_VERSION = 'b001-supporting-registration-0:CALIBRATION_ONLY'
export type B001SupportingInput = Readonly<{
  cohorts: readonly SupportingMarriageCohort[]
  /** 1年の新規記録上限。全人口のPerson化をしない。 */
  maxRecordsPerYear: number
  /** 記録済みの生存補助人物がこの値以上なら新たに抽出しない。 */
  maxAliveSupporting: number
  perCohortSamples: number
  maximumPreviewAge: number
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
      !validNumber(input.maximumPreviewAge, 18, 100))
    return {ok:false,issues:['INVALID_SUPPORTING_REGISTRATION_CALIBRATION']}
  const cohorts = structuredClone(input.cohorts) as SupportingMarriageCohort[]
  const settings = Object.freeze({
    maxRecordsPerYear: input.maxRecordsPerYear,
    maxAliveSupporting: input.maxAliveSupporting,
    perCohortSamples: input.perCohortSamples,
    maximumPreviewAge: input.maximumPreviewAge,
  })
  const evaluator: RuleEvaluator = (world: WorldState, ctx: EvaluationContext): RuleOutcome => {
    if (ctx.ruleId !== 'B-001' || ctx.phase !== 3 || ctx.year !== world.year) {
      throw new EvaluationFailure('B-001補助人物記録は当年フェーズ3に限ります',[
        {code:'RULE_MISMATCH',message:String(ctx.ruleId)}])
    }
    const checked = validateSupportingMarriageCohorts(world, cohorts)
    if (checked.length > 0) throw new EvaluationFailure('人口集団の補助人物出典が不整合',
      checked.map(code => ({code,message:code})))
    const active = world.persons.filter(p => p.alive && p.interactionRole === 'SUPPORTING').length
    const used = new Set<Id>(world.persons.map(p => p.personId))
    const married = new Set(world.legal.marriages.filter(m => m.status === 'ACTIVE').flatMap(m => m.personIds))
    const seekers = world.persons
      .filter(p => p.alive && p.interactionRole !== 'SUPPORTING' &&
        !married.has(p.personId) && ctx.year - p.birthYear >= 18)
      .sort((a,b) => cmp(a.personId,b.personId))
    const traceDrafts: DecisionTraceDraft[] = []
    const commands: PersonSupportingRecordCommand[] = []
    for (const seeker of seekers) {
      if (commands.length >= settings.maxRecordsPerYear ||
          active + commands.length >= settings.maxAliveSupporting) break
      const supplied = proposeSupportingMarriageCandidates(world, seeker.personId, cohorts, {
        seed: ctx.seed,
        maxCandidates: 1,
        perCohortSamples: settings.perCohortSamples,
        maximumPreviewAge: settings.maximumPreviewAge,
        usedCandidateIds: used,
      })
      if (supplied.status !== 'PROPOSED') continue
      const candidate = supplied.candidates[0]!
      const cohort = cohorts.find(c => c.cohortId === candidate.cohortId)!
      // Phase Aの抽象候補と異なり、成人SUPPORTINGの記録は初期人口出典だけを対象とする。
      if (cohort.source !== 'INITIAL_POPULATION') continue
      used.add(candidate.candidateId)
      const person: Person = {
        personId: candidate.candidateId,
        name: '試験用補助人物 ' + candidate.cohortId + ' #' + candidate.ordinal,
        interactionRole: 'SUPPORTING',
        sex: candidate.sex, birthYear: candidate.birthYear, alive: true,
        originGroupId: candidate.groupId, houseId: candidate.affiliationHouseId,
        legalDynasty: { status: 'UNDETERMINED', reasonCodes: ['POPULATION_COHORT_NOT_A_DYNASTY_PROOF'] },
      }
      const key = JSON.stringify([ctx.year,candidate.candidateId])
      const traceIndex = traceDrafts.length
      traceDrafts.push({
        year: ctx.year, phase: ctx.phase, ruleId: ctx.ruleId,
        actorRef: {kind:'GROUP',id:candidate.groupId},
        candidates: [{
          candidateId: 'b001:supporting:' + key, eligible: true,
          inputs: {
            seekerPersonId: seeker.personId, supportingPersonId: person.personId,
            cohortId: cohort.cohortId, familyPoolId: candidate.familyPoolId,
            memberOrdinal: candidate.ordinal, sourceEvidenceId: cohort.sourceEvidenceId,
            kinshipStatus: 'UNVERIFIED', provenance: 'CALIBRATION_ONLY',
          },
          reasonCodes: ['CALIBRATION_ONLY','SUPPORTING_RECORD_ONLY','NOT_MARRIAGE_APPROVAL'],
        }],
        selectedCandidateId: 'b001:supporting:' + key, status: 'ACCEPT',
        reasonCodes: ['CALIBRATION_ONLY','SUPPORTING_RECORD_ONLY','NOT_MARRIAGE_APPROVAL'],
        modifierIds: [], ruleVersion: B001_SUPPORTING_VERSION,
      })
      commands.push({
        type: 'PERSON_SUPPORTING_RECORD',
        commandId: 'cmd:b001:supporting:' + key,
        source: {
          requestId: 'req:b001:supporting:' + key,
          year: ctx.year, phase: ctx.phase, sourceRuleId: 'B-001',
          sourceTraceId: ctx.traceId(traceIndex),
          sourceIntentId: cohort.sourceEvidenceId,
        },
        person, cohortId: cohort.cohortId, cohortSize: cohort.memberCount,
        memberOrdinal: candidate.ordinal,
        familyPoolId: cohort.familyPoolId,
        sourceEvidenceId: cohort.sourceEvidenceId, birthBacking: cohort.source,
      })
    }
    return {ruleId: ctx.ruleId, phase: ctx.phase, commands,requests:[],deferred:[],traceDrafts}
  }
  return {ok:true,evaluator}
}
