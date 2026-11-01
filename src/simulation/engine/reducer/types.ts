// 共通 reducer の公開型。ゲーム規則は持たず、Command の機械的適用・検証結果だけを表す。
import type { Id, JsonValue, WorldState, Year } from '../../contracts/index.ts'
import type { Diagnostic } from '../../validation/index.ts'

export const REJECTION_CODES = [
  // 外枠（Outcome / Source / 権限）
  'TRANSACTION_SCOPE_MISMATCH',
  'INVALID_INPUT_WORLD',
  'UNRESOLVED_CROSS_DOMAIN_REQUEST',
  'REQUEST_ID_CONFLICT',
  'HANDLER_EXCEPTION',
  'UNKNOWN_RULE_ID',
  'PHASE_MISMATCH',
  'YEAR_MISMATCH',
  'SOURCE_RULE_MISMATCH',
  'INVALID_COMMAND',
  'WRITE_OWNER_VIOLATION',
  'PHASE_NOT_ALLOWED',
  // 未実装（契約だけでは安全に適用できない）
  'UNIMPLEMENTED_COMMAND',
  'UNIMPLEMENTED_DEFERRED_EFFECT',
  'UNIMPLEMENTED_SOVEREIGNTY_CHANGE',
  // 冪等性・バッチ
  'COMMAND_ID_CONFLICT',
  'BATCH_CONFLICT',
  'DUPLICATE_COMMAND_ID_IN_OUTCOME',
  // 状態との整合
  'NOT_FOUND',
  'ID_EXISTS',
  'NO_STATE_CHANGE',
  'INTEGRITY_VIOLATION',
  // 人物・人口
  'PERSON_DEAD',
  'ALREADY_DEAD',
  'NO_COHORT_SLOT',
  'COHORT_ALREADY_SET',
  'COHORT_CAPACITY_CONFLICT',
  'LEGAL_DYNASTY_NOT_OWNED_BY_B',
  'CASUALTY_ALREADY_APPLIED',
  'CASUALTY_NOT_BACKED',
  'CASUALTY_INCOMPLETE',
  'CASUALTY_NAMED_EXCEEDS_COUNT',
  // 法制
  'PERSON_ALREADY_MARRIED',
  'LEGAL_DYNASTY_ALREADY_DETERMINED',
  'LEGAL_DYNASTY_EVIDENCE_MISSING',
  'TITLE_INVALID',
  'TITLE_NOT_HEREDITARY',
  'TITLE_HOLDER_ALIVE',
  'LEGAL_BASIS_MISSING',
  'RECOGNITION_EVIDENCE_MISSING',
  'LEGAL_CASE_FINALIZED',
  'RETROACTIVE_MANDATE',
  'MANDATE_EVIDENCE_MISSING',
  'MANDATE_TITLE_NOT_ACTIVE',
  'MANDATE_BENEFICIARY_NOT_HOLDER',
  // 支持
  'SUPPORT_CAUSE_MISSING',
  // ResourceLedger
  'INVALID_AMOUNT',
  'NEGATIVE_BALANCE',
  'COMMITTED_FUNDS_DEBIT',
  'OVER_COMMIT',
  'OVER_RELEASE',
  'RESOURCE_OVERFLOW',
  'FORCE_POOL_DIRECT_EDIT',
  'CASUALTY_ON_CASH',
  'CASUALTY_ID_MISSING',
  'CASUALTY_EXCEEDS_COMMITTED',
] as const

export type RejectionCode = (typeof REJECTION_CODES)[number]

export type Rejection = Readonly<{
  code: RejectionCode
  message: string
  commandId?: Id
  related?: readonly Id[]
  /** INTEGRITY_VIOLATION のときの既存バリデータの診断。 */
  diagnostics?: readonly Diagnostic[]
}>

/** 確定した実状態差分。ログ用の値であり、実行命令としては解釈しない。 */
export type StateChange = Readonly<{
  path: string
  before: JsonValue
  after: JsonValue
}>

export type AppliedCommand = Readonly<{
  commandId: Id
  type: string
  stateChanges: readonly StateChange[]
}>

/** 戦死（損耗）の 1 回限りの確定記録。台帳（CASUALTY）→ 人口 → 人物死亡の整合に使う。 */
export type CasualtyRecord = Readonly<{
  casualtyId: Id
  groupId: Id
  ledgerAccountId: Id
  amount: number
  populationCount?: number
  namedPersonIds: readonly Id[]
  deadNamedPersonIds: readonly Id[]
}>

/**
 * 冪等性判定の状態。枝・年度ごとのトランザクションで、別枝・別年度とは共有しない。
 * 不変データ: 適用成功時のみ新しいインスタンスが ApplyResult で返る。
 */
export type CommandTransaction = Readonly<{
  branchId: Id
  year: Year
  /** commandId → 内容の正規化指紋（適用済みのみ）。 */
  commands: ReadonlyMap<Id, string>
  /** requestId → 適用済みの意味内容（commandId・batchId を除く正規化指紋）→ 適用した commandId。 */
  requests: ReadonlyMap<Id, ReadonlyMap<string, Id>>
  /** batchId → 所属 commandId 列の指紋。 */
  batches: ReadonlyMap<Id, string>
  casualties: ReadonlyMap<Id, CasualtyRecord>
}>

export type ApplyContext = Readonly<{ transaction: CommandTransaction }>

export type UnitStatus = 'APPLIED' | 'REJECTED' | 'DUPLICATE' | 'CONFLICT'

/** バッチ（または batchId 無しの単一 command）ごとの結果。部分適用は無い。 */
export type UnitResult = Readonly<{
  batchId?: Id
  commandIds: readonly Id[]
  status: UnitStatus
  rejections: readonly Rejection[]
}>

export type ApplyStatus = 'APPLIED' | 'PARTIAL' | 'REJECTED' | 'DUPLICATE' | 'CONFLICT' | 'NO_OP'

export type ApplyResult = Readonly<{
  status: ApplyStatus
  /** 何も適用されなかった場合は入力と同一参照。入力は決して変更しない。 */
  world: WorldState
  transaction: CommandTransaction
  units: readonly UnitResult[]
  /** 外枠での拒否（Outcome 全体）。 */
  rejections: readonly Rejection[]
  /** 確定した command ごとの実状態差分のみ。拒否・TODO ルールから EventLog は作らない。 */
  applied: readonly AppliedCommand[]
  /** reducer が扱わず呼出側へ残る件数（明示。成功扱いで消さない）。 */
  unhandled: Readonly<{ requests: number; traceDrafts: number }>
}>
