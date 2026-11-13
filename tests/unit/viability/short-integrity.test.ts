// Session C: fast counterexamples before a human playtest. No changes to game rules.
// The 1250 world and coefficients are CALIBRATION_ONLY, not approved historical facts.
import { describe, expect, it } from 'vitest'
import fc from 'fast-check'
import {
  createExperimentalIntegratedWorld, createExperimentalIntegratedEvaluators,
  INTEGRATED_SEED, INTEGRATED_TRUST_REDUCTION, NALVEN_DYNASTY_ID,
} from '../../../src/scenario/experimental/index.ts'
import { runYear } from '../../../src/simulation/engine/index.ts'
import { evaluateGoal } from '../../../src/simulation/goal.ts'
import { validateWorldState } from '../../../src/simulation/validation/index.ts'
import {
  auditWorld, auditEventTraceLinks, auditApprovedTransfers,
} from './audit-fixture.ts'

describe('Session C / GAME-02: actual world and causality smoke audit', () => {
  it('initial WorldState has no independently detectable broken references', () => {
    const world = createExperimentalIntegratedWorld()
    expect(validateWorldState(world).ok).toBe(true)
    expect(auditWorld(world)).toEqual([])
  })

  it('fixed seeds reproduce WorldState, EventLog and DecisionTrace, not merely a final flag', () => {
    fc.assert(fc.property(fc.constantFrom(20260101, 20260102, 20261028), seed => {
      const initial = createExperimentalIntegratedWorld()
      const execute = () => runYear(initial, {
        seed, branchId: 'viability-A0',
        evaluators: createExperimentalIntegratedEvaluators(initial, []),
      })
      const first = execute(), second = execute()
      expect(first, 'seed=' + seed).toEqual(second)
      expect(first.status, 'seed=' + seed + '; halt=' + JSON.stringify(first.status === 'HALTED' ? first.halt : null))
        .toBe('COMPLETED')
      if (first.status !== 'COMPLETED') return
      expect(validateWorldState(first.world).ok).toBe(true)
      expect(auditWorld(first.world)).toEqual([])
      expect(auditEventTraceLinks(initial.year, first.events, first.traces)).toEqual([])
      expect(auditApprovedTransfers(initial, first.world, first.events)).toEqual([])
    }), { seed: 71120, numRuns: 3 })
  })

  it('a legal numeric intervention reaches an actual decision trace without changing unrelated 1250 resources', () => {
    const initial = createExperimentalIntegratedWorld()
    const execute = (withModifier: boolean) => runYear(initial, {
      seed: INTEGRATED_SEED, branchId: 'viability-A0',
      evaluators: createExperimentalIntegratedEvaluators(initial,
        withModifier ? [INTEGRATED_TRUST_REDUCTION] : []),
    })
    const a0 = execute(false), a1 = execute(true)
    expect(execute(true)).toEqual(a1) // same seed + same legal numeric intervention
    expect(a0.status).toBe('COMPLETED')
    expect(a1.status).toBe('COMPLETED')
    if (a0.status !== 'COMPLETED' || a1.status !== 'COMPLETED') return
    const observed = a1.traces.filter(t => t.modifierIds.includes(INTEGRATED_TRUST_REDUCTION.modifierId))
    expect(observed.length).toBeGreaterThan(0)
    expect(a0.traces.every(t => !t.modifierIds.includes(INTEGRATED_TRUST_REDUCTION.modifierId))).toBe(true)
    // No direct Title, sovereignty, tax or treasury mutation may be smuggled in by pair.trust.
    expect(a1.world.regions).toEqual(a0.world.regions)
    expect(a1.world.legal.taxMandates).toEqual(a0.world.legal.taxMandates)
    expect(a1.world.resources).toEqual(a0.world.resources)
    expect(auditEventTraceLinks(initial.year, a1.events, a1.traces)).toEqual([])
    // A change in decision inputs is evidence of an intervention; a different final result is not assumed.
  })

  it('CROWN alone never satisfies the strict territorial 1350 goal', () => {
    const base = createExperimentalIntegratedWorld()
    const world = {
      ...base, year: 1350,
      titles: base.titles.map(t => t.kind === 'TERRITORIAL'
        ? { ...t, holder: { status: 'UNDETERMINED' as const } } : t),
    }
    const result = evaluateGoal(world, { dynastyId: NALVEN_DYNASTY_ID })
    expect(result.status).toBe('NOT_ACHIEVED')
    if (result.status === 'NOT_ACHIEVED') {
      for (const title of base.titles.filter(t => t.kind === 'CROWN')) {
        const assessment = result.assessments.find(a => a.titleId === title.titleId)
        expect(assessment?.failures).toContain('NOT_TERRITORIAL')
      }
    }
  })

  it('1250-1274: death -> succession -> Title and ruler references remain coherent every year', () => {
    let world = createExperimentalIntegratedWorld()
    const evaluators = createExperimentalIntegratedEvaluators(world, [])
    const counterexamples: unknown[] = []
    // The reported dead CROWN holder becomes visible around 1269/1270; keep this probe bounded.
    for (let step = 0; step < 24; step++) {
      const result = runYear(world, {
        seed: INTEGRATED_SEED, branchId: 'viability-A0', evaluators,
      })
      if (result.status === 'HALTED') {
        counterexamples.push({ seed: INTEGRATED_SEED, processYear: world.year,
          invariant: 'ANNUAL_RUN_COMPLETES', halt: result.halt })
        break
      }
      const problems = [
        ...auditWorld(result.world),
        ...auditEventTraceLinks(world.year, result.events, result.traces),
        ...auditApprovedTransfers(world, result.world, result.events),
      ]
      if (problems.length && counterexamples.length < 6) counterexamples.push({
        seed: INTEGRATED_SEED, processYear: world.year, confirmedYear: result.world.year,
        violations: problems.slice(0, 8),
        events: result.events.filter(e => ['PERSON_DEATH', 'LEGAL_CASE_SET', 'LEGAL_TITLE_TRANSFER']
          .some(k => e.eventType.includes(k))).slice(0, 8),
        traces: result.traces.filter(t => ['B-003', 'A-SUC-04', 'A-TIT-07']
          .includes(t.ruleId)).slice(0, 8),
      })
      world = result.world
    }
    expect(counterexamples, 'Seed/event/trace reproduction evidence for Session A and B')
      .toEqual([])
    expect(world.year).toBe(1274)
  }, 120000)
})
