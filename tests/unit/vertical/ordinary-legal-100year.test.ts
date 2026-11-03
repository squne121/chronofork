// Issue #67: 年指定の法的承認表なしで、初期法令と実年次WorldStateからA0/A1を100年計算。
// GAME-02/03の具体的な法令ID・人物適格性証拠はCALIBRATION_ONLYの仮値であり正式な勝利ではない。
import { describe,expect,it } from 'vitest'
import { createExperimentalWorld,createExperimentalLegalEvidence,NALVEN_DYNASTY_ID } from '../../../src/scenario/experimental/index.ts'
import { createAutonomousCalibrationEvaluators } from '../../../src/simulation/autonomy/index.ts'
import type { AutonomyCalibration } from '../../../src/simulation/autonomy/index.ts'
import { createRootBranch,forkHistory } from '../../../src/simulation/branching/index.ts'
import { runTimeline } from '../../../src/simulation/engine/index.ts'
import { evaluateGoal } from '../../../src/simulation/goal.ts'
import type { LegalEvidenceBook } from '../../../src/simulation/legal/evidence.ts'
import type { OrdinaryLaw } from '../../../src/simulation/legal/ordinary-authority.ts'
import type { OrdinaryMarriageReview } from '../../../src/simulation/rules/a/index.ts'
import type { WorldState } from '../../../src/simulation/contracts/index.ts'
import { TRUST_BOOST,P4,P5,SEED } from './b004-branch-fixture.ts'

const ELDIA={kind:'COUNTRY' as const,id:'country-eldia'}
const law=(id:string,action:OrdinaryLaw['action']):OrdinaryLaw=>({
  lawId:id,action,issuerRef:ELDIA,sovereignCountryId:ELDIA.id,
  effectiveFromYear:1250,endExclusiveYear:1351,
  origin:'BACKGROUND_PRE_1250',provenance:'CALIBRATION_ONLY',
})
const MARRIAGE=law('law:trial-eldia-domestic-marriage','NORMAL_MARRIAGE')
const SUCCESSION=law('law:trial-eldia-land-succession','NORMAL_LAND_SUCCESSION')
const CONTROL:OrdinaryLaw={...law('law:trial-eldia-central-delegation','NEW_CONTROL_MANDATE'),
  titleId:'title-exp-central',regionId:'region-eldia-central',grantBasisId:'exp-basis-central'}
const LAWS=[MARRIAGE,SUCCESSION,CONTROL] as const
const BOOK:LegalEvidenceBook=(()=>{
  const b=createExperimentalLegalEvidence()
  return {...b,approvalAuthorities:[
    {authorityBasisId:MARRIAGE.lawId,action:'NORMAL_MARRIAGE' as const,
      holderRef:ELDIA,sovereignCountryId:ELDIA.id,provenance:'CALIBRATION_ONLY' as const},
    {authorityBasisId:SUCCESSION.lawId,action:'NORMAL_LAND_SUCCESSION' as const,
      holderRef:ELDIA,sovereignCountryId:ELDIA.id,provenance:'CALIBRATION_ONLY' as const},
  ]}
})()
const REVIEW:OrdinaryMarriageReview={
  reviewId:'trial-review-p4p5-eligibility',personIds:[P4,P5],countryId:ELDIA.id,
  lawId:MARRIAGE.lawId,reviewedBy:ELDIA,availableFromYear:1250,
  endExclusiveYear:1350,contractCandidateId:null,status:'ELIGIBLE',
  provenance:'CALIBRATION_ONLY',
}
const AUTO:AutonomyCalibration={
  status:'CALIBRATION_ONLY',
  birth:{minMotherAge:18,maxMotherAge:32,minFatherAge:18,chancePermille:1000},
  death:{minAge:60,riskStartAge:59,basePermille:0,increasePerYearPermille:1000,maxPermille:1000},
  marriage:{minAdultAge:18,maxCandidatePairs:500},
}
const world=createExperimentalWorld()
const make=(w:WorldState,ledger:readonly import('../../../src/simulation/contracts/index.ts').StatModifier[] )=>{
  const result=createAutonomousCalibrationEvaluators({
    branchStartWorld:w,ledger,trustBase:[{personIds:[P4,P5],value:10}],
    ordinaryMarriage:{book:BOOK,laws:LAWS,reviews:[REVIEW]},
    reviewedLegal:{book:BOOK,ordinaryLaws:LAWS},
    autonomy:AUTO,
  })
  if(!result.ok)throw new Error(result.issues.join(','))
  return result.evaluators
}
const evaluators=make(world,[])
const root=runTimeline(world,{seed:SEED,branchId:'A0',evaluators,
  goal:{dynastyId:NALVEN_DYNASTY_ID},technicalGoalEvaluation:true})
const rootB=createRootBranch(root,[],evaluators)
const branch=rootB.ok?forkHistory({parent:rootB.branch,forkYear:1260,branchId:'A1',
  modifiers:[TRUST_BOOST],evaluatorsFor:({ledger})=>
    make(rootB.branch.snapshots[10]!,ledger)}):null

describe('DEC-057: 国内通常権限による1250〜1350年A0/A1通し試験',()=>{
  it('初期世界から同一seedで100年計算し、正式goalを公開しない',()=>{
    expect(root.status).toBe('COMPLETED')
    expect(root.snapshots).toHaveLength(101)
    expect(root.technicalGoal).toEqual(evaluateGoal(root.snapshots.at(-1)!,{dynastyId:NALVEN_DYNASTY_ID}))
    expect(root.goal).toBeNull()
    expect(root.autonomousHistory.status).toBe('NOT_ESTABLISHED')
    expect(root.coverage.todoRuleIds).toHaveLength(37)
    expect(rootB.ok).toBe(true)
    expect(branch?.ok).toBe(true)
    if(!branch?.ok||!rootB.ok)return
    expect(branch.branch.status).toBe('COMPLETED')
    expect(branch.branch.snapshots).toHaveLength(101)
    expect(branch.branch.snapshots.slice(0,11)).toEqual(root.snapshots.slice(0,11))
    expect(branch.branch.goal).toBeNull()
    expect(evaluateGoal(branch.branch.snapshots.at(-1)!,{dynastyId:NALVEN_DYNASTY_ID}).status).toBe('NOT_ACHIEVED')
  })
  it('固定年の婚姻承認証拠なしで、信頼介入→同年B005照会→Aの通常婚姻が条件付きで成立する',()=>{
    if(!branch?.ok)return
    const marriages=branch.branch.eventLog.filter(e=>e.eventType==='MARRIAGE_REGISTER')
    const a0Marriages=root.eventLog.filter(e=>e.eventType==='MARRIAGE_REGISTER')
    expect(a0Marriages).toHaveLength(0)
    expect(marriages.length).toBeGreaterThan(0)
    const event=marriages.find(e=>e.involvedRefs.some(r=>
      r.kind==='PERSON_PAIR'&&r.ids[0]===P4&&r.ids[1]===P5))
    expect(event).toBeDefined()
    const trace=branch.branch.decisionTraces.find(t=>t.traceId===event?.sourceTraceIds[0])
    expect(trace?.status).toBe('ACCEPT')
    expect(trace?.reasonCodes).toContain('DEC_057_NORMAL_MARRIAGE')
    // 無条項婚姻で子に父系の既定所属を与えない。
    expect(branch.branch.snapshots.at(-1)!.legal.marriages.find(m=>m.personIds[0]===P4&&m.personIds[1]===P5)?.contract).toBeUndefined()
  })
  it('死後の国内世襲認証と新規Mandateが実Event/Traceとして生じ、地域主権・徴税権を変えない',()=>{
    const transfers=root.eventLog.filter(e=>e.eventType==='LEGAL_TITLE_TRANSFER')
    const mandates=root.eventLog.filter(e=>e.eventType==='CONTROL_MANDATE_SET')
    expect(transfers.length).toBeGreaterThan(0)
    expect(mandates.length).toBeGreaterThan(0)
    expect(transfers.some(e=>e.involvedRefs.some(r=>r.kind==='REGION'&&r.id==='region-eldia-central'))).toBe(true)
    expect(root.snapshots.at(-1)!.regions).toEqual(world.regions)
    expect(root.snapshots.at(-1)!.legal.taxMandates).toEqual(world.legal.taxMandates)
    for(const event of [...transfers,...mandates])
      expect(event.sourceTraceIds.every(id=>root.decisionTraces.some(t=>t.traceId===id&&t.eventIds.includes(event.eventId)))).toBe(true)
  })
  it('法令証拠を外すと、同じ1250年でも相続/委任の成功Eventを作らずPENDINGを維持する',()=>{
    const emptyBook=createExperimentalLegalEvidence()
    const result=createAutonomousCalibrationEvaluators({
      branchStartWorld:world,ledger:[],trustBase:[{personIds:[P4,P5],value:10}],
      ordinaryMarriage:{book:emptyBook,laws:[],reviews:[]},
      reviewedLegal:{book:emptyBook,ordinaryLaws:[]},
      autonomy:AUTO,
    })
    if(!result.ok)throw new Error(result.issues.join(','))
    const noAuthority=runTimeline(world,{seed:SEED,branchId:'no-law',evaluators:result.evaluators})
    expect(noAuthority.status).toBe('COMPLETED')
    expect(noAuthority.eventLog.filter(e=>e.eventType==='CONTROL_MANDATE_SET')).toHaveLength(0)
    expect(noAuthority.eventLog.filter(e=>e.eventType==='MARRIAGE_REGISTER')).toHaveLength(0)
    expect(noAuthority.snapshots.at(-1)!.legal.cases.some(c=>c.status==='PENDING')).toBe(true)
  })
})
