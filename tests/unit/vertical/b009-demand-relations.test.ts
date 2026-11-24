import {describe, expect, it} from 'vitest'
import {
  createMultiHouseAbstractEvaluators, createMultiHouseDemandEvaluators, createMultiHouseDemandTrustObserver,
  createMultiHouseDemandWorld, multiHouseAbstractRunConfigDigest, multiHouseDemandRunConfigDigest,
} from '../../../src/scenario/experimental/multi-house-abstract-marriage.ts'
import {createMultiHouseWorld, multiHouseRunConfigDigest, MULTI_HOUSE_AUTONOMY} from '../../../src/scenario/experimental/multi-house-playtest.ts'
import type {DecisionTrace, PairTrustBase, StatModifier, WorldState} from '../../../src/simulation/contracts/index.ts'
import {PAIR_TRUST_STAT_KEY, STAT_MODIFIER_RULE_VERSION} from '../../../src/simulation/contracts/index.ts'
import {runTimeline, runYear, type EvaluatorMap} from '../../../src/simulation/engine/index.ts'
import {normalizePersonPair} from '../../../src/simulation/intervention/index.ts'
import {b009DemandModelKey, createB009DemandObserver, createB009WorldStateEvaluator, EXPERIMENTAL_B009_CALIBRATION} from '../../../src/simulation/rules/b/index.ts'
import {validateWorldState, validateYearStartWorldState} from '../../../src/simulation/validation/index.ts'

const seed = 20260101
const p = (id: number) => `person-exp-0${id}`
const samePair = (ids: readonly string[], a: string, b: string) => ids.length === 2 && ids.includes(a) && ids.includes(b)
const record = (w: WorldState, a: string, b: string) => w.pairTrust?.find(r => samePair(r.personIds, a, b))
const trace = (traces: readonly DecisionTrace[], ruleId: 'B-004' | 'B-009', a: string, b: string) =>
  traces.find(t => t.ruleId === ruleId && t.actorRef.kind === 'PERSON_PAIR' && samePair(t.actorRef.ids, a, b))
function complete(world: WorldState, evaluators: EvaluatorMap) {
  const result = runYear(world, {seed, evaluators})
  if (result.status !== 'COMPLETED') throw new Error(JSON.stringify(result.halt))
  return result
}

describe('DEC-179: B-009の必要時評価', () => {
  it.each([0, 1] as const)('明示初期値、経年、アンカー、clampと実更新を区別する（drift=%s）', drift => {
    const base: PairTrustBase[] = [{personIds: [p(1), p(2)], value: 99}, {personIds: [p(2), p(5)], value: -100}]
    const calibration = {...EXPERIMENTAL_B009_CALIBRATION, initialTrust: 24, initialTrustSpread: 16, annualDelta: drift}
    const initial = {...createMultiHouseDemandWorld(drift), pairTrustModelKey: b009DemandModelKey(base, calibration)}
    const observe = createB009DemandObserver(base, calibration)
    expect(createB009DemandObserver([], calibration)(initial, p(1), p(2))).toMatchObject({status: 'UNKNOWN', reason: 'MODEL_MISMATCH'})
    const annual = createB009WorldStateEvaluator(base, calibration, {marriage: MULTI_HOUSE_AUTONOMY.marriage, ledger: []})
    const legacy = createB009WorldStateEvaluator(base, calibration)
    expect(observe(initial, p(1), p(2))).toMatchObject({status: 'UNKNOWN', reason: 'NO_EVALUATED_COEXISTENCE'})
    let newWorld: WorldState = initial
    let oldWorld = createMultiHouseWorld()
    for (let year = 1250; year < 1253; year++) {
      const result = complete(newWorld, {'B-009': annual})
      newWorld = result.world
      oldWorld = complete(oldWorld, {'B-009': legacy}).world
      expect(record(newWorld, p(1), p(2))).toBeUndefined() // 同性のためB-004の対象外
      expect(observe(newWorld, p(2), p(1))).toMatchObject({status: 'DERIVED',
        value: record(oldWorld, p(1), p(2))?.value, initialSource: 'EXPLICIT', firstYear: 1250, anchorYear: null})
      expect(record(newWorld, p(2), p(5))).toEqual(record(oldWorld, p(2), p(5)))
      expect(observe(newWorld, p(5), p(2))).toMatchObject({status: 'RECORDED', value: -100 + (year - 1249) * drift,
        throughYear: year, anchorYear: year, initialSource: null})
      expect(observe(newWorld, p(1), p(2))).toEqual(observe(structuredClone(newWorld), p(2), p(1)))
    }
    // 記録済みの基礎値を起点とする。再開によって過去の記録は増えない。
    const modifiedAnchor = {personIds: [p(1), p(2)] as const, value: 91, lastUpdatedYear: 1250}
    const saved = validateWorldState(JSON.parse(JSON.stringify({...newWorld, pairTrust: [...newWorld.pairTrust!, modifiedAnchor]})))
    expect(saved.ok).toBe(true)
    expect(observe(saved.world!, p(1), p(2))).toMatchObject({status: 'DERIVED', value: 91 + 2 * drift, anchorYear: 1250})
  })

  it('候補の全件を同条件で比較し、有効な非候補介入も評価するが基礎値に加えない', () => {
    const initial = createMultiHouseDemandWorld()
    const mod = (a: string, b: string, modifierId: string): StatModifier => ({modifierId,
      interventionId: modifierId, statKey: PAIR_TRUST_STAT_KEY, ruleVersion: STAT_MODIFIER_RULE_VERSION,
      targetRef: {kind: 'PERSON_PAIR', ids: normalizePersonPair(a, b)!},
      signedDelta: 20, startYear: 1250, endExclusiveYear: 1251, decayPolicy: 'NONE'})
    const ledger = [mod(p(2), p(5), 'candidate'), mod(p(1), p(2), 'non-candidate')]
    const old = complete(createMultiHouseWorld(), createMultiHouseAbstractEvaluators(createMultiHouseWorld(), ledger))
    const evals = createMultiHouseDemandEvaluators(initial, ledger)
    ledger.length = 0 // 構築後の外部変更はどちらの規則にも見えない。
    const next = complete(initial, evals)
    expect(next.traces.filter(t => t.ruleId !== 'B-009')).toEqual(old.traces.filter(t => t.ruleId !== 'B-009'))
    expect(trace(next.traces, 'B-004', p(2), p(5))?.candidates[0]?.inputs).toMatchObject({rawModifierSum: 20})
    expect(record(next.world, p(2), p(5))).toEqual(record(old.world, p(2), p(5)))
    expect(record(next.world, p(1), p(2))).toEqual(record(old.world, p(1), p(2)))
    expect(trace(next.traces, 'B-004', p(1), p(2))).toBeUndefined()
    const nextYear = complete(next.world, evals)
    expect(trace(nextYear.traces, 'B-009', p(1), p(2))).toBeUndefined()
    expect(record(nextYear.world, p(1), p(2))).toEqual(record(next.world, p(1), p(2)))
    expect(createMultiHouseDemandTrustObserver()(nextYear.world, p(1), p(2))).toMatchObject({status: 'DERIVED',
      value: record(next.world, p(1), p(2))!.value + 1})
    expect(nextYear.traces.every(t => !t.modifierIds.includes('candidate') && !t.modifierIds.includes('non-candidate'))).toBe(true)
  })

  it('不足・不正・旧状態を拒否し、候補の基礎値欠落を暗黙に通さない', () => {
    const initial = createMultiHouseDemandWorld()
    const old = createMultiHouseWorld()
    const observe = createMultiHouseDemandTrustObserver()
    expect(observe(old, p(1), p(2))).toMatchObject({status: 'UNKNOWN', reason: 'MODEL_MISMATCH'})
    expect(observe(initial, '', p(2))).toMatchObject({status: 'UNKNOWN', reason: 'INVALID_PAIR'})
    expect(observe(initial, p(2), p(2))).toMatchObject({status: 'UNKNOWN', reason: 'INVALID_PAIR'})
    expect(observe(initial, 'unregistered', p(2))).toMatchObject({status: 'UNKNOWN', reason: 'NOT_REGISTERED'})
    const [first, ...rest] = initial.persons
    expect(first).toBeDefined()
    const {firstPairTrustYear: _firstYear, ...withoutClock} = first!
    void _firstYear
    const missing = {...initial, persons: [withoutClock, ...rest]}
    expect(observe(missing, p(1), p(2))).toMatchObject({status: 'UNKNOWN', reason: 'INVALID_SNAPSHOT'})
    expect(observe(null, p(1), p(2))).toMatchObject({status: 'UNKNOWN', reason: 'INVALID_SNAPSHOT'})
    const skipped = {...initial, year: 1251}
    expect(observe(skipped, p(1), p(2))).toMatchObject({status: 'UNKNOWN', reason: 'INVALID_SNAPSHOT'})
    expect(runYear(skipped, {seed, evaluators: createMultiHouseDemandEvaluators(initial)})).toMatchObject({
      status: 'HALTED', halt: {code: 'INVALID_INPUT_WORLD'},
    })
    expect(validateWorldState(missing).ok).toBe(false)
    expect(validateWorldState({...initial, pairTrustDrift: 2}).ok).toBe(false)
    expect(validateWorldState({...initial, persons: [{...first!, firstPairTrustYear: 1249}, ...rest]}).ok).toBe(false)
    expect(observe({...initial, persons: [{...first!, birthYear: 1251}, ...rest]}, p(1), p(2)))
      .toMatchObject({status: 'UNKNOWN', reason: 'INVALID_SNAPSHOT'})
    expect(() => createMultiHouseDemandEvaluators(old)).toThrow('MULTI_HOUSE_PAIR_TRUST_MODEL_MISMATCH')
    expect(() => createMultiHouseDemandEvaluators(initial, [], 0)).toThrow('MULTI_HOUSE_PAIR_TRUST_MODEL_MISMATCH')
    expect(() => createMultiHouseAbstractEvaluators(initial)).toThrow('MULTI_HOUSE_PAIR_TRUST_MODEL_MISMATCH')
    expect(() => createB009DemandObserver([], {...EXPERIMENTAL_B009_CALIBRATION, sameHouseBonus: 1})).toThrow('CONSTANT_DRIFT')
    expect(() => createB009DemandObserver([], {...EXPERIMENTAL_B009_CALIBRATION, annualDelta: 2})).toThrow('CONSTANT_DRIFT')
    expect(() => createB009DemandObserver([{personIds: [p(2), p(1)], value: 0}], EXPERIMENTAL_B009_CALIBRATION)).toThrow('INVALID_BASE_PAIR')
    const premature = {...initial, pairTrust: [{personIds: [p(1), p(2)] as const, value: 91, lastUpdatedYear: 1250}]}
    expect(validateWorldState(premature).ok).toBe(true) // reducer内の年次途中なら当年アンカーは合法。
    expect(validateYearStartWorldState(premature).ok).toBe(false)
    expect(observe(premature, p(1), p(2))).toMatchObject({status: 'UNKNOWN', reason: 'INVALID_SNAPSHOT'})
    const initialEvaluators = createMultiHouseDemandEvaluators(initial)
    expect(runYear(premature, {seed, evaluators: initialEvaluators})).toMatchObject({status: 'HALTED',
      halt: {code: 'INVALID_INPUT_WORLD'}})
    expect(runTimeline(premature, {seed, evaluators: initialEvaluators})).toMatchObject({status: 'HALTED',
      halt: {code: 'INVALID_INPUT_WORLD'}})
    const missingEvaluator = runYear(initial, {seed})
    expect(missingEvaluator).toMatchObject({status: 'HALTED', world: initial,
      halt: {ruleId: 'B-009', code: 'EVALUATION_FAILED'}})
    const evaluators = createMultiHouseDemandEvaluators(initial)
    // B-004側にも独立した検査があり、不足すると候補を脱落させず停止する。
    const r = runYear(initial, {seed, evaluators: {...evaluators, 'B-004': (world, ctx) => {
      return evaluators['B-004']!({...world, pairTrust: []}, ctx)
    }}})
    expect(r.status).toBe('HALTED')
    if (r.status === 'HALTED') {
      expect(r.halt).toMatchObject({ruleId: 'B-004', code: 'EVALUATION_FAILED'})
      expect(JSON.stringify(r.halt)).toContain('REQUIRED_RELATION_MISSING')
      expect(r.world).toEqual(initial)
    }
    expect(multiHouseRunConfigDigest()).toBe('5090c8485f4b8570')
    expect(multiHouseAbstractRunConfigDigest()).toBe('9422e19172aec8c1')
    expect(new Set([multiHouseDemandRunConfigDigest(), multiHouseDemandRunConfigDigest(0), multiHouseAbstractRunConfigDigest()]).size).toBe(3)
  })

  it('実年次でSUPPORTING登録、出生→成年→次世代、死別まで旧方式の入力を再現する', () => {
    let current = createMultiHouseDemandWorld(), legacy = createMultiHouseWorld()
    const newEvals = createMultiHouseDemandEvaluators(current), oldEvals = createMultiHouseAbstractEvaluators(legacy)
    const observe = createMultiHouseDemandTrustObserver()
    let supporting = false, death = false, widow = false, adulthood = false, descendant = false
    const born = new Set<string>()
    for (let year = 1250; year < 1310; year++) {
      const next = complete(current, newEvals), old = complete(legacy, oldEvals)
      const candidates = next.traces.filter(t => t.ruleId === 'B-004')
      expect(candidates).toEqual(old.traces.filter(t => t.ruleId === 'B-004'))
      if (candidates.some(t => t.actorRef.kind === 'PERSON_PAIR' && t.actorRef.ids.some(id => born.has(id) &&
        current.persons.some(person => person.personId === id && year - person.birthYear === 18)))) adulthood = true
      for (const newcomer of next.world.persons.filter(x => !current.persons.some(y => y.personId === x.personId))) {
        if (newcomer.interactionRole === 'SUPPORTING') {
          expect(newcomer.firstPairTrustYear).toBe(year + 1)
          const corrupted = {...next.world, persons: next.world.persons.map(x => x !== newcomer ? x :
            {...x, firstPairTrustYear: year})}
          expect(validateWorldState(corrupted).ok).toBe(false)
          expect(observe(corrupted, newcomer.personId, p(1))).toMatchObject({status: 'UNKNOWN', reason: 'INVALID_SNAPSHOT'})
          expect(observe(next.world, newcomer.personId, p(1))).toMatchObject({status: 'UNKNOWN', reason: 'NO_EVALUATED_COEXISTENCE'})
          expect(next.events.some(e => e.supportingMarriageRegistrations?.some(x => x.registration.person.personId === newcomer.personId))).toBe(true)
          supporting = true
        } else {
          expect(newcomer.firstPairTrustYear).toBe(newcomer.birthYear)
          expect(newcomer.firstPairTrustYear).toBe(year)
          expect(next.events.some(e => e.eventType === 'PERSON_BIRTH' && e.involvedRefs.some(r => r.kind === 'PERSON' && r.id === newcomer.personId))).toBe(true)
          if ([newcomer.fatherId, newcomer.motherId].some(id => id && born.has(id))) descendant = true
          born.add(newcomer.personId)
        }
      }
      // 当年に死亡した相手は、死亡年を加算せずに最後に共存した年の値を導出する。
      for (const died of next.world.persons.filter(x => x.deathYear === year)) {
        const counterpart = current.persons.find(x => x.personId !== died.personId && x.alive && x.interactionRole !== 'SUPPORTING' &&
          record(old.world, died.personId, x.personId))
        if (!counterpart) continue
        expect(trace(next.traces, 'B-009', died.personId, counterpart.personId)).toBeUndefined()
        expect(observe(next.world, died.personId, counterpart.personId)).toMatchObject({
          throughYear: year - 1, value: record(old.world, died.personId, counterpart.personId)?.value})
        death = true
      }
      for (const t of next.traces.filter(t => t.ruleId === 'B-009')) {
        if (t.actorRef.kind !== 'PERSON_PAIR') continue
        const [a,b] = t.actorRef.ids
        expect(record(next.world, a, b)).toEqual(record(old.world, a, b))
        // 死別済みの既婚人物が、休止を経て再び実際の候補になる。
        if ([a,b].some(id => current.legal.marriages.some(m => m.personIds.includes(id) &&
          m.dissolvedYear === year - 1 && year - m.registeredYear > 1))) {
          const anchor = record(current, a, b)
          expect(anchor?.lastUpdatedYear).not.toBe(year - 1)
          expect(t.candidates[0]?.inputs.previousBaseDerived).toBe(true)
          widow = true
        }
      }
      current = next.world
      legacy = old.world
      if (supporting && descendant && death && widow && adulthood) break
    }
    expect({supporting, death, widow, adulthood, descendant})
      .toEqual({supporting: true, death: true, widow: true, adulthood: true, descendant: true})
  })
})
