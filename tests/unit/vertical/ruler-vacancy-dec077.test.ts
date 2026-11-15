// DEC-079: 国家統治者の死亡後は証拠付きで未確定化し、王位/土地/税権を移さない。
import { describe, expect, it } from 'vitest'
import { createExperimentalWorld } from '../../../src/scenario/experimental/world-1250.ts'
import {
  createExperimentalIntegratedWorld, createExperimentalIntegratedEvaluators, INTEGRATED_SEED,
} from '../../../src/scenario/experimental/integrated-run.ts'
import { createExperimentalOrdinaryLegalTrial } from '../../../src/scenario/experimental/ordinary-legal-trial.ts'
import type { CountryRulerVacateCommand, DecisionTraceDraft, WorldState } from '../../../src/simulation/contracts/index.ts'
import { runYear } from '../../../src/simulation/engine/index.ts'
import type { RuleEvaluator } from '../../../src/simulation/engine/evaluators.ts'
import { countryRulerVacate } from '../../../src/simulation/engine/reducer/handlers-legal.ts'
import { createB003CalibrationEvaluator } from '../../../src/simulation/rules/b/index.ts'
import { createASuc04WorldStateEvaluator, createATit07EvidenceEvaluator } from '../../../src/simulation/rules/a/index.ts'
import { createCrownSuccessionEvaluators } from '../../../src/simulation/rules/a/crown-succession.ts'
import { withCountryRulerVacancy } from '../../../src/simulation/rules/a/ruler-vacancy.ts'

const EL='country-eldia', MG='country-margald'
const P1='person-exp-01', P8='person-exp-08'
const crown='title-exp-crown-eldia', mgTitle='title-exp-margald-home'

function testWorld(personId:string):WorldState {
  const initial=createExperimentalWorld()
  const groupId=personId===P8?'group-margald':'group-central-elite'
  return {...initial,year:1285,demographics:{...initial.demographics,cohortSlots:[
    {groupId,year:1285,birthSlots:0,deathSlots:1,claimedBirths:0,claimedDeaths:0},
  ]}}
}

function play(world:WorldState,deathId:string|null) {
  const trial=createExperimentalOrdinaryLegalTrial()
  const crownRules=createCrownSuccessionEvaluators(
    createASuc04WorldStateEvaluator(),createATit07EvidenceEvaluator(),
    {book:trial.book,laws:trial.laws},
  )
  const evaluators={
    'A-SUC-04':crownRules.succession,
    'A-TIT-07':withCountryRulerVacancy(crownRules.titleTransfer),
  }
  if(deathId===null)return runYear(world,{seed:1,branchId:'dec077',evaluators})
  const mortality=createB003CalibrationEvaluator([{
    evidenceId:'test:dec077:death:'+deathId,personId:deathId,deathYear:1285,
    provenance:'CALIBRATION_ONLY',
  }])
  if(!mortality.ok)throw new Error(JSON.stringify(mortality.issues))
  return runYear(world,{seed:1,branchId:'dec077',
    evaluators:{...evaluators,'B-003':mortality.evaluator}})
}

function complete(result:ReturnType<typeof runYear>) {
  if(result.status!=='COMPLETED')throw new Error(JSON.stringify(result.halt))
  return result
}
const ruler=(world:WorldState,id:string)=>world.countries.find(c=>c.countryId===id)?.rulerPersonId

describe('DEC-079: 確定死亡による国家統治者未確定化',()=>{
  it('CROWNのないマルガルドでもB-003死亡からEvent/Trace付きで参照のみ解除する',()=>{
    const before=testWorld(P8)
    const result=complete(play(before,P8))
    const after=result.world
    expect(ruler(before,MG)).toBe(P8)
    expect(ruler(after,MG)).toBeUndefined()
    expect(after.countries.find(c=>c.countryId===MG)).toEqual({
      countryId:MG,name:'マルガルド',
    })
    expect(after.countries.find(c=>c.countryId===EL)).toEqual(before.countries.find(c=>c.countryId===EL))
    expect(after.regions).toEqual(before.regions)
    expect(after.legal.taxMandates).toEqual(before.legal.taxMandates)
    expect(after.legal.controlMandates).toEqual(before.legal.controlMandates)
    expect(after.resources).toEqual(before.resources)
    expect(after.titles.find(t=>t.titleId===mgTitle)?.holder.status).toBe('UNDETERMINED')
    const death=result.events.find(e=>e.eventType==='PERSON_DEATH')!
    const clearance=result.events.find(e=>e.eventType==='COUNTRY_RULER_VACATE')!
    expect(death).toBeDefined()
    expect(clearance?.stateChanges.some(s=>s.path==='$.countries['+MG+'].rulerPersonId' &&
      s.before===P8 && s.after===null)).toBe(true)
    const trace=result.traces.find(t=>t.ruleId==='A-TIT-07' &&
      t.reasonCodes.includes('RULER_REFERENCE_CLEARANCE_ONLY'))!
    expect(trace.status).toBe('ACCEPT')
    expect(trace.reasonCodes).toContain('NOT_SUCCESSION_APPROVAL')
    expect(trace.candidates[0]?.inputs.sourceB003EventId).toBe(death.eventId)
    expect(trace.eventIds).toContain(clearance.eventId)
    expect(clearance.sourceTraceIds).toContain(trace.traceId)
    expect(play(before,P8)).toEqual(result)
  })

  it('CROWNの合法承認が同年に成立するときは国家統治者更新を優先し、未確定化を発行しない',()=>{
    const before=testWorld(P1)
    const result=complete(play(before,P1))
    expect(result.world.titles.find(t=>t.titleId===crown)?.holder).toEqual({
      status:'HELD',personId:'person-exp-02',
    })
    expect(ruler(result.world,EL)).toBe('person-exp-02')
    expect(result.events.some(e=>e.eventType==='COUNTRY_RULER_SET')).toBe(true)
    expect(result.events.some(e=>e.eventType==='COUNTRY_RULER_VACATE')).toBe(false)
  })

  it('確定B-003 Eventのない既死亡人物・生存人物を未確定化したことにしない',()=>{
    const w=testWorld(P8)
    const stale:WorldState={...w,persons:w.persons.map(p=>p.personId===P8?
      {...p,alive:false,deathYear:1284}:p)}
    const result=complete(play(stale,null))
    expect(ruler(result.world,MG)).toBe(P8)
    expect(result.events.some(e=>e.eventType==='COUNTRY_RULER_VACATE')).toBe(false)
    const direct=play(w,null)
    expect(complete(direct).events.some(e=>e.eventType==='COUNTRY_RULER_VACATE')).toBe(false)
  })

  /** 偽造: 評価器が自己申告のEvent IDで未確定化を試みる。runYear（エンジン）で拒否される必要がある。 */
  function forgedVacate(eventIdOf:(real:string|undefined)=>string,deceased=P8):RuleEvaluator {
    const trial=createExperimentalOrdinaryLegalTrial()
    const crownRules=createCrownSuccessionEvaluators(
      createASuc04WorldStateEvaluator(),createATit07EvidenceEvaluator(),
      {book:trial.book,laws:trial.laws},
    )
    return (world,ctx)=>{
      const o=crownRules.titleTransfer(world,ctx)
      const real=(ctx.priorTraces??[]).find(t=>t.ruleId==='B-003')?.eventIds[0]
      const fake=eventIdOf(real)
      const draft:DecisionTraceDraft={
        year:ctx.year,phase:ctx.phase,ruleId:ctx.ruleId,
        actorRef:{kind:'COUNTRY',id:MG},
        candidates:[{candidateId:'forged',eligible:true,inputs:{},reasonCodes:['FORGED']}],
        selectedCandidateId:'forged',status:'ACCEPT',reasonCodes:['FORGED'],
        modifierIds:[],ruleVersion:'forged',
      }
      return {...o,traceDrafts:[...o.traceDrafts,draft],commands:[...o.commands,{
        type:'COUNTRY_RULER_VACATE',commandId:'cmd:forged',
        source:{requestId:'req:forged',year:ctx.year,phase:ctx.phase,sourceRuleId:'A-TIT-07',
          sourceTraceId:ctx.traceId(o.traceDrafts.length),sourceIntentId:fake},
        countryId:MG,deceasedPersonId:deceased,sourceDeathEventId:fake,
      }]}
    }
  }
  const deadMargald=():WorldState=>{
    const w=testWorld(P8)
    return {...w,persons:w.persons.map(p=>p.personId===P8?{...p,alive:false,deathYear:1285}:p)}
  }

  it('死亡済み・現統治者・死亡年一致・intent==deathEventIdでも、B-003 Eventが無い偽造IDはrunYearで拒否する',()=>{
    const before=deadMargald()
    const result=runYear(before,{seed:1,branchId:'dec077',
      evaluators:{'A-TIT-07':forgedVacate(()=>'forged:death-event')}})
    expect(result.status).toBe('HALTED')
    if(result.status!=='HALTED')return
    expect(result.halt.code).toBe('INVALID_OUTCOME')
    expect(result.halt.ruleId).toBe('A-TIT-07')
    expect(result.halt.message).toContain('B-003確定死亡Event')
    // MINOR-3: 拒否時は年全体が停止し、入力世界のまま部分確定しない。
    expect(result.world).toBe(before)
  })

  it('B-003死亡Eventがあっても、別のEvent ID・別人物を指す偽造は拒否する',()=>{
    const w=testWorld(P8)
    const mortality=createB003CalibrationEvaluator([{
      evidenceId:'test:dec077:death:'+P8,personId:P8,deathYear:1285,provenance:'CALIBRATION_ONLY',
    }])
    if(!mortality.ok)throw new Error('b003')
    const run=(ev:RuleEvaluator)=>runYear(w,{seed:1,branchId:'dec077',
      evaluators:{'B-003':mortality.evaluator,'A-TIT-07':ev}})
    const wrongId=run(forgedVacate(()=>'forged:other-event'))
    expect(wrongId.status).toBe('HALTED')
    const wrongPerson=run(forgedVacate(real=>real!,P1))
    expect(wrongPerson.status).toBe('HALTED')
    // 同じ実Event IDを使う正当な形でも、人物がP8でなければ（P1は死亡していない）通らない。
    if(wrongId.status==='HALTED')expect(wrongId.halt.code).toBe('INVALID_OUTCOME')
  })

  it('B-003のEventが実在し一致する場合は偽造評価器経由でも整合した証拠として通る',()=>{
    const w=testWorld(P8)
    const mortality=createB003CalibrationEvaluator([{
      evidenceId:'test:dec077:death:'+P8,personId:P8,deathYear:1285,provenance:'CALIBRATION_ONLY',
    }])
    if(!mortality.ok)throw new Error('b003')
    const result=runYear(w,{seed:1,branchId:'dec077',
      evaluators:{'B-003':mortality.evaluator,'A-TIT-07':forgedVacate(real=>real!)}})
    expect(result.status).toBe('COMPLETED')
    if(result.status==='COMPLETED')expect(ruler(result.world,MG)).toBeUndefined()
  })

  it('reducer単独でも人物生存・死亡年・対象国・実死亡Event参照が不正なら拒否する',()=>{
    const w=testWorld(P8)
    const command:CountryRulerVacateCommand={
      type:'COUNTRY_RULER_VACATE',commandId:'test:clear',
      source:{requestId:'test:clear',year:1285,phase:4,sourceRuleId:'A-TIT-07',
        sourceTraceId:'test:trace',sourceIntentId:'test:death-event'},
      countryId:MG,deceasedPersonId:P8,sourceDeathEventId:'test:death-event',
    }
    const d={world:w,casualties:new Map(),touchedCasualties:new Set<string>()}
    expect(countryRulerVacate(d,command)?.code).toBe('LEGAL_BASIS_MISSING')
    expect(d.world).toEqual(w)
    const dead:WorldState={...w,persons:w.persons.map(p=>p.personId===P8?
      {...p,alive:false,deathYear:1285}:p)}
    const mismatch={world:dead,casualties:new Map(),touchedCasualties:new Set<string>()}
    expect(countryRulerVacate(mismatch,{
      ...command,sourceDeathEventId:'forged:mismatch',
    })?.code).toBe('LEGAL_BASIS_MISSING')
    expect(mismatch.world).toEqual(dead)
    const wrongCountry={world:dead,casualties:new Map(),touchedCasualties:new Set<string>()}
    expect(countryRulerVacate(wrongCountry,{...command,countryId:EL})?.code).toBe('LEGAL_BASIS_MISSING')
    expect(wrongCountry.world).toEqual(dead)
  })

  it('統合実験A0の1250〜1274年に、死亡したマルガルド統治者が翌年以降に残らない',()=>{
    let world=createExperimentalIntegratedWorld()
    const evaluators=createExperimentalIntegratedEvaluators(world,[])
    let cleared=0
    for(let step=0;step<24;step++){
      const result=complete(runYear(world,{
        seed:INTEGRATED_SEED,branchId:'dec077-integrated',evaluators,
      }))
      for(const country of result.world.countries){
        const p=result.world.persons.find(person=>person.personId===country.rulerPersonId)
        expect(p?.alive===false && (p.deathYear??Infinity)<result.world.year).toBe(false)
      }
      for(const e of result.events.filter(e=>e.eventType==='COUNTRY_RULER_VACATE')){
        cleared++
        expect(result.traces.some(t=>t.ruleId==='A-TIT-07' &&
          t.eventIds.includes(e.eventId))).toBe(true)
      }
      world=result.world
    }
    expect(world.year).toBe(1274)
    expect(ruler(world,MG)).toBeUndefined()
    expect(cleared).toBeGreaterThanOrEqual(1)
  },120000)
})
