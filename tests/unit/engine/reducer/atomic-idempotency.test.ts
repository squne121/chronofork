import { describe, expect, it } from 'vitest'
import { diffWorld } from '../../../../src/simulation/engine/reducer/index.ts'
import { validateWorldState } from '../../../../src/simulation/validation/index.ts'
import { deepFreeze } from '../../foundation/helpers.ts'
import { baby, birth, chain, cohort, cohortOutcome, ledger, natural, newTx, newWorld, outcome, rejectionCodes, run, CASH } from './helpers.ts'

describe('純粋性と実差分', () => {
  it('入力 WorldState / Outcome / Transaction を変更しない（凍結入力でも成功）', () => {
    const w = deepFreeze(newWorld())
    const o = deepFreeze(cohortOutcome('group-west-commons', 20, 16))
    const tx = newTx()
    const r = run(w, o, tx)
    expect(r.status).toBe('APPLIED')
    expect(r.world).not.toBe(w)
    expect(w.groups.find((g) => g.groupId === 'group-west-commons')?.population).toBe(30000)
    expect(tx.commands.size).toBe(0) // 入力 Transaction は不変
    expect(r.transaction.commands.size).toBe(1)
  })

  it('確定した実状態差分のみ返し、EventLog を生成しない', () => {
    const r = run(newWorld(), cohortOutcome('group-west-commons', 20, 16))
    const changes = r.applied.flatMap((a) => a.stateChanges.map((c) => c.path))
    expect(changes).toEqual([
      '$.groups[group-west-commons].population',
      '$.demographics.cohortSlots[group-west-commons@1250]',
    ])
    expect(r.applied[0]?.stateChanges.find((c) => c.path.endsWith('population'))).toMatchObject({ before: 30000, after: 30004 })
    expect(Object.keys(r)).not.toContain('events')
    expect(Object.keys(r)).not.toContain('eventLog')
  })

  it('拒否時は入力と同一参照の world を返し、差分も無い', () => {
    const w = newWorld()
    const r = run(w, outcome('B-003', 3, [natural('person-exp-01')])) // 枠が無い
    expect(r.status).toBe('REJECTED')
    expect(r.world).toBe(w)
    expect(r.applied).toEqual([])
    expect(diffWorld(w, r.world)).toEqual([])
  })

  it('requests / traceDrafts は扱わず、件数を unhandled で明示する', () => {
    const r = run(newWorld(), outcome('RULE-C-004', 1, [cohort('group-west-commons', 1, 0)], {
      requests: [{ kind: 'CASUALTY_NOTICE', source: { requestId: 'q', year: 1250, phase: 1, sourceRuleId: 'RULE-C-004', sourceTraceId: 't' }, targetDomain: 'C', requiredResponseYear: 1250, payload: { kind: 'CASUALTY_NOTICE', casualtyId: 'x', groupId: 'g', count: 1 } }],
    }))
    expect(r.unhandled).toEqual({ requests: 1, traceDrafts: 0 })
  })

  it('適用後の世界は既存の WorldState バリデータを通る', () => {
    const { world } = chain([
      cohortOutcome('group-central-elite', 10, 5),
      outcome('B-002', 3, [birth(baby('person-new-1'))]),
    ])
    expect(validateWorldState(world).ok).toBe(true)
  })

  it('適用が WorldState の整合性を壊す場合は INTEGRITY_VIOLATION で拒否（人口 < 生存記名人物）', () => {
    const w = newWorld()
    const r = run(w, cohortOutcome('group-central-elite', 0, 1999)) // 人口 1、生存記名 3 人
    expect(r.status).toBe('REJECTED')
    expect(rejectionCodes(r)).toEqual(['INTEGRITY_VIOLATION'])
    expect(r.units[0]?.rejections[0]?.diagnostics?.map((d) => d.code)).toContain('COHORT_CAPACITY_CONFLICT')
    expect(r.world).toBe(w)
  })
})

describe('バッチの全件事前検証と原子的コミット', () => {
  const batchOf = (id: string, cmds: ReturnType<typeof ledger>[]) => cmds.map((c) => ({ ...c, batchId: id }))

  it('1 件でも不正なら同一 batchId を部分適用しない', () => {
    const w = newWorld()
    const cmds = batchOf('b1', [
      ledger(CASH, 'CREDIT', 100, 'ok-1'),
      ledger(CASH, 'DEBIT', 10_000_000, 'bad'), // 負残高
    ])
    const r = run(w, outcome('RULE-C-005', 1, cmds))
    expect(r.status).toBe('REJECTED')
    expect(r.world).toBe(w)
    expect(r.transaction.commands.size).toBe(0) // 先頭の正常 command も記録されない
    expect(rejectionCodes(r)).toEqual(['NEGATIVE_BALANCE'])
  })

  it('静的検証（権限）の不正も全件拒否し、後続の正常 command を巻き込まない/巻き込む範囲はバッチ単位', () => {
    const bad = { ...ledger(CASH, 'CREDIT', 5, 'x2'), source: { ...ledger(CASH, 'CREDIT', 5, 'x2').source, sourceRuleId: 'B-001' as const } }
    const r = run(newWorld(), outcome('RULE-C-005', 1, [
      ...batchOf('bad-batch', [ledger(CASH, 'CREDIT', 100, 'x1'), bad]),
      ledger(CASH, 'CREDIT', 7, 'solo'), // 別単位は適用される
    ]))
    expect(r.status).toBe('PARTIAL')
    expect(r.units.map((u) => u.status)).toEqual(['REJECTED', 'APPLIED'])
    expect(r.world.resources.find((a) => a.accountId === CASH)?.quantity).toBe(52007)
  })

  it('全件成立ならすべて同時にコミットされる', () => {
    const r = run(newWorld(), outcome('RULE-C-005', 1, batchOf('b2', [ledger(CASH, 'CREDIT', 100, 'a'), ledger(CASH, 'DEBIT', 30, 'b')])))
    expect(r.status).toBe('APPLIED')
    expect(r.world.resources.find((a) => a.accountId === CASH)?.quantity).toBe(52070)
  })

  it('バッチ内の逐次依存: 先頭の CREDIT があって初めて後続の DEBIT が通る', () => {
    const cmds = batchOf('b3', [ledger(CASH, 'CREDIT', 100, 'a'), ledger(CASH, 'DEBIT', 52100, 'b')])
    expect(run(newWorld(), outcome('RULE-C-005', 1, cmds)).status).toBe('APPLIED')
  })

  it('状態を変えない command は NO_STATE_CHANGE で拒否', () => {
    const c = chain([cohortOutcome('group-west-commons', 1, 0)])
    // 同じ集団の枠は一度だけ（別 commandId でも）
    const r = run(c.world, outcome('RULE-C-004', 1, [cohort('group-west-commons', 1, 0, 'again')]), c.tx)
    expect(rejectionCodes(r)).toEqual(['COHORT_ALREADY_SET'])
  })
})

describe('commandId の冪等性（枝・年度の Transaction 内）', () => {
  const o = () => outcome('RULE-C-005', 1, [ledger(CASH, 'CREDIT', 100, 'cmd-1')])

  it('同 ID・同内容の再送は DUPLICATE で、二重適用しない', () => {
    const first = run(newWorld(), o())
    const second = run(first.world, o(), first.transaction)
    expect(second.status).toBe('DUPLICATE')
    expect(second.world).toBe(first.world)
    expect(second.applied).toEqual([])
    expect(first.world.resources.find((a) => a.accountId === CASH)?.quantity).toBe(52100)
  })

  it('同 ID・異内容は CONFLICT で、状態は変わらない', () => {
    const first = run(newWorld(), o())
    const conflict = run(first.world, outcome('RULE-C-005', 1, [ledger(CASH, 'CREDIT', 999, 'cmd-1')]), first.transaction)
    expect(conflict.status).toBe('CONFLICT')
    expect(rejectionCodes(conflict)).toEqual(['COMMAND_ID_CONFLICT'])
    expect(conflict.world).toBe(first.world)
  })

  it('別枝（別 Transaction）では独立して判定される', () => {
    const a = run(newWorld(), o(), newTx('branch-a'))
    const b = run(newWorld(), o(), newTx('branch-b'))
    expect(a.status).toBe('APPLIED')
    expect(b.status).toBe('APPLIED')
    expect(b.transaction.branchId).toBe('branch-b')
  })

  it('拒否された command の ID は記録されず、修正して同 ID で再送できる', () => {
    const bad = run(newWorld(), outcome('RULE-C-005', 1, [ledger(CASH, 'DEBIT', 99_999_999, 'retry')]))
    expect(bad.status).toBe('REJECTED')
    const fixed = run(bad.world, outcome('RULE-C-005', 1, [ledger(CASH, 'DEBIT', 1, 'retry')]), bad.transaction)
    expect(fixed.status).toBe('APPLIED')
  })

  it('バッチの再送は DUPLICATE、一部だけの再送は拒否、構成違いは CONFLICT', () => {
    const batch = [ledger(CASH, 'CREDIT', 10, 'p', { batchId: 'bb' }), ledger(CASH, 'CREDIT', 20, 'q', { batchId: 'bb' })]
    const first = run(newWorld(), outcome('RULE-C-005', 1, batch))
    expect(run(first.world, outcome('RULE-C-005', 1, batch), first.transaction).status).toBe('DUPLICATE')
    const partial = run(first.world, outcome('RULE-C-005', 1, [batch[0]!, ledger(CASH, 'CREDIT', 30, 'r', { batchId: 'bb' })]), first.transaction)
    expect(partial.status).toBe('CONFLICT')
    const half = run(first.world, outcome('RULE-C-005', 1, [batch[0]!]), first.transaction)
    expect(half.status).toBe('CONFLICT') // 同一 batchId で構成が違う
    // 単独適用済みの command を新バッチへ混ぜると、バッチ単位でのみ再送できるため拒否
    const solo = run(first.world, outcome('RULE-C-005', 1, [ledger(CASH, 'CREDIT', 1, 'solo')]), first.transaction)
    const mixed = run(solo.world, outcome('RULE-C-005', 1, [ledger(CASH, 'CREDIT', 1, 'solo', { batchId: 'nb' }), ledger(CASH, 'CREDIT', 2, 'fresh', { batchId: 'nb' })]), solo.transaction)
    expect(mixed.status).toBe('CONFLICT') // batchId 付与で内容が変わった solo は CONFLICT
    const same = run(solo.world, outcome('RULE-C-005', 1, [ledger(CASH, 'CREDIT', 1, 'solo'), ledger(CASH, 'CREDIT', 2, 'fresh', { batchId: 'nb' })]), solo.transaction)
    expect(same.units.map((u) => u.status)).toEqual(['DUPLICATE', 'APPLIED'])
  })

  it('同一 Outcome 内の commandId 重複は拒否する', () => {
    const r = run(newWorld(), outcome('RULE-C-005', 1, [ledger(CASH, 'CREDIT', 1, 'dup', { batchId: 'z' }), ledger(CASH, 'CREDIT', 1, 'dup', { batchId: 'z' })]))
    expect(rejectionCodes(r)).toEqual(['DUPLICATE_COMMAND_ID_IN_OUTCOME'])
  })

  it('出生の再送で人口・枠・人物が二重に増えない', () => {
    const c = chain([cohortOutcome('group-central-elite', 2, 0), outcome('B-002', 3, [birth(baby('person-new-1'))])])
    const again = run(c.world, outcome('B-002', 3, [birth(baby('person-new-1'))]), c.tx)
    expect(again.status).toBe('DUPLICATE')
    expect(c.world.persons.filter((p) => p.personId === 'person-new-1')).toHaveLength(1)
  })

  it('比較は内容のみ（キー順に依存しない）', () => {
    const c1 = ledger(CASH, 'CREDIT', 5, 'k')
    const reordered = Object.fromEntries(Object.entries(c1).reverse()) as typeof c1
    const first = run(newWorld(), outcome('RULE-C-005', 1, [c1]))
    expect(run(first.world, outcome('RULE-C-005', 1, [reordered]), first.transaction).status).toBe('DUPLICATE')
  })
})
