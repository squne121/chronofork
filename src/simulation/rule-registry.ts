// 契約 §8 の固定 RuleID Registry（37 件・改名禁止）。
// TODO のルールは新しい物語イベントを発生させず、未実装を明示する（契約 §1）。
import type { Domain, RuleId } from './contracts/index.ts'
import { RULE_IDS_BY_DOMAIN } from './contracts/index.ts'

export type ImplementationStatus = 'IMPLEMENTED' | 'TODO'

export type RuleDescriptor = Readonly<{
  ruleId: RuleId
  domain: Domain
  summary: string
  implementationStatus: ImplementationStatus
}>

const SUMMARIES: Readonly<Record<RuleId, string>> = {
  'A-LEG-01': '婚姻の法的資格・契約登録',
  'A-DYN-02': '法的王朝所属と母系契約',
  'A-CLA-03': '血統証拠・傍系請求権の候補化',
  'A-SUC-04': '土地領主権の相続順位・複数娘',
  'A-SUC-05': '王位継承と土地領主権の非連動',
  'A-TIT-06': '世襲称号の授与・承認',
  'A-TIT-07': '称号相続の法的移転と実効支配照合',
  'A-TIT-08': '剥奪・赦免・復権と領土返還の非自動性',
  'A-TIT-09': '主権変更・臣従における世襲領主権の存続',
  'A-CLA-10': '競合請求・争訟・承認却下の裁定',
  'B-001': '初期 8 人以外の人物候補の生成・昇格',
  'B-002': '出生・親子の整合的更新',
  'B-003': '自然死亡・人物行動停止',
  'B-004': '縁談候補探索・自律提案',
  'B-005': '縁談の交渉・拒否・法照会と婚姻成立',
  'B-006': '家門別利害・同盟・不一致の判断',
  'B-007': '統治者の融和/強硬選好と制度的抵抗',
  'B-008': '役職任命・譲歩交渉',
  'B-009': '信頼・野心・人物間関係の累積と介入の参照',
  'RULE-C-001': '地域生産介入 modifier の適用',
  'RULE-C-002': '局所天候の抽選と年間生産',
  'RULE-C-003': '課税量・徴収効率・税収帰属',
  'RULE-C-004': '生活充足・繁栄・人口の年次変化',
  'RULE-C-005': '国庫収支・義務費・給付予算',
  'RULE-C-006': '集団利益調整 modifier と外部性',
  'RULE-C-007': '生活負担と集団不満の更新',
  'RULE-C-008': '家門別支持割合の更新',
  'RULE-C-009': '集計と B/D 向け判断資料の公開',
  'D-REB-001': '反乱/動員力と軍事資源の排他的割当',
  'D-REB-002': '家門ごとの反乱準備更新',
  'D-REB-003': '蜂起/クーデターの成立判定',
  'D-MIL-001': '国内戦闘・鎮圧と実効支配移行',
  'D-VAS-002': '既存封臣の独立要求・離反',
  'D-DIP-001': '対外圧力・同盟・開戦/不戦の選択',
  'D-MIL-002': '対外戦闘・疲弊・地域占領',
  'D-DIP-002': '講和条件の比較と受諾可否',
  'D-VAS-001': '属国・外国封臣化の実行と法的照会',
}

const DOMAINS: readonly Domain[] = ['A', 'B', 'C', 'D']

/** 実装済みルールの宣言。今回の基盤 PR では空（全 37 件 TODO）。 */
const IMPLEMENTED_RULE_IDS: ReadonlySet<RuleId> = new Set<RuleId>()

export const RULE_REGISTRY: readonly RuleDescriptor[] = Object.freeze(
  DOMAINS.flatMap((domain) =>
    RULE_IDS_BY_DOMAIN[domain].map(
      (ruleId): RuleDescriptor =>
        Object.freeze({
          ruleId,
          domain,
          summary: SUMMARIES[ruleId],
          implementationStatus: IMPLEMENTED_RULE_IDS.has(ruleId) ? 'IMPLEMENTED' : 'TODO',
        }),
    ),
  ),
)

const BY_ID: ReadonlyMap<string, RuleDescriptor> = new Map(
  RULE_REGISTRY.map((rule) => [rule.ruleId, rule]),
)

export function isRuleId(value: unknown): value is RuleId {
  return typeof value === 'string' && BY_ID.has(value)
}

export function getRule(ruleId: RuleId): RuleDescriptor {
  const rule = BY_ID.get(ruleId)
  if (!rule) throw new Error(`未登録の RuleID: ${ruleId}`)
  return rule
}

export function listRulesByDomain(domain: Domain): readonly RuleDescriptor[] {
  return RULE_REGISTRY.filter((rule) => rule.domain === domain)
}

export function listRulesByStatus(status: ImplementationStatus): readonly RuleDescriptor[] {
  return RULE_REGISTRY.filter((rule) => rule.implementationStatus === status)
}

/** TODO ルールは物語イベントを生成してはならない。 */
export function mayEmitNarrativeEvents(ruleId: RuleId): boolean {
  return getRule(ruleId).implementationStatus === 'IMPLEMENTED'
}
