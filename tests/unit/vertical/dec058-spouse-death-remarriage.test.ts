// DEC-058: B-003確定自然死からA-LEG-01で婚姻終了し、翌年以降の再婚を判定。
// 寿命・契約効用はCALIBRATION_ONLY。将来の婚姻成功年を固定するルールではない。
import { describe, expect, it } from 'vitest'
import { createExperimentalWorld, createExperimentalOrdinaryLegalTrial } from '../../../src/scenario/experimental/index.ts'
import { createAutonomousCalibrationEvaluators } from '../../../src/simulation/autonomy/index.ts'
import type { AutonomyCalibration } from '../../../src/simulation/autonomy/index.ts'
import type { WorldState } from '../../../src/simulation/contracts/index.ts'
import { runYear } from '../../../src/simulation/engine/index.ts'
import { withSpouseDeathDissolution } from '../../../src/simulation/rules/a/aleg01-spouse-death.ts'
import type { RuleEvaluator } from '../../../src/simulation/engine/index.ts'

const P2='person-exp-02',P4='person-exp-04',P5='person-exp-05'
const marriageId='marriage:earlier-p4p5'
const trial=createExperimentalOrdinaryLegalTrial()
const AUTO:AutonomyCalibration={
  status:'CALIBRATION_ONLY',
  birth:{minMotherAge:18,maxMotherAge:32,minFatherAge:18,chancePermille:1000},
  death:{minAge:60,riskStartAge:59,basePermille:0,increasePerYearPermille:1000,maxPermille:1000},
  marriage:{minAdultAge:18,maxCandidatePairs:500},
}
const world1280=():WorldState=>{
  const w=createExperimentalWorld()
  return {...w,year:1280,legal:{...w.legal,marriages:[{
    marriageId,personIds:[P4,P5] as [string,string],status:'ACTIVE' as const,registeredYear:1250,
  }]}}
}
const config=(world:WorldState, enabled:boolean)=>{
  const r=createAutonomousCalibrationEvaluators({
    branchStartWorld:world,ledger:[],
    trustBase:[{personIds:[P2,P5] as const,value:40}],
    nextgenMarriage:{book:trial.book,laws:trial.laws,calibration:{
      status:'CALIBRATION_ONLY',consentThreshold:15,ownDynastyBonus:2,
      otherDynastyCost:0,titleWeight:0,noClauseCost:-20,supportWeight:0,
    }},
    spouseDeathDissolution:enabled,autonomy:AUTO,
  })
  if(!r.ok)throw Error(r.issues.join(','))
  return r.evaluators
}
const completed=(r:ReturnType<typeof runYear>)=>{
  if(r.status!=='COMPLETED')throw Error('HALTED: '+JSON.stringify(r.halt))
  return r
}
describe('DEC-058 配偶者死亡時の婚姻終了と翌年再婚',()=>{
  it('当年B-003で死亡した配偶者の婚姻はA-LEG-01でDISSOLVED、Event/Traceに理由を残す',()=>{
    const w=world1280()
    const r=completed(runYear(w,{seed:1,branchId:'A0',evaluators:config(w,true)}))
    const married=r.world.legal.marriages.find(m=>m.marriageId===marriageId)!
    expect(married).toMatchObject({status:'DISSOLVED',dissolvedYear:1280})
    expect(w.legal.marriages[0]?.status).toBe('ACTIVE')
    const death=r.events.find(e=>e.eventType==='PERSON_DEATH'&&e.involvedRefs.some(i=>i.kind==='PERSON'&&i.id===P4))
    const dissolve=r.events.find(e=>e.eventType==='MARRIAGE_DISSOLVE')
    expect(death).toBeDefined()
    expect(dissolve).toBeDefined()
    const trace=r.traces.find(t=>t.traceId===dissolve?.sourceTraceIds[0])!
    expect(trace).toMatchObject({ruleId:'A-LEG-01',status:'ACCEPT'})
    expect(trace.reasonCodes).toContain('DEC_058_SPOUSE_DEATH')
    expect(trace.candidates[0]?.inputs.sourceB003TraceId).toBe(death?.sourceTraceIds[0])
    expect(trace.eventIds).toContain(dissolve?.eventId)
    expect(r.events.filter(e=>e.eventType==='MARRIAGE_REGISTER').length).toBe(0) // 当年再婚しない
  })
  it('翌年の年初に終了履歴を保持したまま、生存者の新しい相手との婚姻を審査できる',()=>{
    const w=world1280()
    const first=completed(runYear(w,{seed:1,branchId:'A0',evaluators:config(w,true)}))
    const second=completed(runYear(first.world,{seed:1,branchId:'A0',evaluators:config(first.world,true)}))
    expect(second.world.legal.marriages.find(m=>m.marriageId===marriageId)).toMatchObject({
      status:'DISSOLVED',dissolvedYear:1280,
    })
    const newMarriage=second.world.legal.marriages.find(m=>m.registeredYear===1281&&
      m.personIds.includes(P2)&&m.personIds.includes(P5))
    expect(newMarriage).toBeDefined()
    expect(newMarriage?.status).toBe('ACTIVE')
    expect(second.events.filter(e=>e.eventType==='MARRIAGE_DISSOLVE').length).toBe(0)
    expect(runYear(first.world,{seed:1,branchId:'A0',evaluators:config(first.world,true)})).toEqual(second)
  })
  it('有効婚姻を登録したまま、死亡Event根拠なしに婚姻を終了させない',()=>{
    const w=world1280()
    const dead:WorldState={...w,persons:w.persons.map(p=>p.personId===P4?
      {...p,alive:false,deathYear:1280}:p)}
    const base:RuleEvaluator=(_w,ctx)=>({ruleId:ctx.ruleId,phase:ctx.phase,
      commands:[],requests:[],responses:[],deferred:[],traceDrafts:[]})
    const out=withSpouseDeathDissolution(base)(dead,{
      year:1280,phase:3,ruleId:'A-LEG-01',seed:1,branchId:'A0',
      priorTraces:[],marriageQueries:[],
      traceId:i=>'trace:aleg01:'+i,random:()=>0,
    })
    expect(out.commands).toHaveLength(0)
    expect(out.traceDrafts).toMatchObject([{
      status:'DEFER',reasonCodes:['CALIBRATION_ONLY','DEC_058_SPOUSE_DEATH','SPOUSE_DEATH_PROOF_NOT_UNIQUE'],
    }])
  })
})
