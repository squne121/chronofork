// 年次ランナーの公開結果。UI へ渡す読み取り境界。既存の正本型（WorldState / GoalEvaluation /
// EventLogEntry / DecisionTrace）をそのまま再利用し、実行状態と診断だけをここで足す。
import type {
  DecisionTrace,
  EventLogEntry,
  Id,
  Phase,
  RuleId,
  WorldState,
  Year,
} from '../contracts/index.ts'
import type { GoalEvaluation } from '../goal.ts'
import type { Diagnostic } from '../validation/index.ts'
import type { EvaluatorDiagnostic, EvaluatorMap } from './evaluators.ts'
import type { Rejection } from './reducer/index.ts'

export type RunOptions = Readonly<{
  seed: number
  /** 既定 'main'。ID・乱数には使われない。 */
  branchId?: Id
  /**
   * 既定の評価器テーブルに上書きマージする評価器。TODO ルールへの注入は技術検証用
   * （テスト内の CALIBRATION_ONLY fixture 限定）で、Registry の状態は変えない。
   */
  evaluators?: EvaluatorMap
}>

export type HaltCode =
  | 'INVALID_INPUT_WORLD'
  | 'YEAR_OUT_OF_RANGE'
  | 'IMPLEMENTED_RULE_WITHOUT_EVALUATOR'
  | 'EVALUATOR_EXCEPTION'
  | 'EVALUATION_FAILED'
  | 'INVALID_OUTCOME'
  | 'UNRESOLVED_CROSS_DOMAIN_REQUEST'
  | 'OUTCOME_REJECTED'
  | 'DUPLICATE_ID'
  | 'YEAR_VALIDATION_ERROR'
  | 'BOUNDARY_INCOMPLETE'

/** 停止。データ・技術的失敗であり、ゲーム内の敗北ではない。失敗した年の状態は確定しない。 */
export type RunHalt = Readonly<{
  code: HaltCode
  year: Year
  phase: Phase | null
  ruleId: RuleId | null
  message: string
  rejections: readonly Rejection[]
  diagnostics: readonly Diagnostic[]
  /** 評価器が明示した評価不能の診断（EVALUATION_FAILED のとき）。それ以外は空。 */
  evaluatorDiagnostics: readonly EvaluatorDiagnostic[]
  /** 失敗した Outcome の判断記録（診断用）。確定した履歴には含まれず、Event は作られない。 */
  traces: readonly DecisionTrace[]
}>

export type RuleCoverage = Readonly<{
  implementedRuleIds: readonly RuleId[]
  todoRuleIds: readonly RuleId[]
  /** 実際に評価器が呼ばれた RuleID（重複なし・Registry 順）。 */
  executedRuleIds: readonly RuleId[]
  /** TODO なのにテスト等の注入評価器で実行された RuleID。実ルールの実装を意味しない。 */
  injectedTodoRuleIds: readonly RuleId[]
}>

export type YearRunResult =
  | Readonly<{
      status: 'COMPLETED'
      year: Year
      /** t+1 年初の WorldState。 */
      world: WorldState
      events: readonly EventLogEntry[]
      traces: readonly DecisionTrace[]
      executedRuleIds: readonly RuleId[]
    }>
  | Readonly<{
      status: 'HALTED'
      year: Year
      /** 入力と同一内容（失敗した年の部分状態は確定しない）。 */
      world: WorldState
      halt: RunHalt
      executedRuleIds: readonly RuleId[]
    }>

/**
 * 自律歴史が成立したか。全 37 RuleID が IMPLEMENTED かつ実行され、停止せず 1350 年まで完走したときのみ
 * ESTABLISHED。それ以外は blockers を示す。技術的に 100 年進んだことは成立を意味しない。
 */
export type AutonomousHistory = Readonly<{
  status: 'NOT_ESTABLISHED' | 'ESTABLISHED'
  blockers: readonly string[]
}>

export type TimelineResult = Readonly<{
  status: 'COMPLETED' | 'HALTED'
  seed: number
  branchId: Id
  rngVersion: string
  startYear: Year
  /** 年初 snapshot（1250 開始なら完走で 101 件、停止時は確定済みの年まで）。 */
  snapshots: readonly WorldState[]
  transitions: number
  eventLog: readonly EventLogEntry[]
  decisionTraces: readonly DecisionTrace[]
  /**
   * 権威ある 1350 年の勝敗。自律歴史が ESTABLISHED（全 37 件 IMPLEMENTED・実行・完走）で、goal オプションが
   * あるときのみ。それ以外は null（UI は勝敗を捏造しない）。
   */
  goal: GoalEvaluation | null
  /** 技術検証専用の非権威な評価（technicalGoalEvaluation: true かつ未成立のとき）。勝敗として表示しない。 */
  technicalGoal: GoalEvaluation | null
  halt: RunHalt | null
  coverage: RuleCoverage
  autonomousHistory: AutonomousHistory
}>
