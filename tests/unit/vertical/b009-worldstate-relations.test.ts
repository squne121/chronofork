// B-009人物間信頼の年次状態化。基礎値の継続更新とmodifierの非混入、新生児への生成を検証。
import { describe,expect,it } from 'vitest'
import type { RuleOutcome, WorldState } from '../../../src/simulation/contracts/index.ts'
import { runYear } from '../../../src/simulation/engine/index.ts'
import { createB009WorldStateEvaluator, validateB009Calibration, EXPERIMENTAL_B009_CALIBRATION } from '../../../src/simulation/rules/b/index.ts'
import { validateWorldState } from '../../../src/simulation/validation/index.ts'
import { createSyntheticWorld, P4, P5, SEED } from './b004-branch-fixture.ts'

const relation=(w:WorldState,a:string,b:string)=>(w.pairTrust??[]).find(r=>r.personIds[0]===a&&r.personIds[1]===b)
const evaluator=()=>createB009WorldStateEvaluator([{personIds:[P4,P5],value:10}])
describe('B-009 WorldState関係値の年次累積（CALIBRATION_ONLY）',()=>{
  it('B009は既知ペアと未知ペアに型付きCommandを発行し、1年ずつ累積する',()=>{
    const initial=createSyntheticWorld()
    const e=evaluator()
    const year0=runYear(initial,{seed:SEED,branchId:'first',evaluators:{'B-009':e}})
    expect(year0.status).toBe('COMPLETED')
    if(year0.status!=='COMPLETED')return
    expect(initial.pairTrust).toBeUndefined()
    expect(year0.world.year).toBe(1251)
    expect(relation(year0.world,P4,P5)).toMatchObject({value:11,lastUpdatedYear:1250})
    expect(year0.world.pairTrust).toHaveLength(28) // 8生存者の全ペア
    expect(year0.events).toHaveLength(28)
    expect(year0.traces).toHaveLength(28)
    expect(year0.events.every(ev=>ev.eventType==='PERSON_PAIR_TRUST_SET')).toBe(true)
    expect(year0.events.every(ev=>ev.sourceTraceIds.every(id=>year0.traces.some(t=>t.traceId===id)))).toBe(true)
    expect(year0.traces.every(t=>t.reasonCodes.includes('NO_MODIFIER_COMMIT'))).toBe(true)
    const year1=runYear(year0.world,{seed:SEED,branchId:'second',evaluators:{'B-009':e}})
    expect(year1.status).toBe('COMPLETED')
    if(year1.status!=='COMPLETED')return
    expect(relation(year1.world,P4,P5)).toMatchObject({value:12,lastUpdatedYear:1251})
    expect(year1.world.pairTrust).toHaveLength(28)
    expect(year1.traces.some(t=>t.candidates[0]?.inputs.baseFrom==='PRIOR_WORLDSTATE')).toBe(true)
    expect(validateWorldState(year1.world).ok).toBe(true)
    // branchIdは乱数キー/状態に使わないため変えても同じ意味の結果。
    const again=runYear(initial,{seed:SEED,branchId:'other',evaluators:{'B-009':e}})
    expect(again.status).toBe('COMPLETED')
    if(again.status!=='COMPLETED')return
    expect(again.world).toEqual(year0.world)
    expect(again.traces).toEqual(year0.traces)
    expect(again.events).toEqual(year0.events)
  })
  it('人物が出生すると新ペアが作られ、死亡済みのペアは更新されない',()=>{
    const initial=createSyntheticWorld()
    const first=runYear(initial,{seed:SEED,evaluators:{'B-009':evaluator()}})
    expect(first.status).toBe('COMPLETED')
    if(first.status!=='COMPLETED')return
    const child='synthetic-newborn-from-world'
    const born:WorldState={
      ...first.world,
      persons:[...first.world.persons,{
        personId:child,name:'試験児',sex:'FEMALE',birthYear:1250,alive:true,
        originGroupId:'group-east-elite',houseId:'house-cardon',fatherId:P4,motherId:P5,
        legalDynasty:{status:'UNDETERMINED',reasonCodes:['GAME_01_UNDECIDED']},
      }],
    }
    const second=runYear(born,{seed:SEED,evaluators:{'B-009':evaluator()}})
    expect(second.status).toBe('COMPLETED')
    if(second.status!=='COMPLETED')return
    expect(relation(second.world,P4,child)).toBeUndefined() // ペアは辞書順に正規化される
    const normalized=[P4,child].sort()
    expect(relation(second.world,normalized[0]!,normalized[1]!)).toMatchObject({value:1,lastUpdatedYear:1251})
    expect(second.world.pairTrust?.length).toBe(36)
    // 一人死亡した後は、死亡人物とその既存関係を残すが更新しない。
    const dead:WorldState={...second.world,persons:second.world.persons.map(p=>
      p.personId===P4?{...p,alive:false,deathYear:1251}:p)}
    const after=runYear(dead,{seed:SEED,evaluators:{'B-009':evaluator()}})
    expect(after.status).toBe('COMPLETED')
    if(after.status!=='COMPLETED')return
    expect(relation(after.world,P4,P5)).toEqual(relation(second.world,P4,P5))
    expect(after.events.some(e=>e.involvedRefs.some(r=>r.kind==='PERSON_PAIR'&&r.ids.includes(P4)))).toBe(false)
  })
  it('破損したペア状態、範囲外、重複、未知人物の参照はバリデータが拒否する',()=>{
    const w=createSyntheticWorld()
    const good={personIds:[P4,P5] as const,value:5,lastUpdatedYear:1250}
    expect(validateWorldState({...w,pairTrust:[good]}).ok).toBe(true)
    expect(validateWorldState({...w,pairTrust:[good,good]}).ok).toBe(false)
    expect(validateWorldState({...w,pairTrust:[{...good,value:200}]}).ok).toBe(false)
    expect(validateWorldState({...w,pairTrust:[{...good,personIds:[P5,P4]}]}).ok).toBe(false)
    expect(validateWorldState({...w,pairTrust:[{...good,personIds:[P4,'missing-person']}]}).ok).toBe(false)
    expect(validateWorldState({...w,pairTrust:[{...good,lastUpdatedYear:1251}]}).ok).toBe(false)
    expect(validateWorldState({...w,pairTrust:[{personIds:[P4,P5],value:'invalid',lastUpdatedYear:1250}]}).ok).toBe(false)
    expect(validateWorldState({...w,pairTrust:[{...good,extra:'unknown'}]}).ok).toBe(false)
  })
  it('B-009以外のRuleID・不正値で共通reducerを通した更新はHALTEDし、Eventを作らない',()=>{
    const bogus=(ruleId:'B-009'|'B-008',value:number)=>
      (_world:WorldState,ctx:Parameters<ReturnType<typeof evaluator>>[1]):RuleOutcome=>({
        ruleId,phase:ctx.phase,requests:[],deferred:[],
        traceDrafts:[{
          year:ctx.year,phase:ctx.phase,ruleId,actorRef:{kind:'PERSON_PAIR',ids:[P4,P5]},
          candidates:[{candidateId:'bad',eligible:true,inputs:{},reasonCodes:[]}],
          selectedCandidateId:'bad',status:'ACCEPT',reasonCodes:[],modifierIds:[],
          ruleVersion:'test-bad',
        }],
        commands:[{
          type:'PERSON_PAIR_TRUST_SET',commandId:'bogus-relation',
          source:{requestId:'bogus',year:ctx.year,phase:ctx.phase,
            sourceRuleId:ruleId,sourceTraceId:ctx.traceId(0)},
          relation:{personIds:[P4,P5],value,lastUpdatedYear:ctx.year},
        }],
      })
    for(const [ruleId,value,expected] of [['B-008',5,'WRITE_OWNER_VIOLATION'],['B-009',999,'INVALID_COMMAND']] as const){
      const run=runYear(createSyntheticWorld(),{seed:SEED,evaluators:{[ruleId]:bogus(ruleId,value)}})
      expect(run.status).toBe('HALTED')
      if(run.status==='HALTED'){
        expect(run.halt.code).toBe('OUTCOME_REJECTED')
        expect(run.halt.rejections[0]?.code).toBe(expected)
        expect(run.world.pairTrust).toBeUndefined()
      }
    }
  })
  it('CALIBRATION_ONLY係数やB009ペア計算予算は安全に拒否する',()=>{
    expect(validateB009Calibration({...EXPERIMENTAL_B009_CALIBRATION,annualDelta:300}).ok).toBe(false)
    expect(validateB009Calibration({...EXPERIMENTAL_B009_CALIBRATION,maxPairs:0}).ok).toBe(false)
    expect(validateB009Calibration(EXPERIMENTAL_B009_CALIBRATION).ok).toBe(true)
    const e=createB009WorldStateEvaluator([],{...EXPERIMENTAL_B009_CALIBRATION,maxPairs:1})
    const run=runYear(createSyntheticWorld(),{seed:SEED,evaluators:{'B-009':e}})
    expect(run.status).toBe('HALTED')
    if(run.status==='HALTED')expect(run.halt).toMatchObject({code:'EVALUATION_FAILED',ruleId:'B-009'})
  })
})
