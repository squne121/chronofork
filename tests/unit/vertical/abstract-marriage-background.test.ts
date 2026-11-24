import { describe, expect, it } from 'vitest'
import { createMultiHouseWorld } from '../../../src/scenario/experimental/multi-house-playtest.ts'
import {
  abstractBirthCohort, abstractCandidateLife, abstractCandidateTrust, abstractKinshipReview,
} from '../../../src/simulation/population/abstract-marriage-background.ts'
import { validateSupportingMarriageCohorts } from '../../../src/simulation/population/supporting-marriage.ts'

const config = {
  adultSurvivalPermille: 1000, annualAvailabilityPermille: 1000,
  minimumAdultRemainingYears: 20, maximumAdultRemainingYears: 40,
  prohibitedPermille: 0, investigationCompletionPermille: 1000,
  initialTrust: 24, initialTrustSpread: 16,
}
const seed = 20260101
const cohort = abstractBirthCohort('group-east-elite', 'house-cardon', 1250, 'FEMALE', 1)

function kinshipFixture() {
  const w = createMultiHouseWorld()
  const a = w.persons.find(p => p.sex === 'MALE' && w.houses.find(h => h.houseId === p.houseId)?.countryId === 'country-eldia')!
  const b = { ...a, personId: 'test:abstract-spouse', sex: 'FEMALE' as const, fatherId: undefined, motherId: undefined,
    interactionRole: 'SUPPORTING' as const }
  const pair = [a.personId, b.personId].sort() as [string, string]
  return { world: {...w, year: 1268, legal: {...w.legal, marriages: []}}, a, b, pair }
}

describe('抽象婚姻候補の独立背景', () => {
  it('C004出生枠がなければ、別の成人生存入力を与えても人口出典にはならない', () => {
    const life = abstractCandidateLife(seed, cohort, 0, 1268, config)
    const backed = {...cohort, survivorAttestationId: life.survivalEvidenceId}
    const world = {...createMultiHouseWorld(), year: 1268}
    expect(life.available).toBe(true)
    expect(validateSupportingMarriageCohorts(world, [backed])).toContain('C004_BIRTH_BACKING_INSUFFICIENT:0')
  })

  it('利用不能・成人未到達・死亡を区別し、年を逆順に照会しても同じ生涯を返す', () => {
    const adult = abstractCandidateLife(seed, cohort, 0, 1268, config)
    const dead = abstractCandidateLife(seed, cohort, 0, adult.unregisteredUntilYear, config)
    expect(dead).toMatchObject({ adultSurvivalBacked: false, available: false, survivalEvidenceId: adult.survivalEvidenceId })
    expect(abstractCandidateLife(seed, cohort, 0, adult.unregisteredUntilYear + 30, config)).toEqual(dead)
    expect(abstractCandidateLife(seed, cohort, 0, 1268, {...config, annualAvailabilityPermille: 0}))
      .toEqual({...adult, available: false})
    expect(abstractCandidateLife(seed, cohort, 0, 1300, {...config, adultSurvivalPermille: 0}).unregisteredUntilYear).toBeLessThan(1268)
    expect(abstractCandidateLife(seed, cohort, 0, 1268, config)).toEqual(adult)
  })

  it('実記録の禁親・矛盾・管轄を優先し、抽象調査の未確認を非近親にしない', () => {
    const {world, a, b, pair} = kinshipFixture()
    const clear = abstractKinshipReview(world, seed, pair, [b], config)
    expect(clear).toMatchObject({status: 'CLEARED', record: {countryId: 'country-eldia', checkedYear: 1268, validUntilYear: 1269}})
    expect(abstractKinshipReview(structuredClone(world), seed, pair, [b], config)).toEqual(clear)
    expect(abstractKinshipReview(world, seed, pair, [{...b, fatherId: a.personId}], config))
      .toEqual({status: 'PROHIBITED', reasonCode: 'DIRECT_ANCESTOR_KINSHIP'})
    expect(abstractKinshipReview(world, seed, pair, [{...b, fatherId: 'missing'}], config))
      .toEqual({status: 'UNVERIFIED', reasonCode: 'KINSHIP_EVIDENCE_BROKEN'})
    expect(abstractKinshipReview(world, seed, pair, [{...b, houseId: 'missing'}], config))
      .toEqual({status: 'UNVERIFIED', reasonCode: 'SAME_COUNTRY_JURISDICTION_UNVERIFIED'})
    expect(abstractKinshipReview(world, seed, pair, [b], {...config, investigationCompletionPermille: 0}))
      .toMatchObject({status: 'UNVERIFIED', reasonCode: 'ABSTRACT_KINSHIP_INVESTIGATION_INCOMPLETE', record: {abstractFinding: 'UNVERIFIED'}})
    expect(abstractKinshipReview(world, seed, pair, [b], {...config, prohibitedPermille: 1000}))
      .toMatchObject({status: 'PROHIBITED', reasonCode: 'ABSTRACT_KINSHIP_PROHIBITED', record: {abstractFinding: 'PROHIBITED'}})
  })

  it('初期信頼はペア順序と別の背景入力の変更に依存しない', () => {
    const {pair} = kinshipFixture()
    const trust = abstractCandidateTrust(seed, pair, config)
    expect(trust.value).toBeGreaterThanOrEqual(24)
    expect(trust.value).toBeLessThanOrEqual(40)
    expect(abstractCandidateTrust(seed, [pair[1], pair[0]], {...config, adultSurvivalPermille: 0, prohibitedPermille: 1000})).toEqual(trust)
  })
})
