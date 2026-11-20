// Issue #83: C004実出生履歴を出典としたSUPPORTING成年者→禁親確認→婚姻→実出生。
import {describe,expect,it} from 'vitest'
import {createExperimentalWorld,createExperimentalOrdinaryLegalTrial} from '../../../src/scenario/experimental/index.ts'
import type {PairTrustBase,WorldState} from '../../../src/simulation/contracts/index.ts'
import {runYear} from '../../../src/simulation/engine/index.ts'
import {createCalibrationEvaluators} from '../../../src/simulation/rules/c/index.ts'
import {EXPERIMENTAL_TUNING} from '../../../src/simulation/tuning.ts'
import {createAutonomousCalibrationEvaluators,EXPERIMENTAL_AUTONOMY} from '../../../src/simulation/autonomy/index.ts'
import {supportingCandidateId} from '../../../src/simulation/population/supporting-marriage.ts'
import type {SupportingMarriageCohort} from '../../../src/simulation/population/supporting-marriage.ts'
import type {SupportingKinshipClearance} from '../../../src/simulation/rules/a/index.ts'
import type {B001SupportingInput} from '../../../src/simulation/rules/b/index.ts'
import {reviewDomesticMarriageEligibility} from '../../../src/simulation/legal/nextgen-marriage.ts'

const initial=createExperimentalWorld()
const seed=291001
const start:WorldState={...initial,demographics:{cohortSlots:[],anonymousBirthHistory:[]}}
const c4=createCalibrationEvaluators(EXPERIMENTAL_TUNING)
const trial=createExperimentalOrdinaryLegalTrial()
const cohort:SupportingMarriageCohort={
  cohortId:'trial:actual-C004-births-1250-east',groupId:'group-east-elite',
  affiliationHouseId:'house-cardon',familyPoolId:'trial:independently-observed-survivor',
  tier:'REGIONAL_LOWER_NOBILITY',sex:'FEMALE',birthYear:1250,memberCount:1,
  source:'C004_COHORT',sourceEvidenceId:'trial:year-1250-C004-group-east-elite',
  survivorAttestationId:'trial:year-1268-separate-census-alive',
  provenance:'CALIBRATION_ONLY',
}
const id=supportingCandidateId(cohort.cohortId,0)
const p2='person-exp-02'
const pair=[p2,id].sort() as [string,string]
const clearance:SupportingKinshipClearance={
  clearanceId:'trial:unrelated-kinship-check-1268',personIds:pair,countryId:'country-eldia',
  checkedYear:1268,validUntilYear:1270,
  sourceEvidenceId:'trial:distinct-lineage-document',provenance:'CALIBRATION_ONLY',
}
const config={cohorts:[cohort],maxRecordsPerYear:1,maxAliveSupporting:1,perCohortSamples:1,maximumPreviewAge:60}
// 2年間のCALIBRATION_ONLY分離試験。死亡と出生確率だけを固定し、出生枠・婚姻・契約は年次評価する。
const auto={...EXPERIMENTAL_AUTONOMY,
  birth:{...EXPERIMENTAL_AUTONOMY.birth,minMotherAge:18,maxMotherAge:40,minFatherAge:18,chancePermille:1000},
  death:{...EXPERIMENTAL_AUTONOMY.death,basePermille:0,maxPermille:0},
}
function toAdult():WorldState{
  let w=start
  for(let year=1250;year<1268;year++){
    const next=runYear(w,{seed,evaluators:c4})
    if(next.status!=='COMPLETED')throw new Error('C004_PREP:'+year+JSON.stringify(next.halt))
    w=next.world
  }
  return w
}
function calendar(world:WorldState,clearances:readonly SupportingKinshipClearance[],
  trustBase:readonly PairTrustBase[]=[],candidateTrust:number|null=40,supportingMarriage:B001SupportingInput=config,
  otherCandidateTrust:readonly PairTrustBase[]=[],autonomy=auto){
  const result=createAutonomousCalibrationEvaluators({branchStartWorld:world,ledger:[],trustBase,
    supportingMarriage,supportingCandidateTrustBase:candidateTrust===null?otherCandidateTrust:
      [{personIds:pair,value:candidateTrust},...otherCandidateTrust],
    nextgenMarriage:{book:trial.book,laws:trial.laws,supportingKinshipClearances:clearances},
    autonomy,
  })
  if(!result.ok)throw new Error('AUTONOMY_CONFIG:'+result.issues.join(','))
  return result.evaluators
}

describe('DEC-061: 過去年C004の匿名出生→非操作配偶者→翌年実出生',()=>{
  it('禁親証拠なしの高得点補助候補が、別の適格KEY候補を順位上占有しない',()=>{
    const alternative='person-exp-05'
    const keyPair=[p2,alternative].sort() as [string,string]
    const adult=toAdult()
    const r=runYear(adult,{seed,evaluators:calendar(adult,[],[{personIds:keyPair,value:40}],90)})
    expect(r.status).toBe('COMPLETED')
    if(r.status!=='COMPLETED')return
    const b5=r.traces.filter(t=>t.ruleId==='B-005'&&t.actorRef.kind==='PERSON_PAIR')
    const support=b5.find(t=>t.actorRef.kind==='PERSON_PAIR'&&t.actorRef.ids.join('|')===pair.join('|'))
    const key=b5.find(t=>t.actorRef.kind==='PERSON_PAIR'&&t.actorRef.ids.join('|')===keyPair.join('|'))
    expect(support?.status).toBe('DEFER')
    expect(support?.reasonCodes).toContain('SUPPORTING_KINSHIP_CLEARANCE_MISSING')
    expect(key?.status).toBe('ACCEPT')
    expect(r.world.legal.marriages.every(m=>!m.personIds.includes(id))).toBe(true)
  })
  it.each(['sourceEvidenceId', 'survivorAttestationId'] as const)('空白だけの%sでは年を停止せず候補を保留する', field=>{
    const adult=toAdult()
    const r=runYear(adult,{seed,evaluators:calendar(adult,[clearance],[],40,
      {...config,cohorts:[{...cohort,[field]:' '}]})})
    if(r.status!=='COMPLETED')throw new Error(JSON.stringify(r.halt))
    expect(r.traces.some(t=>t.ruleId==='B-001'&&t.status==='DEFER'&&t.reasonCodes.some(code=>
      code.startsWith(field==='sourceEvidenceId'?'COHORT_SOURCE_EVIDENCE_MISSING':'C004_SURVIVOR_ATTESTATION_MISSING')))).toBe(true)
    expect(r.world.persons.some(p=>p.personId===id)).toBe(false)
  })
  it('B-004の年齢条件で除外した提示は縁談評価予算に含めない',()=>{
    const adult=toAdult()
    const eligible=adult.persons.filter(p=>adult.year-p.birthYear>=21)
    const count=eligible.filter(p=>p.sex==='MALE').length*eligible.filter(p=>p.sex==='FEMALE').length
    expect(count).toBeGreaterThan(0)
    const r=runYear(adult,{seed,evaluators:calendar(adult,[clearance],[],40,config,[],
      {...auto,marriage:{minAdultAge:21,maxCandidatePairs:count}})})
    if(r.status!=='COMPLETED')throw new Error(JSON.stringify(r.halt))
    expect(r.traces.some(t=>t.ruleId==='B-001'&&t.candidates[0]?.inputs.supportingCandidateId===id)).toBe(true)
    expect(r.traces.filter(t=>t.ruleId==='B-004')).toHaveLength(count)
  })
  it('探索と禁親証拠が揃っても候補信頼値なしでは縁談を採択しない',()=>{
    const adult=toAdult()
    const r=runYear(adult,{seed,evaluators:calendar(adult,[clearance],[],null)})
    if(r.status!=='COMPLETED')throw new Error(JSON.stringify(r.halt))
    const trace=r.traces.find(t=>t.ruleId==='B-004'&&t.actorRef.kind==='PERSON_PAIR'&&
      JSON.stringify(t.actorRef.ids)===JSON.stringify(pair))
    expect(trace?.status).toBe('DEFER')
    expect(trace?.reasonCodes).toContain('NO_BASE_TRUST')
    expect(r.world.persons).toEqual(adult.persons)
    expect(r.world.legal.marriages).toEqual(adult.legal.marriages)
  })

  it.each([
    ['欠落', []],
    ['別ペアの転用', [{...clearance,personIds:['person-exp-04',id] as const}]],
    ['管轄違い', [{...clearance,countryId:'country-outside-test'}]],
    ['有効年外', [{...clearance,checkedYear:1267,validUntilYear:1268}]],
    ['出生出典の転用', [{...clearance,sourceEvidenceId:cohort.sourceEvidenceId}]],
    ['生存出典の転用', [{...clearance,sourceEvidenceId:cohort.survivorAttestationId!}]],
  ] as const)('C004の独立した禁親証拠が無効(%s)なら、候補提示後も法的登録しない',(_kind,clearances)=>{
    const adult=toAdult()
    const r=runYear(adult,{seed,evaluators:calendar(adult,clearances)})
    if(r.status!=='COMPLETED')throw new Error(JSON.stringify(r.halt))
    expect(r.traces.some(t=>t.ruleId==='B-001'&&t.status==='ACCEPT'&&
      t.candidates[0]?.inputs.supportingCandidateId===id)).toBe(true)
    expect(r.traces.some(t=>t.ruleId==='B-005'&&t.status==='DEFER'&&
      t.reasonCodes.includes('SUPPORTING_KINSHIP_CLEARANCE_MISSING')&&
      t.actorRef.kind==='PERSON_PAIR'&&JSON.stringify(t.actorRef.ids)===JSON.stringify(pair))).toBe(true)
    expect(r.events.filter(e=>e.eventType==='PERSON_SUPPORTING_RECORD')).toHaveLength(0)
    expect(r.world.persons.some(p=>p.personId===id)).toBe(false)
    expect(r.events.filter(e=>e.eventType==='MARRIAGE_REGISTER')).toHaveLength(0)
    expect(r.events.filter(e=>e.eventType==='PERSON_BIRTH')).toHaveLength(0)
    expect(r.world.legal.marriages).toEqual(initial.legal.marriages)
  })

  it('別枝から持ち込んだC004候補Traceを同年の候補供給と認めない',()=>{
    const adult=toAdult()
    const evaluators=calendar(adult,[clearance])
    const from=runYear(adult,{seed,branchId:'C004-別枝',evaluators})
    if(from.status!=='COMPLETED')throw new Error(JSON.stringify(from.halt))
    const foreign=from.traces.filter(t=>t.ruleId==='B-001'&&t.status==='ACCEPT')
    expect(foreign.length).toBeGreaterThan(0)
    const actual=evaluators['B-001']!
    const r=runYear(adult,{seed,branchId:'C004-本枝',evaluators:{...evaluators,'B-001':(world,ctx)=>{
      const out=actual(world,ctx)
      return {...out,traceDrafts:[...out.traceDrafts.filter(t=>t.status!=='ACCEPT'),...foreign]}
    }}})
    if(r.status!=='COMPLETED')throw new Error(JSON.stringify(r.halt))
    expect(r.world.persons).toEqual(adult.persons)
    expect(r.world.legal.marriages).toEqual(adult.legal.marriages)
    expect(r.traces.some(t=>t.ruleId==='B-004'&&t.actorRef.kind==='PERSON_PAIR'&&t.actorRef.ids.includes(id))).toBe(false)
  })
  it('同じC004候補への同率縁談をどちらも保留する',()=>{
    const adult=toAdult()
    // 01と02は同じ家門・法的王朝なので、候補側から見た家門利害も同率になる。
    const other='person-exp-01'
    const otherPair=[other,id].sort() as [string,string]
    const r=runYear(adult,{seed,evaluators:calendar(adult,[clearance,{
      ...clearance,clearanceId:'trial:separate-review-other-seeker',sourceEvidenceId:'trial:other-seeker-pedigree',personIds:otherPair,
    }],[],40,{...config,candidatePairs:[[p2,id],[other,id]]},[{personIds:otherPair,value:40}])})
    if(r.status!=='COMPLETED')throw new Error(JSON.stringify(r.halt))
    const competition=r.traces.filter(t=>t.ruleId==='B-005'&&t.actorRef.kind==='PERSON_PAIR'&&t.actorRef.ids.includes(id))
    expect(competition).toHaveLength(2)
    for(const t of competition){
      expect(t.status).toBe('DEFER')
      expect(t.reasonCodes).toContain('MUTUAL_UNIQUE_PARTNER_NOT_ESTABLISHED')
    }
    expect(r.world.legal.marriages).toEqual(adult.legal.marriages)
    expect(r.world.persons).toEqual(adult.persons)
  })

  it.each([[1,2], [2,1]] as const)('同年の有効なC004二件が人数予算を超えれば(%s/%s)優先順位を作らず保留する',(annualLimit,aliveLimit)=>{
    const adult=toAdult()
    const other='person-exp-04'
    const second:SupportingMarriageCohort={...cohort,cohortId:'trial:actual-C004-births-1250-south',
      groupId:'group-south-elite',affiliationHouseId:'house-rowen',familyPoolId:'trial:south-survivor',
      sourceEvidenceId:'trial:year-1250-C004-group-south-elite',survivorAttestationId:'trial:1268-separate-south-census'}
    const otherId=supportingCandidateId(second.cohortId,0)
    const otherPair=[other,otherId].sort() as [string,string]
    const run=(annual:number,alive:number)=>runYear(adult,{seed,evaluators:{...c4,...calendar(adult,[clearance,{
      ...clearance,clearanceId:'trial:south-pair-review',sourceEvidenceId:'trial:south-pair-pedigree',personIds:otherPair,
    }],[],40,{...config,cohorts:[cohort,second],maxAliveSupporting:alive,maxRecordsPerYear:annual,
      candidatePairs:[[p2,id],[other,otherId]]},[{personIds:otherPair,value:40}])}})
    const control=run(2,2)
    if(control.status!=='COMPLETED')throw new Error(JSON.stringify(control.halt))
    expect(control.events.flatMap(e=>e.supportingMarriageRegistrations??[])).toHaveLength(2)
    const over=run(annualLimit,aliveLimit)
    if(over.status!=='COMPLETED')throw new Error(JSON.stringify(over.halt))
    expect(over.world.year).toBe(adult.year+1)
    expect(over.world.persons).toEqual(adult.persons)
    expect(over.world.legal.marriages).toEqual(adult.legal.marriages)
    expect(over.events.flatMap(e=>e.supportingMarriageRegistrations??[])).toHaveLength(0)
    expect(over.events.some(e=>e.eventType==='POPULATION_COHORT')).toBe(true)
    const legal=over.traces.filter(t=>t.ruleId==='A-LEG-01')
    expect(legal).toHaveLength(2)
    for(const trace of legal){
      expect(trace.status).toBe('DEFER')
      expect(trace.reasonCodes).toContain('SUPPORTING_REGISTRATION_BUDGET_EXCEEDED')
      expect(trace.eventIds).toEqual([])
    }
  })

  it.each(['source','survivor','birth'] as const)('人口証拠欠落(%s)を理由付きで保留する',missing=>{
    const adult=toAdult()
    const input=missing==='birth'?{...adult,demographics:{cohortSlots:[]}}:adult
    const cohorts=[{...cohort,...(missing==='source'?{sourceEvidenceId:''}:
      missing==='survivor'?{survivorAttestationId:cohort.sourceEvidenceId}:{})}]
    const reason={source:'COHORT_SOURCE_EVIDENCE_MISSING:0',survivor:'C004_SURVIVOR_ATTESTATION_MISSING:0',
      birth:'C004_BIRTH_BACKING_INSUFFICIENT:0'}[missing]
    const r=runYear(input,{seed,evaluators:calendar(input,[clearance],[],40,{...config,cohorts})})
    if(r.status!=='COMPLETED')throw new Error(JSON.stringify(r.halt))
    expect(r.traces.some(t=>t.ruleId==='B-001'&&t.status==='DEFER'&&t.reasonCodes.includes(reason))).toBe(true)
    expect(r.world.persons.some(p=>p.personId===id)).toBe(false)
    expect(r.events.some(e=>e.eventType==='MARRIAGE_REGISTER'||e.eventType==='PERSON_BIRTH')).toBe(false)
  })
  it('実C004出典で1268年に登録・法的婚姻、1269年に実出生と契約に応じた法的王朝を記録',()=>{
    const adult=toAdult()
    expect(adult.demographics.anonymousBirthHistory?.find(h=>h.groupId===cohort.groupId&&h.year===1250)
      ?.anonymousBirths).toBeGreaterThanOrEqual(cohort.memberCount)
    expect(adult.persons.some(p=>p.personId===id)).toBe(false)
    const evaluators=calendar(adult,[clearance])
    const r=runYear(adult,{seed,evaluators})
    expect(r.status).toBe('COMPLETED')
    if(r.status!=='COMPLETED')return
    const spouse=r.world.persons.find(p=>p.personId===id)
    expect(spouse).toMatchObject({interactionRole:'SUPPORTING',birthYear:1250,
      legalDynasty:{status:'UNDETERMINED'},originGroupId:cohort.groupId})
    const marriage=r.world.legal.marriages.find(m=>m.personIds.join('|')===pair.join('|'))
    expect(marriage?.status).toBe('ACTIVE')
    expect(reviewDomesticMarriageEligibility(r.world,['person-exp-04',id])).toEqual({
      status:'DEFER',reasonCode:'ACTIVE_MARRIAGE_EXISTS',
    })
    expect(r.events.filter(e=>e.eventType==='PERSON_SUPPORTING_RECORD')).toHaveLength(0)
    const registrations=r.events.filter(e=>e.eventType==='MARRIAGE_REGISTER').flatMap(e=>e.supportingMarriageRegistrations??[])
    expect(registrations).toMatchObject([{marriageId:marriage?.marriageId,registration:{
      person:spouse,cohortId:cohort.cohortId,memberOrdinal:0,birthBacking:'C004_COHORT',
      sourceEvidenceId:cohort.sourceEvidenceId,survivorAttestationId:cohort.survivorAttestationId,
    }}])
    // 1268年C004の通常人口変化だけが発生し、個別人物の登録で人口は増えない。
    const populationOnly=runYear(adult,{seed,evaluators:c4})
    if(populationOnly.status!=='COMPLETED')throw new Error('C004_COMPARISON')
    expect(r.world.groups).toEqual(populationOnly.world.groups)
    expect(r.world.demographics).toEqual(populationOnly.world.demographics)
    const byPair=(ruleId:string)=>r.traces.find(t=>t.ruleId===ruleId&&t.actorRef.kind==='PERSON_PAIR'&&
      JSON.stringify(t.actorRef.ids)===JSON.stringify(pair))
    const supply=r.traces.find(t=>t.ruleId==='B-001'&&t.status==='ACCEPT'&&
      t.candidates[0]?.inputs.supportingCandidateId===id&&t.candidates[0]?.inputs.seekerPersonId===p2)
    expect(supply?.eventIds).toEqual([])
    expect(byPair('B-004')).toMatchObject({status:'ACCEPT',candidates:[{inputs:{trustSource:'CALIBRATION_ONLY_CANDIDATE_BASE'}}]})
    const negotiation=byPair('B-005')
    expect(negotiation?.status).toBe('ACCEPT')
    expect(negotiation?.candidates[0]?.inputs.supportingKinshipClearanceId).toBe(clearance.clearanceId)
    const legal=byPair('A-LEG-01')
    expect(legal?.status).toBe('ACCEPT')
    const marriageEvent=r.events.find(e=>e.eventType==='MARRIAGE_REGISTER'&&e.supportingMarriageRegistrations?.length)
    expect(marriageEvent?.sourceTraceIds).toEqual([legal?.traceId])
    expect(registrations[0]?.requestId).toBe(negotiation?.candidates[0]?.inputs.sourceRequestId)
    expect(runYear(adult,{seed,evaluators})).toEqual(r)
    const born=runYear(r.world,{seed,evaluators})
    expect(born.status).toBe('COMPLETED')
    if(born.status!=='COMPLETED')return
    const children=born.world.persons.filter(p=>p.birthYear===1269&&p.fatherId===p2&&p.motherId===id)
    expect(children).toHaveLength(1)
    const child=children[0]!
    const forChild=(ruleId:string)=>born.traces.find(t=>t.ruleId===ruleId&&t.actorRef.kind==='PERSON'&&t.actorRef.id===child.personId)
    const birth=forChild('B-002')
    expect(birth?.status).toBe('ACCEPT')
    const birthEvent=born.events.find(e=>e.eventType==='PERSON_BIRTH'&&e.sourceTraceIds.includes(birth!.traceId))
    expect(birthEvent?.eventId).toEqual(expect.any(String))
    const dynasty=forChild('A-DYN-02')
    const contract=marriage?.contract
    expect(contract?.evidenceId).toEqual(expect.any(String))
    const clause=contract?.clauses.find(c=>c.kind==='CHILD_LEGAL_DYNASTY')
    expect(dynasty?.candidates[0]?.inputs).toMatchObject({sourceBirthEventIds:[birthEvent?.eventId],
      sourceB002TraceId:birth?.traceId,contractId:contract?.contractId,contractEvidenceId:contract?.evidenceId})
    if(clause){
      expect(dynasty?.status).toBe('ACCEPT')
      expect(child.legalDynasty).toEqual({status:'DETERMINED',dynastyId:clause.dynastyId})
      expect(born.events.some(e=>e.eventType==='LEGAL_DYNASTY_SET'&&e.sourceTraceIds.includes(dynasty!.traceId))).toBe(true)
    }else{
      expect(dynasty?.status).toBe('DEFER')
      expect(dynasty?.reasonCodes).toContain('GAME_01_DYNASTY_CLAUSE_MISSING')
      expect(child.legalDynasty.status).toBe('UNDETERMINED')
    }
    expect(born.world.persons.find(p=>p.personId===id)?.interactionRole).toBe('SUPPORTING')
    expect(born.traces.some(t=>t.ruleId==='B-001'&&t.candidates[0]?.inputs.supportingCandidateId===id)).toBe(false)
    expect(born.events.flatMap(e=>e.supportingMarriageRegistrations??[])).toHaveLength(0)
    // 当年の人口加算はC004で済んでおり、B002は1枠を匿名から個別に割り当てるだけ。
    const anonymousOnly=runYear(r.world,{seed,evaluators:c4})
    if(anonymousOnly.status!=='COMPLETED')throw new Error('C004_BIRTH_COMPARISON')
    const anonymous=(w:WorldState)=>w.demographics.anonymousBirthHistory?.find(h=>h.groupId===cohort.groupId&&h.year===1269)?.anonymousBirths
    expect(born.world.groups).toEqual(anonymousOnly.world.groups)
    expect(anonymous(born.world)).toBe(anonymous(anonymousOnly.world)!-1)
    expect(runYear(r.world,{seed,evaluators})).toEqual(born)
    console.info('DEC061_C004_CALIBRATION_ONLY',JSON.stringify({
      supplyTraceId:supply?.traceId,negotiationTraceId:negotiation?.traceId,legalTraceId:legal?.traceId,
      requestId:registrations[0]?.requestId,marriageEventId:marriageEvent?.eventId,marriageId:marriage?.marriageId,
      contractId:contract?.contractId,contractEvidenceId:contract?.evidenceId,clauseId:clause?.clauseId,
      birthEventId:birthEvent?.eventId,birthTraceId:birth?.traceId,childId:child.personId,
      dynastyTraceId:dynasty?.traceId,legalDynasty:child.legalDynasty,
    }))
  },120000)
})
