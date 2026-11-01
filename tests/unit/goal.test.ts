import { describe, expect, it } from 'vitest'
import type { ControlMandate, Person, Title, WorldState } from '../../src/simulation/contracts/index.ts'
import type { DeepWritable } from './foundation/helpers.ts'
import { evaluateGoal } from '../../src/simulation/goal.ts'
import type { GoalEvaluation, GoalFailureCode } from '../../src/simulation/goal.ts'

// 独立した最小フィクスチャ（experimental 初期世界に依存しない）。
const DYN = 'dyn-target'
const OPTS = { dynastyId: DYN } as const

type W = DeepWritable<WorldState>

function person(id: string, over: Partial<DeepWritable<Person>> = {}): DeepWritable<Person> {
  return {
    personId: id, name: id, sex: 'MALE', birthYear: 1300, alive: true, originGroupId: 'g1',
    houseId: 'h-target', legalDynasty: { status: 'DETERMINED', dynastyId: DYN }, ...over,
  }
}

function title(id: string, regionId: string, holderId: string, over: Partial<DeepWritable<Title>> = {}): DeepWritable<Title> {
  return {
    titleId: id, kind: 'TERRITORIAL', regionId, holder: { status: 'HELD', personId: holderId },
    hereditary: true, valid: true, grantBasisId: 'grant-1',
    recognition: { status: 'ACTIVE', authority: { kind: 'COUNTRY', id: 'c-a' }, sovereignCountryId: 'c-a', sourceDecisionId: 'dec-1' },
    ...over,
  }
}

function mandate(over: Partial<DeepWritable<ControlMandate>> = {}): DeepWritable<ControlMandate> {
  return {
    mandateId: 'm1', regionId: 'r1', controllerRef: { kind: 'COUNTRY', id: 'c-b' }, beneficiaryPersonId: 'p-hero',
    authorizingTitleId: 't1', sourceEventId: 'ev-1', effectiveFromYear: 1340, endExclusiveYear: 1360, ...over,
  }
}

/** 1350 年の基底世界: r1 は p-hero の所領、r2 は c-b。既定では p-hero が r1 を直接支配する成功世界。 */
function baseWorld(edit: (w: W) => void = () => undefined): WorldState {
  const w: W = {
    year: 1350,
    countries: [{ countryId: 'c-a', name: 'A' }, { countryId: 'c-b', name: 'B' }],
    regions: [
      { regionId: 'r1', name: 'R1', sovereignCountryId: 'c-a', deFactoControllerRef: { kind: 'PERSON', id: 'p-hero' }, adjacentRegionIds: ['r2'] },
      { regionId: 'r2', name: 'R2', sovereignCountryId: 'c-b', deFactoControllerRef: { kind: 'COUNTRY', id: 'c-b' }, adjacentRegionIds: ['r1'] },
    ],
    groups: [
      { groupId: 'g1', regionId: 'r1', name: 'G1', population: 1000, prosperity: 50, unrest: 10, support: { houseBps: { 'h-target': 10000 }, undecidedBps: 0 } },
      { groupId: 'g2', regionId: 'r2', name: 'G2', population: 1000, prosperity: 50, unrest: 10, support: { houseBps: { 'h-other': 10000 }, undecidedBps: 0 } },
    ],
    houses: [{ houseId: 'h-target', name: 'T' }, { houseId: 'h-other', name: 'O' }],
    persons: [
      person('p-hero'),
      person('p-other', { houseId: 'h-other', originGroupId: 'g2', legalDynasty: { status: 'DETERMINED', dynastyId: 'dyn-other' } }),
    ],
    titles: [title('t1', 'r1', 'p-hero')],
    legal: {
      dynasties: [{ dynastyId: DYN, name: 'T' }, { dynastyId: 'dyn-other', name: 'O' }],
      marriages: [], cases: [], controlMandates: [], taxMandates: [],
    },
    resources: [], demographics: { cohortSlots: [] }, deferred: [],
  } as unknown as W
  edit(w)
  return w as unknown as WorldState
}

function failuresOf(r: GoalEvaluation): readonly GoalFailureCode[] {
  if (r.status !== 'NOT_ACHIEVED') throw new Error(`unexpected ${r.status}`)
  return r.assessments.flatMap((a) => a.failures)
}

describe('evaluateGoal: 成功例', () => {
  it('独立王（直接支配 + CROWN 併有）', () => {
    const r = evaluateGoal(baseWorld((w) => { w.titles.push(title('t-crown', 'r1', 'p-hero', { kind: 'CROWN' })) }), OPTS)
    expect(r.status).toBe('ACHIEVED')
    if (r.status === 'ACHIEVED') expect(r.assessments.find((a) => a.titleId === 't1')?.basis).toEqual({ kind: 'DIRECT_CONTROL' })
  })

  it('外国封臣: 外国主権下の地域を ControlMandate で保持', () => {
    const r = evaluateGoal(baseWorld((w) => {
      w.regions[0]!.sovereignCountryId = 'c-b'
      w.regions[0]!.deFactoControllerRef = { kind: 'COUNTRY', id: 'c-b' }
      w.legal.controlMandates.push(mandate())
    }), OPTS)
    expect(r.status).toBe('ACHIEVED')
    if (r.status === 'ACHIEVED') expect(r.assessments[0]?.basis).toEqual({ kind: 'CONTROL_MANDATE', mandateId: 'm1' })
  })

  it('外国封臣: 宗主権のみの国でなく、本人が直接支配していても成立する', () => {
    const r = evaluateGoal(baseWorld((w) => {
      w.countries[0] = { countryId: 'c-a', name: 'A', suzerainCountryId: 'c-b' }
      w.regions[0]!.sovereignCountryId = 'c-b'
    }), OPTS)
    expect(r.status).toBe('ACHIEVED')
  })

  it('合法な傍系（血統は別王朝、法的王朝は対象・父子関係なし）', () => {
    const r = evaluateGoal(baseWorld((w) => {
      w.persons[0] = person('p-hero', { birthYear: 1320, bloodlineDynastyId: 'dyn-other', fatherId: 'p-other' })
    }), OPTS)
    expect(r.status).toBe('ACHIEVED')
  })

  it('他の称号が失敗でも、1 つでも成立すれば勝利', () => {
    const r = evaluateGoal(baseWorld((w) => {
      w.titles.push(title('t-bad', 'r2', 'p-other'))
    }), OPTS)
    expect(r.status).toBe('ACHIEVED')
  })

  it('委任の有効期間は [from, endExclusive) で、1350 ちょうどの開始は有効', () => {
    const w = (from: number, end: number) => baseWorld((x) => {
      x.regions[0]!.deFactoControllerRef = { kind: 'COUNTRY', id: 'c-b' }
      x.legal.controlMandates.push(mandate({ effectiveFromYear: from, endExclusiveYear: end }))
    })
    expect(evaluateGoal(w(1350, 1351), OPTS).status).toBe('ACHIEVED')
    expect(evaluateGoal(w(1300, 1350), OPTS).status).toBe('NOT_ACHIEVED') // 1350 は終了済み
    expect(evaluateGoal(w(1351, 1360), OPTS).status).toBe('NOT_ACHIEVED') // 未開始
  })
})

describe('evaluateGoal: 失敗例（ゲーム内の敗北）', () => {
  const cases: [string, (w: W) => void, GoalFailureCode][] = [
    ['血縁のみ（血統は対象・法的王朝は他）', (w) => { w.persons[0] = person('p-hero', { bloodlineDynastyId: DYN, legalDynasty: { status: 'DETERMINED', dynastyId: 'dyn-other' } }) }, 'DYNASTY_MISMATCH'],
    ['CROWN のみ', (w) => { w.titles[0] = title('t1', 'r1', 'p-hero', { kind: 'CROWN' }) }, 'NOT_TERRITORIAL'],
    ['名目称号（支配なし）', (w) => { w.regions[0]!.deFactoControllerRef = { kind: 'COUNTRY', id: 'c-b' } }, 'NO_CONTROL'],
    ['死者', (w) => { w.persons[0] = person('p-hero', { alive: false, deathYear: 1349 }) }, 'HOLDER_DEAD'],
    ['法的王朝 UNDETERMINED', (w) => { w.persons[0] = person('p-hero', { legalDynasty: { status: 'UNDETERMINED', reasonCodes: ['NO_EVIDENCE'] } }) }, 'DYNASTY_UNDETERMINED'],
    ['他王朝（家門名が同じでも）', (w) => { w.persons[0] = person('p-hero', { legalDynasty: { status: 'DETERMINED', dynastyId: 'dyn-other' } }) }, 'DYNASTY_MISMATCH'],
    ['非世襲', (w) => { w.titles[0] = title('t1', 'r1', 'p-hero', { hereditary: false }) }, 'TITLE_NOT_HEREDITARY'],
    ['無効 Title', (w) => { w.titles[0] = title('t1', 'r1', 'p-hero', { valid: false }) }, 'TITLE_INVALID'],
    ['承認 PENDING', (w) => { w.titles[0] = title('t1', 'r1', 'p-hero', { recognition: { status: 'PENDING' } }) }, 'TITLE_NOT_RECOGNIZED'],
    ['承認 REVOKED', (w) => { w.titles[0] = title('t1', 'r1', 'p-hero', { recognition: { status: 'REVOKED' } }) }, 'TITLE_NOT_RECOGNIZED'],
    ['保持者未確定', (w) => { w.titles[0] = title('t1', 'r1', 'p-hero', { holder: { status: 'UNDETERMINED' } }) }, 'HOLDER_UNDETERMINED'],
    ['税収・主権のみ（他者が支配）', (w) => { w.regions[0]!.deFactoControllerRef = { kind: 'PERSON', id: 'p-other' }; w.legal.taxMandates.push({ mandateId: 'tx', regionId: 'r1', collectorCountryId: 'c-a', effectiveFromYear: 1340, endExclusiveYear: 1360, sourceTreatyOrLawId: 'law-1' }) }, 'NO_CONTROL'],
    ['国が支配しても委任なし（家門・国の一致のみ）', (w) => { w.regions[0]!.deFactoControllerRef = { kind: 'COUNTRY', id: 'c-a' } }, 'NO_CONTROL'],
  ]
  it.each(cases)('%s', (_name, edit, code) => {
    const r = evaluateGoal(baseWorld(edit), OPTS)
    expect(r.status).toBe('NOT_ACHIEVED')
    expect(failuresOf(r)).toContain(code)
  })

  const mandateCases: [string, (w: W) => void][] = [
    ['委任先（受益者）不一致', (w) => { w.legal.controlMandates[0] = mandate({ beneficiaryPersonId: 'p-other' }) }],
    ['controllerRef が実際の支配者と不一致', (w) => { w.legal.controlMandates[0] = mandate({ controllerRef: { kind: 'COUNTRY', id: 'c-a' } }) }],
    ['別 Title を根拠とする委任', (w) => { w.titles.push(title('t2', 'r1', 'p-other', { kind: 'CROWN' })); w.legal.controlMandates[0] = mandate({ authorizingTitleId: 't2' }) }],
    ['失効済み委任', (w) => { w.legal.controlMandates[0] = mandate({ effectiveFromYear: 1300, endExclusiveYear: 1349 }) }],
  ]
  it.each(mandateCases)('無効委任: %s', (_name, edit) => {
    const r = evaluateGoal(baseWorld((w) => {
      w.regions[0]!.deFactoControllerRef = { kind: 'COUNTRY', id: 'c-b' }
      w.legal.controlMandates.push(mandate())
      edit(w)
    }), OPTS)
    expect(r.status).toBe('NOT_ACHIEVED')
    expect(failuresOf(r)).toContain('NO_CONTROL')
  })

  it('受益者が死者の委任に別人への自動引継ぎをしない', () => {
    const r = evaluateGoal(baseWorld((w) => {
      w.persons[0] = person('p-hero', { alive: false, deathYear: 1349 })
      w.regions[0]!.deFactoControllerRef = { kind: 'COUNTRY', id: 'c-b' }
      w.legal.controlMandates.push(mandate())
    }), OPTS)
    expect(r.status).toBe('NOT_ACHIEVED')
    expect(failuresOf(r)).toContain('HOLDER_DEAD')
  })

  it('血縁者のみで Title が無い世界は NOT_ACHIEVED', () => {
    const r = evaluateGoal(baseWorld((w) => { w.titles.length = 0 }), OPTS)
    expect(r.status).toBe('NOT_ACHIEVED')
  })

  it('Title が無い世界は NOT_ACHIEVED（入力破損ではない）', () => {
    const r = evaluateGoal(baseWorld((w) => { w.titles.length = 0 }), OPTS)
    expect(r).toEqual({ status: 'NOT_ACHIEVED', assessments: [] })
  })

  it('別の dynastyId を指定すると同じ世界でも敗北（ID を固定していない）', () => {
    expect(evaluateGoal(baseWorld(), { dynastyId: 'dyn-other' }).status).toBe('NOT_ACHIEVED')
  })
})

describe('evaluateGoal: 入力破損・年・不変性', () => {
  it('入力破損は INVALID_INPUT で、通常の敗北と区別される', () => {
    const bad = baseWorld((w) => { w.titles[0] = title('t1', 'r-missing', 'p-hero') })
    const r = evaluateGoal(bad, OPTS)
    expect(r.status).toBe('INVALID_INPUT')
    if (r.status === 'INVALID_INPUT') expect(r.diagnostics.some((d) => d.code === 'DANGLING_REF')).toBe(true)
  })

  it.each([null, undefined, 42, 'x', [], {}])('非 WorldState (%j) は INVALID_INPUT', (v) => {
    expect(evaluateGoal(v, OPTS).status).toBe('INVALID_INPUT')
  })

  it('ACTIVE 承認で authority 欠落は破損として INVALID_INPUT', () => {
    const r = evaluateGoal(baseWorld((w) => { w.titles[0] = title('t1', 'r1', 'p-hero', { recognition: { status: 'ACTIVE' } }) }), OPTS)
    expect(r.status).toBe('INVALID_INPUT')
  })

  it.each([1250, 1300, 1349])('%d 年は勝敗を返さず NOT_EVALUABLE（成功条件を満たす世界でも）', (year) => {
    const r = evaluateGoal(baseWorld((w) => {
      w.year = year
      w.persons.forEach((p, i) => { w.persons[i] = { ...p, birthYear: 1200 } })
    }), OPTS)
    expect(r).toEqual({ status: 'NOT_EVALUABLE', year })
  })

  it('範囲外の年（1351）は入力破損であり、敗北でも評価対象外でもない', () => {
    expect(evaluateGoal(baseWorld((w) => { w.year = 1351 }), OPTS).status).toBe('INVALID_INPUT')
  })

  it('委任の地域が根拠 Title の地域と不一致な入力は破損として INVALID_INPUT', () => {
    const r = evaluateGoal(baseWorld((w) => {
      w.legal.controlMandates.push(mandate({ regionId: 'r2', controllerRef: { kind: 'COUNTRY', id: 'c-b' } }))
    }), OPTS)
    expect(r.status).toBe('INVALID_INPUT')
  })

  it('入力を変更しない（深く凍結した入力でも動作）', () => {
    const world = baseWorld((w) => {
      w.regions[0]!.deFactoControllerRef = { kind: 'COUNTRY', id: 'c-b' }
      w.legal.controlMandates.push(mandate())
    })
    const freeze = (o: unknown): void => { if (typeof o === 'object' && o !== null) { Object.values(o).forEach(freeze); Object.freeze(o) } }
    freeze(world)
    const snapshot = JSON.stringify(world)
    expect(evaluateGoal(world, OPTS).status).toBe('ACHIEVED')
    expect(JSON.stringify(world)).toBe(snapshot)
  })

  it('同一入力で同一結果（決定的）', () => {
    const w = baseWorld()
    expect(evaluateGoal(w, OPTS)).toEqual(evaluateGoal(w, OPTS))
  })
})
