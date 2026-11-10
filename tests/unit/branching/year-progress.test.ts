// 確定済み年次進捗(onYearCommitted)の検証。観測 hook の有無で歴史が一切変わらないこと、
// 通知が確定済みの年だけであること(HALTED・失敗年は通知しない)、A1は fork 年からの区間であることを確認する。
// 評価器は fork-history.test.ts と同じ synthetic fixture(実ルールではない)。
import { describe, expect, it } from 'vitest'
import type { StatModifier } from '../../../src/simulation/contracts/index.ts'
import { PAIR_TRUST_STAT_KEY, STAT_MODIFIER_RULE_VERSION } from '../../../src/simulation/contracts/index.ts'
import { runTimeline } from '../../../src/simulation/engine/index.ts'
import type { EvaluatorMap, YearProgress } from '../../../src/simulation/engine/index.ts'
import { createRootBranch, forkHistory } from '../../../src/simulation/branching/index.ts'
import { modifierContribution, toPairRef } from '../../../src/simulation/intervention/index.ts'
import { cohortCommand, draft, GROUP, newWorld, outcomeOf } from '../engine/runner/fixtures.ts'

const SEED = 7
const P = newWorld().persons.map((p) => p.personId).sort()
const evaluators = (ledger: readonly StatModifier[], throwAtYear?: number): EvaluatorMap => ({
  'RULE-C-004': (_w, ctx) => {
    if (ctx.year === throwAtYear) throw new Error('synthetic failure')
    const v = ctx.random({ stream: 'EXOGENOUS', targetId: GROUP, eventKey: 'births' })
    const bonus = ledger.reduce((s, m) => s + modifierContribution(m, ctx.year), 0)
    return outcomeOf(ctx, { commands: [cohortCommand(ctx, 20 + Math.floor(v * 5) + bonus, 16)], traceDrafts: [draft(ctx)] })
  },
})
const modifier = (startYear: number): StatModifier => ({
  modifierId: 'm-1', interventionId: 'i-1', targetRef: toPairRef(P[0]!, P[1]!)!, statKey: PAIR_TRUST_STAT_KEY,
  signedDelta: 5, startYear, endExclusiveYear: 1350, decayPolicy: 'NONE', ruleVersion: STAT_MODIFIER_RULE_VERSION,
})
const collect = () => {
  const got: YearProgress[] = []
  return { got, hook: (p: YearProgress) => { got.push(p) } }
}

describe('runTimeline: 確定済み年次進捗', () => {
  it('hook の有無で TimelineResult が完全一致する(WorldState・EventLog・DecisionTrace・halt・coverage)', () => {
    const plain = runTimeline(newWorld(), { seed: SEED, evaluators: evaluators([]) })
    const { got, hook } = collect()
    const observed = runTimeline(newWorld(), { seed: SEED, evaluators: evaluators([]), onYearCommitted: hook })
    expect(JSON.stringify(observed)).toBe(JSON.stringify(plain))
    expect(got).toHaveLength(100)
  })

  it('1251〜1350年初を単調に1回ずつ通知し、遷移数・Event累計が実結果と一致する', () => {
    const { got, hook } = collect()
    const r = runTimeline(newWorld(), { seed: SEED, evaluators: evaluators([]), onYearCommitted: hook })
    expect(got.map((p) => p.confirmedYear)).toEqual(Array.from({ length: 100 }, (_, i) => 1251 + i))
    expect(got.map((p) => p.committedYear)).toEqual(Array.from({ length: 100 }, (_, i) => 1250 + i))
    expect(got.every((p, i) => p.transitionsDone === i + 1 && p.transitionsTotal === 100 && p.startYear === 1250 && p.goalYear === 1350)).toBe(true)
    expect(got.at(-1)!.eventCount).toBe(r.eventLog.length)
    expect(got.every((p, i) => i === 0 || p.eventCount >= got[i - 1]!.eventCount)).toBe(true)
  })

  it('HALTED の年は通知しない(確定した年までで止まり、1350年を通知しない)', () => {
    const { got, hook } = collect()
    const r = runTimeline(newWorld(), { seed: SEED, evaluators: evaluators([], 1300), onYearCommitted: hook })
    expect(r.status).toBe('HALTED')
    expect(got.at(-1)!.confirmedYear).toBe(1300) // 1299年の処理まで確定。1300年は失敗で未確定
    expect(got).toHaveLength(50)
    expect(r.snapshots.at(-1)!.year).toBe(1300)
  })

  it('観測者が例外を投げても計算結果は変わらない', () => {
    const plain = runTimeline(newWorld(), { seed: SEED, evaluators: evaluators([]) })
    const observed = runTimeline(newWorld(), { seed: SEED, evaluators: evaluators([]), onYearCommitted: () => { throw new Error('observer failure') } })
    expect(JSON.stringify(observed)).toBe(JSON.stringify(plain))
  })
})

describe('forkHistory: A1は fork 年からの実再計算だけを通知する', () => {
  const rootOf = () => {
    const ev = evaluators([])
    const r = createRootBranch(runTimeline(newWorld(), { seed: SEED, branchId: 'A0', evaluators: ev }), [], ev)
    if (!r.ok) throw new Error(r.message)
    return r.branch
  }
  const run = (forkYear: number, hook?: (p: YearProgress) => void) => forkHistory({
    parent: rootOf(), forkYear, branchId: 'A1', modifiers: [modifier(forkYear)],
    evaluatorsFor: ({ ledger }) => evaluators(ledger), ...(hook ? { onYearCommitted: hook } : {}),
  })

  it.each([1290, 1340])('fork %i年: 区間と総遷移数がA0と異なり、祖先の未計算未来を通知しない', (y) => {
    const { got, hook } = collect()
    const r = run(y, hook)
    expect(r.ok).toBe(true)
    expect(got).toHaveLength(1350 - y)
    expect(got[0]!.startYear).toBe(y)
    expect(got[0]!.confirmedYear).toBe(y + 1)
    expect(got.at(-1)!.confirmedYear).toBe(1350)
    expect(got.every((p) => p.branchId === 'A1' && p.transitionsTotal === 1350 - y)).toBe(true)
  })

  it('hook の有無で Branch が完全一致する', () => {
    const plain = run(1290)
    const { hook } = collect()
    const observed = run(1290, hook)
    expect(JSON.stringify(observed)).toBe(JSON.stringify(plain))
  })
})
