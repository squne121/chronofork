// 既定の評価器テーブル。実ルール（Issue #17 以降）は、ここへの登録と Registry の IMPLEMENTED 化を同時に行う。
// 現在は空（全 37 RuleID が TODO）。TODO のルールから Command / EventLog / DecisionTrace を作らない。
import type { Id, Phase, RuleId, RuleOutcome, WorldState, Year } from '../contracts/index.ts'
import type { RandomStream } from '../random.ts'

export type EvaluationContext = Readonly<{
  year: Year
  phase: Phase
  ruleId: RuleId
  seed: number
  /** 枝の識別子。ID・乱数キーには使わない（外生乱数は枝間で同値）。 */
  branchId: Id
  /** traceDrafts[draftIndex] に対応する traceId。Command/Request の source.sourceTraceId に使う。 */
  traceId: (draftIndex: number) => Id
  /** drawRandom(seed, …) の year/phase/ruleId 補完版。状態スコアや走査順をキーに混ぜない。 */
  random: (key: Readonly<{ stream: RandomStream; actorId?: Id; targetId?: Id; eventKey?: string }>) => number
}>

/** 読み取り専用の年初相当 WorldState（深く凍結された複製）から RuleOutcome を返す純粋関数。 */
export type RuleEvaluator = (world: WorldState, context: EvaluationContext) => RuleOutcome

export type EvaluatorMap = Readonly<Partial<Record<RuleId, RuleEvaluator>>>

export const DEFAULT_EVALUATORS: EvaluatorMap = Object.freeze({})

/** 評価器が返せる診断（ルール固有コードをそのまま運ぶ。ランナーは意味を解釈しない）。 */
export type EvaluatorDiagnostic = Readonly<{ code: string; message: string; groupId?: Id }>

/**
 * 評価器が「評価不能」を明示して年次進行を止めるための例外。空の Outcome を返すと reducer が NO_OP として
 * 通過させ、黙って翌年へ進んでしまうため、評価不能は必ずこれで表現する（runYear が EVALUATION_FAILED で停止）。
 */
export class EvaluationFailure extends Error {
  readonly diagnostics: readonly EvaluatorDiagnostic[]
  constructor(message: string, diagnostics: readonly EvaluatorDiagnostic[]) {
    super(message)
    this.name = 'EvaluationFailure'
    this.diagnostics = diagnostics
  }
}
