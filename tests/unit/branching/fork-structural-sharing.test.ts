// Issue #110 工程2C: forkHistory の構造共有。API が発行した（深く凍結済みの）親枝からの分岐では分岐前履歴を複製せず共有し、
// 呼出側が組み立てた親は従来どおり全体を複製して隔離する。どちらも内容（JSON・要素順）は同一でなければならない。
import { describe, expect, it } from 'vitest'
import type { StatModifier } from '../../../src/simulation/contracts/index.ts'
import { PAIR_TRUST_STAT_KEY, STAT_MODIFIER_RULE_VERSION } from '../../../src/simulation/contracts/index.ts'
import { runTimeline } from '../../../src/simulation/engine/index.ts'
import type { EvaluatorMap } from '../../../src/simulation/engine/index.ts'
import { modifierContribution, toPairRef } from '../../../src/simulation/intervention/index.ts'
import { createRootBranch, forkHistory } from '../../../src/simulation/branching/index.ts'
import type { Branch, BranchEvaluatorFactory } from '../../../src/simulation/branching/index.ts'
import { cohortCommand, draft, newWorld, outcomeOf } from '../engine/runner/fixtures.ts'

const SEED = 42
const P = newWorld().persons.map((p) => p.personId).sort()
const mod = (id: string, startYear: number): StatModifier => ({
  modifierId: `m-${id}`, interventionId: `i-${id}`, targetRef: toPairRef(P[0]!, P[1]!)!, statKey: PAIR_TRUST_STAT_KEY,
  signedDelta: 5, startYear, endExclusiveYear: 1350, decayPolicy: 'NONE', ruleVersion: STAT_MODIFIER_RULE_VERSION,
})
const factory: BranchEvaluatorFactory = ({ ledger }): EvaluatorMap => ({
  'RULE-C-004': (_w, ctx) => {
    const v = ctx.random({ stream: 'EXOGENOUS', targetId: 'g', eventKey: 'births' })
    const bonus = ledger.reduce((s, m) => s + modifierContribution(m, ctx.year), 0)
    return outcomeOf(ctx, { commands: [cohortCommand(ctx, 20 + Math.floor(v * 5) + bonus, 16)], traceDrafts: [draft(ctx)] })
  },
})
const ok = (r: ReturnType<typeof forkHistory>): Branch => {
  if (!r.ok) throw new Error(`${r.code}: ${r.message}`)
  return r.branch
}
const root = (() => {
  const evaluators = factory({ branchId: 'A0', parentBranchId: 'none', forkYear: 1250, seed: SEED, ledger: [], knownPersonIds: new Set(P) })
  const r = createRootBranch(runTimeline(newWorld(), { seed: SEED, branchId: 'A0', evaluators }), [])
  if (!r.ok) throw new Error(r.message)
  return r.branch
})()
const fork = (parent: Branch, year: number, id: string) =>
  ok(forkHistory({ parent, forkYear: year, branchId: id, modifiers: [mod(id, year)], evaluatorsFor: factory }))
/** Branch 全体の内容（キー順を含む）。 */
const json = (b: Branch) => JSON.stringify(b)

describe('forkHistory の構造共有', () => {
  it('発行済み親からの分岐は分岐前の要素を共有し、内容は複製した親からの分岐と同一', () => {
    const before = json(root)
    const shared = fork(root, 1290, 'A1')
    // 呼出側が組み立てた（未発行の）同内容の親: 従来どおり全体を複製する経路。
    const plainParent = structuredClone(root) as Branch
    const copied = fork(plainParent, 1290, 'A1')
    expect(json(shared)).toBe(json(copied))
    expect(json(root)).toBe(before)
    // 発行済み親: 分岐年より前の snapshot・Event・Trace は参照共有。分岐年以降は新しい値。
    expect(shared.snapshots[39]).toBe(root.snapshots[39])
    expect(shared.snapshots[40]).not.toBe(root.snapshots[40])
    expect(shared.eventLog[0]).toBe(root.eventLog[0])
    expect(shared.decisionTraces[0]).toBe(root.decisionTraces[0])
    // 未発行の親: 何も共有しない（呼出側の値を後から変更されても分岐へ波及しない）。
    expect(copied.snapshots[0]).not.toBe(plainParent.snapshots[0])
    expect(copied.eventLog[0]).not.toBe(plainParent.eventLog[0])
    ;(plainParent.snapshots[0] as { year: number }).year = 9999
    expect(copied.snapshots[0]!.year).toBe(1250)
  })

  it('結果は深く凍結され、共有要素も含めて変更できない。孫分岐も同一内容', () => {
    const a1 = fork(root, 1290, 'A1')
    const a2 = fork(a1, 1320, 'A2')
    const a2copied = fork(structuredClone(a1) as Branch, 1320, 'A2')
    expect(json(a2)).toBe(json(a2copied))
    expect(a2.snapshots[10]).toBe(root.snapshots[10])
    for (const b of [a1, a2]) {
      expect(Object.isFrozen(b)).toBe(true)
      expect(Object.isFrozen(b.snapshots)).toBe(true)
      expect(Object.isFrozen(b.snapshots[0]!.persons[0])).toBe(true)
      expect(Object.isFrozen(b.snapshots.at(-1)!.groups[0])).toBe(true)
      expect(Object.isFrozen(b.ledger[0])).toBe(true)
      expect(Object.isFrozen(b.decisionTraces.at(-1)!.candidates)).toBe(true)
      expect(() => { (b.snapshots[0] as { year: number }).year = 1 }).toThrow(TypeError)
    }
    expect(a2.ledger).toHaveLength(2)
    expect(a1.ledger).toHaveLength(1)
  })

  it('呼出側の modifier を後から変更しても台帳へ波及しない', () => {
    const m = mod('X', 1300)
    const b = ok(forkHistory({ parent: root, forkYear: 1300, branchId: 'AX', modifiers: [m], evaluatorsFor: factory }))
    ;(m as { signedDelta: number }).signedDelta = 99
    expect(b.ledger[0]!.signedDelta).toBe(5)
  })
})
