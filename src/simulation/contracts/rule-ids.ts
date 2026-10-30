// 契約 §8: 37 RuleID（改名禁止）。A=10 / B=9 / C=9 / D=9。
export const RULE_IDS_BY_DOMAIN = {
  A: [
    'A-LEG-01',
    'A-DYN-02',
    'A-CLA-03',
    'A-SUC-04',
    'A-SUC-05',
    'A-TIT-06',
    'A-TIT-07',
    'A-TIT-08',
    'A-TIT-09',
    'A-CLA-10',
  ],
  B: ['B-001', 'B-002', 'B-003', 'B-004', 'B-005', 'B-006', 'B-007', 'B-008', 'B-009'],
  C: [
    'RULE-C-001',
    'RULE-C-002',
    'RULE-C-003',
    'RULE-C-004',
    'RULE-C-005',
    'RULE-C-006',
    'RULE-C-007',
    'RULE-C-008',
    'RULE-C-009',
  ],
  D: [
    'D-REB-001',
    'D-REB-002',
    'D-REB-003',
    'D-MIL-001',
    'D-VAS-002',
    'D-DIP-001',
    'D-MIL-002',
    'D-DIP-002',
    'D-VAS-001',
  ],
} as const

export type RuleId = (typeof RULE_IDS_BY_DOMAIN)[keyof typeof RULE_IDS_BY_DOMAIN][number]

export const RULE_IDS: readonly RuleId[] = [
  ...RULE_IDS_BY_DOMAIN.A,
  ...RULE_IDS_BY_DOMAIN.B,
  ...RULE_IDS_BY_DOMAIN.C,
  ...RULE_IDS_BY_DOMAIN.D,
]
