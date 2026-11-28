import { describe, expect, it } from 'vitest'
import {
  createExperimentalOrdinaryLegalTrial, createExperimentalWorld, createMultiHouseChildHouseEvaluators,
  createMultiHouseDemandWorld, createMultiHouseLineageEvaluators, multiHouseChildHouseRunConfigDigest,
  multiHouseLineageRunConfigDigest, multiHouseLineageRunConfigIdentity, NALVEN_DYNASTY_ID,
} from '../../../src/scenario/experimental/index.ts'
import { createAutonomousCalibrationEvaluators } from '../../../src/simulation/autonomy/index.ts'
import type { Id, JsonValue, Person, WorldState } from '../../../src/simulation/contracts/index.ts'
import { runYear } from '../../../src/simulation/engine/index.ts'
import type { EvaluatorMap } from '../../../src/simulation/engine/index.ts'
import { lineageContinuity } from '../../../src/simulation/legal/lineage-continuity.ts'
import { EXPERIMENTAL_NEXTGEN_CONTRACT, NEXTGEN_LINEAGE_CONTINUITY_VERSION, validateNextgenContractCalibration }
  from '../../../src/simulation/legal/nextgen-contract.ts'
import type { NextgenContractCalibration } from '../../../src/simulation/legal/nextgen-contract.ts'

const P1 = 'person-exp-01', P2 = 'person-exp-02', P4 = 'person-exp-04', P5 = 'person-exp-05'
const NALVEN = 'house-nalven', CARDON = 'house-cardon', DYNASTY_CARDON = 'dynasty-cardon'
const trial = createExperimentalOrdinaryLegalTrial()
const motivation = multiHouseLineageRunConfigIdentity().nextgenContract.lineageContinuity!
// テストだけのv4基礎効用。同じB004基礎信頼40（当年実スコア41）で、母側の同意が基盤不足の有無によって変わる境界を使う。
const base: NextgenContractCalibration = {
  ...EXPERIMENTAL_NEXTGEN_CONTRACT, consentThreshold: 36, titleWeight: 0, supportWeight: 0,
  ownDynastyBonus: 2, otherDynastyCost: 15, noClauseCost: 15,
  childHouse: { status: 'CALIBRATION_ONLY', version: 'test-dec197', ownHouseBonus: 3, otherHouseCost: 0,
    titleWeight: 0, supportWeight: 0, exceptionCost: 0 },
}
const calibration = { ...base, lineageContinuity: motivation }
const zero = { ...base, lineageContinuity: { ...motivation, marriageBonus: 0, affiliationBonus: 0 } }
const world = createExperimentalWorld()
const party = (id: Id, w = world) => w.persons.find(p => p.personId === id)!
const descendant = (overrides: Partial<Person> = {}): Person => ({
  personId: 'recorded-child', name: '記録済み子孫', sex: 'FEMALE', birthYear: 1248, alive: true,
  originGroupId: 'group-east-elite', houseId: CARDON, motherId: P5,
  legalDynasty: { status: 'DETERMINED', dynastyId: DYNASTY_CARDON }, ...overrides,
})
const withPeople = (...records: Person[]): WorldState => ({ ...world, persons: [...world.persons, ...records] })
const evaluators = (w: WorldState, cal: NextgenContractCalibration, pair: readonly [Id, Id], book = trial.book) => {
  const result = createAutonomousCalibrationEvaluators({
    branchStartWorld: w, ledger: [], trustBase: [{ personIds: pair, value: 40 }],
    nextgenMarriage: { book, laws: trial.laws, calibration: cal }, childHouseAffiliation: 'DEC190_PATERNAL_PRINCIPLE',
    autonomy: {
      status: 'CALIBRATION_ONLY', birth: { minMotherAge: 18, maxMotherAge: 32, minFatherAge: 18, chancePermille: 1000 },
      death: { minAge: 60, riskStartAge: 59, basePermille: 0, increasePerYearPermille: 1000, maxPermille: 1000 },
      marriage: { minAdultAge: 18, maxCandidatePairs: 500 },
    },
  })
  if (!result.ok) throw new Error(result.issues.join('; '))
  return result.evaluators
}
const pair = [P2, P5] as const
function step(w: WorldState, cal = calibration, ids: readonly [Id, Id] = pair, ev: EvaluatorMap = evaluators(w, cal, ids)) {
  const r = runYear(w, { seed: 20260101, branchId: 'A0', evaluators: ev })
  if (r.status !== 'COMPLETED') throw new Error(JSON.stringify(r.halt))
  return r
}
function trace(r: ReturnType<typeof step>, rule: string, ids: readonly [Id, Id] = pair) {
  const found = r.traces.find(t => t.ruleId === rule && t.actorRef.kind === 'PERSON_PAIR' &&
    t.actorRef.ids[0] === ids[0] && t.actorRef.ids[1] === ids[1])
  if (!found) throw new Error(`missing ${rule} ${ids.join('/')}`)
  return found
}
const inputs = (r: ReturnType<typeof step>, ids = pair as readonly [Id, Id]) => trace(r, 'B-005', ids).candidates[0]!.inputs
// Traceは既存の7キー登録証拠と、案ごとの動機内訳を分離。表示用にキーで照合する。
function optionsWithUtility(r: ReturnType<typeof step>, ids = pair as readonly [Id, Id]) {
  const i = inputs(r, ids)
  const options = i.contractOptions as Record<string, JsonValue>[]
  const utilities = i.continuityUtilities as {key: string; utility: JsonValue}[]
  expect(utilities.map(u=>u.key)).toEqual(options.map(o=>o.key))
  return options.map((o, n)=>{
    expect(Object.keys(o).sort()).toEqual(['childHouse','dynastyId','firstConsentScore','key','minimumUtility','mutuallyAccepted','secondConsentScore'])
    return {...o, continuityUtility: utilities[n]!.utility}
  })
}
const eventsOf = (r: ReturnType<typeof step>, type: string) => r.events.filter(e => e.eventType === type)
const foreignDynasty = { status: 'DETERMINED', dynastyId: NALVEN_DYNASTY_ID } as const
const unknownDynasty = { status: 'UNDETERMINED', reasonCodes: ['TEST_UNDETERMINED'] } as const
const noRegistration = (r: ReturnType<typeof step>, cal = calibration, ids: readonly [Id, Id] = pair) => {
  expect(r.world.legal.marriages).toEqual([])
  expect(eventsOf(r, 'MARRIAGE_REGISTER')).toEqual([])
  expect(eventsOf(step(r.world, cal, ids), 'PERSON_BIRTH')).toEqual([])
}

describe('DEC-197: ordinary runYear negotiation, registration and birth', () => {
  it('turns maternal affiliation into a viable compromise without changing the dynasty clause, legal path or B004', () => {
    const off = step(world, zero), on = step(world)
    expect(trace(off, 'B-004')).toEqual(trace(on, 'B-004'))
    expect(inputs(off).partnerHouseInterests).toEqual(inputs(on).partnerHouseInterests)
    expect(trace(off, 'B-005').reasonCodes).toContain('NO_BILATERAL_CONSENT')
    noRegistration(off, zero)
    const negotiation = trace(on, 'B-005')
    expect(negotiation).toMatchObject({ status: 'ACCEPT', ruleVersion: NEXTGEN_LINEAGE_CONTINUITY_VERSION })
    expect(inputs(on).continuityEvidence).toMatchObject({ calibration: motivation, consentThreshold: 36, parties: [
      { personId: P2, eligibility: 'NO_ACTIVE_HEREDITARY_TITLE', house: null, dynasty: null },
      { personId: P5, eligibility: 'ELIGIBLE', house: { status: 'RECORDED_SHORTFALL' }, dynasty: { status: 'RECORDED_SHORTFALL' } },
    ] })
    const identity = { dynastyId: NALVEN_DYNASTY_ID, childHouse: { basis: 'MATERNAL_CONTRACT_CLAUSE', houseId: CARDON, sourcePersonId: P5 } }
    expect(inputs(on).selectedContractIdentity).toEqual(identity)
    expect(optionsWithUtility(on)).toContainEqual(expect.objectContaining({
      ...identity, firstConsentScore: 40, secondConsentScore: 47, mutuallyAccepted: true, continuityUtility: [
        expect.objectContaining({ baseUtility: 40, marriageBonus: 0, affiliationBonus: 0, consents: true }),
        { baseUtility: 29, marriageBonus: 6, affiliationBonus: 12, preservesShortfallHouse: true, preservesShortfallDynasty: false, consents: true },
      ],
    }))
    expect(on.world.legal.marriages[0]?.contract?.selection).toMatchObject({ identity,
      agreement: { personIds: pair, sourceTraceId: negotiation.traceId, firstConsentScore: 40, secondConsentScore: 47, consentThreshold: 36 } })
    expect(eventsOf(on, 'MARRIAGE_REGISTER')).toHaveLength(1)
    const born = step(on.world)
    expect(eventsOf(born, 'PERSON_BIRTH')).toHaveLength(1)
    expect(born.world.persons.find(p => p.fatherId === P2 && p.motherId === P5)).toMatchObject({
      houseId: CARDON, originGroupId: 'group-east-elite', legalDynasty: foreignDynasty,
    })
  })

  it.each([
    ['both fulfilled', descendant(), 'SATISFIED', 'SATISFIED', 'DEFER'],
    ['dynasty short only', descendant({ legalDynasty: foreignDynasty }), 'SATISFIED', 'RECORDED_SHORTFALL', 'DEFER'],
    ['house short only', descendant({ houseId: NALVEN }), 'RECORDED_SHORTFALL', 'SATISFIED', 'ACCEPT'],
    ['uncertain descendant dynasty', descendant({ legalDynasty: unknownDynasty }), 'SATISFIED', 'UNKNOWN', 'DEFER'],
    ['contradictory parent role', descendant({ motherId: undefined, fatherId: P5 } as unknown as Partial<Person>), 'UNKNOWN', 'UNKNOWN', 'DEFER'],
  ] as const)('records separate axes: %s', (_name, child, house, dynasty, status) => {
    // Omit the optional property rather than storing an undefined value in a WorldState.
    const { motherId, ...record } = child
    const r = step(withPeople({ ...record, ...(motherId === undefined ? {} : { motherId }) }))
    expect(trace(r, 'B-004').status).toBe('ACCEPT')
    expect(inputs(r).continuityEvidence).toMatchObject({ parties: [expect.anything(), {
      house: { status: house }, dynasty: { status: dynasty }, records: [{ personId: child.personId }],
    }] })
    expect(trace(r, 'B-005').status).toBe(status)
    if (status === 'DEFER') {
      expect(trace(r, 'B-005').reasonCodes).toContain('NO_BILATERAL_CONSENT')
      noRegistration(r)
    } else expect(r.world.legal.marriages[0]?.contract?.selection?.identity.childHouse.houseId).toBe(CARDON)
  })

  it('competing eligible holders have independent utilities; neither accepts the other’s favored affiliation', () => {
    const ids = [P4, P5] as const
    const cal = { ...calibration, consentThreshold: 48 }
    const r = step(world, cal, ids)
    expect(trace(r, 'B-005', ids).reasonCodes).toContain('NO_BILATERAL_CONSENT')
    const options = optionsWithUtility(r, ids)
    expect(options).toEqual(expect.arrayContaining([
      expect.objectContaining({ dynastyId: 'dynasty-vargas', childHouse: { basis: 'PATERNAL_DEFAULT', houseId: 'house-vargas' },
        continuityUtility: [expect.objectContaining({ affiliationBonus: 12, preservesShortfallHouse: true,
          preservesShortfallDynasty: true, consents: true }), expect.objectContaining({ consents: false })] }),
      expect.objectContaining({ dynastyId: DYNASTY_CARDON, childHouse: { basis: 'MATERNAL_CONTRACT_CLAUSE', houseId: CARDON, sourcePersonId: P5 },
        continuityUtility: [expect.objectContaining({ consents: false }), expect.objectContaining({ affiliationBonus: 12,
          preservesShortfallHouse: true, preservesShortfallDynasty: true, consents: true })] }),
    ]))
    noRegistration(r, cal, ids)
  })

  it('allows a split affiliation compromise between two holders at the lower threshold', () => {
    const ids = [P4, P5] as const
    const r = step(world, { ...calibration, consentThreshold: 47 }, ids)
    expect(trace(r, 'B-005', ids).status).toBe('ACCEPT')
    expect(inputs(r, ids).selectedContractIdentity).toEqual({dynastyId:'dynasty-vargas',
      childHouse:{basis:'MATERNAL_CONTRACT_CLAUSE',houseId:CARDON,sourcePersonId:P5}})
    expect(r.world.legal.marriages).toHaveLength(1)
    expect(eventsOf(r, 'MARRIAGE_REGISTER')).toHaveLength(1)
  })

  it('does not settle a tie between two bilaterally accepted contracts', () => {
    const cal = { ...calibration, otherDynastyCost: 4, childHouse: { ...base.childHouse!, ownHouseBonus: 0 } }
    const r = step(world, cal)
    expect(trace(r, 'B-005').reasonCodes).toContain('CONTRACT_CHOICE_TIE')
    noRegistration(r, cal)
  })

  it.each(['missing-basis', 'missing-utility', 'altered-utility', 'old-version'] as const)(
    'rejects altered continuity trace (%s) before registration', kind => {
      const ev = evaluators(world, calibration, pair)
      const b005 = ev['B-005']!
      const changed: EvaluatorMap = {...ev, 'B-005': (w, ctx)=>{
        const result = b005(w, ctx)
        return {...result, traceDrafts:result.traceDrafts.map(d=>{
          if(d.status!=='ACCEPT')return d
          return {...d, ...(kind==='old-version'?{ruleVersion:'b005-bilateral-family-contract-5-dec190-contract-identity:CALIBRATION_ONLY'}:{}),
            candidates:d.candidates.map(c=>{
              const i={...c.inputs}
              if(kind==='missing-basis')delete i.continuityEvidence
              if(kind==='missing-utility')delete i.continuityUtilities
              if(kind==='altered-utility')i.continuityUtilities=[]
              return {...c, inputs:i}
            })}
        })}
      }}
      const r = step(world, calibration, pair, changed)
      expect(trace(r,'B-005').status).toBe('ACCEPT')
      expect(r.traces.some(t=>t.ruleId==='A-LEG-01'&&t.reasonCodes.includes('LINEAGE_CONTINUITY_EVIDENCE_MISMATCH'))).toBe(true)
      noRegistration(r)
    })

  it('requires real authority and A’s exact continuity evidence even when all proposed scores agree', () => {
    const unauthorized = step(world, calibration, pair, evaluators(world, calibration, pair, { ...trial.book, approvalAuthorities: [] }))
    expect(trace(unauthorized, 'B-005').status).toBe('ACCEPT')
    noRegistration(unauthorized)
    const differentVersion = { ...calibration, lineageContinuity: { ...motivation, version: 'test-other-version' } }
    const ev = { ...evaluators(world, differentVersion, pair), 'B-005': evaluators(world, calibration, pair)['B-005']! }
    const mismatch = step(world, calibration, pair, ev)
    expect(trace(mismatch, 'B-005').status).toBe('ACCEPT')
    expect(mismatch.traces.some(t => t.ruleId === 'A-LEG-01' && t.reasonCodes.includes('LINEAGE_CONTINUITY_EVIDENCE_MISMATCH'))).toBe(true)
    noRegistration(mismatch)
  })
})

describe('DEC-197: recorded basis and calibration boundaries', () => {
  it('deduplicates a multi-title holder’s bonus, without changing existing title-related base utility', () => {
    const w = { ...world, persons: world.persons.map(p => p.fatherId === P1 ? { ...p, houseId: CARDON,
      legalDynasty: { status: 'DETERMINED', dynastyId: DYNASTY_CARDON } as const } : p) }
    const ids = [P1, P5] as const
    const r = step(w, calibration, ids)
    expect(inputs(r, ids).continuityEvidence).toMatchObject({ parties: [
      { titleIds: ['title-exp-central', 'title-exp-crown-eldia'], house: { status: 'RECORDED_SHORTFALL' }, dynasty: { status: 'RECORDED_SHORTFALL' } }, expect.anything(),
    ] })
    expect(optionsWithUtility(r, ids)).toContainEqual(expect.objectContaining({ dynastyId: NALVEN_DYNASTY_ID,
      childHouse: { basis: 'PATERNAL_DEFAULT', houseId: NALVEN }, continuityUtility: [
        expect.objectContaining({ baseUtility: 43, marriageBonus: 6, affiliationBonus: 12 }), expect.anything(),
      ],
    }))
  })

  it('walks deceased links, treats own undetermined dynasty as unknown and ignores unrelated missing ancestry', () => {
    const deceased = descendant({ birthYear: 1238, alive: false, deathYear: 1249 })
    const grandchild = descendant({ personId: 'recorded-grandchild', motherId: deceased.personId })
    const unrelated = descendant({ personId: 'unrelated', motherId: 'missing-unrelated-id' })
    const subject = { ...party(P5), legalDynasty: unknownDynasty }
    expect(lineageContinuity(withPeople(deceased, grandchild, unrelated), subject)).toMatchObject({
      house: { status: 'SATISFIED' }, dynasty: { status: 'UNKNOWN' },
      records: [{ personId: deceased.personId, life: 'DEAD' }, { personId: grandchild.personId, life: 'LIVING', verifiedPath: true }],
    })
    expect(lineageContinuity(world, { ...subject, birthYear: 1233 }).eligibility).toBe('NOT_ADULT')
    expect(lineageContinuity(world, { ...subject, alive: false, deathYear: 1249 }).eligibility).toBe('NOT_LIVING')
    const married = step(world).world
    expect(lineageContinuity(married, party(P5, married)).eligibility).toBe('ACTIVE_MARRIAGE')
  })

  it('preserves v4’s identity and world, isolating the v5 configuration and zero control', () => {
    expect(multiHouseChildHouseRunConfigDigest(0)).toBe('d6816f23b083eb3b')
    const w = createMultiHouseDemandWorld(0)
    const run = (ev: EvaluatorMap) => runYear(w, { seed: 20260303, branchId: 'A0-play', evaluators: ev })
    const v4 = run(createMultiHouseChildHouseEvaluators(w, [], 0))
    const control = run(createMultiHouseLineageEvaluators(w, [], 0, 'ZERO_CONTROL'))
    expect(v4.status).toBe('COMPLETED')
    expect(control.status).toBe('COMPLETED')
    if (v4.status !== 'COMPLETED' || control.status !== 'COMPLETED') throw new Error('Expected completed v4 and zero-control years')
    expect(control.world).toEqual(v4.world)
    expect(control.events).toEqual(v4.events)
    expect(new Set([multiHouseChildHouseRunConfigDigest(0), multiHouseLineageRunConfigDigest(0),
      multiHouseLineageRunConfigDigest(0, 'ZERO_CONTROL')]).size).toBe(3)
    expect(validateNextgenContractCalibration({ ...EXPERIMENTAL_NEXTGEN_CONTRACT, lineageContinuity: motivation }))
      .toEqual(['LINEAGE_CONTINUITY_REQUIRES_CHILD_HOUSE_CONTRACT'])
    expect(validateNextgenContractCalibration({ ...base, lineageContinuity: { ...motivation, affiliationBonus: -1 } }))
      .toEqual(['LINEAGE_CONTINUITY_CALIBRATION_OUT_OF_RANGE'])
  })
})
