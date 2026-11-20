import { beforeAll, describe, expect, it } from 'vitest'
import {
  createMultiHouseEvaluators, createMultiHouseWorld, MULTI_HOUSE_AUTONOMY,
  MULTI_HOUSE_B009_CALIBRATION, MULTI_HOUSE_NEXTGEN_CONTRACT, MULTI_HOUSE_SEED,
  MULTI_HOUSE_SUPPORTING_COHORTS, MULTI_HOUSE_TRUST_BASE,
} from '../../../src/scenario/experimental/multi-house-playtest.ts'
import { createExperimentalOrdinaryLegalTrial } from '../../../src/scenario/experimental/ordinary-legal-trial.ts'
import { createAutonomousCalibrationEvaluators } from '../../../src/simulation/autonomy/index.ts'
import type { DecisionTrace, EventLogEntry, Person, WorldState } from '../../../src/simulation/contracts/index.ts'
import { runYear } from '../../../src/simulation/engine/index.ts'
import type { EvaluatorMap } from '../../../src/simulation/engine/index.ts'
import type { NextgenContractCalibration } from '../../../src/simulation/legal/nextgen-contract.ts'
import { reviewDomesticMarriageEligibility } from '../../../src/simulation/legal/nextgen-marriage.ts'
import { reviewOrdinaryAuthority } from '../../../src/simulation/legal/ordinary-authority.ts'
import type { SupportingKinshipClearance } from '../../../src/simulation/legal/supporting-kinship-clearance.ts'
import { supportingCandidateId } from '../../../src/simulation/population/supporting-marriage.ts'
import { EXPERIMENTAL_TUNING } from '../../../src/simulation/tuning.ts'

const branchId = 'multi-house-born-adult-calibration'
const scope = { seed: MULTI_HOUSE_SEED, branchId }
const ledger = [] as const
const countryId = 'country-eldia'
const trial = createExperimentalOrdinaryLegalTrial()
const withoutMarriageAuthority = { ...trial.book,
  approvalAuthorities: trial.book.approvalAuthorities.filter(a => a.action !== 'NORMAL_MARRIAGE'),
}
const pairOf = (a: string, b: string): readonly [string, string] => a < b ? [a, b] : [b, a]
const personPath = (id: string) => `$.persons[${id}]`

function year(world: WorldState, evaluators: EvaluatorMap, runScope = scope) {
  const r = runYear(world, { ...runScope, evaluators })
  if (r.status !== 'COMPLETED') throw new Error(JSON.stringify(r.halt))
  return r
}

function birthPersonId(event: EventLogEntry): string {
  const ref = event.involvedRefs.find(r => r.kind === 'PERSON')
  if (ref?.kind !== 'PERSON') throw new Error(`出生Eventに人物参照がありません: ${event.eventId}`)
  return ref.id
}

const findPair = (traces: readonly DecisionTrace[], rule: string, pair: readonly [string, string]) =>
  traces.find(t => t.ruleId === rule && t.actorRef.kind === 'PERSON_PAIR' &&
    t.actorRef.ids[0] === pair[0] && t.actorRef.ids[1] === pair[1])

const isActiveSpouse = (w: WorldState, id: string) =>
  w.legal.marriages.some(m => m.status === 'ACTIVE' && m.personIds.includes(id))

// 主試遊そのものは変更しない。独立台帳はこの縦断の対象ペアにだけ適用する。
// 候補選択、匿名出生の裏付け、成人生存、個別系譜調査、信頼、法的授権は別入力。
const testCohort = MULTI_HOUSE_SUPPORTING_COHORTS.find(c => c.cohortId === 'multi-house:c004:east:1265:male')!
const cohort = { ...testCohort, survivorAttestationId: 'fixture:born-adult:independent-survivor-roll' }
const other = MULTI_HOUSE_SUPPORTING_COHORTS.find(c => c.cohortId === 'multi-house:c004:east:1263:male')!
const otherId = supportingCandidateId(other.cohortId, 0)
let spouseId: string
let birthEvent: EventLogEntry
let originalDynasty: DecisionTrace | undefined
let populationTrace: DecisionTrace | undefined
let adult: WorldState
let underage: WorldState
let seeker: Person
let pair: readonly [string, string]
let clearance: SupportingKinshipClearance

beforeAll(() => {
  let world = createMultiHouseWorld()
  const evaluators = createMultiHouseEvaluators(world, ledger)
  const births: EventLogEntry[] = []
  const birthDynasties: DecisionTrace[] = []
  // 主seedの最初の適格成人。Goalや成人後の婚姻・出生結果は選定に使わない。
  while (world.year <= 1300) {
    const eligible = births.filter(e => e.year + 18 === world.year).map(event => ({
      event, person: world.persons.find(p => p.personId === birthPersonId(event)),
    })).filter(({ person }) => person?.alive && !isActiveSpouse(world, person.personId))
    expect(eligible.length).toBeLessThanOrEqual(1) // 同年同条件なら成功結果で選び直さない。
    if (eligible[0]?.person) {
      birthEvent = eligible[0].event
      seeker = eligible[0].person
      originalDynasty = birthDynasties.find(t => t.actorRef.kind === 'PERSON' && t.actorRef.id === seeker.personId)
      adult = world
      break
    }
    underage = world
    const r = year(world, evaluators)
    births.push(...r.events.filter(e => e.eventType === 'PERSON_BIRTH' &&
      r.traces.some(t => t.ruleId === 'B-002' && t.status === 'ACCEPT' && e.sourceTraceIds.includes(t.traceId))))
    birthDynasties.push(...r.traces.filter(t => t.ruleId === 'A-DYN-02'))
    if (r.year === cohort.birthYear) populationTrace = r.traces.find(t => t.ruleId === 'RULE-C-004' &&
      t.actorRef.kind === 'GROUP' && t.actorRef.id === cohort.groupId)
    world = r.world
  }
  expect(seeker?.personId).toBe('person:b002:auto:82d758741c11755d0003af3fccfd21fefc0f49a1f3d792c2ea9c761377bc2637')
  expect(birthEvent.eventId).toBe('event:1266:p3:B-002:cmd:b002:auto:74a84501a806da59cc8c3061effa94f96dc8441339954b2734c1548b1a930734')
  spouseId = supportingCandidateId(cohort.cohortId, 0)
  pair = pairOf(seeker.personId, spouseId)
  clearance = {
    clearanceId: 'fixture:born-adult:kinship-clearance',
    // この架空の調査は上で照合した実出生Eventの人物と、独立した名簿上の一人だけを対象とする。
    personIds: pair, countryId, checkedYear: 1284, validUntilYear: 1286,
    sourceEvidenceId: 'fixture:born-adult:independent-pedigree-investigation', provenance: 'CALIBRATION_ONLY',
  }
}, 60_000)

function calendar(start: WorldState, options: {
  clearances?: readonly SupportingKinshipClearance[]
  trust?: number | null
  contract?: NextgenContractCalibration
  birthChance?: number
  noBirthSlots?: boolean
  alternate?: 'COMPETE' | 'ONLY'
  missingSurvivor?: boolean
  marriageAuthority?: boolean
  runScope?: typeof scope
  selected?: boolean
} = {}) {
  const runScope = options.runScope ?? scope
  const inScope = runScope.branchId === scope.branchId && runScope.seed === scope.seed
  const { laws } = trial
  const book = options.marriageAuthority === false ? withoutMarriageAuthority : trial.book
  const otherPair = pairOf(seeker.personId, otherId)
  const competitors = options.alternate ? [otherPair] : []
  const primaryPairs = options.alternate === 'ONLY' ? [] : [pair]
  const cohorts = [...(options.alternate === 'ONLY' ? [] : [{ ...cohort,
    ...(options.missingSurvivor ? { survivorAttestationId: cohort.sourceEvidenceId } : {}) }]),
  ...(options.alternate ? [{ ...other, survivorAttestationId: 'fixture:born-adult:second-independent-survivor-roll' }] : [])]
  const trust = options.trust ?? 35
  const cfg = createAutonomousCalibrationEvaluators({
    branchStartWorld: start, ledger, trustBase: MULTI_HOUSE_TRUST_BASE,
    b009Calibration: MULTI_HOUSE_B009_CALIBRATION,
    autonomy: { ...MULTI_HOUSE_AUTONOMY, birth: { ...MULTI_HOUSE_AUTONOMY.birth,
      chancePermille: options.birthChance ?? MULTI_HOUSE_AUTONOMY.birth.chancePermille } },
    ...(options.noBirthSlots ? { tuning: { ...EXPERIMENTAL_TUNING,
      birthRatePermille: { ...EXPERIMENTAL_TUNING.birthRatePermille, value: 0 },
      growthRatePermille: { ...EXPERIMENTAL_TUNING.growthRatePermille, value: 0 } } } : {}),
    nextgenMarriage: { book, laws, calibration: options.contract ?? MULTI_HOUSE_NEXTGEN_CONTRACT,
      supportingKinshipClearances: inScope ? options.clearances ?? [clearance, ...competitors.map(personIds => ({
        ...clearance, personIds, clearanceId: 'fixture:born-adult:second-kinship-clearance',
        sourceEvidenceId: 'fixture:born-adult:second-independent-pedigree-investigation',
      }))] : [] },
    reviewedLegal: { book, ordinaryLaws: laws }, spouseDeathDissolution: true,
    supportingMarriage: { cohorts: inScope ? cohorts : [], maxRecordsPerYear: 1, maxAliveSupporting: 24,
      perCohortSamples: 1, maximumPreviewAge: 60, candidatePairs: inScope && options.selected !== false ? [...primaryPairs, ...competitors] : [] },
    supportingCandidateTrustBase: inScope && options.trust !== null ? [...primaryPairs, ...competitors].map(personIds => ({ personIds, value: trust })) : [],
  })
  if (!cfg.ok) throw new Error(cfg.issues.join('\n'))
  return cfg.evaluators
}

function birthOf(r: ReturnType<typeof year>, marriageId: string) {
  return r.traces.find(t => t.ruleId === 'B-002' && t.candidates[0]?.inputs.marriageId === marriageId)
}

function marriageOf(r: ReturnType<typeof year>) {
  const marriage = r.world.legal.marriages.find(m => m.personIds[0] === pair[0] && m.personIds[1] === pair[1])
  expect(marriage?.status).toBe('ACTIVE')
  if (!marriage?.contract) throw new Error('試験ペアの契約付き婚姻が成立しませんでした')
  return { ...marriage, contract: marriage.contract }
}

function verifyChild(r: ReturnType<typeof year>, marriage: ReturnType<typeof marriageOf>, explicit: boolean) {
  const trace = birthOf(r, marriage.marriageId)
  expect(trace?.status).toBe('ACCEPT')
  const birth = r.events.find(e => e.eventType === 'PERSON_BIRTH' && trace?.eventIds.includes(e.eventId))
  if (!birth || !trace) throw new Error('B-002出生EventまたはTraceなし')
  expect(birth.sourceTraceIds).toEqual([trace.traceId])
  expect(birth.stateChanges).toContainEqual({
    path: `$.demographics.cohortSlots[${seeker.originGroupId}@${r.year}].claimedBirths`, before: 0, after: 1,
  })
  expect(trace.candidates[0]?.inputs).toMatchObject({ fertilityChancePermille: 150, claimedBirths: 0 })
  expect(trace.candidates[0]?.inputs.birthSlots).toBeGreaterThanOrEqual(1)
  const id = birthPersonId(birth)
  const parents = seeker.sex === 'MALE' ? { fatherId: seeker.personId, motherId: spouseId }
    : { fatherId: spouseId, motherId: seeker.personId }
  expect(birth.stateChanges).toContainEqual({ path: personPath(id), before: null,
    after: expect.objectContaining({ personId: id, birthYear: r.year, ...parents, legalDynasty: { status: 'UNDETERMINED',
      reasonCodes: ['GAME_01_NO_DEFAULT_DYNASTY', 'A_DYN_02_PENDING'] } }) })
  const child = r.world.persons.find(p => p.personId === id)
  expect(child).toMatchObject(parents)
  const dynasty = r.traces.find(t => t.ruleId === 'A-DYN-02' && t.actorRef.kind === 'PERSON' && t.actorRef.id === id)
  const clause = marriage.contract.clauses.find(c => c.kind === 'CHILD_LEGAL_DYNASTY')
  expect(dynasty?.candidates[0]?.inputs).toMatchObject({ sourceB002TraceId: trace?.traceId,
    sourceBirthEventIds: [birth.eventId], marriageId: marriage.marriageId, contractId: marriage.contract.contractId,
    contractEvidenceId: marriage.contract.evidenceId, clauseId: clause?.clauseId ?? null })
  if (explicit) {
    expect(seeker.legalDynasty.status).toBe('DETERMINED')
    expect(clause?.dynastyId).toBe(seeker.legalDynasty.status === 'DETERMINED' ? seeker.legalDynasty.dynastyId : undefined)
    expect(dynasty?.status).toBe('ACCEPT')
    expect(child?.legalDynasty).toEqual({ status: 'DETERMINED', dynastyId: clause?.dynastyId })
    const events = r.events.filter(e => e.eventType === 'LEGAL_DYNASTY_SET' && dynasty?.eventIds.includes(e.eventId))
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ involvedRefs: [{ kind: 'PERSON', id }], sourceTraceIds: [dynasty?.traceId] })
    expect(events[0]?.stateChanges).toEqual(expect.arrayContaining([
      { path: `${personPath(id)}.legalDynasty.status`, before: 'UNDETERMINED', after: 'DETERMINED' },
      { path: `${personPath(id)}.legalDynasty.dynastyId`, before: null, after: clause?.dynastyId },
    ]))
  } else {
    expect(marriage.contract.clauses).toEqual([])
    expect(dynasty?.status).toBe('DEFER')
    expect(dynasty?.reasonCodes).toContain('GAME_01_DYNASTY_CLAUSE_MISSING')
    expect(dynasty?.eventIds).toEqual([])
    expect(child?.legalDynasty.status).toBe('UNDETERMINED')
  }
  return { trace, birth, child, dynasty }
}

const supplyFor = (r: ReturnType<typeof year>) => r.traces.find(t => t.ruleId === 'B-001' && t.status === 'ACCEPT' &&
  t.candidates[0]?.inputs.seekerPersonId === seeker.personId && t.candidates[0]?.inputs.supportingCandidateId === spouseId)
const registrationsOf = (r: ReturnType<typeof year>) => r.events.flatMap(e => e.supportingMarriageRegistrations ?? [])
const seekerEnteredSupply = (r: ReturnType<typeof year>) => r.traces.some(t => t.ruleId === 'B-001' &&
  t.candidates.some(c => c.inputs.seekerPersonId === seeker.personId))
const noRegistration = (r: ReturnType<typeof year>, candidateIds = [spouseId]) => {
  expect(registrationsOf(r)).toHaveLength(0)
  expect(r.events.some(e => e.eventType === 'PERSON_SUPPORTING_RECORD' || e.eventType === 'PERSON_PROMOTE')).toBe(false)
  expect(r.world.legal.marriages.some(m => m.personIds.some(id => candidateIds.includes(id)))).toBe(false)
  expect(r.world.persons.some(p => candidateIds.includes(p.personId))).toBe(false)
}

function verifyMarriage(r: ReturnType<typeof year>) {
  const supply = supplyFor(r)
  expect(supply?.eventIds).toEqual([])
  expect(supply?.candidates[0]?.inputs).toMatchObject({ candidateBranchId: branchId, candidateYear: adult.year,
    populationSource: 'C004_COHORT', sourceEvidenceId: cohort.sourceEvidenceId,
    survivorAttestationId: cohort.survivorAttestationId, kinshipStatus: 'UNVERIFIED' })
  expect(r.events.some(e => e.eventType === 'PERSON_SUPPORTING_RECORD' || e.eventType === 'PERSON_PROMOTE')).toBe(false)
  const b4 = findPair(r.traces, 'B-004', pair)
  expect(b4).toMatchObject({ status: 'ACCEPT', candidates: [{ score: 35,
    inputs: { trustSource: 'CALIBRATION_ONLY_CANDIDATE_BASE' } }] })
  const b5 = findPair(r.traces, 'B-005', pair)
  expect(b5?.status).toBe('ACCEPT')
  expect(b5?.reasonCodes).toContain('BOTH_PARTIES_ACCEPT_UNIQUE_CONTRACT')
  expect(b5?.candidates[0]?.inputs).toMatchObject({ sourceB004TraceId: b4?.traceId,
    sourceRequestId: expect.any(String), selectionEvidence: 'RECORDED_B004_MUTUAL_UNIQUE_TOP',
    supportingKinshipClearanceId: clearance.clearanceId })
  const legal = findPair(r.traces, 'A-LEG-01', pair)
  expect(legal?.status).toBe('ACCEPT')
  const marriage = marriageOf(r)
  const [registration] = registrationsOf(r)
  expect(registrationsOf(r)).toHaveLength(1)
  expect(registration).toMatchObject({ commandId: expect.any(String), marriageId: marriage.marriageId,
    sourceTraceId: legal?.traceId, requestId: b5?.candidates[0]?.inputs.sourceRequestId,
    registration: { cohortId: cohort.cohortId, birthBacking: 'C004_COHORT', memberOrdinal: 0,
      sourceEvidenceId: cohort.sourceEvidenceId, survivorAttestationId: cohort.survivorAttestationId,
      person: { personId: spouseId, interactionRole: 'SUPPORTING', legalDynasty: { status: 'UNDETERMINED' },
        birthYear: cohort.birthYear, sex: cohort.sex, originGroupId: cohort.groupId, houseId: cohort.affiliationHouseId, alive: true } } })
  for (const field of ['fatherId', 'motherId', 'bloodlineDynastyId']) expect(registration!.registration.person).not.toHaveProperty(field)
  expect(marriage.registeredYear).toBe(1284)
  const event = r.events.find(e => e.eventType === 'MARRIAGE_REGISTER' && e.supportingMarriageRegistrations?.length)
  expect(event?.eventId).toContain(registration!.commandId)
  expect(event?.sourceTraceIds).toEqual([legal?.traceId])
  expect(legal?.eventIds).toEqual([event?.eventId])
  expect(legal?.reasonCodes).toContain('DOMESTIC_MARRIAGE_AUTHORITY_AND_CONSENT_VERIFIED')
  expect(legal?.candidates[0]?.inputs).toMatchObject({ contractId: marriage.contract.contractId,
    sourceRequestId: registration!.requestId, lawId: expect.any(String), reviewId: expect.any(String) })
  expect(marriage.contract.evidenceId).toBe(`evidence:nextgen-agreement:${b5?.traceId}`)
  expect(event?.stateChanges).toContainEqual({ path: personPath(spouseId), before: null, after: registration!.registration.person })
  expect(event?.stateChanges).toContainEqual({ path: `$.legal.marriages[${marriage.marriageId}]`, before: null, after: marriage })
  expect(event?.stateChanges.some(s => s.path === personPath(seeker.personId))).toBe(false)
  expect(r.world.persons.filter(p => p.personId === seeker.personId)).toEqual([seeker])
  expect(r.world.persons.filter(p => !adult.persons.some(old => old.personId === p.personId)).map(p => p.personId)).toEqual([spouseId])
  return { supply, b4, b5, legal, marriage, registration, event }
}

describe('担当B 3B: 実B-002出生者の成人婚姻と次世代', () => {
  it('実年次履歴の1266年出生を1284年初の生存・未婚・管轄・親子へつなぐ', () => {
    expect(adult.year).toBe(1284)
    expect(seeker).toMatchObject({ personId: birthPersonId(birthEvent), birthYear: 1266, alive: true,
      sex: 'FEMALE', fatherId: 'person-exp-02', motherId: supportingCandidateId('multi-house:initial:west:1232:female', 0),
      houseId: 'house-vargas', originGroupId: 'group-west-elite', legalDynasty: { status: 'DETERMINED', dynastyId: 'dynasty-nalven' } })
    expect(birthEvent.stateChanges).toContainEqual({ path: personPath(seeker.personId), before: null,
      after: expect.objectContaining({ personId: seeker.personId, fatherId: seeker.fatherId, motherId: seeker.motherId }) })
    expect(adult.persons.filter(p => p.personId === seeker.fatherId || p.personId === seeker.motherId)).toHaveLength(2)
    expect(isActiveSpouse(adult, seeker.personId)).toBe(false)
    expect(adult.persons.some(p => p.personId === spouseId)).toBe(false)
    for (const groupId of [seeker.originGroupId, cohort.groupId]) {
      const group = adult.groups.find(g => g.groupId === groupId)
      expect(adult.regions.find(r => r.regionId === group?.regionId)?.sovereignCountryId).toBe(countryId)
    }
    for (const houseId of [seeker.houseId, cohort.affiliationHouseId]) {
      expect(adult.houses.find(h => h.houseId === houseId)?.countryId).toBe(countryId)
    }
    expect(originalDynasty).toMatchObject({ status: 'ACCEPT', candidates: [{ inputs: {
      sourceBirthEventIds: [birthEvent.eventId], dynastyId: 'dynasty-nalven', clauseId: expect.any(String),
    } }] })
    expect(populationTrace).toMatchObject({ year: 1265, status: 'ACCEPT', candidates: [{ inputs: { birthSlots: 46 } }] })
    expect(populationTrace?.eventIds).toHaveLength(1)
    expect(adult.demographics.anonymousBirthHistory?.find(h => h.year === cohort.birthYear && h.groupId === cohort.groupId)
      ?.anonymousBirths).toBe(46)
    const existing = year(adult, createMultiHouseEvaluators(adult, ledger))
    expect(existing.traces.find(t => t.ruleId === 'B-001' && t.actorRef.kind === 'PERSON' && t.actorRef.id === seeker.personId)
      ?.reasonCodes).toContain('NO_COHORT_CANDIDATE_AVAILABLE')
    const fatherPair = pairOf(seeker.personId, seeker.fatherId!)
    expect(reviewDomesticMarriageEligibility(adult, fatherPair)).toEqual({ status: 'REJECT', reasonCode: 'DIRECT_ANCESTOR_KINSHIP' })
    expect(findPair(existing.traces, 'B-004', fatherPair)?.status).toBe('DEFER')
    expect(findPair(existing.traces, 'B-005', fatherPair)?.reasonCodes).toContain('B004_NOT_ACCEPTED')
    noRegistration(existing)
  })

  it('通常の確率で婚姻後の出生を観測し、明示条項と出生枠を照合する', () => {
    const evaluators = calendar(adult)
    const r = year(adult, evaluators)
    const { marriage, event, registration, supply, b4, b5, legal } = verifyMarriage(r)
    expect(year(adult, calendar(adult))).toEqual(r)
    expect(birthOf(r, marriage.marriageId)).toBeUndefined()
    const withoutSupply = year(adult, calendar(adult, { selected: false }))
    noRegistration(withoutSupply)
    expect(r.world.groups).toEqual(withoutSupply.world.groups)
    expect(r.world.demographics).toEqual(withoutSupply.world.demographics)
    const born = year(r.world, evaluators)
    expect(born.year).toBe(1285)
    expect(registrationsOf(born)).toHaveLength(0)
    expect(supplyFor(born)).toBeUndefined()
    expect(born.world.persons.filter(p => p.personId === spouseId)).toHaveLength(1)
    const child = verifyChild(born, marriage, true)
    const anonymousOnly = year(r.world, calendar(adult, { birthChance: 0 }))
    const rejected = birthOf(anonymousOnly, marriage.marriageId)
    expect(rejected?.reasonCodes).toContain('BIRTH_RNG_NOT_SELECTED')
    expect(rejected?.random).toEqual(child.trace?.random)
    expect(rejected?.eventIds).toEqual([])
    expect(born.world.groups).toEqual(anonymousOnly.world.groups)
    const slot = (w: WorldState) => (w.demographics.anonymousBirthHistory ?? [])
      .find(h => h.year === born.year && h.groupId === seeker.originGroupId)?.anonymousBirths
    expect(slot(born.world)).toBe(slot(anonymousOnly.world)! - 1)
    expect(year(r.world, calendar(adult))).toEqual(born)
    console.info('MULTI_HOUSE_BORN_ADULT_CALIBRATION', JSON.stringify({ ...scope, adultYear: adult.year, birthEvent: birthEvent.eventId,
      seekerId: seeker.personId, spouseId, supply: supply?.traceId, b4: b4?.traceId, b5: b5?.traceId, legal: legal?.traceId,
      marriageEvent: event?.eventId, command: registration?.commandId, request: registration?.requestId, marriage,
      childId: child.child?.personId, birth: child.birth.eventId, birthTrace: child.trace?.traceId,
      dynasty: child.dynasty?.traceId, dynastyEvents: child.dynasty?.eventIds, draw: child.trace?.random?.value }))
  })

  it('無条項に双方が合意した別の校正ケースでは出生しても王朝は未確定', () => {
    const evaluators = calendar(adult, { contract: { ...MULTI_HOUSE_NEXTGEN_CONTRACT, noClauseCost: -30 } })
    const r = year(adult, evaluators)
    const marriage = marriageOf(r)
    expect(findPair(r.traces, 'B-005', pair)?.candidates[0]?.inputs).toMatchObject({ selectedContractKey: 'NO_CLAUSE',
      contractOptions: expect.arrayContaining([{ key: 'NO_CLAUSE', dynastyId: null, mutuallyAccepted: true,
        firstConsentScore: 65, secondConsentScore: 65, minimumUtility: 65 }]) })
    verifyChild(year(r.world, evaluators), marriage, false)
  })

  it('年少・死亡・既婚では探索に入り直さず、重複登録しない', () => {
    expect(underage.year - seeker.birthYear).toBe(17)
    const dead = { ...adult, persons: adult.persons.map(p => p.personId === seeker.personId
      ? { ...p, alive: false, deathYear: adult.year - 1 } : p) }
    for (const start of [underage, dead]) {
      const r = year(start, calendar(start))
      expect(seekerEnteredSupply(r)).toBe(false)
      noRegistration(r)
    }
    const evaluators = calendar(adult)
    const married = year(adult, evaluators)
    const r = year(married.world, evaluators)
    expect(seekerEnteredSupply(r)).toBe(false)
    expect(registrationsOf(r)).toHaveLength(0)
    expect(r.world.persons.filter(p => p.personId === spouseId)).toHaveLength(1)
    expect(r.world.legal.marriages.filter(m => m.personIds.includes(spouseId))).toEqual([marriageOf(married)])
    const unmarried = year(adult, calendar(adult, { selected: false })).world
    const alternate = calendar(adult, { alternate: 'ONLY' })
    const otherPair = pairOf(seeker.personId, otherId)
    expect(findPair(year(unmarried, alternate).traces, 'A-LEG-01', otherPair)?.status).toBe('ACCEPT')
    const blocked = year(married.world, alternate)
    expect(seekerEnteredSupply(blocked)).toBe(false)
    expect(findPair(blocked.traces, 'B-004', otherPair)).toBeUndefined()
    noRegistration(blocked, [otherId])
  })

  it('信頼・禁親の欠落、禁親の他ペア・他管轄流用、片方だけの契約拒否では永続化しない', () => {
    const control = year(adult, calendar(adult))
    expect(supplyFor(control)?.status).toBe('ACCEPT')
    const cases = [
      { options: { trust: null }, rule: 'B-004', reason: 'NO_BASE_TRUST' },
      { options: { clearances: [] }, rule: 'B-005', reason: 'SUPPORTING_KINSHIP_CLEARANCE_MISSING' },
      { options: { clearances: [{ ...clearance, personIds: pairOf(seeker.fatherId!, spouseId) }] }, rule: 'B-005', reason: 'SUPPORTING_KINSHIP_CLEARANCE_MISSING' },
      { options: { clearances: [{ ...clearance, countryId: 'country-outside-test' }] }, rule: 'B-005', reason: 'SUPPORTING_KINSHIP_CLEARANCE_MISSING' },
      { options: { contract: { ...MULTI_HOUSE_NEXTGEN_CONTRACT, titleWeight: 0, consentThreshold: 36 } }, rule: 'B-005', reason: 'NO_BILATERAL_CONSENT' },
    ]
    for (const { options, rule, reason } of cases) {
      const r = year(adult, calendar(adult, options))
      expect(supplyFor(r)?.eventIds).toEqual([])
      const trace = findPair(r.traces, rule, pair)
      expect(trace?.reasonCodes).toContain(reason)
      if (options.contract) expect(trace?.candidates[0]?.inputs.contractOptions).toEqual(expect.arrayContaining([
        { key: 'CHILD_DYNASTY:dynasty-nalven', dynastyId: 'dynasty-nalven', mutuallyAccepted: false,
          firstConsentScore: 37, secondConsentScore: 35, minimumUtility: 35 },
      ]))
      expect(findPair(r.traces, 'A-LEG-01', pair)).toBeUndefined()
      noRegistration(r)
    }
  })

  it('人口出典・生存名簿の欠落や、当事者の管轄不一致では供給しない', () => {
    const withoutBacking = { ...adult, demographics: { ...adult.demographics,
      anonymousBirthHistory: adult.demographics.anonymousBirthHistory!.filter(h => h.groupId !== cohort.groupId || h.year !== cohort.birthYear) } }
    const foreignJurisdiction = { ...adult, persons: adult.persons.map(p => p.personId === seeker.personId
      ? { ...p, houseId: 'house-margald-royal' } : p) }
    const variants = [
      { result: year(adult, calendar(adult, { missingSurvivor: true })), reason: 'C004_SURVIVOR_ATTESTATION_MISSING:0' },
      { result: year(withoutBacking, calendar(withoutBacking)), reason: 'C004_BIRTH_BACKING_INSUFFICIENT:0' },
      { result: year(foreignJurisdiction, calendar(foreignJurisdiction)), reason: 'NO_COHORT_CANDIDATE_AVAILABLE' },
    ]
    for (const { result, reason } of variants) {
      expect(result.traces.find(t => t.ruleId === 'B-001' && t.actorRef.kind === 'PERSON' && t.actorRef.id === seeker.personId)
        ?.reasonCodes).toContain(reason)
      expect(findPair(result.traces, 'B-004', pair)).toBeUndefined()
      noRegistration(result)
    }
  })

  it('法令があっても独立授権がない場合や、双方の首位競合では登録しない', () => {
    const unauthorized = year(adult, calendar(adult, { marriageAuthority: false }))
    expect(findPair(unauthorized.traces, 'B-005', pair)?.status).toBe('ACCEPT')
    const response = findPair(unauthorized.traces, 'A-LEG-01', pair)
    expect(response?.status).toBe('DEFER')
    expect(response?.reasonCodes).toContain('PERSON_UNAVAILABLE') // Aが授権なしで候補ビューを登録審査へ渡さない。
    expect(reviewOrdinaryAuthority(adult, withoutMarriageAuthority, trial.laws, {
      action: 'NORMAL_MARRIAGE', sovereignCountryId: countryId, issuerRef: { kind: 'COUNTRY', id: countryId }, year: adult.year,
    })).toMatchObject({ status: 'PENDING', reasonCodes: ['AUTHORITY_RECORD_MISSING'] })
    noRegistration(unauthorized)
    const tied = year(adult, calendar(adult, { alternate: 'COMPETE' }))
    const competitors = tied.traces.filter(t => t.ruleId === 'B-005' && t.actorRef.kind === 'PERSON_PAIR' &&
      t.actorRef.ids.includes(seeker.personId) && t.actorRef.ids.some(id => id.startsWith('support:population:')))
    expect(competitors).toHaveLength(2)
    for (const t of competitors) {
      expect(t.status).toBe('DEFER')
      expect(t.reasonCodes).toContain('MUTUAL_UNIQUE_PARTNER_NOT_ESTABLISHED')
    }
    noRegistration(tied, [spouseId, otherId])
  })

  it('CALIBRATION_ONLYの台帳は別枝・別seedへ配布せず、別seedで元の出生IDを仮定しない', () => {
    const foreignBranch = { ...scope, branchId: 'multi-house-different-branch' }
    const unscoped = year(adult, calendar(adult, { runScope: foreignBranch }), foreignBranch)
    expect(supplyFor(unscoped)).toBeUndefined()
    noRegistration(unscoped)
    const foreignSeed = { ...scope, seed: 20260202 }
    let otherWorld = createMultiHouseWorld()
    const evaluators = createMultiHouseEvaluators(otherWorld, ledger)
    const otherBirths = new Set<string>()
    while (otherWorld.year < adult.year) {
      const r = year(otherWorld, evaluators, foreignSeed)
      for (const e of r.events.filter(e => e.eventType === 'PERSON_BIRTH')) otherBirths.add(birthPersonId(e))
      otherWorld = r.world
    }
    expect(otherBirths.size).toBeGreaterThan(0)
    expect(otherBirths.has(seeker.personId)).toBe(false)
    expect(otherWorld.persons.some(p => p.personId === seeker.personId)).toBe(false)
    const r = year(otherWorld, calendar(otherWorld, { runScope: foreignSeed }), foreignSeed)
    expect(supplyFor(r)).toBeUndefined()
    noRegistration(r)
  }, 60_000)

  it('同じ評価器で自枝の候補供給は成立するが、別枝B-001候補Traceへの差し替えは拒む', () => {
    const foreignBranch = { ...scope, branchId: 'multi-house-different-branch' }
    // 証拠台帳を別枝へ配布しない上の試験とは別に、同じ台帳を持つ評価器でTraceの枝照合を試す。
    const evaluators = calendar(adult)
    const control = year(adult, evaluators, foreignBranch)
    expect(supplyFor(control)?.candidates[0]?.inputs.candidateBranchId).toBe(foreignBranch.branchId)
    expect(findPair(control.traces, 'A-LEG-01', pair)?.status).toBe('ACCEPT')
    const supply = supplyFor(year(adult, evaluators))!
    const original = evaluators['B-001']!
    const replayed = year(adult, { ...evaluators, 'B-001': (world, ctx) => {
      const out = original(world, ctx)
      return { ...out, traceDrafts: [...out.traceDrafts.filter(t => t.status !== 'ACCEPT'), supply] }
    } }, foreignBranch)
    expect(findPair(replayed.traces, 'B-004', pair)).toBeUndefined()
    noRegistration(replayed)
  })

  it('C004枠がゼロなら、実婚姻後も出生枠を超過しない', () => {
    const evaluators = calendar(adult)
    const married = year(adult, evaluators)
    const marriage = marriageOf(married)
    const full = year(married.world, calendar(adult, { noBirthSlots: true, birthChance: 999 }))
    const trace = birthOf(full, marriage.marriageId)
    expect(trace?.status).toBe('DEFER')
    expect(trace?.reasonCodes).toContain('BIRTH_COHORT_SLOT_EXHAUSTED')
    expect(trace?.candidates[0]?.inputs).toMatchObject({ birthSlots: 0, claimedBirths: 0 })
    expect(trace?.eventIds).toEqual([])
    expect(full.events.some(e => e.eventType === 'PERSON_BIRTH')).toBe(false)
  })
})
