// 分岐履歴の公開境界。B-004 統合は ForkInput.evaluatorsFor（BranchEvaluatorFactory）経由で EvaluatorMap を注入する。
export { createRootBranch, forkHistory } from './fork.ts'
export { computedYears, diffBranchesAtYear, readYear, yearSourceOf } from './reader.ts'
export type { YearDiff } from './reader.ts'
export type {
  Branch,
  BranchEvaluatorFactory,
  BranchEvaluatorInput,
  EvaluatorProfile,
  ForkInput,
  ForkRejectCode,
  ForkResult,
  RecomputeSummary,
  YearRead,
  YearSource,
} from './types.ts'
