// B-009: 年次WorldStateの生存者から全ペアを導き、B領域のpair.trust基礎値を累積する。
// 新しい人物にもCALIBRATION_ONLYの初期値を与える。StatModifierはここでは加算しない。
// 初期のPairTrustBaseは1250年などの明示済み基礎関係だけで、毎年の結果はWorldStateに保存する。
import type { DecisionTraceDraft, PairTrustBase, PersonPairTrustSetCommand, RuleOutcome, WorldState } from '../../contracts/index.ts'
import { PAIR_TRUST_DEFINITION } from '../../intervention/stat-registry.ts'
import { pairKey } from '../../intervention/index.ts'
import type { EvaluationContext, RuleEvaluator } from '../../engine/evaluators.ts'
import { EvaluationFailure } from '../../engine/evaluators.ts'

export const B009_RULE_VERSION='b009-worldstate-cumulative-trust-0:CALIBRATION_ONLY'
export type B009Calibration=Readonly<{
  status:'CALIBRATION_ONLY'
  /** 初期関係に明示値がない、子孫ペアも含む信頼基礎値（試験用）。 */
  initialTrust:number
  /** 1年の基礎値増分（試験用）。 */
  annualDelta:number
  /** pair数が超過すると安全停止。黙って先頭だけ更新しない。 */
  maxPairs:number
}>
export const EXPERIMENTAL_B009_CALIBRATION:B009Calibration=Object.freeze({
  status:'CALIBRATION_ONLY',initialTrust:0,annualDelta:1,maxPairs:500,
})
export type B009ValidationResult=
  | Readonly<{ok:true;config:B009Calibration}>
  | Readonly<{ok:false;issues:readonly string[]}>
export function validateB009Calibration(c:B009Calibration):B009ValidationResult{
  const issues:string[]=[]
  if (!c || c.status!=='CALIBRATION_ONLY')return {ok:false,issues:['STATUS_NOT_CALIBRATION_ONLY']}
  if(!Number.isSafeInteger(c.initialTrust) || c.initialTrust<PAIR_TRUST_DEFINITION.min ||
     c.initialTrust>PAIR_TRUST_DEFINITION.max)issues.push('INITIAL_TRUST_OUT_OF_RANGE')
  if(!Number.isSafeInteger(c.annualDelta) || Math.abs(c.annualDelta)>PAIR_TRUST_DEFINITION.max-PAIR_TRUST_DEFINITION.min)issues.push('ANNUAL_DELTA_OUT_OF_RANGE')
  if(!Number.isSafeInteger(c.maxPairs)||c.maxPairs<1||c.maxPairs>10000)issues.push('PAIR_BUDGET_INVALID')
  return issues.length===0 ? {ok:true,config:Object.freeze({...c})} : {ok:false,issues}
}
const cmp=(a:string,b:string)=>a<b?-1:a>b?1:0

export function createB009WorldStateEvaluator(
  initialBase:readonly PairTrustBase[], calibration:B009Calibration=EXPERIMENTAL_B009_CALIBRATION,
):RuleEvaluator {
  const checked=validateB009Calibration(calibration)
  if(!checked.ok)throw new RangeError('B009_CALIBRATION_INVALID:'+checked.issues.join(','))
  if(!Array.isArray(initialBase))throw new RangeError('B009_BASE_NOT_ARRAY')
  const initial=new Map<string,number>()
  for(const e of initialBase){
    const ids=e?.personIds
    if(!Array.isArray(ids)||ids.length!==2||typeof ids[0]!=='string'||typeof ids[1]!=='string'||
      !ids[0]||!ids[1]||ids[0]>=ids[1]||!Number.isSafeInteger(e.value)||
      e.value<PAIR_TRUST_DEFINITION.min||e.value>PAIR_TRUST_DEFINITION.max){
      throw new RangeError('B009_INVALID_BASE_PAIR')
    }
    const key=pairKey([ids[0] as string,ids[1] as string])
    if(initial.has(key))throw new RangeError('B009_DUPLICATE_BASE_PAIR')
    initial.set(key,e.value)
  }
  const c=checked.config
  return (world:WorldState,ctx:EvaluationContext):RuleOutcome=>{
    if(ctx.ruleId!=='B-009'||ctx.phase!==3||world.year!==ctx.year){
      throw new EvaluationFailure('B009の年・フェーズ・RuleID不一致',[{code:'RULE_MISMATCH',message:String(ctx.ruleId)}])
    }
    const persons=world.persons.filter(p=>p.alive).sort((a,b)=>cmp(a.personId,b.personId))
    const n=persons.length*(persons.length-1)/2
    if(!Number.isSafeInteger(n)||n>c.maxPairs){
      throw new EvaluationFailure('B009の更新対象ペアが予算を超過',[
        {code:'PAIR_BUDGET_EXCEEDED',message:n+' > '+c.maxPairs},
      ])
    }
    const existing=new Map((world.pairTrust??[]).map(r=>[pairKey(r.personIds),r]))
    const commands:PersonPairTrustSetCommand[]=[]
    const traceDrafts:DecisionTraceDraft[]=[]
    for(let i=0;i<persons.length;i++)for(let j=i+1;j<persons.length;j++){
      const a=persons[i]!,b=persons[j]!
      const ids=[a.personId,b.personId] as const // personsはID昇順
      const key=pairKey(ids)
      const old=existing.get(key)
      if(old && old.lastUpdatedYear>=ctx.year){
        throw new EvaluationFailure('関係値が既に当年更新済みであり二重更新を拒否',[
          {code:'RELATION_ALREADY_UPDATED',message:key},
        ])
      }
      const prev=old?.value??initial.get(key)??c.initialTrust
      const next=Math.min(PAIR_TRUST_DEFINITION.max,Math.max(PAIR_TRUST_DEFINITION.min,prev+c.annualDelta))
      const traceIndex=traceDrafts.length
      const candidateId='b009:'+JSON.stringify([ctx.year,ids])
      traceDrafts.push({
        year:ctx.year,phase:ctx.phase,ruleId:ctx.ruleId,actorRef:{kind:'PERSON_PAIR',ids},
        candidates:[{
          candidateId,eligible:true,
          inputs:{personIds:[...ids],previousBaseTrust:prev,updatedBaseTrust:next,
            annualDelta:c.annualDelta,baseFrom:old?'PRIOR_WORLDSTATE':initial.has(key)?'INITIAL_EVIDENCE':'NEW_PAIR_CALIBRATION',
            previousUpdateYear:old?.lastUpdatedYear??null,provenance:'CALIBRATION_ONLY'},
          reasonCodes:['CALIBRATION_ONLY',old?'RELATION_CUMULATIVE_UPDATE':'RELATION_CREATED'],
        }],
        selectedCandidateId:candidateId,status:'ACCEPT',
        reasonCodes:['CALIBRATION_ONLY','B009_BASE_TRUST_ONLY','NO_MODIFIER_COMMIT'],
        modifierIds:[],ruleVersion:B009_RULE_VERSION,
      })
      commands.push({
        type:'PERSON_PAIR_TRUST_SET',commandId:'cmd:b009:'+JSON.stringify([ctx.year,ids]),
        source:{requestId:'req:b009:'+JSON.stringify([ctx.year,ids]),year:ctx.year,phase:ctx.phase,
          sourceRuleId:'B-009',sourceTraceId:ctx.traceId(traceIndex)},
        relation:{personIds:ids,value:next,lastUpdatedYear:ctx.year},
      })
    }
    return {ruleId:ctx.ruleId,phase:ctx.phase,commands,requests:[],deferred:[],traceDrafts}
  }
}
