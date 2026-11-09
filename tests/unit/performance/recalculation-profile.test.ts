// P0: 再計算の局所ベンチマーク。通常のquick-checkではskipし、手動で明示的に実行する。
// 実ゲームの結果を変更しない。値は環境依存の実測値であり合格閾値ではない。
import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { performance } from 'node:perf_hooks'
import { expect, it } from 'vitest'
import {
  createExperimentalIntegratedEvaluators,
  createExperimentalIntegratedTimelineOptions,
  INTEGRATED_PAIR,
  INTEGRATED_SEED,
  INTEGRATED_START_YEAR,
  INTEGRATED_TRUST_REDUCTION,
} from '../../../src/scenario/experimental/integrated-run.ts'
import { createRootBranch, forkHistory } from '../../../src/simulation/branching/index.ts'
import type { StatModifier, WorldState } from '../../../src/simulation/contracts/index.ts'
import { runTimeline, runYear } from '../../../src/simulation/engine/index.ts'
import { runPlayComparison } from '../../../src/ui/branch-play-source.ts'
import { toDisplayView } from '../../../src/ui/play-view.ts'

type History = Readonly<{
  snapshots: readonly WorldState[]
  eventLog: readonly unknown[]
  decisionTraces: readonly unknown[]
}>
// 履歴全体を1つのJSON文字列にすると文字列長上限を超えるため、要素ごとに逐次ハッシュする。
// 入力順・内容が同一なら同一SHAになる（決定性検証用）。
const digest = (h: History): string => {
  const hash = createHash('sha256')
  for (const [name, items] of [
    ['snapshots', h.snapshots], ['eventLog', h.eventLog], ['decisionTraces', h.decisionTraces],
  ] as const) {
    hash.update(name + ':' + items.length + '\n')
    for (const item of items) hash.update(JSON.stringify(item) + '\n')
  }
  return hash.digest('hex')
}
const measured = <T>(fn: () => T): { result: T; ms: number } => {
  const start = performance.now()
  const result = fn()
  return { result, ms: Math.round((performance.now() - start) * 100) / 100 }
}
const msRound = (n: number) => Math.round(n * 100) / 100

// Usage (local only; high cost):
// CHRONOFORK_PROFILE=1 CHRONOFORK_PROFILE_YEAR=1250 npm test -- tests/unit/performance/recalculation-profile.test.ts
// Repeat with 1290 and 1340. Set CHRONOFORK_PROFILE_UI=1 for the full UI comparison +
// toDisplayView + structuredClone (transfer proxy); it repeats the A0 calculation.
// Set CHRONOFORK_PROFILE_YEAR_DETAIL=1 to run a separate 100-year per-year profile.
// CHRONOFORK_PROFILE_OUT=<path> writes the JSON report to a file. Large heaps need
// NODE_OPTIONS=--max-old-space-size=12288 (history is multi-GB when held in memory).
// Do NOT treat structuredClone as a measurement of real browser Worker transport.
it.skipIf(process.env.CHRONOFORK_PROFILE !== '1')(
  'P0: integrated 100-year A0 / fork / optional UI / optional annual profile',
  () => {
    const forkYear = Number(process.env.CHRONOFORK_PROFILE_YEAR ?? '1250')
    if (![1250, 1290, 1340].includes(forkYear)) {
      throw new Error('CHRONOFORK_PROFILE_YEAR must be 1250, 1290 or 1340')
    }

    const setup = createExperimentalIntegratedTimelineOptions('A0-play')
    const a0Run = measured(() => runTimeline(setup.world, setup.options))
    const a0 = a0Run.result
    expect(a0.status, JSON.stringify(a0.halt)).toBe('COMPLETED')
    expect(a0.snapshots).toHaveLength(101)
    const rootRun = measured(() => createRootBranch(a0, [], setup.options.evaluators))
    const root = rootRun.result
    expect(root.ok).toBe(true)
    if (!root.ok) throw new Error('P0_ROOT_REJECTED: ' + root.code)

    // 試験条件の変化は介入年とmodiferのIDだけ。規則・seed・係数は変えない。
    const modifier: StatModifier = {
      ...INTEGRATED_TRUST_REDUCTION,
      modifierId: 'profile:modifier:' + forkYear,
      interventionId: 'profile:intervention:' + forkYear,
      startYear: forkYear,
      endExclusiveYear: forkYear + 5,
    }
    const forkRun = measured(() => forkHistory({
      parent: root.branch,
      branchId: 'A1-profile-' + forkYear,
      forkYear,
      modifiers: [modifier],
      evaluatorsFor: ({ ledger }) => createExperimentalIntegratedEvaluators(
        root.branch.snapshots[forkYear - INTEGRATED_START_YEAR]!, ledger),
    }))
    const fork = forkRun.result
    expect(fork.ok).toBe(true)
    if (!fork.ok) throw new Error('P0_FORK_REJECTED: ' + fork.code)
    expect(fork.branch.status, JSON.stringify(fork.branch.halt)).toBe('COMPLETED')
    expect(fork.branch.snapshots).toHaveLength(101)
    const hashRun = measured(() => ({ a0: digest(a0), a1: digest(fork.branch) }))

    let perYear: unknown = null
    if (process.env.CHRONOFORK_PROFILE_YEAR_DETAIL === '1') {
      const samples: { year: number; ms: number; events: number; traces: number }[] = []
      let world = setup.world
      for (let index = 0; index < 100; index++) {
        const step = measured(() => runYear(world, setup.options))
        expect(step.result.status).toBe('COMPLETED')
        if (step.result.status !== 'COMPLETED') {
          throw new Error('P0_YEAR_HALTED: ' + JSON.stringify(step.result.halt))
        }
        samples.push({
          year: world.year, ms: step.ms,
          events: step.result.events.length, traces: step.result.traces.length,
        })
        world = step.result.world
      }
      expect(world).toEqual(a0.snapshots.at(-1))
      perYear = {
        measuredTransitions: samples.length,
        totalMs: msRound(samples.reduce((sum, row) => sum + row.ms, 0)),
        slowestYears: samples.sort((a, b) => b.ms - a.ms).slice(0, 10),
      }
    }

    let ui: unknown = null
    if (process.env.CHRONOFORK_PROFILE_UI === '1') {
      const input = {
        mode: 'INTEGRATED_EXPERIMENTAL' as const,
        seed: INTEGRATED_SEED,
        year: forkYear,
        firstPersonId: INTEGRATED_PAIR[0],
        secondPersonId: INTEGRATED_PAIR[1],
        signedDelta: INTEGRATED_TRUST_REDUCTION.signedDelta,
        durationYears: 5,
      }
      const compareRun = measured(() => runPlayComparison(input))
      const comparison = compareRun.result
      expect(comparison.ok).toBe(true)
      if (!comparison.ok) throw new Error('P0_COMPARISON_FAILED: ' + comparison.code)
      const viewRun = measured(() => toDisplayView(comparison.comparison))
      const cloneRun = measured(() => structuredClone(viewRun.result))
      expect(cloneRun.result.a0.result.snapshots).toHaveLength(101)
      ui = {
        comparisonTotalMsIncludingFreshA0: compareRun.ms,
        displayConversionMs: viewRun.ms,
        structuredCloneProxyMs: cloneRun.ms,
        // Worker.postMessageの実搬送・React描画はここでは計測できない。
        workerTransferMs: 'UNVERIFIED',
        reactRenderMs: 'UNVERIFIED',
        transferredEventCount: viewRun.result.a0.result.eventLog.length +
          viewRun.result.a1.result.eventLog.length,
        transferredTraceCount: viewRun.result.a0.result.decisionTraces.length +
          viewRun.result.a1.result.decisionTraces.length,
      }
    }

    const report = JSON.stringify({
      kind: 'EXPERIMENTAL_CALIBRATION_ONLY',
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      seed: INTEGRATED_SEED,
      forkYear,
      yearRange: [INTEGRATED_START_YEAR, 1350],
      timingsMs: {
        a0: a0Run.ms,
        rootBranch: rootRun.ms,
        forkSuffix: forkRun.ms,
        hashOverhead: hashRun.ms,
      },
      counts: {
        a0Events: a0.eventLog.length,
        a0Traces: a0.decisionTraces.length,
        forkEvents: fork.branch.eventLog.length,
        forkTraces: fork.branch.decisionTraces.length,
      },
      sha256: hashRun.result,
      perYear,
      ui,
      memoryBytesAfterProfile: process.memoryUsage(),
      peakRssKb: process.resourceUsage().maxRSS,
    })
    // vitestがconsoleを抑制する設定でも結果を得られるよう、任意でファイルにも出力する。
    if (process.env.CHRONOFORK_PROFILE_OUT) writeFileSync(process.env.CHRONOFORK_PROFILE_OUT, report + '\n')
    console.info('CHRONOFORK_P0_RECALC_PROFILE', report)
  },
  600_000,
)
