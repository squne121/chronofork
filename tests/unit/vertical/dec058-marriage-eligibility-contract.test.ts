import { describe, expect, it } from 'vitest'
import { createExperimentalWorld, createExperimentalOrdinaryLegalTrial, NALVEN_DYNASTY_ID } from '../../../src/scenario/experimental/index.ts'
import type { Person, WorldState } from '../../../src/simulation/contracts/index.ts'
import { reviewDomesticMarriageEligibility } from '../../../src/simulation/legal/nextgen-marriage.ts'
import {
  chooseNextgenContract, negotiatedMarriageContract, EXPERIMENTAL_NEXTGEN_CONTRACT,
} from '../../../src/simulation/legal/nextgen-contract.ts'

const world=createExperimentalWorld()
const P2='person-exp-02',P3='person-exp-03',P4='person-exp-04',P5='person-exp-05'
const prepared=()=>createExperimentalOrdinaryLegalTrial()

describe('DEC-058 / 国内次世代の婚姻適格性・双方向契約選択',()=>{
  it('初期人物でも出生した子でも、同一の存命・18歳・管轄ルールで評価する',()=>{
    expect(reviewDomesticMarriageEligibility(world,[P2,P5])).toMatchObject({
      status:'ELIGIBLE',countryId:'country-eldia',
    })
    const girl=world.persons.find(p=>p.personId===P5)!
    const child:Person={...girl,personId:'test-child',birthYear:1240,
      fatherId:P4,motherId:P5,legalDynasty:{status:'UNDETERMINED',reasonCodes:['TEST']}}
    const w:WorldState={...world,persons:[...world.persons,child]}
    expect(reviewDomesticMarriageEligibility(w,[P2,child.personId])).toMatchObject({
      status:'DEFER',reasonCode:'BELOW_MVP_MARRIAGE_AGE',
    })
    const adult:WorldState={...w,year:1260}
    expect(reviewDomesticMarriageEligibility(adult,[P2,child.personId])).toMatchObject({status:'ELIGIBLE'})
  })
  it('記録された兄弟・直系・おじ姪・いとこは不可。親子参照不明はPENDING',()=>{
    expect(reviewDomesticMarriageEligibility(world,[P2,P3])).toMatchObject({
      status:'REJECT',reasonCode:'COMMON_ANCESTOR_WITHIN_TWO_GENERATIONS',
    })
    const girl=world.persons.find(p=>p.personId===P5)!
    const niece:Person={...girl,personId:'synthetic-niece',birthYear:1225,
      fatherId:P4,motherId:P3}
    const w:WorldState={...world,persons:[...world.persons,niece]}
    expect(reviewDomesticMarriageEligibility(w,[P2,niece.personId])).toMatchObject({
      status:'REJECT',reasonCode:'COMMON_ANCESTOR_WITHIN_TWO_GENERATIONS',
    })
    const broken:WorldState={...world,persons:world.persons.map(p=>
      p.personId===P5?{...p,fatherId:'no-such-person'}:p)}
    expect(reviewDomesticMarriageEligibility(broken,[P2,P5])).toMatchObject({
      status:'DEFER',reasonCode:'KINSHIP_EVIDENCE_BROKEN',
    })
  })
  it('国外の管轄、既存婚姻の重複、当年の年齢不足を安全に保留',()=>{
    expect(reviewDomesticMarriageEligibility(world,[P2,'person-exp-07']).status).toBe('DEFER')
    const w:WorldState={...world,legal:{...world.legal,marriages:[{
      marriageId:'existing',personIds:[P4,P5],registeredYear:1250,status:'ACTIVE',
    }]}}
    expect(reviewDomesticMarriageEligibility(w,[P2,P5])).toMatchObject({
      status:'DEFER',reasonCode:'ACTIVE_MARRIAGE_EXISTS',
    })
  })
  it('無条項・当事者の確定法的王朝だけが契約候補。双方の相互利益が一意最大なら採用',()=>{
    const cal={...EXPERIMENTAL_NEXTGEN_CONTRACT,ownDynastyBonus:2,
      otherDynastyCost:0,titleWeight:4,noClauseCost:5,supportWeight:0}
    const result=chooseNextgenContract(world,[P2,P5],40,cal)
    expect(result.choices.map(x=>x.dynastyId)).toEqual([
      null,'dynasty-cardon',NALVEN_DYNASTY_ID,
    ].sort((a,b)=>a===null?-1:b===null?1:a.localeCompare(b)))
    expect(result.status).toBe('ACCEPT')
    if(result.status==='ACCEPT'){
      expect(result.choice.dynastyId).toBe(NALVEN_DYNASTY_ID)
      const contract=negotiatedMarriageContract(1250,[P2,P5],result.choice,'trace:b005-agreement')
      expect(contract.evidenceId).toContain('trace:b005-agreement')
      expect(contract.clauses).toMatchObject([{kind:'CHILD_LEGAL_DYNASTY',dynastyId:NALVEN_DYNASTY_ID}])
    }
  })
  it('利益が同率で優先案が特定できなければ、候補IDや王朝名で勝者を決めない',()=>{
    const tie=chooseNextgenContract(world,[P2,P5],40,{
      ...EXPERIMENTAL_NEXTGEN_CONTRACT,
      ownDynastyBonus:0,otherDynastyCost:0,titleWeight:0,
      noClauseCost:0,supportWeight:0,
    })
    expect(tie).toMatchObject({status:'DEFER',reasonCode:'CONTRACT_CHOICE_TIE'})
    expect(tie.choices.length).toBe(3)
    const no=chooseNextgenContract(world,[P2,P5],40,{
      ...EXPERIMENTAL_NEXTGEN_CONTRACT,consentThreshold:900,
    })
    expect(no).toMatchObject({status:'DEFER',reasonCode:'NO_BILATERAL_CONSENT'})
  })
  it('P2/P5既存の2件の試験契約候補も、A-LEG01で勝手に優先されない',()=>{
    const trial=prepared()
    expect(trial.book.marriageCandidates.filter(c=>c.personIds.join('|')===[P2,P5].join('|')))
      .toHaveLength(2)
  })
})
