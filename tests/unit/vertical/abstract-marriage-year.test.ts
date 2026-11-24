import { describe, expect, it } from 'vitest'
import { createMultiHouseAbstractEvaluators, MULTI_HOUSE_ABSTRACT_MARRIAGE }
  from '../../../src/scenario/experimental/multi-house-abstract-marriage.ts'
import {
  createMultiHouseEvaluators, createMultiHouseWorld, MULTI_HOUSE_AUTONOMY,
  MULTI_HOUSE_B009_CALIBRATION, MULTI_HOUSE_NEXTGEN_CONTRACT, MULTI_HOUSE_SEED,
} from '../../../src/scenario/experimental/multi-house-playtest.ts'
import { createExperimentalOrdinaryLegalTrial } from '../../../src/scenario/experimental/ordinary-legal-trial.ts'
import { createAutonomousCalibrationEvaluators } from '../../../src/simulation/autonomy/index.ts'
import { deriveAbstractMarriageSupply } from '../../../src/simulation/autonomy/abstract-marriage-supply.ts'
import type { DecisionTrace, Person, StatModifier, WorldState } from '../../../src/simulation/contracts/index.ts'
import { PAIR_TRUST_STAT_KEY, STAT_MODIFIER_RULE_VERSION } from '../../../src/simulation/contracts/index.ts'
import { runYear } from '../../../src/simulation/engine/index.ts'
import type { EvaluatorMap } from '../../../src/simulation/engine/index.ts'

const seed = MULTI_HOUSE_SEED
const branchId = 'abstract-marriage-year'
const initial = createMultiHouseWorld()
const trial = createExperimentalOrdinaryLegalTrial()
const cfg = MULTI_HOUSE_ABSTRACT_MARRIAGE

function completed(world: WorldState, evaluators: EvaluatorMap) {
  const result = runYear(world, {seed, branchId, evaluators})
  if (result.status !== 'COMPLETED') throw new Error(JSON.stringify(result.halt))
  return result
}

function withInput(world: WorldState, mode: 'PROHIBITED'|'UNVERIFIED'|'NO_AUTHORITY'|'PAIR_BUDGET', budget = 1) {
  const book = mode === 'NO_AUTHORITY' ? {...trial.book,
    approvalAuthorities: trial.book.approvalAuthorities.filter(a => a.action !== 'NORMAL_MARRIAGE')} : trial.book
  const calibration = mode === 'PROHIBITED' ? {...cfg.background, prohibitedPermille: 1000, investigationCompletionPermille: 1000}
    : mode === 'UNVERIFIED' ? {...cfg.background, investigationCompletionPermille: 0} : cfg.background
  const input = createAutonomousCalibrationEvaluators({branchStartWorld: world, ledger: [], trustBase: [],
    nextgenMarriage: {book, laws: trial.laws, calibration: MULTI_HOUSE_NEXTGEN_CONTRACT},
    reviewedLegal: {book, ordinaryLaws: trial.laws}, spouseDeathDissolution: true,
    abstractMarriageSupply: {...cfg, background: calibration}, b009Calibration: MULTI_HOUSE_B009_CALIBRATION,
    autonomy: mode === 'PAIR_BUDGET' ? {...MULTI_HOUSE_AUTONOMY,
      marriage: {...MULTI_HOUSE_AUTONOMY.marriage, maxCandidatePairs: budget}} : MULTI_HOUSE_AUTONOMY,
  })
  if (!input.ok) throw new Error(input.issues.join('; '))
  return input.evaluators
}

const offers = (traces: readonly DecisionTrace[]) => traces.filter(t => t.ruleId === 'B-001' &&
  t.status === 'ACCEPT' && t.reasonCodes.includes('SUPPORTING_CANDIDATE_ONLY')).flatMap(t => t.candidates.map(c => c.inputs))

describe('抽象婚姻候補と実runYearの接続', () => {
  it('旧構成で実出生した最初の適格成人にも固定IDの追加なしに供給し、別の出典を信頼・禁親評価へ渡す', () => {
    let world = initial
    const old = createMultiHouseEvaluators(world)
    let adult: Person | undefined
    while (world.year <= 1310) {
      adult = world.persons.find(p => p.alive && p.fatherId && p.motherId &&
        p.birthYear >= initial.year && world.year - p.birthYear === 18 &&
        world.legal.marriages.every(m => m.status !== 'ACTIVE' || !m.personIds.includes(p.personId)))
      if (adult) break
      world = completed(world, old).world
    }
    expect(adult).toBeDefined()
    const r = completed(world, createMultiHouseAbstractEvaluators(world))
    const rows = offers(r.traces).filter(c => c.seekerPersonId === adult?.personId)
    expect(rows.length).toBeGreaterThan(0)
    expect(rows.length).toBeLessThanOrEqual(cfg.offersPerSeeker)
    for (const offer of rows) {
      expect(offer.populationSource).toBe('C004_COHORT')
      expect(offer.survivorAttestationId).not.toBe(offer.sourceEvidenceId)
      const pair = [adult?.personId, offer.supportingCandidateId].sort()
      const assessed = r.traces.find(t => t.ruleId === 'B-004' && t.actorRef.kind === 'PERSON_PAIR' &&
        JSON.stringify(t.actorRef.ids) === JSON.stringify(pair))
      expect(assessed?.candidates[0]?.inputs.trustSource).toBe('CALIBRATION_ONLY_CANDIDATE_BASE')
      expect(r.traces.some(t => t.ruleId === 'B-005' && t.actorRef.kind === 'PERSON_PAIR' &&
        JSON.stringify(t.actorRef.ids) === JSON.stringify(pair))).toBe(true)
    }
  }, 30_000)

  it('初期年からの同じ実計算で双方合意と法的登録を確認し、登録は当該Eventの人口内訳のみに限定する', () => {
    let world = initial
    const evals = createMultiHouseAbstractEvaluators(initial)
    let found = false
    while (world.year <= 1260 && !found) {
      const r = completed(world, evals)
      const registrations = r.events.flatMap(e => e.supportingMarriageRegistrations ?? [])
      expect(r.world.persons.filter(p => p.interactionRole === 'SUPPORTING' && !world.persons.some(q => q.personId === p.personId))
        .map(p => p.personId).sort()).toEqual(registrations.map(x => x.registration.person.personId).sort())
      for (const row of registrations) {
        const p = row.registration.person
        const marriage = r.world.legal.marriages.find(m => m.marriageId === row.marriageId)!
        expect(r.traces.some(t => t.ruleId === 'B-005' && t.status === 'ACCEPT' && t.actorRef.kind === 'PERSON_PAIR' &&
          JSON.stringify(t.actorRef.ids) === JSON.stringify(marriage.personIds))).toBe(true)
        expect(r.traces.some(t => t.traceId === row.sourceTraceId && t.ruleId === 'A-LEG-01' && t.status === 'ACCEPT')).toBe(true)
        expect(r.world.persons.find(x => x.personId === p.personId)).toMatchObject({interactionRole: 'SUPPORTING', originGroupId: p.originGroupId})
      }
      found = registrations.length > 0
      if (found) {
        const denied = completed(world, withInput(world, 'NO_AUTHORITY'))
        expect(denied.world.groups).toEqual(r.world.groups)
        expect(denied.world.demographics).toEqual(r.world.demographics)
        expect(denied.events.flatMap(e => e.supportingMarriageRegistrations ?? [])).toEqual([])
      }
      world = r.world
    }
    expect(found).toBe(true)
  })

  it.each(['PROHIBITED', 'UNVERIFIED'] as const)('%s の抽象調査はB-001供給を婚姻・個別登録に変えない', mode => {
    const result = completed(initial, withInput(initial, mode))
    const reason = mode === 'PROHIBITED' ? 'ABSTRACT_KINSHIP_PROHIBITED' : 'ABSTRACT_KINSHIP_INVESTIGATION_INCOMPLETE'
    expect(offers(result.traces).length).toBeGreaterThan(0)
    expect(result.traces.some(t => t.ruleId === 'B-005' && t.status === 'DEFER' && t.reasonCodes.includes(reason))).toBe(true)
    expect(result.world.persons.every(p => p.interactionRole !== 'SUPPORTING')).toBe(true)
    expect(result.events.flatMap(e => e.supportingMarriageRegistrations ?? [])).toEqual([])
  })

  it('供給・信頼・調査があっても、国家授権を抜いた年次では婚姻も個別化も起こらない', () => {
    let world = initial
    let hadQuery = false
    const evals = withInput(initial, 'NO_AUTHORITY')
    while (world.year <= 1260 && !hadQuery) {
      const result = completed(world, evals)
      hadQuery = result.traces.some(t => t.ruleId === 'B-005' && t.status === 'ACCEPT')
      if (hadQuery) expect(result.traces.some(t => t.ruleId === 'A-LEG-01' && t.status === 'DEFER')).toBe(true)
      expect(result.world.legal.marriages).toEqual(world.legal.marriages)
      expect(result.world.persons.every(p => p.interactionRole !== 'SUPPORTING')).toBe(true)
      world = result.world
    }
    expect(hadQuery).toBe(true)
  })

  it('登録済みだけなら予算内でも、抽象候補を加えた評価上限超過は年次を停止する', () => {
    const baseline = completed(initial, createMultiHouseAbstractEvaluators(initial))
    const budget = baseline.traces.filter(t => t.ruleId === 'B-004' &&
      t.candidates[0]?.inputs.trustSource !== 'CALIBRATION_ONLY_CANDIDATE_BASE').length
    expect(budget).toBeGreaterThan(0)
    expect(offers(baseline.traces).length).toBeGreaterThan(0)
    const result = runYear(initial, {seed, branchId, evaluators: withInput(initial, 'PAIR_BUDGET', budget)})
    expect(result.status).not.toBe('COMPLETED')
    if (result.status !== 'COMPLETED') expect(JSON.stringify(result.halt)).toContain('PAIR_BUDGET_EXCEEDED')
  })

  it('別IDで消費した同年同集団のC004出生枠は、死亡後も再供給せず実年次を継続する', () => {
    const world = {...initial, year: 1268, demographics: {...initial.demographics,
      anonymousBirthHistory: [{groupId: 'group-east-elite', year: 1250, anonymousBirths: 1}]}}
    const used: Person = {...initial.persons[0]!, personId: 'support:population:["old-cohort",0]',
      birthYear: 1250, originGroupId: 'group-east-elite', houseId: 'house-cardon', interactionRole: 'SUPPORTING',
      alive: false, deathYear: 1267, legalDynasty: {status: 'UNDETERMINED', reasonCodes: ['TEST']}}
    const config = {...cfg, initialBirthYears: [], background: {...cfg.background,
      adultSurvivalPermille: 1000, annualAvailabilityPermille: 1000}}
    expect(deriveAbstractMarriageSupply(world, seed, config).input.cohorts).toHaveLength(1)
    const depleted = {...world, persons: [...world.persons, used]}
    expect(deriveAbstractMarriageSupply(depleted, seed, config).input.cohorts).toEqual([])
    const r = completed(depleted, createMultiHouseAbstractEvaluators(depleted))
    expect(offers(r.traces).filter(o => o.candidateBirthYear === 1250 && o.candidateGroupId === used.originGroupId)).toEqual([])
    expect(r.world.persons.find(p => p.personId === used.personId)?.alive).toBe(false)
  })

  it('B-004の校正年齢に満たない候補は有限の探索枠を消費しない', () => {
    const config = {...cfg, groups: cfg.groups.slice(0, 1), initialBirthYears: [1228, 1232], offersPerSeeker: 1,
      background: {...cfg.background, adultSurvivalPermille: 1000, annualAvailabilityPermille: 1000}}
    const built = createAutonomousCalibrationEvaluators({branchStartWorld: initial, ledger: [], trustBase: [],
      nextgenMarriage: {book: trial.book, laws: trial.laws, calibration: MULTI_HOUSE_NEXTGEN_CONTRACT},
      abstractMarriageSupply: config, b009Calibration: MULTI_HOUSE_B009_CALIBRATION,
      autonomy: {...MULTI_HOUSE_AUTONOMY, marriage: {...MULTI_HOUSE_AUTONOMY.marriage, minAdultAge: 21}},
    })
    if (!built.ok) throw new Error(built.issues.join('; '))
    const r = runYear(initial, {seed: 1, branchId, evaluators: built.evaluators})
    if (r.status !== 'COMPLETED') throw new Error(JSON.stringify(r.halt))
    const offered = offers(r.traces)
    expect(offered.length).toBeGreaterThan(0)
    expect(offered.every(o => o.candidateBirthYear === 1228)).toBe(true)
    expect(r.traces.some(t => t.ruleId === 'B-004' && t.candidates[0]?.inputs.trustSource === 'CALIBRATION_ONLY_CANDIDATE_BASE')).toBe(true)
  })

  it('匿名出生履歴を失った再開入力はv1構成として受理しない', () => {
    const world = {...initial, demographics: {...initial.demographics, anonymousBirthHistory: undefined}}
    expect(() => createMultiHouseAbstractEvaluators(world)).toThrow('ANONYMOUS_BIRTH_HISTORY_REQUIRED')
  })

  it('未登録候補と、個別化済みの同一候補のいずれも直接介入対象にならない', () => {
    let world = initial
    const ev = createMultiHouseAbstractEvaluators(initial)
    let checked = false
    while (world.year <= 1260 && !checked) {
      const r = completed(world, ev)
      const registered = r.events.flatMap(e => e.supportingMarriageRegistrations ?? [])[0]?.registration.person
      if (registered) {
        const ids = ['person-exp-01', registered.personId].sort() as [string, string]
        const m: StatModifier = {modifierId: 'abstract-test', interventionId: 'abstract-test',
          targetRef: {kind: 'PERSON_PAIR', ids}, statKey: PAIR_TRUST_STAT_KEY, signedDelta: 20,
          startYear: world.year, endExclusiveYear: world.year + 1, decayPolicy: 'NONE', ruleVersion: STAT_MODIFIER_RULE_VERSION}
        expect(() => createMultiHouseAbstractEvaluators(world, [m])).toThrow('UNKNOWN_PERSON')
        expect(() => createMultiHouseAbstractEvaluators(r.world, [m])).toThrow('SUPPORTING_PERSON_NOT_DIRECTLY_INTERACTABLE')
        checked = true
      }
      world = r.world
    }
    expect(checked).toBe(true)
  })

  it('同じ世界の供給・調査・信頼は人物・出典走査順に依存しない', () => {
    const config = {...cfg, groups: [...cfg.groups].reverse(), initialBirthYears: [...cfg.initialBirthYears].reverse()}
    const replay = {...structuredClone(initial), persons: [...initial.persons].reverse()}
    expect(deriveAbstractMarriageSupply(replay, seed, config)).toEqual(deriveAbstractMarriageSupply(initial, seed, cfg))
  })
})
