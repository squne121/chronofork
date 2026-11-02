// B-005の最小技術版。実B-004の当年Traceを参照して交渉意思を記録し、Aへの照会だけを発行する。
// CALIBRATION_ONLY: 信頼の閾値は正式な婚姻法でも婚姻成立条件でもない。
import type { CrossDomainRequest, DecisionTrace, DecisionTraceDraft, Id, RuleOutcome, WorldState } from '../../contracts/index.ts'
import type { EvaluationContext, RuleEvaluator } from '../../engine/evaluators.ts'
import { EvaluationFailure } from '../../engine/evaluators.ts'
import { normalizePersonPair, pairKey } from '../../intervention/index.ts'
import { B004_CALIBRATION_REASON, B004_ELIGIBILITY_UNREVIEWED_REASON } from './b004-candidate.ts'

export const B005_RULE_VERSION = 'b005-calibration-0:trace-to-marriage-query:CALIBRATION_ONLY'

type MarriageQuery = Extract<CrossDomainRequest, { kind: 'LEGAL_MARRIAGE_QUERY' }>
const pairFromTrace = (t: DecisionTrace): readonly [Id, Id] | null =>
  t.actorRef.kind === 'PERSON_PAIR' ? normalizePersonPair(t.actorRef.ids[0], t.actorRef.ids[1]) : null

/** 縁談候補の同年B-004判断を読み取り、交渉合意（試験）だけを示す。法的登録はAだけが実行する。 */
export const createB005CalibrationEvaluator = (): RuleEvaluator => (world: WorldState, ctx: EvaluationContext): RuleOutcome => {
  if (ctx.ruleId !== 'B-005' || ctx.phase !== 3 || ctx.year !== world.year) {
    throw new EvaluationFailure('B-005のRuleID・フェーズ・年度が一致しません', [{ code: 'RULE_MISMATCH', message: 'B-005はフェーズ3でのみ実行します' }])
  }
  const records = (ctx.priorTraces ?? []).filter((t) => t.year === ctx.year && t.ruleId === 'B-004')
  const seen = new Set<string>()
  const sorted = records.map((t) => ({ trace: t, pair: pairFromTrace(t) }))
    .sort((a, b) => pairKey(a.pair ?? ['', '']) < pairKey(b.pair ?? ['', '']) ? -1 : 1)
  const traceDrafts: DecisionTraceDraft[] = []
  const requests: MarriageQuery[] = []

  for (const { trace, pair } of sorted) {
    if (pair === null) throw new EvaluationFailure('B-004の人物ペア参照が不正です', [{ code: 'INVALID_B004_PAIR', message: trace.traceId }])
    const key = pairKey(pair)
    if (seen.has(key)) throw new EvaluationFailure('B-004で同じ人物ペアが重複しています', [{ code: 'DUPLICATE_B004_PAIR', message: key }])
    seen.add(key)
    const persons = pair.map((id) => world.persons.find((p) => p.personId === id))
    const bothAlive = persons.every((p) => p?.alive === true)
    const alreadyMarried = world.legal.marriages.some((m) => m.status === 'ACTIVE' && pair.some((id) => m.personIds.includes(id)))
    const candidate = trace.candidates[0]
    // B-004のACCEPTは技術的な信頼スコア採択のみ。法的適格性は未審査。
    const negotiated = trace.status === 'ACCEPT' &&
      trace.reasonCodes.includes(B004_CALIBRATION_REASON) &&
      trace.reasonCodes.includes(B004_ELIGIBILITY_UNREVIEWED_REASON) &&
      bothAlive && !alreadyMarried
    const reason = !bothAlive ? 'PERSON_UNAVAILABLE' : alreadyMarried ? 'ACTIVE_MARRIAGE_EXISTS' :
      negotiated ? 'NEGOTIATION_INTENT_CALIBRATION_ONLY' : 'B004_CANDIDATE_NOT_ACCEPTED'
    const requestId = 'marriage-query:' + ctx.year + ':' + key
    const draftIndex = traceDrafts.length
    traceDrafts.push({
      year: ctx.year, phase: ctx.phase, ruleId: ctx.ruleId,
      actorRef: { kind: 'PERSON_PAIR', ids: pair },
      candidates: [{
        candidateId: 'b005:' + key,
        eligible: negotiated,
        inputs: {
          sourceB004TraceId: trace.traceId,
          sourceB004Status: trace.status,
          sourceB004Score: candidate?.score ?? null,
          sourceRequestId: negotiated ? requestId : null,
          marriageEligibilityReviewed: false,
        },
        reasonCodes: ['CALIBRATION_ONLY', reason],
      }],
      ...(negotiated ? { selectedCandidateId: 'b005:' + key } : {}),
      status: negotiated ? 'ACCEPT' : 'DEFER',
      reasonCodes: ['CALIBRATION_ONLY', 'LEGAL_APPROVAL_REQUIRED', reason],
      modifierIds: [...trace.modifierIds],
      ruleVersion: B005_RULE_VERSION,
    })
    if (!negotiated) continue
    requests.push({
      kind: 'LEGAL_MARRIAGE_QUERY',
      targetDomain: 'A', requiredResponseYear: ctx.year,
      source: {
        requestId,
        year: ctx.year, phase: ctx.phase, sourceRuleId: 'B-005',
        sourceTraceId: ctx.traceId(draftIndex),
        sourceIntentId: trace.traceId,
      },
      payload: { kind: 'LEGAL_MARRIAGE_QUERY', personIds: pair },
    })
  }
  return { ruleId: ctx.ruleId, phase: ctx.phase, commands: [], requests, deferred: [], traceDrafts }
}
