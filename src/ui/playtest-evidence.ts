import { EXPERIMENTAL_VERSIONS } from '../scenario/experimental/world-1250.ts'
import { ORDINARY_MARRIAGE_VERSION } from '../simulation/rules/a/aleg01-ordinary.ts'
import { REVIEWED_LEGAL_VERSION } from '../simulation/rules/a/reviewed-succession.ts'
import { GOAL_YEAR, START_YEAR } from '../simulation/contracts/index.ts'
import type { Id, StatModifier, WorldState } from '../simulation/contracts/index.ts'
import { normalizePersonPair, validateStatModifier } from '../simulation/intervention/index.ts'
import { rngVersion } from '../simulation/random.ts'
import { EXPERIMENTAL_TUNING } from '../simulation/tuning.ts'
import { playModifier } from './branch-play-source.ts'
import type { ObservationInput, PlayInput, PlayView } from './branch-play-source.ts'
import type { TimelineRun } from './timeline-source.ts'
import { historyFromObservation, historyFromPlayView, matchesObservation, matchesPlayRequest, sameHistoryYearRef } from './desk/data/history.ts'
import type { HistoryYear, HistoryYearRef } from './desk/data/history.ts'
import { LIMITED_PLAYTEST_SEED, limitedPlayConfig } from './desk/data/limited-config.ts'
import { eventHeadline, isObservationFocusEvent, namesOfYear } from './integrated-overview.ts'
import { collectAssociations } from './observation/associations.ts'
import { parseEvidence, EVIDENCE_MAX_BYTES, EvidenceError, REFERENCE_LIMIT } from './playtest-evidence/schema.ts'
import type { BranchEvidence, DebugSelection, Evidence, EvidenceBuild, EventEvidence, PublicSelection, RunSelection, Transfer } from './playtest-evidence/types.ts'

export { EVIDENCE_MAX_BYTES, EvidenceError, parseEvidence } from './playtest-evidence/schema.ts'
export type { Evidence, EvidenceBuild } from './playtest-evidence/types.ts'

export function evidenceBuild(value: string | undefined, dirty = false): EvidenceBuild {
  if (dirty) return { kind: 'LOCAL', reason: 'DIRTY' }
  if (value === 'local') return { kind: 'LOCAL', reason: 'LOCAL' }
  return value && /^[0-9a-f]{40}$/.test(value) && !/^0+$/.test(value)
    ? { kind: 'COMMIT', sha: value }
    : { kind: 'LOCAL', reason: 'UNKNOWN' }
}

const mode = 'MULTI_HOUSE_EXPERIMENTAL'
const configuration = 'LIMITED_PLAYTEST'
export const limitedReplayInput = Object.freeze({ mode, configuration, seed: LIMITED_PLAYTEST_SEED })

async function sha256(text: string): Promise<string> {
  const hash = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return Array.from(new Uint8Array(hash), b => b.toString(16).padStart(2, '0')).join('')
}

export async function limitedEvidenceConfiguration() {
  const { configId, configDigest, configIdentity } = limitedPlayConfig()
  // 完全 identity 自体には非公開の校正・初期世界が含まれるため、その照合値だけを持つ。
  return { mode, configuration, configId, configDigest, identitySha256: await sha256(configIdentity) } as const
}

function checkSelection(input: ObservationInput | PlayInput) {
  if (input.mode !== mode || input.configuration !== configuration || input.seed !== LIMITED_PLAYTEST_SEED)
    throw new EvidenceError('UNSUPPORTED_CONFIGURATION', 'Phase 3A は限定試遊の既定構成と seed のみ対応します')
}

export function checkedModifier(year: number, first: Id, second: Id, signedDelta: number, durationYears: number): StatModifier {
  const pair = normalizePersonPair(first, second)
  if (!pair) throw new EvidenceError('INVALID_INPUT', '介入には異なる2人が必要です')
  const modifier = playModifier({ ...limitedReplayInput, year, firstPersonId: first, secondPersonId: second, signedDelta, durationYears }, pair)
  // 構文・値域の検証。実在・介入適格性は再実行時に既存の fork 年初の検証へ委ねる。
  const issues = validateStatModifier(modifier, { knownPersonIds: new Set(pair) })
  if (issues.length) throw new EvidenceError('INVALID_INPUT', issues.map(i => i.code).join(', '))
  return modifier
}

function startSummary(world: WorldState, ids: readonly Id[]) {
  return {
    population: world.groups.reduce((sum, group) => sum + group.population, 0),
    alivePersons: world.persons.filter(person => person.alive).length,
    persons: ids.map(id => {
      const person = world.persons.find(p => p.personId === id)
      // 未登場・未取得などの理由は、この年初の状態だけから推測しない。
      return { id, presence: person === undefined ? 'ABSENT' as const : person.alive ? 'ALIVE' as const : 'DEAD' as const }
    }),
  }
}

const byId = <T extends { id: Id }>(a: T, b: T) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0
const total = (counts: Readonly<Record<string, number>>) => Object.values(counts).reduce((sum, n) => sum + n, 0)

async function summarizeYear(entry: HistoryYear, run: TimelineRun | undefined, ids: readonly Id[], selection: PublicSelection | undefined,
  debug: DebugSelection | undefined): Promise<Readonly<{ player: BranchEvidence; debug: Evidence['debug'] }>> {
  const { start, records } = entry
  if (start.kind !== 'CONFIRMED' || (records.kind !== 'COMMITTED' && records.kind !== 'EVALUATION_ONLY'))
    throw new EvidenceError('YEAR_UNAVAILABLE', '選択年の確定済み状態・記録がありません')
  const branch = entry.ref.origin.branch
  if (branch !== 'A0' && branch !== 'A1') throw new EvidenceError('UNSUPPORTED_BRANCH', 'A2 以降には対応していません')
  const selectedEventId = selection?.event?.branch === branch ? selection.event.id : undefined
  let visible: EventEvidence[] = []
  if (records.kind === 'COMMITTED') {
    const personId = selection?.personId
    const related = personId === undefined ? undefined : new Set(collectAssociations({ year: entry.ref.year, events: records.events })
      .confirmed.flatMap(a => a.target.kind === 'PERSON' && a.target.id === personId && a.source.type === 'EVENT' ? [a.source.eventId] : []))
    const names = namesOfYear(start.world, records.events)
    // 通常は観測の既定一覧、明示選択時は「全 Event」で閲覧できる参照も追加する。内部差分は出力しない。
    visible = records.events.filter(e => e.eventId === selectedEventId ||
      (isObservationFocusEvent(e) && (related === undefined || related.has(e.eventId))))
      .map(e => ({ id: e.eventId, type: e.eventType,
        headline: isObservationFocusEvent(e) ? eventHeadline(e, names, e.eventType) : null,
        traceIds: [...e.sourceTraceIds].sort() })).sort(byId)
  }
  const chosen = selectedEventId === undefined ? undefined : visible.find(e => e.id === selectedEventId)
  if (selectedEventId !== undefined && !chosen)
    throw new EvidenceError('EVENT_UNAVAILABLE', '指定 Event を選択年に取得できません（転送省略の可能性を含む）')
  let selectedDebug: Evidence['debug'] = null
  if (debug?.branch === branch) {
    const hit = entry.trace(debug.traceId)
    if (hit.kind !== 'RECORDED') throw new EvidenceError('TRACE_UNAVAILABLE', `指定 Trace を取得できません: ${hit.kind}`)
    const trace = hit.record
    selectedDebug = { channel: 'DEBUG', branch, traceId: trace.traceId, ruleId: trace.ruleId,
      ruleVersion: trace.ruleVersion, status: trace.status, eventIds: [...trace.eventIds].sort() }
  }
  const coverage = records.kind === 'EVALUATION_ONLY' ? { kind: 'EVALUATION_ONLY' as const }
    : { kind: records.coverage.kind, eventCount: records.events.length, traceCount: records.traces.length,
      omission: records.coverage.kind === 'COMPLETE' ? null : { scope: records.coverage.scope,
        events: total(records.coverage.counts.omittedEventsByType), traces: total(records.coverage.counts.omittedTracesByRule) } }
  const retained = visible.slice(0, REFERENCE_LIMIT)
  if (chosen && !retained.includes(chosen)) retained.push(chosen)
  return { player: { branch, scenarioId: run?.inputs.scenarioId ?? null, modifierIds: [...entry.ref.origin.modifierIds],
    yearStart: startSummary(start.world, ids), coverage,
    events: { count: visible.length, refs: retained, sha256: await sha256(JSON.stringify(visible)) } }, debug: selectedDebug }
}

export type EvidenceSource = Readonly<{
  build: EvidenceBuild
  /** 同一入力で再試行した場合も変える。完了 DTO と同時に記録した世代と照合する。 */
  requestId: number
  selected: HistoryYearRef
  selection?: PublicSelection
  /** 明示操作に限る。通常の PLAYER エクスポートからは渡さない。 */
  debug?: DebugSelection
}> & RunSelection

/** 採用済み DTO の純粋な読み取り。実行、履歴複製、保存先への書き込みは行わない。 */
export async function exportPlaytestEvidence(source: EvidenceSource): Promise<Evidence> {
  const { selected, selection, debug } = source
  if (source.outcome.kind !== 'DONE') throw new EvidenceError('NO_RESULT', `現在の結果は採用できません: ${source.outcome.kind}`)
  if (source.requestId !== source.outcome.requestId) throw new EvidenceError('STALE_RESULT', '結果は現在の要求の世代に属しません')
  checkSelection(source.input)
  const branch = selected.origin.branch
  if (branch !== 'A0' && branch !== 'A1') throw new EvidenceError('UNSUPPORTED_BRANCH', 'A2 以降には対応していません')
  if (!Number.isInteger(selected.year) || selected.year < START_YEAR || selected.year > GOAL_YEAR)
    throw new EvidenceError('YEAR_UNAVAILABLE', '選択年が範囲外です')

  let a0: HistoryYear, a1: HistoryYear | undefined, view: PlayView | undefined
  let applied: Evidence['intervention'] = null
  let transfer: Transfer = 'FULL'
  if (source.kind === 'OBSERVATION') {
    const observation = source.outcome.result
    if (!observation || branch !== 'A0' || selected.year !== source.input.year || !matchesObservation(source.input, observation))
      throw new EvidenceError('OBSERVATION_MISMATCH', '選択と採用済みの実 A0 観測が一致しません')
    a0 = historyFromObservation(observation).at(selected.year)
  } else {
    view = source.outcome.result
    if (!view || source.input.second !== undefined || view.second !== undefined || !matchesPlayRequest(source.input, view))
      throw new EvidenceError('COMPARISON_MISMATCH', '現在の実行要求と採用済み A0/A1 比較が一致しません')
    const history = historyFromPlayView(view)
    const before = history?.at('A0', selected.year), after = history?.at('A1', selected.year)
    if (!before || !after) throw new EvidenceError('YEAR_UNAVAILABLE', '両枝の履歴が取得できません')
    a0 = before
    a1 = after
    const { year, firstPersonId, secondPersonId, signedDelta, durationYears } = view.input
    const expected = checkedModifier(year, firstPersonId, secondPersonId, signedDelta, durationYears)
    // matchesPlayRequest は playModifier と実台帳の全項目を照合済み。
    applied = { year, firstPersonId, secondPersonId, signedDelta, durationYears, modifierId: expected.modifierId,
      ruleVersion: view.modifier.ruleVersion }
    if (view.displayOmission) transfer = view.displayOmission.byYear ? 'DISPLAY_YEAR' : 'DISPLAY_RUN'
  }
  const selectedEntry = branch === 'A0' ? a0 : a1
  if (!selectedEntry || !sameHistoryYearRef(selected, selectedEntry.ref))
    throw new EvidenceError('HISTORY_MISMATCH', '選択年の実枝・構成・介入の来歴が一致しません')
  if (!a1 && (selection?.event?.branch === 'A1' || debug?.branch === 'A1'))
    throw new EvidenceError('UNSUPPORTED_BRANCH', 'A0 観測に A1 の参照は指定できません')
  const ids = [...new Set([...(applied ? [applied.firstPersonId, applied.secondPersonId] : []), ...(selection?.personId ? [selection.personId] : [])])].sort()
  const before = await summarizeYear(a0, view?.a0, ids, selection, debug)
  const after = a1 ? await summarizeYear(a1, view?.a1, ids, selection, debug) : undefined
  const evidence: Evidence = {
    schemaVersion: 1, build: source.build, config: await limitedEvidenceConfiguration(), seed: source.input.seed,
    kind: source.kind, year: selected.year, branch, intervention: applied, transfer,
    versions: { ruleset: view?.a0.inputs.rulesetVersion ?? EXPERIMENTAL_TUNING.rulesetVersion,
      rng: view?.a0.inputs.rngVersion ?? rngVersion, scenario: null, legal: null,
      baseScenario: EXPERIMENTAL_VERSIONS.scenarioVersion,
      legalRules: { ordinaryMarriage: ORDINARY_MARRIAGE_VERSION, reviewedSuccession: REVIEWED_LEGAL_VERSION } },
    selection: { personId: selection?.personId ?? null, event: selection?.event ?? null },
    player: { channel: 'PLAYER', status: 'COMPLETED', officialGoal: 'NOT_ESTABLISHED', branches: after ? [before.player, after.player] : [before.player] },
    debug: before.debug ?? after?.debug ?? null,
  }
  return parseEvidence(JSON.stringify(evidence))
}

export function serializePlaytestEvidence(evidence: Evidence): string {
  const json = JSON.stringify(evidence)
  if (new TextEncoder().encode(json).length > EVIDENCE_MAX_BYTES)
    throw new EvidenceError('INPUT_TOO_LARGE', '証跡のサイズ上限を超えました')
  return json
}
