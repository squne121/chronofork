// 実年次エンジンで婚姻→出生→法的王朝→自然死→SUCCESSIONケース→世襲Titleを横断検証。
// 全係数/死亡候補/相続意思決定はsynthetic/CALIBRATION_ONLY。未承認相続順位や勝敗を偽造しない。
import { describe,expect,it } from 'vitest'
import { createRootBranch,forkHistory } from '../../../src/simulation/branching/index.ts'
import type { Branch } from '../../../src/simulation/branching/index.ts'
import type { EventLogEntry,StatModifier,WorldState } from '../../../src/simulation/contracts/index.ts'
import { runTimeline,runYear } from '../../../src/simulation/engine/index.ts'
import type { EvaluatorMap } from '../../../src/simulation/engine/index.ts'
import { RULE_REGISTRY } from '../../../src/simulation/rule-registry.ts'
import {
  createADyn02EvidenceEvaluator,createALeg01CalibrationEvaluator,
  createASuc04CalibrationEvaluator,createATit07EvidenceEvaluator,
} from '../../../src/simulation/rules/a/index.ts'
import type { MarriageApprovalEvidence,SuccessionDecisionEvidence } from '../../../src/simulation/rules/a/index.ts'
import { createB002CalibrationEvaluator,createB003CalibrationEvaluator,createB005CalibrationEvaluator } from '../../../src/simulation/rules/b/index.ts'
import type { BirthCandidateEvidence,NaturalDeathEvidence } from '../../../src/simulation/rules/b/index.ts'
import { FORK_YEAR,P4,P5,SEED,TRUST_BOOST,createSyntheticWorld,evaluatorsForLedger } from './b004-branch-fixture.ts'

const DEATH_YEAR=1285
const TITLE_ID='title-exp-west'
const BIRTH:BirthCandidateEvidence={
  candidateId:'explicit-candidate-p4p5-child-01',
  evidenceId:'synthetic-child-evidence-1261',
  birthYear:1261,fatherId:P4,motherId:P5,
  childName:'試験児（明示出生候補）',childSex:'FEMALE',
  cohortGroupId:'group-east-elite',houseId:'house-cardon',provenance:'CALIBRATION_ONLY',
}
const CHILD_ID='person:b002:'+JSON.stringify([BIRTH.birthYear,BIRTH.fatherId,BIRTH.motherId,BIRTH.candidateId,BIRTH.evidenceId])
const APPROVAL:MarriageApprovalEvidence={
  approvalId:'synthetic-approved-pair45',personIds:[P4,P5],authorizedYear:FORK_YEAR,status:'APPROVED',
  issuerRef:{kind:'COUNTRY',id:'country-eldia'},evidenceId:'synthetic-approved-document',
  provenance:'CALIBRATION_ONLY',
  contract:{contractId:'synthetic-p4p5-contract',evidenceId:'synthetic-approved-document',
    clauses:[{clauseId:'synthetic-clause-child-vargas',kind:'CHILD_LEGAL_DYNASTY',dynastyId:'dynasty-vargas'}]},
}
const DEATH:NaturalDeathEvidence={
  evidenceId:'synthetic-natural-death-p4-1285',personId:P4,deathYear:DEATH_YEAR,provenance:'CALIBRATION_ONLY',
}
const DECISION:SuccessionDecisionEvidence={
  decisionId:'synthetic-west-succession-1285',
  titleId:TITLE_ID,predecessorPersonId:P4,successorPersonId:CHILD_ID,
  decisionYear:DEATH_YEAR,grantBasisId:'exp-basis-west',
  issuerRef:{kind:'COUNTRY',id:'country-eldia'},status:'APPROVED',provenance:'CALIBRATION_ONLY',
}
type Setup=Readonly<{
  marriageEvidence?:readonly MarriageApprovalEvidence[]
  birthCandidates?:readonly BirthCandidateEvidence[]
  deathCandidates?:readonly NaturalDeathEvidence[]
  successionDecisions?:readonly SuccessionDecisionEvidence[]
}>
function makeWorld():WorldState {
  const w=createSyntheticWorld()
  // Test-local: P5の母親役は1230年生まれ。正式scenarioは変更しない。
  return {...w,persons:w.persons.map(p=>p.personId===P5?{...p,birthYear:1230}:p)}
}
function evaluators(ledger:readonly StatModifier[],opts:Setup={}):EvaluatorMap {
  const a=createALeg01CalibrationEvaluator(opts.marriageEvidence??[APPROVAL])
  const b=createB002CalibrationEvaluator(opts.birthCandidates??[BIRTH])
  const d=createB003CalibrationEvaluator(opts.deathCandidates??[DEATH])
  const s=createASuc04CalibrationEvaluator(opts.successionDecisions??[DECISION])
  if(!a.ok || !b.ok || !d.ok || !s.ok) throw new Error('invalid synthetic fixture')
  return {
    ...evaluatorsForLedger(ledger),
    'B-003':d.evaluator,'B-002':b.evaluator,'A-DYN-02':createADyn02EvidenceEvaluator(),
    'B-005':createB005CalibrationEvaluator(),'A-LEG-01':a.evaluator,
    'A-SUC-04':s.evaluator,'A-TIT-07':createATit07EvidenceEvaluator(),
  }
}
function root():{a0:Branch;timeline:ReturnType<typeof runTimeline>} {
  const table=evaluators([])
  const timeline=runTimeline(makeWorld(),{seed:SEED,branchId:'A0',evaluators:table})
  if(timeline.status!=='COMPLETED')throw new Error('A0_HALTED:'+JSON.stringify(timeline.halt))
  const r=createRootBranch(timeline,[],table)
  if(!r.ok)throw new Error(r.code+': '+r.message)
  return {a0:r.branch,timeline}
}
function fork(a0:Branch,opts:Setup={},id='A1'):Branch{
  const r=forkHistory({parent:a0,forkYear:FORK_YEAR,branchId:id,modifiers:[TRUST_BOOST],
    evaluatorsFor:({ledger})=>evaluators(ledger,opts)})
  if(!r.ok)throw new Error(r.code+': '+r.message)
  return r.branch
}
const state=(b:Branch,year:number)=>b.snapshots[year-b.startYear]!
const title=(b:Branch,year:number)=>state(b,year).titles.find(t=>t.titleId===TITLE_ID)!
const person=(b:Branch,year:number,id:string)=>state(b,year).persons.find(p=>p.personId===id)
const trace=(b:Branch,ruleId:string,year:number)=>b.decisionTraces.find(t=>t.ruleId===ruleId&&t.year===year)
const events=(b:Branch,type:string,year:number):readonly EventLogEntry[]=>
  b.eventLog.filter(e=>e.eventType===type&&e.year===year)

describe('B-003死亡→A-SUC-04相続ケース→A-TIT-07世襲Title（CALIBRATION_ONLY）',()=>{
  const {a0,timeline}=root()
  const a1=fork(a0)

  it('1260婚姻→1261実出生・王朝→1285自然死を同seedで確定。A0/A1の前史は一致',()=>{
    expect(timeline.status).toBe('COMPLETED')
    expect(a1.status).toBe('COMPLETED')
    expect(a1.snapshots).toHaveLength(101)
    expect(a1.snapshots.slice(0,11)).toEqual(a0.snapshots.slice(0,11))
    expect(events(a0,'MARRIAGE_REGISTER',1260)).toHaveLength(0)
    expect(events(a1,'MARRIAGE_REGISTER',1260)).toHaveLength(1)
    expect(events(a1,'PERSON_BIRTH',1261)).toHaveLength(1)
    expect(events(a1,'LEGAL_DYNASTY_SET',1261)).toHaveLength(1)
    expect(person(a1,1262,CHILD_ID)?.legalDynasty).toEqual({status:'DETERMINED',dynastyId:'dynasty-vargas'})
    expect(person(a0,1285,CHILD_ID)).toBeUndefined()
    for(const branch of [a0,a1]){
      expect(title(branch,DEATH_YEAR).holder).toEqual({status:'HELD',personId:P4})
      expect(person(branch,1285,P4)?.alive).toBe(true)
      expect(person(branch,1286,P4)).toMatchObject({alive:false,deathYear:1285})
      expect(events(branch,'PERSON_DEATH',DEATH_YEAR)).toHaveLength(1)
      const t=trace(branch,'B-003',DEATH_YEAR)!
      expect(t.status).toBe('ACCEPT')
      expect(t.eventIds).toEqual([events(branch,'PERSON_DEATH',DEATH_YEAR)[0]?.eventId])
      expect(events(branch,'PERSON_DEATH',DEATH_YEAR)[0]?.sourceTraceIds).toEqual([t.traceId])
    }
    expect(events(a0,'PERSON_DEATH',DEATH_YEAR)).toEqual(events(a1,'PERSON_DEATH',DEATH_YEAR))
    expect(a1.eventLog.filter(e=>e.eventType==='POPULATION_COHORT')).toEqual(a0.eventLog.filter(e=>e.eventType==='POPULATION_COHORT'))
    expect(a1.snapshots.map(w=>w.groups)).toEqual(a0.snapshots.map(w=>w.groups)) // 死亡枠請求で人口を二重減算しない
  })

  it('A1: 明示SUCCESSIONケース→A-TIT-07の実Title移転が同年Phase4に起こる',()=>{
    const cases=state(a1,1286).legal.cases.filter(c=>c.titleId===TITLE_ID)
    expect(cases).toHaveLength(1)
    expect(cases[0]).toMatchObject({kind:'SUCCESSION',status:'APPROVED',candidatePersonIds:[CHILD_ID]})
    const sc=trace(a1,'A-SUC-04',DEATH_YEAR)!
    const tt=trace(a1,'A-TIT-07',DEATH_YEAR)!
    expect([sc.status,tt.status]).toEqual(['ACCEPT','ACCEPT'])
    expect(sc.candidates[0]?.inputs).toMatchObject({sourceB003TraceId:trace(a1,'B-003',1285)!.traceId,
      decisionId:DECISION.decisionId,caseId:cases[0]!.caseId})
    expect(tt.candidates[0]?.inputs).toMatchObject({
      sourceASuc04TraceId:sc.traceId,legalCaseId:cases[0]!.caseId,successorPersonId:CHILD_ID,
      territorialControlTransferred:false,recognitionChanged:false,
    })
    expect(events(a1,'LEGAL_CASE_SET',1285)).toHaveLength(1)
    expect(events(a1,'LEGAL_TITLE_TRANSFER',1285)).toHaveLength(1)
    expect(sc.eventIds).toEqual([events(a1,'LEGAL_CASE_SET',1285)[0]!.eventId])
    expect(tt.eventIds).toEqual([events(a1,'LEGAL_TITLE_TRANSFER',1285)[0]!.eventId])
    expect(events(a1,'LEGAL_CASE_SET',1285)[0]!.sourceTraceIds).toEqual([sc.traceId])
    expect(events(a1,'LEGAL_TITLE_TRANSFER',1285)[0]!.sourceTraceIds).toEqual([tt.traceId])
    expect(title(a1,1286).holder).toEqual({status:'HELD',personId:CHILD_ID})
    expect(title(a1,1350).holder).toEqual({status:'HELD',personId:CHILD_ID})
  })

  it('A0: 候補の子が生まれていないなら相続を推定せずTitleはUNDETERMINED。偽の承認Eventなし',()=>{
    expect(trace(a0,'A-SUC-04',1285)).toMatchObject({status:'DEFER',
      reasonCodes:['CALIBRATION_ONLY','GAME_02_EXPLICIT_DECISION_ONLY','SUCCESSOR_UNAVAILABLE']})
    expect(events(a0,'LEGAL_CASE_SET',1285)).toHaveLength(0)
    expect(trace(a0,'A-TIT-07',1285)?.status).toBe('DEFER')
    expect(title(a0,1286).holder).toEqual({status:'UNDETERMINED'})
    expect(events(a0,'LEGAL_TITLE_TRANSFER',1285)).toHaveLength(1)
    expect(state(a0,1286).legal.cases).toEqual([])
    expect(title(a0,1350).holder).toEqual({status:'UNDETERMINED'})
  })

  it('称号の法的移転は実効支配・recognition・国庫・TaxMandate・ControlMandateを変更しない',()=>{
    expect(title(a1,1286).recognition).toEqual(title(a0,1286).recognition)
    expect(title(a1,1286).grantBasisId).toBe(title(a0,1286).grantBasisId)
    expect(state(a1,1286).regions).toEqual(state(a0,1286).regions)
    expect(state(a1,1286).resources).toEqual(state(a0,1286).resources)
    expect(state(a1,1286).legal.controlMandates).toEqual(state(a0,1286).legal.controlMandates)
    expect(state(a1,1286).legal.taxMandates).toEqual(state(a0,1286).legal.taxMandates)
    // Titleを相続しても領土を直接支配したとは主張しない。正式勝利判定は未成立。
    expect(a1.goal).toBeNull()
    expect(a0.goal).toBeNull()
    expect(a1.snapshots[100]?.regions).toEqual(a0.snapshots[100]?.regions)
  })

  it('決定証拠なし/PENDING/REJECTEDは相続を成立させず、PENDINGケースは未確定として残る',()=>{
    const none=fork(a0,{successionDecisions:[]})
    expect(events(none,'LEGAL_CASE_SET',1285)).toHaveLength(0)
    expect(title(none,1286).holder).toEqual({status:'UNDETERMINED'})
    for(const status of ['PENDING','REJECTED'] as const){
      const b=fork(a0,{successionDecisions:[{...DECISION,status}]})
      expect(events(b,'LEGAL_CASE_SET',1285)).toHaveLength(1)
      expect(state(b,1286).legal.cases.find(c=>c.titleId===TITLE_ID)?.status).toBe(status)
      expect(title(b,1286).holder.status).toBe('UNDETERMINED')
      expect(trace(b,'A-TIT-07',1285)?.status).toBe('DEFER')
      expect(events(b,'LEGAL_TITLE_TRANSFER',1285)).toHaveLength(1) // 保有者未確定は法的所有権付与ではない
    }
  })

  it('証拠の発行者不明、grantBasis不一致、候補不在・非直系は承認ケースを作らない',()=>{
    const cases:SuccessionDecisionEvidence[]=[
      {...DECISION,issuerRef:{kind:'PERSON',id:'unknown-issuer'}},
      {...DECISION,grantBasisId:'unproven-basis'},
      {...DECISION,successorPersonId:'absent-person'},
      {...DECISION,successorPersonId:P5},
    ]
    for(const e of cases){
      const b=fork(a0,{successionDecisions:[e]})
      expect(events(b,'LEGAL_CASE_SET',1285)).toHaveLength(0)
      expect(title(b,1286).holder).toEqual({status:'UNDETERMINED'})
      expect(trace(b,'A-SUC-04',1285)?.status).toBe('DEFER')
    }
  })

  it('子の法的王朝所属がUNDETERMINEDなら明示相続ケースを自動APPROVEDにしない',()=>{
    const withoutClause:MarriageApprovalEvidence={
      ...APPROVAL,contract:{...APPROVAL.contract!,clauses:[]},
    }
    const b=fork(a0,{marriageEvidence:[withoutClause]})
    expect(person(b,1262,CHILD_ID)?.legalDynasty.status).toBe('UNDETERMINED')
    expect(trace(b,'A-SUC-04',1285)).toMatchObject({status:'DEFER',
      reasonCodes:['CALIBRATION_ONLY','GAME_02_EXPLICIT_DECISION_ONLY','SUCCESSOR_LEGAL_DYNASTY_UNDETERMINED']})
    expect(events(b,'LEGAL_CASE_SET',1285)).toHaveLength(0)
    expect(title(b,1286).holder).toEqual({status:'UNDETERMINED'})
  })

  it('死亡候補なし・死亡枠なし/枠0では死を偽造せず、保持者が存命中のTitle移転をしない',()=>{
    const noDeath=fork(a0,{deathCandidates:[]})
    expect(events(noDeath,'PERSON_DEATH',1285)).toHaveLength(0)
    expect(title(noDeath,1286).holder).toEqual({status:'HELD',personId:P4})
    expect(events(noDeath,'LEGAL_TITLE_TRANSFER',1285)).toHaveLength(0)
    const at=state(a1,1285)
    const d=createB003CalibrationEvaluator([DEATH])
    expect(d.ok).toBe(true)
    if(!d.ok)return
    const noSlot=runYear(at,{seed:SEED,evaluators:{'B-003':d.evaluator}})
    expect(noSlot.status).toBe('COMPLETED')
    if(noSlot.status==='COMPLETED'){
      expect(noSlot.events).toHaveLength(0)
      expect(noSlot.traces.find(t=>t.ruleId==='B-003')).toMatchObject({status:'DEFER',
        reasonCodes:['CALIBRATION_ONLY','NATURAL_DEATH_SLOT_MISSING']})
      expect(noSlot.world.persons.find(p=>p.personId===P4)?.alive).toBe(true)
    }
    const empty:WorldState={...at,demographics:{cohortSlots:[
      {groupId:'group-west-elite',year:1285,birthSlots:0,deathSlots:0,claimedBirths:0,claimedDeaths:0},
    ]}}
    const shortage=runYear(empty,{seed:SEED,evaluators:{'B-003':d.evaluator}})
    expect(shortage.status).toBe('COMPLETED')
    if(shortage.status==='COMPLETED'){
      expect(shortage.events).toHaveLength(0)
      expect(shortage.traces.find(t=>t.ruleId==='B-003')?.reasonCodes).toContain('NATURAL_DEATH_SLOT_EXHAUSTED')
    }
  })

  it('候補重複・年範囲外を事前拒否。同じseed/別branchIdでPerson・Event・Title状態は再現する',()=>{
    expect(createB003CalibrationEvaluator([DEATH,DEATH]).ok).toBe(false)
    expect(createB003CalibrationEvaluator([{...DEATH,deathYear:1350}]).ok).toBe(false)
    expect(createASuc04CalibrationEvaluator([DECISION,DECISION]).ok).toBe(false)
    expect(createASuc04CalibrationEvaluator([{...DECISION,decisionYear:1350}]).ok).toBe(false)
    const b=fork(a0,{},'A1-alt')
    expect(person(b,1286,CHILD_ID)).toEqual(person(a1,1286,CHILD_ID))
    expect(events(b,'PERSON_DEATH',1285)).toEqual(events(a1,'PERSON_DEATH',1285))
    expect(events(b,'LEGAL_CASE_SET',1285)).toEqual(events(a1,'LEGAL_CASE_SET',1285))
    expect(events(b,'LEGAL_TITLE_TRANSFER',1285)).toEqual(events(a1,'LEGAL_TITLE_TRANSFER',1285))
    expect(title(b,1350)).toEqual(title(a1,1350))
    expect(fork(a0)).toEqual(a1)
  })

  it('37件RuleRegistry TODO、1350 Goal=null・自律歴史NOT_ESTABLISHEDを維持する',()=>{
    expect(RULE_REGISTRY).toHaveLength(37)
    expect(RULE_REGISTRY.every(r=>r.implementationStatus==='TODO')).toBe(true)
    expect(timeline.autonomousHistory.status).toBe('NOT_ESTABLISHED')
    expect(timeline.goal).toBeNull()
    expect(a1.goal).toBeNull()
    expect(a1.recompute?.suffixCoverage.injectedTodoRuleIds).toEqual(expect.arrayContaining([
      'B-003','A-SUC-04','A-TIT-07',
    ]))
    expect(state(a1,1350).year).toBe(1350)
  })
})
