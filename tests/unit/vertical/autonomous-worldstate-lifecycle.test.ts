// 自律人物・世代交代の最初の技術E2E。明示的な出生/死亡/相続イベント候補は注入しない。
// 婚姻承認のみGAME-02未承認のためsynthetic/CALIBRATION_ONLYの明示証拠を利用。
import { describe, expect, it } from 'vitest'
import { createAutonomousCalibrationEvaluators, EXPERIMENTAL_AUTONOMY, validateAutonomyCalibration } from '../../../src/simulation/autonomy/index.ts'
import type { AutonomyCalibration } from '../../../src/simulation/autonomy/index.ts'
import { createRootBranch, forkHistory } from '../../../src/simulation/branching/index.ts'
import type { Branch } from '../../../src/simulation/branching/index.ts'
import type { Marriage, StatModifier, WorldState } from '../../../src/simulation/contracts/index.ts'
import { runTimeline, runYear } from '../../../src/simulation/engine/index.ts'
import type { EvaluatorMap } from '../../../src/simulation/engine/index.ts'
import { RULE_REGISTRY } from '../../../src/simulation/rule-registry.ts'
import type { MarriageApprovalEvidence } from '../../../src/simulation/rules/a/index.ts'
import { childIdForMarriageYear, createB003WorldStateEvaluator, createB004WorldStateEvaluator } from '../../../src/simulation/rules/b/index.ts'
import { createPairTrustView } from '../../../src/simulation/intervention/index.ts'
import {
  FORK_YEAR, P4, P5, SEED, TRUST_BOOST, createSyntheticWorld,
} from './b004-branch-fixture.ts'

const CONFIG:AutonomyCalibration={
  status:'CALIBRATION_ONLY',
  birth:{minMotherAge:18,maxMotherAge:32,minFatherAge:18,chancePermille:1000},
  // 年齢60以上で確実に抽選対象になる「試験極値」。特定年・特定人物の死亡イベント表ではない。
  death:{minAge:60,riskStartAge:59,basePermille:0,increasePerYearPermille:1000,maxPermille:1000},
  marriage:{minAdultAge:18,maxCandidatePairs:500},
}
const BASE=Object.freeze([{personIds:[P4,P5] as const,value:10}])
const APPROVAL:MarriageApprovalEvidence=Object.freeze({
  approvalId:'synthetic-marry-approval',personIds:[P4,P5] as const,
  authorizedYear:FORK_YEAR,status:'APPROVED' as const,
  issuerRef:{kind:'COUNTRY' as const,id:'country-eldia'},
  evidenceId:'synthetic-authorized-document',provenance:'CALIBRATION_ONLY',
  contract:{contractId:'synthetic-contract-p4p5',evidenceId:'synthetic-authorized-document',
    clauses:[{clauseId:'synthetic-dynasty-clause',kind:'CHILD_LEGAL_DYNASTY' as const,dynastyId:'dynasty-vargas'}]},
})
function world():WorldState{
  const w=createSyntheticWorld()
  // 1250年初WorldState内の仮生年のみ変更。出生/死亡の未来イベント時刻ではない。
  return {...w,persons:w.persons.map(p=>p.personId===P5?{...p,birthYear:1230}:p)}
}
function build(w:WorldState,ledger:readonly StatModifier[]=[],approvals:readonly MarriageApprovalEvidence[]=[APPROVAL],
  config:AutonomyCalibration=CONFIG):EvaluatorMap{
  const result=createAutonomousCalibrationEvaluators({
    branchStartWorld:w,ledger,trustBase:BASE,marriageEvidence:approvals,autonomy:config,
  })
  if(!result.ok)throw new Error('AutonomyFactory: '+JSON.stringify(result.issues))
  return result.evaluators
}
function root(){
  const w=world(),evaluators=build(w)
  const timeline=runTimeline(w,{seed:SEED,branchId:'A0',evaluators})
  if(timeline.status!=='COMPLETED')throw new Error('A0 '+JSON.stringify(timeline.halt))
  const r=createRootBranch(timeline,[],evaluators)
  if(!r.ok)throw new Error(r.code+':'+r.message)
  return {a0:r.branch,timeline}
}
function fork(a0:Branch,id='A1'){
  const start=a0.snapshots[FORK_YEAR-a0.startYear]!
  const r=forkHistory({parent:a0,branchId:id,forkYear:FORK_YEAR,modifiers:[TRUST_BOOST],
    evaluatorsFor:({ledger})=>build(start,ledger)})
  if(!r.ok)throw new Error(r.code+':'+r.message)
  return r.branch
}
const events=(b:Branch,type:string)=>b.eventLog.filter(e=>e.eventType===type)
const at=(b:Branch,year:number)=>b.snapshots[year-b.startYear]!
const t=(b:Branch,rule:string,year:number)=>b.decisionTraces.filter(x=>x.ruleId===rule&&x.year===year)
const status=(b:Branch,rule:string,year:number)=>t(b,rule,year).map(x=>x.status)
const west=(b:Branch,year:number)=>at(b,year).titles.find(x=>x.titleId==='title-exp-west')!

describe('実WorldState起点の自律人物・世代交代（CALIBRATION_ONLY）',()=>{
  const {a0,timeline}=root()
  const a1=fork(a0)

  it('どの未来年にも死亡/出生予定表を渡さず1250→1350を100ステップ実計算',()=>{
    expect(timeline.status).toBe('COMPLETED')
    expect(a0.status).toBe('COMPLETED')
    expect(a1.status).toBe('COMPLETED')
    expect(a0.snapshots).toHaveLength(101)
    expect(a1.snapshots).toHaveLength(101)
    expect(a1.recompute).toMatchObject({fromYear:FORK_YEAR,transitions:90,status:'COMPLETED'})
    expect(a1.snapshots.slice(0,11)).toEqual(a0.snapshots.slice(0,11))
    expect(a1.eventLog.filter(e=>e.year<FORK_YEAR)).toEqual(a0.eventLog.filter(e=>e.year<FORK_YEAR))
    expect(t(a0,'B-004',1250).length).toBeGreaterThan(0)
    expect(t(a0,'B-004',1250).some(x=>x.reasonCodes.includes('DISCOVERED_FROM_WORLDSTATE'))).toBe(true)
    expect(t(a0,'B-002',1260)).toEqual([])
    expect(a0.snapshots[0]?.legal.marriages).toEqual([])
  })

  it('A0のB004は信頼10でREJECT、A1は介入+20で1260年に交渉・明示承認婚姻',()=>{
    const pair=(b:Branch,year:number)=>t(b,'B-004',year).find(x=>x.actorRef.kind==='PERSON_PAIR'&&
      x.actorRef.ids[0]===P4&&x.actorRef.ids[1]===P5)
    const p0=pair(a0,1260)!,p1=pair(a1,1260)!
    expect([p0.status,p1.status]).toEqual(['REJECT','ACCEPT'])
    expect([p0.candidates[0]!.score,p1.candidates[0]!.score]).toEqual([10,30])
    expect(p1.modifierIds).toEqual([TRUST_BOOST.modifierId])
    expect(events(a0,'MARRIAGE_REGISTER')).toHaveLength(0)
    const marriages=events(a1,'MARRIAGE_REGISTER')
    expect(marriages).toHaveLength(1)
    expect(marriages[0]).toMatchObject({year:1260,phase:3})
    expect(at(a1,1261).legal.marriages[0]).toMatchObject({personIds:[P4,P5],status:'ACTIVE'})
    expect(t(a1,'A-LEG-01',1260)[0]?.eventIds).toEqual([marriages[0]!.eventId])
  })

  it('婚姻が成立するとWorldStateから毎年子を抽選し、出生枠へ請求する（事前出生年なし）',()=>{
    const babies=events(a1,'PERSON_BIRTH')
    expect(babies.length).toBeGreaterThan(0)
    expect(events(a0,'PERSON_BIRTH')).toEqual([])
    const m=at(a1,1261).legal.marriages[0]!
    const id=childIdForMarriageYear(m.marriageId,P4,P5,1261)
    const p=at(a1,1262).persons.find(x=>x.personId===id)
    expect(p).toMatchObject({
      birthYear:1261,alive:true,fatherId:P4,motherId:P5,
      originGroupId:'group-east-elite',houseId:'house-cardon',
      legalDynasty:{status:'DETERMINED',dynastyId:'dynasty-vargas'},
    })
    expect(at(a0,1262).persons.some(x=>x.personId===id)).toBe(false)
    expect(status(a1,'B-002',1261)).toContain('ACCEPT')
    const birth=t(a1,'B-002',1261).find(x=>x.actorRef.kind==='PERSON'&&x.actorRef.id===id)!
    expect(birth.random?.stream).toBe('ENDOGENOUS')
    expect(birth.eventIds).toHaveLength(1)
    expect(babies.find(e=>e.eventId===birth.eventIds[0])?.sourceTraceIds).toEqual([birth.traceId])
    expect(events(a1,'LEGAL_DYNASTY_SET').length).toBeGreaterThan(0)
    expect(events(a1,'LEGAL_DYNASTY_SET').every(e=>e.sourceTraceIds.some(id=>a1.decisionTraces.some(t=>t.traceId===id&&t.ruleId==='A-DYN-02')))).toBe(true)
    // 人物はコホート人口の内訳。匿名人口の出生・死亡数値を再変更しない。
    expect(a1.snapshots.map(w=>w.groups)).toEqual(a0.snapshots.map(w=>w.groups))
    expect(events(a1,'POPULATION_COHORT')).toEqual(events(a0,'POPULATION_COHORT'))
  })

  it('年齢とC004枠によって自然死亡が発生し、同じseedなら枝が違っても元の人物の死亡は一致',()=>{
    const p0=events(a0,'PERSON_DEATH').filter(e=>e.involvedRefs.some(r=>r.kind==='PERSON'&&r.id===P4))
    const p1=events(a1,'PERSON_DEATH').filter(e=>e.involvedRefs.some(r=>r.kind==='PERSON'&&r.id===P4))
    expect(p0).toHaveLength(1)
    expect(p1).toEqual(p0)
    expect(p1[0]?.year).toBe(1215+60) // 人物のWorldState生年＋校正年齢から算出（イベント表ではない）
    expect(at(a1,p1[0]!.year+1).persons.find(x=>x.personId===P4)).toMatchObject({alive:false,deathYear:p1[0]!.year})
    const dt=t(a1,'B-003',p1[0]!.year).find(x=>x.actorRef.kind==='PERSON'&&x.actorRef.id===P4)!
    expect(dt.status).toBe('ACCEPT')
    expect(dt.eventIds).toEqual([p1[0]!.eventId])
    expect(dt.random?.stream).toBe('ENDOGENOUS')
    expect(dt.candidates[0]?.inputs.age).toBe(60)
    expect(events(a1,'PERSON_DEATH').length).toBeGreaterThan(5)
  })

  it('死者のTERRITORIAL Titleには、現在の実子孫から相続候補を記録。ただし承認はPENDING',()=>{
    const year=1215+60
    const sc=t(a1,'A-SUC-04',year).find(x=>x.actorRef.kind==='REGION'&&x.actorRef.id==='region-eldia-west'&&
      x.reasonCodes.includes('AUTONOMOUS_CANDIDATE_DISCOVERY_ONLY'))!
    expect(sc.status).toBe('DEFER')
    const ids=sc.candidates[0]?.inputs.proposedHeirPersonIds
    expect(Array.isArray(ids)).toBe(true)
    expect((ids as string[]).length).toBeGreaterThan(0)
    expect((ids as string[]).every(id=>at(a1,year+1).persons.some(p=>p.personId===id&&p.alive))).toBe(true)
    const cases=at(a1,year+1).legal.cases.filter(c=>c.titleId==='title-exp-west')
    expect(cases).toHaveLength(1)
    expect(cases[0]).toMatchObject({kind:'SUCCESSION',status:'PENDING'})
    expect(cases[0]?.candidatePersonIds).toEqual(ids)
    const record=t(a1,'A-SUC-04',year).find(x=>x.reasonCodes.includes('LEGAL_CASE_RECORDING_ONLY'))!
    expect(record).toMatchObject({status:'ACCEPT'})
    const caseEvent=events(a1,'LEGAL_CASE_SET').find(e=>e.year===year&&e.sourceTraceIds.includes(record.traceId))!
    expect(caseEvent).toBeDefined()
    expect(record.eventIds).toEqual([caseEvent.eventId])
    expect(west(a1,year).holder).toEqual({status:'HELD',personId:P4})
    expect(west(a1,year+1).holder.status).toBe('UNDETERMINED')
    expect(west(a0,year+1).holder.status).toBe('UNDETERMINED')
    const dec=t(a1,'A-TIT-07',year).find(x=>x.reasonCodes.includes('GAME_02_APPROVAL_REQUIRED'))!
    expect(dec.status).toBe('DEFER')
    // 代理統治・徴税権・region実効支配は変化させない。
    expect(at(a1,year+1).regions).toEqual(at(a0,year+1).regions)
    expect(at(a1,year+1).legal.controlMandates).toEqual(at(a0,year+1).legal.controlMandates)
    expect(at(a1,year+1).legal.taxMandates).toEqual(at(a0,year+1).legal.taxMandates)
  })

  it('未承認婚姻証拠では自律縁談・出生の合法成立を捏造せず、目標はnull',()=>{
    for(const b of [a0,a1]){
      expect(b.goal).toBeNull()
      expect(b.snapshots[100]?.year).toBe(1350)
      expect(b.eventLog.every(e=>e.sourceTraceIds.every(id=>b.decisionTraces.some(t=>t.traceId===id)))).toBe(true)
    }
    expect(RULE_REGISTRY).toHaveLength(37)
    expect(RULE_REGISTRY.every(r=>r.implementationStatus==='TODO')).toBe(true)
    expect(timeline.autonomousHistory.status).toBe('NOT_ESTABLISHED')
    expect(timeline.coverage.injectedTodoRuleIds).toEqual(expect.arrayContaining([
      'RULE-C-004','B-002','B-003','B-004','B-005','A-LEG-01','A-DYN-02','A-SUC-04','A-TIT-07',
    ]))
  })

  it('同seed・同じ評価器factoryと係数ではforkHistoryの結果が決定的。係数違いを自動で同一視しない',()=>{
    const b=fork(a0,'A1-alt')
    expect(b.snapshots).toEqual(a1.snapshots)
    expect(b.eventLog).toEqual(a1.eventLog)
    expect(b.decisionTraces).toEqual(a1.decisionTraces)
    expect(b.ledger).toEqual(a1.ledger)
    expect(a1.evaluatorProfile).toEqual(a0.evaluatorProfile)
    expect(fork(a0)).toEqual(a1)
  })
})

describe('WorldStateからの自律生成 — 安全な失敗と境界',()=>{
  it('C004出生枠がない状態で婚姻だけ存在してもB002は出生を確定しない',()=>{
    const w=world()
    const marriage:Marriage={marriageId:'synthetic-initial-marriage',personIds:[P4,P5],registeredYear:1250,
      status:'ACTIVE',contract:APPROVAL.contract}
    const initial:WorldState={...w,legal:{...w.legal,marriages:[marriage]}}
    const ev=build(initial)
    const onlyB=runYear(initial,{seed:SEED,evaluators:{'B-002':ev['B-002'],'A-DYN-02':ev['A-DYN-02']}})
    expect(onlyB.status).toBe('COMPLETED')
    if(onlyB.status!=='COMPLETED')return
    expect(onlyB.events).toEqual([])
    expect(onlyB.traces.find(t=>t.ruleId==='B-002')?.status).toBe('DEFER')
    expect(onlyB.world.persons).toEqual(initial.persons)
    const whole=runYear(initial,{seed:SEED,evaluators:ev})
    expect(whole.status).toBe('COMPLETED')
    if(whole.status!=='COMPLETED')return
    expect(whole.events.filter(e=>e.eventType==='PERSON_BIRTH')).toHaveLength(1)
    expect(whole.events.filter(e=>e.eventType==='LEGAL_DYNASTY_SET')).toHaveLength(1)
    const cOnly=runYear(initial,{seed:SEED,evaluators:{'RULE-C-004':ev['RULE-C-004']}})
    expect(cOnly.status).toBe('COMPLETED')
    if(cOnly.status!=='COMPLETED')return
    expect(whole.world.groups).toEqual(cOnly.world.groups) // BのPerson追加はC004人口とは独立
  })

  it('自然死亡枠がない年はB003は生存者を殺さない',()=>{
    const w=world()
    const old:WorldState={...w,persons:w.persons.map(p=>p.personId===P4?{...p,birthYear:1180}:p)}
    const r=runYear(old,{seed:SEED,evaluators:{'B-003':createB003WorldStateEvaluator(CONFIG)}})
    expect(r.status).toBe('COMPLETED')
    if(r.status!=='COMPLETED')return
    expect(r.events.filter(e=>e.eventType==='PERSON_DEATH')).toHaveLength(0)
    expect(r.traces.find(t=>t.ruleId==='B-003'&&t.actorRef.kind==='PERSON'&&t.actorRef.id===P4)?.reasonCodes)
      .toContain('NATURAL_DEATH_SLOT_MISSING')
    expect(r.world.persons.find(p=>p.personId===P4)?.alive).toBe(true)
  })

  it('婚姻候補予算を超えても候補をこっそり捨てずEVALUATION_FAILED',()=>{
    const w=world()
    const v=createPairTrustView({base:BASE,ledger:[],knownPersonIds:new Set(w.persons.map(p=>p.personId))})
    if(!v.ok)throw new Error('base invalid')
    const c={...CONFIG,marriage:{...CONFIG.marriage,maxCandidatePairs:1}}
    const r=runYear(w,{seed:SEED,evaluators:{'B-004':createB004WorldStateEvaluator(v.view,c)}})
    expect(r.status).toBe('HALTED')
    if(r.status==='HALTED')expect(r.halt).toMatchObject({code:'EVALUATION_FAILED',ruleId:'B-004'})
  })

  it('係数の値域不正は生成前に拒否。全規則がTODOのまま動作試験として明示注入',()=>{
    expect(validateAutonomyCalibration({...CONFIG,birth:{...CONFIG.birth,chancePermille:1001}}).ok).toBe(false)
    expect(validateAutonomyCalibration({...CONFIG,death:{...CONFIG.death,maxPermille:-1}}).ok).toBe(false)
    expect(validateAutonomyCalibration(EXPERIMENTAL_AUTONOMY).ok).toBe(true)
    const map=createAutonomousCalibrationEvaluators({branchStartWorld:world(),ledger:[],trustBase:BASE,
      marriageEvidence:[],autonomy:CONFIG})
    expect(map.ok).toBe(true)
    expect(Object.keys(map.ok?map.evaluators:{}).sort()).toEqual([
      'A-DYN-02','A-LEG-01','A-SUC-04','A-TIT-07','B-002','B-003','B-004','B-005','RULE-C-004',
    ].sort())
  })
})
