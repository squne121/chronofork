// A-SUC-04: B-003確定死亡と明示的なSUCCESSION決定証拠を照合してLegalCaseを生成する。
// CALIBRATION_ONLYの技術縦断。相続順位・裁量承認権限はGAME-02未承認で自動推定しない。
// CROWNや存命保持者、相続人不在、GrantBasis不一致はAPPROVEDにせずDEFERする。
import type { ControllerRef, DecisionTraceDraft, Id, LegalCaseSetCommand, RuleOutcome, WorldState, Year } from '../../contracts/index.ts'
import { GOAL_YEAR, START_YEAR } from '../../contracts/index.ts'
import type { EvaluationContext, RuleEvaluator } from '../../engine/evaluators.ts'
import { EvaluationFailure } from '../../engine/evaluators.ts'

export const ASUC04_RULE_VERSION = 'asuc04-explicit-succession-decision-0:CALIBRATION_ONLY'

/** 試験専用の承認意思・証拠。発行者の存在確認は、その者の法的権限の確定ではない。 */
export type SuccessionDecisionEvidence = Readonly<{
  decisionId: Id
  titleId: Id
  predecessorPersonId: Id
  successorPersonId: Id
  decisionYear: Year
  grantBasisId: Id
  issuerRef: ControllerRef
  status: 'APPROVED' | 'PENDING' | 'REJECTED'
  provenance: 'CALIBRATION_ONLY'
}>
export type SuccessionEvidenceIssue = Readonly<{ code: string; path: string }>
const nonempty = (x: unknown): x is string => typeof x === 'string' && x.length > 0
const decisionKey = (e: SuccessionDecisionEvidence) => JSON.stringify([e.decisionYear,e.titleId,e.predecessorPersonId])
const caseIdOf = (e: SuccessionDecisionEvidence) => 'case:asuc04:' + JSON.stringify([e.decisionYear, e.titleId, e.decisionId])

export function createASuc04CalibrationEvaluator(
  evidence: readonly SuccessionDecisionEvidence[],
): Readonly<{ ok: true; evaluator: RuleEvaluator }> | Readonly<{ ok: false; issues: readonly SuccessionEvidenceIssue[] }> {
  if (!Array.isArray(evidence)) return { ok: false, issues: [{ code: 'INVALID_EVIDENCE', path: 'evidence' }] }
  const issues: SuccessionEvidenceIssue[] = []
  const ids = new Set<Id>()
  const slots = new Set<string>()
  evidence.forEach((e, i) => {
    const path = `evidence[${i}]`
    if (!e || ![e.decisionId,e.titleId,e.predecessorPersonId,e.successorPersonId,e.grantBasisId].every(nonempty) ||
        !e.issuerRef || !['PERSON','HOUSE','COUNTRY'].includes(e.issuerRef.kind) || !nonempty(e.issuerRef.id) ||
        e.provenance !== 'CALIBRATION_ONLY' || !['APPROVED','PENDING','REJECTED'].includes(e.status) ||
        !Number.isSafeInteger(e.decisionYear) || e.decisionYear < START_YEAR || e.decisionYear >= GOAL_YEAR) {
      issues.push({ code: 'INVALID_EVIDENCE', path })
      return
    }
    if (ids.has(e.decisionId)) issues.push({ code: 'DUPLICATE_DECISION_ID', path })
    ids.add(e.decisionId)
    const slot = decisionKey(e)
    if (slots.has(slot)) issues.push({ code: 'DUPLICATE_TITLE_YEAR', path })
    slots.add(slot)
  })
  if (issues.length > 0) return { ok: false, issues }
  const decisions = structuredClone(evidence) as SuccessionDecisionEvidence[]

  const evaluator: RuleEvaluator = (world: WorldState, ctx: EvaluationContext): RuleOutcome => {
    if (ctx.ruleId !== 'A-SUC-04' || ctx.phase !== 4 || ctx.year !== world.year) {
      throw new EvaluationFailure('A-SUC-04のRuleID・フェーズ・年が不一致です', [{ code: 'RULE_MISMATCH', message: 'A-SUC-04はフェーズ4で実行' }])
    }
    const deceased = new Map<Id,string>()
    for (const t of ctx.priorTraces ?? []) {
      if (t.year !== ctx.year || t.ruleId !== 'B-003' || t.status !== 'ACCEPT' || t.eventIds.length !== 1 ||
          t.actorRef.kind !== 'PERSON') continue
      const p = world.persons.find(x => x.personId === t.actorRef.id)
      if (p?.alive === false && p.deathYear === ctx.year) deceased.set(p.personId,t.traceId)
    }
    const affected = world.titles.filter((t) => t.holder.status === 'HELD' && deceased.has(t.holder.personId))
      .sort((a,b) => a.titleId < b.titleId ? -1 : a.titleId > b.titleId ? 1 : 0)
    const traceDrafts: DecisionTraceDraft[] = []
    const commands: LegalCaseSetCommand[] = []
    for (const title of affected) {
      if (title.holder.status !== 'HELD') continue
      const predecessorId = title.holder.personId
      const ds = decisions.filter(e => e.titleId === title.titleId &&
        e.predecessorPersonId === predecessorId && e.decisionYear === ctx.year)
      const decision = ds.length === 1 ? ds[0] : undefined
      const successor = decision ? world.persons.find(p => p.personId === decision.successorPersonId) : undefined
      const issuerExists = decision?.issuerRef.kind === 'COUNTRY'
        ? world.countries.some(c => c.countryId === decision.issuerRef.id)
        : decision?.issuerRef.kind === 'HOUSE'
          ? world.houses.some(h => h.houseId === decision.issuerRef.id)
          : decision?.issuerRef.kind === 'PERSON'
            ? world.persons.some(p => p.personId === decision.issuerRef.id && p.alive)
            : false
      let reason = 'EXPLICIT_SUCCESSION_DECISION'
      if (title.kind !== 'TERRITORIAL') reason = 'CROWN_SUCCESSION_NOT_IN_SCOPE'
      else if (!title.valid || !title.hereditary || title.recognition.status !== 'ACTIVE') reason = 'TITLE_NOT_ACTIVE_HEREDITARY'
      else if (ds.length !== 1 || !decision) reason = 'GAME_02_DECISION_EVIDENCE_MISSING'
      else if (decision.grantBasisId !== title.grantBasisId) reason = 'GRANT_BASIS_MISMATCH'
      else if (!issuerExists) reason = 'ISSUER_EVIDENCE_NOT_FOUND'
      else if (!successor || !successor.alive) reason = 'SUCCESSOR_UNAVAILABLE'
      else if (successor.personId === predecessorId ||
        (successor.fatherId !== predecessorId && successor.motherId !== predecessorId)) reason = 'DIRECT_DESCENDANT_EVIDENCE_MISSING'
      else if (successor.legalDynasty.status !== 'DETERMINED') reason = 'SUCCESSOR_LEGAL_DYNASTY_UNDETERMINED'
      const usable = reason === 'EXPLICIT_SUCCESSION_DECISION'
      const approved = usable && decision?.status === 'APPROVED'
      const pending = usable && decision?.status === 'PENDING'
      const rejected = usable && decision?.status === 'REJECTED'
      const status = approved ? 'ACCEPT' : rejected ? 'REJECT' : 'DEFER'
      const caseId = usable && decision ? caseIdOf(decision) : null
      const id = 'asuc04:' + JSON.stringify([ctx.year,title.titleId])
      const traceIndex = traceDrafts.length
      traceDrafts.push({
        year: ctx.year, phase: ctx.phase, ruleId: ctx.ruleId,
        actorRef: {kind:'REGION',id:title.regionId},
        candidates: [{
          candidateId:id,eligible:approved,
          inputs: {
            titleId:title.titleId,predecessorPersonId:predecessorId,
            sourceB003TraceId:deceased.get(predecessorId) ?? null,
            candidatePersonId:decision?.successorPersonId ?? null,
            decisionId:decision?.decisionId ?? null, caseId,
            grantBasisId:title.grantBasisId,
            issuerId:decision?.issuerRef.id ?? null,
            issuerAuthorityStatus:'GAME_02_UNAPPROVED',
            evidenceStatus:decision?.status ?? null,
            provenance:'CALIBRATION_ONLY',
          },
          reasonCodes:['CALIBRATION_ONLY',approved?'EXPLICIT_DECISION_APPROVED':pending?'EXPLICIT_DECISION_PENDING':rejected?'EXPLICIT_DECISION_REJECTED':reason],
        }],
        ...(approved?{selectedCandidateId:id}:{}),
        status,
        reasonCodes:['CALIBRATION_ONLY','GAME_02_EXPLICIT_DECISION_ONLY',approved?'EXPLICIT_DECISION_APPROVED':pending?'EXPLICIT_DECISION_PENDING':rejected?'EXPLICIT_DECISION_REJECTED':reason],
        modifierIds:[],ruleVersion:ASUC04_RULE_VERSION,
      })
      if (!usable || !decision) continue
      commands.push({
        type:'LEGAL_CASE_SET',
        commandId:'cmd:asuc04:' + decisionKey(decision),
        source: {
          requestId:'req:asuc04:' + decisionKey(decision),year:ctx.year,phase:ctx.phase,
          sourceRuleId:'A-SUC-04',sourceTraceId:ctx.traceId(traceIndex),sourceIntentId:decision.decisionId,
        },
        legalCase: {
          caseId:caseIdOf(decision),titleId:title.titleId,kind:'SUCCESSION',status:decision.status,
          candidatePersonIds:[decision.successorPersonId],
          reasonCodes:['CALIBRATION_ONLY','EXPLICIT_DECISION_ID:'+decision.decisionId,'GAME_02_AUTHORITY_UNVERIFIED'],
        },
      })
    }
    return {ruleId:ctx.ruleId,phase:ctx.phase,commands,requests:[],deferred:[],traceDrafts}
  }
  return {ok:true,evaluator}
}
