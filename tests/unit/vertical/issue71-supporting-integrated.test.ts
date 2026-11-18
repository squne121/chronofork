// Issue #71: 同一の正式コードで C004履歴→B001 SUPPORTINGが登録されるまでを高速検証。
// 100年A0/A1の全連鎖は明示オプトイン（dec058-integrated-100year-audit）。
import {describe,expect,it} from 'vitest'
import {createExperimentalWorld,createExperimentalOrdinaryLegalTrial} from '../../../src/scenario/experimental/index.ts'
import {createCalibrationEvaluators} from '../../../src/simulation/rules/c/index.ts'
import {EXPERIMENTAL_TUNING} from '../../../src/simulation/tuning.ts'
import {runYear} from '../../../src/simulation/engine/index.ts'
import {createAutonomousCalibrationEvaluators} from '../../../src/simulation/autonomy/index.ts'
import {EXPERIMENTAL_AUTONOMY} from '../../../src/simulation/autonomy/index.ts'
import type {AutonomyCalibration} from '../../../src/simulation/autonomy/index.ts'
import {EXPERIMENTAL_NEXTGEN_CONTRACT} from '../../../src/simulation/legal/nextgen-contract.ts'
import {EXPERIMENTAL_B009_CALIBRATION} from '../../../src/simulation/rules/b/index.ts'
import {supportingCohorts,supportingClearances,supportingPersonId,
  withC004BirthHistory,attested,witnessedSonId} from './issue71-supporting-fixture.ts'

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
  it('同じ校正で1250〜1280年を実計算し、1260年C004匿名出生からSUPPORTING婚姻・B002出生まで連結する',()=>{
    // 100年の長期試験と同じDEC-057/058/061評価器構成を1278〜1280年まで縮小。
    // 成立を検証するのであって、WorldStateに婚姻・子・勝敗を直接追加しない。
    let world=withC004BirthHistory(createExperimentalWorld())
    const trial=createExperimentalOrdinaryLegalTrial()
    const calibrated:AutonomyCalibration={
      status:'CALIBRATION_ONLY',
      birth:{minMotherAge:18,maxMotherAge:32,minFatherAge:18,chancePermille:1000},
      death:{minAge:60,riskStartAge:59,basePermille:0,increasePerYearPermille:1000,maxPermille:1000},
      marriage:{minAdultAge:18,maxCandidatePairs:1600},
    }
    const cfg=createAutonomousCalibrationEvaluators({
      branchStartWorld:world,ledger:[],
      trustBase:[{personIds:['person-exp-02','person-exp-05'],value:80}],
      nextgenMarriage:{
        book:trial.book,laws:trial.laws,
        calibration:{...EXPERIMENTAL_NEXTGEN_CONTRACT,
          ownDynastyBonus:2,otherDynastyCost:0,titleWeight:4,noClauseCost:5,supportWeight:0},
        supportingKinshipClearances:supportingClearances,
      },
      reviewedLegal:{book:trial.book,ordinaryLaws:trial.laws},
      spouseDeathDissolution:true,promotion:attested,
      supportingMarriage:{cohorts:supportingCohorts,maxRecordsPerYear:1,
        maxAliveSupporting:1,perCohortSamples:1,maximumPreviewAge:65},
      autonomy:calibrated,
      b009Calibration:{...EXPERIMENTAL_B009_CALIBRATION,
        initialTrust:25,annualDelta:1,houseSupportWeight:2,sameHouseBonus:10,maxPairs:1600},
    })
    expect(cfg.ok).toBe(true)
    if(!cfg.ok)return
    const events: string[]=[]
    const marriageChecks: {year:number;status:string;clearance:unknown}[]=[]
    for(let year=1250;year<=1280;year++){
      const r=runYear(world,{seed:20260101,evaluators:cfg.evaluators})
      expect(r.status,r.status==='HALTED'?JSON.stringify(r.halt):'').toBe('COMPLETED')
      if(r.status!=='COMPLETED')return
      events.push(...r.events.filter(e=>e.eventType==='PERSON_SUPPORTING_RECORD')
        .map(e=>e.eventType+':'+e.year))
      marriageChecks.push(...r.traces.filter(t=>t.ruleId==='B-005'&&
        t.actorRef.kind==='PERSON_PAIR'&&t.actorRef.ids[0]===witnessedSonId&&
        t.actorRef.ids[1]===supportingPersonId).map(t=>({
          year:t.year,status:t.status,
          clearance:t.candidates[0]?.inputs.supportingKinshipClearanceId,
        })))
      world=r.world
    }
    expect(world.year).toBe(1281)
    const supporting=world.persons.find(p=>p.personId===supportingPersonId)
    expect(supporting?.interactionRole).toBe('SUPPORTING')
    expect(supporting?.legalDynasty.status).toBe('UNDETERMINED')
    expect(events).toContain('PERSON_SUPPORTING_RECORD:1278')
    expect(marriageChecks.length).toBeGreaterThan(0)
    expect(marriageChecks.some(x=>x.status==='ACCEPT'&&
      x.clearance===supportingClearances[0]!.clearanceId)).toBe(true)
    const marriage=world.legal.marriages.find(m=>m.personIds.includes(supportingPersonId)&&
      m.personIds.includes(witnessedSonId))
    expect(marriage).toBeDefined()
    const children=world.persons.filter(p=>p.fatherId===witnessedSonId&&
      p.motherId===supportingPersonId)
    expect(children.length).toBeGreaterThan(0)
    expect(children.every(p=>p.birthYear>=1279)).toBe(true)
    const dynasty=marriage?.contract?.clauses.find(c=>c.kind==='CHILD_LEGAL_DYNASTY')?.dynastyId
    if(dynasty)expect(children.every(p=>p.legalDynasty.status==='DETERMINED'&&
      p.legalDynasty.dynastyId===dynasty)).toBe(true)
    else expect(children.every(p=>p.legalDynasty.status==='UNDETERMINED')).toBe(true)
    console.info('CHRONOFORK_ISSUE71_SUPPORTING_SHORT',JSON.stringify({
      seed:20260101,years:31,supportRecords:events.length,
      firstSupportingMarriageYear:marriage?.registeredYear??null,
      firstSupportingChildYear:children[0]?.birthYear??null,
      childCount:children.length,contractDynasty:dynasty??null,
      provenance:'CALIBRATION_ONLY',
    }))
  },90000)
})
