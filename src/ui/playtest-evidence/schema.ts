import { GOAL_YEAR, START_YEAR } from '../../simulation/contracts/index.ts'
import { LIMITED_PLAYTEST_SEED } from '../desk/data/limited-config.ts'
import type { Evidence } from './types.ts'

export const EVIDENCE_MAX_BYTES = 64 * 1024
export const REFERENCE_LIMIT = 8
export class EvidenceError extends Error {
  readonly code: string
  constructor(code: string, message: string) {
    super(message)
    this.code = code
  }
}

function requireField(condition: unknown, path: string): asserts condition {
  if (!condition) throw new EvidenceError('INVALID_INPUT', `証跡の項目が不正です: ${path}`)
}
function record(value: unknown, fields: string, path: string): Record<string, unknown> {
  requireField(value !== null && typeof value === 'object' && !Array.isArray(value), path)
  const keys = fields.split(' ')
  requireField(Object.keys(value).length === keys.length && keys.every(key => Object.hasOwn(value, key)), path)
  return value as Record<string, unknown>
}
function array(value: unknown, max: number, path: string): unknown[] {
  requireField(Array.isArray(value) && value.length <= max, path)
  return value
}
function integer(value: unknown, min: number, max = Number.MAX_SAFE_INTEGER): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= min && value <= max
}
function text(value: unknown, max = 2048): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= max && value.trim() === value
    && ![...value].some(char => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127)
}
const personId = (value: unknown): value is string => text(value, 512) && !/\s/u.test(value)
const sha256 = (value: unknown) => typeof value === 'string' && /^[0-9a-f]{64}$/.test(value)
const oneOf = (value: unknown, ...choices: string[]) => typeof value === 'string' && choices.includes(value)

function ids(value: unknown, max: number, path: string) {
  const list = array(value, max, path)
  requireField(list.every(id => text(id)) && new Set(list).size === list.length, path)
  return list
}

/** 小さな入力だけを読み、未知項目・型・枝/年/選択の矛盾を拒否する。計算・I/O は行わない。 */
export function parseEvidence(json: string): Evidence {
  if (json.length > EVIDENCE_MAX_BYTES || new TextEncoder().encode(json).length > EVIDENCE_MAX_BYTES)
    throw new EvidenceError('INPUT_TOO_LARGE', '証跡のサイズ上限は64 KiBです')
  let value: unknown
  try { value = JSON.parse(json) } catch { throw new EvidenceError('INVALID_JSON', 'JSON を読み取れません') }
  const version = value !== null && typeof value === 'object' && 'schemaVersion' in value ? value.schemaVersion : undefined
  if (version !== 1) throw new EvidenceError('UNSUPPORTED_SCHEMA', '対応する schemaVersion は 1 のみです')
  const root = record(value, 'schemaVersion build config seed kind year branch intervention transfer versions selection player debug', 'root')
  const buildKind = root.build !== null && typeof root.build === 'object' && 'kind' in root.build ? root.build.kind : undefined
  if (buildKind === 'COMMIT') {
    const build = record(root.build, 'kind sha', 'build')
    requireField(typeof build.sha === 'string' && /^[0-9a-f]{40}$/.test(build.sha) && !/^0+$/.test(build.sha), 'build.sha')
  } else {
    const build = record(root.build, 'kind reason', 'build')
    requireField(build.kind === 'LOCAL' && oneOf(build.reason, 'LOCAL', 'UNKNOWN', 'DIRTY'), 'build')
  }
  const config = record(root.config, 'mode configuration configId configDigest identitySha256', 'config')
  if (config.mode !== 'MULTI_HOUSE_EXPERIMENTAL' || config.configuration !== 'LIMITED_PLAYTEST' || root.seed !== LIMITED_PLAYTEST_SEED)
    throw new EvidenceError('UNSUPPORTED_CONFIGURATION', '限定試遊の既定構成と seed のみ対応します')
  requireField(text(config.configId, 256) && text(config.configDigest, 128) && sha256(config.identitySha256), 'config')
  const versions = record(root.versions, 'ruleset rng scenario legal', 'versions')
  requireField(text(versions.ruleset, 256) && text(versions.rng, 256) && versions.scenario === null && versions.legal === null, 'versions')
  requireField(integer(root.year, START_YEAR, GOAL_YEAR), 'year')
  requireField(oneOf(root.transfer, 'FULL', 'DISPLAY_YEAR', 'DISPLAY_RUN'), 'transfer')

  let interventionId: unknown = null
  const expectedPersons = new Set<string>()
  if (root.kind === 'OBSERVATION') {
    requireField(root.branch === 'A0' && root.intervention === null && root.transfer === 'FULL', 'observation')
  } else {
    requireField(root.kind === 'COMPARISON' && oneOf(root.branch, 'A0', 'A1'), 'comparison')
    const input = record(root.intervention, 'year firstPersonId secondPersonId signedDelta durationYears modifierId ruleVersion', 'intervention')
    requireField(integer(input.year, START_YEAR, Math.min(root.year, GOAL_YEAR - 1)) && integer(input.signedDelta, -200, 200)
      && input.signedDelta !== 0 && integer(input.durationYears, 1, GOAL_YEAR - input.year), 'intervention.numeric')
    requireField(personId(input.firstPersonId) && personId(input.secondPersonId) && input.firstPersonId !== input.secondPersonId
      && text(input.modifierId) && text(input.ruleVersion, 256), 'intervention.ids')
    expectedPersons.add(input.firstPersonId).add(input.secondPersonId)
    interventionId = input.modifierId
  }
  const branchShown = (branch: unknown) => branch === 'A0' || (branch === 'A1' && root.kind === 'COMPARISON')
  const selection = record(root.selection, 'personId event', 'selection')
  requireField(selection.personId === null || personId(selection.personId), 'selection.personId')
  if (selection.personId !== null) expectedPersons.add(selection.personId)
  const event = selection.event === null ? null : record(selection.event, 'branch id', 'selection.event')
  if (event) requireField(branchShown(event.branch) && text(event.id), 'selection.event')

  const player = record(root.player, 'channel status officialGoal branches', 'player')
  requireField(player.channel === 'PLAYER' && player.status === 'COMPLETED' && player.officialGoal === 'NOT_ESTABLISHED', 'player')
  const branches = array(player.branches, 2, 'player.branches')
  requireField(branches.length === (root.kind === 'OBSERVATION' ? 1 : 2), 'player.branches')
  for (const [index, entry] of branches.entries()) {
    const branch = record(entry, 'branch scenarioId modifierIds yearStart coverage events', 'branch')
    requireField(branch.branch === (index === 0 ? 'A0' : 'A1') &&
      (root.kind === 'OBSERVATION' ? branch.scenarioId === null : text(branch.scenarioId, 256)), 'branch.origin')
    const modifiers = ids(branch.modifierIds, 1, 'modifierIds')
    requireField(index === 0 ? modifiers.length === 0 : modifiers.length === 1 && modifiers[0] === interventionId, 'modifierIds')
    const start = record(branch.yearStart, 'population alivePersons persons', 'yearStart')
    requireField(integer(start.population, 0) && integer(start.alivePersons, 0), 'yearStart')
    const persons = array(start.persons, 3, 'yearStart.persons')
    const names = [...expectedPersons].sort()
    requireField(persons.length === names.length, 'yearStart.persons')
    for (const [personIndex, item] of persons.entries()) {
      const p = record(item, 'id presence', 'person')
      requireField(p.id === names[personIndex] && oneOf(p.presence, 'ALIVE', 'DEAD', 'ABSENT'), 'person')
    }
    let eventCount = 0
    if (root.year === GOAL_YEAR) {
      const coverage = record(branch.coverage, 'kind', 'coverage')
      requireField(coverage.kind === 'EVALUATION_ONLY', 'coverage')
    } else {
      const coverage = record(branch.coverage, 'kind eventCount traceCount omission', 'coverage')
      requireField(integer(coverage.eventCount, 0) && integer(coverage.traceCount, 0), 'coverage')
      eventCount = coverage.eventCount
      if (coverage.kind === 'COMPLETE') requireField(coverage.omission === null, 'coverage.omission')
      else {
        const omission = record(coverage.omission, 'scope events traces', 'coverage.omission')
        requireField(coverage.kind === 'TRANSFER_OMISSION' && root.transfer !== 'FULL' &&
          omission.scope === (root.transfer === 'DISPLAY_YEAR' ? 'YEAR' : 'RUN') &&
          integer(omission.events, 0) && integer(omission.traces, 0) && omission.events + omission.traces > 0, 'coverage.omission')
      }
    }
    const events = record(branch.events, 'count refs sha256', 'events')
    requireField(integer(events.count, 0, eventCount) && sha256(events.sha256), 'events')
    const refs = array(events.refs, REFERENCE_LIMIT + 1, 'events.refs')
    const eventIds = new Set<unknown>()
    for (const item of refs) {
      const ref = record(item, 'id type traceIds', 'eventRef')
      requireField(text(ref.id) && !eventIds.has(ref.id) && text(ref.type, 512), 'eventRef')
      eventIds.add(ref.id)
      ids(ref.traceIds, 128, 'eventRef.traceIds')
    }
    const chosen = event !== null && event.branch === branch.branch
    requireField(refs.length >= Math.min(events.count, REFERENCE_LIMIT) && refs.length <= events.count &&
      (refs.length <= REFERENCE_LIMIT || chosen) && (!chosen || eventIds.has(event.id)), 'events.refs')
  }
  if (root.debug !== null) {
    const debug = record(root.debug, 'channel branch traceId ruleId ruleVersion status eventIds', 'debug')
    requireField(root.year < GOAL_YEAR && debug.channel === 'DEBUG' && branchShown(debug.branch) && text(debug.traceId)
      && text(debug.ruleId, 256) && text(debug.ruleVersion, 256) && oneOf(debug.status, 'ACCEPT', 'REJECT', 'DEFER', 'NOT_IMPLEMENTED'), 'debug')
    ids(debug.eventIds, 128, 'debug.eventIds')
  }
  return value as Evidence
}
