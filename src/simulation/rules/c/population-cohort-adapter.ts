// RULE-C-004 人口コホート評価器 → 年次ランナー（EvaluationContext）への CALIBRATION_ONLY アダプタ。
// 実装済みなのは人口コホート部分のみ（生活充足・繁栄は未実装）。RuleRegistry は TODO のまま変更せず、
// 呼出側が RunOptions.evaluators に明示注入した場合にだけ実行される。係数は採用済みゲーム法則ではない。
import type { DecisionTraceDraft, DomainCommand, RuleOutcome, WorldState } from '../../contracts/index.ts'
import { EvaluationFailure } from '../../engine/evaluators.ts'
import type { EvaluationContext, EvaluatorMap, RuleEvaluator } from '../../engine/evaluators.ts'
import type { TuningConfig } from '../../tuning.ts'
import { evaluatePopulationCohorts, POPULATION_COHORT_RULE_ID } from './population-cohort.ts'

export const COHORT_CALIBRATION_REASON = 'CALIBRATION_ONLY'
export const COHORT_PARTIAL_REASON = 'POPULATION_COHORT_ONLY'

/**
 * CohortEvaluation.ok=false は EvaluationFailure（→ runYear が EVALUATION_FAILED で停止）にする。
 * 空 Outcome を返すと NO_OP として通過してしまうため禁止。
 * ok=true では Group 安定順 i に対し traceDrafts[i] と commands[i].source.sourceTraceId=ctx.traceId(i) を対応させる。
 */
export function createPopulationCohortCalibrationEvaluator(tuning: TuningConfig): RuleEvaluator {
  return (world: WorldState, ctx: EvaluationContext): RuleOutcome => {
    const ev = evaluatePopulationCohorts(world, tuning)
    if (!ev.ok || ev.diagnostics.length > 0) {
      throw new EvaluationFailure(
        `人口コホート評価が成立しません（${ev.diagnostics.map((d) => d.code).join(',') || 'UNKNOWN'}）`,
        ev.diagnostics.length > 0 ? ev.diagnostics : [{ code: 'UNKNOWN', message: 'ok=false だが診断がありません' }],
      )
    }
    if (ev.allocations.length !== ev.outcome.commands.length) {
      throw new EvaluationFailure('allocations と commands の件数が一致しません', [{ code: 'ALLOCATION_MISMATCH', message: `${ev.allocations.length} != ${ev.outcome.commands.length}` }])
    }
    const traceDrafts: DecisionTraceDraft[] = []
    const commands: DomainCommand[] = []
    ev.outcome.commands.forEach((c, i) => {
      const a = ev.allocations[i]
      if (!a || c.type !== 'POPULATION_COHORT' || c.groupId !== a.groupId) {
        throw new EvaluationFailure('allocations と commands の Group 順が一致しません', [{ code: 'ALLOCATION_MISMATCH', message: `index ${i}` }])
      }
      traceDrafts.push({
        year: ctx.year,
        phase: ctx.phase,
        ruleId: ctx.ruleId,
        actorRef: { kind: 'GROUP', id: a.groupId },
        candidates: [{
          candidateId: `cohort:${a.groupId}`,
          eligible: true,
          inputs: {
            population: a.population,
            delta: a.delta,
            birthSlots: a.birthSlots,
            deathSlots: a.deathSlots,
            birthRatePermille: tuning.birthRatePermille.value,
            growthRatePermille: tuning.growthRatePermille.value,
          },
          reasonCodes: [COHORT_CALIBRATION_REASON],
        }],
        selectedCandidateId: `cohort:${a.groupId}`,
        status: 'ACCEPT',
        reasonCodes: [COHORT_CALIBRATION_REASON, COHORT_PARTIAL_REASON],
        modifierIds: [],
        ruleVersion: `${tuning.rulesetVersion}:${POPULATION_COHORT_RULE_ID}:population-cohort:${COHORT_CALIBRATION_REASON}`,
      })
      commands.push({ ...c, source: { ...c.source, sourceTraceId: ctx.traceId(i) } })
    })
    return { ...ev.outcome, ruleId: ctx.ruleId, phase: ctx.phase, commands, traceDrafts }
  }
}

/** RunOptions.evaluators に渡す CALIBRATION_ONLY の注入表。Registry の状態は変えない。 */
export const createCalibrationEvaluators = (tuning: TuningConfig): EvaluatorMap => ({
  [POPULATION_COHORT_RULE_ID]: createPopulationCohortCalibrationEvaluator(tuning),
})
