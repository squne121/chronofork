import { expect, it } from 'vitest'
import {
  createMultiHouseEvaluators, createMultiHouseWorld,
} from '../../../src/scenario/experimental/multi-house-playtest.ts'
import { PAIR_TRUST_STAT_KEY, STAT_MODIFIER_RULE_VERSION } from '../../../src/simulation/contracts/index.ts'
import type { RuleId, StatModifier, TargetRef } from '../../../src/simulation/contracts/index.ts'
import { runYear } from '../../../src/simulation/engine/index.ts'
import { addStatModifier } from '../../../src/simulation/intervention/index.ts'
import { reviewDomesticMarriageEligibility } from '../../../src/simulation/legal/nextgen-marriage.ts'

type Pair = readonly [string, string]
const first = ['person-exp-01', 'person-exp-05'] as const
const rival = ['person-exp-04', 'person-exp-05'] as const
const unverified = ['person-exp-05', 'person-exp-07'] as const
const samePair = (ref: TargetRef, pair: Pair) =>
  ref.kind === 'PERSON_PAIR' && ref.ids[0] === pair[0] && ref.ids[1] === pair[1]

function replay(seed: number, year: number, ledger: readonly StatModifier[]) {
  const initial = createMultiHouseWorld()
  const options = { seed, branchId: 'c2', evaluators: createMultiHouseEvaluators(initial, ledger) }
  let start = initial
  const prefix = []
  for (let y = initial.year; y <= year; y++) {
    const result = runYear(start, options)
    if (result.status !== 'COMPLETED') throw new Error(JSON.stringify(result.halt))
    if (y === year) return { start, prefix, result }
    prefix.push(result)
    start = result.world
  }
  throw new Error(`判断年が開始年より前: ${year}`)
}

type Replay = ReturnType<typeof replay>
function trace(run: Replay, ruleId: RuleId, pair: Pair) {
  const matches = run.result.traces.filter(t => t.ruleId === ruleId && samePair(t.actorRef, pair))
  expect(matches).toHaveLength(1)
  return matches[0]!
}

// 介入前に観測した競合、契約同率、管轄未確認を固定。同じ数値でも法的条件は変わらない。
const cases = [
  { seed: 20260202, year: 1252, pair: first, delta: 20, before: 'MUTUAL_UNIQUE_PARTNER_NOT_ESTABLISHED', after: 'BOTH_PARTIES_ACCEPT_UNIQUE_CONTRACT' },
  { seed: 20260101, year: 1252, pair: first, delta: 1, before: 'MUTUAL_UNIQUE_PARTNER_NOT_ESTABLISHED', after: 'MUTUAL_UNIQUE_PARTNER_NOT_ESTABLISHED' },
  { seed: 20260101, year: 1252, pair: rival, delta: 20, before: 'CONTRACT_CHOICE_TIE', after: 'CONTRACT_CHOICE_TIE' },
  { seed: 20260303, year: 1253, pair: unverified, delta: 20, before: 'SAME_COUNTRY_JURISDICTION_UNVERIFIED', after: 'SAME_COUNTRY_JURISDICTION_UNVERIFIED' },
] as const

it.each(cases)('C2: $seed / $year / $pair / pair.trust +$delta', ({ seed, year, pair, delta, before, after }) => {
  const a0 = replay(seed, year, [])
  const modifier = {
    modifierId: 'c2-trust', interventionId: 'c2', targetRef: { kind: 'PERSON_PAIR', ids: pair },
    statKey: PAIR_TRUST_STAT_KEY, signedDelta: delta, startYear: year, endExclusiveYear: year + 1,
    decayPolicy: 'NONE', ruleVersion: STAT_MODIFIER_RULE_VERSION,
  } satisfies StatModifier
  const accepted = addStatModifier([], modifier, { knownPersonIds: new Set(a0.start.persons.map(p => p.personId)) })
  expect(accepted).toMatchObject({ ok: true, outcome: 'ADDED', ledger: [modifier] })
  if (!accepted.ok) throw new Error(JSON.stringify(accepted.issues))
  const a1 = replay(seed, year, accepted.ledger)
  expect(a1.prefix).toStrictEqual(a0.prefix)
  expect(a1.start).toStrictEqual(a0.start)
  expect(a1.result.executedRuleIds).toStrictEqual(a0.result.executedRuleIds)

  const b009 = trace(a0, 'B-009', pair)
  expect(trace(a1, 'B-009', pair)).toStrictEqual(b009)
  const base = b009.candidates[0]?.inputs.updatedBaseTrust
  expect(typeof base).toBe('number')
  if (typeof base !== 'number') throw new Error('B-009の基礎信頼が未記録')
  const legalEligible = before !== 'SAME_COUNTRY_JURISDICTION_UNVERIFIED'
  expect(reviewDomesticMarriageEligibility(a0.start, pair)).toMatchObject(legalEligible
    ? { status: 'ELIGIBLE', countryId: 'country-eldia' }
    : { status: 'DEFER', reasonCode: before })

  if (pair === first) {
    const competing = trace(a0, 'B-004', rival)
    expect(competing).toMatchObject({ status: 'ACCEPT', modifierIds: [], candidates: [{ inputs: { rawModifierSum: 0 } }] })
    expect(trace(a1, 'B-004', rival)).toStrictEqual(competing)
    expect(trace(a0, 'B-005', rival)).toMatchObject({ status: 'DEFER', reasonCodes: expect.arrayContaining(['CONTRACT_CHOICE_TIE']) })
  }

  for (const [run, adjustment, reason] of [[a0, 0, before], [a1, delta, after]] as const) {
    const b004 = trace(run, 'B-004', pair)
    const b005 = trace(run, 'B-005', pair)
    const successful = reason === 'BOTH_PARTIES_ACCEPT_UNIQUE_CONTRACT'
    expect(b004).toMatchObject({
      status: 'ACCEPT', modifierIds: adjustment ? [modifier.modifierId] : [],
      candidates: [{ score: base + adjustment, inputs: { baseTrust: base, effectiveTrust: base + adjustment, rawModifierSum: adjustment } }],
    })
    expect(b005).toMatchObject({
      status: successful ? 'ACCEPT' : 'DEFER', modifierIds: b004.modifierIds, eventIds: [],
      candidates: [{ inputs: { sourceB004TraceId: b004.traceId, sourceB004Score: base + adjustment } }],
    })
    expect(b005.reasonCodes).toContain(reason)
    const inputs = b005.candidates[0]!.inputs
    const registrations = run.result.events.filter(e => e.eventType.split('+').includes('MARRIAGE_REGISTER') &&
      e.involvedRefs.some(ref => samePair(ref, pair)))
    const marriages = run.result.world.legal.marriages.filter(m => m.personIds[0] === pair[0] && m.personIds[1] === pair[1])
    if (!successful) {
      expect(inputs.sourceRequestId).toBeNull()
      expect(inputs.selectedContractKey).toBeNull()
      expect(run.result.traces.some(t => t.ruleId === 'A-LEG-01' && samePair(t.actorRef, pair))).toBe(false)
      expect(registrations).toEqual([])
      expect(marriages).toEqual([])
      if (reason === 'MUTUAL_UNIQUE_PARTNER_NOT_ESTABLISHED') {
        expect(trace(run, 'B-004', rival).candidates[0]!.score).toBeGreaterThan(base + adjustment)
      }
      if (reason === 'CONTRACT_CHOICE_TIE') {
        const options = inputs.contractOptions
        if (!Array.isArray(options)) throw new Error('B-005の契約案が未記録')
        const agreed = options.filter(option => option.mutuallyAccepted === true)
        const top = Math.max(...agreed.map(option => option.minimumUtility))
        expect(agreed.filter(option => option.minimumUtility === top).map(option => option.key).sort())
          .toEqual(['CHILD_DYNASTY:dynasty-cardon', 'CHILD_DYNASTY:dynasty-vargas'])
      }
      continue
    }
    expect(base + adjustment).toBeGreaterThan(trace(run, 'B-004', rival).candidates[0]!.score!)
    expect(trace(run, 'B-005', rival)).toMatchObject({ status: 'DEFER', reasonCodes: expect.arrayContaining(['MUTUAL_UNIQUE_PARTNER_NOT_ESTABLISHED']) })
    const selected = 'CHILD_DYNASTY:dynasty-nalven'
    expect(inputs.selectedContractKey).toBe(selected)
    expect(inputs.contractOptions).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: selected, mutuallyAccepted: true }),
    ]))
    expect(inputs.sourceRequestId).toEqual(expect.any(String))
    const legal = trace(run, 'A-LEG-01', pair)
    expect(legal).toMatchObject({ status: 'ACCEPT', candidates: [{ inputs: { sourceRequestId: inputs.sourceRequestId } }] })
    expect(registrations).toMatchObject([{ year, sourceTraceIds: [legal.traceId] }])
    expect(legal.eventIds).toEqual([registrations[0]!.eventId])
    expect(marriages).toMatchObject([{ status: 'ACTIVE', registeredYear: year, contract: {
      evidenceId: `evidence:nextgen-agreement:${b005.traceId}`, clauses: [{ kind: 'CHILD_LEGAL_DYNASTY', dynastyId: 'dynasty-nalven' }],
    } }])
  }
  if (before === after) {
    expect(a1.result.world).toStrictEqual(a0.result.world)
    expect(a1.result.events).toStrictEqual(a0.result.events)
  }
})
