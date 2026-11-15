// Session C: fast counterexamples before a human playtest. No changes to game rules.
// The 1250 world and coefficients are CALIBRATION_ONLY, not approved historical facts.
import { describe, expect, it } from 'vitest'
import {
  createExperimentalIntegratedWorld, createExperimentalIntegratedEvaluators,
  INTEGRATED_SEED, INTEGRATED_TRUST_REDUCTION, NALVEN_DYNASTY_ID,
} from '../../../src/scenario/experimental/index.ts'
import { runYear } from '../../../src/simulation/engine/index.ts'
import { evaluateGoal } from '../../../src/simulation/goal.ts'
import { validateWorldState } from '../../../src/simulation/validation/index.ts'
import {
  auditWorld, auditTransition, classifyHolderDeaths,
} from './audit-fixture.ts'

describe('Session C / GAME-02: actual world and causality smoke audit', () => {
  it('initial WorldState has no independently detectable broken references', () => {
    const world = createExperimentalIntegratedWorld()
    expect(validateWorldState(world).ok).toBe(true)
    expect(auditWorld(world)).toEqual([])
  })

  // Every seed is executed explicitly (no random sampling that could skip one).
  const SEEDS = [...new Set([20260101, 20260102, 20261028, INTEGRATED_SEED])]
  it.each(SEEDS)('seed %i: 3 consecutive years reproduce WorldState, EventLog and DecisionTrace', seed => {
    const initial = createExperimentalIntegratedWorld()
    const snapshot = JSON.stringify(initial)
    const run = () => {
      const evaluators = createExperimentalIntegratedEvaluators(initial, []) // fresh instance: no cache can fake equality
      let world = initial
      const years: { world: unknown; events: unknown; traces: unknown }[] = []
      for (let step = 0; step < 3; step++) {
        const r = runYear(world, { seed, branchId: 'viability-A0', evaluators })
        expect(r.status, 'seed=' + seed + '; year=' + world.year + '; halt=' +
          JSON.stringify(r.status === 'HALTED' ? r.halt : null)).toBe('COMPLETED')
        if (r.status !== 'COMPLETED') break
        expect(validateWorldState(r.world).ok).toBe(true)
        expect(auditWorld(r.world), 'seed=' + seed + '; year=' + world.year).toEqual([])
        expect(auditTransition(world, r.world, r.events, r.traces), 'seed=' + seed + '; year=' + world.year)
          .toEqual([])
        years.push({ world: r.world, events: r.events, traces: r.traces })
        world = r.world
      }
      return years
    }
    const first = run(), second = run()
    expect(JSON.stringify(initial), 'input WorldState must not be mutated').toBe(snapshot)
    expect(first).toHaveLength(3)
    first.forEach((y, i) => {
      expect(y.world, 'seed=' + seed + '; step=' + i + '; WorldState').toEqual(second[i]!.world)
      expect(y.events, 'seed=' + seed + '; step=' + i + '; EventLog').toEqual(second[i]!.events)
      expect(y.traces, 'seed=' + seed + '; step=' + i + '; DecisionTrace').toEqual(second[i]!.traces)
    })
  })

  it('a legal numeric intervention reaches a decision trace without directly mutating Title, Country, control or resources', () => {
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
    // pair.trust may only be consumed by relationship decisions (B domain), never by Title/Country/D rules.
    expect(new Set(observed.map(t => t.ruleId)), 'rules that consumed the modifier')
      .toEqual(new Set(observed.map(t => t.ruleId).filter(id => id.startsWith('B-'))))
    // Direct-effect surfaces in the intervention year. Later, autonomous (traced) divergence is legitimate.
    expect(a1.world.titles).toEqual(a0.world.titles)
    expect(a1.world.countries).toEqual(a0.world.countries)
    expect(a1.world.regions).toEqual(a0.world.regions)
    expect(a1.world.legal.taxMandates).toEqual(a0.world.legal.taxMandates)
    expect(a1.world.legal.controlMandates).toEqual(a0.world.legal.controlMandates)
    expect(a1.world.resources).toEqual(a0.world.resources)
    expect(a1.world.groups).toEqual(a0.world.groups)
    expect(auditTransition(initial, a1.world, a1.events, a1.traces)).toEqual([])
    // Any Event that differs from A0 must be traceable to an accepted decision.
    const a0Keys = new Set(a0.events.map(e => e.semanticEventKey))
    for (const event of a1.events.filter(e => !a0Keys.has(e.semanticEventKey)))
      expect(event.sourceTraceIds.length, event.eventId).toBeGreaterThan(0)
  })

  describe('CROWN alone never satisfies the strict territorial 1350 goal', () => {
    // Every other Goal condition is satisfied for the CROWN holder, so only the Title kind can fail.
    const crownOnlyWorld = (kind: 'CROWN' | 'TERRITORIAL') => {
      const base = createExperimentalIntegratedWorld()
      const crown = base.titles.find(t => t.kind === 'CROWN')!
      const holderId = crown.holder.status === 'HELD' ? crown.holder.personId : ''
      const region = base.regions.find(r => r.regionId === crown.regionId)!
      return {
        ...base, year: 1350,
        titles: [{ ...crown, kind, recognition: { ...crown.recognition, sovereignCountryId: region.sovereignCountryId } }],
        regions: base.regions.map(r => r.regionId === crown.regionId
          ? { ...r, deFactoControllerRef: { kind: 'PERSON' as const, id: holderId } } : r),
      }
    }
    it('positive control: the same holder/region/recognition as TERRITORIAL is ACHIEVED', () => {
      const result = evaluateGoal(crownOnlyWorld('TERRITORIAL'), { dynastyId: NALVEN_DYNASTY_ID })
      expect(result.status, JSON.stringify(result)).toBe('ACHIEVED')
    })
    it('CROWN fails with NOT_TERRITORIAL as the only failure', () => {
      const result = evaluateGoal(crownOnlyWorld('CROWN'), { dynastyId: NALVEN_DYNASTY_ID })
      expect(result.status, JSON.stringify(result)).toBe('NOT_ACHIEVED')
      if (result.status !== 'NOT_ACHIEVED') return
      expect(result.assessments).toHaveLength(1)
      expect(result.assessments[0]?.failures).toEqual(['NOT_TERRITORIAL'])
    })
  })

  it('1250-1274: births, deaths, population, succession and Title/ruler references stay coherent every year', () => {
    let world = createExperimentalIntegratedWorld()
    const evaluators = createExperimentalIntegratedEvaluators(world, [])
    const counterexamples: unknown[] = []
    const holderDeaths: unknown[] = []
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
      const outcomes = classifyHolderDeaths(world, result.world)
      holderDeaths.push(...outcomes)
      const problems = [
        ...auditWorld(result.world),
        ...auditTransition(world, result.world, result.events, result.traces),
        ...outcomes.filter(o => o.outcome === 'STALE_DEAD_HOLDER').map(o => ({
          year: o.year, code: 'DEAD_HOLDER_NOT_RESOLVED', subjectId: o.titleId, detail: o.deadPersonId })),
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
    expect(holderDeaths.length, 'the window must actually exercise a Title-holder death').toBeGreaterThan(0)
  }, 120000)
})
