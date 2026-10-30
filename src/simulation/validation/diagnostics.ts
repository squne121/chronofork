import type { Id, WorldState } from '../contracts/index.ts'

export type DiagnosticSeverity = 'ERROR' | 'WARNING'

export type DiagnosticCode =
  // 構造
  | 'INVALID_TYPE'
  | 'MISSING_FIELD'
  | 'UNKNOWN_FIELD'
  | 'INVALID_ENUM'
  | 'DERIVED_FIELD_STORED'
  // 数値
  | 'NOT_NON_NEGATIVE_INTEGER'
  | 'OUT_OF_RANGE'
  | 'INVALID_PERIOD'
  // 参照・ID
  | 'DUPLICATE_ID'
  | 'DANGLING_REF'
  | 'WRONG_REF_KIND'
  | 'UNKNOWN_RULE_ID'
  | 'SELF_REFERENCE'
  | 'PERSON_PAIR_NOT_NORMALIZED'
  | 'ADJACENCY_ASYMMETRIC'
  // 人物
  | 'PARENT_CYCLE'
  | 'PARENT_BIRTH_YEAR_CONTRADICTION'
  | 'DEATH_BEFORE_BIRTH'
  | 'ALIVE_STATE_CONTRADICTION'
  | 'BIRTH_OR_DEATH_IN_FUTURE'
  // 人口・支持・資源
  | 'COHORT_CAPACITY_CONFLICT'
  | 'COHORT_SLOT_EXCEEDED'
  | 'SUPPORT_BPS_SUM_MISMATCH'
  | 'RESOURCE_INVALID_QUANTITY'
  | 'RESOURCE_OVER_COMMITTED'
  // 法制・税権
  | 'DUPLICATE_EXCLUSIVE_TITLE'
  | 'RECOGNITION_EVIDENCE_MISSING'
  | 'MANDATE_TITLE_REGION_MISMATCH'
  | 'TAX_AUTHORITY_CONFLICT'
  | 'UNRESOLVED_TAX_AUTHORITY' // 診断のみ（GAME-04）
  // 初期シナリオ規模
  | 'INITIAL_SCALE_MISMATCH'
  // TuningConfig
  | 'TUNING_NOT_CALIBRATION_ONLY'

export type DiagnosticTarget = Readonly<{ kind: string; id: Id }>

export type Diagnostic = Readonly<{
  code: DiagnosticCode
  severity: DiagnosticSeverity
  /** 入力内の位置（例: `persons[2].fatherId`）。 */
  path: string
  /** 原因となったエンティティ（特定できる場合）。 */
  target: DiagnosticTarget | null
  message: string
  /** 関連する ID（衝突相手など）。 */
  related: readonly Id[]
}>

export type ValidationResult = Readonly<{
  /** ERROR が 1 件も無いとき true。WARNING は受理を妨げない。 */
  ok: boolean
  /** ok のときのみ、検証済みの複製。入力そのものは返さず、変更もしない。 */
  world: WorldState | null
  diagnostics: readonly Diagnostic[]
}>

export function hasErrors(diagnostics: readonly Diagnostic[]): boolean {
  return diagnostics.some((d) => d.severity === 'ERROR')
}
