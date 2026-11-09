// 分岐履歴の公開型。親の TimelineResult を書き換えず、前史 prefix（継承）と実再計算 suffix の出典区分を保持する。
// goal / coverage / autonomousHistory は意図的に持たない（prefix+suffix から合成・偽造しない）。
import type { DecisionTrace, EventLogEntry, Id, StatModifier, WorldState, Year } from '../contracts/index.ts'
import type { EvaluatorMap, RuleCoverage, RunHalt, YearProgress } from '../engine/index.ts'
import type { StatModifierIssue } from '../contracts/index.ts'
import type { StatModifierLedger } from '../intervention/index.ts'

/** 年ごとの出典。ROOT は runTimeline の結果そのもの（分岐ではない）。 */
export type YearSource = 'ROOT' | 'INHERITED_PREFIX' | 'FORK_POINT' | 'RECOMPUTED'

export type RecomputeSummary = Readonly<{
  /** 再計算を開始した年初（= forkYear）。 */
  fromYear: Year
  status: 'COMPLETED' | 'HALTED'
  /** suffix で実際に確定した遷移数。 */
  transitions: number
  /** suffix 区間だけで実行された RuleID（prefix 分は含まない。全体の coverage ではない）。 */
  suffixCoverage: RuleCoverage
}>

/**
 * 評価器構成の技術メタデータ（出典の確認用。ルールの実装状況を意味しない）。
 * NONE は評価器なし（技術試験）。RULES は ruleIds の評価器で計算した履歴。分岐は親と同じ構成でのみ作れる。
 */
export type EvaluatorProfile = Readonly<{ mode: 'NONE' | 'RULES'; ruleIds: readonly string[] }>

export type Branch = Readonly<{
  branchId: Id
  parentBranchId: Id | null
  /** 祖先を含む branchId の系譜（根 → 自身）。 */
  lineage: readonly Id[]
  /** ROOT は null。 */
  forkYear: Year | null
  seed: number
  rngVersion: string
  startYear: Year
  ledger: StatModifierLedger
  evaluatorProfile: EvaluatorProfile
  /** COMPLETED でも HALTED でもゲーム内の勝敗ではない。HALTED は年次計算の技術的失敗。 */
  status: 'COMPLETED' | 'HALTED'
  halt: RunHalt | null
  /** 確定済みの年初 snapshot のみ（HALTED なら停止直前の年まで）。未計算年は存在しない。 */
  snapshots: readonly WorldState[]
  eventLog: readonly EventLogEntry[]
  decisionTraces: readonly DecisionTrace[]
  /** 正式な勝敗は分岐では評価しない（常に null）。 */
  goal: null
  recompute: RecomputeSummary | null
}>

export type BranchEvaluatorInput = Readonly<{
  branchId: Id
  parentBranchId: Id
  forkYear: Year
  seed: number
  /** 新 branch の台帳（継承分 + 追加分）。B-004 等はここから createPairTrustView を構成する。 */
  ledger: StatModifierLedger
  /** snapshots[forkYear] に実在する人物 ID。 */
  knownPersonIds: ReadonlySet<Id>
}>

/** branch 別評価器の生成関数。未指定なら評価器なし（架空の世界変化を作らない）。 */
export type BranchEvaluatorFactory = (input: BranchEvaluatorInput) => EvaluatorMap

export type ForkInput = Readonly<{
  parent: Branch
  forkYear: Year
  branchId: Id
  /** t 年に追加する modifier（startYear === forkYear、1 件以上）。 */
  modifiers: readonly StatModifier[]
  evaluatorsFor?: BranchEvaluatorFactory
  /** 指定する場合は親と同値でなければならない（矛盾は拒否）。 */
  seed?: number
  /** 観測専用。fork 年から 1350 年までの実再計算で確定した年だけ通知する（結果に影響しない）。 */
  onYearCommitted?: (progress: YearProgress) => void
}>

export type ForkRejectCode =
  | 'INVALID_PARENT'
  | 'EVALUATOR_MISMATCH'
  | 'PARENT_HALTED'
  | 'RNG_VERSION_MISMATCH'
  | 'SEED_MISMATCH'
  | 'INVALID_BRANCH_ID'
  | 'INVALID_FORK_YEAR'
  | 'FORK_YEAR_AT_GOAL'
  | 'FORK_BEFORE_PARENT_FORK'
  | 'UNCOMPUTED_YEAR'
  | 'INVALID_PARENT_LEDGER'
  | 'NO_MODIFIERS'
  | 'MODIFIER_START_MISMATCH'
  | 'MODIFIER_REJECTED'
  | 'DUPLICATE_INTERVENTION'
  | 'EVALUATOR_FACTORY_FAILED'
  | 'RECOMPUTE_FAILED'

export type ForkResult =
  | Readonly<{ ok: true; branch: Branch }>
  | Readonly<{ ok: false; code: ForkRejectCode; message: string; issues: readonly StatModifierIssue[] }>

export type YearRead =
  | Readonly<{
      status: 'COMPUTED'
      year: Year
      source: YearSource
      /** 年初 snapshot。 */
      snapshot: WorldState
      /** year → year+1 の遷移で確定した Event/Trace。遷移が未計算（最終年初・停止年）なら null。 */
      transition: Readonly<{ events: readonly EventLogEntry[]; traces: readonly DecisionTrace[] }> | null
    }>
  | Readonly<{ status: 'UNCOMPUTED'; year: Year; reason: 'OUT_OF_RANGE' | 'NOT_COMPUTED_AFTER_HALT' }>
