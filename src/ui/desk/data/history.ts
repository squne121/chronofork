import { createMultiHouseDemandTrustObserver } from '../../../scenario/experimental/index.ts'
import { GOAL_YEAR, START_YEAR } from '../../../simulation/contracts/index.ts'
import type { DecisionTrace, EventLogEntry, Id, Person, WorldState } from '../../../simulation/contracts/index.ts'
import { normalizePersonPair } from '../../../simulation/intervention/index.ts'
import { compareYear, PLAY_DEFAULT_MODE, playConfigDigest, playConfigId, playModifier, playModifierId } from '../../branch-play-source.ts'
import type { DisplayOmission, ObservationInput, ObservationSlice, OmittedRecordCounts, PlayInput, PlayMode, PlayView, SecondPlayInput } from '../../branch-play-source.ts'
import { candidateSetMatches } from '../../play-candidates.ts'
import { jsonSame } from '../../play-view.ts'
import { denseArray, hasDemandTrust, isLimitedTimeline, isLimitedYearStart, LIMITED_PLAYTEST_DRIFT, LIMITED_PLAYTEST_SEED, limitedPlayConfig } from './limited-config.ts'
import { eventsOfYear, lastComputedYear, snapshotOf } from '../../timeline-source.ts'
import type { TimelineRun } from '../../timeline-source.ts'

export type HistoryBranch = 'A0' | 'A1' | 'A2'
export type HistoryConfiguration = Readonly<{
  mode: PlayMode
  configId: string | undefined
  configDigest: string | undefined
  configIdentity?: string
}>
/** 固定のエンジン枝IDだけでは別seed・別介入を識別できない。同一ブラウザビルド内の来歴。 */
export type HistoryOrigin = Readonly<{
  configuration: HistoryConfiguration
  seed: number
  branch: HistoryBranch
  modifierIds: readonly Id[]
}>
export type HistoryYearRef = Readonly<{ origin: HistoryOrigin; year: number }>

/** 資料窓の要求照合に使う。枝 ID や digest 単独では来歴を表さない。 */
export function sameHistoryYearRef(a: HistoryYearRef, b: HistoryYearRef): boolean {
  const x = a.origin, y = b.origin
  return a.year === b.year && x.seed === y.seed && x.branch === y.branch
    && x.configuration.mode === y.configuration.mode && x.configuration.configId === y.configuration.configId
    && x.configuration.configDigest === y.configuration.configDigest && x.configuration.configIdentity === y.configuration.configIdentity
    && x.modifierIds.length === y.modifierIds.length && x.modifierIds.every((id, index) => id === y.modifierIds[index])
}
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

const observeTrust = createMultiHouseDemandTrustObserver(LIMITED_PLAYTEST_DRIFT)

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
    /** 年初の基礎値。当年の実評価は records/trace で別に参照する。 */
    relationship(left: Id, right: Id) {
      if (start.kind !== 'CONFIRMED') return start
      if (ref.origin.configuration.configIdentity === undefined)
        return { kind: 'UNSUPPORTED_CONFIGURATION' } as const
      return { kind: 'YEAR_START_BASE', observation: observeTrust(start.world, left, right) } as const
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
  const { configuration } = input
  return validYear(input.year) && input.seed === slice.seed && input.mode === slice.mode && input.year === slice.year
    && slice.year === slice.world.year && slice.configuration === configuration
    && playConfigId(input.mode, configuration) === slice.configId && playConfigDigest(input.mode, configuration) === slice.configDigest
    && (configuration === undefined ? slice.configIdentity === undefined && !hasDemandTrust(slice.world) : configuration === 'LIMITED_PLAYTEST'
      && input.mode === 'MULTI_HOUSE_EXPERIMENTAL' && input.seed === LIMITED_PLAYTEST_SEED
      && slice.configIdentity === limitedPlayConfig().configIdentity && slice.branchId === 'A0-play'
      && slice.status === 'COMPLETED' && slice.goal === null && slice.playLedger?.length === 0
      && isLimitedYearStart(slice.world, input.year)
      && matchesObservationRecords(slice) && matchesObservationSummaries(slice)
      && candidateSetMatches(slice.candidates, input.seed, input.mode, configuration))
}

function matchesObservationRecords(slice: ObservationSlice): boolean {
  const counts = slice.counts.filter(count => count.year === slice.year)
  return counts.length === 1 && counts[0]?.events === slice.events.length && counts[0]?.traces === slice.traces.length
    && (slice.year < GOAL_YEAR || (slice.events.length === 0 && slice.traces.length === 0))
    && denseArray(slice.events, e => e.year === slice.year && typeof e.eventId === 'string')
    && denseArray(slice.traces, t => t.year === slice.year && typeof t.traceId === 'string')
}

function matchesObservationSummaries(slice: ObservationSlice): boolean {
  return denseArray(slice.world.persons, p => typeof p.personId === 'string')
    && denseArray(slice.personRecords, p => typeof p.personId === 'string' && Number.isInteger(p.birthYear)
      && Array.isArray(p.marriages) && Array.isArray(p.childIds) && Array.isArray(p.titles) && Array.isArray(p.judgments))
    && denseArray(slice.titleHistories, t => typeof t.titleId === 'string' && Array.isArray(t.intervals) && Array.isArray(t.transfers))
    && denseArray(slice.titleLossRecords, t => typeof t.titleId === 'string')
    && (slice.knownA0Ending === null || (slice.knownA0Ending?.year === GOAL_YEAR
      && denseArray(slice.knownA0Ending.persons, p => typeof p.personId === 'string')))
}

/** 同じ構成の原史専用。別年はキャッシュ内にあっても、このsliceでは未取得。 */
export function historyFromObservation(slice: ObservationSlice) {
  if ((slice.configuration !== undefined || slice.configIdentity !== undefined || hasDemandTrust(slice.world))
    && !matchesObservation(slice, slice)) throw new TypeError('限定試遊の観測結果の来歴が一致しません')
  const origin: HistoryOrigin = {
    seed: slice.seed, branch: 'A0', modifierIds: [],
    configuration: { mode: slice.mode, configId: slice.configId, configDigest: slice.configDigest,
      ...(slice.configIdentity !== undefined ? { configIdentity: slice.configIdentity } : {}) },
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
function validOmission(omission: DisplayOmission): boolean {
  const countOnly = (counts: Readonly<Record<string, number>>, key: string) =>
    Object.entries(counts).every(([name, n]) => name === key && Number.isSafeInteger(n) && n >= 0)
  function validCounts(counts: OmittedRecordCounts) {
    return countOnly(counts.omittedEventsByType, 'PERSON_PAIR_TRUST_SET') && countOnly(counts.omittedTracesByRule, 'B-009')
  }
  if (!validCounts(omission)) return false
  if (omission.byYear === undefined) return true // 旧ビューでは全期間を省略の可能性ありとして扱う。
  let events = 0, traces = 0
  for (const [key, counts] of Object.entries(omission.byYear)) {
    const year = Number(key)
    if (String(year) !== key || !validYear(year) || year === GOAL_YEAR || !counts || !validCounts(counts)) return false
    events += sumCounts(counts.omittedEventsByType)
    traces += sumCounts(counts.omittedTracesByRule)
  }
  return events === sumCounts(omission.omittedEventsByType) && traces === sumCounts(omission.omittedTracesByRule)
}

// 分岐時の年初検証はオブジェクトを再構築するため、キーの挿入順だけが変わり得る。
// 配列の順序、キーの集合、値はすべて一致が必要で、DTOの来歴や実状態の差は許容しない。
function sameSnapshotValue(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object' || Array.isArray(a) !== Array.isArray(b)) return false
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false
  } else if (Object.getPrototypeOf(a) !== Object.prototype || Object.getPrototypeOf(b) !== Object.prototype) return false
  const left = Object.entries(a)
  const right = b as Record<string, unknown>
  return left.length === Object.keys(right).length && left.every(([key, value]) => Object.hasOwn(right, key) && sameSnapshotValue(value, right[key]))
}

const expectedBranchId: Readonly<Record<HistoryBranch, string>> = { A0: 'A0-play', A1: 'A1-play', A2: 'A2-play' }

function isPair(view: PlayView, parentModifierId?: Id): boolean {
  const { a0, a1, input, mode } = view
  const [before, after] = parentModifierId === undefined ? ['A0', 'A1'] as const : ['A1', 'A2'] as const
  const parentIds = parentModifierId === undefined ? [] : [parentModifierId]
  const pair = normalizePersonPair(input.firstPersonId, input.secondPersonId)
  const { configuration } = input
  const omission = view.displayOmission
  const hasIds = (run: TimelineRun, ids: readonly Id[]) =>
    run.playModifierIds?.length === ids.length && ids.every(id => run.playModifierIds?.includes(id))
  return pair !== null && view.modifier.modifierId === playModifierId(input.year, pair, input.signedDelta, input.durationYears)
    && hasIds(a0, parentIds) && hasIds(a1, [...parentIds, view.modifier.modifierId])
    && (omission ? (configuration !== 'LIMITED_PLAYTEST' || validOmission(omission)) && (['a0', 'a1'] as const).every(side => {
      const r = view[side].result
      return r.eventLog.length + sumCounts(omission.omittedEventsByType) === omission.fullEventCount[side]
        && r.decisionTraces.length + sumCounts(omission.omittedTracesByRule) === omission.fullTraceCount[side]
    }) : !a0.logsOmitted && !a1.logsOmitted)
    && (input.mode ?? PLAY_DEFAULT_MODE) === mode
    && a0.inputs.configId === playConfigId(mode, configuration) && a0.inputs.configDigest === playConfigDigest(mode, configuration)
    && (configuration === undefined ? [a0, a1].every(run => run.inputs.configIdentity === undefined
      && !hasDemandTrust(run.initialWorld) && !run.result.snapshots.some(hasDemandTrust))
      : configuration === 'LIMITED_PLAYTEST' && parentModifierId === undefined && !input.second && !view.second
        && mode === 'MULTI_HOUSE_EXPERIMENTAL' && input.seed === LIMITED_PLAYTEST_SEED
        && validYear(input.year) && input.year < GOAL_YEAR
        && jsonSame(view.modifier, playModifier(input, pair))
        && a0.playLedger?.length === 0 && a1.playLedger?.length === 1 && jsonSame(a1.playLedger[0]!, view.modifier)
        && isLimitedTimeline(a0, 'A0-play') && isLimitedTimeline(a1, 'A1-play')
        && sameSnapshotValue(a0.result.snapshots[input.year - START_YEAR], a1.result.snapshots[input.year - START_YEAR]))
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
    || input.configuration !== view.input.configuration || input.seed !== view.input.seed || input.year !== view.input.year || !sameIntervention(input, view.input)) return false
  const second = attachedFollowup(view)
  return input.second ? second !== undefined && sameIntervention(input.second, second.input) : view.second === undefined
}

/** 比較DTOのスロット名ではなく実枝を使う。単独のA1→A2 DTOはA0→A1として扱わない。 */
export function historyFromPlayView(view: PlayView) {
  if (!isPair(view)) return undefined
  const { a0, a1, input, mode } = view
  const configuration: HistoryConfiguration = { mode, configId: a0.inputs.configId, configDigest: a0.inputs.configDigest,
    ...(a0.inputs.configIdentity !== undefined ? { configIdentity: a0.inputs.configIdentity } : {}) }
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
