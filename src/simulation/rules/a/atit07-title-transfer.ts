// A-TIT-07: 同年のB-003確定死亡とA-SUC-04の明示SUCCESSIONケースを照合するTitle移転。
// CALIBRATION_ONLY。承認済みケース1名だけが保有者となり、未承認は所有者UNDETERMINED。
// 実効支配・承認・徴税権・ControlMandateを勝手に付け替えず、CROWN相続も扱わない。
import type { DecisionTraceDraft, Id, LegalTitleTransferCommand, RuleOutcome, WorldState } from '../../contracts/index.ts'
import type { EvaluationContext, RuleEvaluator } from '../../engine/evaluators.ts'
import { EvaluationFailure } from '../../engine/evaluators.ts'

export const ATIT07_RULE_VERSION = 'atit07-explicit-approved-case-0:CALIBRATION_ONLY'
const idStr = (v: unknown): v is Id => typeof v === 'string' && v.length > 0

/** 他ルールからA所有のTitle移転命令を出さない。承認が無いなら法的保有者を推定しない。 */
export const createATit07EvidenceEvaluator = (): RuleEvaluator => (world: WorldState, ctx: EvaluationContext): RuleOutcome => {
  if (ctx.ruleId !== 'A-TIT-07' || ctx.phase !== 4 || ctx.year !== world.year) {
    throw new EvaluationFailure('A-TIT-07のRuleID・フェーズ・年が不一致です', [{ code: 'RULE_MISMATCH', message: 'A-TIT-07はフェーズ4で実行' }])
  }
  const deathTraces = (ctx.priorTraces ?? []).filter(t =>
    t.year === ctx.year && t.ruleId === 'B-003' && t.status === 'ACCEPT' &&
    t.eventIds.length === 1 && t.actorRef.kind === 'PERSON')
  const dead = new Set(deathTraces.map(t => t.actorRef.kind === 'PERSON' ? t.actorRef.id : ''))
  const successorTraces = (ctx.priorTraces ?? []).filter(t => t.year === ctx.year && t.ruleId === 'A-SUC-04')
  const traceDrafts: DecisionTraceDraft[] = []
  const commands: LegalTitleTransferCommand[] = []
  const seenTitle = new Set<Id>()

  for (const trace of successorTraces) {
    const candidate = trace.candidates[0]
    const titleId = candidate?.inputs.titleId
    const predecessorId = candidate?.inputs.predecessorPersonId
    if (!idStr(titleId) || !idStr(predecessorId) || seenTitle.has(titleId)) {
      throw new EvaluationFailure('A-SUC-04のTitle証拠が不正または重複しています', [{ code: 'INVALID_SUCCESSION_TRACE', message: trace.traceId }])
    }
    seenTitle.add(titleId)
    const title = world.titles.find(t => t.titleId === titleId)
    if (!title || trace.actorRef.kind !== 'REGION' || title.regionId !== trace.actorRef.id ||
        title.holder.status !== 'HELD' || title.holder.personId !== predecessorId ||
        !dead.has(predecessorId)) {
      throw new EvaluationFailure('A-SUC-04とB-003の確定死亡・Titleが一致しません', [{ code: 'SUCCESSION_DEATH_MISMATCH', message: titleId }])
    }
    const holder = world.persons.find(p => p.personId === predecessorId)
    if (!holder || holder.alive || holder.deathYear !== ctx.year) {
      throw new EvaluationFailure('死亡済み保持者の当年死亡証拠がありません', [{ code: 'HOLDER_NOT_DEAD', message: predecessorId }])
    }
    const rawCase = candidate.inputs.caseId
    const caseId = idStr(rawCase) ? rawCase : null
    const legalCase = caseId ? world.legal.cases.find(c => c.caseId === caseId && c.titleId === titleId && c.kind === 'SUCCESSION') : undefined
    const confirmedCase = legalCase !== undefined && trace.eventIds.length > 0 &&
      candidate.inputs.decisionId !== null && trace.candidates.length === 1
    const successorId = candidate.inputs.candidatePersonId
    const successor = idStr(successorId) ? world.persons.find(p => p.personId === successorId) : undefined
    const approved = confirmedCase && trace.status === 'ACCEPT' && legalCase.status === 'APPROVED' &&
      legalCase.candidatePersonIds.length === 1 && legalCase.candidatePersonIds[0] === successorId &&
      successor?.alive === true && successor.legalDynasty.status === 'DETERMINED' &&
      (successor.fatherId === predecessorId || successor.motherId === predecessorId) &&
      title.kind === 'TERRITORIAL' && title.valid && title.hereditary &&
      title.recognition.status === 'ACTIVE'
    const inScope = title.kind === 'TERRITORIAL' && title.valid && title.hereditary
    const reason = !inScope ? 'TITLE_NOT_IN_TERRITORIAL_SUCCESSION_SCOPE' :
      approved ? 'EXPLICIT_SUCCESSION_CASE_APPROVED' :
      legalCase?.status === 'PENDING' ? 'SUCCESSION_CASE_PENDING' :
      legalCase?.status === 'REJECTED' ? 'SUCCESSION_CASE_REJECTED' :
      'GAME_02_SUCCESSOR_UNDETERMINED'
    const traceIndex = traceDrafts.length
    const id = 'atit07:' + JSON.stringify([ctx.year,titleId])
    traceDrafts.push({
      year:ctx.year,phase:ctx.phase,ruleId:ctx.ruleId,
      actorRef:{kind:'REGION',id:title.regionId},
      candidates:[{
        candidateId:id,eligible:approved,
        inputs:{
          titleId,predecessorPersonId:predecessorId,successorPersonId:approved?successorId:null,
          sourceASuc04TraceId:trace.traceId,
          sourceASuc04EventIds:[...trace.eventIds],
          legalCaseId:caseId,legalCaseStatus:legalCase?.status ?? null,
          titleGrantBasisId:title.grantBasisId,
          territorialControlTransferred:false,recognitionChanged:false,
          provenance:'CALIBRATION_ONLY',
        },reasonCodes:['CALIBRATION_ONLY',reason],
      }],
      ...(approved?{selectedCandidateId:id}:{}),
      status:approved?'ACCEPT':'DEFER',
      reasonCodes:['CALIBRATION_ONLY','GAME_02_APPROVAL_REQUIRED',reason],
      modifierIds:[],ruleVersion:ATIT07_RULE_VERSION,
    })
    if (!inScope) continue
    // APPROVEDなら既存承認ケースに記録されたただ一人を保持者へ。そうでなければ保有者未確定へ。
    commands.push({
      type:'LEGAL_TITLE_TRANSFER',
      commandId:'cmd:atit07:' + JSON.stringify([ctx.year,titleId,approved?successorId:'UNDETERMINED']),
      source:{
        requestId:'req:atit07:' + JSON.stringify([ctx.year,titleId]),
        year:ctx.year,phase:ctx.phase,sourceRuleId:'A-TIT-07',
        sourceTraceId:ctx.traceId(traceIndex),sourceIntentId:caseId ?? trace.traceId,
      },
      titleId,
      ...(approved && caseId && idStr(successorId)
        ? { toHolder:{status:'HELD' as const,personId:successorId},legalCaseId:caseId }
        : { toHolder:{status:'UNDETERMINED' as const,...(confirmedCase && caseId ? {legalCaseId:caseId} : {})},
          ...(confirmedCase && caseId ? {legalCaseId:caseId}: {}) }),
    })
  }
  return {ruleId:ctx.ruleId,phase:ctx.phase,commands,requests:[],deferred:[],traceDrafts}
}
