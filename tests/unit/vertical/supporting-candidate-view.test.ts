import { describe, expect, it } from 'vitest'
import { createExperimentalWorld } from '../../../src/scenario/experimental/index.ts'
import { createSupportingMarriageCandidateView } from '../../../src/simulation/population/supporting-marriage.ts'
import type { SupportingMarriageCohort } from '../../../src/simulation/population/supporting-marriage.ts'
import { createB001SupportingMarriageEvaluator } from '../../../src/simulation/rules/b/b001-supporting-marriage.ts'
import type { EvaluationContext } from '../../../src/simulation/engine/evaluators.ts'

const cohort: SupportingMarriageCohort = {
  cohortId:'view-cohort', groupId:'group-east-elite', affiliationHouseId:'house-cardon',
  familyPoolId:'view-family', tier:'REGIONAL_LOWER_NOBILITY', sex:'FEMALE', birthYear:1230,
  memberCount:12, source:'INITIAL_POPULATION', sourceEvidenceId:'trial-age-band', provenance:'CALIBRATION_ONLY',
}
const options = {seed:73,maxCandidates:4,perCohortSamples:4,maximumPreviewAge:50}

describe('当年・当枝の抽象婚姻候補ビュー', () => {
  it('候補は未登録で、枝はスコープのみ、worldを変更しない', () => {
    const world = createExperimentalWorld()
    const before = structuredClone(world)
    const scope = {branchId:'a',year:world.year,seekerId:'person-exp-02'}
    const a = createSupportingMarriageCandidateView(world,scope,[cohort],options)
    const b = createSupportingMarriageCandidateView(world,{...scope,branchId:'b'},[cohort],options)
    expect(a.result.status).toBe('PROPOSED')
    expect(a.result.candidates.length).toBeGreaterThan(0)
    expect(a.result).toEqual(b.result)
    expect(b.branchId).toBe('b')
    expect(a.result.candidates.every(c => !c.individualPersonRegistered && c.kinshipStatus === 'UNVERIFIED')).toBe(true)
    expect(world).toEqual(before)
    expect(createSupportingMarriageCandidateView(world,{...scope,year:world.year+1},[cohort],options).result.status).toBe('DEFER')
    expect(createSupportingMarriageCandidateView(world,{...scope,branchId:''},[cohort],options).result.status).toBe('DEFER')
  })
  it('候補予算超過を切り捨てず診断する', () => {
    const world = createExperimentalWorld()
    const scope = {branchId:'a',year:world.year,seekerId:'person-exp-02'}
    const full = createSupportingMarriageCandidateView(world,scope,[cohort],{...options,maxCandidates:4}).result
    const result = createSupportingMarriageCandidateView(world,scope,[cohort],{...options,maxCandidates:3}).result
    expect(full.candidates).toHaveLength(4)
    expect(result).toEqual({status:'DEFER',candidates:[],reasonCodes:['SUPPORTING_CANDIDATE_BUDGET_EXCEEDED'],
      budgetOmittedCandidateIds:full.candidates.map(c=>c.candidateId).sort()})
  })
  it('登録予算を消費せず複数探索者に同じ候補を提示する', () => {
    const world = createExperimentalWorld()
    const factory = createB001SupportingMarriageEvaluator({cohorts:[{...cohort,memberCount:1}],maxRecordsPerYear:1,
      maxAliveSupporting:1,perCohortSamples:1,maximumPreviewAge:50})
    if (!factory.ok) throw new Error('invalid fixture')
    const ctx: EvaluationContext = {year:world.year,phase:3,ruleId:'B-001',seed:73,branchId:'a',
      traceId:i=>`trace-${i}`,random:()=>0.5}
    const result = factory.evaluator(world,ctx)
    const offers = result.traceDrafts.filter(t=>t.reasonCodes.includes('SUPPORTING_CANDIDATE_ONLY'))
    expect(new Set(offers.map(t=>t.candidates[0]?.inputs.seekerPersonId)).size).toBeGreaterThan(1)
    expect(new Set(offers.map(t=>t.candidates[0]?.inputs.supportingCandidateId)).size).toBe(1)
    expect(new Set(offers.map(t=>t.candidates[0]?.candidateId)).size).toBe(offers.length)
    expect(result.commands).toEqual([])
  })
  it('B-001は婚姻前の候補に対して人物記録コマンドを発行しない', () => {
    const world = createExperimentalWorld()
    const factory = createB001SupportingMarriageEvaluator({cohorts:[cohort],maxRecordsPerYear:4,
      maxAliveSupporting:64,perCohortSamples:4,maximumPreviewAge:50})
    expect(factory.ok).toBe(true)
    if (!factory.ok) throw new Error('invalid fixture')
    const ctx: EvaluationContext = {year:world.year,phase:3,ruleId:'B-001',seed:73,branchId:'a',
      traceId:i=>`trace-${i}`,random:()=>0.5}
    const before = structuredClone(world)
    const result = factory.evaluator(world,ctx)
    expect(result.commands).toEqual([])
    expect(result.requests).toEqual([])
    const draft = result.traceDrafts.find(t=>t.reasonCodes.includes('SUPPORTING_CANDIDATE_ONLY'))
    expect(draft).toBeDefined()
    expect(draft?.candidates[0]?.inputs).toMatchObject({
      candidateBranchId:'a', candidateYear:world.year, candidateGroupId:cohort.groupId,
      candidateHouseId:cohort.affiliationHouseId, candidateSex:cohort.sex,
      candidateBirthYear:cohort.birthYear, candidateTier:cohort.tier,
      populationSource:cohort.source, sourceEvidenceId:cohort.sourceEvidenceId,
      kinshipStatus:'UNVERIFIED', provenance:'CALIBRATION_ONLY',
    })
    expect(world).toEqual(before)
  })
})
