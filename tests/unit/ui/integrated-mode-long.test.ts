// 統合モードの100年実計算(A0/A1 各約35秒)。通常の quick-check には入れない明示オプトイン:
//   CHRONOFORK_LONG_INTEGRATED_UI=1 npx vitest run tests/unit/ui/integrated-mode-long.test.ts
// UIアダプタ(runPlayComparison)と、共通ファクトリからの直接実行が同じ WorldState/EventLog/DecisionTrace を生むことを確認する。
// すべて CALIBRATION_ONLY。婚姻・出生・Goal成功を固定せず、実計算の結果を読むだけ。
import { describe, expect, it } from 'vitest'
import {
  createExperimentalIntegratedEvaluators, createExperimentalIntegratedTimelineOptions,
  INTEGRATED_SUPPORTING_PERSON_ID, NALVEN_DYNASTY_ID,
} from '../../../src/scenario/experimental/index.ts'
import { runTimeline } from '../../../src/simulation/engine/index.ts'
import { evaluateGoal } from '../../../src/simulation/goal.ts'
import { EXPERIMENTAL_NALVEN_GOAL } from '../../../src/scenario/experimental/index.ts'
import { compareYear, runPlayComparison } from '../../../src/ui/branch-play-source.ts'
import type { PlayInput } from '../../../src/ui/branch-play-source.ts'
import { buildOverview } from '../../../src/ui/integrated-overview.ts'
import { toDisplayView } from '../../../src/ui/play-view.ts'

const longTest = process.env.CHRONOFORK_LONG_INTEGRATED_UI === '1' ? describe : describe.skip
// PR #78 で実測した条件(CALIBRATION_ONLY)。
const INPUT: PlayInput = {
  mode: 'INTEGRATED_EXPERIMENTAL', seed: 20260101, year: 1250,
  firstPersonId: 'person-exp-02', secondPersonId: 'person-exp-05', signedDelta: -20, durationYears: 5,
}
/** 巨大配列をJSON一括化せず、要素ごとに同一性を数える。 */
function firstDifference<T>(a: readonly T[], b: readonly T[]): number {
  if (a.length !== b.length) return Math.min(a.length, b.length)
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i] && JSON.stringify(a[i]) !== JSON.stringify(b[i])) return i
  return -1
}

longTest('統合モード: UIアダプタと直接実行の同一性(100年・実計算)', () => {
  const t0 = performance.now()
  const ui = runPlayComparison(INPUT)
  const uiMs = performance.now() - t0
  const c = ui.ok ? ui.comparison : undefined

  it('UIアダプタが両枝を最後まで計算し、正式goal=null・37件TODO・厳格技術Goalを維持する', () => {
    expect(ui.ok).toBe(true)
    if (!c) return
    console.info('CHRONOFORK_INTEGRATED_UI_ADAPTER_MS=' + Math.round(uiMs))
    for (const r of [c.a0, c.a1]) {
      expect(r.result.status).toBe('COMPLETED')
      expect(r.result.snapshots).toHaveLength(101)
      expect(r.result.goal).toBeNull()
      expect(r.result.coverage.todoRuleIds).toHaveLength(37)
      expect(r.result.technicalGoal).toEqual(evaluateGoal(r.result.snapshots.at(-1)!, EXPERIMENTAL_NALVEN_GOAL))
      expect(r.result.autonomousHistory.status).toBe('NOT_ESTABLISHED')
    }
    expect(c.branch.ledger).toEqual([c.modifier])
    expect(c.root.ledger).toEqual([])
  })

  it('共通ファクトリからの直接実行とWorldState/EventLog/DecisionTraceが一致する(A0/A1の決定性)', () => {
    if (!c) throw new Error('adapter failed')
    // A0: 共通オプションをそのまま runTimeline へ。A1: 同じ構成に介入台帳だけ加えて1250年から直接実行。
    const a0Setup = createExperimentalIntegratedTimelineOptions('A0-play')
    const direct0 = runTimeline(a0Setup.world, { ...a0Setup.options, seed: INPUT.seed })
    const world = createExperimentalIntegratedTimelineOptions('A1-play').world
    const direct1 = runTimeline(world, {
      seed: INPUT.seed, branchId: 'A1-play', evaluators: createExperimentalIntegratedEvaluators(world, [c.modifier]),
      goal: { dynastyId: NALVEN_DYNASTY_ID }, technicalGoalEvaluation: true,
    })
    for (const [ui1, direct, label] of [[c.a0, direct0, 'A0'], [c.a1, direct1, 'A1']] as const) {
      expect(direct.status, label).toBe('COMPLETED')
      expect(firstDifference(ui1.result.snapshots, direct.snapshots), label + ' snapshots').toBe(-1)
      expect(firstDifference(ui1.result.eventLog, direct.eventLog), label + ' eventLog').toBe(-1)
      expect(firstDifference(ui1.result.decisionTraces, direct.decisionTraces), label + ' decisionTraces').toBe(-1)
      expect(ui1.result.technicalGoal, label + ' technicalGoal').toEqual(direct.technicalGoal)
    }
  })

  it('PR #78 の連鎖(1278年SUPPORTING登録→B-005合意→婚姻→B-002出生)を同じ実行で含む', () => {
    if (!c) throw new Error('adapter failed')
    for (const [label, r] of [['A0', c.a0], ['A1', c.a1]] as const) {
      const events = r.result.eventLog
      const supporting = events.filter(e => e.eventType.split('+').includes('PERSON_SUPPORTING_RECORD'))
      expect(supporting.map(e => e.year), label).toEqual([1278])
      const finalWorld = r.result.snapshots.at(-1)!
      const person = finalWorld.persons.find(p => p.personId === INTEGRATED_SUPPORTING_PERSON_ID)
      expect(person?.interactionRole, label).toBe('SUPPORTING')
      // 1278年以降にSUPPORTINGを含むB-005合意がある(婚姻成立は固定せず、実Traceの存在だけ見る)。
      const b005 = r.result.decisionTraces.filter(t => t.ruleId === 'B-005' && t.year >= 1278 &&
        t.actorRef.kind === 'PERSON_PAIR' && t.actorRef.ids.includes(INTEGRATED_SUPPORTING_PERSON_ID))
      expect(b005.length, label).toBeGreaterThan(0)
      const count = (type: string) => events.filter(e => e.eventType.split('+').includes(type)).length
      console.info('CHRONOFORK_INTEGRATED_UI_COUNTS=' + JSON.stringify({ branch: label,
        marriage: count('MARRIAGE_REGISTER'), birth: count('PERSON_BIRTH'), death: count('PERSON_DEATH'),
        dissolve: count('MARRIAGE_DISSOLVE'), supporting: count('PERSON_SUPPORTING_RECORD'),
        titleTransfer: count('LEGAL_TITLE_TRANSFER'), mandate: count('CONTROL_MANDATE_SET'),
        pendingSuccession1350: finalWorld.legal.cases.filter(x => x.kind === 'SUCCESSION' && x.status === 'PENDING').length,
        goal: r.result.technicalGoal?.status, events: events.length, traces: r.result.decisionTraces.length }))
    }
  })

  it('Event↔DecisionTraceの参照が完全版で閉じ、判断の意味による枝間比較が年ごとに成立する', () => {
    if (!c) throw new Error('adapter failed')
    for (const r of [c.a0, c.a1]) {
      const eventIds = new Set(r.result.eventLog.map(e => e.eventId)), traceIds = new Set(r.result.decisionTraces.map(t => t.traceId))
      expect(r.result.eventLog.every(e => e.sourceTraceIds.every(i => traceIds.has(i)))).toBe(true)
      expect(r.result.decisionTraces.every(t => t.eventIds.every(i => eventIds.has(i)))).toBe(true)
    }
    // 介入年: traceIdではなく意味で対応付き、対応不明が出ても比較しない(誤対応しない)。
    const diff = compareYear(c, 1250)
    expect(diff.traceSummary.matched).toBeGreaterThan(0)
    expect(diff.traces.every(d => d.kind !== 'CHANGED' || d.before!.ruleId === d.after!.ruleId)).toBe(true)
  })

  it('Worker転送ビューは完全版の無損失な部分集合で、Event↔Trace参照が閉じ、省略件数が保存される', () => {
    if (!c) throw new Error('adapter failed')
    const t1 = performance.now()
    const view = toDisplayView(c)
    console.info('CHRONOFORK_INTEGRATED_UI_VIEW_MS=' + Math.round(performance.now() - t1))
    const om = view.displayOmission!
    for (const [label, full, shown] of [['a0', c.a0, view.a0], ['a1', c.a1, view.a1]] as const) {
      const omE = Object.values(om.omittedEventsByType).reduce((n, x) => n + x, 0)
      const omT = Object.values(om.omittedTracesByRule).reduce((n, x) => n + x, 0)
      expect(shown.result.eventLog.length + omE, label).toBe(full.result.eventLog.length)
      expect(shown.result.decisionTraces.length + omT, label).toBe(full.result.decisionTraces.length)
      expect(om.fullEventCount[label]).toBe(full.result.eventLog.length)
      expect(om.fullTraceCount[label]).toBe(full.result.decisionTraces.length)
      // 残したものは完全版と一字一句同じ。
      const fullEvents = new Map(full.result.eventLog.map(e => [e.eventId, e]))
      const fullTraces = new Map(full.result.decisionTraces.map(t => [t.traceId, t]))
      expect(shown.result.eventLog.every(e => JSON.stringify(e) === JSON.stringify(fullEvents.get(e.eventId)))).toBe(true)
      expect(shown.result.decisionTraces.every(t => JSON.stringify(t) === JSON.stringify(fullTraces.get(t.traceId)))).toBe(true)
      // 相互参照が閉じる。
      const eIds = new Set(shown.result.eventLog.map(e => e.eventId)), tIds = new Set(shown.result.decisionTraces.map(t => t.traceId))
      expect(shown.result.eventLog.every(e => e.sourceTraceIds.every(i => tIds.has(i))), label + ' event->trace').toBe(true)
      expect(shown.result.decisionTraces.every(t => t.eventIds.every(i => eIds.has(i))), label + ' trace->event').toBe(true)
      expect(shown.result.snapshots).toBe(full.result.snapshots)
    }
    // 省略は大幅な縮約になっている(実測値をログ)。
    console.info('CHRONOFORK_INTEGRATED_UI_VIEW=' + JSON.stringify({ ...om,
      shownEvents: view.a0.result.eventLog.length, shownTraces: view.a0.result.decisionTraces.length }))
    // 介入のあったTraceは残る(A1だけがmodifierIdを持つ)。
    expect(view.a1.result.decisionTraces.some(t => t.modifierIds.includes(c.modifier.modifierId))).toBe(true)
    const overview = buildOverview(view)
    console.info('CHRONOFORK_INTEGRATED_UI_OVERVIEW=' + JSON.stringify({ totalDifferences: overview.totalDifferences,
      finalWorldIdentical: overview.finalWorldIdentical, interventionTraces: overview.interventionTraces }))
  })
}, 900000)
