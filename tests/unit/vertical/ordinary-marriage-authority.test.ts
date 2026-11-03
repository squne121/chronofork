// DEC-057：B-004/B-005の実判断→通常婚姻認証→AのEventを、未来の固定年承認なしで検証。
import { describe, expect, it } from 'vitest'
import { createRootBranch, forkHistory } from '../../../src/simulation/branching/index.ts'
import { runTimeline } from '../../../src/simulation/engine/index.ts'
import { createALeg01OrdinaryEvaluator } from '../../../src/simulation/rules/a/index.ts'
import { createB005CalibrationEvaluator } from '../../../src/simulation/rules/b/index.ts'
import type { OrdinaryMarriageInput, OrdinaryMarriageReview } from '../../../src/simulation/rules/a/index.ts'
import type { OrdinaryLaw } from '../../../src/simulation/legal/ordinary-authority.ts'
import { reviewOrdinaryAuthority, reviewOrdinaryDelegation, validateOrdinaryLaws } from '../../../src/simulation/legal/ordinary-authority.ts'
import { createExperimentalWorld, createExperimentalLegalEvidence } from '../../../src/scenario/experimental/index.ts'
import {
  B004_BRANCH_CONFIG as CFG, FORK_YEAR, P4, P5, TRUST_BOOST, createSyntheticWorld, evaluatorsForLedger,
} from './b004-branch-fixture.ts'

const COUNTRY={kind:'COUNTRY' as const,id:'country-eldia'}
const MARRIAGE_LAW:OrdinaryLaw={
  lawId:'experimental-law-domestic-marriage',action:'NORMAL_MARRIAGE',issuerRef:COUNTRY,
  sovereignCountryId:COUNTRY.id,effectiveFromYear:1250,endExclusiveYear:1351,
  origin:'BACKGROUND_PRE_1250',provenance:'CALIBRATION_ONLY',
}
const SUCCESSION_LAW:OrdinaryLaw={
  ...MARRIAGE_LAW,lawId:'experimental-law-land-succession',action:'NORMAL_LAND_SUCCESSION',
}
const DELEGATION_LAW:OrdinaryLaw={
  ...MARRIAGE_LAW,lawId:'experimental-law-central-delegation',action:'NEW_CONTROL_MANDATE',
  regionId:'region-eldia-central',titleId:'title-exp-central',grantBasisId:'exp-basis-central',
}
const REVIEW:OrdinaryMarriageReview={
  reviewId:'experimental-eligibility-p4p5',personIds:[P4,P5],countryId:COUNTRY.id,
  lawId:MARRIAGE_LAW.lawId,reviewedBy:COUNTRY,
  availableFromYear:1250,endExclusiveYear:1350,contractCandidateId:null,
  status:'ELIGIBLE',provenance:'CALIBRATION_ONLY',
}
const book=()=>{
  const b=createExperimentalLegalEvidence()
  return {...b,approvalAuthorities:[
    {authorityBasisId:MARRIAGE_LAW.lawId,action:'NORMAL_MARRIAGE' as const,
      holderRef:COUNTRY,sovereignCountryId:COUNTRY.id,provenance:'CALIBRATION_ONLY' as const},
    {authorityBasisId:SUCCESSION_LAW.lawId,action:'NORMAL_LAND_SUCCESSION' as const,
      holderRef:COUNTRY,sovereignCountryId:COUNTRY.id,provenance:'CALIBRATION_ONLY' as const},
  ]}
}
const ordinary=(override:Partial<OrdinaryMarriageInput>={})=>({
  book:override.book??book(),
  laws:override.laws??[MARRIAGE_LAW,SUCCESSION_LAW,DELEGATION_LAW],
  reviews:override.reviews??[REVIEW],
} satisfies OrdinaryMarriageInput)
const evaluators=(ledger:readonly import('../../../src/simulation/contracts/index.ts').StatModifier[],
  opt:Partial<OrdinaryMarriageInput>={})=>{
  const a=createALeg01OrdinaryEvaluator(ordinary(opt))
  if(!a.ok)throw new Error(a.issues.join(','))
  return {...evaluatorsForLedger(ledger),'B-005':createB005CalibrationEvaluator(),
    'A-LEG-01':a.evaluator}
}
const run=(opt:Partial<OrdinaryMarriageInput>={})=>{
  const es=evaluators([],opt)
  const a0=runTimeline(createSyntheticWorld(),{seed:CFG.seed,branchId:'A0',evaluators:es})
  const root=createRootBranch(a0,[],es)
  if(!root.ok)throw new Error(root.code+':'+root.message)
  const fork=forkHistory({parent:root.branch,branchId:'A1',forkYear:FORK_YEAR,
    modifiers:[TRUST_BOOST],evaluatorsFor:({ledger})=>evaluators(ledger,opt)})
  if(!fork.ok)throw new Error(fork.code+':'+fork.message)
  return {a0,a1:fork.branch}
}
const marriages=(b: ReturnType<typeof run>['a1'])=>b.eventLog.filter(e=>e.eventType==='MARRIAGE_REGISTER')

describe('DEC-057: 国内婚姻の権限と当年合意',()=>{
  it('法令・独立権限記録があるときだけ認証し、B-005の合意が生じた年に婚姻を登録',()=>{
    const {a0,a1}=run()
    expect(a0.status).toBe('COMPLETED')
    expect(a1.status).toBe('COMPLETED')
    expect(a0.eventLog.filter(e=>e.eventType==='MARRIAGE_REGISTER')).toHaveLength(0)
    expect(marriages(a1)).toHaveLength(1)
    const registered=marriages(a1)[0]!
    expect(registered.year).toBe(1260)
    const trace=a1.decisionTraces.find(t=>t.ruleId==='A-LEG-01'&&t.year===registered.year)!
    expect(trace.status).toBe('ACCEPT')
    expect(trace.candidates[0]?.inputs).toMatchObject({lawId:MARRIAGE_LAW.lawId,reviewId:REVIEW.reviewId})
    expect(registered.sourceTraceIds).toEqual([trace.traceId])
    expect(a1.snapshots[11]?.legal.marriages[0]).toMatchObject({status:'ACTIVE',personIds:[P4,P5]})
    expect(a1.snapshots[11]?.legal.marriages[0]?.contract).toBeUndefined()
    expect(a1.goal).toBeNull()
  })

  it('法令欠落・独立権限記録欠落・審査未完了では婚姻を登録しない',()=>{
    const probes:Partial<OrdinaryMarriageInput>[]=[
      {laws:[]},{book:{...book(),approvalAuthorities:[]}},{reviews:[]},
      {reviews:[{...REVIEW,status:'PENDING'}]},
      {reviews:[{...REVIEW,lawId:'different-law'}]},
    ]
    for(const opt of probes){
      const {a1}=run(opt)
      expect(marriages(a1)).toHaveLength(0)
      expect(a1.decisionTraces.some(t=>t.ruleId==='A-LEG-01'&&t.status==='DEFER')).toBe(true)
    }
  })

  it('法令が重複・無効・期限切れの場合は権限が成立しない',()=>{
    expect(validateOrdinaryLaws([MARRIAGE_LAW,MARRIAGE_LAW])).toContain('DUPLICATE_LAW:'+MARRIAGE_LAW.lawId)
    const world=createExperimentalWorld()
    expect(reviewOrdinaryAuthority(world,book(),[],{action:'NORMAL_MARRIAGE',
      sovereignCountryId:COUNTRY.id,issuerRef:COUNTRY,year:1260}).status).toBe('PENDING')
    expect(reviewOrdinaryAuthority(world,book(),[{...MARRIAGE_LAW,endExclusiveYear:1260}],{
      action:'NORMAL_MARRIAGE',sovereignCountryId:COUNTRY.id,issuerRef:COUNTRY,year:1260}).status).toBe('PENDING')
    expect(reviewOrdinaryAuthority(world,book(),[MARRIAGE_LAW],{action:'NORMAL_MARRIAGE',
      sovereignCountryId:'country-versa',issuerRef:COUNTRY,year:1260}).status).toBe('PENDING')
  })

  it('複数候補の婚姻契約は、確認された契約候補を選択しない限り成立しない',()=>{
    const two=createExperimentalLegalEvidence()
    const pair=[...two.marriageCandidates].filter(c=>c.personIds[0]==='person-exp-02'&&c.personIds[1]==='person-exp-05')
    expect(pair).toHaveLength(2)
    const normal=ordinary({reviews:[{...REVIEW,personIds:['person-exp-02','person-exp-05'],contractCandidateId:'unknown'}]})
    const a=createALeg01OrdinaryEvaluator(normal)
    expect(a.ok).toBe(true) // 実照会時にAgreement ID照合できなければDEFER
  })

  it('委任権限は地域・Title・初期Grant・当年実効統治主体を照合',()=>{
    const world=createExperimentalWorld()
    const a=reviewOrdinaryDelegation(world,book(),[DELEGATION_LAW],'title-exp-central',1285)
    expect(a).toMatchObject({status:'AUTHORIZED',lawId:DELEGATION_LAW.lawId})
    expect(reviewOrdinaryDelegation(world,book(),[{...DELEGATION_LAW,regionId:'region-eldia-east'}],
      'title-exp-central',1285).status).toBe('PENDING')
    const foreign={...world,regions:world.regions.map(r=>r.regionId==='region-eldia-central'?
      {...r,deFactoControllerRef:{kind:'COUNTRY' as const,id:'country-margald'}}:r)}
    expect(reviewOrdinaryDelegation(foreign,book(),[DELEGATION_LAW],'title-exp-central',1285).status).toBe('PENDING')
  })
})
