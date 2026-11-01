// 評価ディスパッチ順（技術的な呼出順）。ゲーム規則ではなく、契約 §6 の①〜⑦と Registry の領域から決めた暫定配置。
// 全 37 RuleID をちょうど 1 回ずつ含む（テストで検証）。TODO のルールは評価器が無い限り呼ばない。
// ③a 自然死 → ③b 出生 → A の法的所属 → ③c 昇格 → ③d〜f 縁談・政策、④ 繰越/剥奪 → 候補 → 承認（契約 §6）。
import type { Phase, RuleId } from '../contracts/index.ts'

export const RULE_SCHEDULE: Readonly<Record<Exclude<Phase, 7>, readonly RuleId[]>> = Object.freeze({
  1: ['RULE-C-001', 'RULE-C-002', 'RULE-C-003', 'RULE-C-004', 'RULE-C-005'],
  2: ['RULE-C-006', 'RULE-C-007', 'RULE-C-008', 'RULE-C-009'],
  3: ['B-003', 'B-002', 'A-DYN-02', 'B-001', 'B-009', 'B-004', 'B-005', 'A-LEG-01', 'B-006', 'B-007', 'B-008'],
  4: ['A-TIT-08', 'A-CLA-03', 'A-SUC-04', 'A-SUC-05', 'A-TIT-07', 'A-CLA-10', 'A-TIT-06', 'A-TIT-09'],
  5: ['D-REB-001', 'D-REB-002', 'D-REB-003', 'D-MIL-001', 'D-VAS-002'],
  6: ['D-DIP-001', 'D-MIL-002', 'D-DIP-002', 'D-VAS-001'],
})

export const YEARLY_PHASES = [1, 2, 3, 4, 5, 6] as const
