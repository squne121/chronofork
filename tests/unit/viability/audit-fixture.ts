// Session C: independent read-only audit of actual WorldState/EventLog/DecisionTrace.
// All scenario inputs are experimental/CALIBRATION_ONLY; this file never repairs state.
import type { DecisionTrace, EventLogEntry, WorldState } from '../../../src/simulation/contracts/index.ts'

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
  const territorialRegions = new Set<string>()

  for (const country of world.countries) {
    if (country.rulerPersonId === undefined) continue // unknown is not a fabricated ruler
    const ruler = persons.get(country.rulerPersonId)
    if (!ruler) issues.push(finding(world.year, 'RULER_REF_MISSING', country.countryId, country.rulerPersonId))
    else if (!ruler.alive) issues.push(finding(world.year, 'DEAD_COUNTRY_RULER', country.countryId,
      'ruler=' + ruler.personId + '; deathYear=' + ruler.deathYear))
  }
  for (const title of world.titles) {
    if (title.kind === 'TERRITORIAL') {
      if (territorialRegions.has(title.regionId)) issues.push(
        finding(world.year, 'DUPLICATE_TERRITORIAL_TITLE', title.titleId, title.regionId))
      territorialRegions.add(title.regionId)
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
  for (const [groupId, alive] of aliveInGroup) {
    const group = groups.get(groupId)
    if (group && alive > group.population) issues.push(
      finding(world.year, 'PERSON_POPULATION_DOUBLE_COUNT_RISK', groupId,
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

/** A new legal holder requires actual approval and an applied transfer, not just a story. */
export function auditApprovedTransfers(
  before: WorldState, after: WorldState, events: readonly EventLogEntry[],
): AuditFinding[] {
  const issues: AuditFinding[] = []
  const beforeTitles = new Map(before.titles.map(t => [t.titleId, t]))
  const transfers = events.filter(e => e.eventType.split('+').includes('LEGAL_TITLE_TRANSFER'))
  for (const title of after.titles) {
    if (title.holder.status !== 'HELD') continue
    const successorId = title.holder.personId
    const previous = beforeTitles.get(title.titleId)
    if (!previous || previous.holder.status === 'HELD' &&
      previous.holder.personId === successorId) continue
    const approved = after.legal.cases.some(c => c.kind === 'SUCCESSION' &&
      c.titleId === title.titleId && c.status === 'APPROVED' &&
      c.candidatePersonIds.includes(successorId))
    if (!approved) issues.push(finding(after.year, 'HELD_TRANSFER_WITHOUT_APPROVED_CASE',
      title.titleId, successorId))
    const observed = transfers.some(e =>
      e.involvedRefs.some(r => r.kind === 'REGION' && r.id === title.regionId) &&
      e.involvedRefs.some(r => r.kind === 'PERSON' && r.id === successorId))
    if (!observed) issues.push(finding(after.year, 'HELD_TRANSFER_WITHOUT_EVENT',
      title.titleId, successorId))
  }
  return issues
}
