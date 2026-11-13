// Issue #119 / GAME-02 (MVP): 王位は土地相続と独立して審査する。
// 権原・管轄・存命順位・明示した王位授権が揃わない限り継承を承認しない。
// 過去の死亡と当年の死亡Event、後年のPENDING再審査を区別する。
import type {
  CountryRulerSetCommand, DecisionTraceDraft, DomainCommand, Id,
  LegalCase, LegalCaseSetCommand, LegalTitleTransferCommand, RuleOutcome,
  WorldState,
} from '../../contracts/index.ts'
import type { EvaluationContext, RuleEvaluator } from '../../engine/evaluators.ts'
import type { LegalEvidenceBook } from '../../legal/evidence.ts'
import { reviewOrdinaryAuthority } from '../../legal/ordinary-authority.ts'
import type { OrdinaryLaw } from '../../legal/ordinary-authority.ts'
import { reviewLandHeir } from './legal-heirs.ts'

export const CROWN_SUCCESSION_VERSION = 'crown-succession-mvp-1:CALIBRATION_ONLY'
const cmp = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0
const hasId = (x: unknown): x is Id => typeof x === 'string' && x.length > 0
const predecessorOf = (c: LegalCase): Id | undefined =>
  c.reasonCodes.find(s => s.startsWith('PREDECESSOR_ID:'))?.slice('PREDECESSOR_ID:'.length)
const countryOf = (c: LegalCase): Id | undefined =>
  c.reasonCodes.find(s => s.startsWith('CROWN_RULER_COUNTRY:'))?.slice('CROWN_RULER_COUNTRY:'.length)
const caseId = (deathYear: number, titleId: Id) => 'case:crown:' + JSON.stringify([deathYear, titleId])
const sameRef = (a: {kind:string;id:Id}, b: {kind:string;id:Id}) => a.kind === b.kind && a.id === b.id

type Input = Readonly<{ book?: LegalEvidenceBook; laws?: readonly OrdinaryLaw[] }>
type Approval = Readonly<{ countryId: Id; decisionId: Id; authorityBasisId: Id; lawId: Id }>

/** 国土の実効支配・統治委任とは独立の王位法的管轄を、授与・認定の原本と照合する。 */
function jurisdiction(w: WorldState, titleId: Id, book?: LegalEvidenceBook): Id | undefined {
  const title = w.titles.find(t => t.titleId === titleId)
  if (!book || !title || title.kind !== 'CROWN' || !title.valid || !title.hereditary ||
      title.recognition.status !== 'ACTIVE' || !title.recognition.authority ||
      title.recognition.authority.kind !== 'COUNTRY' || !hasId(title.recognition.sourceDecisionId)) return undefined
  const region = w.regions.find(r => r.regionId === title.regionId)
  const countryId = region?.sovereignCountryId
  if (!countryId || title.recognition.sovereignCountryId !== countryId ||
      title.recognition.authority.id !== countryId || !w.countries.some(c => c.countryId === countryId)) return undefined
  const grants = book.titleGrants.filter(g => g.grantBasisId === title.grantBasisId && g.titleId === titleId &&
    g.hereditary && g.sovereignCountryId === countryId && g.grantorRef.kind === 'COUNTRY' &&
    g.grantorRef.id === countryId && g.provenance === 'CALIBRATION_ONLY')
  const recognition = book.titleRecognitions.filter(r => r.decisionId === title.recognition.sourceDecisionId &&
    r.titleId === titleId && r.sovereignCountryId === countryId &&
    sameRef(r.authority, title.recognition.authority!) && r.provenance === 'CALIBRATION_ONLY')
  return grants.length === 1 && recognition.length === 1 ? countryId : undefined
}

/** 法律+別個の授権記録が存在する場合のみ、現在年の審査決定IDを導出。 */
function approval(w: WorldState, titleId: Id, predecessorId: Id, successorId: Id,
  year: number, book?: LegalEvidenceBook, laws: readonly OrdinaryLaw[] = []): Approval | undefined {
  const countryId = jurisdiction(w, titleId, book)
  if (!countryId || !book) return undefined
  const result = reviewOrdinaryAuthority(w, book, laws, {
    action: 'CROWN_SUCCESSION',
    issuerRef: { kind: 'COUNTRY', id: countryId }, sovereignCountryId: countryId, year,
  })
  if (result.status !== 'AUTHORIZED') return undefined
  return {
    countryId, lawId: result.lawId, authorityBasisId: result.authorityBasisId,
    decisionId: 'decision:crown-succession:' +
      JSON.stringify([year, titleId, predecessorId, successorId, result.lawId]),
  }
}

/** 実際の国家統治者記録と王冠保持者が一致し、同国の王冠が一つだけのときに限り対応を記録。 */
function rulerCountry(w: WorldState, titleId: Id, predecessorId: Id,
  book?: LegalEvidenceBook): Id | undefined {
  const countryId = jurisdiction(w, titleId, book)
  if (!countryId || w.countries.find(c => c.countryId === countryId)?.rulerPersonId !== predecessorId ||
      w.titles.filter(t => t.kind === 'CROWN' && t.recognition.sovereignCountryId === countryId).length !== 1) return undefined
  return countryId
}

/** A-SUC-04 に王位死亡案件と後年再審査を追加。土地ケースには触らない。 */
function succession(base: RuleEvaluator, input: Input): RuleEvaluator {
  const book = input.book === undefined ? undefined : structuredClone(input.book)
  const laws = structuredClone(input.laws ?? [])
  return (world, ctx) => {
    const original = base(world, ctx)
    const commands: DomainCommand[] = [...original.commands]
    const traceDrafts: DecisionTraceDraft[] = [...original.traceDrafts]
    const deaths = (ctx.priorTraces ?? []).filter(t => t.ruleId === 'B-003' &&
      t.year === ctx.year && t.actorRef.kind === 'PERSON' && t.status === 'ACCEPT' && t.eventIds.length === 1)
    const crowns = world.titles.filter(t => t.kind === 'CROWN').sort((a,b) => cmp(a.titleId,b.titleId))
    for (const title of crowns) {
      const holder = title.holder
      const deadHolder = holder.status === 'HELD'
        ? world.persons.find(p => p.personId === holder.personId) : undefined
      const freshDeath = !!deadHolder && !deadHolder.alive && deadHolder.deathYear === ctx.year
      const staleDeath = !!deadHolder && !deadHolder.alive && (deadHolder.deathYear ?? Infinity) < ctx.year
      const pending = world.legal.cases.filter(c => c.titleId === title.titleId &&
        c.kind === 'SUCCESSION' && c.status === 'PENDING')
      if (!freshDeath && !staleDeath && !(title.holder.status === 'UNDETERMINED' && pending.length > 0)) continue
      const newIncident = freshDeath || staleDeath
      const current = pending.length === 1 ? pending[0] : undefined
      const predecessorId = newIncident ? deadHolder?.personId : current && predecessorOf(current)
      if (!hasId(predecessorId)) continue
      const predecessor = world.persons.find(p => p.personId === predecessorId)
      if (!predecessor || predecessor.alive || !Number.isSafeInteger(predecessor.deathYear) ||
          predecessor.deathYear! > ctx.year) continue
      const death = deaths.filter(t => t.actorRef.kind === 'PERSON' && t.actorRef.id === predecessorId)
      const verifiedDeath = newIncident ? death.length === 1 : !!current?.reasonCodes.some(s => s.startsWith('SOURCE_B003_EVENT:'))
      const canCreate = newIncident && pending.length === 0 &&
        !world.legal.cases.some(c => c.caseId === caseId(predecessor.deathYear!,title.titleId))
      const cid = canCreate ? caseId(predecessor.deathYear!,title.titleId) : current?.caseId
      const heir = reviewLandHeir(world, predecessorId)
      const proof = verifiedDeath && pending.length <= 1 && hasId(cid) && title.valid && title.hereditary &&
        heir.status === 'READY'
        ? approval(world, title.titleId, predecessorId, heir.personId, ctx.year, book, laws) : undefined
      const approved = proof !== undefined && heir.status === 'READY'
      const successor = heir.status === 'READY' ? heir.personId : null
      const noApproval = !verifiedDeath ? 'B003_DEATH_EVIDENCE_MISSING' :
        pending.length > 1 ? 'CONCURRENT_PENDING_CROWN_CASES' :
        !title.valid || !title.hereditary ? 'CROWN_NOT_ACTIVE_HEREDITARY' :
        heir.status === 'PENDING' ? heir.reasonCodes[0] ?? 'HEIR_UNDETERMINED' :
        'CROWN_LAW_OR_AUTHORITY_MISSING'
      const reviewIndex = traceDrafts.length
      const candidateId = 'crown:review:' + JSON.stringify([ctx.year,title.titleId,cid ?? null])
      traceDrafts.push({
        year:ctx.year,phase:ctx.phase,ruleId:ctx.ruleId,
        actorRef:{kind:'REGION',id:title.regionId},
        candidates:[{
          candidateId,eligible:approved,
          inputs:{titleId:title.titleId,caseId:cid ?? null,predecessorPersonId:predecessorId,
            candidatePersonId:successor,decisionId:proof?.decisionId ?? null,
            authorityBasisId:proof?.authorityBasisId ?? null,
            rankedCandidateIds:heir.rankedCandidateIds,provenance:'CALIBRATION_ONLY'},
          reasonCodes:['CALIBRATION_ONLY',approved?'CROWN_LEGAL_APPROVAL':noApproval],
        }],
        ...(approved?{selectedCandidateId:candidateId}:{}),
        status:approved?'ACCEPT':'DEFER',
        reasonCodes:['CALIBRATION_ONLY','CROWN_SUCCESSION_REVIEW',
          approved?'EXPLICIT_CROWN_AUTHORITY_AND_HEIR_VERIFIED':noApproval],
        modifierIds:[],ruleVersion:CROWN_SUCCESSION_VERSION,
      })
      if (!hasId(cid)) continue
      const linkedCountry = newIncident
        ? rulerCountry(world,title.titleId,predecessorId,book) : current && countryOf(current)
      const reasons = canCreate
        ? ['CALIBRATION_ONLY','CROWN_SUCCESSION','PREDECESSOR_ID:'+predecessorId,
            ...(death.length === 1?['SOURCE_B003_EVENT:'+death[0]!.eventIds[0]!]:['DEATH_EVENT_UNVERIFIED']),
            ...(linkedCountry?['CROWN_RULER_COUNTRY:'+linkedCountry]:[])]
        : [...(current?.reasonCodes ?? [])]
      if (approved && proof && successor) {
        const caseRecord: LegalCase = {
          caseId:cid,titleId:title.titleId,kind:'SUCCESSION',status:'APPROVED',
          candidatePersonIds:[successor],
          reasonCodes:[...reasons,'CROWN_APPROVAL_DECISION:'+proof.decisionId,
            'CROWN_AUTHORITY_BASIS:'+proof.authorityBasisId],
        }
        const cmd: LegalCaseSetCommand = {
          type:'LEGAL_CASE_SET',commandId:'cmd:crown:approved:'+JSON.stringify([ctx.year,cid]),
          source:{requestId:'req:crown:approved:'+cid+':'+ctx.year,
            year:ctx.year,phase:ctx.phase,sourceRuleId:'A-SUC-04',
            sourceTraceId:ctx.traceId(reviewIndex),sourceIntentId:proof.decisionId},
          legalCase:caseRecord,
        }
        commands.push(cmd)
      } else if (canCreate) {
        const adminId = 'crown:case-record:' + JSON.stringify([ctx.year,cid])
        const adminIndex = traceDrafts.length
        traceDrafts.push({
          year:ctx.year,phase:ctx.phase,ruleId:ctx.ruleId,
          actorRef:{kind:'REGION',id:title.regionId},
          candidates:[{candidateId:adminId,eligible:true,
            inputs:{titleId:title.titleId,caseId:cid,status:'PENDING',provenance:'CALIBRATION_ONLY'},
            reasonCodes:['CALIBRATION_ONLY','CROWN_CASE_RECORDING_ONLY']}],
          selectedCandidateId:adminId,status:'ACCEPT',
          reasonCodes:['CALIBRATION_ONLY','CROWN_CASE_RECORDING_ONLY','NOT_SUCCESSION_APPROVAL'],
          modifierIds:[],ruleVersion:CROWN_SUCCESSION_VERSION,
        })
        const rawCandidates = heir.rankedCandidateIds.filter(id =>
          world.persons.some(p => p.personId === id && p.alive))
        const cmd: LegalCaseSetCommand = {
          type:'LEGAL_CASE_SET',commandId:'cmd:crown:pending:'+JSON.stringify([ctx.year,cid]),
          source:{requestId:'req:crown:pending:'+cid,
            year:ctx.year,phase:ctx.phase,sourceRuleId:'A-SUC-04',
            sourceTraceId:ctx.traceId(adminIndex),
            ...(death.length===1?{sourceIntentId:death[0]!.traceId}:{})},
          legalCase:{caseId:cid,titleId:title.titleId,kind:'SUCCESSION',status:'PENDING',
            candidatePersonIds:rawCandidates,reasonCodes:reasons},
        }
        commands.push(cmd)
      }
    }
    return {...original,commands,traceDrafts}
  }
}

/** A-TIT-07 で王位名義を独立して確定。実効支配・領地・委任・税権は不変。 */
function titleTransfer(base: RuleEvaluator): RuleEvaluator {
  return (world:WorldState,ctx:EvaluationContext):RuleOutcome => {
    // TERRITORIAL側は専用CROWN Traceを読まない（PR #95の所有ファイルを編集しない）。
    const original = base(world,{...ctx,priorTraces:(ctx.priorTraces ?? []).filter(t =>
      !t.reasonCodes.includes('CROWN_SUCCESSION_REVIEW') &&
      !t.reasonCodes.includes('CROWN_CASE_RECORDING_ONLY'))})
    const traceDrafts: DecisionTraceDraft[] = [...original.traceDrafts]
    const commands: DomainCommand[] = [...original.commands]
    const reviews = (ctx.priorTraces ?? []).filter(t =>
      t.ruleId === 'A-SUC-04' && t.year === ctx.year &&
      t.reasonCodes.includes('CROWN_SUCCESSION_REVIEW'))
    for (const review of reviews) {
      const candidate = review.candidates[0]
      const titleId = candidate?.inputs.titleId
      const predecessorId = candidate?.inputs.predecessorPersonId
      const cid = candidate?.inputs.caseId
      if (!hasId(titleId) || !hasId(predecessorId)) continue
      const title = world.titles.find(t => t.titleId === titleId && t.kind === 'CROWN')
      if (!title || !title.valid) continue
      const deceased = world.persons.find(p => p.personId === predecessorId)
      const deadHolder = title.holder.status === 'HELD' &&
        title.holder.personId === predecessorId && deceased && !deceased.alive
      const uncertain = title.holder.status === 'UNDETERMINED'
      if (!deadHolder && !uncertain) continue
      const legalCase = hasId(cid) ? world.legal.cases.find(c => c.caseId === cid &&
        c.titleId === titleId && c.kind === 'SUCCESSION') : undefined
      const successorId = candidate?.inputs.candidatePersonId
      const decisionId = candidate?.inputs.decisionId
      const basisId = candidate?.inputs.authorityBasisId
      const successor = hasId(successorId) ? world.persons.find(p => p.personId === successorId) : undefined
      const approved = review.status === 'ACCEPT' && hasId(decisionId) && hasId(basisId) &&
        legalCase?.status === 'APPROVED' && legalCase.candidatePersonIds.length === 1 &&
        legalCase.candidatePersonIds[0] === successorId && successor?.alive === true &&
        legalCase.reasonCodes.includes('CROWN_APPROVAL_DECISION:'+decisionId) &&
        legalCase.reasonCodes.includes('CROWN_AUTHORITY_BASIS:'+basisId)
      if (!approved && !deadHolder) continue
      const transferIndex = traceDrafts.length
      const candidateId = 'crown:title:' + JSON.stringify([ctx.year,titleId,approved?successorId:'UNDETERMINED'])
      traceDrafts.push({
        year:ctx.year,phase:ctx.phase,ruleId:ctx.ruleId,
        actorRef:{kind:'REGION',id:title.regionId},
        candidates:[{candidateId,eligible:true,
          inputs:{titleId,predecessorPersonId:predecessorId,
            legalCaseId:cid ?? null,successorPersonId:approved?successorId:null,
            sourceASuc04TraceId:review.traceId,
            territoryOrTaxTransferred:false,provenance:'CALIBRATION_ONLY'},
          reasonCodes:['CALIBRATION_ONLY',approved?'CROWN_TITLE_APPROVED_TRANSFER':'CROWN_HOLDER_UNDETERMINED_RECORDING_ONLY']}],
        selectedCandidateId:candidateId,status:'ACCEPT',
        reasonCodes:['CALIBRATION_ONLY',approved?'CROWN_TITLE_APPROVED_TRANSFER':'CROWN_HOLDER_UNDETERMINED_RECORDING_ONLY',
          ...(approved?[]:['NOT_SUCCESSION_APPROVAL'])],
        modifierIds:[],ruleVersion:CROWN_SUCCESSION_VERSION,
      })
      const transfer:LegalTitleTransferCommand={
        type:'LEGAL_TITLE_TRANSFER',
        commandId:'cmd:crown:title:'+JSON.stringify([ctx.year,titleId,approved?successorId:'UNDETERMINED']),
        source:{requestId:'req:crown:title:'+JSON.stringify([ctx.year,titleId]),
          year:ctx.year,phase:ctx.phase,sourceRuleId:'A-TIT-07',
          sourceTraceId:ctx.traceId(transferIndex),
          ...(approved&&hasId(decisionId)?{sourceIntentId:decisionId}:{sourceIntentId:review.traceId})},
        titleId,
        ...(approved&&hasId(successorId)&&hasId(cid)
          ?{toHolder:{status:'HELD' as const,personId:successorId},legalCaseId:cid}
          :{toHolder:{status:'UNDETERMINED' as const,...(hasId(cid)?{legalCaseId:cid}:{})},
            ...(hasId(cid)?{legalCaseId:cid}:{})}),
      }
      commands.push(transfer)
      const countryId = legalCase && countryOf(legalCase)
      const country = world.countries.find(c => c.countryId === countryId)
      if (!country || (country.rulerPersonId !== predecessorId && country.rulerPersonId !== undefined) ||
          (!approved && country.rulerPersonId !== predecessorId) ||
          (approved && !hasId(successorId))) continue
      const countryIndex = traceDrafts.length
      const countryCandidateId = 'crown:ruler:' + JSON.stringify([ctx.year,country.countryId,titleId])
      traceDrafts.push({
        year:ctx.year,phase:ctx.phase,ruleId:ctx.ruleId,
        actorRef:{kind:'COUNTRY',id:country.countryId},
        candidates:[{candidateId:countryCandidateId,eligible:true,
          inputs:{countryId:country.countryId,crownTitleId:titleId,
            successorPersonId:approved?successorId:null,
            legalCaseId:cid ?? null,sourceCrownTransferId:transfer.commandId,
            provenance:'CALIBRATION_ONLY'},reasonCodes:['CALIBRATION_ONLY','EXPLICIT_CROWN_RULER_LINK']}],
        selectedCandidateId:countryCandidateId,status:'ACCEPT',
        reasonCodes:['CALIBRATION_ONLY','EXPLICIT_CROWN_RULER_LINK'],
        modifierIds:[],ruleVersion:CROWN_SUCCESSION_VERSION,
      })
      const ruler:CountryRulerSetCommand={
        type:'COUNTRY_RULER_SET',commandId:'cmd:crown:ruler:'+JSON.stringify([ctx.year,country.countryId,titleId]),
        source:{requestId:'req:crown:ruler:'+JSON.stringify([ctx.year,country.countryId,titleId]),
          year:ctx.year,phase:ctx.phase,sourceRuleId:'A-TIT-07',
          sourceTraceId:ctx.traceId(countryIndex),sourceIntentId:review.traceId},
        countryId:country.countryId,crownTitleId:titleId,predecessorPersonId:predecessorId,
        legalCaseId:cid as Id,...(approved&&hasId(successorId)?{toRulerPersonId:successorId}:{}),
      }
      commands.push(ruler)
    }
    return {...original,traceDrafts,commands}
  }
}

export function createCrownSuccessionEvaluators(
  baseSuccession: RuleEvaluator, baseTitleTransfer: RuleEvaluator, input: Input = {},
): Readonly<{ succession:RuleEvaluator; titleTransfer:RuleEvaluator }> {
  return {
    succession:succession(baseSuccession,input),
    titleTransfer:titleTransfer(baseTitleTransfer),
  }
}
