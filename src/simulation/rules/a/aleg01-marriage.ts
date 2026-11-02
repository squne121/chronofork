// A-LEG-01の婚姻審査・登録の最小技術版。外部から明示された試験承認のみに反応する。
// GAME-02（誰が法的婚姻を承認できるか）は未承認。本評価器はCALIBRATION_ONLYで、正式な婚姻法を確定しない。
// 承認がない場合はDEFERし、MARRIAGE_REGISTER・EventLogは生成しない。
import type {
  ControllerRef, CrossDomainResponse, DecisionTraceDraft, Id, MarriageContract,
  MarriageRegisterCommand, RuleOutcome, WorldState,
} from '../../contracts/index.ts'
import { GOAL_YEAR, START_YEAR } from '../../contracts/index.ts'
import type { EvaluationContext, RuleEvaluator } from '../../engine/evaluators.ts'
import { EvaluationFailure } from '../../engine/evaluators.ts'
import { normalizePersonPair, pairKey } from '../../intervention/index.ts'

export const ALEG01_RULE_VERSION = 'aleg01-explicit-test-approval-0:CALIBRATION_ONLY'

/** A所有の事前承認証拠を試験用に明示する。issuerRefの存在確認は法的権限の正式認定ではない。 */
export type MarriageApprovalEvidence = Readonly<{
  approvalId: Id
  personIds: readonly [Id, Id]
  authorizedYear: number
  status: 'APPROVED' | 'PENDING' | 'REJECTED'
  issuerRef: ControllerRef
  evidenceId: Id
  provenance: 'CALIBRATION_ONLY'
  contract?: MarriageContract
}>
export type MarriageApprovalIssue = Readonly<{ code: string; path: string }>

const validId = (v: unknown): v is Id => typeof v === 'string' && v.length > 0
const kinship = (a: { personId: Id; fatherId?: Id; motherId?: Id }, b: { personId: Id; fatherId?: Id; motherId?: Id }) => {
  if (a.fatherId === b.personId || a.motherId === b.personId ||
      b.fatherId === a.personId || b.motherId === a.personId) return true
  return (a.fatherId !== undefined && a.fatherId === b.fatherId) ||
    (a.motherId !== undefined && a.motherId === b.motherId)
}
const samePair = (a: readonly [Id, Id], b: readonly [Id, Id]) => a[0] === b[0] && a[1] === b[1]

/** 確認不能な法的根拠を自動作成しない。重複・不正な明示証拠は評価器生成時点で拒否。 */
export function createALeg01CalibrationEvaluator(
  evidence: readonly MarriageApprovalEvidence[],
): Readonly<{ ok: true; evaluator: RuleEvaluator }> | Readonly<{ ok: false; issues: readonly MarriageApprovalIssue[] }> {
  const issues: MarriageApprovalIssue[] = []
  if (!Array.isArray(evidence)) return { ok: false, issues: [{ code: 'INVALID_LEDGER', path: 'evidence' }] }
  const ids = new Set<Id>()
  const slots = new Set<string>()
  evidence.forEach((r, i) => {
    const path = 'evidence[' + i + ']'
    if (!r || !validId(r.approvalId) || !validId(r.evidenceId)) { issues.push({ code: 'INVALID_EVIDENCE_ID', path }); return }
    if (ids.has(r.approvalId)) issues.push({ code: 'DUPLICATE_EVIDENCE_ID', path })
    ids.add(r.approvalId)
    const p = r.personIds
    if (!Array.isArray(p) || p.length !== 2 || normalizePersonPair(p[0], p[1])?.[0] !== p[0]) {
      issues.push({ code: 'INVALID_PAIR', path }); return
    }
    const key = r.authorizedYear + ':' + pairKey(p)
    if (slots.has(key)) issues.push({ code: 'DUPLICATE_APPROVAL_FOR_PAIR_YEAR', path })
    slots.add(key)
    if (!Number.isSafeInteger(r.authorizedYear) || r.authorizedYear < START_YEAR || r.authorizedYear >= GOAL_YEAR) {
      issues.push({ code: 'INVALID_YEAR', path })
    }
    if (!['APPROVED', 'PENDING', 'REJECTED'].includes(r.status) || r.provenance !== 'CALIBRATION_ONLY') {
      issues.push({ code: 'INVALID_APPROVAL_STATUS', path })
    }
    if (!r.issuerRef || !['COUNTRY','HOUSE','PERSON'].includes(r.issuerRef.kind) || !validId(r.issuerRef.id)) {
      issues.push({ code: 'INVALID_ISSUER', path })
    }
    if (r.contract !== undefined &&
        (!validId(r.contract.contractId) || r.contract.evidenceId !== r.evidenceId || !Array.isArray(r.contract.clauses))) {
      issues.push({ code: 'INVALID_CONTRACT_EVIDENCE', path })
    }
  })
  if (issues.length > 0) return { ok: false, issues }
  const approvals = structuredClone(evidence) as MarriageApprovalEvidence[]

  const evaluator: RuleEvaluator = (world: WorldState, ctx: EvaluationContext): RuleOutcome => {
    if (ctx.ruleId !== 'A-LEG-01' || ctx.phase !== 3 || ctx.year !== world.year) {
      throw new EvaluationFailure('A-LEG-01のRuleID・フェーズ・年が一致しません', [{ code: 'RULE_MISMATCH', message: 'A-LEG-01はフェーズ3でのみ実行' }])
    }
    const requests = ctx.marriageQueries ?? []
    const commands: MarriageRegisterCommand[] = []
    const traceDrafts: DecisionTraceDraft[] = []
    const responses: CrossDomainResponse[] = []
    for (const q of requests) {
      const pair = q.payload.personIds
      const key = pairKey(pair)
      const [a,b] = pair.map((id) => world.persons.find((p) => p.personId === id))
      const matching = approvals.filter((r) => r.authorizedYear === ctx.year && samePair(r.personIds, pair))
      const approval = matching.length === 1 ? matching[0] : undefined
      let status: 'ACCEPT' | 'DEFER' | 'REJECT' = 'DEFER'
      let reason = 'GAME_02_APPROVAL_EVIDENCE_MISSING'
      const activeMarriage = world.legal.marriages.some((m) => m.status === 'ACTIVE' && pair.some((id) => m.personIds.includes(id)))
      if (!a || !b || !a.alive || !b.alive) reason = 'PERSON_UNAVAILABLE'
      else if (kinship(a,b)) reason = 'KINSHIP_UNREVIEWED'
      else if (activeMarriage) reason = 'ACTIVE_MARRIAGE_EXISTS'
      else if (approval?.status === 'REJECTED') { status = 'REJECT'; reason = 'EXPLICIT_APPROVAL_REJECTED' }
      else if (approval?.status === 'PENDING') reason = 'EXPLICIT_APPROVAL_PENDING'
      else if (approval?.status === 'APPROVED') {
        const issuerValid = approval.issuerRef.kind === 'COUNTRY'
          ? world.countries.some((x) => x.countryId === approval.issuerRef.id)
          : approval.issuerRef.kind === 'HOUSE'
            ? world.houses.some((x) => x.houseId === approval.issuerRef.id)
            : world.persons.some((x) => x.personId === approval.issuerRef.id && x.alive)
        const contract = approval.contract ?? {
          contractId: approval.approvalId,
          evidenceId: approval.evidenceId,
          clauses: [],
        }
        if (!issuerValid) reason = 'ISSUER_NOT_FOUND'
        else if (contract.clauses.some((c) => !world.legal.dynasties.some((d) => d.dynastyId === c.dynastyId))) reason = 'CONTRACT_DYNASTY_UNRESOLVED'
        else {
          status = 'ACCEPT'
          reason = 'EXPLICIT_CALIBRATION_APPROVAL'
          const draftIndex = traceDrafts.length
          const src = { requestId: q.source.requestId, year: ctx.year, phase: ctx.phase,
            sourceRuleId: 'A-LEG-01' as const, sourceTraceId: ctx.traceId(draftIndex),
            sourceIntentId: q.source.sourceTraceId }
          commands.push({
            type: 'MARRIAGE_REGISTER',
            commandId: 'cmd:aleg01:' + ctx.year + ':' + key,
            source: src,
            marriage: { marriageId: 'marriage:' + ctx.year + ':' + key, personIds: pair,
              registeredYear: ctx.year, status: 'ACTIVE', contract },
          })
        }
      }
      responses.push({ requestId: q.source.requestId, status,
        reasonCodes: ['CALIBRATION_ONLY', reason] })
      traceDrafts.push({
        year: ctx.year, phase: ctx.phase, ruleId: ctx.ruleId,
        actorRef: { kind: 'PERSON_PAIR', ids: pair },
        candidates: [{
          candidateId: 'aleg01:' + key, eligible: status === 'ACCEPT',
          inputs: {
            sourceRequestId: q.source.requestId,
            sourceB005TraceId: q.source.sourceTraceId,
            approvalId: approval?.approvalId ?? null,
            evidenceId: approval?.evidenceId ?? null,
            issuerId: approval?.issuerRef.id ?? null,
            approvalProvenance: 'CALIBRATION_ONLY',
            authorityRuleStatus: 'GAME_02_UNAPPROVED',
          },
          reasonCodes: ['CALIBRATION_ONLY', reason],
        }],
        ...(status === 'ACCEPT' ? { selectedCandidateId: 'aleg01:' + key } : {}),
        status,
        reasonCodes: ['CALIBRATION_ONLY', 'A_LEGAL_ONLY', reason],
        modifierIds: [],
        ruleVersion: ALEG01_RULE_VERSION,
      })
    }
    return { ruleId: ctx.ruleId, phase: ctx.phase, commands, requests: [], responses, deferred: [], traceDrafts }
  }
  return { ok: true, evaluator }
}
