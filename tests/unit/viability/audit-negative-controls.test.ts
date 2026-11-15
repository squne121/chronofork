// Session C: the auditors must actually fail on corrupted real transitions (no false negatives).
// Each case takes a REAL runYear transition and corrupts exactly one thing; nothing here changes game rules.
import { describe, expect, it } from 'vitest'
import type { DecisionTrace, EventLogEntry, WorldState } from '../../../src/simulation/contracts/index.ts'
import {
  createExperimentalIntegratedWorld, createExperimentalIntegratedEvaluators, INTEGRATED_SEED,
} from '../../../src/scenario/experimental/index.ts'
import { validateWorldState } from '../../../src/simulation/validation/index.ts'
import { runYear } from '../../../src/simulation/engine/index.ts'
import {
  auditApprovedTransfers, auditDeathCausality, auditPopulationConservation, auditTransition, auditWorld,
  classifyHolderDeaths, digestHistory, firstDivergence, refId,
} from './audit-fixture.ts'

type Transition = Readonly<{
  before: WorldState; after: WorldState; events: readonly EventLogEntry[]; traces: readonly DecisionTrace[]
}>

/** Real 1250..1273 transitions, computed once (24 cheap years). */
const transitions: Transition[] = (() => {
  let world = createExperimentalIntegratedWorld()
  const evaluators = createExperimentalIntegratedEvaluators(world, [])
  const out: Transition[] = []
  for (let i = 0; i < 24; i++) {
    const r = runYear(world, { seed: INTEGRATED_SEED, branchId: 'viability-A0', evaluators })
    if (r.status !== 'COMPLETED') throw new Error('baseline halted at ' + world.year)
    out.push({ before: world, after: r.world, events: r.events, traces: r.traces })
    world = r.world
  }
  return out
})()
const has = (e: EventLogEntry, t: string) => e.eventType.split('+').includes(t)
const find = (pred: (t: Transition) => boolean) => {
  const t = transitions.find(pred)
  if (!t) throw new Error('no real transition matches; control cannot be exercised')
  return t
}
const codes = (xs: readonly { code: string }[]) => [...new Set(xs.map(x => x.code))]

describe('Session C negative controls on real transitions', () => {
  it('uncorrupted real transitions have no population/death/transfer findings', () => {
    for (const t of transitions) {
      const issues = [
        ...auditPopulationConservation(t.before, t.after, t.events, t.traces),
        ...auditDeathCausality(t.before, t.after, t.events, t.traces),
        ...auditApprovedTransfers(t.before, t.after, t.events, t.traces),
      ]
      expect(issues, 'year=' + t.before.year).toEqual([])
    }
  })

  describe('population conservation', () => {
    const t = find(x => x.events.some(e => has(e, 'PERSON_BIRTH')))
    it('detects a population change that no C-004 Event explains', () => {
      const after = { ...t.after, groups: t.after.groups.map((g, i) => i === 0 ? { ...g, population: g.population + 1 } : g) }
      expect(codes(auditPopulationConservation(t.before, after, t.events, t.traces)))
        .toContain('POPULATION_CHANGE_NOT_EXPLAINED_BY_EVENTS')
    })
    it('detects a named birth that also adds to group population (double count)', () => {
      const group = t.after.groups.find(g => t.events.some(e => has(e, 'PERSON_BIRTH') &&
        e.involvedRefs.some(r => r.kind === 'GROUP' && r.id === g.groupId)))!
      const events = t.events.map(e => has(e, 'PERSON_BIRTH') ? { ...e, stateChanges: [...e.stateChanges,
        { path: '$.groups[' + group.groupId + '].population', before: group.population, after: group.population + 1 }] } : e)
      const after = { ...t.after, groups: t.after.groups.map(g => g.groupId === group.groupId ? { ...g, population: g.population + 1 } : g) }
      expect(codes(auditPopulationConservation(t.before, after, events, t.traces)))
        .toContain('POPULATION_CHANGED_BY_NON_POPULATION_EVENT')
    })
    it('detects a named birth with no claimed cohort slot / a person added without a birth Event', () => {
      const births = t.events.filter(e => has(e, 'PERSON_BIRTH'))
      const events = t.events.filter(e => e !== births[0])
      const found = codes(auditPopulationConservation(t.before, t.after, events, t.traces))
      expect(found).toContain('PERSON_ADDED_WITHOUT_CREATION_EVENT')
    })
    it('detects a natural death that exceeds the claimed slot', () => {
      const d = find(x => x.events.some(e => has(e, 'PERSON_DEATH')))
      // A second death record that does not consume a claimed slot is an unbacked individual death.
      const doubled = [...d.events, ...d.events.filter(e => has(e, 'PERSON_DEATH')).map(e => ({
        ...e, eventId: e.eventId + ':dup', stateChanges: e.stateChanges.filter(c => !c.path.endsWith('.claimedDeaths')) }))]
      expect(codes(auditPopulationConservation(d.before, d.after, doubled, d.traces)))
        .toContain('NAMED_DEATHS_NOT_EQUAL_CLAIMED_SLOT')
    })
  })

  it('a supporting-record Event that moves group population is rejected like any other individual record', () => {
    const t = find(x => x.events.some(e => has(e, 'PERSON_BIRTH')))
    const group = t.after.groups[0]!
    const events = t.events.map(e => has(e, 'PERSON_BIRTH') ? { ...e, eventType: 'PERSON_SUPPORTING_RECORD',
      stateChanges: [...e.stateChanges, { path: '$.groups[' + group.groupId + '].population', before: group.population, after: group.population + 1 }] } : e)
    expect(codes(auditPopulationConservation(t.before, t.after, events, t.traces))).toContain('POPULATION_CHANGED_BY_NON_POPULATION_EVENT')
  })

  describe('death causality', () => {
    const t = find(x => x.events.some(e => has(e, 'PERSON_DEATH')))
    const death = t.events.find(e => has(e, 'PERSON_DEATH'))!
    it('detects alive -> dead without a B-003 Event', () => {
      expect(codes(auditDeathCausality(t.before, t.after, t.events.filter(e => e !== death), t.traces)))
        .toContain('DEATH_WITHOUT_SINGLE_B003_EVENT')
    })
    it('detects a mismatched death year', () => {
      const id = refId(death.involvedRefs, 'PERSON')
      const after = { ...t.after, persons: t.after.persons.map(p => p.personId === id ? { ...p, deathYear: (p.deathYear ?? 0) + 1 } : p) }
      expect(codes(auditDeathCausality(t.before, after, t.events, t.traces))).toContain('DEATH_YEAR_MISMATCH')
    })
    it('detects a missing or non-ACCEPT B-003 Trace', () => {
      const traces = t.traces.map(x => death.sourceTraceIds.includes(x.traceId) ? { ...x, status: 'REJECT' as const } : x)
      expect(codes(auditDeathCausality(t.before, t.after, t.events, traces)))
        .toContain('DEATH_EVENT_WITHOUT_ACCEPTED_B003_TRACE')
    })
    it('detects resurrection of an already dead person', () => {
      const later = find(x => x.before.persons.some(p => !p.alive))
      const dead = later.before.persons.find(p => !p.alive)!
      const after = { ...later.after, persons: later.after.persons.map(p => p.personId === dead.personId ? { ...p, alive: true, deathYear: undefined } : p) }
      expect(codes(auditDeathCausality(later.before, after, later.events, later.traces))).toContain('DEAD_PERSON_REVIVED')
    })
    it('detects a dead Title holder in the world audit (synthetic, independent of known defects)', () => {
      const base = createExperimentalIntegratedWorld()
      const crown = base.titles.find(ti => ti.kind === 'CROWN')!
      const holderId = crown.holder.status === 'HELD' ? crown.holder.personId : ''
      const world = { ...base, persons: base.persons.map(p => p.personId === holderId ? { ...p, alive: false, deathYear: 1250 } : p) }
      expect(auditWorld(world).filter(f => f.subjectId === crown.titleId).map(f => f.code)).toEqual(['DEAD_TITLE_HOLDER'])
    })
    it('classifies synthetic holder deaths as UNDETERMINED / TRANSFERRED / STALE', () => {
      const before = createExperimentalIntegratedWorld()
      const [a, b, c] = before.titles.filter(ti => ti.kind === 'TERRITORIAL' && ti.holder.status === 'HELD')
      const dead = (ti: typeof a) => ti!.holder.status === 'HELD' ? ti!.holder.personId : ''
      const living = before.persons.find(p => p.alive && ![a, b, c].some(ti => dead(ti) === p.personId))!
      const after = {
        ...before, year: before.year + 1,
        persons: before.persons.map(p => [a, b, c].some(ti => dead(ti) === p.personId) ? { ...p, alive: false, deathYear: before.year } : p),
        titles: before.titles.map(ti => ti.titleId === a!.titleId ? { ...ti, holder: { status: 'UNDETERMINED' as const } }
          : ti.titleId === b!.titleId ? { ...ti, holder: { status: 'HELD' as const, personId: living.personId } } : ti),
      }
      const byTitle = new Map(classifyHolderDeaths(before, after).filter(o => o.kind === 'TERRITORIAL').map(o => [o.titleId, o.outcome]))
      expect(byTitle.get(a!.titleId)).toBe('UNDETERMINED_PENDING_SUCCESSION')
      expect(byTitle.get(b!.titleId)).toBe('TRANSFERRED_TO_LIVING_HOLDER')
      expect(byTitle.get(c!.titleId)).toBe('STALE_DEAD_HOLDER')
    })
  })

  describe('birth attributes and silent Title changes', () => {
    const t = find(x => x.events.some(e => has(e, 'PERSON_BIRTH')))
    const birth = t.events.find(e => has(e, 'PERSON_BIRTH'))!
    const id = refId(birth.involvedRefs, 'PERSON')!
    const mutate = (patch: object) => ({ ...t.after, persons: t.after.persons.map(p => p.personId === id ? { ...p, ...patch } : p) })
    it('detects a re-assigned origin group, a wrong birthYear and an instantly dead newborn', () => {
      const other = t.after.groups.find(g => g.groupId !== refId(birth.involvedRefs, 'GROUP'))!.groupId
      for (const patch of [{ originGroupId: other }, { birthYear: 1000 }, { alive: false, deathYear: t.before.year }])
        expect(codes(auditPopulationConservation(t.before, mutate(patch), t.events, t.traces)),
          JSON.stringify(patch)).toContain('BIRTH_PERSON_ATTRIBUTES_INVALID')
    })
    it('detects a combined PERSON_BIRTH+POPULATION_COHORT Event that moves population', () => {
      const group = t.after.groups[0]!
      const events = t.events.map(e => e === birth ? { ...e, eventType: 'PERSON_BIRTH+POPULATION_COHORT',
        stateChanges: [...e.stateChanges, { path: '$.groups[' + group.groupId + '].population', before: group.population, after: group.population + 1 }] } : e)
      expect(codes(auditPopulationConservation(t.before, t.after, events, t.traces))).toContain('POPULATION_CHANGED_BY_NON_POPULATION_EVENT')
    })
    it('a casualty in one group does not excuse an unbacked population change in another', () => {
      const [g1, g2] = t.after.groups
      const events = [...t.events, { ...birth, eventId: 'casualty', eventType: 'POPULATION_CASUALTY', stateChanges: [
        { path: '$.groups[' + g1!.groupId + '].population', before: 1, after: 1 }] }]
      const stripped = events.map(e => has(e, 'POPULATION_COHORT') && e.involvedRefs.some(r => r.kind === 'GROUP' && 'id' in r && r.id === g2!.groupId)
        ? { ...e, stateChanges: e.stateChanges.filter(c => !c.path.includes('cohortSlots')) } : e)
      expect(codes(auditPopulationConservation(t.before, t.after, stripped, t.traces))).toContain('POPULATION_DELTA_WITHOUT_COHORT_SLOT')
    })
    it('detects a silent HELD -> UNDETERMINED, a mutated Title kind, a removed and an added Title', () => {
      const held = t.after.titles.find(ti => ti.holder.status === 'HELD' && !t.events.some(e => e.stateChanges.some(c => c.path.includes(ti.titleId))))!
      const run = (titles: typeof t.after.titles) => codes(auditApprovedTransfers(t.before, { ...t.after, titles }, t.events, t.traces))
      expect(run(t.after.titles.map(ti => ti === held ? { ...ti, holder: { status: 'UNDETERMINED' as const } } : ti)))
        .toContain('TITLE_HOLDER_CHANGED_WITHOUT_TRANSFER_EVENT')
      expect(run(t.after.titles.map(ti => ti === held ? { ...ti, kind: ti.kind === 'CROWN' ? 'TERRITORIAL' as const : 'CROWN' as const } : ti)))
        .toContain('TITLE_IDENTITY_MUTATED')
      expect(run(t.after.titles.filter(ti => ti !== held))).toContain('TITLE_REMOVED')
      expect(run([...t.after.titles, { ...held, titleId: 'title-forged' }])).toContain('TITLE_ADDED_WITHOUT_LEGAL_EVENT')
    })
  })

  // Real HELD transfers, one per Title kind that actually occurs in 1250..1273. Which kind transfers first depends on
  // the integrated rules (CROWN succession vs TERRITORIAL), so no kind is assumed: every real kind is exercised.
  const toHeld = (e: EventLogEntry) => has(e, 'LEGAL_TITLE_TRANSFER') &&
    e.stateChanges.some(c => c.path.endsWith('.holder.personId') && typeof c.after === 'string')
  const heldTransfers = (() => {
    const byKind = new Map<string, { t: Transition; transfer: EventLogEntry; titleId: string; kind: string }>()
    for (const t of transitions) for (const transfer of t.events.filter(toHeld)) {
      const change = transfer.stateChanges.find(c => c.path.endsWith('.holder.personId'))!
      const titleId = /^\$\.titles\[(.*)\]\.holder\.personId$/.exec(change.path)![1]!
      const kind = t.after.titles.find(ti => ti.titleId === titleId)!.kind
      if (!byKind.has(kind)) byKind.set(kind, { t, transfer, titleId, kind })
    }
    if (byKind.size === 0) throw new Error('no real HELD Title transfer; control cannot be exercised')
    return [...byKind.values()]
  })()
  const approvalChanges = (caseId: string) => (c: { path: string }) =>
    c.path === '$.legal.cases[' + caseId + ']' || c.path === '$.legal.cases[' + caseId + '].status'

  describe.each(heldTransfers)('Title-specific transfer evidence ($kind transfer)', ({ t, transfer, titleId, kind }) => {
    const change = transfer.stateChanges.find(c => c.path.endsWith('.holder.personId'))!
    const target = t.after.titles.find(ti => ti.titleId === titleId)!
    // A different Title in the same region (the opposite kind when one exists), whose holder must not be changeable on this evidence.
    const other = t.after.titles.find(ti => ti.titleId !== titleId && ti.regionId === target.regionId && ti.kind !== kind) ??
      t.after.titles.find(ti => ti.titleId !== titleId && ti.regionId === target.regionId)!
    const approvedCases = t.after.legal.cases.filter(c => c.titleId === titleId && c.kind === 'SUCCESSION' && c.status === 'APPROVED')

    it('baseline: the real transfer has an approved case, matching Title path and A-TIT-07 Trace', () => {
      expect(target.holder.status).toBe('HELD')
      expect(approvedCases.length).toBeGreaterThan(0)
      expect(auditApprovedTransfers(t.before, t.after, t.events, t.traces)).toEqual([])
    })
    it('a transfer Event for one Title cannot vouch for a holder change of another Title in the same region', () => {
      expect(other, 'a second Title must share the region for this control').toBeDefined()
      const successor = String(change.after)
      const after = {
        ...t.after,
        titles: t.after.titles.map(ti => ti.titleId === other.titleId ? { ...ti, holder: { status: 'HELD' as const, personId: successor } } : ti),
        legal: { ...t.after.legal, cases: [...t.after.legal.cases, {
          caseId: 'case-forged-other', titleId: other.titleId, kind: 'SUCCESSION' as const, status: 'APPROVED' as const,
          candidatePersonIds: [successor], reasonCodes: [] }] },
      }
      const issues = auditApprovedTransfers(t.before, after, t.events, t.traces)
      expect(codes(issues.filter(i => i.subjectId === other.titleId))).toEqual(
        expect.arrayContaining(['HELD_TRANSFER_WITHOUT_EVENT', 'TITLE_HOLDER_CHANGED_WITHOUT_TRANSFER_EVENT']))
      expect(issues.filter(i => i.subjectId === titleId)).toEqual([]) // the genuine transfer stays clean
    })
    it('rejects a transfer justified only by a case approved in an earlier year', () => {
      // Pretend the approving Event happened last year: no Event of this year records the case approval, whether it was
      // written as a `.status` update of an existing case or as the creation of an already-APPROVED case.
      const removed: string[] = []
      const events = t.events.map(e => ({ ...e, stateChanges: e.stateChanges.filter(c => {
        const hit = approvedCases.some(ac => approvalChanges(ac.caseId)(c))
        if (hit) removed.push(c.path)
        return !hit
      }) }))
      expect(removed.length, 'this year must contain the real approval change that the control removes').toBeGreaterThan(0)
      expect(codes(auditApprovedTransfers(t.before, t.after, events, t.traces))).toContain('HELD_TRANSFER_WITHOUT_APPROVED_CASE')
    })
    it('rejects an A-TIT-07 Trace that targets a different Title', () => {
      const traces = t.traces.map(x => x.ruleId === 'A-TIT-07' ? { ...x, candidates: x.candidates.map(c => ({ ...c, candidateId: 'atit07:[1,"title-other"]' })) } : x)
      expect(codes(auditApprovedTransfers(t.before, t.after, t.events, traces))).toContain('TRANSFER_EVENT_WITHOUT_TITLE_TARGETED_ATIT07_TRACE')
    })
    it('detects an unapproved HELD transfer', () => {
      const after = { ...t.after, legal: { ...t.after.legal, cases: t.after.legal.cases.filter(c => c.titleId !== titleId) } }
      expect(codes(auditApprovedTransfers(t.before, after, t.events, t.traces))).toContain('HELD_TRANSFER_WITHOUT_APPROVED_CASE')
    })
    it('detects a transfer Event whose Title path is not reflected in the world', () => {
      const after = { ...t.after, titles: t.after.titles.map(ti => ti.titleId === titleId ? { ...ti, holder: { status: 'UNDETERMINED' as const } } : ti) }
      expect(codes(auditApprovedTransfers(t.before, after, t.events, t.traces))).toContain('TRANSFER_EVENT_NOT_REFLECTED_IN_TITLE')
    })
  })

  describe('Title-specific transfer evidence (HELD -> UNDETERMINED)', () => {
    it('detects HELD -> UNDETERMINED transfer Events that the world does not reflect', () => {
      const u = find(x => x.events.some(e => has(e, 'LEGAL_TITLE_TRANSFER') &&
        e.stateChanges.some(c => c.path.endsWith('.holder.status') && c.after === 'UNDETERMINED')))
      const id = /^\$\.titles\[(.*)\]\.holder\.status$/.exec(u.events.flatMap(e => e.stateChanges)
        .find(c => c.path.endsWith('.holder.status') && c.after === 'UNDETERMINED')!.path)![1]!
      const pre = u.before.titles.find(ti => ti.titleId === id)!
      const after = { ...u.after, titles: u.after.titles.map(ti => ti.titleId === id ? pre : ti) }
      expect(codes(auditApprovedTransfers(u.before, after, u.events, u.traces))).toContain('TRANSFER_EVENT_NOT_REFLECTED_IN_TITLE')
      expect(auditApprovedTransfers(u.before, u.after, u.events, u.traces)).toEqual([])
    })
  })

  describe('exclusive Title audit matches the validator', () => {
    const base = createExperimentalIntegratedWorld()
    const territorial = base.titles.find(ti => ti.kind === 'TERRITORIAL')!
    const dup = { ...territorial, titleId: 'title-dup' }
    it('flags two valid ACTIVE TERRITORIAL Titles in one region', () => {
      const world = { ...base, titles: [...base.titles, dup] }
      expect(codes(auditWorld(world))).toContain('DUPLICATE_EXCLUSIVE_TITLE')
      expect(validateWorldState(world).diagnostics.map(d => d.code)).toContain('DUPLICATE_EXCLUSIVE_TITLE')
    })
    it('does not flag an invalid or non-ACTIVE duplicate, nor CROWN + TERRITORIAL sharing a region', () => {
      const invalid = auditWorld({ ...base, titles: [...base.titles, { ...dup, valid: false }] })
      const pending = auditWorld({ ...base, titles: [...base.titles, { ...dup, recognition: { status: 'PENDING' as const } }] })
      for (const w of [{ ...base, titles: [...base.titles, { ...dup, valid: false }] },
        { ...base, titles: [...base.titles, { ...dup, recognition: { status: 'PENDING' as const } }] }])
        expect(validateWorldState(w).diagnostics.map(d => d.code)).not.toContain('DUPLICATE_EXCLUSIVE_TITLE')
      expect(codes(invalid)).not.toContain('DUPLICATE_EXCLUSIVE_TITLE')
      expect(codes(pending)).not.toContain('DUPLICATE_EXCLUSIVE_TITLE')
      expect(codes(auditWorld(base))).not.toContain('DUPLICATE_EXCLUSIVE_TITLE')
      expect(base.titles.some(a => a.kind === 'CROWN' && base.titles.some(b => b.kind === 'TERRITORIAL' && b.regionId === a.regionId))).toBe(true)
    })
  })

  describe('history digest', () => {
    it('is stable for identical history and pinpoints the first diverging year/category', () => {
      const snaps = [transitions[0]!.before, ...transitions.slice(0, 3).map(x => x.after)]
      const h = { snapshots: snaps, eventLog: transitions.slice(0, 3).flatMap(x => x.events), decisionTraces: transitions.slice(0, 3).flatMap(x => x.traces) }
      expect(firstDivergence(digestHistory(h), digestHistory(h))).toBeNull()
      const changed = { ...h, eventLog: h.eventLog.map((e, i) => i === 0 ? { ...e, eventType: e.eventType + 'X' } : e) }
      expect(firstDivergence(digestHistory(h), digestHistory(changed))).toEqual({ kind: 'events', index: 0 })
      const late = { ...h, snapshots: h.snapshots.map((x, i) => i === 3 ? { ...x, persons: [] } : x) }
      expect(firstDivergence(digestHistory(h), digestHistory(late))).toEqual({ kind: 'world', index: 3 })
      const traced = { ...h, decisionTraces: h.decisionTraces.map((x, i) => i === 0 ? { ...x, status: 'DEFER' as const } : x) }
      expect(firstDivergence(digestHistory(h), digestHistory(traced))).toEqual({ kind: 'traces', index: 0 })
      expect(firstDivergence(digestHistory(h), digestHistory({ ...h, snapshots: h.snapshots.slice(0, 2) }))).toEqual({ kind: 'world', index: 2 })
      // The earliest year wins even when a later category diverges first in scan order.
      const both = { ...late, eventLog: changed.eventLog }
      expect(firstDivergence(digestHistory(h), digestHistory(both))).toEqual({ kind: 'events', index: 0 })
    })
    it('auditTransition flags nothing on real transitions', () => {
      for (const t of transitions) expect(auditTransition(t.before, t.after, t.events, t.traces), 'year=' + t.before.year).toEqual([])
    })
  })
})
