// Issue #71: 同一の正式コードで C004履歴→B001 SUPPORTINGが登録されるまでを高速検証。
// 100年A0/A1の全連鎖は明示オプトイン（dec058-integrated-100year-audit）。
import {describe,expect,it} from 'vitest'
import {createExperimentalWorld,createExperimentalOrdinaryLegalTrial} from '../../../src/scenario/experimental/index.ts'
import {createCalibrationEvaluators} from '../../../src/simulation/rules/c/index.ts'
import {EXPERIMENTAL_TUNING} from '../../../src/simulation/tuning.ts'
import {runYear} from '../../../src/simulation/engine/index.ts'
import {createAutonomousCalibrationEvaluators} from '../../../src/simulation/autonomy/index.ts'
import {EXPERIMENTAL_AUTONOMY} from '../../../src/simulation/autonomy/index.ts'
import {supportingCohorts,supportingClearances,supportingPersonId,
  withC004BirthHistory,attested} from './issue71-supporting-fixture.ts'

describe('Issue #71: C004集団からの非操作配偶者供給（CALIBRATION_ONLY）',()=>{
  it('1250年の匿名出生記録を持つ実WorldStateを経由し、18歳後のSUPPORTINGだけ個別登録する',()=>{
    let world=withC004BirthHistory(createExperimentalWorld())
    const c4=createCalibrationEvaluators(EXPERIMENTAL_TUNING)
    const seed=20260101
    for(let year=1250;year<1278;year++){
      const r=runYear(world,{seed,evaluators:c4})
      expect(r.status,r.status==='HALTED'?JSON.stringify(r.halt):'').toBe('COMPLETED')
      if(r.status!=='COMPLETED')return
      world=r.world
    }
    expect(world.year).toBe(1278)
    const proof=world.demographics.anonymousBirthHistory?.find(x=>
      x.groupId===supportingCohorts[0]!.groupId&&x.year===1260)
    expect(proof?.anonymousBirths).toBeGreaterThan(0)
    const trial=createExperimentalOrdinaryLegalTrial()
    const cfg=createAutonomousCalibrationEvaluators({
      branchStartWorld:world,ledger:[],trustBase:[],
      nextgenMarriage:{book:trial.book,laws:trial.laws,
        supportingKinshipClearances:supportingClearances},
      reviewedLegal:{book:trial.book,ordinaryLaws:trial.laws},
      promotion:attested,supportingMarriage:{cohorts:supportingCohorts,
        maxRecordsPerYear:1,maxAliveSupporting:1,perCohortSamples:1,maximumPreviewAge:65},
      autonomy:EXPERIMENTAL_AUTONOMY,
    })
    expect(cfg.ok).toBe(true)
    if(!cfg.ok)return
    const r=runYear(world,{seed,evaluators:cfg.evaluators})
    expect(r.status,r.status==='HALTED'?JSON.stringify(r.halt):'').toBe('COMPLETED')
    if(r.status!=='COMPLETED')return
    const registration=r.events.filter(e=>e.eventType==='PERSON_SUPPORTING_RECORD')
    expect(registration).toHaveLength(1)
    const candidate=r.world.persons.find(p=>p.personId===supportingPersonId)
    expect(candidate).toMatchObject({interactionRole:'SUPPORTING',sex:'FEMALE',
      birthYear:1260,originGroupId:'group-east-elite',legalDynasty:{status:'UNDETERMINED'}})
    expect(r.world.groups).toEqual(
      // C004以外で集団人口を一切変更しない。B001個別登録は人口加算ではない。
      (()=>{
        const comparison=runYear(world,{seed,evaluators:c4})
        if(comparison.status!=='COMPLETED')throw Error('C004_COMPARISON_STOP')
        return comparison.world.groups
      })())
    expect(r.traces.some(t=>t.ruleId==='B-001'&&t.status==='ACCEPT'&&
      t.candidates.some(c=>c.inputs.supportingPersonId===supportingPersonId))).toBe(true)
    expect(r.world.persons.filter(p=>p.personId===supportingPersonId)).toHaveLength(1)
  },30000)
})
