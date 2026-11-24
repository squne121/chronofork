import type { Id, PairTrustBase, Person, WorldState } from '../contracts/index.ts'
import { START_YEAR } from '../contracts/index.ts'
import type { EvaluationContext, RuleEvaluator } from '../engine/evaluators.ts'
import { EvaluationFailure } from '../engine/evaluators.ts'
import { PAIR_TRUST_DEFINITION } from '../intervention/stat-registry.ts'
import { MVP_MARRIAGE_MIN_AGE } from '../legal/nextgen-marriage.ts'
import type { SupportingKinshipClearance } from '../legal/supporting-kinship-clearance.ts'
import { abstractBirthCohort, abstractCandidateLife, abstractCandidateTrust, abstractKinshipReview }
  from '../population/abstract-marriage-background.ts'
import type { AbstractMarriageCalibration } from '../population/abstract-marriage-background.ts'
import { countRegisteredSupportingBirths, supportingBirthBucketKey } from '../population/supporting-marriage.ts'
import type { SupportingMarriageCohort } from '../population/supporting-marriage.ts'
import { drawRandom } from '../random.ts'
import { createB001SupportingMarriageEvaluator } from '../rules/b/b001-supporting-marriage.ts'
import type { B001SupportingInput } from '../rules/b/b001-supporting-marriage.ts'

export type AbstractMarriageSupplyConfig = Readonly<{
  status: 'CALIBRATION_ONLY'
  background: AbstractMarriageCalibration
  groups: readonly Readonly<{groupId: Id; houseId: Id}>[]
  initialBirthYears: readonly number[]
  offersPerSeeker: number
  maximumPreviewAge: number
  maxRecordsPerYear: number
  maxAliveSupporting: number
}>

type AnnualSupply = Readonly<{
  input: B001SupportingInput
  trustBase: readonly PairTrustBase[]
  clearances: readonly SupportingKinshipClearance[]
}>
export type AnnualMarriageSupply = (ctx: EvaluationContext) => Readonly<AnnualSupply & {evaluate: RuleEvaluator}>

const cmp = (a: Id, b: Id) => a < b ? -1 : a > b ? 1 : 0
const pairOf = (a: Id, b: Id): readonly [Id, Id] => a < b ? [a, b] : [b, a]

function freezeAnnualData<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freezeAnnualData(child)
    Object.freeze(value)
  }
  return value
}

/** 実Personではない候補ビューとresolverで同じ暫定像を使う。 */
export function abstractSupportingPerson(personId: Id, cohort: SupportingMarriageCohort): Person {
  return {personId, name: personId, interactionRole: 'SUPPORTING', sex: cohort.sex, birthYear: cohort.birthYear,
    alive: true, originGroupId: cohort.groupId, houseId: cohort.affiliationHouseId,
    legalDynasty: {status: 'UNDETERMINED', reasonCodes: ['SUPPORTING_CANDIDATE_UNREGISTERED']}}
}

/** 探索標本を先に決める。禁親・信頼・契約・登録予算を見て候補を補充しない。 */
export function deriveAbstractMarriageSupply(world: WorldState, seed: number, config: AbstractMarriageSupplyConfig,
  marriageMinAge = MVP_MARRIAGE_MIN_AGE): AnnualSupply {
  const minAge = Math.max(MVP_MARRIAGE_MIN_AGE, marriageMinAge)
  const {year} = world
  const married = new Set(world.legal.marriages.filter(m => m.status === 'ACTIVE').flatMap(m => m.personIds))
  const adults = world.persons.filter(p => p.alive && !married.has(p.personId) && year - p.birthYear >= minAge)
    .sort((a, b) => cmp(a.personId, b.personId))
  const seekers = adults.filter(p => p.interactionRole !== 'SUPPORTING')
  const registered = adults.filter(p => p.interactionRole === 'SUPPORTING')
  const cohorts = new Map<Id, SupportingMarriageCohort>()
  const candidatePairs: [Id, Id][] = []
  const trustBase: PairTrustBase[] = []
  const clearances: SupportingKinshipClearance[] = []
  const evidence = (seeker: Person, candidate: Person, isRegistered: boolean) => {
    const pair = pairOf(seeker.personId, candidate.personId)
    const review = abstractKinshipReview(world, seed, pair, isRegistered ? [] : [candidate], config.background)
    if (review.record) clearances.push(review.record)
    if (!isRegistered) trustBase.push(abstractCandidateTrust(seed, pair, config.background))
  }
  if (seekers.length > 0) {
    const knownIds = new Set(world.persons.map(p => p.personId))
    const houses = new Map(world.houses.map(h => [h.houseId, h]))
    const groups = new Map(world.groups.map(g => [g.groupId, g]))
    const regions = new Map(world.regions.map(r => [r.regionId, r]))
    const countries = new Set(world.countries.map(c => c.countryId))
    const births = new Map((world.demographics.anonymousBirthHistory ?? []).map(r => [supportingBirthBucketKey(r.groupId, r.year), r.anonymousBirths]))
    const usedBirths = countRegisteredSupportingBirths(world.persons)
    const pool: {cohort: SupportingMarriageCohort; countryId: Id; id: Id}[] = []
    for (const {groupId, houseId} of config.groups) {
      const group = groups.get(groupId)
      const house = houses.get(houseId)
      if (!group || !house?.countryId || !countries.has(house.countryId) ||
          regions.get(group.regionId)?.sovereignCountryId !== house.countryId || group.support.houseBps[houseId] === undefined) continue
      const entries: {birthYear: number; sex: Person['sex']}[] = []
      for (const birthYear of config.initialBirthYears) {
        if (year - birthYear >= minAge && year - birthYear <= config.maximumPreviewAge) {
          entries.push({birthYear, sex: 'MALE'}, {birthYear, sex: 'FEMALE'})
        }
      }
      for (let birthYear = Math.max(START_YEAR, year - config.maximumPreviewAge); birthYear <= year - minAge; birthYear++) {
        const bucket = supportingBirthBucketKey(groupId, birthYear)
        if ((births.get(bucket) ?? 0) <= (usedBirths.get(bucket) ?? 0)) continue
        // 集団×出生年につき最大1slot。偶奇は出生枠を男女で二重消費しないための固定配分。
        entries.push({birthYear, sex: birthYear % 2 === 0 ? 'FEMALE' : 'MALE'})
      }
      for (const {birthYear, sex} of entries) {
        const cohort = abstractBirthCohort(groupId, houseId, birthYear, sex, 1)
        const life = abstractCandidateLife(seed, cohort, 0, year, config.background)
        if (knownIds.has(life.candidateId) || !life.available) continue
        pool.push({cohort: {...cohort, survivorAttestationId: life.survivalEvidenceId}, countryId: house.countryId, id: life.candidateId})
      }
    }
    pool.sort((a, b) => cmp(a.id, b.id))
    for (const seeker of seekers) {
      const countryId = houses.get(seeker.houseId)?.countryId
      const scope = pool.filter(p => p.countryId === countryId && p.cohort.sex !== seeker.sex)
      const count = Math.min(config.offersPerSeeker, scope.length)
      if (count > 0) {
        const start = Math.floor(drawRandom(seed, {year, phase: 3, ruleId: 'B-001', stream: 'ENDOGENOUS',
          actorId: seeker.personId, targetId: null, eventKey: 'ABSTRACT_MARRIAGE_SEARCH_START_V1'}) * scope.length)
        for (let i = 0; i < count; i++) {
          const {cohort, id} = scope[(start + i) % scope.length]!
          cohorts.set(cohort.cohortId, cohort)
          candidatePairs.push([seeker.personId, id])
          evidence(seeker, abstractSupportingPerson(id, cohort), false)
        }
      }
      for (const p of registered) {
        if (p.sex !== seeker.sex && houses.get(p.houseId)?.countryId === countryId) evidence(seeker, p, true)
      }
    }
  }
  return {input: {cohorts: [...cohorts.values()], candidatePairs, perCohortSamples: 1,
    maximumPreviewAge: config.maximumPreviewAge, maxRecordsPerYear: config.maxRecordsPerYear,
    maxAliveSupporting: config.maxAliveSupporting}, trustBase, clearances}
}

export function createAnnualMarriageSupply(input: AbstractMarriageSupplyConfig, marriageMinAge: number): AnnualMarriageSupply {
  const config = structuredClone(input)
  const integer = (n: number, min: number, max: number) => Number.isSafeInteger(n) && n >= min && n <= max
  const bg = config.background
  if (config.status !== 'CALIBRATION_ONLY' || !integer(config.offersPerSeeker, 1, 8) ||
      !integer(config.maximumPreviewAge, 18, 100) || !integer(config.maxRecordsPerYear, 1, 4) ||
      !integer(config.maxAliveSupporting, 1, 64) ||
      config.initialBirthYears.some(y => !integer(y, START_YEAR - 100, START_YEAR - 1)) ||
      new Set(config.initialBirthYears).size !== config.initialBirthYears.length ||
      config.groups.some(g => !g.groupId || !g.houseId) || new Set(config.groups.map(g => g.groupId)).size !== config.groups.length ||
      ![bg.adultSurvivalPermille, bg.annualAvailabilityPermille, bg.prohibitedPermille, bg.investigationCompletionPermille]
        .every(n => integer(n, 0, 1000)) ||
      !integer(bg.minimumAdultRemainingYears, 1, 100) || !integer(bg.maximumAdultRemainingYears, bg.minimumAdultRemainingYears, 100) ||
      !integer(bg.initialTrust, PAIR_TRUST_DEFINITION.min, PAIR_TRUST_DEFINITION.max) ||
      !integer(bg.initialTrustSpread, 0, Math.min(40, PAIR_TRUST_DEFINITION.max - bg.initialTrust))) {
    throw new RangeError('INVALID_ABSTRACT_MARRIAGE_SUPPLY')
  }
  // エンジン所有の不変スナップショット単位。キャッシュなしでも同じ入力を再導出できる。
  const memo = new WeakMap<NonNullable<EvaluationContext['supportingCandidateSnapshot']>,
    Readonly<{seed: number; supply: ReturnType<AnnualMarriageSupply>}>>()
  return ctx => {
    const snapshot = ctx.supportingCandidateSnapshot
    if (!snapshot || snapshot.branchId !== ctx.branchId || snapshot.year !== ctx.year || snapshot.world.year !== ctx.year) {
      throw new EvaluationFailure('抽象婚姻候補の年次スナップショットが不正', [{code: 'SUPPLY_SNAPSHOT_INVALID', message: String(ctx.year)}])
    }
    if (!Array.isArray(snapshot.world.demographics.anonymousBirthHistory)) {
      throw new EvaluationFailure('抽象婚姻候補には匿名出生履歴が必要です',
        [{code: 'ANONYMOUS_BIRTH_HISTORY_REQUIRED', message: String(ctx.year)}])
    }
    const cached = memo.get(snapshot)
    if (cached?.seed === ctx.seed) return cached.supply
    const data = deriveAbstractMarriageSupply(snapshot.world, ctx.seed, config, marriageMinAge)
    const factory = createB001SupportingMarriageEvaluator(data.input)
    if (!factory.ok) throw new EvaluationFailure('抽象婚姻候補の年次入力が不正',
      factory.issues.map(code => ({code, message: code})))
    const supply = freezeAnnualData({...data, evaluate: factory.evaluator})
    memo.set(snapshot, {seed: ctx.seed, supply})
    return supply
  }
}
