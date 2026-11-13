// Issue #119 / MVP王位継承。世界・法令・人物はすべて試験用（CALIBRATION_ONLY）。
import { describe, expect, it } from 'vitest'
import { createExperimentalWorld, NALVEN_DYNASTY_ID } from '../../../src/scenario/experimental/index.ts'
import { createExperimentalOrdinaryLegalTrial } from '../../../src/scenario/experimental/ordinary-legal-trial.ts'
import type { WorldState } from '../../../src/simulation/contracts/index.ts'
import { runYear } from '../../../src/simulation/engine/index.ts'
import { evaluateGoal } from '../../../src/simulation/goal.ts'
import { createB003CalibrationEvaluator } from '../../../src/simulation/rules/b/index.ts'
import { createASuc04WorldStateEvaluator, createATit07EvidenceEvaluator } from '../../../src/simulation/rules/a/index.ts'
import { createCrownSuccessionEvaluators } from '../../../src/simulation/rules/a/crown-succession.ts'
import { checkWorldIntegrity } from '../../../src/simulation/validation/integrity.ts'
import type { LegalEvidenceBook } from '../../../src/simulation/legal/evidence.ts'
import type { OrdinaryLaw } from '../../../src/simulation/legal/ordinary-authority.ts'

const CROWN='title-exp-crown-eldia'
const LAND='title-exp-central'
const PRE='person-exp-01'
const HEIR='person-exp-02'
const COUNTRY='country-eldia'
const start=():WorldState=>{
  const w=createExperimentalWorld()
  return {...w,year:1285}
}
const legal=()=>createExperimentalOrdinaryLegalTrial()
const title=(w:WorldState,id:string)=>w.titles.find(x=>x.titleId===id)!
const country=(w:WorldState)=>w.countries.find(x=>x.countryId===COUNTRY)!
const run=(w:WorldState,opts:{
  book?:LegalEvidenceBook; laws?:readonly OrdinaryLaw[]; death?:boolean
}={})=>{
  const trial=legal()
  const crown=createCrownSuccessionEvaluators(
    createASuc04WorldStateEvaluator(),createATit07EvidenceEvaluator(),
    {book:opts.book??trial.book,laws:opts.laws??trial.laws})
  const evaluatorMap={
    'A-SUC-04':crown.succession,'A-TIT-07':crown.titleTransfer,
  }
  if(opts.death===false)return runYear(w,{seed:1,branchId:'A0',evaluators:evaluatorMap})
  const death=createB003CalibrationEvaluator([{
    evidenceId:'synthetic-royal-death-1285',personId:PRE,deathYear:1285,provenance:'CALIBRATION_ONLY',
  }])
  if(!death.ok)throw new Error('INVALID_SYNTHETIC_DEATH')
  return runYear(w,{seed:1,branchId:'A0',
    evaluators:{...evaluatorMap,'B-003':death.evaluator}})
}
const complete=(r:ReturnType<typeof runYear>)=>{
  if(r.status!=='COMPLETED')throw new Error(JSON.stringify(r.halt))
  return r
}

describe('Issue #119: 採用済みGAME-02 王位継承の法制審査',()=>{
  it('B-003の死亡、CROWN法令・独立授権・男子優先順位が揃い、実ケースとEvent/Traceを伴う継承が成立',()=>{
    const before=start()
    const result=complete(run(before))
    const after=result.world
    expect(title(after,CROWN).holder).toEqual({status:'HELD',personId:HEIR})
    expect(country(after).rulerPersonId).toBe(HEIR)
    expect(title(after,LAND).holder.status).toBe('UNDETERMINED')
    expect(after.regions).toEqual(before.regions)
    expect(after.legal.controlMandates).toEqual(before.legal.controlMandates)
    expect(after.legal.taxMandates).toEqual(before.legal.taxMandates)
    expect(after.titles.filter(t=>t.kind==='TERRITORIAL')).not.toEqual(
      after.titles.filter(t=>t.kind==='CROWN'))
    const approved=after.legal.cases.find(c=>c.titleId===CROWN)!
    expect(approved).toMatchObject({kind:'SUCCESSION',status:'APPROVED',candidatePersonIds:[HEIR]})
    expect(approved.reasonCodes).toContain('CROWN_RULER_COUNTRY:'+COUNTRY)
    const succession=result.traces.find(t=>t.ruleId==='A-SUC-04'&&
      t.reasonCodes.includes('EXPLICIT_CROWN_AUTHORITY_AND_HEIR_VERIFIED'))!
    expect(succession.status).toBe('ACCEPT')
    expect(succession.eventIds.some(id=>result.events.some(e=>e.eventId===id&&e.eventType==='LEGAL_CASE_SET'))).toBe(true)
    const crownChange=result.events.find(e=>e.eventType==='LEGAL_TITLE_TRANSFER'&&
      e.stateChanges.some(s=>s.path.includes(CROWN)))!
    const rulerChange=result.events.find(e=>e.eventType==='COUNTRY_RULER_SET')!
    expect(crownChange).toBeDefined()
    expect(rulerChange).toBeDefined()
    expect(result.traces.some(t=>t.ruleId==='A-TIT-07'&&t.eventIds.includes(crownChange.eventId))).toBe(true)
    expect(result.traces.some(t=>t.ruleId==='A-TIT-07'&&t.eventIds.includes(rulerChange.eventId))).toBe(true)
    expect(result.events.every(e=>e.sourceTraceIds.every(id=>result.traces.some(t=>t.traceId===id)))).toBe(true)
    expect(run(before)).toEqual(result)
    expect(title(before,CROWN).holder).toEqual({status:'HELD',personId:PRE})
    // CROWNだけでは1350年の厳格Goalは成立しない。
    expect(evaluateGoal({...after,year:1350}, {dynastyId:NALVEN_DYNASTY_ID}).status).toBe('NOT_ACHIEVED')
  })

  it('独立の王位授権が無ければ合法継承はDEFER、故人名義はUNDETERMINEDとなり、後年に再審査できる',()=>{
    const trial=legal()
    const noCrownAuthority:LegalEvidenceBook={
      ...trial.book,approvalAuthorities:trial.book.approvalAuthorities.filter(a=>a.action!=='CROWN_SUCCESSION'),
    }
    const first=complete(run(start(),{book:noCrownAuthority}))
    const pending=first.world.legal.cases.find(c=>c.titleId===CROWN)!
    expect(pending.status).toBe('PENDING')
    expect(title(first.world,CROWN).holder.status).toBe('UNDETERMINED')
    expect(country(first.world).rulerPersonId).toBeUndefined()
    expect(first.traces.some(t=>t.ruleId==='A-SUC-04'&&
      t.reasonCodes.includes('CROWN_LAW_OR_AUTHORITY_MISSING')&&t.status==='DEFER')).toBe(true)
    const second=complete(run(first.world,{death:false}))
    expect(second.world.legal.cases.find(c=>c.titleId===CROWN)).toMatchObject({
      caseId:pending.caseId,status:'APPROVED',candidatePersonIds:[HEIR],
    })
    expect(title(second.world,CROWN).holder).toEqual({status:'HELD',personId:HEIR})
    expect(country(second.world).rulerPersonId).toBe(HEIR)
    expect(run(first.world,{death:false})).toEqual(second)
  })

  it('王位の法令が無い場合は国IDだけでは承認されない',()=>{
    const trial=legal()
    const laws=trial.laws.filter(l=>l.action!=='CROWN_SUCCESSION')
    const r=complete(run(start(),{laws}))
    expect(title(r.world,CROWN).holder.status).toBe('UNDETERMINED')
    expect(r.world.legal.cases.find(c=>c.titleId===CROWN)?.status).toBe('PENDING')
    expect(country(r.world).rulerPersonId).toBeUndefined()
  })

  it('王位のgrant原本が欠ければ承認・国家統治者の補完を行わない',()=>{
    const trial=legal()
    const book:LegalEvidenceBook={
      ...trial.book,titleGrants:trial.book.titleGrants.filter(g=>g.titleId!==CROWN),
    }
    const r=complete(run(start(),{book}))
    expect(title(r.world,CROWN).holder.status).toBe('UNDETERMINED')
    expect(r.world.legal.cases.find(c=>c.titleId===CROWN)?.status).toBe('PENDING')
    expect(r.traces.some(t=>t.reasonCodes.includes('CROWN_LAW_OR_AUTHORITY_MISSING'))).toBe(true)
    expect(country(r.world).rulerPersonId).toBe(PRE) // 連動の法的根拠が無い
  })

  it('同順位・同生年の男子枝が並ぶ場合、IDによる自動選定を行わずPENDING',()=>{
    const w=start()
    const son=w.persons.find(p=>p.personId===HEIR)!
    const rival={...son,personId:'synthetic-equal-priority-son',name:'同順位の試験人物'}
    const ambiguous:WorldState={...w,persons:[...w.persons,rival]}
    const r=complete(run(ambiguous))
    expect(title(r.world,CROWN).holder.status).toBe('UNDETERMINED')
    expect(r.world.legal.cases.find(c=>c.titleId===CROWN)?.status).toBe('PENDING')
    expect(r.traces.some(t=>t.reasonCodes.includes('SAME_PRIORITY_BIRTH_YEAR'))).toBe(true)
  })

  it('死者の王冠HELDを年初監査で検出し、死亡当年のフェーズ途中と区別する',()=>{
    const w=start()
    const dead:WorldState={...w,year:1286,persons:w.persons.map(p=>
      p.personId===PRE?{...p,alive:false,deathYear:1285}:p)}
    const errors=checkWorldIntegrity(dead)
    expect(errors.filter(x=>x.code==='DEAD_CROWN_HOLDER')).toHaveLength(1)
    const transient:WorldState={...dead,year:1285}
    expect(checkWorldIntegrity(transient).filter(x=>x.code==='DEAD_CROWN_HOLDER')).toHaveLength(0)
    const r=complete(run(dead,{death:false}))
    expect(title(r.world,CROWN).holder.status).toBe('UNDETERMINED')
    expect(r.world.legal.cases.find(c=>c.titleId===CROWN)?.status).toBe('PENDING')
    expect(checkWorldIntegrity(r.world).some(x=>x.code==='DEAD_CROWN_HOLDER')).toBe(false)
  })

  it('死亡保持者の王位が失効済みでもHELDを残さず、継承承認は発生しない',()=>{
    const w=start()
    const invalid:WorldState={...w,titles:w.titles.map(t=>t.titleId===CROWN?{...t,valid:false}:t)}
    const r=complete(run(invalid))
    expect(title(r.world,CROWN).holder.status).toBe('UNDETERMINED')
    expect(r.world.legal.cases.find(c=>c.titleId===CROWN)?.status).toBe('PENDING')
    expect(r.traces.some(t=>t.reasonCodes.includes('EXPLICIT_CROWN_AUTHORITY_AND_HEIR_VERIFIED'))).toBe(false)
  })

  it('未確認の法的王朝所属で候補を確定せず、前保持者死亡後も領地・委任・税権は独立',()=>{
    const w=start()
    const unresolved:WorldState={...w,persons:w.persons.map(p=>
      p.personId===HEIR?{...p,legalDynasty:{status:'UNDETERMINED' as const,reasonCodes:['TEST']}}:p)}
    const r=complete(run(unresolved))
    expect(title(r.world,CROWN).holder.status).toBe('UNDETERMINED')
    expect(r.world.legal.cases.find(c=>c.titleId===CROWN)?.status).toBe('PENDING')
    expect(r.traces.some(t=>t.reasonCodes.includes('LEGAL_DYNASTY_UNDETERMINED'))).toBe(true)
    expect(r.world.regions).toEqual(unresolved.regions)
    expect(r.world.legal.taxMandates).toEqual(unresolved.legal.taxMandates)
  })
})
