// 書込 owner・RuleID・Source・Phase の検証（契約 §2.1 / §6）。
// owner の正本は COMMAND_WRITE_OWNER。ここでは「その owner を発行できる領域」と許可フェーズを加える。
import type { Domain, DomainCommand, Phase, RuleOutcome, WorldState, WriteOwner } from '../../contracts/index.ts'
import { COMMAND_WRITE_OWNER } from '../../contracts/index.ts'
import { getRule, isRuleId } from '../../rule-registry.ts'
import type { Rejection } from './types.ts'

/** 確定責務ごとに command を発行できる領域。確定そのものは常に共通 reducer が行う。 */
const OWNER_ISSUERS: Readonly<Record<WriteOwner, readonly Domain[]>> = {
  A_LEGAL: ['A'],
  B_PERSON: ['B'],
  D_MILITARY_DIPLOMACY: ['D'],
  COMMON_DEATH_REDUCER: ['B', 'D'], // 自然死は B、戦死は D（下で cause ごとに絞る）
  COMMON_POPULATION_REDUCER: ['C', 'D'], // 会計は C、損耗通知は D
  RESOURCE_LEDGER_REDUCER: ['C', 'D'],
}

type Allowance = Readonly<{ domain: Domain; phases: readonly Phase[] }>

const LEGAL_PHASES: readonly Phase[] = [4, 6]
const MIL_PHASES: readonly Phase[] = [5, 6]

/** 領域×フェーズの許可表（契約 §6 の年次境界）。 */
function allowances(c: DomainCommand): readonly Allowance[] {
  switch (c.type) {
    case 'MARRIAGE_REGISTER':
    case 'MARRIAGE_DISSOLVE':
      return [{ domain: 'A', phases: [3] }]
    case 'LEGAL_DYNASTY_SET':
      return [{ domain: 'A', phases: [3, 4] }]
    case 'LEGAL_TITLE_TRANSFER':
    case 'TITLE_RECOGNITION_SET':
    case 'LEGAL_CASE_SET':
    case 'COUNTRY_RULER_SET':
    case 'CONTROL_MANDATE_SET':
    case 'TAX_MANDATE_SET':
      return [{ domain: 'A', phases: LEGAL_PHASES }]
    case 'PERSON_PAIR_TRUST_SET':
      return [{ domain: 'B', phases: [3] }]
    case 'PERSON_BIRTH':
    case 'PERSON_PROMOTE':
    case 'PERSON_SUPPORTING_RECORD':
      return [{ domain: 'B', phases: [3] }]
    case 'PERSON_DEATH':
      return c.cause === 'NATURAL'
        ? [{ domain: 'B', phases: [3] }]
        : [{ domain: 'D', phases: MIL_PHASES }]
    case 'POPULATION_COHORT':
      return [{ domain: 'C', phases: [1] }]
    case 'SUPPORT_SET':
      return [{ domain: 'C', phases: [2] }]
    case 'POPULATION_CASUALTY':
    case 'REGION_CONTROL_SET':
      return [{ domain: 'D', phases: MIL_PHASES }]
    case 'RESOURCE_TRANSACTION':
      return c.operation === 'CREDIT' || c.operation === 'DEBIT'
        ? [{ domain: 'C', phases: [1] }, { domain: 'D', phases: MIL_PHASES }]
        : [{ domain: 'D', phases: MIL_PHASES }]
    case 'TREATY_COMMIT':
      return [{ domain: 'D', phases: [6] }]
  }
}

const isNonEmpty = (v: unknown): v is string => typeof v === 'string' && v.length > 0

/** Outcome の外枠（RuleID・Phase・年）。 */
export function checkOutcomeHeader(outcome: RuleOutcome): Rejection | null {
  if (!isRuleId(outcome.ruleId)) {
    return { code: 'UNKNOWN_RULE_ID', message: `未登録の RuleID です: ${String(outcome.ruleId)}` }
  }
  if (!Number.isInteger(outcome.phase) || outcome.phase < 1 || outcome.phase > 7) {
    return { code: 'PHASE_MISMATCH', message: `Phase は 1..7 の整数です: ${String(outcome.phase)}` }
  }
  return null
}

/** command 単体の静的検証（状態を読まない）: Source・RuleID・owner・Phase。 */
export function checkCommandAuthority(
  world: WorldState,
  outcome: RuleOutcome,
  c: DomainCommand,
): Rejection | null {
  const reject = (code: Rejection['code'], message: string): Rejection => ({ code, message, commandId: c.commandId })
  if (!isNonEmpty(c.commandId)) return { code: 'INVALID_COMMAND', message: 'commandId が空です' }
  const s = c.source
  if (!s || !isNonEmpty(s.requestId) || !isNonEmpty(s.sourceTraceId)) {
    return reject('INVALID_COMMAND', 'Source の requestId / sourceTraceId が必要です')
  }
  if (!isRuleId(s.sourceRuleId)) return reject('UNKNOWN_RULE_ID', `未登録の sourceRuleId: ${String(s.sourceRuleId)}`)
  if (s.sourceRuleId !== outcome.ruleId) {
    return reject('SOURCE_RULE_MISMATCH', `sourceRuleId ${s.sourceRuleId} が Outcome の ${outcome.ruleId} と異なります`)
  }
  if (s.year !== world.year) return reject('YEAR_MISMATCH', `Source の年 ${s.year} が WorldState の年 ${world.year} と異なります`)
  if (s.phase !== outcome.phase) return reject('PHASE_MISMATCH', `Source の Phase ${s.phase} が Outcome の ${outcome.phase} と異なります`)

  if (!Object.hasOwn(COMMAND_WRITE_OWNER, c.type)) return reject('INVALID_COMMAND', `未知の command 種別: ${String((c as { type: unknown }).type)}`)
  const owner = COMMAND_WRITE_OWNER[c.type]
  if (c.type === 'COUNTRY_RULER_SET' && s.sourceRuleId !== 'A-TIT-07') {
    return reject('WRITE_OWNER_VIOLATION', '王位に対応する国家統治者更新はA-TIT-07のみ実行できます')
  }
  if (c.type === 'MARRIAGE_DISSOLVE' && s.sourceRuleId !== 'A-LEG-01') {
    return reject('WRITE_OWNER_VIOLATION', '婚姻終了はA-LEG-01のみが確定します')
  }
  if (c.type === 'PERSON_SUPPORTING_RECORD' && s.sourceRuleId !== 'B-001') {
    return reject('WRITE_OWNER_VIOLATION', 'SUPPORTING人物記録はB-001だけが実行できます')
  }
  if (c.type === 'PERSON_PROMOTE' && s.sourceRuleId !== 'B-001') {
    return reject('WRITE_OWNER_VIOLATION', '昇格によるPerson登録はB-001だけが実行できます')
  }
  if (c.type === 'PERSON_PAIR_TRUST_SET' && s.sourceRuleId !== 'B-009') {
    return reject('WRITE_OWNER_VIOLATION', 'PERSON_PAIR_TRUST_SETはB-009以外では発行できません')
  }
  const domain = getRule(s.sourceRuleId).domain
  if (!OWNER_ISSUERS[owner].includes(domain)) {
    return reject('WRITE_OWNER_VIOLATION', `${c.type} の確定責務は ${owner} です。領域 ${domain}（${s.sourceRuleId}）は発行できません`)
  }
  const rows = allowances(c).filter((a) => a.domain === domain)
  if (rows.length === 0) {
    return reject('WRITE_OWNER_VIOLATION', `領域 ${domain} は ${c.type} を発行できません`)
  }
  if (!rows.some((a) => a.phases.includes(s.phase))) {
    return reject('PHASE_NOT_ALLOWED', `${c.type} は Phase ${rows.flatMap((a) => a.phases).join('/')} でのみ発行できます（実際: ${s.phase}）`)
  }
  return null
}
