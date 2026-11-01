import { describe, expect, it } from 'vitest'
import type { DomainCommand, Phase, RuleId } from '../../../../src/simulation/contracts/index.ts'
import { COMMAND_WRITE_OWNER } from '../../../../src/simulation/contracts/index.ts'
import { IMPLEMENTED_COMMAND_TYPES, UNIMPLEMENTED_COMMAND_TYPES } from '../../../../src/simulation/engine/reducer/index.ts'
import { listRulesByStatus } from '../../../../src/simulation/rule-registry.ts'
import { cohort, cohortOutcome, ledger, natural, newWorld, outcome, rejectionCodes, run, source, FORCE } from './helpers.ts'

describe('書込 owner・RuleID・Source・Phase', () => {
  it('B は共通人口 reducer の POPULATION_COHORT（C 会計）を発行できない', () => {
    const c: DomainCommand = { ...cohort('group-west-commons', 1, 0), source: source('B-002', 1, 'c') }
    const r = run(newWorld(), outcome('B-002', 1, [c]))
    expect(r.status).toBe('REJECTED')
    expect(rejectionCodes(r)).toEqual(['WRITE_OWNER_VIOLATION'])
  })

  it('A の LEGAL command を B / C / D は発行できない', () => {
    for (const rule of ['B-004', 'RULE-C-004', 'D-MIL-001'] as const) {
      const c: DomainCommand = {
        type: 'TITLE_RECOGNITION_SET', commandId: `t-${rule}`, source: source(rule, 4, rule),
        titleId: 'title-exp-west', recognition: { status: 'PENDING' },
      }
      const r = run(newWorld(), outcome(rule, 4, [c]))
      expect(rejectionCodes(r)).toEqual(['WRITE_OWNER_VIOLATION'])
    }
  })

  it('戦死は D のみ、自然死は B のみ（共通死亡 reducer が確定）', () => {
    const asC: DomainCommand = { type: 'PERSON_DEATH', commandId: 'd1', source: source('RULE-C-004', 3, 'd1'), personId: 'person-exp-01', deathYear: 1250, cause: 'NATURAL' }
    expect(rejectionCodes(run(newWorld(), outcome('RULE-C-004', 3, [asC])))).toEqual(['WRITE_OWNER_VIOLATION'])
    const battleByB: DomainCommand = { type: 'PERSON_DEATH', commandId: 'd2', source: source('B-003', 3, 'd2'), personId: 'person-exp-01', deathYear: 1250, cause: 'BATTLE', casualtyId: 'c' }
    expect(rejectionCodes(run(newWorld(), outcome('B-003', 3, [battleByB])))).toEqual(['WRITE_OWNER_VIOLATION'])
  })

  it('台帳: C は CREDIT/DEBIT のみ。COMMIT/RELEASE/CASUALTY は D のみ', () => {
    const commitByC = ledger(FORCE, 'COMMIT', 1, 'l1', { ruleId: 'RULE-C-005', phase: 1 })
    expect(rejectionCodes(run(newWorld(), outcome('RULE-C-005', 1, [commitByC])))).toEqual(['WRITE_OWNER_VIOLATION'])
  })

  it('未登録の RuleID は拒否（Outcome / command とも）', () => {
    const r = run(newWorld(), outcome('X-999' as RuleId, 1, []))
    expect(rejectionCodes(r)).toEqual(['UNKNOWN_RULE_ID'])
    const c = { ...cohort('group-west-commons', 1, 0), source: source('X-999' as RuleId, 1, 'c') }
    expect(rejectionCodes(run(newWorld(), outcome('RULE-C-004', 1, [c])))).toEqual(['UNKNOWN_RULE_ID'])
  })

  it('Source: sourceRuleId / 年 / Phase が Outcome・WorldState と一致しなければ拒否', () => {
    const w = newWorld()
    const base = cohort('group-west-commons', 1, 0)
    const rule = { ...base, source: source('RULE-C-003', 1, 'c') }
    expect(rejectionCodes(run(w, outcome('RULE-C-004', 1, [rule])))).toEqual(['SOURCE_RULE_MISMATCH'])
    const year = { ...base, source: source('RULE-C-004', 1, 'c', 1251) }
    expect(rejectionCodes(run(w, outcome('RULE-C-004', 1, [year])))).toEqual(['YEAR_MISMATCH'])
    const phase = { ...base, source: source('RULE-C-004', 2, 'c') }
    expect(rejectionCodes(run(w, outcome('RULE-C-004', 1, [phase])))).toEqual(['PHASE_MISMATCH'])
    const trace = { ...base, source: { ...source('RULE-C-004', 1, 'c'), sourceTraceId: '' } }
    expect(rejectionCodes(run(w, outcome('RULE-C-004', 1, [trace])))).toEqual(['INVALID_COMMAND'])
  })

  it.each([2, 3, 4, 5, 6, 7] as const)('POPULATION_COHORT は Phase 1 のみ（Phase %i は拒否）', (phase: Phase) => {
    const c = { ...cohort('group-west-commons', 1, 0), source: source('RULE-C-004', phase, 'c') }
    expect(rejectionCodes(run(newWorld(), outcome('RULE-C-004', phase, [c])))).toEqual(['PHASE_NOT_ALLOWED'])
  })

  it('Phase 7 は確定検証のみで、どの command も適用しない', () => {
    const c = { ...natural('person-exp-01'), source: source('B-003', 7, 'n') }
    expect(rejectionCodes(run(newWorld(), outcome('B-003', 7, [c])))).toEqual(['PHASE_NOT_ALLOWED'])
  })

  it('Outcome の Phase が 1..7 の整数でなければ拒否', () => {
    expect(rejectionCodes(run(newWorld(), outcome('B-003', 9 as Phase, [])))).toEqual(['PHASE_MISMATCH'])
  })

  it('Transaction の年が WorldState と異なれば拒否（別年度の判定状態を使わない）', () => {
    const r = run(newWorld(), cohortOutcome('group-west-commons', 1, 0), { ...run(newWorld(), outcome('B-001', 3, [])).transaction, year: 1251 })
    expect(rejectionCodes(r)).toEqual(['TRANSACTION_SCOPE_MISMATCH'])
  })

  it('全 command 種別に owner が定義され、実装/未実装の分類が網羅的', () => {
    const all = Object.keys(COMMAND_WRITE_OWNER).sort()
    expect([...IMPLEMENTED_COMMAND_TYPES, ...UNIMPLEMENTED_COMMAND_TYPES].sort()).toEqual(all)
  })

  it('ゲームルールの実装済み宣言を増やしていない（37 件すべて TODO のまま）', () => {
    expect(listRulesByStatus('IMPLEMENTED')).toHaveLength(0)
    expect(listRulesByStatus('TODO')).toHaveLength(37)
  })
})

describe('不正な command 種別', () => {
  it('未知の type（Object.prototype のキーを含む）は例外にせず拒否する', () => {
    for (const type of ['NOPE', 'toString', '__proto__']) {
      const c = { type, commandId: `u-${type}`, source: source('B-001', 3, 'u') } as unknown as DomainCommand
      const r = run(newWorld(), outcome('B-001', 3, [c]))
      expect(rejectionCodes(r)).toEqual(['INVALID_COMMAND'])
    }
  })
})
