// DEC-077: 国家統治者の死亡後は証拠付きで未確定化し、王位/土地/税権を移さない。
import { describe, expect, it } from 'vitest'
import { createExperimentalWorld } from '../../../src/scenario/experimental/world-1250.ts'
import {
  createExperimentalIntegratedWorld, createExperimentalIntegratedEvaluators, INTEGRATED_SEED,
} from '../../../src/scenario/experimental/integrated-run.ts'
import { createExperimentalOrdinaryLegalTrial } from '../../../src/scenario/experimental/ordinary-legal-trial.ts'
import type { CountryRulerVacateCommand, WorldState } from '../../../src/simulation/contracts/index.ts'
import { runYear } from '../../../src/simulation/engine/index.ts'
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

describe('DEC-077: 確定死亡による国家統治者未確定化',()=>{
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
