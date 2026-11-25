import { GOAL_YEAR, START_YEAR } from '../../../simulation/contracts/index.ts'
import type { DecisionTrace, EventLogEntry, Id, Person, WorldState } from '../../../simulation/contracts/index.ts'
import { normalizePersonPair } from '../../../simulation/intervention/index.ts'
import { compareYear, PLAY_DEFAULT_MODE, playConfigDigest, playConfigId, playModifierId } from '../../branch-play-source.ts'
import type { DisplayOmission, ObservationInput, ObservationSlice, OmittedRecordCounts, PlayInput, PlayMode, PlayView, SecondPlayInput } from '../../branch-play-source.ts'
import { eventsOfYear, lastComputedYear, snapshotOf } from '../../timeline-source.ts'
import type { TimelineRun } from '../../timeline-source.ts'

export type HistoryBranch = 'A0' | 'A1' | 'A2'
export type HistoryConfiguration = Readonly<{
  mode: PlayMode
  configId: string | undefined
  configDigest: string | undefined
}>
/** 固定のエンジン枝IDだけでは別seed・別介入を識別できない。同一ブラウザビルド内の来歴。 */
export type HistoryOrigin = Readonly<{
  configuration: HistoryConfiguration
  seed: number
  branch: HistoryBranch
  modifierIds: readonly Id[]
}>
export type HistoryYearRef = Readonly<{ origin: HistoryOrigin; year: number }>
export type YearUnavailable =
  | Readonly<{ kind: 'UNCOMPUTED' | 'NOT_LOADED' | 'OUT_OF_RANGE' }>
  | Readonly<{ kind: 'HALTED'; haltedAt: number | undefined }>
export type YearStart = Readonly<{ kind: 'CONFIRMED'; world: WorldState }> | YearUnavailable
export type YearRecords = YearUnavailable
  | Readonly<{ kind: 'EVALUATION_ONLY' }>
  | Readonly<{
      kind: 'COMMITTED'
      events: readonly EventLogEntry[]
      traces: readonly DecisionTrace[]
      coverage: Readonly<{ kind: 'COMPLETE' }> | Readonly<{
        kind: 'TRANSFER_OMISSION'
        scope: 'YEAR' | 'RUN'
        counts: OmittedRecordCounts
      }>
    }>

type PersonPresence = Readonly<{ kind: 'ALIVE' | 'DEAD'; person: Person }>
  | Readonly<{ kind: 'NOT_BORN' | 'NOT_PRESENT' | 'ABSENT_FROM_BRANCH' | 'UNKNOWN' }>
  | YearUnavailable

type RecordLookup<T> = Readonly<{ kind: 'RECORDED'; record: T }>
  | Readonly<{ kind: 'NO_RECORD' | 'POSSIBLY_OMITTED' | 'EVALUATION_ONLY' }>
  | YearUnavailable

function lookup<T>(records: readonly T[], predicate: (record: T) => boolean, omitted: boolean): RecordLookup<T> {
  const record = records.find(predicate)
  return record !== undefined ? { kind: 'RECORDED', record }
    : { kind: omitted ? 'POSSIBLY_OMITTED' : 'NO_RECORD' }
}
const hasOmissions = (counts: Readonly<Record<string, number>>, key?: string): boolean =>
  key === undefined ? Object.values(counts).some(n => n > 0) : Object.hasOwn(counts, key) && (counts[key] ?? 0) > 0

function yearRecords(
  events: readonly EventLogEntry[], traces: readonly DecisionTrace[], year: number, omission?: DisplayOmission,
): YearRecords {
  const counts = omission?.byYear === undefined ? omission : omission.byYear[year]
  return {
    kind: 'COMMITTED', events, traces,
    coverage: counts && (hasOmissions(counts.omittedEventsByType) || hasOmissions(counts.omittedTracesByRule))
      ? { kind: 'TRANSFER_OMISSION', scope: omission?.byYear === undefined ? 'RUN' : 'YEAR', counts }
      : { kind: 'COMPLETE' },
  }
}

function yearRef(
  ref: HistoryYearRef, start: YearStart, records: YearRecords,
  knownPerson: (id: Id) => Readonly<{ birthYear: number }> | undefined,
  fullPersonCoverage: boolean,
) {
  const omissions = records.kind === 'COMMITTED' && records.coverage.kind === 'TRANSFER_OMISSION'
    ? records.coverage.counts : undefined
  return {
    ref, start, records,
    person(personId: Id): PersonPresence {
      if (start.kind !== 'CONFIRMED') return start
      const person = start.world.persons.find(p => p.personId === personId)
      if (person) return { kind: person.alive ? 'ALIVE' : 'DEAD', person }
      const known = knownPerson(personId)
      if (known) return { kind: ref.year <= known.birthYear ? 'NOT_BORN' : 'NOT_PRESENT' }
      return { kind: fullPersonCoverage ? 'ABSENT_FROM_BRANCH' : 'UNKNOWN' }
    },
    event(id: Id, eventType?: string): RecordLookup<EventLogEntry> {
      if (records.kind !== 'COMMITTED') return records
      return lookup(records.events, e => e.eventId === id && (eventType === undefined || e.eventType === eventType),
        omissions !== undefined && hasOmissions(omissions.omittedEventsByType, eventType))
    },
    trace(id: Id, ruleId?: string): RecordLookup<DecisionTrace> {
      if (records.kind !== 'COMMITTED') return records
      return lookup(records.traces, t => t.traceId === id && (ruleId === undefined || t.ruleId === ruleId),
        omissions !== undefined && hasOmissions(omissions.omittedTracesByRule, ruleId))
    },
  } as const
}

export type HistoryYear = ReturnType<typeof yearRef>
const validYear = (year: number) => Number.isInteger(year) && year >= START_YEAR && year <= GOAL_YEAR

/** Worker観測の最新要求との照合用。要求の世代そのものは latestRequest で照合する。 */
export function matchesObservation(input: ObservationInput, slice: ObservationSlice): boolean {
  return input.seed === slice.seed && input.mode === slice.mode && input.year === slice.year
    && slice.year === slice.world.year && playConfigId(input.mode) === slice.configId
    && playConfigDigest(input.mode) === slice.configDigest
}

/** 同じ構成の原史専用。別年はキャッシュ内にあっても、このsliceでは未取得。 */
export function historyFromObservation(slice: ObservationSlice) {
  const origin: HistoryOrigin = {
    seed: slice.seed, branch: 'A0', modifierIds: [],
    configuration: { mode: slice.mode, configId: slice.configId, configDigest: slice.configDigest },
  }
  const personRecord = (id: Id) => slice.personRecords.find(p => p.personId === id)
  return {
    origin,
    at(year: number): HistoryYear {
      const ref = { origin, year }
      if (!validYear(year)) {
        const missing = { kind: 'OUT_OF_RANGE' } as const
        return yearRef(ref, missing, missing, personRecord, false)
      }
      if (year !== slice.year || year !== slice.world.year) {
        const missing = { kind: 'NOT_LOADED' } as const
        return yearRef(ref, missing, missing, personRecord, false)
      }
      return yearRef(ref, { kind: 'CONFIRMED', world: slice.world },
        year === GOAL_YEAR ? { kind: 'EVALUATION_ONLY' } : yearRecords(slice.events, slice.traces, year),
        personRecord, slice.status === 'COMPLETED')
    },
    personRecord,
    titleHistories: slice.titleHistories,
  } as const
}

function timelineYear(run: TimelineRun, origin: HistoryOrigin, year: number, omission?: DisplayOmission): HistoryYear {
  const ref = { origin, year }
  const unavailable = (reason: YearUnavailable) => yearRef(ref, reason, reason, () => undefined, false)
  if (!validYear(year)) return unavailable({ kind: 'OUT_OF_RANGE' })
  if (run.pending) return unavailable({ kind: 'UNCOMPUTED' })
  const r = run.result
  const halted = { kind: 'HALTED', haltedAt: r.halt?.year } as const
  const world = snapshotOf(r, year)
  if (!world) return unavailable(r.status === 'HALTED' && year >= (r.halt?.year ?? r.startYear)
    ? halted : { kind: 'UNCOMPUTED' })
  const records = r.status === 'COMPLETED' && year === GOAL_YEAR ? { kind: 'EVALUATION_ONLY' } as const
    : year < (lastComputedYear(r) ?? year)
      ? yearRecords(eventsOfYear(r, year), r.decisionTraces.filter(t => t.year === year), year, omission)
      : r.status === 'HALTED' ? halted : { kind: 'UNCOMPUTED' } as const
  function knownPerson(id: Id): Person | undefined {
    for (const snapshot of r.snapshots) {
      const person = snapshot.persons.find(p => p.personId === id)
      if (person) return person
    }
    return undefined
  }
  return yearRef(ref, { kind: 'CONFIRMED', world }, records, knownPerson,
    r.status === 'COMPLETED' && r.snapshots[0]?.year === START_YEAR && lastComputedYear(r) === GOAL_YEAR)
}

const sumCounts = (counts: Readonly<Record<string, number>>) => Object.values(counts).reduce((sum, n) => sum + n, 0)
const expectedBranchId: Readonly<Record<HistoryBranch, string>> = { A0: 'A0-play', A1: 'A1-play', A2: 'A2-play' }

function isPair(view: PlayView, parentModifierId?: Id): boolean {
  const { a0, a1, input, mode } = view
  const [before, after] = parentModifierId === undefined ? ['A0', 'A1'] as const : ['A1', 'A2'] as const
  const parentIds = parentModifierId === undefined ? [] : [parentModifierId]
  const pair = normalizePersonPair(input.firstPersonId, input.secondPersonId)
  const omission = view.displayOmission
  const hasIds = (run: TimelineRun, ids: readonly Id[]) =>
    run.playModifierIds?.length === ids.length && ids.every(id => run.playModifierIds?.includes(id))
  return pair !== null && view.modifier.modifierId === playModifierId(input.year, pair, input.signedDelta, input.durationYears)
    && hasIds(a0, parentIds) && hasIds(a1, [...parentIds, view.modifier.modifierId])
    && (omission ? (['a0', 'a1'] as const).every(side => {
      const r = view[side].result
      return r.eventLog.length + sumCounts(omission.omittedEventsByType) === omission.fullEventCount[side]
        && r.decisionTraces.length + sumCounts(omission.omittedTracesByRule) === omission.fullTraceCount[side]
    }) : !a0.logsOmitted && !a1.logsOmitted)
    && (input.mode ?? PLAY_DEFAULT_MODE) === mode
    && a0.inputs.configId === playConfigId(mode) && a0.inputs.configDigest === playConfigDigest(mode)
    && a0.result.branchId === expectedBranchId[before] && a1.result.branchId === expectedBranchId[after]
    && [a0, a1].every(run => run.inputs.seed === input.seed && run.result.seed === input.seed)
    && a0.inputs.configId === a1.inputs.configId && a0.inputs.configDigest === a1.inputs.configDigest
    && a0.inputs.rulesetVersion === a1.inputs.rulesetVersion && a0.inputs.rngVersion === a1.inputs.rngVersion
}

function attachedFollowup(view: PlayView): PlayView | undefined {
  const { a1, input, mode, second } = view
  return second && isPair(second, view.modifier.modifierId)
    && second.mode === mode && second.input.seed === input.seed && second.input.year === input.year
    && second.a0.inputs.rulesetVersion === a1.inputs.rulesetVersion && second.a0.inputs.rngVersion === a1.inputs.rngVersion
    ? second : undefined
}

const sameIntervention = (a: SecondPlayInput, b: SecondPlayInput) =>
  a.firstPersonId === b.firstPersonId && a.secondPersonId === b.secondPersonId
  && a.signedDelta === b.signedDelta && a.durationYears === b.durationYears

/** A2は親ビューと合成した後に照合する。input.yearは介入年であり、閲覧年ではない。 */
export function matchesPlayRequest(input: PlayInput, view: PlayView): boolean {
  if (!isPair(view) || (input.mode ?? PLAY_DEFAULT_MODE) !== view.mode
    || input.seed !== view.input.seed || input.year !== view.input.year || !sameIntervention(input, view.input)) return false
  const second = attachedFollowup(view)
  return input.second ? second !== undefined && sameIntervention(input.second, second.input) : view.second === undefined
}

/** 比較DTOのスロット名ではなく実枝を使う。単独のA1→A2 DTOはA0→A1として扱わない。 */
export function historyFromPlayView(view: PlayView) {
  if (!isPair(view)) return undefined
  const { a0, a1, input, mode } = view
  const configuration: HistoryConfiguration = { mode, configId: a0.inputs.configId, configDigest: a0.inputs.configDigest }
  const followup = attachedFollowup(view)
  const origin = (branch: HistoryBranch): HistoryOrigin => ({
    seed: input.seed, configuration, branch,
    modifierIds: branch === 'A0' ? [] : branch === 'A1' || !followup ? [view.modifier.modifierId]
      : [view.modifier.modifierId, followup.modifier.modifierId],
  })
  function source(branch: HistoryBranch) {
    return branch === 'A0' ? { run: a0, omission: view.displayOmission }
      : branch === 'A1' ? { run: a1, omission: view.displayOmission }
      : followup && { run: followup.a1, omission: followup.displayOmission }
  }
  return {
    at(branch: HistoryBranch, year: number): HistoryYear | undefined {
      const s = source(branch)
      return s && timelineYear(s.run, origin(branch), year, s.omission)
    },
    /** 1人分の年初の実記録を参照する。ログの完全性や選択年の生死とは別。 */
    personHistory(branch: HistoryBranch, personId: Id) {
      const s = source(branch)
      if (!s) return undefined
      const r = s.run.result
      return {
        origin: origin(branch), personId, throughYear: lastComputedYear(r),
        status: s.run.pending ? 'UNCOMPUTED' as const : r.status,
        observations: r.snapshots.flatMap(w => {
          const person = w.persons.find(p => p.personId === personId)
          return person ? [{ year: w.year, person } as const] : []
        }) as readonly Readonly<{ year: number; person: Person }>[],
      } as const
    },
    compare(pair: 'A0_A1' | 'A1_A2', year: number) {
      const c = pair === 'A0_A1' ? view : followup
      if (!c || !validYear(year)) return undefined
      const before = timelineYear(c.a0, origin(pair === 'A0_A1' ? 'A0' : 'A1'), year, c.displayOmission)
      const after = timelineYear(c.a1, origin(pair === 'A0_A1' ? 'A1' : 'A2'), year, c.displayOmission)
      const canCompare = (x: HistoryYear) => x.records.kind === 'COMMITTED' || x.records.kind === 'EVALUATION_ONLY'
      return { before, after, changes: canCompare(before) && canCompare(after) ? compareYear(c, year) : undefined } as const
    },
  } as const
}
