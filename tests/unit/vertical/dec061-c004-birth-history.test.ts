// Issue #83: 実C004匿名出生の保存と18年後の補助候補の参照。CALIBRATION_ONLY。
import { describe, expect, it } from 'vitest'
import { createExperimentalWorld } from '../../../src/scenario/experimental/index.ts'
import { runYear } from '../../../src/simulation/engine/index.ts'
import type { WorldState } from '../../../src/simulation/contracts/index.ts'
import { createCalibrationEvaluators } from '../../../src/simulation/rules/c/index.ts'
import { EXPERIMENTAL_TUNING } from '../../../src/simulation/tuning.ts'
import { createB001SupportingMarriageEvaluator } from '../../../src/simulation/rules/b/index.ts'
import type { SupportingMarriageCohort } from '../../../src/simulation/population/supporting-marriage.ts'
import { validateWorldState } from '../../../src/simulation/validation/index.ts'

const seed=27001
const c4=createCalibrationEvaluators(EXPERIMENTAL_TUNING)
function yearsTo(endYear:number):WorldState{
  const initial=createExperimentalWorld()
  let w:WorldState={...initial,demographics:{
    ...initial.demographics,anonymousBirthHistory:[],
  }}
  for(let year=1250;year<endYear;year++){
    const r=runYear(w,{seed,evaluators:c4,branchId:'evidence-A0'})
    if(r.status!=='COMPLETED')throw new Error('C004 '+year+' '+JSON.stringify(r.halt))
    w=r.world
  }
  return w
}
const cohort:SupportingMarriageCohort={
  cohortId:'trial:birth-1250-east-elite-f',
  groupId:'group-east-elite',affiliationHouseId:'house-cardon',
  familyPoolId:'trial:independently-attested-survivors',
  tier:'REGIONAL_LOWER_NOBILITY',sex:'FEMALE',birthYear:1250,
  memberCount:1,source:'C004_COHORT',
  sourceEvidenceId:'trial:rule-c004-evidence:1250:east',
  survivorAttestationId:'trial:separately-attested-survivor:1270:east',
  provenance:'CALIBRATION_ONLY',
}
const config={cohorts:[cohort],maxRecordsPerYear:1,maxAliveSupporting:2,
  perCohortSamples:1,maximumPreviewAge:50} as const

describe('DEC-061 C004の過去年匿名出生の根拠を成人まで保存（非権威）',()=>{
  it('C004の年次出生数を年末に確定し、古い当年Slotを保持せず翌年以降も履歴を残す',()=>{
    const w1=yearsTo(1251)
    const record=w1.demographics.anonymousBirthHistory?.find(
      s=>s.groupId==='group-east-elite'&&s.year===1250)
    expect(record).toBeDefined()
    expect(record!.anonymousBirths).toBeGreaterThan(0)
    expect(w1.demographics.cohortSlots).toEqual([])
    const w2=yearsTo(1252)
    expect(w2.demographics.anonymousBirthHistory?.find(
      s=>s.groupId==='group-east-elite'&&s.year===1250)).toEqual(record)
    expect(w2.demographics.anonymousBirthHistory?.some(s=>s.year===1251)).toBe(true)
    expect(validateWorldState(JSON.parse(JSON.stringify(w2))).ok).toBe(true)
    expect(yearsTo(1252)).toEqual(w2)
  })

  it('18年間は未成年のC004候補を作らず、成人後に実出生枠と別の生存試験証拠で1人を記録',()=>{
    const source=yearsTo(1267)
    const setup=createB001SupportingMarriageEvaluator(config)
    expect(setup.ok).toBe(true)
    if(!setup.ok)return
    const notAdult=runYear(source,{seed,evaluators:{'B-001':setup.evaluator}})
    expect(notAdult.status).toBe('COMPLETED')
    if(notAdult.status==='COMPLETED'){
      expect(notAdult.events.filter(e=>e.eventType==='PERSON_SUPPORTING_RECORD')).toHaveLength(0)
    }
    const adult=yearsTo(1268)
    const r=runYear(adult,{seed,evaluators:{'B-001':setup.evaluator}})
    expect(r.status).toBe('COMPLETED')
    if(r.status!=='COMPLETED')return
    const added=r.world.persons.filter(p=>p.interactionRole==='SUPPORTING')
    expect(added).toHaveLength(1)
    expect(added[0]).toMatchObject({
      birthYear:1250,originGroupId:cohort.groupId,interactionRole:'SUPPORTING',
      legalDynasty:{status:'UNDETERMINED'},
    })
    expect(r.events.filter(e=>e.eventType==='PERSON_SUPPORTING_RECORD')).toHaveLength(1)
    expect(r.world.groups).toEqual(adult.groups)
    expect(r.world.demographics.anonymousBirthHistory).toEqual(adult.demographics.anonymousBirthHistory)
    const again=runYear(r.world,{seed,evaluators:{'B-001':setup.evaluator}})
    expect(again.status).toBe('COMPLETED')
    if(again.status==='COMPLETED')
      expect(again.events.filter(e=>e.eventType==='PERSON_SUPPORTING_RECORD')).toHaveLength(0)
    expect(runYear(adult,{seed,evaluators:{'B-001':setup.evaluator}})).toEqual(r)
  })

  it('死亡・本人の系譜・禁親非該当は出生数から推定せず、履歴欠落・生存証拠欠落・重複出生容量を拒否',()=>{
    const adult=yearsTo(1268)
    const missingSurvivor=createB001SupportingMarriageEvaluator({
      ...config,cohorts:[{...cohort,survivorAttestationId:undefined}],
    })
    expect(missingSurvivor.ok).toBe(true)
    if(missingSurvivor.ok){
      const failed=runYear(adult,{seed,evaluators:{'B-001':missingSurvivor.evaluator}})
      expect(failed.status).toBe('HALTED')
      if(failed.status==='HALTED')expect(failed.halt.evaluatorDiagnostics.map(d=>d.code))
        .toContain('C004_SURVIVOR_ATTESTATION_MISSING:0')
    }
    const missingHistory:WorldState={...adult,demographics:{cohortSlots:[]}}
    const ok=createB001SupportingMarriageEvaluator(config)
    if(!ok.ok)throw new Error('factory invalid')
    const noHistory=runYear(missingHistory,{seed,evaluators:{'B-001':ok.evaluator}})
    expect(noHistory.status).toBe('HALTED')
    if(noHistory.status==='HALTED')expect(noHistory.halt.evaluatorDiagnostics.map(d=>d.code))
      .toContain('C004_BIRTH_BACKING_INSUFFICIENT:0')

    const count=adult.demographics.anonymousBirthHistory!.find(s=>
      s.groupId===cohort.groupId&&s.year===cohort.birthYear)!.anonymousBirths
    const duplicateAlloc=createB001SupportingMarriageEvaluator({...config,cohorts:[
      {...cohort,memberCount:count}, {
        ...cohort,cohortId:cohort.cohortId+'other',
        familyPoolId:'trial:other-family',sex:'MALE',
        survivorAttestationId:'trial:other-survivor:1268',
      },
    ]})
    if(!duplicateAlloc.ok)throw new Error('factory invalid')
    const bad=runYear(adult,{seed,evaluators:{'B-001':duplicateAlloc.evaluator}})
    expect(bad.status).toBe('HALTED')
    if(bad.status==='HALTED')expect(bad.halt.evaluatorDiagnostics.some(
      d=>d.code.startsWith('C004_SHARED_BIRTH_CAPACITY_EXCEEDED'))).toBe(true)
    const corrupted={...adult,demographics:{
      ...adult.demographics,anonymousBirthHistory:[
        ...adult.demographics.anonymousBirthHistory!,
        {...adult.demographics.anonymousBirthHistory![0]!},
      ],
    }}
    expect(validateWorldState(corrupted).ok).toBe(false)
  })
})
