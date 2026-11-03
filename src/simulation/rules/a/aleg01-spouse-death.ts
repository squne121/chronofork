// DEC-058: B-003が当年に確定した自然死亡に限り、その婚姻をA-LEG-01で法的終了させる。
// 婚姻交渉・登録は既存評価器に委任し、同年の再婚はしない（B-004は終了前に評価済み）。
import type {
  DecisionTrace, DecisionTraceDraft, MarriageDissolveCommand, RuleOutcome, WorldState,
} from '../../contracts/index.ts'
import type { EvaluationContext, RuleEvaluator } from '../../engine/evaluators.ts'
import { EvaluationFailure } from '../../engine/evaluators.ts'

export const SPOUSE_DEATH_DISSOLUTION_VERSION='aleg01-spouse-death-dissolution-1:CALIBRATION_ONLY'
const cmp=(a:string,b:string)=>a<b?-1:a>b?1:0
const confirmedDeath=(traces:readonly DecisionTrace[],personId:string,year:number):DecisionTrace|undefined=>{
  const candidates=traces.filter(t=>t.ruleId==='B-003'&&t.year===year&&
    t.status==='ACCEPT'&&t.actorRef.kind==='PERSON'&&t.actorRef.id===personId&&
    t.eventIds.length>0&&t.candidates.some(c=>c.inputs.personId===personId))
  return candidates.length===1?candidates[0]:undefined
}
export function withSpouseDeathDissolution(marriage:RuleEvaluator):RuleEvaluator{
  return (world:WorldState,ctx:EvaluationContext):RuleOutcome=>{
    if(ctx.ruleId!=='A-LEG-01'||ctx.phase!==3||world.year!==ctx.year)
      throw new EvaluationFailure('婚姻終了の年・フェーズ・RuleIDが不一致',[
        {code:'RULE_MISMATCH',message:'A-LEG-01 phase3'}])
    const prior=ctx.priorTraces??[]
    const base=marriage(world,ctx)
    const cmds:MarriageDissolveCommand[]=[]
    const drafts:DecisionTraceDraft[]=[]
    const marriages=world.legal.marriages.filter(m=>m.status==='ACTIVE')
      .slice().sort((a,b)=>cmp(a.marriageId,b.marriageId))
    for(const m of marriages){
      const deceased=world.persons.filter(p=>m.personIds.includes(p.personId)&&
        !p.alive&&p.deathYear===ctx.year).sort((a,b)=>cmp(a.personId,b.personId))
      if(deceased.length===0)continue
      const deathProofs=deceased.map(p=>confirmedDeath(prior,p.personId,ctx.year))
      // 同じ年に両配偶者が死亡しても婚姻を未終了のまま残さない。双方の死亡を個別に確認する。
      const canDissolve=deceased.length>=1&&deathProofs.every(p=>p!==undefined)
      const index=base.traceDrafts.length+drafts.length
      const reason=canDissolve?'CONFIRMED_SPOUSE_DEATH':'SPOUSE_DEATH_PROOF_NOT_UNIQUE'
      const candidateId='aleg01:spouse-death:'+JSON.stringify([ctx.year,m.marriageId])
      drafts.push({
        year:ctx.year,phase:ctx.phase,ruleId:ctx.ruleId,
        actorRef:{kind:'PERSON_PAIR',ids:m.personIds},
        candidates:[{
          candidateId,eligible:canDissolve,
          inputs:{marriageId:m.marriageId,deceasedPersonId:deceased[0]?.personId??null,
            sourceB003TraceId:deathProofs[0]?.traceId??null,
            deathYear:ctx.year,provenance:'CALIBRATION_ONLY'},
          reasonCodes:['CALIBRATION_ONLY',reason],
        }],
        ...(canDissolve?{selectedCandidateId:candidateId}:{}),
        status:canDissolve?'ACCEPT':'DEFER',
        reasonCodes:['CALIBRATION_ONLY','DEC_058_SPOUSE_DEATH',reason],
        modifierIds:[],ruleVersion:SPOUSE_DEATH_DISSOLUTION_VERSION,
      })
      if(!canDissolve)continue
      const p=deceased[0]!,proof=deathProofs[0]!
      cmds.push({
        type:'MARRIAGE_DISSOLVE',
        commandId:'cmd:aleg01:spouse-death:'+JSON.stringify([ctx.year,m.marriageId,p.personId]),
        source:{
          requestId:'req:aleg01:spouse-death:'+JSON.stringify([ctx.year,m.marriageId]),
          year:ctx.year,phase:ctx.phase,sourceRuleId:'A-LEG-01',
          sourceTraceId:ctx.traceId(index),sourceIntentId:proof.traceId,
        },
        marriageId:m.marriageId,deceasedPersonId:p.personId,
        dissolvedYear:ctx.year,cause:'SPOUSE_DEATH',
      })
    }
    return {...base,commands:[...base.commands,...cmds],traceDrafts:[...base.traceDrafts,...drafts]}
  }
}
