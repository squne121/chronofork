// CALIBRATION_ONLY: 技術検証用の評価器 fixture。実ルールではなく、Registry（全 37 件 TODO）は変更しない。
import type {
  DecisionTraceDraft,
  DomainCommand,
  Phase,
  RuleId,
  RuleOutcome,
  WorldState,
} from '../../../../src/simulation/contracts/index.ts'
import type { EvaluationContext, RuleEvaluator } from '../../../../src/simulation/engine/index.ts'
import { RULE_REGISTRY } from '../../../../src/simulation/rule-registry.ts'
import { createExperimentalWorld } from '../../../../src/scenario/experimental/index.ts'

export const GROUP = 'group-west-commons'
export const newWorld = (): WorldState => createExperimentalWorld()

export const draft = (ctx: EvaluationContext, status: DecisionTraceDraft['status'] = 'ACCEPT', reason = 'CALIBRATION_ONLY'): DecisionTraceDraft => ({
  year: ctx.year,
  phase: ctx.phase,
  ruleId: ctx.ruleId,
  actorRef: { kind: 'GROUP', id: GROUP },
  candidates: [{ candidateId: 'c1', eligible: true, inputs: { fixture: true }, reasonCodes: [reason] }],
  selectedCandidateId: status === 'ACCEPT' ? 'c1' : undefined,
  status,
  reasonCodes: [reason],
  modifierIds: [],
  ruleVersion: 'calibration-only-fixture',
}) as DecisionTraceDraft

export const cohortCommand = (ctx: EvaluationContext, births: number, deaths: number, groupId = GROUP): DomainCommand => ({
  type: 'POPULATION_COHORT',
  commandId: `cmd:${ctx.year}:${ctx.ruleId}:cohort:${groupId}`,
  source: {
    requestId: `req:${ctx.year}:${ctx.ruleId}:cohort:${groupId}`,
    year: ctx.year,
    phase: ctx.phase,
    sourceRuleId: ctx.ruleId,
    sourceTraceId: ctx.traceId(0),
  },
  groupId,
  year: ctx.year,
  birthSlots: births,
  deathSlots: deaths,
})

export const outcomeOf = (ctx: EvaluationContext, p: Partial<RuleOutcome> = {}): RuleOutcome => ({
  ruleId: ctx.ruleId, phase: ctx.phase, commands: [], requests: [], deferred: [], traceDrafts: [], ...p,
})

/** 毎年 出生 20 / 自然死 16（+4 人）を確定する C-004 相当（CALIBRATION_ONLY）。 */
export const cohortEvaluator: RuleEvaluator = (_w, ctx) =>
  outcomeOf(ctx, { commands: [cohortCommand(ctx, 20, 16)], traceDrafts: [draft(ctx)] })

/** 乱数で出生数を決める fixture。同 seed で同値・別 seed で別値になることを検証する。 */
export const randomCohortEvaluator: RuleEvaluator = (_w, ctx) => {
  const v = ctx.random({ stream: 'EXOGENOUS', targetId: GROUP, eventKey: 'births' })
  const births = 10 + Math.floor(v * 40)
  return outcomeOf(ctx, { commands: [cohortCommand(ctx, births, 5)], traceDrafts: [draft(ctx)] })
}

/** 状態を変えない判断だけを記録する fixture。 */
export const judgmentOnlyEvaluator: RuleEvaluator = (_w, ctx) =>
  outcomeOf(ctx, { traceDrafts: [draft(ctx, 'REJECT', 'NO_ELIGIBLE_CANDIDATE')] })

export type Call = Readonly<{ year: number; phase: Phase; ruleId: RuleId }>

/** 全 37 RuleID に何もしない記録用評価器を注入する（呼出順の検証用）。 */
export function recordingEvaluators(calls: Call[]): Record<RuleId, RuleEvaluator> {
  return Object.fromEntries(
    RULE_REGISTRY.map((r) => [r.ruleId, ((_w, ctx) => {
      calls.push({ year: ctx.year, phase: ctx.phase, ruleId: ctx.ruleId })
      return outcomeOf(ctx)
    }) as RuleEvaluator]),
  ) as Record<RuleId, RuleEvaluator>
}
