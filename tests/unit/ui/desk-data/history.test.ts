import { beforeAll, describe, expect, it } from 'vitest'
import { runTimeline } from '../../../../src/simulation/engine/index.ts'
import { compareYear, DEFAULT_OBSERVATION_MODE, DEFAULT_OBSERVATION_SEED, PLAY_DEMO_PAIR, runPlayObservation, runPlayComparison, sliceA0Observation } from '../../../../src/ui/branch-play-source.ts'
import type { ObservationSlice, PlayComparison, PlayInput } from '../../../../src/ui/branch-play-source.ts'
import { historyFromObservation, historyFromPlayView, matchesObservation, matchesPlayRequest } from '../../../../src/ui/desk/data/history.ts'
import { createLatestHistoryRequest } from '../../../../src/ui/desk/data/latest-request.ts'
import { SingleA0Cache } from '../../../../src/ui/a0-cache.ts'
import { toDisplayView } from '../../../../src/ui/play-view.ts'

const input: PlayInput = {
  seed: 20260101, year: 1260, firstPersonId: PLAY_DEMO_PAIR[0], secondPersonId: PLAY_DEMO_PAIR[1],
  signedDelta: 20, durationYears: 5,
  second: { firstPersonId: 'person-exp-02', secondPersonId: PLAY_DEMO_PAIR[0], signedDelta: -20, durationYears: 5 },
}

let comparison: PlayComparison
const cache = new SingleA0Cache()
beforeAll(() => {
  // 正式Goalではない、既存の実エンジン・既存のCALIBRATION_ONLY構成。
  const r = runPlayComparison(input, undefined, { cache })
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`)
  comparison = r.comparison
}, 60_000)

describe('実履歴の参照境界', () => {
  it('同じrunのA0/A1を束ね、分岐年初と年内の差分をオブジェクトの複製なしに読む', () => {
    const h = historyFromPlayView(comparison)!
    const c = h.compare('A0_A1', 1260)!
    expect(c.before.ref).toMatchObject({ year: 1260, origin: { seed: input.seed, branch: 'A0', modifierIds: [] } })
    expect(c.after.ref.origin).toMatchObject({ branch: 'A1', modifierIds: [comparison.modifier.modifierId] })
    expect(c.before.start).toEqual(c.after.start)
    expect(c.after.start.kind === 'CONFIRMED' && c.after.start.world).toBe(comparison.a1.result.snapshots[10])
    expect(c.changes).toEqual(compareYear(comparison, 1260))
    const wedding = comparison.a1.result.eventLog.find(e => e.year === 1260 && e.eventType === 'MARRIAGE_REGISTER')!
    const trace = comparison.a1.result.decisionTraces.find(t => t.traceId === wedding.sourceTraceIds[0])!
    expect(c.after.event(wedding.eventId)).toEqual({ kind: 'RECORDED', record: wedding })
    expect(c.after.trace(trace.traceId)).toEqual({ kind: 'RECORDED', record: trace })
    expect(c.before.event(wedding.eventId)).toEqual({ kind: 'NO_RECORD' })
    expect(h.at('A1', 1261)!.event(wedding.eventId)).toEqual({ kind: 'NO_RECORD' })
    const reject = comparison.a0.result.decisionTraces.find(t => t.year === 1260 && t.status === 'REJECT' && t.eventIds.length === 0)!
    expect(c.before.trace(reject.traceId)).toEqual({ kind: 'RECORDED', record: reject })
    expect(h.at('A1', 1350)!.records).toEqual({ kind: 'EVALUATION_ONLY' })
    expect(h.at('A1', 1351)!.start.kind).toBe('OUT_OF_RANGE')
  })

  it('片枝で生まれた実人物の出生前・生存・死亡と他枝での不在を分ける', () => {
    const h = historyFromPlayView(comparison)!
    const child = comparison.a1.result.snapshots.at(-1)!.persons.find(p => p.birthYear >= 1260 && p.deathYear !== undefined)!
    const id = child.personId
    expect(h.at('A1', child.birthYear)!.person(id).kind).toBe('NOT_BORN')
    expect(h.at('A1', child.birthYear + 1)!.person(id).kind).toBe('ALIVE')
    expect(h.at('A1', child.deathYear!)!.person(id).kind).toBe('ALIVE')
    expect(h.at('A1', child.deathYear! + 1)!.person(id).kind).toBe('DEAD')
    expect(h.at('A0', child.birthYear + 1)!.person(id).kind).toBe('ABSENT_FROM_BRANCH')
    const history = h.personHistory('A1', id)!
    expect(history.throughYear).toBe(1350)
    expect(history.observations[0]?.year).toBe(child.birthYear + 1)
    expect(history.observations.at(-1)?.person).toBe(child)
    expect(h.personHistory('A0', id)?.observations).toEqual([])
  })

  it('A1→A2のスロットをA0/A1に誤適用せず、違う構成・seed・親介入を拒む', () => {
    const c = toDisplayView(comparison)
    const second = c.second!
    expect(matchesPlayRequest(input, c)).toBe(true)
    expect(matchesPlayRequest({ ...input, year: 1261 }, c)).toBe(false)
    expect(matchesPlayRequest({ ...input, mode: 'ORDINARY_LAW' }, c)).toBe(false)
    expect(matchesPlayRequest({ ...input, signedDelta: 40 }, c)).toBe(false)
    expect(matchesPlayRequest({ ...input, second: undefined }, c)).toBe(false)
    expect(historyFromPlayView(second)).toBeUndefined()
    const h = historyFromPlayView(c)!
    const followup = h.compare('A1_A2', input.year)!
    expect(followup.before.ref.origin.branch).toBe('A1')
    expect(followup.after.ref.origin).toMatchObject({
      branch: 'A2', modifierIds: [c.modifier.modifierId, second.modifier.modifierId],
    })
    expect(historyFromPlayView({ ...c, second: { ...second, a0: { ...second.a0, playModifierIds: ['different-first-intervention'] } } })?.at('A2', 1261)).toBeUndefined()
    const other = runPlayComparison({ ...input, signedDelta: 40, second: undefined }, undefined, { cache })
    if (!other.ok) throw new Error(other.message)
    const mixed = { ...comparison, a1: other.comparison.a1 }
    expect(matchesPlayRequest(input, mixed)).toBe(false)
    expect(historyFromPlayView(mixed)).toBeUndefined()
    expect(historyFromPlayView({ ...comparison, input: { ...input, durationYears: 1 } })).toBeUndefined()
    expect(historyFromPlayView({ ...c, a1: { ...c.a1, inputs: { ...c.a1.inputs, seed: input.seed + 1 } } })).toBeUndefined()
    expect(historyFromPlayView({ ...c, a1: { ...c.a1, inputs: { ...c.a1.inputs, configDigest: 'other-config' } } })).toBeUndefined()
    expect(historyFromPlayView({ ...c, a1: c.a0 })).toBeUndefined()
  }, 60_000)

  it('実転送ビューの省略を年と種別で区別し、旧DTOでは安全側に倒す', () => {
    const c = toDisplayView(comparison)
    const reduced = historyFromPlayView(c)!
    const full = historyFromPlayView(comparison)!
    const omitted = c.displayOmission!
    expect(Object.keys(omitted.byYear!).length).toBeGreaterThan(0)
    const keptEventIds = new Set(c.a1.result.eventLog.map(e => e.eventId))
    const keptTraceIds = new Set(c.a1.result.decisionTraces.map(t => t.traceId))
    const event = comparison.a1.result.eventLog.find(e => !keptEventIds.has(e.eventId))!
    const trace = comparison.a1.result.decisionTraces.find(t => !keptTraceIds.has(t.traceId))!
    expect(reduced.at('A1', event.year)!.event(event.eventId, event.eventType).kind).toBe('POSSIBLY_OMITTED')
    expect(full.at('A1', event.year)!.event(event.eventId, event.eventType).kind).toBe('RECORDED')
    expect(reduced.at('A0', trace.year)!.trace(trace.traceId, trace.ruleId).kind).toBe('POSSIBLY_OMITTED')
    expect(reduced.at('A0', trace.year)!.trace('no-such-trace', 'B-005').kind).toBe('NO_RECORD')
    const notOmittedYear = comparison.a0.result.snapshots.find(w => w.year < 1350 && !omitted.byYear![w.year])!.year
    expect(reduced.at('A0', notOmittedYear)!.trace('no-such-trace', 'B-009').kind).toBe('NO_RECORD')
    const legacy = historyFromPlayView({ ...c, displayOmission: { ...omitted, byYear: undefined } })!
    expect(legacy.at('A0', notOmittedYear)!.trace('no-such-trace', 'B-009').kind).toBe('POSSIBLY_OMITTED')
  })

  it('停止年の確定年初と未確定の年内を区別し、未計算を不存在にしない', () => {
    // 停止を短時間で検証するための評価器fixture。エンジンの実停止結果を読む。
    const stopped = runTimeline(comparison.a0.initialWorld, {
      seed: input.seed, branchId: comparison.a0.result.branchId,
      evaluators: { 'B-004': () => { throw new Error('停止fixture') } },
    })
    expect(stopped).toMatchObject({ status: 'HALTED', halt: { year: 1250 } })
    const h = historyFromPlayView({ ...comparison, a0: { ...comparison.a0, result: stopped } })!
    const y = h.at('A0', 1250)!
    expect(y.start.kind).toBe('CONFIRMED')
    expect(y.records).toEqual({ kind: 'HALTED', haltedAt: 1250 })
    expect(y.person('unknown-in-unfinished-branch').kind).toBe('UNKNOWN')
    expect(h.at('A0', 1251)!.person('uncomputed-person').kind).toBe('HALTED')
    expect(h.compare('A0_A1', 1250)!.changes).toBeUndefined()
    const pending = historyFromPlayView({ ...comparison, a0: { ...comparison.a0, pending: true } })!
    expect(pending.at('A0', 1250)!.start.kind).toBe('UNCOMPUTED')
  })

  it('既存のA0選択年と人物・Titleの全期間資料を分ける', () => {
    const mode = 'INTEGRATED_EXPERIMENTAL'
    const a1 = comparison.a1
    expect(sliceA0Observation({ ...a1, inputs: { ...a1.inputs, configId: mode } }, 1250, mode, 'REUSED')).toBeUndefined()
    expect(sliceA0Observation(comparison.a0, 1250, mode, 'REUSED')).toBeUndefined()
    const v0 = { seed: DEFAULT_OBSERVATION_SEED, mode: DEFAULT_OBSERVATION_MODE, year: 1250 }
    const v0Cache = new SingleA0Cache()
    const observation = runPlayObservation(v0, v0Cache)
    if (!observation.ok) throw new Error(observation.message)
    const fork = runPlayComparison({ ...v0, year: 1251, firstPersonId: 'person-exp-03', secondPersonId: 'person-exp-04',
      signedDelta: 20, durationYears: 1 }, undefined, { cache: v0Cache })
    if (!fork.ok) throw new Error(fork.message)
    expect(fork.comparison.a0Source).toBe('REUSED')
    const slim = toDisplayView(fork.comparison)
    expect(slim.a0.logsOmitted).toBe(true)
    expect(sliceA0Observation(slim.a0, 1250, v0.mode, 'REUSED')).toBeUndefined()
    expect(historyFromPlayView({ ...slim, displayOmission: undefined })).toBeUndefined()
    const slice = observation.observation
    const h = historyFromObservation(slice)
    expect(h.at(1250).ref.origin.branch).toBe('A0')
    expect(h.at(1250).start).toEqual({ kind: 'CONFIRMED', world: slice.world })
    expect(h.at(1251).start.kind).toBe('NOT_LOADED')
    const record = slice.personRecords.find(p => p.deathYear !== undefined)!
    expect(h.personRecord(record.personId)).toBe(record)
    expect(h.at(1250).person(record.personId).kind).toBe('ALIVE')
    expect(h.titleHistories).toBe(slice.titleHistories)
  }, 60_000)
})

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(r => { resolve = r })
  return { promise, resolve }
}

it('応答が逆順になる・年を往復する・構成が変わる場合に古い応答を採用しない', async () => {
  const gate = createLatestHistoryRequest()
  const good = { seed: input.seed, mode: 'INTEGRATED_EXPERIMENTAL', year: 1250 } as const
  // 非同期順序だけを制御するDTO fixture。年初以外の値はここでは読まない。
  const dto = { ...good, configId: good.mode, world: comparison.a0.initialWorld } as ObservationSlice
  const shown: ObservationSlice[] = []
  const first = deferred<ObservationSlice>(), last = deferred<ObservationSlice>()
  const old = gate.begin()
  const stale = first.promise.then(v => old.commit(v, x => matchesObservation(good, x), x => shown.push(x)))
  gate.begin() // 1251年を要求
  const current = gate.begin() // 1250年へ戻る
  const publish = last.promise.then(v => current.commit(v, x => matchesObservation(good, x), x => shown.push(x)))
  last.resolve(dto)
  expect(await publish).toBe(true)
  first.resolve(dto)
  expect(await stale).toBe(false)
  for (const wrong of [{ ...dto, year: 1251 }, { ...dto, seed: good.seed + 1 }, { ...dto, configId: 'other' },
    { ...dto, configDigest: 'other' }, { ...dto, mode: 'MULTI_HOUSE_EXPERIMENTAL' as const }]) {
    expect(gate.begin().commit(wrong, v => matchesObservation(good, v), v => shown.push(v))).toBe(false)
  }
  const abandoned = gate.begin()
  gate.invalidate()
  expect(abandoned.commit(dto, v => matchesObservation(good, v), v => shown.push(v))).toBe(false)
  expect(shown).toEqual([dto])
})
