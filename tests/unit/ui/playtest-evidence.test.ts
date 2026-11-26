import { describe, expect, it } from 'vitest'
import { verifyBuild } from '../../../scripts/replay-playtest.ts'
import { createMultiHouseDemandWorld } from '../../../src/scenario/experimental/index.ts'
import type { DecisionTrace, EventLogEntry } from '../../../src/simulation/contracts/index.ts'
import { rngVersion } from '../../../src/simulation/random.ts'
import { EXPERIMENTAL_TUNING } from '../../../src/simulation/tuning.ts'
import { playModifier, sliceA0Observation } from '../../../src/ui/branch-play-source.ts'
import type { PlayView } from '../../../src/ui/branch-play-source.ts'
import { historyFromObservation, historyFromPlayView } from '../../../src/ui/desk/data/history.ts'
import { limitedPlayConfig } from '../../../src/ui/desk/data/limited-config.ts'
import { evidenceBuild, EVIDENCE_MAX_BYTES, exportPlaytestEvidence, limitedReplayInput, parseEvidence,
  serializePlaytestEvidence } from '../../../src/ui/playtest-evidence.ts'
import type { TimelineRun } from '../../../src/ui/timeline-source.ts'

const year = 1250, requestId = 1
const [firstPersonId, secondPersonId] = ['person-exp-01', 'person-exp-02'] as const
const build = evidenceBuild('local')
const observationInput = { ...limitedReplayInput, year }
const input = { ...observationInput, firstPersonId, secondPersonId, signedDelta: -2, durationYears: 2 }
const modifier = playModifier(input, [firstPersonId, secondPersonId])
const trace: DecisionTrace = { traceId: 'trace-fixture', ruleId: 'B-003', year, phase: 3,
  actorRef: { kind: 'PERSON', id: firstPersonId }, candidates: [], status: 'ACCEPT', reasonCodes: ['内部情報'],
  eventIds: ['event-fixture'], modifierIds: [], ruleVersion: 'fixture', random: { stream: 'EXOGENOUS', value: .5, key: '非公開乱数' } }
const event: EventLogEntry = { eventId: trace.eventIds[0]!, eventType: 'PERSON_DEATH', year, phase: 3,
  semanticEventKey: 'fixture', involvedRefs: [trace.actorRef], sourceTraceIds: [trace.traceId], stateChanges: [] }
// 構造/公開境界の軽量 fixture。実計算の証跡には使用しない。
const initialWorld = createMultiHouseDemandWorld(0)
const a0: TimelineRun = {
  initialWorld, playLedger: [], playModifierIds: [],
  inputs: { ...limitedPlayConfig(), seed: input.seed, scenarioId: 'fixture', rngVersion,
    rulesetVersion: EXPERIMENTAL_TUNING.rulesetVersion, evaluatedRuleIds: [] },
  result: {
    seed: input.seed, branchId: 'A0-play', rngVersion, status: 'COMPLETED', startYear: year, transitions: 100,
    snapshots: Array.from({ length: 101 }, (_, i) => ({ ...initialWorld, year: year + i, pairTrustThroughYear: year + i - 1 })),
    eventLog: [event], decisionTraces: [trace], halt: null, goal: null, technicalGoal: null,
    coverage: { implementedRuleIds: [], todoRuleIds: [], executedRuleIds: [], injectedTodoRuleIds: [] },
    autonomousHistory: { status: 'NOT_ESTABLISHED', blockers: [] },
  },
}
const a1: TimelineRun = { ...a0, playLedger: [modifier], playModifierIds: [modifier.modifierId],
  result: { ...a0.result, branchId: 'A1-play' } }
const view: PlayView = { input, mode: input.mode, modifier, a0, a1 }
const comparison = { kind: 'COMPARISON', input, requestId, build, selected: historyFromPlayView(view)!.at('A1', year)!.ref,
  outcome: { kind: 'DONE', requestId, result: view } } as const
const observation = sliceA0Observation(a0, year, input.mode, 'COMPUTED', input.configuration)!
const observed = { kind: 'OBSERVATION', input: observationInput, requestId, build, selected: historyFromObservation(observation).at(year).ref,
  outcome: { kind: 'DONE', requestId, result: observation } } as const

const done = <T>(result: T) => ({ kind: 'DONE', requestId, result } as const)

describe('試遊証跡の作成', () => {
  it('確定年の公開 Event と Trace 参照だけを保存し、明示 DEBUG を分離する', async () => {
    const selection = { personId: firstPersonId, event: { branch: 'A0', id: event.eventId } } as const
    const player = await exportPlaytestEvidence({ ...observed, selection })
    expect(player).toMatchObject({ intervention: null, versions: { scenario: null, legal: null }, debug: null,
      player: { officialGoal: 'NOT_ESTABLISHED', branches: [{ coverage: { kind: 'COMPLETE', eventCount: 1, traceCount: 1 },
        events: { count: 1, refs: [{ id: event.eventId, traceIds: [trace.traceId] }] } }] } })
    const debug = await exportPlaytestEvidence({ ...observed, selection, debug: { branch: 'A0', traceId: trace.traceId } })
    expect(debug.player).toEqual(player.player)
    expect(debug.debug).toMatchObject({ channel: 'DEBUG', traceId: trace.traceId, ruleId: trace.ruleId })
    const json = serializePlaytestEvidence(debug)
    expect(parseEvidence(json)).toEqual(debug)
    for (const secret of ['configIdentity', 'snapshots', 'candidates', '内部情報', '非公開乱数', 'technicalGoal']) expect(json).not.toContain(secret)
    await expect(exportPlaytestEvidence({ ...observed, selection: { event: { branch: 'A0', id: 'not-loaded' } } }))
      .rejects.toMatchObject({ code: 'EVENT_UNAVAILABLE' })
  })

  it('観測年と介入年を区別し、年別・全期間の転送省略と評価専用年を区別する', async () => {
    const counts = { omittedEventsByType: {}, omittedTracesByRule: { 'B-009': 1 } }
    const omission = { ...counts, fullEventCount: { a0: 1, a1: 1 }, fullTraceCount: { a0: 2, a1: 2 } }
    const omitted = { ...view, displayOmission: { ...omission, byYear: { [year]: counts } } }
    const yearly = await exportPlaytestEvidence({ ...comparison, outcome: done(omitted) })
    expect(yearly).toMatchObject({ transfer: 'DISPLAY_YEAR', intervention: { modifierId: modifier.modifierId },
      player: { branches: ['A0', 'A1'].map(branch => ({ branch, coverage: { kind: 'TRANSFER_OMISSION', omission: { scope: 'YEAR', traces: 1 } } })) } })
    const older = await exportPlaytestEvidence({ ...comparison, outcome: done({ ...view, displayOmission: omission }) })
    expect(older.player.branches[1]?.coverage).toMatchObject({ kind: 'TRANSFER_OMISSION', omission: { scope: 'RUN' } })
    await expect(exportPlaytestEvidence({ ...comparison, outcome: done(omitted), debug: { branch: 'A1', traceId: 'omitted' } }))
      .rejects.toThrow('POSSIBLY_OMITTED')
    const evaluation = await exportPlaytestEvidence({ ...comparison, selected: { ...comparison.selected, year: 1350 }, outcome: done(omitted) })
    expect(evaluation.year).toBe(1350)
    expect(evaluation.intervention?.year).toBe(year)
    expect(evaluation.player.branches[1]?.coverage).toEqual({ kind: 'EVALUATION_ONLY' })
  })

  it('未実行・未観測・失敗・中断・同じ入力での旧結果を成功にしない', async () => {
    for (const kind of ['PENDING', 'NOT_LOADED', 'FAILED', 'CANCELLED'] as const) {
      await expect(exportPlaytestEvidence({ ...observed, outcome: { kind } })).rejects.toMatchObject({ code: 'NO_RESULT' })
    }
    await expect(exportPlaytestEvidence({ ...observed, requestId: 2 })).rejects.toMatchObject({ code: 'STALE_RESULT' })
    await expect(exportPlaytestEvidence({ ...observed, input: { ...observationInput, year: year + 1 }, selected: { ...observed.selected, year: year + 1 } }))
      .rejects.toMatchObject({ code: 'OBSERVATION_MISMATCH' })
    await expect(exportPlaytestEvidence({ ...observed, outcome: done({ ...observation, status: 'HALTED' }) }))
      .rejects.toMatchObject({ code: 'OBSERVATION_MISMATCH' })
    await expect(exportPlaytestEvidence({ ...comparison, outcome: done({ ...view, a1: { ...a1, pending: true as const } }) }))
      .rejects.toMatchObject({ code: 'COMPARISON_MISMATCH' })
  })

  it('異なる構成・seed・枝・実台帳を拒否する', async () => {
    await expect(exportPlaytestEvidence({ ...comparison, input: { ...input, seed: input.seed + 1 } })).rejects.toMatchObject({ code: 'UNSUPPORTED_CONFIGURATION' })
    await expect(exportPlaytestEvidence({ ...observed, outcome: done({ ...observation, configIdentity: 'other' }) })).rejects.toMatchObject({ code: 'OBSERVATION_MISMATCH' })
    await expect(exportPlaytestEvidence({ ...comparison, selected: { ...comparison.selected, origin: { ...comparison.selected.origin, branch: 'A2' } } }))
      .rejects.toMatchObject({ code: 'UNSUPPORTED_BRANCH' })
    await expect(exportPlaytestEvidence({ ...comparison, input: { ...input, signedDelta: 3 } })).rejects.toMatchObject({ code: 'COMPARISON_MISMATCH' })
    await expect(exportPlaytestEvidence({ ...comparison, outcome: done({ ...view, a1: { ...a1, playLedger: [{ ...modifier, signedDelta: 3 }] } }) }))
      .rejects.toMatchObject({ code: 'COMPARISON_MISMATCH' })
  })
})

describe('保存 JSON の検証', () => {
  it('壊れた JSON・過大入力・schema・項目欠落・範囲・未対応構成を拒否する', async () => {
    const proof = await exportPlaytestEvidence(comparison)
    expect(() => parseEvidence('{')).toThrow('JSON')
    expect(() => parseEvidence('あ'.repeat(EVIDENCE_MAX_BYTES / 2))).toThrow('64 KiB')
    expect(() => parseEvidence(JSON.stringify({ ...proof, schemaVersion: 2 }))).toThrow('schemaVersion')
    for (const bad of [{ ...proof, build: undefined }, { ...proof, year: 1250.1 }, { ...proof, intervention: { ...proof.intervention, durationYears: 101 } },
      { ...proof, config: { ...proof.config, mode: 'ORDINARY_LAW' } }, { ...proof, intervention: { ...proof.intervention, firstPersonId: '' } },
      { ...proof, player: { ...proof.player, officialGoal: 'WON' } }, { ...proof, snapshots: [] }]) {
      expect(() => parseEvidence(JSON.stringify(bad))).toThrow()
    }
  })

  it('build 不一致・ローカルにない build・local/dirty/不明を区別する', () => {
    const commit = evidenceBuild('a'.repeat(40)), other = evidenceBuild('b'.repeat(40))
    expect(() => verifyBuild(commit, commit, () => { throw new Error('照会不要') })).not.toThrow()
    expect(() => verifyBuild(commit, other, () => true)).toThrow('が異なります')
    expect(() => verifyBuild(commit, other, () => false)).toThrow('ローカルにありません')
    expect(evidenceBuild('0'.repeat(40))).toEqual({ kind: 'LOCAL', reason: 'UNKNOWN' })
    for (const local of [evidenceBuild('local'), evidenceBuild(undefined), evidenceBuild('a'.repeat(40), true)])
      expect(() => verifyBuild(local, commit, () => true)).toThrow('照合可能な build SHA がありません')
    expect(() => verifyBuild(commit, evidenceBuild('a'.repeat(40), true), () => true)).toThrow('DIRTY')
  })
})
