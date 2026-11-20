// Issue #114 担当B: 複数家門試遊構成のために追加した、既定で従来動作のopt-in技術フック3件の専用テスト。
//  1) supporting-marriage: candidateFilter（個別化前の絞り込みのみ。審査緩和・人口加算なし）
//  2) B-001: kinshipClearances / maxOpenCandidatesPerSeeker（証拠のある候補だけ提示し候補枯渇を避ける）
//  3) B-009: initialTrustSpread（同点のため相互最優先が永久に成立しない状況を避ける決定的な個体差）
// すべてCALIBRATION_ONLY。婚姻・出生の成否や相手は決めない。
import { describe, expect, it } from 'vitest'
import { createExperimentalWorld } from '../../../src/scenario/experimental/index.ts'
import { runYear } from '../../../src/simulation/engine/index.ts'
import {
  createB001SupportingMarriageEvaluator, createB009WorldStateEvaluator,
  EXPERIMENTAL_B009_CALIBRATION, validateB009Calibration,
} from '../../../src/simulation/rules/b/index.ts'
import {
  proposeSupportingMarriageCandidates, supportingCandidateId,
} from '../../../src/simulation/population/supporting-marriage.ts'
import type { SupportingMarriageCohort } from '../../../src/simulation/population/supporting-marriage.ts'
import type { SupportingKinshipClearance } from '../../../src/simulation/legal/supporting-kinship-clearance.ts'

const world = createExperimentalWorld()
const SEED = 4242
const cohort: SupportingMarriageCohort = {
  cohortId: 'hooks:east-female-1230', groupId: 'group-east-elite', affiliationHouseId: 'house-cardon',
  familyPoolId: 'hooks:family-pool', tier: 'REGIONAL_LOWER_NOBILITY', sex: 'FEMALE', birthYear: 1230,
  memberCount: 4, source: 'INITIAL_POPULATION', sourceEvidenceId: 'hooks:census', provenance: 'CALIBRATION_ONLY',
}
const supplyOptions = { seed: SEED, maxCandidates: 4, perCohortSamples: 4, maximumPreviewAge: 60 } as const
const id = (n: number) => supportingCandidateId(cohort.cohortId, n)

describe('supporting-marriage candidateFilter', () => {
  it('未指定は従来どおり。指定すると条件を満たす候補だけを返し、全て除外ならDEFER', () => {
    const all = proposeSupportingMarriageCandidates(world, 'person-exp-02', [cohort], supplyOptions)
    expect(all.candidates.map(c => c.candidateId).sort()).toEqual([0, 1, 2, 3].map(id).sort())
    const only = proposeSupportingMarriageCandidates(world, 'person-exp-02', [cohort], {
      ...supplyOptions, candidateFilter: c => c.candidateId === id(2) })
    expect(only.candidates.map(c => c.candidateId)).toEqual([id(2)])
    const none = proposeSupportingMarriageCandidates(world, 'person-exp-02', [cohort], {
      ...supplyOptions, candidateFilter: () => false })
    expect(none).toMatchObject({ status: 'DEFER', candidates: [], reasonCodes: ['NO_COHORT_CANDIDATE_AVAILABLE'] })
  })
  it('perCohortSamples=1でも除外された構成員は枠を消費せず、証拠のある構成員まで探索する', () => {
    for (const target of [0, 1, 2, 3]) {
      const r = proposeSupportingMarriageCandidates(world, 'person-exp-02', [cohort], {
        ...supplyOptions, perCohortSamples: 1, maxCandidates: 1, candidateFilter: c => c.candidateId === id(target) })
      expect(r.candidates.map(c => c.candidateId)).toEqual([id(target)])
    }
  })
})

describe('B-001 kinshipClearances（証拠付き候補だけを提示）', () => {
  const clearance = (ordinal: number, personId = 'person-exp-02'): SupportingKinshipClearance => ({
    clearanceId: 'hooks:clearance:' + personId + ':' + ordinal,
    personIds: [personId, id(ordinal)].sort() as [string, string], countryId: 'country-eldia',
    checkedYear: 1250, validUntilYear: 1260, sourceEvidenceId: 'hooks:lineage:' + ordinal, provenance: 'CALIBRATION_ONLY',
  })
  const base = { cohorts: [cohort], maxRecordsPerYear: 4, maxAliveSupporting: 8, perCohortSamples: 4, maximumPreviewAge: 60 }
  const run = (extra: object, input = world) => {
    const e = createB001SupportingMarriageEvaluator({ ...base, ...extra })
    if (!e.ok) throw new Error(e.issues.join(','))
    const result = runYear(input, { seed: SEED, branchId: 'hooks', evaluators: { 'B-001': e.evaluator } })
    if (result.status !== 'COMPLETED') throw new Error(JSON.stringify(result.halt))
    expect(result.world.persons).toEqual(input.persons)
    expect(result.events).toEqual([])
    return result.traces.filter(t => t.ruleId === 'B-001')
  }
  const offered = (traces: ReturnType<typeof run>) => traces.filter(t => t.status === 'ACCEPT')
    .map(t => t.candidates[0]?.inputs['supportingCandidateId'])

  it('未指定では禁親の承認をせずに候補だけを提示する', () => {
    expect(new Set(offered(run({})))).toEqual(new Set([0, 1, 2, 3].map(id)))
  })
  it('明示指定時は当年有効なペア証拠のある候補だけを提示し、証拠がなければDEFER', () => {
    expect(offered(run({ kinshipClearances: [clearance(1)] }))).toEqual([id(1)])
    const without = run({ kinshipClearances: [] })
    expect(offered(without)).toHaveLength(0)
    expect(without.some(t => t.status === 'DEFER' && t.reasonCodes.includes('NO_COHORT_CANDIDATE_AVAILABLE'))).toBe(true)
    expect(offered(run({ kinshipClearances: [{ ...clearance(1), checkedYear: 1240, validUntilYear: 1250 }] }))).toHaveLength(0)
  })
  it('探索者あたりの上限に達していれば保留し、空きと標本予算があれば未使用候補を提示する', () => {
    const existing = [0, 1].map(n => ({
      personId: id(n), name: 'hooks supporting ' + n, interactionRole: 'SUPPORTING' as const, sex: 'FEMALE' as const,
      birthYear: 1230, alive: true, originGroupId: cohort.groupId, houseId: cohort.affiliationHouseId,
      legalDynasty: { status: 'UNDETERMINED' as const, reasonCodes: ['POPULATION_COHORT_NOT_A_DYNASTY_PROOF'] },
    }))
    const preloaded = { ...world, persons: [...world.persons, ...existing] }
    const kinshipClearances = [0, 1, 2, 3].map(n => clearance(n))
    const full = run({ kinshipClearances, maxOpenCandidatesPerSeeker: 2 }, preloaded)
    expect(offered(full)).toEqual([])
    expect(full.some(t => t.status === 'DEFER' && t.reasonCodes.includes('OPEN_EVIDENCE_BACKED_CANDIDATES_AT_LIMIT'))).toBe(true)
    const overflow = run({ kinshipClearances, maxOpenCandidatesPerSeeker: 3 }, preloaded)
    expect(offered(overflow)).toEqual([])
    expect(overflow.some(t => t.status === 'DEFER' && t.reasonCodes.includes('SUPPORTING_CANDIDATE_BUDGET_EXCEEDED'))).toBe(true)
    const capped = run({ kinshipClearances, maxOpenCandidatesPerSeeker: 4, perCohortSamples: 1 }, preloaded)
    expect(offered(capped)).toEqual([])
    expect(capped.some(t => t.status === 'DEFER' && t.reasonCodes.includes('SUPPORTING_CANDIDATE_BUDGET_EXCEEDED'))).toBe(true)
    const open = offered(run({ kinshipClearances, maxOpenCandidatesPerSeeker: 4, perCohortSamples: 2 }, preloaded))
    expect(open.sort()).toEqual([id(2), id(3)].sort())
  })
  it('探索対象の選択は証拠とは独立し、選択のみで審査を承認しない', () => {
    const picked = run({ candidatePairs: [['person-exp-02', id(1)]] })
    expect(offered(picked)).toEqual([id(1)])
    expect(picked.find(t => t.status === 'ACCEPT')?.candidates[0]?.inputs['kinshipStatus']).toBe('UNVERIFIED')
    expect(offered(run({ candidatePairs: [] }))).toHaveLength(0)
    expect(offered(run({ candidatePairs: [['person-exp-02', id(1)]], kinshipClearances: [] }))).toHaveLength(0)
    expect(createB001SupportingMarriageEvaluator({ ...base, candidatePairs: [['person-exp-02']] } as never).ok).toBe(false)
  })
  it('不正な上限値は評価器を作らない', () => {
    for (const bad of [0, 9, 1.5]) {
      expect(createB001SupportingMarriageEvaluator({ ...base, maxOpenCandidatesPerSeeker: bad } as never).ok).toBe(false)
    }
  })
})

describe('B-009 initialTrustSpread', () => {
  const trustOf = (calibration: object) => {
    const e = createB009WorldStateEvaluator([], { ...EXPERIMENTAL_B009_CALIBRATION, initialTrust: 20, ...calibration } as never)
    const r = runYear(world, { seed: SEED, branchId: 'b009', evaluators: { 'B-009': e } }) as { world: typeof world }
    return new Map((r.world.pairTrust ?? []).map(x => [JSON.stringify(x.personIds), x.value]))
  }
  it('既定(未指定/0)は従来動作で全新規ペアが同じ初期値', () => {
    const a = trustOf({}), b = trustOf({ initialTrustSpread: 0 })
    expect([...a]).toEqual([...b])
    expect(new Set(a.values()).size).toBe(1)
  })
  it('指定すると新規ペアの初期値は 初期値〜初期値+spread で決定的にばらつく(同入力で再現、seed非依存)', () => {
    const a = trustOf({ initialTrustSpread: 16 }), b = trustOf({ initialTrustSpread: 16 })
    expect([...a]).toEqual([...b])
    const plain = trustOf({})
    for (const [k, v] of a) {
      expect(v - plain.get(k)!).toBeGreaterThanOrEqual(0)
      expect(v - plain.get(k)!).toBeLessThanOrEqual(16)
    }
    expect(new Set(a.values()).size).toBeGreaterThan(3)
  })
  it('明示基礎値のあるペアにはspreadを加えない', () => {
    const pair = ['person-exp-01', 'person-exp-02'] as [string, string]
    const e = createB009WorldStateEvaluator([{ personIds: pair, value: 50 }], { ...EXPERIMENTAL_B009_CALIBRATION, initialTrust: 20, initialTrustSpread: 16 } as never)
    const r = runYear(world, { seed: SEED, branchId: 'b009', evaluators: { 'B-009': e } }) as { world: typeof world }
    expect(r.world.pairTrust?.find(x => JSON.stringify(x.personIds) === JSON.stringify(pair))?.value).toBe(51)
  })
  it('範囲外のspreadは検証で拒否する', () => {
    for (const bad of [-1, 41, 1.5]) {
      expect(validateB009Calibration({ ...EXPERIMENTAL_B009_CALIBRATION, initialTrustSpread: bad }).ok).toBe(false)
    }
    expect(validateB009Calibration({ ...EXPERIMENTAL_B009_CALIBRATION, initialTrust: 95, initialTrustSpread: 10 }).ok).toBe(false)
    expect(validateB009Calibration({ ...EXPERIMENTAL_B009_CALIBRATION, initialTrustSpread: 16 }).ok).toBe(true)
  })
})
