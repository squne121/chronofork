import type { DecisionTrace, EventLogEntry, WorldState } from '../../simulation/contracts/index.ts'
import type { TitleAssessment } from '../../simulation/goal.ts'
import type { TimelineRun } from '../timeline-source.ts'
import { EVENT_CATEGORIES, eventHeadline, inCategory, isObservationFocusEvent, namesOfYear } from '../integrated-overview.ts'
import { personDisplayNames } from './person-display.ts'
import type { PersonRecord, TitleLossRecord } from './person-record.ts'
import { collectAssociations } from './associations.ts'
import { reasonSentence } from './reason-labels.ts'

export type ChronicleEntry = Readonly<{
  year: number; phase: number; kind: 'event' | 'trace'; id: string; label: string; categories: readonly string[]; people: readonly string[]; targets: readonly string[]
}>

type Evidence = Readonly<{ kind: 'event' | 'trace'; id: string; year: number; text: string }>
export type SuccessionEvidence = Readonly<{
  titleId: string; year: number; predecessorId: string; dynasty?: string; spouse?: { id: string; year: number };
  proposed?: readonly { id: string; dynasty?: string }[];
  death?: Evidence; discovery?: Evidence; caseRecord?: Evidence; transfer?: Evidence;
  nextHolder?: 'HELD' | 'UNDETERMINED'; reviews: readonly Review[];
  judgments: readonly { first: Evidence; through: number }[]
}>

type Review = { first: Evidence; through: number; lastId: string; candidateId?: string; signature: string }

export type EndingTerritory = Readonly<{
  id: string; name: string; titles: readonly {
    id: string; holder: 'UNDETERMINED' | 'HELD'; personId?: string; dynasty?: string; assessment?: TitleAssessment
  }[]
}>

export function groupBy<K, V>(values: readonly V[], keyOf: (value: V) => K) {
  const groups = new Map<K, V[]>()
  for (const value of values) {
    const key = keyOf(value), entries = groups.get(key)
    if (entries) entries.push(value)
    else groups.set(key, [value])
  }
  return groups
}

const string = (value: unknown) => typeof value === 'string' ? value : undefined
const stringList = (value: unknown) => Array.isArray(value) && value.every(x => typeof x === 'string') ? value as string[] : undefined
const peopleIn = (refs: readonly EventLogEntry['involvedRefs'][number][]) => [...new Set(refs.flatMap(r =>
  r.kind === 'PERSON' ? [r.id] : r.kind === 'PERSON_PAIR' ? r.ids : []))]

export function chronicleRows(world: WorldState, events: readonly EventLogEntry[], traces: readonly DecisionTrace[], all: boolean): ChronicleEntry[] {
  const names = namesOfYear(world, events)
  const visibleEvents = all ? events : events.filter(isObservationFocusEvent)
  const visibleTraces = all ? traces : traces.filter(t => t.ruleId === 'A-SUC-04' && t.eventIds.length === 0 && t.reasonCodes.includes('DEC_055_PENDING_REVIEW'))
  const associations = collectAssociations({ year: world.year, events: visibleEvents, traces: visibleTraces }).confirmed
  const byRecord = groupBy(associations, a => a.source.type === 'EVENT' ? a.source.eventId : a.source.type === 'TRACE' ? a.source.traceId : '')
  const targets = (id: string) => (byRecord.get(id) ?? []).map(a => `${a.target.kind.toLowerCase()}:${a.target.id}`)
  const rows: ChronicleEntry[] = []
  for (const e of visibleEvents) {
    const categories = EVENT_CATEGORIES.filter(c => inCategory(e, c))
    const related = byRecord.get(e.eventId) ?? []
    rows.push({ year: e.year, phase: e.phase, kind: 'event', id: e.eventId, categories: categories.map(c => c.key),
      label: eventHeadline(e, names, categories[0]?.label ?? '状態の変更'), people: [...new Set(related.filter(a => a.target.kind === 'PERSON').map(a => a.target.id))],
      targets: [`event:${e.eventId}`, ...targets(e.eventId), ...e.sourceTraceIds.map(id => `trace:${id}`),
        ...related.flatMap(a => a.titleId ? [`title:${a.titleId}`] : [])] })
  }
  for (const t of visibleTraces) {
    const inputs = t.candidates.find(c => typeof c.inputs?.titleId === 'string')?.inputs
    const actor = t.actorRef
    const region = actor.kind === 'REGION' ? world.regions.find(r => r.regionId === actor.id)?.name : undefined
    const label = t.ruleId === 'A-SUC-04' ? `${region ? region + '：' : ''}継承審査` : t.ruleId === 'B-004' ? '婚姻候補の審査'
      : t.ruleId === 'B-005' ? '婚姻契約' : t.ruleId === 'B-002' ? '出生の判断' : '判断'
    rows.push({ year: t.year, phase: t.phase, kind: 'trace', id: t.traceId, categories: ['decision'],
      label: `${label}：${reasonSentence(t.reasonCodes)}${t.eventIds.length ? '' : '（出来事なし）'}`,
      targets: [`trace:${t.traceId}`, ...targets(t.traceId), ...t.eventIds.map(id => `event:${id}`), ...(inputs?.titleId ? [`title:${inputs.titleId}`] : [])],
      people: [...new Set([...peopleIn([actor]), ...[inputs?.predecessorPersonId, inputs?.candidatePersonId].filter((v): v is string => typeof v === 'string')])] })
  }
  return rows.sort((a, b) => a.year - b.year || a.phase - b.phase)
}

export function buildHistoryDigest(run: TimelineRun, losses: readonly TitleLossRecord[], people: readonly PersonRecord[]) {
  const { snapshots, eventLog, decisionTraces, technicalGoal } = run.result
  const years = new Map(snapshots.map(w => [w.year, w]))
  const events = groupBy(eventLog, e => e.year)
  const traces = groupBy(decisionTraces, t => t.year)
  const eventsById = new Map(eventLog.map(e => [e.eventId, e]))
  const nameOf = personDisplayNames(people)
  const final = years.get(1350)
  const assessments = technicalGoal?.status === 'ACHIEVED' || technicalGoal?.status === 'NOT_ACHIEVED' ? technicalGoal.assessments : []
  const dynastyOf = (world: WorldState | undefined, id: unknown) => world?.legal.dynasties.find(d => d.dynastyId === id)?.name
  const personDynasty = (world: WorldState | undefined, id: string | undefined) => {
    const d = world?.persons.find(p => p.personId === id)?.legalDynasty
    return d?.status === 'DETERMINED' ? dynastyOf(world, d.dynastyId) : undefined
  }
  const territorialEndings: EndingTerritory[] | undefined = final?.regions.map(r => ({ id: r.regionId, name: r.name,
    titles: final.titles.filter(t => t.kind === 'TERRITORIAL' && t.regionId === r.regionId).map(t => {
      const personId = t.holder.status === 'HELD' ? t.holder.personId : undefined
      return { id: t.titleId, holder: t.holder.status, personId, dynasty: personDynasty(final, personId), assessment: assessments.find(a => a.titleId === t.titleId) }
    }),
  }))
  const traceEvidence = (t: DecisionTrace): Evidence => ({ kind: 'trace', id: t.traceId, year: t.year, text: reasonSentence(t.reasonCodes) })
  const eventEvidence = (id: string | undefined, text: string): Evidence | undefined => {
    const e = id === undefined ? undefined : eventsById.get(id)
    return e && { kind: 'event', id: e.eventId, year: e.year, text }
  }
  const titleInput = (t: DecisionTrace, id: string) => t.candidates.find(c => c.inputs?.titleId === id)?.inputs
  const succession = losses.flatMap((loss): SuccessionEvidence[] => {
    const person = people.find(p => p.personId === loss.lastHolderId)
    const year = loss.lostFromYear - 1
    const world = years.get(year)
    const nextHolder = years.get(loss.lostFromYear)?.titles.find(t => t.titleId === loss.titleId)?.holder.status
    const related = (traces.get(year) ?? []).filter(t => t.ruleId === 'A-SUC-04' && titleInput(t, loss.titleId))
    const discovery = related.find(t => titleInput(t, loss.titleId)?.predecessorPersonId === loss.lastHolderId &&
      t.reasonCodes.includes('AUTONOMOUS_CANDIDATE_DISCOVERY_ONLY'))
    const inputs = discovery && titleInput(discovery, loss.titleId)
    const proposedIds = stringList(inputs?.proposedHeirPersonIds)
    const proposedDynasties = stringList(inputs?.proposedHeirLegalDynasties)
    const deathId = stringList(inputs?.sourceB003EventIds)?.find(id => id === person?.deathEventId) ?? person?.deathEventId
    const death = deathId && eventsById.get(deathId)?.year === year ? eventEvidence(deathId, '死亡の記録') : undefined
    const caseId = string(inputs?.caseId)
    const admin = related.find(t => caseId !== undefined && titleInput(t, loss.titleId)?.caseId === caseId &&
      t.reasonCodes.includes('LEGAL_CASE_RECORDING_ONLY') && t.reasonCodes.includes('NOT_SUCCESSION_APPROVAL'))
    const caseRecord = eventEvidence(admin?.eventIds[0], '保留案件の登録')
    const transfer = eventEvidence(loss.transferEventId, '保持者を未確定にした記録')
    const reviews: Review[] = []
    for (const t of decisionTraces) {
      if (t.year <= year || t.ruleId !== 'A-SUC-04' || !t.reasonCodes.includes('DEC_055_PENDING_REVIEW')) continue
      const input = titleInput(t, loss.titleId)
      if (caseId === undefined || input?.legalCaseId !== caseId ||
        (typeof input.predecessorPersonId === 'string' && input.predecessorPersonId !== loss.lastHolderId)) continue
      const first = traceEvidence(t)
      const candidateId = string(input.candidatePersonId)
      const signature = JSON.stringify([t.status, t.reasonCodes, candidateId])
      const last = reviews.at(-1)
      if (last && last.through + 1 === t.year && last.signature === signature) { last.through = t.year; last.lastId = t.traceId }
      else reviews.push({ first, through: t.year, lastId: t.traceId, candidateId, signature })
    }
    const spouse = person?.marriages.find(m => m.registeredYear < year && (m.dissolvedYear ?? Infinity) >= year)
    const judgments = (person?.judgments ?? []).filter(j => (j.ruleId === 'B-002' || j.ruleId === 'B-004' || j.ruleId === 'B-005') &&
      j.partnerId !== undefined && j.partnerId === spouse?.partnerId && j.toYear <= year).flatMap(j => {
      const t = traces.get(j.fromYear)?.find(t => t.traceId === j.firstTraceId)
      return t ? [{ first: { ...traceEvidence(t), text: `${j.ruleId === 'B-002' ? '出生' : j.ruleId === 'B-004' ? '婚姻候補' : '婚姻契約'}：${reasonSentence(j.reasonCodes)}` }, through: j.toYear }] : []
    })
    if (!world || !person) return []
    return [{ titleId: loss.titleId, year, predecessorId: loss.lastHolderId, dynasty: personDynasty(world, loss.lastHolderId),
      spouse: spouse && { id: spouse.partnerId, year: spouse.registeredYear },
      proposed: proposedIds?.map((id, i) => ({ id, dynasty: dynastyOf(world, proposedDynasties?.[i]) })),
      death, discovery: discovery && traceEvidence(discovery), caseRecord, transfer, nextHolder, reviews, judgments }]
  })
  const chronicle = snapshots.flatMap(w => chronicleRows(w, events.get(w.year) ?? [], traces.get(w.year) ?? [], false))
  return { territorialEndings, succession, chronicle, personNames: Object.fromEntries(people.map(p => [p.personId, nameOf(p.personId) ?? p.name])) }
}
export type HistoryDigest = ReturnType<typeof buildHistoryDigest>
