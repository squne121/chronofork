import { describe, expect, it } from 'vitest'
import type { CommandType, DomainCommand, RuleOutcome, Source } from '../../../src/simulation/contracts/index.ts'
import { COMMAND_WRITE_OWNER } from '../../../src/simulation/contracts/index.ts'

describe('契約型', () => {
  it('全 Command 種別に書込 owner が定義されている', () => {
    const types: CommandType[] = [
      'MARRIAGE_REGISTER', 'LEGAL_DYNASTY_SET', 'LEGAL_TITLE_TRANSFER', 'TITLE_RECOGNITION_SET',
      'LEGAL_CASE_SET', 'CONTROL_MANDATE_SET', 'TAX_MANDATE_SET', 'PERSON_BIRTH', 'PERSON_DEATH',
      'POPULATION_COHORT', 'POPULATION_CASUALTY', 'SUPPORT_SET', 'RESOURCE_TRANSACTION',
      'REGION_CONTROL_SET', 'TREATY_COMMIT',
    ]
    expect(Object.keys(COMMAND_WRITE_OWNER).sort()).toEqual([...types].sort())
  })

  it('死亡・人口・台帳は共通 reducer が唯一の確定者', () => {
    expect(COMMAND_WRITE_OWNER.PERSON_DEATH).toBe('COMMON_DEATH_REDUCER')
    expect(COMMAND_WRITE_OWNER.POPULATION_CASUALTY).toBe('COMMON_POPULATION_REDUCER')
    expect(COMMAND_WRITE_OWNER.RESOURCE_TRANSACTION).toBe('RESOURCE_LEDGER_REDUCER')
    expect(COMMAND_WRITE_OWNER.MARRIAGE_REGISTER).toBe('A_LEGAL')
  })

  it('任意 fieldPath 書込や未登録 RuleID は型で拒否される（コンパイル時検査）', () => {
    const source: Source = { requestId: 'r', year: 1250, phase: 1, sourceRuleId: 'B-001', sourceTraceId: 't' }
    const check = () => {
      // @ts-expect-error 任意 fieldPath を書き換える Command は存在しない
      const generic: DomainCommand = { type: 'SET_FIELD', commandId: 'c', source, fieldPath: 'persons[0].alive', value: false }
      // @ts-expect-error 未登録の RuleID は Source に使えない
      const badSource: Source = { ...source, sourceRuleId: 'ENGINE-INIT' }
      // @ts-expect-error RuleOutcome.ruleId も 37 件に限る
      const badOutcome: RuleOutcome = { ruleId: 'X-1', phase: 1, commands: [], requests: [], deferred: [], traceDrafts: [] }
      return [generic, badSource, badOutcome]
    }
    expect(typeof check).toBe('function')
  })
})
