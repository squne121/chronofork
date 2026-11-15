// Session C: independent read-only audit of actual WorldState/EventLog/DecisionTrace.
// All scenario inputs are experimental/CALIBRATION_ONLY; this file never repairs state.
import { createHash } from 'node:crypto'
import type { DecisionTrace, EventLogEntry, TargetRef, WorldState } from '../../../src/simulation/contracts/index.ts'

export type AuditFinding = Readonly<{
  year: number
  code: string
  subjectId: string
  detail: string
}>

const finding = (year: number, code: string, subjectId: string, detail: string): AuditFinding =>
  ({ year, code, subjectId, detail })

export function auditWorld(world: WorldState): AuditFinding[] {
  const issues: AuditFinding[] = []
  const persons = new Map(world.persons.map(p => [p.personId, p]))
  const groups = new Map(world.groups.map(g => [g.groupId, g]))
  const dynasties = new Set(world.legal.dynasties.map(d => d.dynastyId))
  const aliveInGroup = new Map<string, number>()
  const activeSpouses = new Map<string, string>()
  const exclusiveTitles = new Map<string, string>()

  for (const country of world.countries) {
    if (country.rulerPersonId === undefined) continue // unknown is not a fabricated ruler
    const ruler = persons.get(country.rulerPersonId)
    if (!ruler) issues.push(finding(world.year, 'RULER_REF_MISSING', country.countryId, country.rulerPersonId))
    else if (!ruler.alive) issues.push(finding(world.year, 'DEAD_COUNTRY_RULER', country.countryId,
      'ruler=' + ruler.personId + '; deathYear=' + ruler.deathYear))
  }
  for (const title of world.titles) {
    // Same exclusivity as validateWorldState (DUPLICATE_EXCLUSIVE_TITLE): only valid + ACTIVE Titles of the
    // same kind in one region conflict. CROWN and TERRITORIAL may legally share a region.
    if (title.valid && title.recognition.status === 'ACTIVE') {
      const key = title.kind + ':' + title.regionId
      const first = exclusiveTitles.get(key)
      if (first !== undefined) issues.push(
        finding(world.year, 'DUPLICATE_EXCLUSIVE_TITLE', title.titleId, key + '; first=' + first))
      else exclusiveTitles.set(key, title.titleId)
    }
    if (title.holder.status !== 'HELD') continue // UNDETERMINED is a valid legal state
    const holder = persons.get(title.holder.personId)
    if (!holder) issues.push(finding(world.year, 'TITLE_HOLDER_REF_MISSING', title.titleId,
      title.holder.personId))
    else if (!holder.alive) issues.push(finding(world.year, 'DEAD_TITLE_HOLDER', title.titleId,
      'kind=' + title.kind + '; holder=' + holder.personId + '; deathYear=' + holder.deathYear))
  }
  for (const person of world.persons) {
    if (!groups.has(person.originGroupId)) issues.push(
      finding(world.year, 'PERSON_ORIGIN_MISSING', person.personId, person.originGroupId))
    if (person.alive) aliveInGroup.set(person.originGroupId, (aliveInGroup.get(person.originGroupId) ?? 0) + 1)
    if (person.alive && person.deathYear !== undefined || !person.alive && person.deathYear === undefined)
      issues.push(finding(world.year, 'LIFE_STATE_CONTRADICTION', person.personId, String(person.deathYear)))
    for (const parentId of [person.fatherId, person.motherId]) {
      if (parentId === undefined) continue
      const parent = persons.get(parentId)
      if (!parent) issues.push(finding(world.year, 'PARENT_REF_MISSING', person.personId, parentId))
      else if (parent.birthYear >= person.birthYear) issues.push(
        finding(world.year, 'PARENT_AGE_CONTRADICTION', person.personId, parentId))
    }
    if (person.legalDynasty.status === 'DETERMINED' && !dynasties.has(person.legalDynasty.dynastyId))
      issues.push(finding(world.year, 'LEGAL_DYNASTY_REF_MISSING', person.personId,
        person.legalDynasty.dynastyId))
  }
  // Capacity only: named persons are a breakdown of PopulationGroup.population, never an additional population.
  // Conservation across a year is audited by auditPopulationConservation.
  for (const [groupId, alive] of aliveInGroup) {
    const group = groups.get(groupId)
    if (group && alive > group.population) issues.push(
      finding(world.year, 'NAMED_ALIVE_EXCEEDS_GROUP_POPULATION', groupId,
        'namedAlive=' + alive + '; groupPopulation=' + group.population))
  }
  for (const marriage of world.legal.marriages) {
    const [idA, idB] = marriage.personIds
    const a = persons.get(idA), b = persons.get(idB)
    if (!a || !b || idA === idB) issues.push(
      finding(world.year, 'MARRIAGE_PARTICIPANTS_INVALID', marriage.marriageId, idA + '/' + idB))
    if (marriage.status !== 'ACTIVE') continue
    if (a && !a.alive || b && !b.alive) issues.push(
      finding(world.year, 'ACTIVE_MARRIAGE_WITH_DECEASED', marriage.marriageId, idA + '/' + idB))
    for (const id of marriage.personIds) {
      const other = activeSpouses.get(id)
      if (other && other !== marriage.marriageId) issues.push(
        finding(world.year, 'CONCURRENT_ACTIVE_MARRIAGE', id, other + '/' + marriage.marriageId))
      activeSpouses.set(id, marriage.marriageId)
    }
  }
  for (const legalCase of world.legal.cases) {
    if (legalCase.status !== 'APPROVED') continue
    for (const id of legalCase.candidatePersonIds)
      if (!persons.has(id)) issues.push(
        finding(world.year, 'APPROVED_CASE_WITH_UNKNOWN_CANDIDATE', legalCase.caseId, id))
  }
  return issues
}

export function auditEventTraceLinks(
  year: number, events: readonly EventLogEntry[], traces: readonly DecisionTrace[],
): AuditFinding[] {
  const issues: AuditFinding[] = []
  const byTraceId = new Map(traces.map(t => [t.traceId, t]))
  const byEventId = new Map(events.map(e => [e.eventId, e]))
  for (const event of events) {
    if (event.stateChanges.length === 0) issues.push(
      finding(year, 'EVENT_WITHOUT_STATE_CHANGE', event.eventId, event.eventType))
    if (event.sourceTraceIds.length === 0) issues.push(
      finding(year, 'EVENT_WITHOUT_SOURCE_TRACE', event.eventId, event.eventType))
    for (const id of event.sourceTraceIds) {
      const trace = byTraceId.get(id)
      if (!trace || trace.status !== 'ACCEPT' || !trace.eventIds.includes(event.eventId))
        issues.push(finding(year, 'EVENT_TRACE_NOT_ACCEPTED_OR_RECIPROCAL', event.eventId,
          'sourceTrace=' + id + '; status=' + trace?.status))
    }
  }
  for (const trace of traces) {
    if ((trace.status === 'DEFER' || trace.status === 'REJECT') && trace.eventIds.length)
      issues.push(finding(year, 'UNAPPROVED_DECISION_HAS_EVENTS', trace.traceId,
        trace.status + '; eventIds=' + trace.eventIds.join(',')))
    for (const id of trace.eventIds) {
      const event = byEventId.get(id)
      if (!event || !event.sourceTraceIds.includes(trace.traceId))
        issues.push(finding(year, 'TRACE_EVENT_NOT_RECIPROCAL', trace.traceId, id))
    }
  }
  return issues
}

/** Id of the first non-pair reference of a kind (PERSON_PAIR carries `ids`, not `id`). */
export const refId = (refs: readonly TargetRef[], kind: string): string | undefined => {
  const r = refs.find(x => x.kind === kind)
  return r && 'id' in r ? r.id : undefined
}
/** True when `id` appears in `text` as a whole identifier (not as a prefix/suffix of a longer ID). */
export const mentionsId = (text: string, id: string) =>
  new RegExp('(^|[^\\w:.-])' + id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '($|[^\\w:.-])').test(text)
const hasType = (e: EventLogEntry, type: string) => e.eventType.split('+').includes(type)
// Individual-record creation Events observed in real runs; none may move PopulationGroup.population.
const PERSON_CREATING_EVENTS = ['PERSON_BIRTH', 'PERSON_PROMOTE', 'PERSON_SUPPORTING_RECORD']
const POP_PATH = /^\$\.groups\[(.*)\]\.population$/
const PERSON_LIFE_PATH = /^\$\.persons\[(.*)\]\.(alive|deathYear)$/
const TITLE_HOLDER_PATH = /^\$\.titles\[(.*)\]\.holder\.(personId|status)$/
const SLOT_PATH = /^\$\.demographics\.cohortSlots\[(.*)@(\d+)\]$/
const CLAIM_PATH = /^\$\.demographics\.cohortSlots\[(.*)@(\d+)\]\.(claimedBirths|claimedDeaths)$/

const acceptedTrace = (event: EventLogEntry, traces: readonly DecisionTrace[], ruleId: string) =>
  event.sourceTraceIds.some(id => {
    const t = traces.find(x => x.traceId === id)
    return t?.ruleId === ruleId && t.status === 'ACCEPT' && t.year === event.year &&
      t.eventIds.includes(event.eventId)
  })

/**
 * Population is conserved by C-004 (and D casualties) only. Named births/deaths/promotions are a breakdown
 * of PopulationGroup.population and must not add or subtract population on their own.
 */
export function auditPopulationConservation(
  before: WorldState, after: WorldState, events: readonly EventLogEntry[], traces: readonly DecisionTrace[],
): AuditFinding[] {
  const issues: AuditFinding[] = []
  const year = before.year
  const beforePop = new Map(before.groups.map(g => [g.groupId, g.population]))
  const running = new Map(beforePop)
  const eventDelta = new Map<string, number>()
  for (const event of events) {
    for (const change of event.stateChanges) {
      const m = POP_PATH.exec(change.path)
      if (!m) continue
      const groupId = m[1]!
      const isCohort = hasType(event, 'POPULATION_COHORT'), isCasualty = hasType(event, 'POPULATION_CASUALTY')
      const individual = event.eventType.split('+').some(k => k.startsWith('PERSON_'))
      if (individual || !isCohort && !isCasualty) issues.push(finding(year, 'POPULATION_CHANGED_BY_NON_POPULATION_EVENT',
        event.eventId, event.eventType + '; group=' + groupId))
      else if (isCohort && !acceptedTrace(event, traces, 'RULE-C-004')) issues.push(
        finding(year, 'POPULATION_EVENT_WITHOUT_ACCEPTED_C004_TRACE', event.eventId, groupId))
      if (running.get(groupId) !== change.before) issues.push(finding(year, 'POPULATION_EVENT_BEFORE_MISMATCH',
        event.eventId, 'group=' + groupId + '; running=' + running.get(groupId) + '; logged=' + change.before))
      if (typeof change.before === 'number' && typeof change.after === 'number') {
        running.set(groupId, change.after)
        eventDelta.set(groupId, (eventDelta.get(groupId) ?? 0) + change.after - change.before)
      }
    }
  }
  for (const group of after.groups) {
    const expected = running.get(group.groupId)
    if (expected !== group.population) issues.push(finding(year, 'POPULATION_CHANGE_NOT_EXPLAINED_BY_EVENTS',
      group.groupId, 'before=' + beforePop.get(group.groupId) + '; after=' + group.population +
      '; eventsExplain=' + expected))
  }
  // Slots live only inside the year transaction (the year-end snapshot has none), so the audit reads them
  // from the C-004 Event's own stateChanges: creation (before=null) and the later claimed* increments.
  type Slot = { birthSlots: number; deathSlots: number; claimedBirths: number; claimedDeaths: number }
  const slots = new Map<string, Slot>()
  for (const event of events) for (const change of event.stateChanges) {
    const m = SLOT_PATH.exec(change.path)
    if (!m || change.before !== null || typeof change.after !== 'object' || change.after === null) continue
    const slot = change.after as { birthSlots: number; deathSlots: number; year: number }
    if (Number(m[2]) !== year || slot.year !== year) issues.push(finding(year, 'COHORT_SLOT_YEAR_MISMATCH',
      event.eventId, change.path))
    slots.set(m[1]!, { birthSlots: slot.birthSlots, deathSlots: slot.deathSlots, claimedBirths: 0, claimedDeaths: 0 })
  }
  for (const event of events) for (const change of event.stateChanges) {
    const m = CLAIM_PATH.exec(change.path)
    if (!m) continue
    const slot = slots.get(m[1]!)
    if (!slot || Number(m[2]) !== year) { issues.push(finding(year, 'CLAIM_WITHOUT_CURRENT_COHORT_SLOT',
      event.eventId, change.path)); continue }
    const inc = Number(change.after) - Number(change.before)
    if (m[3] === 'claimedBirths') slot.claimedBirths += inc; else slot.claimedDeaths += inc
  }
  for (const [groupId, slot] of slots) {
    if (slot.claimedBirths > slot.birthSlots || slot.claimedDeaths > slot.deathSlots) issues.push(
      finding(year, 'COHORT_CLAIM_EXCEEDS_SLOT', groupId, JSON.stringify(slot)))
    const casualties = events.filter(e => hasType(e, 'POPULATION_CASUALTY')).reduce((n, e) =>
      n + e.stateChanges.filter(c => POP_PATH.exec(c.path)?.[1] === groupId)
        .reduce((k, c) => k + Number(c.after) - Number(c.before), 0), 0)
    if ((eventDelta.get(groupId) ?? 0) - casualties !== slot.birthSlots - slot.deathSlots) issues.push(
      finding(year, 'POPULATION_DELTA_NOT_COHORT_NET', groupId,
        'eventDelta=' + eventDelta.get(groupId) + '; casualties=' + casualties +
        '; slotNet=' + (slot.birthSlots - slot.deathSlots)))
  }
  const casualtyGroups = new Set(events.filter(e => hasType(e, 'POPULATION_CASUALTY')).flatMap(e =>
    e.stateChanges.map(c => POP_PATH.exec(c.path)?.[1]).filter((x): x is string => !!x)))
  for (const [groupId, delta] of eventDelta) if (delta !== 0 && !slots.has(groupId) &&
    !casualtyGroups.has(groupId)) issues.push(
    finding(year, 'POPULATION_DELTA_WITHOUT_COHORT_SLOT', groupId, 'delta=' + delta))
  // Individual records only consume claimed slots; they never move PopulationGroup.population themselves.
  const beforeIds = new Set(before.persons.map(p => p.personId))
  const beforePerson = new Map(before.persons.map(p => [p.personId, p]))
  const birthsByGroup = new Map<string, number>(), deathsByGroup = new Map<string, number>()
  for (const event of events) {
    if (hasType(event, 'PERSON_BIRTH')) {
      const groupId = refId(event.involvedRefs, 'GROUP')
      if (!groupId) issues.push(finding(year, 'BIRTH_EVENT_WITHOUT_GROUP_REF', event.eventId, ''))
      else birthsByGroup.set(groupId, (birthsByGroup.get(groupId) ?? 0) + 1)
    }
    if (hasType(event, 'PERSON_DEATH')) {
      const refPerson = refId(event.involvedRefs, 'PERSON')
      const person = refPerson ? beforePerson.get(refPerson) : undefined
      if (person) deathsByGroup.set(person.originGroupId, (deathsByGroup.get(person.originGroupId) ?? 0) + 1)
    }
  }
  for (const group of after.groups) {
    const slot = slots.get(group.groupId)
    const births = birthsByGroup.get(group.groupId) ?? 0, deaths = deathsByGroup.get(group.groupId) ?? 0
    if (births !== (slot?.claimedBirths ?? 0)) issues.push(finding(year, 'NAMED_BIRTHS_NOT_EQUAL_CLAIMED_SLOT',
      group.groupId, 'birthEvents=' + births + '; claimed=' + slot?.claimedBirths))
    if (deaths !== (slot?.claimedDeaths ?? 0)) issues.push(finding(year, 'NAMED_DEATHS_NOT_EQUAL_CLAIMED_SLOT',
      group.groupId, 'deathEvents=' + deaths + '; claimed=' + slot?.claimedDeaths))
  }
  const birthEventPersons = new Set(events.filter(e => PERSON_CREATING_EVENTS.some(k => hasType(e, k)))
    .flatMap(e => { const id = refId(e.involvedRefs, 'PERSON'); return id ? [id] : [] }))
  const afterById = new Map(after.persons.map(p => [p.personId, p]))
  for (const event of events.filter(e => hasType(e, 'PERSON_BIRTH'))) {
    const created = event.stateChanges.filter(c => /^\$\.persons\[.*\]$/.test(c.path) && c.before === null)
    const groupId = refId(event.involvedRefs, 'GROUP'), personId = refId(event.involvedRefs, 'PERSON')
    const person = personId ? afterById.get(personId) : undefined
    if (created.length !== 1 || !person || beforeIds.has(person.personId)) issues.push(finding(year,
      'BIRTH_EVENT_NOT_ONE_NEW_PERSON', event.eventId, 'created=' + created.length))
    else if (person.originGroupId !== groupId || person.birthYear !== year || !person.alive ||
      person.deathYear !== undefined) issues.push(finding(year, 'BIRTH_PERSON_ATTRIBUTES_INVALID', person.personId,
      'origin=' + person.originGroupId + '/' + groupId + '; birthYear=' + person.birthYear + '; alive=' + person.alive))
  }
  for (const person of after.persons) if (!beforeIds.has(person.personId) && !birthEventPersons.has(person.personId))
    issues.push(finding(year, 'PERSON_ADDED_WITHOUT_CREATION_EVENT', person.personId, person.originGroupId))
  return issues
}

/** alive -> dead needs the same-year B-003 Event and an ACCEPT Trace that reference each other. */
export function auditDeathCausality(
  before: WorldState, after: WorldState, events: readonly EventLogEntry[], traces: readonly DecisionTrace[],
): AuditFinding[] {
  const issues: AuditFinding[] = []
  const year = before.year
  const afterPerson = new Map(after.persons.map(p => [p.personId, p]))
  const deathEvents = new Map<string, EventLogEntry[]>()
  for (const event of events.filter(e => hasType(e, 'PERSON_DEATH'))) {
    const ids = new Set(event.stateChanges.map(c => PERSON_LIFE_PATH.exec(c.path)?.[1]).filter((x): x is string => !!x))
    if (ids.size !== 1) issues.push(finding(year, 'DEATH_EVENT_TARGET_NOT_UNIQUE', event.eventId, [...ids].join(',')))
    for (const id of ids) deathEvents.set(id, [...(deathEvents.get(id) ?? []), event])
  }
  for (const person of before.persons) {
    const next = afterPerson.get(person.personId)
    if (!next) { issues.push(finding(year, 'PERSON_DISAPPEARED', person.personId, '')); continue }
    if (!person.alive && next.alive) issues.push(finding(year, 'DEAD_PERSON_REVIVED', person.personId,
      'deathYear=' + person.deathYear))
    if (!person.alive && next.deathYear !== person.deathYear) issues.push(finding(year, 'DEATH_YEAR_MUTATED',
      person.personId, person.deathYear + '->' + next.deathYear))
    const own = deathEvents.get(person.personId) ?? []
    if (person.alive && !next.alive) {
      if (own.length !== 1) { issues.push(finding(year, 'DEATH_WITHOUT_SINGLE_B003_EVENT', person.personId,
        'deathYear=' + next.deathYear + '; events=' + own.length)); continue }
      const event = own[0]!
      if (event.year !== year || next.deathYear !== year) issues.push(finding(year, 'DEATH_YEAR_MISMATCH',
        person.personId, 'event=' + event.year + '; deathYear=' + next.deathYear))
      const trace = event.sourceTraceIds.map(id => traces.find(t => t.traceId === id))
        .find(t => t?.ruleId === 'B-003')
      if (!trace || trace.status !== 'ACCEPT' || trace.year !== year || !trace.eventIds.includes(event.eventId))
        issues.push(finding(year, 'DEATH_EVENT_WITHOUT_ACCEPTED_B003_TRACE', person.personId, event.eventId))
      else if (refId([trace.actorRef], 'PERSON') !== person.personId &&
        !trace.candidates.some(c => mentionsId(c.candidateId, person.personId))) issues.push(
        finding(year, 'DEATH_TRACE_TARGET_MISMATCH', person.personId, trace.traceId))
    }
    if (own.length && !(person.alive && !next.alive)) issues.push(finding(year, 'DEATH_EVENT_WITHOUT_TRANSITION',
      person.personId, own.map(e => e.eventId).join(',')))
  }
  for (const [id, own] of deathEvents) if (!before.persons.some(p => p.personId === id)) issues.push(
    finding(year, 'DEATH_EVENT_FOR_UNKNOWN_PERSON', id, own[0]!.eventId))
  return issues
}

export type HolderDeathOutcome = Readonly<{
  year: number; titleId: string; kind: string; deadPersonId: string
  outcome: 'UNDETERMINED_PENDING_SUCCESSION' | 'TRANSFERRED_TO_LIVING_HOLDER' | 'STALE_DEAD_HOLDER'
}>

/**
 * Classifies Title holders who died in this transition. A legal successor or an UNDETERMINED state are
 * valid; a HELD reference to the dead person is the known A/B integration defect and is reported, not hidden.
 */
export function classifyHolderDeaths(before: WorldState, after: WorldState): HolderDeathOutcome[] {
  const dead = new Set(after.persons.filter(p => !p.alive).map(p => p.personId))
  const alive = new Set(after.persons.filter(p => p.alive).map(p => p.personId))
  const titles = new Map(after.titles.map(t => [t.titleId, t]))
  const out: HolderDeathOutcome[] = []
  for (const prev of before.titles) {
    if (prev.holder.status !== 'HELD') continue
    const prevId = prev.holder.personId
    if (!dead.has(prevId) && !after.persons.some(p => p.personId === prevId && !p.alive)) continue
    if (before.persons.find(p => p.personId === prevId)?.alive === false) continue // died earlier; already classified
    const now = titles.get(prev.titleId)
    const holder = now?.holder
    out.push({
      year: before.year, titleId: prev.titleId, kind: prev.kind, deadPersonId: prevId,
      outcome: !holder || holder.status === 'UNDETERMINED' ? 'UNDETERMINED_PENDING_SUCCESSION'
        : alive.has(holder.personId) && holder.personId !== prevId ? 'TRANSFERRED_TO_LIVING_HOLDER'
          : 'STALE_DEAD_HOLDER',
    })
  }
  return out
}

/** A new legal holder requires actual approval and an applied transfer for exactly that Title. */
export function auditApprovedTransfers(
  before: WorldState, after: WorldState, events: readonly EventLogEntry[],
  traces: readonly DecisionTrace[] = [],
): AuditFinding[] {
  const issues: AuditFinding[] = []
  const beforeTitles = new Map(before.titles.map(t => [t.titleId, t]))
  const afterTitles = new Map(after.titles.map(t => [t.titleId, t]))
  const transfers = events.filter(e => hasType(e, 'LEGAL_TITLE_TRANSFER'))
  // The authoritative Title is the one named by stateChanges.path, never merely the same region/person.
  const heldBy = (event: EventLogEntry) => event.stateChanges.flatMap(c => {
    const m = TITLE_HOLDER_PATH.exec(c.path)
    return m && m[2] === 'personId' && typeof c.after === 'string' ? [{ titleId: m[1]!, personId: c.after }] : []
  })
  for (const event of transfers) {
    const touched = event.stateChanges.map(c => TITLE_HOLDER_PATH.exec(c.path)?.[1])
    if (!touched.some(Boolean)) issues.push(finding(after.year, 'TRANSFER_EVENT_WITHOUT_TITLE_PATH',
      event.eventId, event.stateChanges.map(c => c.path).join(';')))
    for (const change of event.stateChanges) { // HELD -> UNDETERMINED is also a transfer outcome
      const m = TITLE_HOLDER_PATH.exec(change.path)
      if (m?.[2] !== 'status' || change.after !== 'UNDETERMINED') continue
      if (afterTitles.get(m[1]!)?.holder.status !== 'UNDETERMINED') issues.push(finding(after.year,
        'TRANSFER_EVENT_NOT_REFLECTED_IN_TITLE', m[1]!, event.eventId + '->UNDETERMINED'))
    }
    for (const { titleId, personId } of heldBy(event)) {
      const now = afterTitles.get(titleId)
      if (!now || now.holder.status !== 'HELD' || now.holder.personId !== personId) issues.push(
        finding(after.year, 'TRANSFER_EVENT_NOT_REFLECTED_IN_TITLE', titleId, event.eventId + '->' + personId))
      const region = refId(event.involvedRefs, 'REGION')
      if (now && region && region !== now.regionId) issues.push(
        finding(after.year, 'TRANSFER_EVENT_REGION_MISMATCH', titleId, event.eventId + '; ref=' + region))
    }
    const titleIds = event.stateChanges.map(c => TITLE_HOLDER_PATH.exec(c.path)?.[1]).filter((x): x is string => !!x)
    const targeted = event.sourceTraceIds.map(id => traces.find(t => t.traceId === id)).some(t =>
      t?.ruleId === 'A-TIT-07' && t.status === 'ACCEPT' && t.year === event.year && t.eventIds.includes(event.eventId) &&
      titleIds.every(id => t.candidates.some(c => mentionsId(c.candidateId, id)) ||
        after.legal.cases.some(k => k.titleId === id && t.candidates.some(c => mentionsId(c.candidateId, k.caseId)))))
    if (traces.length && !targeted) issues.push(
      finding(after.year, 'TRANSFER_EVENT_WITHOUT_TITLE_TARGETED_ATIT07_TRACE', event.eventId, titleIds.join(',')))
  }
  const touchedTitles = new Set(transfers.flatMap(e => e.stateChanges
    .map(c => TITLE_HOLDER_PATH.exec(c.path)?.[1]).filter((x): x is string => !!x)))
  for (const prev of before.titles) {
    const now = afterTitles.get(prev.titleId)
    if (!now) { issues.push(finding(after.year, 'TITLE_REMOVED', prev.titleId, prev.kind)); continue }
    if (now.kind !== prev.kind || now.regionId !== prev.regionId) issues.push(finding(after.year,
      'TITLE_IDENTITY_MUTATED', prev.titleId, prev.kind + '@' + prev.regionId + '->' + now.kind + '@' + now.regionId))
    if (JSON.stringify(now.holder) !== JSON.stringify(prev.holder) && !touchedTitles.has(prev.titleId)) issues.push(
      finding(after.year, 'TITLE_HOLDER_CHANGED_WITHOUT_TRANSFER_EVENT', prev.titleId,
        JSON.stringify(prev.holder) + '->' + JSON.stringify(now.holder)))
  }
  for (const now of after.titles) if (!beforeTitles.has(now.titleId)) issues.push(
    finding(after.year, 'TITLE_ADDED_WITHOUT_LEGAL_EVENT', now.titleId, now.kind))
  const approvedThisYear = (caseId: string) => events.some(e => e.stateChanges.some(c =>
    c.path === '$.legal.cases[' + caseId + '].status' && c.after === 'APPROVED' ||
    c.path === '$.legal.cases[' + caseId + ']' && c.before === null &&
      typeof c.after === 'object' && (c.after as { status?: string } | null)?.status === 'APPROVED'))
  for (const title of after.titles) {
    if (title.holder.status !== 'HELD') continue
    const successorId = title.holder.personId
    const previous = beforeTitles.get(title.titleId)
    if (!previous || previous.holder.status === 'HELD' &&
      previous.holder.personId === successorId) continue
    const approved = after.legal.cases.some(c => c.kind === 'SUCCESSION' &&
      c.titleId === title.titleId && c.status === 'APPROVED' &&
      c.candidatePersonIds.includes(successorId) && approvedThisYear(c.caseId))
    if (!approved) issues.push(finding(after.year, 'HELD_TRANSFER_WITHOUT_APPROVED_CASE',
      title.titleId, successorId + '; needs a SUCCESSION case approved by an Event in ' + after.year))
    const observed = transfers.some(e => heldBy(e).some(h => h.titleId === title.titleId && h.personId === successorId))
    if (!observed) issues.push(finding(after.year, 'HELD_TRANSFER_WITHOUT_EVENT',
      title.titleId, successorId))
  }
  return issues
}

/** Every per-year invariant in one call; the pure functions above never repair state. */
export function auditTransition(
  before: WorldState, after: WorldState, events: readonly EventLogEntry[], traces: readonly DecisionTrace[],
): AuditFinding[] {
  return [
    ...auditEventTraceLinks(before.year, events, traces),
    ...auditPopulationConservation(before, after, events, traces),
    ...auditDeathCausality(before, after, events, traces),
    ...auditApprovedTransfers(before, after, events, traces),
  ]
}

/** Streaming digest: hashes each year separately so a 100-year history is never one giant string. */
export function digestHistory(h: Readonly<{
  snapshots: readonly WorldState[]; eventLog: readonly EventLogEntry[]; decisionTraces: readonly DecisionTrace[]
}>): Readonly<{ world: string[]; events: string[]; traces: string[] }> {
  const hash = (v: unknown) => createHash('sha256').update(JSON.stringify(v)).digest('hex').slice(0, 16)
  const byYear = <T extends { year: number }>(xs: readonly T[]) => {
    const m = new Map<number, T[]>()
    for (const x of xs) m.set(x.year, [...(m.get(x.year) ?? []), x])
    return m
  }
  const ev = byYear(h.eventLog), tr = byYear(h.decisionTraces)
  const years = h.snapshots.map(s => s.year)
  return {
    world: h.snapshots.map(hash),
    events: years.map(y => hash(ev.get(y) ?? [])),
    traces: years.map(y => hash(tr.get(y) ?? [])),
  }
}
/** Earliest diverging snapshot index across all categories (ties: world, events, traces); length changes count. */
export function firstDivergence(a: ReturnType<typeof digestHistory>, b: ReturnType<typeof digestHistory>) {
  let best: { kind: 'world' | 'events' | 'traces'; index: number } | null = null
  for (const k of ['world', 'events', 'traces'] as const) {
    const n = Math.max(a[k].length, b[k].length)
    for (let i = 0; i < n; i++) if (a[k][i] !== b[k][i]) {
      if (!best || i < best.index) best = { kind: k, index: i }
      break
    }
  }
  return best
}
