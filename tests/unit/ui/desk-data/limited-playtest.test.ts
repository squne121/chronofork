import { describe, expect, it } from 'vitest'
import { createMultiHouseDemandWorld, createMultiHouseWorld, multiHouseDemandRunConfigIdentity, multiHouseDemandRunConfigDigest } from '../../../../src/scenario/experimental/index.ts'
import type { WorldState } from '../../../../src/simulation/contracts/index.ts'
import { rngVersion } from '../../../../src/simulation/random.ts'
import { EXPERIMENTAL_TUNING } from '../../../../src/simulation/tuning.ts'
import { SingleA0Cache } from '../../../../src/ui/a0-cache.ts'
import { playConfigDigest, playConfigId, playModifier, runPlayComparison, runPlayObservation, sliceA0Observation } from '../../../../src/ui/branch-play-source.ts'
import type { PlayView } from '../../../../src/ui/branch-play-source.ts'
import { historyFromObservation, historyFromPlayView, matchesObservation, matchesPlayRequest, sameHistoryYearRef } from '../../../../src/ui/desk/data/history.ts'
import { limitedPlayConfig } from '../../../../src/ui/desk/data/limited-config.ts'
import { limitedComparisonInput, limitedObservationInput } from '../../../../src/ui/desk/data/limited-playtest.ts'
import { createWorkerPlayRunner } from '../../../../src/ui/play-runner.ts'
import type { WorkerLike } from '../../../../src/ui/play-runner.ts'
import type { WorkerResponse } from '../../../../src/ui/play-worker.ts'
import { candidateSetMatches, extractCandidatesFromA0 } from '../../../../src/ui/play-candidates.ts'
import type { TimelineRun } from '../../../../src/ui/timeline-source.ts'

const request = limitedObservationInput(1250)
const input = limitedComparisonInput(1250, {
  firstPersonId: 'person-exp-01', secondPersonId: 'person-exp-02', signedDelta: -2, durationYears: 2,
})
const modifier = playModifier(input, [input.firstPersonId, input.secondPersonId])
const initialWorld = createMultiHouseDemandWorld(0)

// 照合を単体で検査する DTO。実歴史の検証は専用ブラウザ受入スクリプトで行う。
const a0: TimelineRun = {
  initialWorld, playLedger: [], playModifierIds: [],
  inputs: { ...limitedPlayConfig(), seed: input.seed, scenarioId: 'fixture', rulesetVersion: EXPERIMENTAL_TUNING.rulesetVersion, rngVersion, evaluatedRuleIds: [] },
  result: {
    seed: input.seed, branchId: 'A0-play', rngVersion, status: 'COMPLETED', startYear: 1250,
    transitions: 100, snapshots: Array.from({ length: 101 }, (_, i) => ({ ...initialWorld, year: 1250 + i, pairTrustThroughYear: 1249 + i })),
    eventLog: [], decisionTraces: [], halt: null, goal: null, technicalGoal: null,
    coverage: { implementedRuleIds: [], todoRuleIds: [], executedRuleIds: [], injectedTodoRuleIds: [] },
    autonomousHistory: { status: 'NOT_ESTABLISHED', blockers: [] },
  },
}
const a1: TimelineRun = {
  ...a0, playLedger: [modifier], playModifierIds: [modifier.modifierId], result: { ...a0.result, branchId: 'A1-play' },
}
const view: PlayView = { input, mode: input.mode, modifier, a0, a1 }

describe('限定試遊の履歴接合', () => {
  it('SIM の完全構成と digest を使用し、v0 と別の明示的な選択肢にする', () => {
    expect(limitedPlayConfig()).toEqual({
      configId: 'experimental-multi-house-v2-demand-relations-drift-0',
      configDigest: multiHouseDemandRunConfigDigest(0), configIdentity: JSON.stringify(multiHouseDemandRunConfigIdentity(0)),
    })
    expect(playConfigDigest(request.mode)).toBe('5090c8485f4b8570')
    expect(runPlayObservation({ ...request, seed: request.seed + 1 }, new SingleA0Cache())).toMatchObject({ code: 'INVALID_CONFIGURATION' })
    expect(runPlayObservation({ ...request, mode: 'INTEGRATED_EXPERIMENTAL' }, new SingleA0Cache())).toMatchObject({ code: 'INVALID_CONFIGURATION' })
    expect(runPlayComparison({ ...input, seed: input.seed + 1 })).toMatchObject({ code: 'INVALID_CONFIGURATION' })
  })

  it('観測の枝・年・構成・空の実台帳・候補を照合し、未取得年と SIM の UNKNOWN を区別する', () => {
    const slice = sliceA0Observation(a0, request.year, request.mode, 'COMPUTED', request.configuration)!
    expect(matchesObservation(request, slice)).toBe(true)
    expect(matchesObservation({ ...request, year: 1251 }, slice)).toBe(false)
    expect(matchesObservation(request, { ...slice, branchId: 'A1-play' })).toBe(false)
    expect(matchesObservation(request, { ...slice, configIdentity: 'other' })).toBe(false)
    expect(matchesObservation(request, { ...slice, playLedger: [modifier] })).toBe(false)
    expect(matchesObservation(request, { ...slice, world: { ...slice.world, pairTrustThroughYear: 1250 } })).toBe(false)
    expect(matchesObservation(request, { ...slice, candidates: { ...slice.candidates, seed: request.seed + 1 } })).toBe(false)
    expect(candidateSetMatches(slice.candidates, request.seed, request.mode)).toBe(false)
    expect(() => historyFromObservation({ ...slice, configuration: undefined, configIdentity: undefined })).toThrow()
    expect(matchesObservation(request, { ...slice, counts: [{ year: request.year, events: 0, traces: 1 }] })).toBe(false)
    const old = { ...slice, configuration: undefined, configIdentity: undefined, configId: playConfigId(request.mode), configDigest: playConfigDigest(request.mode) }
    expect(matchesObservation({ ...request, configuration: undefined }, old)).toBe(false)
    expect(() => historyFromObservation(old)).toThrow()
    expect(matchesObservation(request, { ...slice, personRecords: undefined! })).toBe(false)
    expect(matchesObservation(request, { ...slice, titleHistories: Array(1) })).toBe(false)
    const sparse = a0.result.snapshots.slice()
    delete sparse[10]
    expect(sliceA0Observation({ ...a0, result: { ...a0.result, snapshots: sparse } }, request.year, request.mode, 'COMPUTED', request.configuration)).toBeUndefined()
    const mixed = { ...a0, result: { ...a0.result, snapshots: [...a0.result.snapshots.slice(0, -1), { ...createMultiHouseWorld(), year: 1350 }] } }
    expect(sliceA0Observation(mixed, request.year, request.mode, 'COMPUTED', request.configuration)).toBeUndefined()
    expect(extractCandidatesFromA0(mixed, request.mode, request.configuration)).toBeUndefined()
    expect(extractCandidatesFromA0(a0, request.mode)).toBeUndefined()
    const h = historyFromObservation(slice)
    expect(h.at(1250).relationship(input.firstPersonId, input.secondPersonId)).toMatchObject({ kind: 'YEAR_START_BASE', observation: { status: 'UNKNOWN' } })
    expect(h.at(1251).relationship(input.firstPersonId, input.secondPersonId)).toEqual({ kind: 'NOT_LOADED' })
  })

  it('比較では同じ ID の別台帳、同じ digest の別 identity、別枝・seed・参照年を拒む', () => {
    expect(matchesPlayRequest(input, view)).toBe(true)
    const h = historyFromPlayView(view)!
    expect(h.at('A1', 1350)?.records.kind).toBe('EVALUATION_ONLY')
    const ref = h.at('A1', 1350)!.ref
    expect(sameHistoryYearRef(ref, structuredClone(ref))).toBe(true)
    expect(sameHistoryYearRef(ref, { ...ref, origin: { ...ref.origin, configuration: { ...ref.origin.configuration, configIdentity: 'other' } } })).toBe(false)
    const omission = { fullEventCount: { a0: 0, a1: 0 }, fullTraceCount: { a0: 1, a1: 1 }, omittedEventsByType: {}, omittedTracesByRule: { 'B-009': 1 } }
    expect(historyFromPlayView({ ...view, displayOmission: { ...omission, byYear: {} } })).toBeUndefined()
    expect(historyFromPlayView({ ...view, displayOmission: omission })?.at('A1', 1250)?.trace('missing', 'B-009').kind).toBe('POSSIBLY_OMITTED')
    const asV0 = (run: TimelineRun): TimelineRun => ({ ...run, inputs: { ...run.inputs, configIdentity: undefined,
      configId: playConfigId(request.mode), configDigest: playConfigDigest(request.mode) } })
    expect(historyFromPlayView({ ...view, input: { ...input, configuration: undefined }, a0: asV0(a0), a1: asV0(a1) })).toBeUndefined()
    expect(h.at('A2', 1250)).toBeUndefined()
    expect(matchesPlayRequest({ ...input, configuration: undefined }, view)).toBe(false)
    expect(historyFromPlayView({ ...view, a1: { ...a1, playLedger: [{ ...modifier, signedDelta: 3 }] } })).toBeUndefined()
    expect(historyFromPlayView({ ...view, modifier: { ...modifier, signedDelta: 3 } })).toBeUndefined()
    expect(historyFromPlayView({ ...view, a1: { ...a1, inputs: { ...a1.inputs, configIdentity: JSON.stringify(multiHouseDemandRunConfigIdentity(1)) } } })).toBeUndefined()
    expect(historyFromPlayView({ ...view, a1: { ...a1, result: { ...a1.result, seed: input.seed + 1 } } })).toBeUndefined()
    expect(historyFromPlayView({ ...view, a1: { ...a1, result: { ...a1.result, branchId: 'A0-play' } } })).toBeUndefined()
    expect(historyFromPlayView({ ...view, a1: { ...a1, result: { ...a1.result, snapshots: [initialWorld, ...a1.result.snapshots.slice(0, -1)] } } })).toBeUndefined()
  })

  it('分岐年初DTOはオブジェクトのキー順だけを無視し、実値と配列順の変更は拒む', () => {
    const atFork = a1.result.snapshots[0]!
    const withFork = (snapshot: typeof atFork) => ({ ...view, a1: {
      ...a1, result: { ...a1.result, snapshots: [snapshot, ...a1.result.snapshots.slice(1)] },
    } })
    const first = atFork.persons[0]!
    const others = atFork.persons.slice(1)
    const reordered = Object.fromEntries(Object.entries(first).reverse()) as typeof first
    expect(matchesPlayRequest(input, withFork({ ...atFork, persons: [reordered, ...others] }))).toBe(true)
    expect(matchesPlayRequest(input, withFork({ ...atFork, persons: [{ ...first, alive: !first.alive }, ...others] }))).toBe(false)
    expect(matchesPlayRequest(input, withFork({ ...atFork, persons: [...atFork.persons].reverse() }))).toBe(false)
  })

  it('後年の分岐年初でも入れ子のキー順だけを無視し、欠落・追加キー、型、非plain objectを拒む', () => {
    const later = limitedComparisonInput(1251, {
      firstPersonId: 'person-exp-02', secondPersonId: 'person-exp-05', signedDelta: 20, durationYears: 1,
    })
    const laterModifier = playModifier(later, [later.firstPersonId, later.secondPersonId])
    const laterA1: TimelineRun = { ...a1, playLedger: [laterModifier], playModifierIds: [laterModifier.modifierId] }
    const at = (snapshot: WorldState): PlayView => ({ input: later, mode: later.mode, modifier: laterModifier, a0, a1: {
      ...laterA1, result: { ...laterA1.result, snapshots: laterA1.result.snapshots.map((s, i) => i === 1 ? snapshot : s) },
    } })
    const fork = a1.result.snapshots[1]!
    const reverseKeys = <T extends object>(value: T) => Object.fromEntries(Object.entries(value).reverse()) as T
    expect(matchesPlayRequest(later, at(fork))).toBe(true)
    // 分岐年初とその内部要素を別の挿入順で再構築しても、値が同じなら同じ年初として扱う。
    const rebuilt = reverseKeys({ ...fork, persons: fork.persons.map(reverseKeys), houses: fork.houses.map(reverseKeys) })
    expect(JSON.stringify(rebuilt)).not.toBe(JSON.stringify(fork))
    expect(matchesPlayRequest(later, at(rebuilt))).toBe(true)
    const [first, ...others] = fork.persons
    const missing = { ...first! }
    expect(Reflect.deleteProperty(missing, 'alive')).toBe(true)
    for (const changed of [
      { ...fork, persons: [missing as typeof first, ...others] },
      { ...fork, persons: [{ ...first!, extra: undefined } as typeof first, ...others] },
      { ...fork, persons: [{ ...first!, alive: String(first!.alive) } as unknown as typeof first, ...others] },
      { ...fork, year: fork.year + 1 },
      { ...fork, persons: [...fork.persons].reverse() },
      { ...fork, persons: Object.assign(Object.create({ inherited: true }) as object, first) as typeof first },
      { ...fork, persons: [Object.assign(Object.create(null) as object, first) as typeof first, ...others] },
    ] as WorldState[]) expect(matchesPlayRequest(later, at(changed))).toBe(false)
    // 年初の一致以外の来歴は従来どおり照合する。
    expect(matchesPlayRequest(later, { ...at(rebuilt), a1: { ...at(rebuilt).a1, playLedger: [{ ...laterModifier, signedDelta: 3 }] } })).toBe(false)
    expect(matchesPlayRequest(later, { ...at(rebuilt), a1: { ...at(rebuilt).a1, result: { ...at(rebuilt).a1.result, seed: later.seed + 1 } } })).toBe(false)
    expect(matchesPlayRequest(later, { ...at(rebuilt), a1: { ...at(rebuilt).a1, inputs: { ...a1.inputs, configIdentity: 'other' } } })).toBe(false)
    expect(matchesPlayRequest(later, { ...at(rebuilt), a1: { ...at(rebuilt).a1, result: { ...at(rebuilt).a1.result, branchId: 'A0-play' } } })).toBe(false)
    expect(matchesPlayRequest(input, at(rebuilt))).toBe(false)
  })

  it('不正な限定 Worker 応答と送信例外を失敗として返し、次の要求で新規 Worker を使う', async () => {
    const workers: WorkerLike[] = []
    let terminated = 0
    const runner = createWorkerPlayRunner({ createWorker() {
      const index = workers.length
      const worker: WorkerLike = { onmessage: null, onerror: null, onmessageerror: null,
        postMessage() { if (index === 0) throw new Error('送信不能') }, terminate() { terminated++ } }
      workers.push(worker)
      return worker
    } })
    expect(await runner.observe(request).promise).toMatchObject({ kind: 'FAILED', code: 'WORKER_POST_FAILED' })
    const pending = runner.observe(request)
    const malformed = { ok: true, observation: { ...request }, computeMs: 0 }
    workers[1]!.onmessage?.({ data: malformed } as MessageEvent<WorkerResponse>)
    expect(await pending.promise).toMatchObject({ kind: 'FAILED', code: 'HISTORY_MISMATCH' })
    const comparison = runner(input)
    workers[2]!.onmessage?.({ data: { ok: true, view: undefined, computeMs: 0 } } as unknown as MessageEvent<WorkerResponse>)
    expect(await comparison.promise).toMatchObject({ kind: 'FAILED', code: 'HISTORY_MISMATCH' })
    expect(terminated).toBe(3)
  })

})
