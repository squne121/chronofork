// 第1縦断の法制再審査：死亡当年のPENDINGを後年も照合し、明示証拠が揃う場合だけ実状態へ反映。
// DEC-055。GAME-02/03の権限者を既定推定しない。ここで扱う証拠はCALIBRATION_ONLY。
// 通常の自律評価器を置換するオプトイン評価器で、全37ルールの正式IMPLEMENTED化ではない。
import type {
  ControllerRef, DecisionTraceDraft, DomainCommand, Id, LegalCaseSetCommand,
  LegalTitleTransferCommand, ControlMandateSetCommand, RuleOutcome, WorldState, Year,
} from '../../contracts/index.ts'
import type { EvaluationContext, EvaluatorMap, RuleEvaluator } from '../../engine/evaluators.ts'
import { EvaluationFailure } from '../../engine/evaluators.ts'
import { eventIdOf } from '../../engine/ids.ts'
import type { LegalEvidenceBook } from '../../legal/evidence.ts'
import { reviewApprovalAuthority } from '../../legal/evidence.ts'
import { createASuc04WorldStateEvaluator } from './asuc04-worldstate.ts'
import { createATit07EvidenceEvaluator } from './atit07-title-transfer.ts'
import { reviewLandHeir } from './legal-heirs.ts'

export const REVIEWED_LEGAL_VERSION = 'reviewed-normal-succession-1:CALIBRATION_ONLY'

/** 後年届いた相続決定。記録だけでは足りず、権限台帳との相互参照を必須とする。 */
export type SuccessionReviewEvidence = Readonly<{
  decisionId: Id
  titleId: Id
  predecessorPersonId: Id
  successorPersonId: Id
  grantBasisId: Id
  issuerRef: ControllerRef
  authorityBasisId: Id
  availableFromYear: Year
  provenance: 'CALIBRATION_ONLY'
}>

/** 新しい委任を発行できるという独立した権原。現状のexperimentalには未登録。 */
export type DelegationAuthorityEvidence = Readonly<{
  authorizationId: Id
  titleId: Id
  regionId: Id
  grantBasisId: Id
  issuerRef: ControllerRef
  sovereignCountryId: Id
  sourceLawOrGrantId: Id
  provenance: 'CALIBRATION_ONLY'
}>

/** 新規受益者への明示的委任意思。権原のない決定ID文字列だけでは適用不可。 */
export type DelegationDecisionEvidence = Readonly<{
  decisionId: Id
  authorizationId: Id
  titleId: Id
  regionId: Id
  beneficiaryPersonId: Id
  issuerRef: ControllerRef
  availableFromYear: Year
  endExclusiveYear: Year
  provenance: 'CALIBRATION_ONLY'
}>

export type ReviewedLegalInput = Readonly<{
  book: LegalEvidenceBook
  successionDecisions?: readonly SuccessionReviewEvidence[]
  delegationAuthorities?: readonly DelegationAuthorityEvidence[]
  delegationDecisions?: readonly DelegationDecisionEvidence[]
}>
export type ReviewedLegalFactoryResult =
  | Readonly<{ ok: true; evaluators: EvaluatorMap }>
  | Readonly<{ ok: false; issues: readonly string[] }>

const sameRef = (a: ControllerRef, b: ControllerRef) => a.kind === b.kind && a.id === b.id
const present = (v: unknown): v is string => typeof v === 'string' && v.length > 0
const compare = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
const predecessorOf = (codes: readonly string[]) =>
  codes.find(x => x.startsWith('PREDECESSOR_ID:'))?.slice('PREDECESSOR_ID:'.length)
const reason = (code: string) => ['CALIBRATION_ONLY', 'DEC_055_PENDING_REVIEW', code]
const safe = (x: unknown) => x !== null && typeof x === 'object'

/** 構造・固有IDだけを入口で検査。真正な権限は毎年、現WorldStateとbookの記録で判定する。 */
export function createReviewedLegalEvaluators(input: ReviewedLegalInput): ReviewedLegalFactoryResult {
  if (!safe(input) || !safe(input.book)) return { ok: false, issues: ['INVALID_EVIDENCE_BOOK'] }
  const decisions = input.successionDecisions ?? []
  const rights = input.delegationAuthorities ?? []
  const delegations = input.delegationDecisions ?? []
  const all = [...decisions, ...rights, ...delegations]
  if (![decisions, rights, delegations].every(Array.isArray)) return { ok: false, issues: ['INVALID_RECORDS'] }
  const ids = [...decisions.map(x => x?.decisionId), ...rights.map(x => x?.authorizationId), ...delegations.map(x => x?.decisionId)]
  if (all.some(x => !safe(x) || x.provenance !== 'CALIBRATION_ONLY') ||
      ids.some(x => !present(x)) || new Set(ids).size !== ids.length) {
    return { ok: false, issues: ['INVALID_OR_DUPLICATE_EVIDENCE'] }
  }
  const stableDecisions = structuredClone(decisions) as SuccessionReviewEvidence[]
  const stableRights = structuredClone(rights) as DelegationAuthorityEvidence[]
  const stableDelegations = structuredClone(delegations) as DelegationDecisionEvidence[]
  const book = structuredClone(input.book) as LegalEvidenceBook
  const baseSuc = createASuc04WorldStateEvaluator()
  const baseTitle = createATit07EvidenceEvaluator()

  const proofFor = (world: WorldState, titleId: Id, predecessorId: Id, successorId: Id, year: Year) => {
    const title = world.titles.find(t => t.titleId === titleId)
    if (!title || title.kind !== 'TERRITORIAL' || !title.valid || !title.hereditary ||
        title.recognition.status !== 'ACTIVE') return undefined
    const region = world.regions.find(r => r.regionId === title.regionId)
    const grant = book.titleGrants.find(x => x.grantBasisId === title.grantBasisId)
    if (!region || !grant || grant.titleId !== title.titleId ||
        !grant.hereditary || grant.sovereignCountryId !== region.sovereignCountryId ||
        title.recognition.sovereignCountryId !== region.sovereignCountryId) return undefined
    const matches = stableDecisions.filter(d =>
      d.titleId === titleId && d.predecessorPersonId === predecessorId &&
      d.successorPersonId === successorId && d.grantBasisId === grant.grantBasisId &&
      Number.isSafeInteger(d.availableFromYear) && d.availableFromYear <= year &&
      present(d.decisionId) && present(d.authorityBasisId) &&
      present(d.issuerRef?.id) && ['COUNTRY', 'HOUSE', 'PERSON'].includes(d.issuerRef?.kind))
    if (matches.length !== 1) return undefined
    const record = matches[0]!
    const authority = reviewApprovalAuthority(world, book, {
      action: 'NORMAL_LAND_SUCCESSION', issuerRef: record.issuerRef,
      sovereignCountryId: region.sovereignCountryId,
    })
    if (authority.status !== 'AUTHORIZED' || authority.authorityBasisId !== record.authorityBasisId) return undefined
    return record
  }

  const succession: RuleEvaluator = (world, ctx) => {
    if (ctx.ruleId !== 'A-SUC-04' || ctx.phase !== 4 || ctx.year !== world.year) {
      throw new EvaluationFailure('相続再審査のRuleID/年/フェーズが不一致', [{ code: 'RULE_MISMATCH', message: 'A-SUC-04 Phase4' }])
    }
    const original = baseSuc(world, ctx)
    const traceDrafts: DecisionTraceDraft[] = [...original.traceDrafts]
    const commands: DomainCommand[] = [...original.commands]
    const pending = world.legal.cases
      .filter(c => c.kind === 'SUCCESSION' && c.status === 'PENDING')
      .sort((a,b) => compare(a.caseId,b.caseId))
    for (const legalCase of pending) {
      const title = world.titles.find(t => t.titleId === legalCase.titleId)
      if (!title || title.kind !== 'TERRITORIAL' || !title.valid || !title.hereditary ||
          title.holder.status !== 'UNDETERMINED' ||
          world.legal.cases.filter(c => c.titleId === title.titleId && c.kind === 'SUCCESSION').length !== 1) continue
      const predecessorId = predecessorOf(legalCase.reasonCodes)
      const heir = predecessorId ? reviewLandHeir(world, predecessorId) : null
      const proof = predecessorId && heir?.status === 'READY'
        ? proofFor(world, title.titleId, predecessorId, heir.personId, ctx.year) : undefined
      const approved = heir?.status === 'READY' && proof !== undefined
      const traceIndex = traceDrafts.length
      const candidateId = 'asuc04:review:' + JSON.stringify([ctx.year, legalCase.caseId])
      const candidatePersonId = heir?.status === 'READY' ? heir.personId : null
      const why = approved ? 'EXPLICIT_AUTHORITY_AND_HEIR_VERIFIED' :
        !predecessorId ? 'PREDECESSOR_EVIDENCE_MISSING' :
        heir?.status === 'PENDING' ? heir.reasonCodes[0]! : 'GAME_02_APPROVAL_EVIDENCE_MISSING'
      traceDrafts.push({
        year: ctx.year, phase: ctx.phase, ruleId: ctx.ruleId,
        actorRef: { kind: 'REGION', id: title.regionId },
        candidates: [{ candidateId, eligible: approved,
          inputs: { titleId: title.titleId, legalCaseId: legalCase.caseId,
            predecessorPersonId: predecessorId ?? null, candidatePersonId,
            decisionId: proof?.decisionId ?? null, authorityBasisId: proof?.authorityBasisId ?? null,
            provenance: 'CALIBRATION_ONLY' }, reasonCodes: reason(why) }],
        ...(approved ? { selectedCandidateId: candidateId } : {}),
        status: approved ? 'ACCEPT' : 'DEFER', reasonCodes: reason(why),
        modifierIds: [], ruleVersion: REVIEWED_LEGAL_VERSION,
      })
      if (!approved || !proof || !candidatePersonId || !predecessorId) continue
      const nextCase = {
        ...legalCase, status: 'APPROVED' as const,
        candidatePersonIds: [candidatePersonId],
        reasonCodes: [...legalCase.reasonCodes, 'REVIEWED_DECISION:' + proof.decisionId,
          'AUTHORITY_BASIS:' + proof.authorityBasisId],
      }
      const cmd: LegalCaseSetCommand = {
        type: 'LEGAL_CASE_SET',
        commandId: 'cmd:asuc04:review:' + JSON.stringify([ctx.year,legalCase.caseId]),
        source: { requestId: 'req:asuc04:review:' + legalCase.caseId,
          year: ctx.year, phase: ctx.phase, sourceRuleId: 'A-SUC-04',
          sourceTraceId: ctx.traceId(traceIndex), sourceIntentId: proof.decisionId },
        legalCase: nextCase,
      }
      commands.push(cmd)
    }
    return { ...original, commands, traceDrafts }
  }

  const titleTransfer: RuleEvaluator = (world, ctx) => {
    if (ctx.ruleId !== 'A-TIT-07' || ctx.phase !== 4 || ctx.year !== world.year) {
      throw new EvaluationFailure('Title再審査のRuleID/年/フェーズが不一致', [{ code: 'RULE_MISMATCH', message: 'A-TIT-07 Phase4' }])
    }
    const original = baseTitle(world, ctx)
    const traceDrafts: DecisionTraceDraft[] = [...original.traceDrafts]
    const commands: DomainCommand[] = [...original.commands]
    const cases = world.legal.cases.filter(c => c.kind === 'SUCCESSION' && c.status === 'APPROVED')
      .sort((a,b) => compare(a.caseId,b.caseId))
    for (const legalCase of cases) {
      const title = world.titles.find(t => t.titleId === legalCase.titleId)
      if (!title || title.kind !== 'TERRITORIAL' || !title.valid || !title.hereditary ||
          title.holder.status !== 'UNDETERMINED' || legalCase.candidatePersonIds.length !== 1) continue
      const successorId = legalCase.candidatePersonIds[0]!
      const predecessorId = predecessorOf(legalCase.reasonCodes)
      if (!predecessorId) continue
      const heir = reviewLandHeir(world, predecessorId)
      const proof = heir.status === 'READY' && heir.personId === successorId
        ? proofFor(world, title.titleId, predecessorId, successorId, ctx.year) : undefined
      if (!proof || !legalCase.reasonCodes.includes('REVIEWED_DECISION:' + proof.decisionId) ||
          !legalCase.reasonCodes.includes('AUTHORITY_BASIS:' + proof.authorityBasisId)) continue
      const traceIndex = traceDrafts.length
      const transferId = 'cmd:atit07:review:' + JSON.stringify([ctx.year,legalCase.caseId])
      const transferEventId = eventIdOf(ctx.year, ctx.phase, 'A-TIT-07', transferId)
      const candidateId = 'atit07:review:' + JSON.stringify([ctx.year,legalCase.caseId])
      traceDrafts.push({
        year: ctx.year, phase: ctx.phase, ruleId: ctx.ruleId,
        actorRef: { kind: 'REGION', id: title.regionId },
        candidates: [{ candidateId, eligible: true, inputs: {
          legalCaseId: legalCase.caseId, titleId: title.titleId,
          successorPersonId: successorId, sourceDecisionId: proof.decisionId,
          territoryOrTaxTransferred: false, provenance: 'CALIBRATION_ONLY',
        }, reasonCodes: reason('REVIEWED_SUCCESSION_TITLE_TRANSFER') }],
        selectedCandidateId: candidateId, status: 'ACCEPT',
        reasonCodes: reason('REVIEWED_SUCCESSION_TITLE_TRANSFER'),
        modifierIds: [], ruleVersion: REVIEWED_LEGAL_VERSION,
      })
      const transfer: LegalTitleTransferCommand = {
        type: 'LEGAL_TITLE_TRANSFER', commandId: transferId,
        source: { requestId: 'req:atit07:review:' + legalCase.caseId,
          year: ctx.year, phase: ctx.phase, sourceRuleId: 'A-TIT-07',
          sourceTraceId: ctx.traceId(traceIndex), sourceIntentId: proof.decisionId },
        titleId: title.titleId, toHolder: { status: 'HELD', personId: successorId },
        legalCaseId: legalCase.caseId,
      }
      commands.push(transfer)

      // Titleの移転だけでは委任は生じない。独立した委任権原と意思決定の両方が必須。
      const region = world.regions.find(r => r.regionId === title.regionId)
      const approvedMandates = stableDelegations.filter(d =>
        d.titleId === title.titleId && d.regionId === title.regionId &&
        d.beneficiaryPersonId === successorId && Number.isSafeInteger(d.availableFromYear) &&
        d.availableFromYear <= ctx.year && Number.isSafeInteger(d.endExclusiveYear) &&
        d.endExclusiveYear > ctx.year && present(d.decisionId) && present(d.authorizationId))
      const mandateDecision = approvedMandates.length === 1 ? approvedMandates[0] : undefined
      const right = mandateDecision ? stableRights.find(r => r.authorizationId === mandateDecision.authorizationId) : undefined
      const basis = book.titleGrants.find(g => g.grantBasisId === title.grantBasisId)
      const authorized = !!(region && mandateDecision && right && basis &&
        right.titleId === title.titleId && right.regionId === title.regionId &&
        right.grantBasisId === basis.grantBasisId && right.sourceLawOrGrantId === basis.grantBasisId &&
        right.sovereignCountryId === region.sovereignCountryId &&
        sameRef(right.issuerRef, region.deFactoControllerRef) &&
        sameRef(mandateDecision.issuerRef, right.issuerRef) &&
        title.recognition.sovereignCountryId === region.sovereignCountryId &&
        !world.legal.controlMandates.some(m => m.regionId === region.regionId &&
          m.effectiveFromYear < mandateDecision.endExclusiveYear && ctx.year < m.endExclusiveYear))
      if (!authorized || !region || !mandateDecision || !right) continue
      const mandateTrace = traceDrafts.length
      const mandateId = 'mandate:reviewed:' + JSON.stringify([ctx.year,legalCase.caseId,mandateDecision.decisionId])
      const mandateCandidateId = 'atit07:mandate:' + JSON.stringify([ctx.year,legalCase.caseId])
      traceDrafts.push({
        year: ctx.year, phase: ctx.phase, ruleId: ctx.ruleId,
        actorRef: { kind: 'REGION', id: region.regionId },
        candidates: [{ candidateId: mandateCandidateId, eligible: true, inputs: {
          titleId: title.titleId, beneficiaryPersonId: successorId,
          delegationDecisionId: mandateDecision.decisionId,
          authorizationId: right.authorizationId, provenance: 'CALIBRATION_ONLY',
        }, reasonCodes: reason('EXPLICIT_NEW_MANDATE_EVIDENCE') }],
        selectedCandidateId: mandateCandidateId, status: 'ACCEPT',
        reasonCodes: reason('EXPLICIT_NEW_MANDATE_EVIDENCE'),
        modifierIds: [], ruleVersion: REVIEWED_LEGAL_VERSION,
      })
      const mandate: ControlMandateSetCommand = {
        type: 'CONTROL_MANDATE_SET',
        commandId: 'cmd:atit07:mandate:' + JSON.stringify([ctx.year,legalCase.caseId]),
        source: { requestId: 'req:atit07:mandate:' + legalCase.caseId,
          year: ctx.year, phase: ctx.phase, sourceRuleId: 'A-TIT-07',
          sourceTraceId: ctx.traceId(mandateTrace), sourceIntentId: mandateDecision.decisionId },
        mandate: { mandateId, regionId: region.regionId,
          controllerRef: region.deFactoControllerRef, beneficiaryPersonId: successorId,
          authorizingTitleId: title.titleId, sourceEventId: transferEventId,
          effectiveFromYear: ctx.year, endExclusiveYear: mandateDecision.endExclusiveYear },
      }
      commands.push(mandate)
    }
    return { ...original, commands, traceDrafts }
  }
  return { ok: true, evaluators: { 'A-SUC-04': succession, 'A-TIT-07': titleTransfer } }
}
