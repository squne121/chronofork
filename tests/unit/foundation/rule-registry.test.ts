import { describe, expect, it } from 'vitest'
import { RULE_IDS } from '../../../src/simulation/contracts/index.ts'
import {
  RULE_REGISTRY,
  getRule,
  isRuleId,
  listRulesByDomain,
  listRulesByStatus,
  mayEmitNarrativeEvents,
} from '../../../src/simulation/rule-registry.ts'

// 契約 §8 の原文どおり（改名検知のため独立に記述）
const EXPECTED = [
  'A-LEG-01', 'A-DYN-02', 'A-CLA-03', 'A-SUC-04', 'A-SUC-05',
  'A-TIT-06', 'A-TIT-07', 'A-TIT-08', 'A-TIT-09', 'A-CLA-10',
  'B-001', 'B-002', 'B-003', 'B-004', 'B-005', 'B-006', 'B-007', 'B-008', 'B-009',
  'RULE-C-001', 'RULE-C-002', 'RULE-C-003', 'RULE-C-004', 'RULE-C-005',
  'RULE-C-006', 'RULE-C-007', 'RULE-C-008', 'RULE-C-009',
  'D-REB-001', 'D-REB-002', 'D-REB-003', 'D-MIL-001', 'D-VAS-002',
  'D-DIP-001', 'D-MIL-002', 'D-DIP-002', 'D-VAS-001',
]

describe('RuleRegistry', () => {
  it('37 ID が契約 §8 と完全一致し、一意である', () => {
    expect(EXPECTED).toHaveLength(37)
    expect(RULE_REGISTRY.map((r) => r.ruleId).sort()).toEqual([...EXPECTED].sort())
    expect(new Set(RULE_REGISTRY.map((r) => r.ruleId)).size).toBe(37)
    expect([...RULE_IDS].sort()).toEqual([...EXPECTED].sort())
  })

  it('領域別件数は A=10 / B=9 / C=9 / D=9', () => {
    expect(listRulesByDomain('A')).toHaveLength(10)
    expect(listRulesByDomain('B')).toHaveLength(9)
    expect(listRulesByDomain('C')).toHaveLength(9)
    expect(listRulesByDomain('D')).toHaveLength(9)
  })

  it('今回の実ルールはすべて TODO で、物語イベントを生成できない', () => {
    expect(listRulesByStatus('TODO')).toHaveLength(37)
    expect(listRulesByStatus('IMPLEMENTED')).toHaveLength(0)
    for (const r of RULE_REGISTRY) {
      expect(r.implementationStatus).toBe('TODO')
      expect(mayEmitNarrativeEvents(r.ruleId)).toBe(false)
    }
  })

  it('各ルールは領域・概要を持ち、ID 接頭辞が領域と整合する', () => {
    for (const r of RULE_REGISTRY) {
      expect(r.summary.length).toBeGreaterThan(0)
      expect(r.ruleId.startsWith(r.domain === 'C' ? 'RULE-C-' : `${r.domain}-`)).toBe(true)
    }
  })

  it('isRuleId / getRule は登録済み ID のみ受理し、engine 用 ID を追加しない', () => {
    expect(isRuleId('B-004')).toBe(true)
    expect(isRuleId('ENGINE-INIT')).toBe(false)
    expect(isRuleId(undefined)).toBe(false)
    expect(getRule('A-LEG-01').domain).toBe('A')
    expect(Object.isFrozen(RULE_REGISTRY)).toBe(true)
  })
})
