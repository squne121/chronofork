// DEC-058: 実WorldStateの相手選択・契約合意→A法制登録→B出生→A合法王朝帰属。
import { describe,expect,it } from 'vitest'
import { createExperimentalWorld,createExperimentalOrdinaryLegalTrial,NALVEN_DYNASTY_ID } from '../../../src/scenario/experimental/index.ts'
import { createAutonomousCalibrationEvaluators } from '../../../src/simulation/autonomy/index.ts'
import type { AutonomyCalibration } from '../../../src/simulation/autonomy/index.ts'
import type { NextgenContractCalibration } from '../../../src/simulation/legal/nextgen-contract.ts'
import { EXPERIMENTAL_NEXTGEN_CONTRACT } from '../../../src/simulation/legal/nextgen-contract.ts'
import { runYear } from '../../../src/simulation/engine/index.ts'
import type { WorldState } from '../../../src/simulation/contracts/index.ts'

const P2='person-exp-02',P4='person-exp-04',P5='person-exp-05'
const trial=createExperimentalOrdinaryLegalTrial()
const CALIBRATION:NextgenContractCalibration={
  ...EXPERIMENTAL_NEXTGEN_CONTRACT,
  ownDynastyBonus:2,otherDynastyCost:0,titleWeight:4,
  noClauseCost:5,supportWeight:0,
}
const AUTO:AutonomyCalibration={
  status:'CALIBRATION_ONLY',
  birth:{minMotherAge:18,maxMotherAge:32,minFatherAge:18,chancePermille:1000},
  death:{minAge:60,riskStartAge:59,basePermille:0,increasePerYearPermille:1000,maxPermille:1000},
  marriage:{minAdultAge:18,maxCandidatePairs:500},
}
const year=(world:WorldState,pairs:readonly (readonly [string,string])[],
  book=trial.book,cal=CALIBRATION)=>{
  const evaluators=createAutonomousCalibrationEvaluators({
    branchStartWorld:world,ledger:[],
    trustBase:pairs.map(ids=>({personIds:ids,value:40})),
    nextgenMarriage:{book,laws:trial.laws,calibration:cal},
    autonomy:AUTO,
  })
  if(!evaluators.ok)throw new Error(evaluators.issues.join('; '))
  return runYear(world,{seed:20260101,branchId:'A0',evaluators:evaluators.evaluators})
}
const completed=(r:ReturnType<typeof runYear>):WorldState=>{
  if(r.status!=='COMPLETED')throw new Error(JSON.stringify(r.halt))
  return r.world
}
const marriageEvents=(r:ReturnType<typeof runYear>)=>
  r.status==='COMPLETED'?r.events.filter(e=>e.eventType==='MARRIAGE_REGISTER'):[]

describe('DEC-058 次世代の実B-005合意・A登録・出生時の合法王朝',()=>{
  it('相互に唯一の結婚相手を選び、契約合意証拠と国家授権がある場合だけ婚姻登録',()=>{
    const r=year(createExperimentalWorld(),[[P2,P5]])
    const w=completed(r)
    expect(marriageEvents(r)).toHaveLength(1)
    const marriage=w.legal.marriages[0]!
    expect(marriage.personIds).toEqual([P2,P5])
    expect(marriage.registeredYear).toBe(1250)
    expect(marriage.contract?.clauses).toMatchObject([
      {kind:'CHILD_LEGAL_DYNASTY',dynastyId:NALVEN_DYNASTY_ID},
    ])
    if(r.status==='COMPLETED'){
      const b5=r.traces.find(t=>t.ruleId==='B-005'&&t.status==='ACCEPT')!
      const a=r.traces.find(t=>t.ruleId==='A-LEG-01'&&t.status==='ACCEPT')!
      expect(b5.reasonCodes).toContain('DEC_058_CONTRACT_NEGOTIATION')
      expect(b5.candidates[0]?.inputs.selectedContractKey).toBe('CHILD_DYNASTY:'+NALVEN_DYNASTY_ID)
      expect(a.candidates[0]?.inputs.contractId).toBe(marriage.contract?.contractId)
      expect(marriageEvents(r)[0]?.sourceTraceIds).toEqual([a.traceId])
    }
    expect(year(createExperimentalWorld(),[[P2,P5]])).toEqual(r)
  })

  it('本当に翌年出生した人物だけが、成立済み契約の明示条項から王朝帰属を獲得する',()=>{
    const w1251=completed(year(createExperimentalWorld(),[[P2,P5]]))
    const r=year(w1251,[[P2,P5]])
    const w1252=completed(r)
    if(r.status==='COMPLETED'){
      const births=r.events.filter(e=>e.eventType==='PERSON_BIRTH')
      expect(births.length).toBeGreaterThan(0)
      const child=w1252.persons.find(p=>p.birthYear===1251&&p.fatherId===P2&&p.motherId===P5)!
      expect(child).toBeDefined()
      expect(child.legalDynasty).toEqual({status:'DETERMINED',dynastyId:NALVEN_DYNASTY_ID})
      expect(r.events.some(e=>e.eventType==='LEGAL_DYNASTY_SET')).toBe(true)
    }
  })

  it('法的授権の欠落ではB-005の同意だけで婚姻を作らず、王朝を直接変更しない',()=>{
    const book={...trial.book,approvalAuthorities:[]}
    const r=year(createExperimentalWorld(),[[P2,P5]],book)
    const w=completed(r)
    expect(w.legal.marriages).toHaveLength(0)
    if(r.status==='COMPLETED'){
      expect(r.traces.some(t=>t.ruleId==='B-005'&&t.status==='ACCEPT')).toBe(true)
      expect(r.traces.some(t=>t.ruleId==='A-LEG-01'&&t.status==='DEFER')).toBe(true)
      expect(r.events.filter(e=>e.eventType==='MARRIAGE_REGISTER')).toHaveLength(0)
    }
  })

  it('同一人物に等価な縁談が集中すると、PERSON ID順で配偶者を決めない',()=>{
    const r=year(createExperimentalWorld(),[[P2,P5],[P4,P5]])
    const w=completed(r)
    expect(w.legal.marriages).toHaveLength(0)
    if(r.status==='COMPLETED')
      expect(r.traces.filter(t=>t.ruleId==='B-005'&&t.reasonCodes.includes(
        'MUTUAL_UNIQUE_PARTNER_NOT_ESTABLISHED')).length).toBeGreaterThan(0)
  })

  it('契約案の効用同率なら婚姻せず、ナルヴェン帰属条項を勝手に採用しない',()=>{
    const tie:NextgenContractCalibration={
      ...CALIBRATION,ownDynastyBonus:0,otherDynastyCost:0,titleWeight:0,
      noClauseCost:0,supportWeight:0,
    }
    const r=year(createExperimentalWorld(),[[P2,P5]],trial.book,tie)
    const w=completed(r)
    expect(w.legal.marriages).toHaveLength(0)
    if(r.status==='COMPLETED')
      expect(r.traces.some(t=>t.ruleId==='B-005'&&t.reasonCodes.includes('CONTRACT_CHOICE_TIE'))).toBe(true)
  })
})
