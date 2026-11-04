import { describe, expect, it } from 'vitest'
import { createExperimentalWorld } from '../../../src/scenario/experimental/index.ts'
import {
  proposeSupportingMarriageCandidates,supportingCandidateId,validateSupportingMarriageCohorts,
} from '../../../src/simulation/population/supporting-marriage.ts'
import type { SupportingMarriageCohort } from '../../../src/simulation/population/supporting-marriage.ts'
import type { WorldState } from '../../../src/simulation/contracts/index.ts'

const world=createExperimentalWorld()
const seeker='person-exp-02' // 初期重要人物、登録済みの相手01...08に限らず探せる
const cohort:SupportingMarriageCohort={
  cohortId:'trial:eldia-east-elite-1230-f',groupId:'group-east-elite',
  affiliationHouseId:'house-cardon',familyPoolId:'trial:other-family-not-yet-identified',
  tier:'REGIONAL_LOWER_NOBILITY',sex:'FEMALE',birthYear:1230,memberCount:12,
  source:'INITIAL_POPULATION',sourceEvidenceId:'experimental:assumed-age-band-1249',
  provenance:'CALIBRATION_ONLY',
}
const options={seed:73,maxCandidates:3,perCohortSamples:4,maximumPreviewAge:50} as const

describe('DEC-061: 大勢の人口集団からの非操作対象の婚姻候補供給（純粋技術境界）',()=>{
  it('初期8人物以外を候補に出せるが、重要Person/人口/婚姻/Goalは作らない',()=>{
    const before=structuredClone(world)
    const r=proposeSupportingMarriageCandidates(world,seeker,[cohort],options)
    expect(r.status).toBe('PROPOSED')
    expect(r.candidates.length).toBeGreaterThan(0)
    expect(r.candidates.length).toBeLessThanOrEqual(3)
    expect(r.reasonCodes).toContain('LEGAL_KINSHIP_REVIEW_REQUIRED')
    for(const c of r.candidates){
      expect(c).toMatchObject({
        groupId:cohort.groupId,sex:'FEMALE',tier:'REGIONAL_LOWER_NOBILITY',
        interactionRole:'SUPPORTING',individualPersonRegistered:false,
        kinshipStatus:'UNVERIFIED',provenance:'CALIBRATION_ONLY',
      })
      expect(c.candidateId).toBe(supportingCandidateId(cohort.cohortId,c.ordinal))
      expect(world.persons.some(p=>p.personId===c.candidateId)).toBe(false)
    }
    expect(world).toEqual(before) // 人口を勝手に増やさない・人物はまだ登録しない
    expect(proposeSupportingMarriageCandidates(world,seeker,[cohort],options)).toEqual(r)
  })
  it('使用済み候補IDの再選抜は禁止し、別の候補でのみ継続できる',()=>{
    const first=proposeSupportingMarriageCandidates(world,seeker,[cohort],options)
    const used=new Set(first.candidates.map(p=>p.candidateId))
    const next=proposeSupportingMarriageCandidates(world,seeker,[cohort],{...options,usedCandidateIds:used})
    expect(next.candidates.every(c=>!used.has(c.candidateId))).toBe(true)
  })
  it('男女・成年・同一主権管轄が一致しない候補は法的婚姻可能と扱わない',()=>{
    const wrongSex=proposeSupportingMarriageCandidates(world,seeker,[{...cohort,sex:'MALE'}],options)
    expect(wrongSex.candidates).toHaveLength(0)
    const tooYoung=proposeSupportingMarriageCandidates(world,seeker,[{...cohort,birthYear:1240}],options)
    expect(tooYoung.candidates).toHaveLength(0)
    const old=proposeSupportingMarriageCandidates(world,seeker,[{...cohort,birthYear:1160}],options)
    expect(old.candidates).toHaveLength(0)
    const foreign=proposeSupportingMarriageCandidates(world,seeker,[{
      ...cohort,groupId:'group-margald',affiliationHouseId:'house-margald-royal',
    }],options)
    expect(foreign.candidates).toHaveLength(0)
    expect(proposeSupportingMarriageCandidates(world,'no-such-person',[cohort],options))
      .toMatchObject({status:'DEFER',reasonCodes:['SEEKER_NOT_ADULT_OR_AVAILABLE']})
  })
  it('C-004で確定した出生枠を使えるが、実際の枠が足りないなら保留する',()=>{
    const derived:WorldState={...world,year:1270,demographics:{
      cohortSlots:[],
      anonymousBirthHistory:[{groupId:'group-east-elite',year:1250,anonymousBirths:24}],
    }}
    const birthCohort:SupportingMarriageCohort={
      ...cohort,birthYear:1250,memberCount:4,
      source:'C004_COHORT',sourceEvidenceId:'RULE-C-004:1250:east-elite',
      survivorAttestationId:'synthetic:current-survivors:1270:east-elite',
    }
    expect(validateSupportingMarriageCohorts(derived,[birthCohort])).toEqual([])
    const r=proposeSupportingMarriageCandidates(derived,seeker,[birthCohort],options)
    expect(r.status).toBe('PROPOSED')
    expect(r.candidates.length).toBeGreaterThan(0)
    const missing={...derived,demographics:{cohortSlots:[]}}
    expect(proposeSupportingMarriageCandidates(missing,seeker,[birthCohort],options))
      .toMatchObject({status:'DEFER',reasonCodes:expect.arrayContaining(['C004_BIRTH_BACKING_INSUFFICIENT:0'])})
    expect(proposeSupportingMarriageCandidates(derived,seeker,[{...birthCohort,memberCount:30}],options).status).toBe('DEFER')
  })
  it('同一構成員の重複供給・人口集団の超過・無根拠な階層は拒否する',()=>{
    const collision={...cohort,cohortId:'alias-of-the-same-pool'}
    expect(validateSupportingMarriageCohorts(world,[cohort,collision]))
      .toContain('COHORT_FAMILY_SLOT_OVERLAP:1')
    expect(validateSupportingMarriageCohorts(world,[cohort,{...cohort}]))
      .toContain('COHORT_ID_DUPLICATE:'+cohort.cohortId)
    const tooMany=proposeSupportingMarriageCandidates(world,seeker,[{...cohort,memberCount:99999}],options)
    expect(tooMany.status).toBe('DEFER')
    const wrongRank=proposeSupportingMarriageCandidates(world,seeker,[{
      ...cohort,tier:'ARBITRARY' as SupportingMarriageCohort['tier'],
    }],options)
    expect(wrongRank.status).toBe('DEFER')
    expect(proposeSupportingMarriageCandidates(world,seeker,[cohort],{...options,maxCandidates:0}).status)
      .toBe('DEFER')
  })
})
