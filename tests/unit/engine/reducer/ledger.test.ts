import { describe, expect, it } from 'vitest'
import type { WorldState } from '../../../../src/simulation/contracts/index.ts'
import { validateWorldState } from '../../../../src/simulation/validation/index.ts'
import { CASH, FORCE, FORCE_GROUP, ledger, newWorld, outcome, rejectionCodes, run, chain } from './helpers.ts'

const acct = (w: WorldState, id: string) => {
  const a = w.resources.find((x) => x.accountId === id)
  if (!a) throw new Error(id)
  return a
}
const d = (cmds: ReturnType<typeof ledger>[], rule: 'RULE-C-005' | 'D-REB-001' = 'D-REB-001', phase: 1 | 5 = 5) => outcome(rule, phase, cmds)
const cash = (cmds: ReturnType<typeof ledger>[]) => d(cmds, 'RULE-C-005', 1)

describe('ResourceLedger: CREDIT / DEBIT（現金）', () => {
  it('CREDIT / DEBIT が残高に反映され、バリデータを通る', () => {
    const { world } = chain([cash([ledger(CASH, 'CREDIT', 1000, 'c1')]), cash([ledger(CASH, 'DEBIT', 500, 'd1')])])
    expect(acct(world, CASH).quantity).toBe(52500)
    expect(validateWorldState(world).ok).toBe(true)
  })
  it('負残高になる DEBIT は拒否', () => {
    expect(rejectionCodes(run(newWorld(), cash([ledger(CASH, 'DEBIT', 52001, 'd')])))).toEqual(['NEGATIVE_BALANCE'])
  })
  it('予約済みの現金は DEBIT できない（二重消費）。RELEASE 後なら可能', () => {
    const { world, tx } = chain([d([ledger(CASH, 'COMMIT', 50000, 'k1')])])
    const blocked = run(world, cash([ledger(CASH, 'DEBIT', 3000, 'd1')]), tx)
    expect(rejectionCodes(blocked)).toEqual(['COMMITTED_FUNDS_DEBIT'])
    const ok = chain([d([ledger(CASH, 'RELEASE', 50000, 'r1')]), cash([ledger(CASH, 'DEBIT', 3000, 'd2')])], world, tx)
    expect(acct(ok.world, CASH)).toMatchObject({ quantity: 49000, committed: 0 })
  })
  it.each([0, -5, 1.5, Number.NaN, Infinity])('amount=%s は拒否', (amount) => {
    expect(rejectionCodes(run(newWorld(), cash([ledger(CASH, 'CREDIT', amount, 'x')])))).toEqual(['INVALID_AMOUNT'])
  })
  it('安全な整数範囲を超える CREDIT は拒否', () => {
    const r = run(newWorld(), cash([ledger(CASH, 'CREDIT', Number.MAX_SAFE_INTEGER, 'x')]))
    expect(rejectionCodes(r)).toEqual(['RESOURCE_OVERFLOW'])
  })
  it('存在しない口座は拒否', () => {
    expect(rejectionCodes(run(newWorld(), cash([ledger('acct-none', 'CREDIT', 1, 'x')])))).toEqual(['NOT_FOUND'])
  })
  it('casualtyId は CASUALTY 以外では使えない', () => {
    expect(rejectionCodes(run(newWorld(), cash([ledger(CASH, 'CREDIT', 1, 'x', { casualtyId: 'c' })])))).toEqual(['INVALID_COMMAND'])
  })
})

describe('ResourceLedger: COMMIT / RELEASE / CASUALTY', () => {
  it('過剰予約を拒否し、予約は排他的（残余を超えて重ねられない）', () => {
    const { world, tx } = chain([d([ledger(FORCE, 'COMMIT', 150, 'k1')])])
    const over = run(world, d([ledger(FORCE, 'COMMIT', 51, 'k2')]), tx) // 200 - 150 = 50
    expect(rejectionCodes(over)).toEqual(['OVER_COMMIT'])
    expect(run(world, d([ledger(FORCE, 'COMMIT', 50, 'k3')]), tx).status).toBe('APPLIED')
  })
  it('予約を超える RELEASE を拒否', () => {
    expect(rejectionCodes(run(newWorld(), d([ledger(FORCE, 'RELEASE', 1, 'r')])))).toEqual(['OVER_RELEASE'])
  })
  it('兵員 Pool の CREDIT / DEBIT は拒否（人口から導出。再生成しない）', () => {
    expect(rejectionCodes(run(newWorld(), d([ledger(FORCE, 'CREDIT', 1, 'c', { ruleId: 'D-REB-001', phase: 5 })])))).toEqual(['FORCE_POOL_DIRECT_EDIT'])
  })
  it('CASUALTY は予約兵からのみ、casualtyId ごとに一度だけ', () => {
    const base = chain([d([ledger(FORCE, 'COMMIT', 10, 'k')])])
    const noPop = run(base.world, d([ledger(FORCE, 'CASUALTY', 4, 'x1', { casualtyId: 'cas-1' })]), base.tx)
    // 台帳 CASUALTY 単独（人口通知なし）は完結しないため拒否
    expect(rejectionCodes(noPop)).toEqual(['CASUALTY_INCOMPLETE'])
    const over = run(base.world, d([ledger(FORCE, 'CASUALTY', 11, 'x2', { casualtyId: 'cas-1' })]), base.tx)
    expect(rejectionCodes(over)).toEqual(['CASUALTY_EXCEEDS_COMMITTED'])
    const missing = run(base.world, d([ledger(FORCE, 'CASUALTY', 1, 'x3')]), base.tx)
    expect(rejectionCodes(missing)).toEqual(['CASUALTY_ID_MISSING'])
    const cashCas = run(base.world, d([ledger(CASH, 'CASUALTY', 1, 'x4', { casualtyId: 'cas-9' })]), base.tx)
    expect(rejectionCodes(cashCas)).toEqual(['CASUALTY_ON_CASH'])
  })
  it('台帳 CASUALTY と人口通知が同一バッチで完結すると、Pool と人口が一度だけ減る', () => {
    const w0 = newWorld()
    const k = chain([d([ledger(FORCE, 'COMMIT', 10, 'k')])])
    const o = outcome('D-MIL-001', 5, [
      { ...ledger(FORCE, 'CASUALTY', 3, 'led', { casualtyId: 'cas-1', batchId: 'war-1', ruleId: 'D-MIL-001' }) },
      { type: 'POPULATION_CASUALTY', commandId: 'pop', batchId: 'war-1', source: { requestId: 'r', year: 1250, phase: 5, sourceRuleId: 'D-MIL-001', sourceTraceId: 't' }, casualtyId: 'cas-1', groupId: FORCE_GROUP, count: 3, namedPersonIds: [] },
    ])
    const r = run(k.world, o, k.tx)
    expect(r.status).toBe('APPLIED')
    expect(acct(r.world, FORCE)).toMatchObject({ quantity: 197, committed: 7 })
    const pop = (w: WorldState) => w.groups.find((g) => g.groupId === FORCE_GROUP)?.population
    expect(pop(r.world)).toBe((pop(w0) ?? 0) - 3)
    expect(validateWorldState(r.world).ok).toBe(true)
    // 同じ casualtyId の別 command は二重消費
    const again = run(r.world, outcome('D-MIL-001', 5, [ledger(FORCE, 'CASUALTY', 1, 'led2', { casualtyId: 'cas-1', ruleId: 'D-MIL-001' })]), r.transaction)
    expect(rejectionCodes(again)).toEqual(['CASUALTY_ALREADY_APPLIED'])
  })
})
