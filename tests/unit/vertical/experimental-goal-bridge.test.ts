// 1250年のexperimental初期世界の法的根拠を、後年の厳格Goal試験へ渡す境界を検証。
// 新しい婚姻承認・相続承認・統治委任・勝利を固定の未来イベントとして捏造しない。
import { describe, expect, it } from 'vitest'
import { createExperimentalWorld, EXPERIMENTAL_NALVEN_GOAL, NALVEN_DYNASTY_ID, prepareExperimentalGoalContext } from '../../../src/scenario/experimental/index.ts'

describe('experimental初期法制証拠 → 1350年のGoal検証準備', () => {
  it('初期家系、授与・承認・行政・徴税を照合し、未承認の相続権限は補わない', () => {
    const world = createExperimentalWorld()
    const result = prepareExperimentalGoalContext(world)
    expect(result.ok).toBe(true)
    if (!result.ok) return
    expect(result.goal).toEqual({ dynastyId: NALVEN_DYNASTY_ID })
    expect(result.goal).toEqual(EXPERIMENTAL_NALVEN_GOAL)
    expect(result.book.approvalAuthorities).toEqual([]) // GAME-02の権限未確定
    expect(result.book.titleGrants.some(x => x.titleId === 'title-exp-central')).toBe(true)
    expect(world.legal.controlMandates).toEqual([]) // GAME-03の委任を自動補完しない
    expect(result.book.marriageCandidates.every(x => x.registration === 'NOT_REGISTERED')).toBe(true)
  })
  it('授与根拠が不正な初期世界を、成功するGoal入力として扱わない', () => {
    const world = createExperimentalWorld()
    const broken = {
      ...world,
      titles: world.titles.map(t => t.titleId === 'title-exp-central'
        ? { ...t, grantBasisId: 'missing-grant' } : t),
    }
    const result = prepareExperimentalGoalContext(broken)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues.map(x => x.code)).toContain('GRANT_BASIS_MISSING')
  })
  it('後年のWorldStateを初期授与記録だけで検証・補完しない', () => {
    const future = { ...createExperimentalWorld(), year: 1280 }
    const result = prepareExperimentalGoalContext(future)
    expect(result.ok).toBe(false)
    if (result.ok) return
    expect(result.issues.map(x => x.code)).toEqual(['NOT_INITIAL_WORLD'])
  })
})
