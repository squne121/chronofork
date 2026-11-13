// Issue #120: 小規模fixtureで3世代の実B-002出生・婚姻参照を検証する。
// 婚姻の設定と年の跳躍は試験条件（CALIBRATION_ONLY）であり、歴史・法制の成功を偽装しない。
import { describe, expect, it } from 'vitest'
import type { Id, Person, WorldState } from '../../../src/simulation/contracts/index.ts'
import { createExperimentalWorld } from '../../../src/scenario/experimental/index.ts'
import { runYear } from '../../../src/simulation/engine/index.ts'
import { stableGeneratedId, GENERATED_ID_DOMAINS }
  from '../../../src/simulation/engine/stable-generated-id.ts'
import { childIdForMarriageYear, createB002WorldStateEvaluator }
  from '../../../src/simulation/rules/b/b002-worldstate.ts'
import { ordinaryMarriageIdForPairYear }
  from '../../../src/simulation/rules/a/aleg01-ordinary.ts'
import type { AutonomyCalibration } from '../../../src/simulation/autonomy/config.ts'
import { validateWorldState } from '../../../src/simulation/validation/index.ts'

const SEED=20260101
const YEARS=[1250,1270,1290] as const
const CONFIG:AutonomyCalibration={
  status:'CALIBRATION_ONLY',
  birth:{minMotherAge:18,maxMotherAge:32,minFatherAge:18,chancePermille:1000},
  death:{minAge:60,riskStartAge:59,basePermille:0,increasePerYearPermille:1000,maxPermille:1000},
  marriage:{minAdultAge:18,maxCandidatePairs:500},
}
const pair=(a:Id,b:Id):readonly [Id,Id]=>a<b?[a,b]:[b,a]
type Generation=Readonly<{
  year:number
  marriageId:Id
  marriagePersonIds:readonly [Id,Id]
  child:Person
  result:Extract<ReturnType<typeof runYear>,{status:'COMPLETED'}>
}>

function replay(branchId:string){
  let world:WorldState=createExperimentalWorld()
  let father=world.persons.find(p=>p.personId==='person-exp-04')!
  let mother=world.persons.find(p=>p.personId==='person-exp-05')!
  const generations:Generation[]=[]
  for(const [i,year] of YEARS.entries()){
    const personIds=pair(father.personId,mother.personId)
    const marriageId=ordinaryMarriageIdForPairYear(year,personIds)
    const marriage={marriageId,personIds,registeredYear:year,status:'ACTIVE' as const}
    // B-002へ現実のC004枠を「計算済」と偽装せず、受入fixtureが提供した枠を明示する。
    const staged:WorldState={
      ...world,year,
      legal:{...world.legal,marriages:[...world.legal.marriages,marriage]},
      demographics:{...world.demographics,cohortSlots:[{
        groupId:mother.originGroupId,year,birthSlots:10,deathSlots:0,claimedBirths:0,claimedDeaths:0,
      }]},
    }
    const run=runYear(staged,{seed:SEED,branchId,evaluators:{'B-002':createB002WorldStateEvaluator(CONFIG)}})
    if(run.status!=='COMPLETED')throw new Error('generation '+i+': '+JSON.stringify(run.halt))
    const childId=childIdForMarriageYear(marriageId,father.personId,mother.personId,year)
    const child=run.world.persons.find(p=>p.personId===childId)
    if(!child)throw new Error('B002 child not found: '+i)
    generations.push({year,marriageId,marriagePersonIds:personIds,child,result:run})
    world=run.world
    if(i<YEARS.length-1){
      const mate:Person={
        personId:'fixture:unrelated-mate:'+i,name:'試験用配偶者 '+i,
        sex:child.sex==='MALE'?'FEMALE':'MALE',birthYear:year-5,
        alive:true,originGroupId:mother.originGroupId,houseId:mother.houseId,
        legalDynasty:{status:'UNDETERMINED',reasonCodes:['CALIBRATION_ONLY']},
      }
      world={...world,persons:[...world.persons,mate]}
      father=child.sex==='MALE'?child:mate
      mother=child.sex==='FEMALE'?child:mate
    }
  }
  return {generations,world}
}

/** 旧実装の識別子再帰内包（計測のみ）。製品コードへ戻さない。 */
function legacyLengths(actual:readonly Generation[]){
  let father:Id='person-exp-04',mother:Id='person-exp-05'
  return actual.map((g,i)=>{
    const marriageId='marriage:normal:'+JSON.stringify([g.year,JSON.stringify(pair(father,mother))])
    const childId='person:b002:auto:'+JSON.stringify([g.year,marriageId,father,mother])
    const commandId='cmd:b002:auto:'+JSON.stringify([g.year,marriageId,father,mother])
    const shownName='試験用自律児 '+g.year+' ('+marriageId+')'
    const mate='fixture:unrelated-mate:'+i
    if(g.child.sex==='MALE'){father=childId;mother=mate}
    else {father=mate;mother=childId}
    return {marriage:marriageId.length,person:childId.length,command:commandId.length,name:shownName.length}
  })
}

describe('Issue #120 — 実B002出生による三世代ID安定化 (CALIBRATION_ONLY)',()=>{
  it('3世代の実出生は婚姻・両親・Event/Traceの参照を保持し表示名へ識別子を漏出させない',()=>{
    const {generations,world}=replay('A0')
    expect(generations).toHaveLength(3)
    expect(new Set(generations.map(g=>g.child.personId)).size).toBe(3)
    expect(new Set(generations.map(g=>g.marriageId)).size).toBe(3)
    for(const g of generations){
      expect(g.child.personId).toMatch(/^person:b002:auto:[0-9a-f]{64}$/)
      expect(g.marriageId).toMatch(/^marriage:normal:[0-9a-f]{64}$/)
      expect(g.child.personId.length).toBe(GENERATED_ID_DOMAINS.B002_PERSON.length+65)
      expect(g.marriageId.length).toBe(GENERATED_ID_DOMAINS.ALEG01_MARRIAGE.length+65)
      expect(g.child.name).toBe('試験用自律児 '+g.year)
      expect(g.child.name).not.toContain(g.marriageId)
      const father=world.persons.find(p=>p.personId===g.child.fatherId)
      const mother=world.persons.find(p=>p.personId===g.child.motherId)
      expect(father?.sex).toBe('MALE')
      expect(mother?.sex).toBe('FEMALE')
      expect(g.marriagePersonIds).toContain(father!.personId)
      expect(g.marriagePersonIds).toContain(mother!.personId)
      const events=g.result.events.filter(e=>e.eventType==='PERSON_BIRTH')
      expect(events).toHaveLength(1)
      const event=events[0]!
      const trace=g.result.traces.find(t=>t.ruleId==='B-002'&&
        t.actorRef.kind==='PERSON'&&t.actorRef.id===g.child.personId)!
      expect(event.involvedRefs).toContainEqual({kind:'PERSON',id:g.child.personId})
      expect(event.sourceTraceIds).toContain(trace.traceId)
      expect(trace.eventIds).toContain(event.eventId)
      expect(trace.candidates[0]?.inputs.childPersonId).toBe(g.child.personId)
      expect(trace.candidates[0]?.inputs.marriageId).toBe(g.marriageId)
      expect(event.eventId.length).toBeLessThan(120)
      expect(event.semanticEventKey.length).toBeLessThan(150)
      expect(trace.candidates[0]!.candidateId.length).toBeLessThan(100)
      expect(validateWorldState(g.result.world).ok).toBe(true)
    }
    expect(world.legal.marriages).toHaveLength(3)
    expect(validateWorldState(world).ok).toBe(true)
  })

  it('旧再帰方式に対しID・表示名の文字数上限を維持し、時間・ヒープ差分を記録する',()=>{
    const heapBefore=process.memoryUsage().heapUsed
    const start=performance.now()
    const {generations}=replay('A0')
    const elapsedMs=performance.now()-start
    const heapDeltaBytes=process.memoryUsage().heapUsed-heapBefore
    const old=legacyLengths(generations)
    const now=generations.map(g=>({
      marriage:g.marriageId.length,person:g.child.personId.length,
      command:stableGeneratedId(GENERATED_ID_DOMAINS.B002_COMMAND,
        [g.year,g.marriageId,g.child.fatherId!,g.child.motherId!]).length,
      name:g.child.name.length,
    }))
    expect(old[2]!.person).toBeGreaterThan(old[1]!.person)
    expect(old[1]!.person).toBeGreaterThan(old[0]!.person)
    expect(now.map(x=>x.person)).toEqual([81,81,81])
    expect(now[2]!.person).toBeLessThan(old[2]!.person)
    expect(now[2]!.name).toBeLessThan(old[2]!.name)
    expect(elapsedMs).toBeLessThan(15000)
    console.info('ISSUE120_ID_LENGTH_AND_PERF_CALIBRATION_ONLY',JSON.stringify({
      legacy:old,stable:now,elapsedMs:Math.round(elapsedMs),heapDeltaBytes,
    }))
  })

  it('同seedのA0再試行と枝IDだけ異なるA1の決定的結果は完全一致する',()=>{
    const a0=replay('A0')
    expect(replay('A0')).toEqual(a0)
    expect(replay('A1')).toEqual(a0)
  })

  it('同一人物IDを持つ別PersonはWorldStateで重複エラーになり混同しない',()=>{
    const {world,generations}=replay('A0')
    const original=generations[0]!.child
    const different:Person={...original,name:'別人物としての偽装'}
    const collision:WorldState={...world,persons:[...world.persons,different]}
    const v=validateWorldState(collision)
    expect(v.ok).toBe(false)
    expect(v.diagnostics.some(d=>d.code==='DUPLICATE_ID')).toBe(true)
  })
})
