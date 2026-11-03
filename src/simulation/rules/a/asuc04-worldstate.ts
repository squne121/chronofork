// A-SUC-04: B003の実死亡Event後、残されたTitleと現在の子孫からPENDINGの候補集合を記録。
// 成立させる相続順位・承認権限はGAME-02未承認。承認を生成せず、必ずDEFERする。
// 既存A-TIT07が保有者UNDETERMINEDへ移すための根拠を、当年Trace/Eventで公開する。
import type { DecisionTraceDraft, Id, LegalCaseSetCommand, RuleOutcome, WorldState } from '../../contracts/index.ts'
import type { EvaluationContext, RuleEvaluator } from '../../engine/evaluators.ts'
import { EvaluationFailure } from '../../engine/evaluators.ts'

export const ASUC04_AUTONOMOUS_VERSION='asuc04-worldstate-heirs-pending-0:CALIBRATION_ONLY'
const cmp=(a:string,b:string)=>a<b?-1:a>b?1:0
const caseId=(year:number,titleId:Id)=>'case:asuc04:auto:'+JSON.stringify([year,titleId])

export const createASuc04WorldStateEvaluator=():RuleEvaluator=>(world:WorldState,ctx:EvaluationContext):RuleOutcome=>{
  if(ctx.ruleId!=='A-SUC-04'||ctx.phase!==4||ctx.year!==world.year){
    throw new EvaluationFailure('A-SUC-04は当年フェーズ4でのみ評価可能',[{code:'RULE_MISMATCH',message:String(ctx.ruleId)}])
  }
  const deaths=(ctx.priorTraces??[]).filter(t=>
    t.ruleId==='B-003'&&t.year===ctx.year&&t.actorRef.kind==='PERSON'&&t.status==='ACCEPT'&&t.eventIds.length===1)
  const deathById=new Map<Id,typeof deaths[number]>(deaths.map(t=>
    [t.actorRef.kind==='PERSON'?t.actorRef.id:'',t]))
  const titles=world.titles.filter(t=>{
    if(t.kind!=='TERRITORIAL'||t.holder.status!=='HELD')return false
    return deathById.has(t.holder.personId)
  }).sort((a,b)=>cmp(a.titleId,b.titleId))
  const traceDrafts:DecisionTraceDraft[]=[]
  const commands:LegalCaseSetCommand[]=[]
  for(const title of titles){
    if(title.holder.status!=='HELD')continue
    const predecessorId=title.holder.personId
    const predecessor=world.persons.find(p=>p.personId===predecessorId)
    if(!predecessor||predecessor.alive||predecessor.deathYear!==ctx.year){
      throw new EvaluationFailure('死亡済みのTitle保持者とB003の死亡記録が不一致',[{code:'DEATH_TITLE_MISMATCH',message:title.titleId}])
    }
    const death=deathById.get(predecessor.personId)!
    const survivors=world.persons.filter(p=>p.alive&&(p.fatherId===predecessor.personId||p.motherId===predecessor.personId))
      .sort((a,b)=>cmp(a.personId,b.personId))
    const previous=world.legal.cases.find(c=>c.titleId===title.titleId&&c.kind==='SUCCESSION')
    const canRecord=previous===undefined&&title.valid&&title.hereditary&&title.recognition.status==='ACTIVE'
    const reason=!title.valid||!title.hereditary||title.recognition.status!=='ACTIVE'
      ?'TITLE_NOT_ACTIVE_HEREDITARY':previous?'EXISTING_CASE_REQUIRES_REVIEW':'GAME_02_SUCCESSION_AUTHORITY_UNDETERMINED'
    const cid=previous?.caseId??caseId(ctx.year,title.titleId)
    const candidateId='asuc04:auto:'+JSON.stringify([ctx.year,title.titleId])
    traceDrafts.push({
      year:ctx.year,phase:ctx.phase,ruleId:ctx.ruleId,
      actorRef:{kind:'REGION',id:title.regionId},
      candidates:[{
        candidateId,eligible:false,
        inputs:{titleId:title.titleId,predecessorPersonId:predecessor.personId,
          sourceB003TraceId:death.traceId,sourceB003EventIds:[...death.eventIds],
          caseId:canRecord?cid:previous?.caseId??null,
          decisionId:null,candidatePersonId:null,
          proposedHeirPersonIds:survivors.map(p=>p.personId),
          proposedHeirLegalDynasties:survivors.map(p=>p.legalDynasty.status==='DETERMINED'
            ?p.legalDynasty.dynastyId:'UNDETERMINED'),
          existingLegalCaseStatus:previous?.status??null,grantBasisId:title.grantBasisId,
          provenance:'CALIBRATION_ONLY'},
        reasonCodes:['CALIBRATION_ONLY',reason],
      }],
      status:'DEFER',
      reasonCodes:['CALIBRATION_ONLY','AUTONOMOUS_CANDIDATE_DISCOVERY_ONLY',reason],
      modifierIds:[],ruleVersion:ASUC04_AUTONOMOUS_VERSION,
    })
    if(!canRecord)continue
    // 管理記録としてのACCEPTは合法相続の承認ではない。
    const adminIndex=traceDrafts.length
    const adminId='asuc04:auto:case-record:'+JSON.stringify([ctx.year,title.titleId])
    traceDrafts.push({
      year:ctx.year,phase:ctx.phase,ruleId:ctx.ruleId,
      actorRef:{kind:'REGION',id:title.regionId},
      candidates:[{
        candidateId:adminId,eligible:true,
        inputs:{titleId:title.titleId,caseId:cid,recordStatus:'PENDING',
          candidatePersonIds:survivors.map(p=>p.personId),provenance:'CALIBRATION_ONLY'},
        reasonCodes:['CALIBRATION_ONLY','LEGAL_CASE_RECORDING_ONLY'],
      }],
      selectedCandidateId:adminId,status:'ACCEPT',
      reasonCodes:['CALIBRATION_ONLY','LEGAL_CASE_RECORDING_ONLY','NOT_SUCCESSION_APPROVAL'],
      modifierIds:[],ruleVersion:ASUC04_AUTONOMOUS_VERSION,
    })
    commands.push({
      type:'LEGAL_CASE_SET',
      commandId:'cmd:asuc04:auto:'+JSON.stringify([ctx.year,title.titleId]),
      source:{requestId:'req:asuc04:auto:'+JSON.stringify([ctx.year,title.titleId]),
        year:ctx.year,phase:ctx.phase,sourceRuleId:'A-SUC-04',
        sourceTraceId:ctx.traceId(adminIndex),sourceIntentId:death.traceId},
      legalCase:{caseId:cid,titleId:title.titleId,kind:'SUCCESSION',status:'PENDING',
        candidatePersonIds:survivors.map(p=>p.personId),
        reasonCodes:['CALIBRATION_ONLY','GAME_02_UNAPPROVED','PREDECESSOR_ID:'+predecessor.personId,'SOURCE_B003_EVENT:'+death.eventIds[0]!]},
    })
  }
  return {ruleId:ctx.ruleId,phase:ctx.phase,commands,requests:[],deferred:[],traceDrafts}
}
