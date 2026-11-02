// A-DYN-02: B-002が確定した出生だけを、既存婚姻契約の明示条項に従って法的王朝へ所属させる。
// GAME-01は未承認。父系・母系の既定帰属や契約条項の自動生成はしない。
// CALIBRATION_ONLY試験用評価器。出生PersonはBが必ずUNDETERMINEDで登録し、Aのみが合法的に確定する。
import type { DecisionTraceDraft, Id, LegalDynastySetCommand, RuleOutcome, WorldState } from '../../contracts/index.ts'
import type { EvaluationContext, RuleEvaluator } from '../../engine/evaluators.ts'
import { EvaluationFailure } from '../../engine/evaluators.ts'
import { normalizePersonPair } from '../../intervention/index.ts'

export const ADYN02_RULE_VERSION = 'adyn02-explicit-marriage-clause-0:CALIBRATION_ONLY'

export const createADyn02EvidenceEvaluator = (): RuleEvaluator => (world: WorldState, ctx: EvaluationContext): RuleOutcome => {
  if (ctx.ruleId !== 'A-DYN-02' || ctx.phase !== 3 || ctx.year !== world.year) {
    throw new EvaluationFailure('A-DYN-02のRuleID・フェーズ・年が一致しません', [{ code: 'RULE_MISMATCH', message: 'A-DYN-02はフェーズ3でのみ実行' }])
  }
  // Bの確定済み出生Eventを持つ当年Traceのみが対象。Bの候補だけでは王朝を付けない。
  const birthTraces = (ctx.priorTraces ?? [])
    .filter((t) => t.year === ctx.year && t.ruleId === 'B-002' && t.status === 'ACCEPT' && t.eventIds.length > 0)
    .sort((a, b) => a.traceId < b.traceId ? -1 : a.traceId > b.traceId ? 1 : 0)
  const traceDrafts: DecisionTraceDraft[] = []
  const commands: LegalDynastySetCommand[] = []
  const seen = new Set<Id>()
  for (const t of birthTraces) {
    const childId = t.candidates[0]?.inputs.childPersonId
    if (typeof childId !== 'string' || childId.length === 0 || t.actorRef.kind !== 'PERSON' ||
        t.actorRef.id !== childId || seen.has(childId)) {
      throw new EvaluationFailure('出生Traceの人物ID・根拠が一致しません', [{ code: 'INVALID_BIRTH_TRACE', message: t.traceId }])
    }
    seen.add(childId)
    const child = world.persons.find((p) => p.personId === childId)
    if (!child || !child.alive || child.birthYear !== ctx.year || child.legalDynasty.status !== 'UNDETERMINED') {
      throw new EvaluationFailure('出生Traceに対応する未確定の新生児がありません', [{ code: 'BIRTH_NOT_CONFIRMED', message: childId }])
    }
    const pair = child.fatherId !== undefined && child.motherId !== undefined
      ? normalizePersonPair(child.fatherId, child.motherId) : null
    const marriage = pair === null ? undefined : world.legal.marriages.find((m) =>
      m.status === 'ACTIVE' && m.registeredYear <= ctx.year &&
      m.personIds[0] === pair[0] && m.personIds[1] === pair[1])
    const contract = marriage?.contract
    const clauses = contract?.clauses.filter((cl) => cl.kind === 'CHILD_LEGAL_DYNASTY') ?? []
    let reason = 'EXPLICIT_CHILD_DYNASTY_CLAUSE_CONFIRMED'
    const clause = clauses.length === 1 ? clauses[0] : undefined
    if (pair === null || marriage === undefined) reason = 'NO_VALID_PARENTAL_MARRIAGE'
    else if (!contract || !contract.evidenceId || !contract.contractId) reason = 'MARRIAGE_CONTRACT_EVIDENCE_MISSING'
    else if (clauses.length === 0) reason = 'GAME_01_DYNASTY_CLAUSE_MISSING'
    else if (!clause || !clause.clauseId) reason = 'AMBIGUOUS_DYNASTY_CLAUSES'
    else if (!world.legal.dynasties.some((d) => d.dynastyId === clause.dynastyId)) reason = 'CLAUSE_DYNASTY_UNKNOWN'
    const accepted = reason === 'EXPLICIT_CHILD_DYNASTY_CLAUSE_CONFIRMED'
    const index = traceDrafts.length
    traceDrafts.push({
      year: ctx.year, phase: ctx.phase, ruleId: ctx.ruleId,
      actorRef: { kind: 'PERSON', id: childId },
      candidates: [{
        candidateId: 'adyn02:' + JSON.stringify([ctx.year, childId, clause?.clauseId ?? 'unresolved']),
        eligible: accepted,
        inputs: { childPersonId: childId, sourceB002TraceId: t.traceId,
          sourceBirthEventIds: [...t.eventIds], marriageId: marriage?.marriageId ?? null,
          contractId: contract?.contractId ?? null, contractEvidenceId: contract?.evidenceId ?? null,
          dynastyId: clause?.dynastyId ?? null, clauseId: clause?.clauseId ?? null,
          provenance: 'CALIBRATION_ONLY' },
        reasonCodes: ['CALIBRATION_ONLY', reason],
      }],
      ...(accepted ? { selectedCandidateId: 'adyn02:' + JSON.stringify([ctx.year, childId, clause!.clauseId]) } : {}),
      status: accepted ? 'ACCEPT' : 'DEFER',
      reasonCodes: ['CALIBRATION_ONLY', 'GAME_01_EXPLICIT_CLAUSE_ONLY', reason],
      modifierIds: [],
      ruleVersion: ADYN02_RULE_VERSION,
    })
    if (!accepted || !clause || !contract) continue
    commands.push({
      type: 'LEGAL_DYNASTY_SET',
      commandId: 'cmd:adyn02:' + JSON.stringify([ctx.year, childId, clause.clauseId]),
      source: { requestId: 'req:adyn02:' + JSON.stringify([ctx.year, childId, contract.evidenceId]),
        year: ctx.year, phase: ctx.phase, sourceRuleId: 'A-DYN-02',
        sourceTraceId: ctx.traceId(index), sourceIntentId: t.traceId },
      personId: childId,
      legalDynasty: { status: 'DETERMINED', dynastyId: clause.dynastyId },
    })
  }
  return { ruleId: ctx.ruleId, phase: ctx.phase, commands, requests: [], deferred: [], traceDrafts }
}
