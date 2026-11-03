// B-003: 生存人物の年齢、C-004自然死亡枠、決定的ENDOGENOUS抽選から毎年自然死を評価。
// 未来の死亡年/personIdを列挙しない。確率はCALIBRATION_ONLYで、公式の寿命規則ではない。
import type { DecisionTraceDraft, Id, PersonDeathCommand, RuleOutcome, WorldState } from '../../contracts/index.ts'
import type { EvaluationContext, RuleEvaluator } from '../../engine/evaluators.ts'
import { EvaluationFailure } from '../../engine/evaluators.ts'
import type { AutonomyCalibration } from '../../autonomy/config.ts'
import { checkAutonomyCalibration } from '../../autonomy/config.ts'

export const B003_AUTONOMOUS_VERSION = 'b003-worldstate-mortality-0:CALIBRATION_ONLY'
const cmp = (a: string, b: string) => a < b ? -1 : a > b ? 1 : 0

/** 生存者の年齢とC004枠を参照し、全人物に毎年独立した鍵で抽選する。 */
export function createB003WorldStateEvaluator(input: AutonomyCalibration): RuleEvaluator {
  const c = checkAutonomyCalibration(input).death
  const evaluator: RuleEvaluator = (world: WorldState, ctx: EvaluationContext): RuleOutcome => {
    if (ctx.ruleId !== 'B-003' || ctx.phase !== 3 || ctx.year !== world.year) {
      throw new EvaluationFailure('B-003は当年フェーズ3でのみ評価可能', [{ code: 'RULE_MISMATCH', message: String(ctx.ruleId) }])
    }
    const candidates = world.persons.filter(p => p.alive).sort((a,b)=>cmp(a.personId,b.personId))
    const pendingByGroup = new Map<Id,number>()
    const commands: PersonDeathCommand[] = []
    const traceDrafts: DecisionTraceDraft[] = []
    for (const p of candidates) {
      const age = ctx.year - p.birthYear
      const slot = world.demographics.cohortSlots.find(s=>s.groupId===p.originGroupId && s.year===ctx.year)
      const rate = Math.min(c.maxPermille,
        c.basePermille + Math.max(0,age-c.riskStartAge)*c.increasePerYearPermille)
      const randomKey = 'b003:age-risk:CALIBRATION_ONLY'
      const draw = ctx.random({ stream:'ENDOGENOUS', actorId:p.personId, eventKey:randomKey })
      let reason:string
      if (age < c.minAge) reason='BELOW_MIN_MORTALITY_AGE'
      else if (!slot) reason='NATURAL_DEATH_SLOT_MISSING'
      else if (draw >= rate/1000) reason='RNG_NOT_SELECTED'
      else if (slot.claimedDeaths + (pendingByGroup.get(p.originGroupId)??0)>=slot.deathSlots) reason='NATURAL_DEATH_SLOT_EXHAUSTED'
      else reason='AGE_RNG_DEATH_SELECTED'
      const accepted = reason === 'AGE_RNG_DEATH_SELECTED'
      const index = traceDrafts.length
      traceDrafts.push({
        year:ctx.year,phase:ctx.phase,ruleId:ctx.ruleId,
        actorRef:{kind:'PERSON',id:p.personId},
        candidates:[{
          candidateId:'b003:auto:'+JSON.stringify([ctx.year,p.personId]),eligible:accepted,
          inputs:{personId:p.personId,age,year:ctx.year,originGroupId:p.originGroupId,
            basePermille:c.basePermille,increasePerYearPermille:c.increasePerYearPermille,
            riskStartAge:c.riskStartAge,maxPermille:c.maxPermille,
            riskPermille:rate,deathSlots:slot?.deathSlots??null,claimedDeaths:slot?.claimedDeaths??null,
            provenance:'CALIBRATION_ONLY'},
          reasonCodes:['CALIBRATION_ONLY',reason],
        }],
        ...(accepted?{selectedCandidateId:'b003:auto:'+JSON.stringify([ctx.year,p.personId])}:{}),
        status:accepted?'ACCEPT':reason==='NATURAL_DEATH_SLOT_MISSING'?'DEFER':'REJECT',
        reasonCodes:['CALIBRATION_ONLY',reason],
        modifierIds:[],
        random:{stream:'ENDOGENOUS',key:randomKey,value:draw},
        ruleVersion:B003_AUTONOMOUS_VERSION,
      })
      if (!accepted) continue
      pendingByGroup.set(p.originGroupId,(pendingByGroup.get(p.originGroupId)??0)+1)
      const key=JSON.stringify([ctx.year,p.personId])
      commands.push({
        type:'PERSON_DEATH',
        commandId:'cmd:b003:auto:'+key,
        source:{requestId:'req:b003:auto:'+key,year:ctx.year,phase:ctx.phase,
          sourceRuleId:'B-003',sourceTraceId:ctx.traceId(index)},
        personId:p.personId,deathYear:ctx.year,cause:'NATURAL',
      })
    }
    return {ruleId:ctx.ruleId,phase:ctx.phase,commands,requests:[],deferred:[],traceDrafts}
  }
  return evaluator
}
