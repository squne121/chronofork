// Session C: explicitly opted-in 100-year verification; avoid multiplying CPU/RSS in quick-check.
// Run: CHRONOFORK_VIABILITY_LONG=1 npx vitest run tests/unit/viability/long-recalculation.test.ts
// Add CHRONOFORK_VIABILITY_REPEAT=1 (together with LONG=1; alone it does nothing) to recompute A0 a second time and compare per-year digests (extra CPU).
// This uses the existing CALIBRATION_ONLY integrated experiment, never official scenario evidence.
import { createHash } from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  createExperimentalIntegratedTimelineOptions, createExperimentalIntegratedEvaluators,
  INTEGRATED_SEED, INTEGRATED_TRUST_REDUCTION, NALVEN_DYNASTY_ID,
} from '../../../src/scenario/experimental/index.ts'
import { createRootBranch, forkHistory } from '../../../src/simulation/branching/index.ts'
import type { EventLogEntry, DecisionTrace, WorldState } from '../../../src/simulation/contracts/index.ts'
import { runTimeline } from '../../../src/simulation/engine/index.ts'
import { evaluateGoal } from '../../../src/simulation/goal.ts'
import {
  auditWorld, auditTransition, classifyHolderDeaths, digestHistory, firstDivergence,
} from './audit-fixture.ts'

type History = Readonly<{
  branch: string
  snapshots: readonly WorldState[]
  eventLog: readonly EventLogEntry[]
  decisionTraces: readonly DecisionTrace[]
}>

// Generated person IDs can exceed 600 characters; keep reports readable without losing identity.
const short = (id: string) => id.length > 48 ? id.slice(0, 24) + '…#' + createHash('sha256').update(id).digest('hex').slice(0, 8) : id

function auditHistory(history: History) {
  const eventsByYear = new Map<number, EventLogEntry[]>()
  const tracesByYear = new Map<number, DecisionTrace[]>()
  for (const e of history.eventLog) {
    const arr = eventsByYear.get(e.year) ?? []
    arr.push(e); eventsByYear.set(e.year, arr)
  }
  for (const t of history.decisionTraces) {
    const arr = tracesByYear.get(t.year) ?? []
    arr.push(t); tracesByYear.set(t.year, arr)
  }
  const errors = history.snapshots.flatMap(s => auditWorld(s))
  const holderDeaths = []
  for (let i = 0; i < history.snapshots.length - 1; i++) {
    const before = history.snapshots[i]!, after = history.snapshots[i + 1]!
    const events = eventsByYear.get(before.year) ?? []
    errors.push(...auditTransition(before, after, events, tracesByYear.get(before.year) ?? []))
    holderDeaths.push(...classifyHolderDeaths(before, after))
  }
  const final = history.snapshots.at(-1)!
  const goal = evaluateGoal(final, { dynastyId: NALVEN_DYNASTY_ID })
  const metrics = {
    seed: INTEGRATED_SEED, branch: history.branch,
    years: history.snapshots.length, finalYear: final.year,
    persons: final.persons.length, eventCount: history.eventLog.length,
    deathEvents: history.eventLog.filter(e => e.eventType.includes('PERSON_DEATH')).length,
    successionCaseEvents: history.eventLog.filter(e => e.eventType.includes('LEGAL_CASE_SET')).length,
    titleTransferEvents: history.eventLog.filter(e => e.eventType.includes('LEGAL_TITLE_TRANSFER')).length,
    crownHeldByDead: final.titles.filter(t => {
      if (t.kind !== 'CROWN' || t.holder.status !== 'HELD') return false
      const holderId = t.holder.personId
      return !final.persons.find(p => p.personId === holderId)?.alive
    }).map(t => t.titleId),
    maximumPersonIdLength: final.persons.reduce((n, p) => Math.max(n, p.personId.length), 0),
    maximumDisplayNameLength: final.persons.reduce((n, p) => Math.max(n, p.name.length), 0),
    technicalGoal: goal.status, officialGoal: null,
    holderDeaths: holderDeaths.map(d => d.year + ':' + d.kind + ':' + d.titleId + ':' + short(d.deadPersonId) + ':' + d.outcome),
    violationCodes: Object.fromEntries([...new Set(errors.map(e => e.code))].map(c => [c, errors.filter(e => e.code === c).length])),
    violations: errors.length, firstViolations: errors.slice(0, 8),
  }
  console.info('CHRONOFORK_SESSION_C_100Y ' + JSON.stringify(metrics))
  expect(history.snapshots).toHaveLength(101)
  expect(final.year).toBe(1350)
  // Do not abort before observing the A1 branch when A0 contains a known defect.
  return { goal, errors, metrics }
}

describe('Session C: 1250-1350 A0/A1 strict viability evidence (opt-in)', () => {
  it.skipIf(process.env.CHRONOFORK_VIABILITY_LONG !== '1')(
    '100 real transitions, legal fork, causal proof and strict Goal with no fabricated victory', () => {
      const { world, options } = createExperimentalIntegratedTimelineOptions('viability-A0')
      const a0 = runTimeline(world, options)
      expect(a0.status, JSON.stringify(a0.halt)).toBe('COMPLETED')
      if (a0.status !== 'COMPLETED') return
      expect(a0.snapshots).toHaveLength(101)
      expect(a0.autonomousHistory.status).toBe('NOT_ESTABLISHED') // known TODO rules
      expect(a0.goal).toBeNull() // never publish technicalGoal as official victory
      const baseGoal = evaluateGoal(a0.snapshots.at(-1)!, { dynastyId: NALVEN_DYNASTY_ID })
      expect(a0.technicalGoal).toEqual(baseGoal)
      const root = createRootBranch(a0, [], options.evaluators)
      expect(root.ok).toBe(true)
      if (!root.ok) return
      const fork = forkHistory({
        parent: root.branch, forkYear: 1250, branchId: 'viability-A1',
        modifiers: [INTEGRATED_TRUST_REDUCTION],
        evaluatorsFor: ({ ledger }) => createExperimentalIntegratedEvaluators(world, ledger),
      })
      expect(fork.ok, fork.ok ? undefined : JSON.stringify(fork)).toBe(true)
      if (!fork.ok) return
      expect(fork.branch.status, JSON.stringify(fork.branch.halt)).toBe('COMPLETED')
      if (fork.branch.status !== 'COMPLETED') return
      expect(fork.branch.seed).toBe(INTEGRATED_SEED)
      expect(fork.branch.snapshots[0]).toEqual(a0.snapshots[0])
      expect(fork.branch.goal).toBeNull()
      expect(fork.branch.recompute?.fromYear).toBe(1250)
      const interventionTraces = fork.branch.decisionTraces.filter(
        t => t.modifierIds.includes(INTEGRATED_TRUST_REDUCTION.modifierId))
      expect(interventionTraces.length).toBeGreaterThan(0)

      const a0Audit = auditHistory({
        branch: 'A0', snapshots: a0.snapshots,
        eventLog: a0.eventLog, decisionTraces: a0.decisionTraces,
      })
      const a1Audit = auditHistory({
        branch: 'A1', snapshots: fork.branch.snapshots,
        eventLog: fork.branch.eventLog, decisionTraces: fork.branch.decisionTraces,
      })
      for (const [label, log, traces] of [
        ['A0', a0.eventLog, a0.decisionTraces],
        ['A1', fork.branch.eventLog, fork.branch.decisionTraces],
      ] as const) {
        const byId = new Map(traces.map(t => [t.traceId, t]))
        for (const event of log.filter(e => e.eventType.includes('LEGAL_TITLE_TRANSFER'))) {
          expect(event.sourceTraceIds.some(id => byId.get(id)?.ruleId === 'A-TIT-07'),
            label + '; transfer=' + event.eventId).toBe(true)
        }
      }
      if (process.env.CHRONOFORK_VIABILITY_REPEAT === '1') {
        // Per-year digests only: never stringify the whole history at once.
        const again = createExperimentalIntegratedTimelineOptions('viability-A0')
        const rerun = runTimeline(again.world, again.options)
        expect(rerun.status).toBe('COMPLETED')
        if (rerun.status === 'COMPLETED') {
          const divergence = firstDivergence(
            digestHistory({ snapshots: a0.snapshots, eventLog: a0.eventLog, decisionTraces: a0.decisionTraces }),
            digestHistory({ snapshots: rerun.snapshots, eventLog: rerun.eventLog, decisionTraces: rerun.decisionTraces }))
          expect(divergence, 'seed=' + INTEGRATED_SEED + '; first divergence').toBeNull()
        }
      }
      // A0 and A1 outcomes are separate observations of the strict Goal; neither is asserted as an invariant.
      // One candidate does not prove impossibility when it fails; never weaken the 1350 Goal.
      console.info('CHRONOFORK_SESSION_C_GOAL_WITNESS ' + JSON.stringify({
        seed: INTEGRATED_SEED,
        intervention: INTEGRATED_TRUST_REDUCTION,
        A0: a0Audit.goal.status, A1: a1Audit.goal.status,
        officialGoalPublished: false,
        a1VictoryDemonstrated: a1Audit.goal.status === 'ACHIEVED',
        a0DefeatObserved: a0Audit.goal.status === 'NOT_ACHIEVED',
        a0VsA1FirstDivergence: firstDivergence(
          digestHistory({ snapshots: a0.snapshots, eventLog: a0.eventLog, decisionTraces: a0.decisionTraces }),
          digestHistory({ snapshots: fork.branch.snapshots, eventLog: fork.branch.eventLog,
            decisionTraces: fork.branch.decisionTraces })),
        witnessScope: 'ONE_CALIBRATION_ONLY_A1_NOT_A_GLOBAL_SEARCH',
      }))
      expect(a0Audit.errors.length, JSON.stringify(a0Audit.metrics)).toBe(0)
      expect(a1Audit.errors.length, JSON.stringify(a1Audit.metrics)).toBe(0)
    }, 300000)
})
