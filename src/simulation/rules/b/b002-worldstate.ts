// B-002: 現在の有効な婚姻、存命父母、年齢、C004出生枠、決定的RNGから出生を毎年判定。
// 年・子IDを指定した出生予定表は不要。父系/母系の法的帰属は推定しない（GAME-01）。
// 確率・House所属・子の仮表示名はすべてCALIBRATION_ONLY。
import type { DecisionTraceDraft, Id, PersonBirthCommand, RuleOutcome, WorldState } from '../../contracts/index.ts'
import type { EvaluationContext, RuleEvaluator } from '../../engine/evaluators.ts'
import { EvaluationFailure } from '../../engine/evaluators.ts'
import type { AutonomyCalibration } from '../../autonomy/config.ts'
import { checkAutonomyCalibration } from '../../autonomy/config.ts'

export const B002_AUTONOMOUS_VERSION = 'b002-worldstate-marriage-fertility-0:CALIBRATION_ONLY'
const cmp = (a:string,b:string) => a<b?-1:a>b?1:0

/** parent/marriage/yearのみを使う。枝番号や走査順を混ぜない。 */
export const childIdForMarriageYear = (marriageId:Id,fatherId:Id,motherId:Id,year:number):Id =>
  'person:b002:auto:'+JSON.stringify([year,marriageId,fatherId,motherId])

export function createB002WorldStateEvaluator(input:AutonomyCalibration):RuleEvaluator {
  const c=checkAutonomyCalibration(input).birth
  const evaluator:RuleEvaluator=(world:WorldState,ctx:EvaluationContext):RuleOutcome=>{
    if(ctx.ruleId!=='B-002'||ctx.phase!==3||ctx.year!==world.year) {
      throw new EvaluationFailure('B-002は当年フェーズ3でのみ評価可能',[{code:'RULE_MISMATCH',message:String(ctx.ruleId)}])
    }
    const commands:PersonBirthCommand[]=[]
    const traceDrafts:DecisionTraceDraft[]=[]
    const pendingByGroup=new Map<Id,number>()
    const marriages=world.legal.marriages.filter(m=>m.status==='ACTIVE')
      .sort((a,b)=>cmp(a.marriageId,b.marriageId))
    for(const m of marriages){
      const ps=m.personIds.map(id=>world.persons.find(p=>p.personId===id))
      const father=ps.find(p=>p?.sex==='MALE')
      const mother=ps.find(p=>p?.sex==='FEMALE')
      const pairValid=ps.length===2&&father!==undefined&&mother!==undefined&&father.personId!==mother.personId
      const ageMother=mother===undefined?null:ctx.year-mother.birthYear
      const ageFather=father===undefined?null:ctx.year-father.birthYear
      const slot=mother===undefined?undefined:world.demographics.cohortSlots.find(s=>s.groupId===mother.originGroupId&&s.year===ctx.year)
      const chanceKey='b002:fertility:CALIBRATION_ONLY:'+m.marriageId
      const birthDraw=ctx.random({stream:'ENDOGENOUS',actorId:m.personIds[0],targetId:m.personIds[1],eventKey:chanceKey})
      const sexKey='b002:sex:CALIBRATION_ONLY:'+m.marriageId
      const sexDraw=ctx.random({stream:'ENDOGENOUS',actorId:m.personIds[0],targetId:m.personIds[1],eventKey:sexKey})
      const childSex=sexDraw<0.5?'MALE' as const:'FEMALE' as const
      let reason='BIRTH_RNG_NOT_SELECTED'
      if(!pairValid||!father||!mother||!father.alive||!mother.alive) reason='PARENTS_UNAVAILABLE'
      else if(m.registeredYear>ctx.year) reason='MARRIAGE_NOT_YET_VALID'
      else if(ageMother===null||ageMother<c.minMotherAge||ageMother>c.maxMotherAge||
        ageFather===null||ageFather<c.minFatherAge) reason='AGE_OUTSIDE_CALIBRATION_WINDOW'
      else if(!slot) reason='BIRTH_COHORT_SLOT_MISSING'
      else if(birthDraw>=c.chancePermille/1000) reason='BIRTH_RNG_NOT_SELECTED'
      else if(slot.claimedBirths+(pendingByGroup.get(mother.originGroupId)??0)>=slot.birthSlots) reason='BIRTH_COHORT_SLOT_EXHAUSTED'
      else reason='WORLDSTATE_RNG_BIRTH_SELECTED'
      const accepted=reason==='WORLDSTATE_RNG_BIRTH_SELECTED'
      const id=father&&mother?childIdForMarriageYear(m.marriageId,father.personId,mother.personId,ctx.year):
        'person:b002:unresolved:'+JSON.stringify([ctx.year,m.marriageId])
      const index=traceDrafts.length
      traceDrafts.push({
        year:ctx.year,phase:ctx.phase,ruleId:ctx.ruleId,
        actorRef:{kind:'PERSON',id},
        candidates:[{
          candidateId:'b002:auto:'+JSON.stringify([ctx.year,m.marriageId]),eligible:accepted,
          inputs:{marriageId:m.marriageId,personIds:[...m.personIds],fatherId:father?.personId??null,
            motherId:mother?.personId??null,motherAge:ageMother,fatherAge:ageFather,
            fertilityChancePermille:c.chancePermille,childPersonId:id,childSex,
            originGroupId:mother?.originGroupId??null,houseId:mother?.houseId??null,
            birthSlots:slot?.birthSlots??null,claimedBirths:slot?.claimedBirths??null,
            provenance:'CALIBRATION_ONLY'},
          reasonCodes:['CALIBRATION_ONLY',reason],
        }],
        ...(accepted?{selectedCandidateId:'b002:auto:'+JSON.stringify([ctx.year,m.marriageId])}:{}),
        status:accepted?'ACCEPT':reason==='BIRTH_RNG_NOT_SELECTED'?'REJECT':'DEFER',
        reasonCodes:['CALIBRATION_ONLY',reason],
        modifierIds:[],
        random:{stream:'ENDOGENOUS',key:chanceKey,value:birthDraw},
        ruleVersion:B002_AUTONOMOUS_VERSION,
      })
      if(!accepted||!father||!mother)continue
      pendingByGroup.set(mother.originGroupId,(pendingByGroup.get(mother.originGroupId)??0)+1)
      const key=JSON.stringify([ctx.year,m.marriageId,father.personId,mother.personId])
      commands.push({
        type:'PERSON_BIRTH',
        commandId:'cmd:b002:auto:'+key,
        source:{requestId:'req:b002:auto:'+key,year:ctx.year,phase:ctx.phase,sourceRuleId:'B-002',
          sourceTraceId:ctx.traceId(index),sourceIntentId:m.marriageId},
        cohortGroupId:mother.originGroupId,cohortYear:ctx.year,
        person:{
          personId:id,
          name:'試験用自律児 '+ctx.year+' ('+m.marriageId+')',
          sex:childSex,birthYear:ctx.year,alive:true,
          originGroupId:mother.originGroupId,houseId:mother.houseId,
          fatherId:father.personId,motherId:mother.personId,
          legalDynasty:{status:'UNDETERMINED',reasonCodes:['GAME_01_NO_DEFAULT_DYNASTY','A_DYN_02_PENDING']},
        },
      })
    }
    return {ruleId:ctx.ruleId,phase:ctx.phase,commands,requests:[],deferred:[],traceDrafts}
  }
  return evaluator
}
