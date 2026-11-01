import { describe, expect, it } from 'vitest'
import type { DomainCommand, WorldState } from '../../../../src/simulation/contracts/index.ts'
import { validateWorldState } from '../../../../src/simulation/validation/index.ts'
import { FORCE, FORCE_GROUP, baby, birth, chain, cohort, cohortOutcome, ledger, natural, newWorld, outcome, rejectionCodes, run, source } from './helpers.ts'

const pop = (w: WorldState, id: string) => w.groups.find((g) => g.groupId === id)?.population
const slot = (w: WorldState, id: string) => w.demographics.cohortSlots.find((s) => s.groupId === id)

describe('出生枠と出生（契約テスト観点 5）', () => {
  it('人口1000・出生20・自然死16 → 1004、記名児2人でも 1004', () => {
    const base = newWorld()
    const w0: WorldState = { ...base, groups: base.groups.map((g) => (g.groupId === 'group-central-elite' ? { ...g, population: 1000 } : g)) }
    const c = chain([
      cohortOutcome('group-central-elite', 20, 16),
      outcome('B-002', 3, [birth(baby('person-new-1')), birth(baby('person-new-2'))]),
    ], w0)
    expect(pop(c.world, 'group-central-elite')).toBe(1004)
    expect(slot(c.world, 'group-central-elite')).toMatchObject({ claimedBirths: 2 })
    expect(validateWorldState(c.world).ok).toBe(true)
  })

  it('枠なし・枠超過の出生は NO_COHORT_SLOT（人物も作られない）', () => {
    const w = newWorld()
    expect(rejectionCodes(run(w, outcome('B-002', 3, [birth(baby('person-new-1'))])))).toEqual(['NO_COHORT_SLOT'])
    const c = chain([cohortOutcome('group-central-elite', 1, 0), outcome('B-002', 3, [birth(baby('person-new-1'))])])
    const over = run(c.world, outcome('B-002', 3, [birth(baby('person-new-2'))]), c.tx)
    expect(rejectionCodes(over)).toEqual(['NO_COHORT_SLOT'])
    expect(over.world.persons.some((p) => p.personId === 'person-new-2')).toBe(false)
  })

  it('B は法的王朝所属を決められない（DETERMINED の出生は拒否 / GAME-01）', () => {
    const c = chain([cohortOutcome('group-central-elite', 1, 0)])
    const p = baby('person-new-1', 'group-central-elite', { legalDynasty: { status: 'DETERMINED', dynastyId: 'dynasty-nalven' } })
    expect(rejectionCodes(run(c.world, outcome('B-002', 3, [birth(p)]), c.tx))).toEqual(['LEGAL_DYNASTY_NOT_OWNED_BY_B'])
  })

  it.each([
    ['既存 ID', () => baby('person-exp-01'), 'ID_EXISTS'],
    ['親が不在', () => baby('person-new-1', 'group-central-elite', { fatherId: 'person-none' }), 'NOT_FOUND'],
    ['親なし', () => baby('person-new-1', 'group-central-elite', { fatherId: undefined, motherId: undefined }), 'INVALID_COMMAND'],
    ['出生年が当年でない', () => baby('person-new-1', 'group-central-elite', { birthYear: 1249 }), 'INVALID_COMMAND'],
    ['死亡状態で登録', () => baby('person-new-1', 'group-central-elite', { alive: false, deathYear: 1250 }), 'INVALID_COMMAND'],
  ] as const)('不正な出生: %s', (_n, make, code) => {
    const c = chain([cohortOutcome('group-central-elite', 1, 0)])
    expect(rejectionCodes(run(c.world, outcome('B-002', 3, [birth(make())]), c.tx))).toEqual([code])
  })

  it('同一枠の再確定は拒否', () => {
    const c = chain([cohortOutcome('group-west-commons', 1, 0)])
    expect(rejectionCodes(run(c.world, outcome('RULE-C-004', 1, [cohort('group-west-commons', 5, 0, 'cohort-again')]), c.tx))).toEqual(['COHORT_ALREADY_SET'])
  })
})

describe('自然死・戦死の共通死亡 reducer', () => {
  it('自然死は枠の請求済み数だけ増え、人口は再減少しない', () => {
    const c = chain([cohortOutcome('group-central-elite', 0, 2), outcome('B-003', 3, [natural('person-exp-01')])])
    const p = c.world.persons.find((x) => x.personId === 'person-exp-01')
    expect(p).toMatchObject({ alive: false, deathYear: 1250 })
    expect(pop(c.world, 'group-central-elite')).toBe(1998)
    expect(slot(c.world, 'group-central-elite')).toMatchObject({ claimedDeaths: 1 })
  })

  it('死亡済みへの死亡要求は ALREADY_DEAD、死者を対象にした婚姻は拒否', () => {
    const c = chain([cohortOutcome('group-central-elite', 0, 2), outcome('B-003', 3, [natural('person-exp-01')])])
    expect(rejectionCodes(run(c.world, outcome('B-003', 3, [natural('person-exp-01', 'again')]), c.tx))).toEqual(['ALREADY_DEAD'])
    const m: DomainCommand = {
      type: 'MARRIAGE_REGISTER', commandId: 'm', source: source('A-LEG-01', 3, 'm'),
      marriage: { marriageId: 'mar-1', personIds: ['person-exp-01', 'person-exp-03'], registeredYear: 1250, status: 'ACTIVE' },
    }
    expect(rejectionCodes(run(c.world, outcome('A-LEG-01', 3, [m]), c.tx))).toEqual(['PERSON_DEAD'])
  })

  it('自然死枠なしの死亡は NO_COHORT_SLOT', () => {
    expect(rejectionCodes(run(newWorld(), outcome('B-003', 3, [natural('person-exp-01')])))).toEqual(['NO_COHORT_SLOT'])
  })

  it('戦死: 台帳 CASUALTY → 人口通知 → 記名者死亡 が同一バッチで完結（人口は 3 人減）', () => {
    const named = baby('person-new-1', FORCE_GROUP, { fatherId: 'person-exp-04', motherId: undefined, houseId: 'house-vargas' })
    const c = chain([
      cohortOutcome(FORCE_GROUP, 1, 0),
      outcome('B-002', 3, [birth(named)]),
      outcome('D-REB-001', 5, [ledger(FORCE, 'COMMIT', 50, 'k')]),
    ])
    const before = pop(c.world, FORCE_GROUP) ?? 0
    const sr = (n: string) => ({ requestId: `r-${n}`, year: 1250, phase: 5 as const, sourceRuleId: 'D-MIL-002' as const, sourceTraceId: 't' })
    const war: DomainCommand[] = [
      { ...ledger(FORCE, 'CASUALTY', 3, 'w-led', { casualtyId: 'cas-w', batchId: 'w', ruleId: 'D-MIL-002' }) },
      { type: 'POPULATION_CASUALTY', commandId: 'w-pop', batchId: 'w', source: sr('p'), casualtyId: 'cas-w', groupId: FORCE_GROUP, count: 3, namedPersonIds: ['person-new-1'] },
      { type: 'PERSON_DEATH', commandId: 'w-dead', batchId: 'w', source: sr('d'), personId: 'person-new-1', deathYear: 1250, cause: 'BATTLE', casualtyId: 'cas-w' },
    ]
    const r = run(c.world, outcome('D-MIL-002', 5, war), c.tx)
    expect(r.status).toBe('APPLIED')
    expect(pop(r.world, FORCE_GROUP)).toBe(before - 3)
    expect(r.world.persons.find((p) => p.personId === 'person-new-1')?.alive).toBe(false)
    expect(validateWorldState(r.world).ok).toBe(true)

    // 記名者の死亡が欠けるバッチは全体を拒否（部分適用しない）
    const incomplete = run(c.world, outcome('D-MIL-002', 5, war.slice(0, 2)), c.tx)
    expect(rejectionCodes(incomplete)).toEqual(['CASUALTY_INCOMPLETE'])
    expect(incomplete.world).toBe(c.world)
  })

  it('記名戦死者数が集団戦死数を超える／死亡済みを記名する戦死通知は拒否', () => {
    const c = chain([cohortOutcome('group-central-elite', 0, 2), outcome('B-003', 3, [natural('person-exp-01')]), outcome('D-REB-001', 5, [ledger(FORCE, 'COMMIT', 50, 'k')])])
    const sr = { requestId: 'r', year: 1250, phase: 5 as const, sourceRuleId: 'D-MIL-002' as const, sourceTraceId: 't' }
    const mk = (named: string[], count: number): DomainCommand[] => [
      { ...ledger(FORCE, 'CASUALTY', count, 'led', { casualtyId: 'cas-x', batchId: 'x', ruleId: 'D-MIL-002' }) },
      { type: 'POPULATION_CASUALTY', commandId: 'pop', batchId: 'x', source: sr, casualtyId: 'cas-x', groupId: FORCE_GROUP, count, namedPersonIds: named },
    ]
    expect(rejectionCodes(run(c.world, outcome('D-MIL-002', 5, mk(['person-exp-04', 'person-exp-05'], 1)), c.tx))).toEqual(['CASUALTY_NAMED_EXCEEDS_COUNT'])
    expect(rejectionCodes(run(c.world, outcome('D-MIL-002', 5, mk(['person-exp-01'], 1)), c.tx))).toEqual(['ALREADY_DEAD'])
  })

  it('台帳の裏付けが無い人口通知／戦死は拒否（人口を直接減らせない）', () => {
    const sr = { requestId: 'r', year: 1250, phase: 5 as const, sourceRuleId: 'D-MIL-002' as const, sourceTraceId: 't' }
    const pc: DomainCommand = { type: 'POPULATION_CASUALTY', commandId: 'pop', source: sr, casualtyId: 'none', groupId: FORCE_GROUP, count: 3, namedPersonIds: [] }
    expect(rejectionCodes(run(newWorld(), outcome('D-MIL-002', 5, [pc])))).toEqual(['CASUALTY_NOT_BACKED'])
    const pd: DomainCommand = { type: 'PERSON_DEATH', commandId: 'pd', source: sr, personId: 'person-exp-01', deathYear: 1250, cause: 'BATTLE', casualtyId: 'none' }
    expect(rejectionCodes(run(newWorld(), outcome('D-MIL-002', 5, [pd])))).toEqual(['CASUALTY_NOT_BACKED'])
  })
})

describe('支持・実効支配', () => {
  const support = (groupId: string, causeEventIds: string[]): DomainCommand => ({
    type: 'SUPPORT_SET', commandId: 's', source: source('RULE-C-008', 2, 's'), groupId, causeEventIds,
    support: { houseBps: { 'house-nalven': 5000, 'house-vargas': 1000 }, undecidedBps: 4000 },
  })
  it('原因 ID が無い支持更新は拒否、あれば適用', () => {
    expect(rejectionCodes(run(newWorld(), outcome('RULE-C-008', 2, [support('group-west-elite', [])])))).toEqual(['SUPPORT_CAUSE_MISSING'])
    const ok = run(newWorld(), outcome('RULE-C-008', 2, [support('group-west-elite', ['ev-1'])]))
    expect(ok.status).toBe('APPLIED')
    expect(validateWorldState(ok.world).ok).toBe(true)
  })
  it('総和が 10000 でない支持はバリデータ違反で拒否', () => {
    const bad = { ...support('group-west-elite', ['ev']), support: { houseBps: { 'house-nalven': 5000 }, undecidedBps: 4000 } } as DomainCommand
    expect(rejectionCodes(run(newWorld(), outcome('RULE-C-008', 2, [bad])))).toEqual(['INTEGRITY_VIOLATION'])
  })
  it('REGION_CONTROL_SET は実効支配のみ。主権の変更は未実装として拒否', () => {
    const mk = (extra: object): DomainCommand => ({
      type: 'REGION_CONTROL_SET', commandId: 'rc', source: source('D-MIL-001', 5, 'rc'),
      regionId: 'region-eldia-west', deFactoControllerRef: { kind: 'COUNTRY', id: 'country-margald' }, ...extra,
    }) as DomainCommand
    const ok = run(newWorld(), outcome('D-MIL-001', 5, [mk({})]))
    expect(ok.world.regions.find((r) => r.regionId === 'region-eldia-west')).toMatchObject({ deFactoControllerRef: { id: 'country-margald' }, sovereignCountryId: 'country-eldia' })
    expect(rejectionCodes(run(newWorld(), outcome('D-MIL-001', 5, [mk({ sovereignCountryId: 'country-margald' })])))).toEqual(['UNIMPLEMENTED_SOVEREIGNTY_CHANGE'])
  })
})
