import { beforeAll, describe, expect, it, vi } from 'vitest'
import {
  createMultiHouseEvaluators, createMultiHouseWorld, MULTI_HOUSE_RUN_CONDITIONS as config,
  multiHouseRunConfigDigest, multiHouseRunConfigIdentity,
} from '../../../src/scenario/experimental/index.ts'
import { PAIR_TRUST_STAT_KEY, STAT_MODIFIER_RULE_VERSION } from '../../../src/simulation/contracts/index.ts'
import type { DecisionTrace, RuleId, StatModifier, TargetRef } from '../../../src/simulation/contracts/index.ts'
import { runTimeline } from '../../../src/simulation/engine/index.ts'
import type { TimelineResult } from '../../../src/simulation/engine/index.ts'
import { reviewDomesticMarriageEligibility } from '../../../src/simulation/legal/nextgen-marriage.ts'
import { supportingCandidateId } from '../../../src/simulation/population/supporting-marriage.ts'
import { SingleA0Cache } from '../../../src/ui/a0-cache.ts'
import type { A0CacheEntry } from '../../../src/ui/a0-cache.ts'
import { runPlayComparison, runPlayObservation } from '../../../src/ui/branch-play-source.ts'
import type { PlayComparison, PlayInput } from '../../../src/ui/branch-play-source.ts'
import { candidateSetMatches, candidatesAtYear, extractCandidates } from '../../../src/ui/play-candidates.ts'
import type { PlayProgress } from '../../../src/ui/play-progress.ts'

const MODE = 'MULTI_HOUSE_EXPERIMENTAL'
const TIMEOUT = 120_000
type Pair = readonly [string, string]
const c1Pair = ['person-exp-03', 'person-exp-04'] as const
const c1Year = 1251
const agePeer = supportingCandidateId('multi-house:initial:east:1232:male', 0)
const c1Rival = [c1Pair[0], agePeer] as const
const first = ['person-exp-01', 'person-exp-05'] as const
const rival = ['person-exp-04', 'person-exp-05'] as const
const unverified = ['person-exp-05', 'person-exp-07'] as const
const mutual = 'MUTUAL_UNIQUE_PARTNER_NOT_ESTABLISHED'
const accepted = 'BOTH_PARTIES_ACCEPT_UNIQUE_CONTRACT'
const jurisdiction = 'SAME_COUNTRY_JURISDICTION_UNVERIFIED'
const dynasty = 'dynasty-nalven'

function inputOf(seed: number, year: number, pair: Pair, signedDelta: number) {
  return { mode: MODE, seed, year, firstPersonId: pair[0], secondPersonId: pair[1], signedDelta, durationYears: 1 } satisfies PlayInput
}

function requireOk<T extends { ok: boolean }>(result: T): Extract<T, { ok: true }> {
  if (!result.ok) throw new Error(JSON.stringify(result))
  return result as Extract<T, { ok: true }>
}

const at = (run: TimelineResult, year: number) => run.snapshots[year - run.startYear]!
const samePair = (ref: TargetRef, pair: Pair) => ref.kind === 'PERSON_PAIR' && ref.ids[0] === pair[0] && ref.ids[1] === pair[1]
const tracesOf = (run: TimelineResult, year: number, ruleId: RuleId, pair: Pair) =>
  run.decisionTraces.filter(t => t.year === year && t.ruleId === ruleId && samePair(t.actorRef, pair))

function trace(run: TimelineResult, year: number, ruleId: RuleId, pair: Pair) {
  const matches = tracesOf(run, year, ruleId, pair)
  expect(matches, `${run.branchId}/${year}/${ruleId}/${pair.join('+')}`).toHaveLength(1)
  return matches[0]!
}

function linkedEvent(run: TimelineResult, trace: DecisionTrace, eventType: string) {
  expect(trace.eventIds).toHaveLength(1)
  const event = run.eventLog.find(e => e.eventId === trace.eventIds[0])
  expect(event).toMatchObject({ year: trace.year, phase: trace.phase, eventType, sourceTraceIds: [trace.traceId] })
  return event!
}

function checkNegotiation(run: TimelineResult, year: number, pair: Pair, base: number, reason: string, modifier?: StatModifier) {
  const delta = modifier?.signedDelta ?? 0
  const b004 = trace(run, year, 'B-004', pair)
  expect(b004).toMatchObject({
    status: 'ACCEPT', eventIds: [], modifierIds: modifier ? [modifier.modifierId] : [],
    candidates: [{ score: base + delta, inputs: { baseTrust: base, effectiveTrust: base + delta, rawModifierSum: delta } }],
  })
  const b005 = trace(run, year, 'B-005', pair)
  expect(b005).toMatchObject({
    status: reason === accepted ? 'ACCEPT' : 'DEFER', eventIds: [], modifierIds: b004.modifierIds,
    candidates: [{ inputs: { sourceB004TraceId: b004.traceId, sourceB004Score: base + delta } }],
  })
  expect(b005.reasonCodes).toContain(reason)
  const inputs = b005.candidates[0]!.inputs
  const registrations = run.eventLog.filter(e => e.year === year && e.eventType.split('+').includes('MARRIAGE_REGISTER') &&
    e.involvedRefs.some(ref => samePair(ref, pair)))
  const marriages = at(run, year + 1).legal.marriages.filter(m => m.personIds[0] === pair[0] && m.personIds[1] === pair[1])
  if (reason !== accepted) {
    expect(inputs).toMatchObject({ sourceRequestId: null, selectedContractKey: null })
    expect(tracesOf(run, year, 'A-LEG-01', pair)).toEqual([])
    expect(registrations).toEqual([])
    expect(marriages).toEqual([])
    return
  }
  expect(inputs).toMatchObject({ selectedContractKey: `CHILD_DYNASTY:${dynasty}`, sourceRequestId: expect.any(String) })
  const legal = trace(run, year, 'A-LEG-01', pair)
  expect(legal).toMatchObject({ status: 'ACCEPT', candidates: [{ inputs: { sourceRequestId: inputs.sourceRequestId } }] })
  expect(registrations).toStrictEqual([linkedEvent(run, legal, 'MARRIAGE_REGISTER')])
  expect(marriages).toMatchObject([{ status: 'ACTIVE', registeredYear: year, contract: {
    contractId: legal.candidates[0]!.inputs.contractId,
    evidenceId: `evidence:nextgen-agreement:${b005.traceId}`,
    clauses: [{ kind: 'CHILD_LEGAL_DYNASTY', dynastyId: dynasty }],
  } }])
}

function directRun(seed: number, branchId: string, start = createMultiHouseWorld(), ledger: readonly StatModifier[] = []) {
  const result = runTimeline(start, {
    seed, branchId, evaluators: createMultiHouseEvaluators(start, ledger),
    goal: config.goal, technicalGoalEvaluation: config.technicalGoalEvaluation,
  })
  expect(result).toMatchObject({ status: 'COMPLETED', halt: null, goal: null, technicalGoal: { status: 'NOT_ACHIEVED' } })
  expect(result.snapshots.at(-1)?.year).toBe(config.endYear)
  return result
}

function checkCompleteHistory(actual: TimelineResult, direct: TimelineResult, parent?: TimelineResult) {
  const cp = direct.startYear - config.startYear
  expect(actual).toMatchObject({
    status: 'COMPLETED', halt: null, seed: direct.seed, branchId: direct.branchId, rngVersion: direct.rngVersion,
    startYear: config.startYear, goal: null,
  })
  expect(actual.transitions).toBe(config.endYear - config.startYear)
  expect(actual.technicalGoal).toStrictEqual(direct.technicalGoal)
  // 異なる構成や出典の混入を見落とさないよう、枝IDをそろえて全記録を比較する。
  expect(actual.snapshots).toStrictEqual([...(parent?.snapshots.slice(0, cp) ?? []), ...direct.snapshots])
  expect(actual.eventLog).toStrictEqual([...(parent?.eventLog.filter(e => e.year < direct.startYear) ?? []), ...direct.eventLog])
  expect(actual.decisionTraces).toStrictEqual([...(parent?.decisionTraces.filter(t => t.year < direct.startYear) ?? []), ...direct.decisionTraces])
}

const observationInput = { mode: MODE, seed: config.primarySeed, year: c1Year } as const
const browserInput = { ...inputOf(config.primarySeed, c1Year, c1Pair, 20), second: {
  firstPersonId: unverified[0], secondPersonId: unverified[1], signedDelta: 20, durationYears: 1,
} }

describe.skipIf(process.env.CHRONOFORK_LONG_MULTI_HOUSE_BROWSER !== '1')('複数家門ブラウザアダプターの実100年検証', () => {
  // AC1・AC2・AC3は観測で作った実A0と、C1の実介入を共有する。
  const cache = new SingleA0Cache()
  let entry: A0CacheEntry
  let firstObservation: Extract<ReturnType<typeof runPlayObservation>, { ok: true }>['observation']
  let comparison: PlayComparison
  const observedYears: number[] = []
  const forkProgress: PlayProgress[] = []
  let reused = 0

  beforeAll(() => {
    const put = vi.spyOn(cache, 'put')
    try {
      firstObservation = requireOk(runPlayObservation(observationInput, cache, p => observedYears.push(p.confirmedYear))).observation
      expect(put).toHaveBeenCalledTimes(1)
      entry = put.mock.calls[0]![0]
    } finally {
      put.mockRestore()
    }
    comparison = requireOk(runPlayComparison(browserInput, p => forkProgress.push(p), { cache, onA0Reused: () => { reused++ } })).comparison
  }, TIMEOUT)

  it('AC1: ブラウザのA0/A1/A2が複数家門構成の直接実行と1350年まで完全一致する', () => {
    const { a0, a1, root, branch, modifier, second } = comparison
    if (!second) throw new Error('A2が未計算')
    expect(comparison.mode).toBe(MODE)
    expect(root.ledger).toEqual([])
    expect(branch).toMatchObject({ lineage: [root.branchId, branch.branchId], forkYear: c1Year, ledger: [modifier] })
    expect(second.branch).toMatchObject({ lineage: [root.branchId, branch.branchId, second.branch.branchId], forkYear: c1Year })
    expect(second.branch.ledger).toHaveLength(2)
    expect(second.branch.ledger).toEqual(expect.arrayContaining([modifier, second.modifier]))
    expect(second.root).toBe(branch)
    expect(second.a0).toBe(a1)
    const provenance = { configId: config.configId, configDigest: multiHouseRunConfigDigest() }
    for (const run of [a0, a1, second.a1]) expect(run.inputs).toMatchObject(provenance)
    expect(firstObservation).toMatchObject(provenance)
    expect(modifier).toMatchObject({ targetRef: { kind: 'PERSON_PAIR', ids: c1Pair }, statKey: PAIR_TRUST_STAT_KEY,
      signedDelta: 20, startYear: c1Year, endExclusiveYear: c1Year + 1, decayPolicy: 'NONE', ruleVersion: STAT_MODIFIER_RULE_VERSION })

    const direct0 = directRun(config.primarySeed, 'A0-play')
    checkCompleteHistory(a0.result, direct0)
    const direct1 = directRun(config.primarySeed, 'A1-play', at(direct0, c1Year), [modifier])
    checkCompleteHistory(a1.result, direct1, direct0)
    const direct2 = directRun(config.primarySeed, 'A2-play', at(direct1, c1Year), [modifier, second.modifier])
    checkCompleteHistory(second.a1.result, direct2, a1.result)
  }, TIMEOUT)

  it('AC2/C1: 年初forkの信頼補正が合意・合法婚姻・出生・王朝帰属・称号継承につながる', () => {
    const { a0: { result: a0 }, a1: { result: a1 }, modifier } = comparison
    expect(at(a1, c1Year)).toStrictEqual(at(a0, c1Year))
    const b009 = trace(a0, c1Year, 'B-009', c1Pair)
    expect(b009.candidates[0]?.inputs.updatedBaseTrust).toBe(30)
    expect(trace(a1, c1Year, 'B-009', c1Pair)).toStrictEqual(b009)
    checkNegotiation(a0, c1Year, c1Pair, 30, mutual)
    checkNegotiation(a1, c1Year, c1Pair, 30, accepted, modifier)
    const rivalReview = trace(a0, c1Year, 'A-LEG-01', c1Rival)
    expect(rivalReview.status).toBe('ACCEPT')
    expect(linkedEvent(a0, rivalReview, 'MARRIAGE_REGISTER').involvedRefs.some(ref => samePair(ref, c1Rival))).toBe(true)
    expect(trace(a1, c1Year, 'B-005', c1Rival)).toMatchObject({ status: 'DEFER', reasonCodes: expect.arrayContaining([mutual]), eventIds: [] })
    expect(a1.decisionTraces.some(t => t.year > c1Year && t.modifierIds.includes(modifier.modifierId))).toBe(false)

    const child = at(a1, 1261).persons.find(p => p.motherId === c1Pair[0] && p.fatherId === c1Pair[1])!
    expect(child).toMatchObject({ birthYear: 1260, legalDynasty: { status: 'DETERMINED', dynastyId: dynasty } })
    expect(at(a0, config.endYear).persons.some(p => p.motherId === c1Pair[0] && p.fatherId === c1Pair[1])).toBe(false)
    const childTrace = (ruleId: RuleId) => a1.decisionTraces.find(t => t.year === child.birthYear && t.ruleId === ruleId &&
      t.actorRef.kind === 'PERSON' && t.actorRef.id === child.personId)!
    const birth = childTrace('B-002')
    const birthEvent = linkedEvent(a1, birth, 'PERSON_BIRTH')
    const dynastyTrace = childTrace('A-DYN-02')
    expect(dynastyTrace).toMatchObject({ status: 'ACCEPT', candidates: [{ inputs: {
      sourceB002TraceId: birth.traceId, sourceBirthEventIds: [birthEvent.eventId], dynastyId: dynasty,
    } }] })
    linkedEvent(a1, dynastyTrace, 'LEGAL_DYNASTY_SET')
    for (const [year, titleId] of [[1265, 'title-exp-west'], [1279, 'title-exp-south']] as const) {
      const caseId = `case:asuc04:auto:${JSON.stringify([year - 1, titleId])}`
      const review = (ruleId: RuleId) => a1.decisionTraces.find(t => t.year === year && t.ruleId === ruleId &&
        t.status === 'ACCEPT' && t.candidates[0]?.inputs.legalCaseId === caseId)!
      const authority = review('A-SUC-04')
      const decisionId = authority.candidates[0]?.inputs.decisionId
      expect(decisionId).toEqual(expect.any(String))
      linkedEvent(a1, authority, 'LEGAL_CASE_SET')
      const transfer = review('A-TIT-07')
      expect(transfer.candidates[0]?.inputs).toMatchObject({ successorPersonId: child.personId, sourceDecisionId: decisionId })
      expect(linkedEvent(a1, transfer, 'LEGAL_TITLE_TRANSFER').stateChanges).toContainEqual({
        path: `$.titles[${titleId}].holder.personId`, before: null, after: child.personId,
      })
      expect(at(a1, year + 1).titles.find(t => t.titleId === titleId)?.holder).toEqual({ status: 'HELD', personId: child.personId })
    }
  })

  describe('AC2/C2: 実ブラウザ入力の感度と正当な非変化', () => {
    const cases = [
      { seed: 20260202, year: 1252, pair: first, delta: 20, before: mutual, after: accepted },
      { seed: 20260101, year: 1252, pair: first, delta: 1, before: mutual, after: mutual },
      { seed: 20260101, year: 1252, pair: rival, delta: 20, before: 'CONTRACT_CHOICE_TIE', after: 'CONTRACT_CHOICE_TIE' },
      { seed: 20260303, year: 1253, pair: unverified, delta: 20, before: jurisdiction, after: jurisdiction },
    ] as const

    it.each(cases)('$seed / $year / $pair / pair.trust +$delta', ({ seed, year, pair, delta, before, after }) => {
      // 別seedのときも同じ実A0を保持したキャッシュから開始し、誤った再利用が起きないことを確認する。
      const caseCache = new SingleA0Cache()
      caseCache.put(entry)
      const { a0: { result: a0 }, a1: { result: a1 }, modifier, a0Source } = requireOk(
        runPlayComparison(inputOf(seed, year, pair, delta), undefined, { cache: caseCache }),
      ).comparison
      expect(a0Source).toBe(seed === config.primarySeed ? 'REUSED' : 'COMPUTED')
      expect(a0.seed).toBe(seed)
      expect(at(a1, year)).toStrictEqual(at(a0, year))
      expect(reviewDomesticMarriageEligibility(at(a0, year), pair)).toMatchObject(before === jurisdiction
        ? { status: 'DEFER', reasonCode: jurisdiction }
        : { status: 'ELIGIBLE', countryId: 'country-eldia' })
      const b009 = trace(a0, year, 'B-009', pair)
      expect(trace(a1, year, 'B-009', pair)).toStrictEqual(b009)
      const base = b009.candidates[0]?.inputs.updatedBaseTrust
      if (typeof base !== 'number') throw new Error('基礎信頼が未記録')
      checkNegotiation(a0, year, pair, base, before)
      checkNegotiation(a1, year, pair, base, after, modifier)
      if (pair === first) {
        const competing = trace(a0, year, 'B-004', rival)
        expect(trace(a1, year, 'B-004', rival)).toStrictEqual(competing)
        expect(competing.candidates[0]!.score!).toBeGreaterThan(base)
        if (after === accepted) {
          expect(base + delta).toBeGreaterThan(competing.candidates[0]!.score!)
          expect(trace(a1, year, 'B-005', rival)).toMatchObject({ status: 'DEFER', reasonCodes: expect.arrayContaining([mutual]) })
        } else expect(competing.candidates[0]!.score!).toBeGreaterThan(base + delta)
      }
      if (after === 'CONTRACT_CHOICE_TIE') {
        const options = trace(a1, year, 'B-005', pair).candidates[0]?.inputs.contractOptions
        if (!Array.isArray(options)) throw new Error('B-005の契約案が未記録')
        const agreed = options.filter(option => option.mutuallyAccepted === true)
        const top = Math.max(...agreed.map(option => option.minimumUtility))
        expect(agreed.filter(option => option.minimumUtility === top).map(option => option.key).sort()).toEqual([
          'CHILD_DYNASTY:dynasty-cardon', 'CHILD_DYNASTY:dynasty-vargas',
        ])
      }
      if (before === after) {
        expect(at(a1, year + 1)).toStrictEqual(at(a0, year + 1))
        expect(a1.eventLog.filter(e => e.year === year)).toStrictEqual(a0.eventLog.filter(e => e.year === year))
      }
    }, TIMEOUT)
  })

  it('AC3: 年を変更した観測と比較が同じ実A0を再利用し、同じ入力の再実行は決定的', () => {
    expect(firstObservation).toMatchObject({ mode: MODE, seed: config.primarySeed, year: c1Year, a0Source: 'COMPUTED', goal: null })
    expect(observedYears).toEqual(Array.from({ length: 100 }, (_, i) => config.startYear + i + 1))
    expect(firstObservation.world).toBe(at(entry.a0.result, c1Year))
    expect(firstObservation.events).toStrictEqual(entry.a0.result.eventLog.filter(e => e.year === c1Year))
    expect(firstObservation.traces).toStrictEqual(entry.a0.result.decisionTraces.filter(t => t.year === c1Year))
    const progress = vi.fn()
    const ending = requireOk(runPlayObservation({ ...observationInput, year: config.endYear }, cache, progress)).observation
    expect(ending).toMatchObject({ a0Source: 'REUSED', year: config.endYear, status: 'COMPLETED', goal: null, events: [], traces: [] })
    expect(ending.world).toBe(at(entry.a0.result, config.endYear))
    expect(ending.technicalGoal).toStrictEqual(entry.a0.result.technicalGoal)
    expect(progress).not.toHaveBeenCalled()
    expect(comparison.a0Source).toBe('REUSED')
    expect(comparison.root).toBe(entry.root)
    expect(comparison.a0).toBe(entry.a0)
    expect(reused).toBe(1)
    expect(forkProgress.filter(p => p.branch === 'A0')).toEqual([])
    for (const branch of ['A1', 'A2']) {
      expect(forkProgress.filter(p => p.branch === branch).map(p => p.confirmedYear)).toEqual(
        Array.from({ length: config.endYear - c1Year }, (_, i) => c1Year + i + 1),
      )
    }
    const replay = requireOk(runPlayComparison(browserInput, undefined, { cache })).comparison
    expect(replay.branch).toStrictEqual(comparison.branch)
    expect(replay.second?.branch).toStrictEqual(comparison.second?.branch)
  }, TIMEOUT)

  it('AC3: 同seedでも旧モードのキーには複数家門の実A0を渡さない', () => {
    expect(JSON.parse(entry.key)).toEqual(expect.arrayContaining([expect.objectContaining({
      mode: MODE, seed: config.primarySeed, multiHouse: multiHouseRunConfigIdentity(),
    })]))
    for (const mode of ['INTEGRATED_EXPERIMENTAL', 'ORDINARY_LAW', 'FIXED_APPROVAL'] as const) {
      const probeCache = new SingleA0Cache()
      probeCache.put(entry)
      // 旧統合構成の100年計算を重複実行せず、実際に生成されたキーを取り出す。
      const lookup = vi.spyOn(probeCache, 'get').mockImplementationOnce(() => { throw new Error('STOP_AFTER_CACHE_LOOKUP') })
      expect(runPlayComparison({ ...browserInput, mode }, undefined, { cache: probeCache })).toMatchObject({
        ok: false, code: 'CALCULATION_EXCEPTION', message: 'STOP_AFTER_CACHE_LOOKUP',
      })
      expect(lookup).toHaveBeenCalledTimes(1)
      const [key] = lookup.mock.calls[0]!
      lookup.mockRestore()
      expect(key).not.toBe(entry.key)
      expect(probeCache.get(key)).toBeUndefined()
      expect(probeCache.size).toBe(0)
    }
  })

  it('AC3: 年初の出生境界・SUPPORTING・別枝を候補に混ぜず、改変枝だけの人物を原史の介入対象にしない', () => {
    const { a0: { result: a0 }, a1: { result: a1 } } = comparison
    const set = firstObservation.candidates
    expect(set.configDigest).toBe(multiHouseRunConfigDigest())
    expect(candidateSetMatches(set, config.primarySeed, MODE)).toBe(true)
    expect(candidateSetMatches({ ...set, configDigest: 'stale-config' }, config.primarySeed, MODE)).toBe(false)
    expect(candidateSetMatches(set, config.primarySeed, 'INTEGRATED_EXPERIMENTAL')).toBe(false)
    expect(candidateSetMatches(set, config.extraSeeds[0], MODE)).toBe(false)
    const ids = (year: number) => candidatesAtYear(set, year).map(c => c.id).sort()
    for (const world of a0.snapshots) {
      expect(ids(world.year)).toEqual(world.persons.filter(p => p.interactionRole !== 'SUPPORTING').map(p => p.personId).sort())
    }
    const initialIds = new Set(at(a0, config.startYear).persons.map(p => p.personId))
    const later = set.candidates.find(c => !initialIds.has(c.id))!
    expect(later).toBeDefined()
    expect(ids(later.birthYear)).not.toContain(later.id)
    expect(ids(later.birthYear + 1)).toContain(later.id)
    const branchChild = at(a1, 1261).persons.find(p => p.motherId === c1Pair[0] && p.fatherId === c1Pair[1])!
    expect(extractCandidates(config.primarySeed, MODE, a1.snapshots).candidates.some(c => c.id === branchChild.personId)).toBe(true)
    expect(set.candidates.some(c => c.id === branchChild.personId)).toBe(false)
    expect(at(a0, c1Year).persons.some(p => p.personId === agePeer)).toBe(false)
    expect(at(a0, c1Year + 1).persons.find(p => p.personId === agePeer)?.interactionRole).toBe('SUPPORTING')
    for (const [year, target, code] of [
      [c1Year, agePeer, 'UNKNOWN_PERSON'],
      [c1Year + 1, agePeer, 'SUPPORTING_PERSON_NOT_DIRECTLY_INTERACTABLE'],
      [later.birthYear, later.id, 'UNKNOWN_PERSON'],
      [1261, branchChild.personId, 'UNKNOWN_PERSON'],
      [config.endYear, c1Pair[1], 'INVALID_YEAR'],
    ] as const) {
      expect(runPlayComparison(inputOf(config.primarySeed, year, [c1Pair[0], target], 20), undefined, { cache })).toMatchObject({ ok: false, code })
    }
    const nextYear = later.birthYear + 1
    const bornKeyFork = requireOk(runPlayComparison(inputOf(config.primarySeed, nextYear, [c1Pair[0], later.id], 20), undefined, { cache })).comparison
    expect(bornKeyFork.root).toBe(entry.root)
    expect(bornKeyFork.branch.forkYear).toBe(nextYear)
    expect(bornKeyFork.modifier.targetRef).toEqual({ kind: 'PERSON_PAIR', ids: [c1Pair[0], later.id].sort() })
  }, TIMEOUT)
})
