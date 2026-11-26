import { afterEach, expect, it, vi } from 'vitest'
import { createMultiHouseDemandWorld } from '../../../src/scenario/experimental/index.ts'
import { rngVersion } from '../../../src/simulation/random.ts'
import { EXPERIMENTAL_TUNING } from '../../../src/simulation/tuning.ts'
import { playModifier } from '../../../src/ui/branch-play-source.ts'
import type { PlayView } from '../../../src/ui/branch-play-source.ts'
import { historyFromPlayView } from '../../../src/ui/desk/data/history.ts'
import { limitedPlayConfig } from '../../../src/ui/desk/data/limited-config.ts'
import { limitedReplayInput } from '../../../src/ui/playtest-evidence.ts'
import type { TimelineRun } from '../../../src/ui/timeline-source.ts'
import type { Evidence, EvidenceSource } from '../../../src/ui/playtest-evidence.ts'
import { deliverEvidence, downloadEvidence } from '../../../src/ui/playtest-evidence/browser-delivery.ts'
import { comparisonSource, observationSource } from '../../../src/ui/playtest-evidence/browser-source.ts'

// 配信境界だけの fixture。スキーマ検証は Phase 3A の単体と実 Worker E2E で行う。
const source = { build: { kind: 'COMMIT', sha: 'a'.repeat(40) }, kind: 'OBSERVATION', selected: { year: 1251 } } as EvidenceSource
const evidence = { schemaVersion: 1, year: 1251 } as Evidence
const json = JSON.stringify(evidence)
const current = () => true
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: Error) => void
  const promise = new Promise<T>((ok, fail) => { resolve = ok; reject = fail })
  return { promise, resolve, reject }
}

afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers() })

it('コピー成功を確認し、拒否時は同じ JSON を手動コピー・ダウンロードへ渡す', async () => {
  const outputs = { copy: vi.fn().mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('NotAllowedError')), download: vi.fn() }
  const generate = vi.fn().mockResolvedValue(evidence)
  await expect(deliverEvidence(source, 'copy', current, undefined, outputs, generate)).resolves.toEqual({ kind: 'copied' })
  expect(outputs.copy).toHaveBeenCalledWith(json)
  const failure = await deliverEvidence(source, 'copy', current, undefined, outputs, generate)
  expect(failure).toEqual({ kind: 'copy-failed', json })
  if (failure.kind !== 'copy-failed') throw new Error('コピー拒否が必要です')
  await expect(deliverEvidence(source, 'download', current, failure.json, outputs, generate)).resolves.toEqual({ kind: 'downloaded' })
  expect(outputs.download).toHaveBeenCalledWith(json, 'chronofork-aaaaaaaaaaaa-1251-observation.json')
  expect(generate).toHaveBeenCalledTimes(2)
})

it.each(['copy', 'download'] as const)('%s: 結果生成中の年・要求・セッション変更後はブラウザへ渡さない', async action => {
  const outputs = { copy: vi.fn(), download: vi.fn() }
  const pending = deferred<Evidence>()
  const generate = vi.fn(() => pending.promise)
  let generation = 1
  const result = deliverEvidence(source, action, () => generation === 1, undefined, outputs, generate)
  generation++
  pending.resolve(evidence)
  await expect(result).resolves.toEqual({ kind: 'stale' })
  expect(outputs.copy).not.toHaveBeenCalled()
  expect(outputs.download).not.toHaveBeenCalled()
  await expect(deliverEvidence(source, action, () => false, json, outputs, generate)).resolves.toEqual({ kind: 'stale' })
  expect(generate).toHaveBeenCalledTimes(1)
})

it('コピーの完了待ちで対象が閉じた場合は成功や手動コピーを表示しない', async () => {
  const pending = deferred<void>()
  const outputs = { copy: vi.fn(() => pending.promise), download: vi.fn() }
  let open = true
  const result = deliverEvidence(source, 'copy', () => open, json, outputs)
  expect(outputs.copy).toHaveBeenCalledWith(json)
  open = false
  pending.reject(new Error('NotAllowedError'))
  await expect(result).resolves.toEqual({ kind: 'stale' })
})

it.each([false, true])('ダウンロードを開始し、失敗してもリンクと object URL を解放する（失敗: %s）', async fails => {
  vi.useFakeTimers()
  const link = { href: '', download: '', click: vi.fn(() => { if (fails) throw new Error('失敗') }), remove: vi.fn() }
  const append = vi.fn()
  const create = vi.fn(() => 'blob:fixture')
  const revoke = vi.fn()
  vi.stubGlobal('document', { createElement: () => link, body: { append } })
  vi.stubGlobal('URL', { createObjectURL: create, revokeObjectURL: revoke })
  const download = () => downloadEvidence(json, 'evidence.json')
  if (fails) expect(download).toThrow('失敗')
  else download()
  expect(append).toHaveBeenCalledWith(link)
  expect(link).toMatchObject({ href: 'blob:fixture', download: 'evidence.json' })
  expect(link.click).toHaveBeenCalledOnce()
  expect(link.remove).toHaveBeenCalledOnce()
  expect(revoke).not.toHaveBeenCalled()
  const blob = create.mock.lastCall as unknown as [Blob]
  expect(blob[0].type).toBe('application/json')
  expect(await blob[0].text()).toBe(json)
  vi.runAllTimers()
  expect(revoke).toHaveBeenCalledWith('blob:fixture')
})

it('未観測、閉じた比較、同じ入力の失敗・中断・リセット後の旧観測は保存対象にしない', () => {
  const build = source.build
  const history = { ref: { year: 1251 } } as NonNullable<Parameters<typeof observationSource>[3]>
  const accepted = { input: { year: 1251 }, outcome: { kind: 'DONE', requestId: 1 } } as NonNullable<Parameters<typeof observationSource>[2]>
  expect(observationSource(build, 1, undefined, undefined, undefined, current)).toHaveProperty('reason')
  expect(observationSource(build, 1, accepted, history, undefined, current)).toHaveProperty('source')
  expect(observationSource(build, 2, accepted, history, undefined, current)).toHaveProperty('reason')
  expect(observationSource(build, 1, accepted, { ...history, ref: { ...history.ref, year: 1252 } }, undefined, current)).toHaveProperty('reason')
  expect(comparisonSource(build, 1, undefined, undefined, current)).toHaveProperty('reason')
})


it('比較の実 view と観測世代を照合し、実 A1 Event と出生前の人物フォーカスを保持する', () => {
  const [firstPersonId, secondPersonId] = ['person-exp-01', 'person-exp-02'] as const
  const input = { ...limitedReplayInput, year: 1250, firstPersonId, secondPersonId, signedDelta: 2, durationYears: 1 }
  const modifier = playModifier(input, [firstPersonId, secondPersonId])
  const world = createMultiHouseDemandWorld(0)
  const initialWorld = { ...world, persons: world.persons.filter(person => person.personId !== firstPersonId) }
  const a0: TimelineRun = {
    initialWorld, playLedger: [], playModifierIds: [],
    inputs: { ...limitedPlayConfig(), seed: input.seed, scenarioId: 'fixture', rngVersion,
      rulesetVersion: EXPERIMENTAL_TUNING.rulesetVersion, evaluatedRuleIds: [] },
    result: { seed: input.seed, branchId: 'A0-play', rngVersion, status: 'COMPLETED', startYear: 1250, transitions: 100,
      snapshots: Array.from({ length: 101 }, (_, i) => ({ ...(i === 0 ? initialWorld : world), year: 1250 + i, pairTrustThroughYear: 1249 + i })),
      eventLog: [], decisionTraces: [], halt: null, goal: null, technicalGoal: null,
      coverage: { implementedRuleIds: [], todoRuleIds: [], executedRuleIds: [], injectedTodoRuleIds: [] },
      autonomousHistory: { status: 'NOT_ESTABLISHED', blockers: [] } },
  }
  const event = { eventId: 'selected', eventType: 'PERSON_BIRTH', year: 1250, phase: 3,
    semanticEventKey: 'fixture', involvedRefs: [], sourceTraceIds: [], stateChanges: [] } as const
  const a1: TimelineRun = { ...a0, playLedger: [modifier], playModifierIds: [modifier.modifierId],
    result: { ...a0.result, branchId: 'A1-play', eventLog: [event] } }
  const view: PlayView = { input, mode: input.mode, modifier, a0, a1 }
  const accepted = { input, observationId: 1, outcome: { kind: 'DONE', requestId: 3, result: view } } as const
  const target = { kind: 'person', id: firstPersonId } as const
  const shown = { view, pair: 'A0_A1', year: 1250, target,
    context: { history: historyFromPlayView(view)!.at('A0', 1251)!, target },
    focus: { kind: 'event', branch: 'A1', id: event.eventId } } as const
  const pick = (selection: Parameters<typeof comparisonSource>[3], id = 1) => comparisonSource(source.build, id, accepted, selection, current)
  expect(pick(shown)).toMatchObject({ source: { requestId: 3, selected: { year: 1250, origin: { branch: 'A1' } },
    selection: { personId: firstPersonId, event: { branch: 'A1', id: event.eventId } } } })
  expect(pick(shown, 2)).toHaveProperty('reason')
  expect(pick({ ...shown, view: { ...view } })).toHaveProperty('reason')
  expect(pick({ ...shown, year: 1251 })).toHaveProperty('reason')
  expect(pick({ ...shown, focus: { ...shown.focus, branch: 'A0' } })).toHaveProperty('reason')
  expect(pick({ ...shown, target: { kind: 'title', id: 'title' } })).toHaveProperty('reason')
  expect(pick({ ...shown, pair: 'A1_A2' })).toHaveProperty('reason')
})
