import { describe, expect, it } from 'vitest'
import type { DomainCommand, Marriage, RuleOutcome, WorldState } from '../../../../src/simulation/contracts/index.ts'
import { validateWorldState } from '../../../../src/simulation/validation/index.ts'
import { baby, birth, chain, cohortOutcome, natural, newWorld, outcome, rejectionCodes, run, source } from './helpers.ts'

const marriage = (extra: Partial<Marriage> = {}): Marriage => ({
  marriageId: 'mar-1', personIds: ['person-exp-02', 'person-exp-03'], registeredYear: 1250, status: 'ACTIVE', ...extra,
})
const marry = (m: Marriage = marriage(), id = 'm1'): DomainCommand => ({ type: 'MARRIAGE_REGISTER', commandId: id, source: source('A-LEG-01', 3, id), marriage: m })
const withClause = marriage({ contract: { contractId: 'ct-1', evidenceId: 'ev-1', clauses: [{ clauseId: 'cl-1', kind: 'CHILD_LEGAL_DYNASTY', dynastyId: 'dynasty-nalven' }] } })
const setDynasty = (personId: string, dynastyId: string, id = 'dyn'): DomainCommand => ({
  type: 'LEGAL_DYNASTY_SET', commandId: id, source: source('A-DYN-02', 3, id), personId, legalDynasty: { status: 'DETERMINED', dynastyId },
})

describe('婚姻（A のみが登録）', () => {
  it('合法な婚姻を登録し、バリデータを通る', () => {
    const r = run(newWorld(), outcome('A-LEG-01', 3, [marry()]))
    expect(r.status).toBe('APPLIED')
    expect(r.world.legal.marriages).toHaveLength(1)
    expect(validateWorldState(r.world).ok).toBe(true)
  })
  it.each([
    ['非昇順の組', marriage({ personIds: ['person-exp-03', 'person-exp-02'] }), 'INVALID_COMMAND'],
    ['同一人物', marriage({ personIds: ['person-exp-02', 'person-exp-02'] }), 'INVALID_COMMAND'],
    ['登録年が当年でない', marriage({ registeredYear: 1249 }), 'YEAR_MISMATCH'],
    ['ACTIVE でない', marriage({ status: 'DISSOLVED' }), 'INVALID_COMMAND'],
    ['不在の人物', marriage({ personIds: ['person-exp-02', 'person-zzz'] }), 'NOT_FOUND'],
  ] as const)('不正な婚姻: %s', (_n, m, code) => {
    expect(rejectionCodes(run(newWorld(), outcome('A-LEG-01', 3, [marry(m)])))).toEqual([code])
  })
  it('有効な婚姻が既にある人物との婚姻は拒否（法的配偶者は 1 人）', () => {
    const c = chain([outcome('A-LEG-01', 3, [marry()])])
    const second = marriage({ marriageId: 'mar-2', personIds: ['person-exp-02', 'person-exp-04'] })
    expect(rejectionCodes(run(c.world, outcome('A-LEG-01', 3, [marry(second, 'm2')]), c.tx))).toEqual(['PERSON_ALREADY_MARRIED'])
  })
  it('矛盾する契約条項は既存バリデータ経由で拒否（優先順位を自動決定しない）', () => {
    const conflict = marriage({ contract: { contractId: 'c', evidenceId: 'e', clauses: [
      { clauseId: 'a', kind: 'CHILD_LEGAL_DYNASTY', dynastyId: 'dynasty-nalven' },
      { clauseId: 'b', kind: 'CHILD_LEGAL_DYNASTY', dynastyId: 'dynasty-vargas' },
    ] } })
    expect(rejectionCodes(run(newWorld(), outcome('A-LEG-01', 3, [marry(conflict)])))).toEqual(['INTEGRITY_VIOLATION'])
  })
})

describe('出生者の法的所属（GAME-01: 明示条項のみ）', () => {
  const born = (extra: RuleOutcome[] = []) => chain([
    cohortOutcome('group-central-elite', 1, 0),
    outcome('B-002', 3, [birth(baby('person-new-1'))]),
    ...extra,
  ])
  it('出生直後は UNDETERMINED のまま（自動でナルヴェン所属にしない）', () => {
    expect(born().world.persons.find((p) => p.personId === 'person-new-1')?.legalDynasty.status).toBe('UNDETERMINED')
  })
  it('条項付きの有効婚姻がある場合のみ DETERMINED にできる', () => {
    const c = born([outcome('A-LEG-01', 3, [marry(withClause)])])
    const r = run(c.world, outcome('A-DYN-02', 3, [setDynasty('person-new-1', 'dynasty-nalven')]), c.tx)
    expect(r.status).toBe('APPLIED')
    expect(r.world.persons.find((p) => p.personId === 'person-new-1')?.legalDynasty).toEqual({ status: 'DETERMINED', dynastyId: 'dynasty-nalven' })
  })
  it.each([
    ['婚姻なし', []],
    ['条項なしの婚姻', [outcome('A-LEG-01', 3, [marry()])]],
  ] as const)('証拠が無ければ DETERMINED を拒否: %s', (_n, extra) => {
    const c = born([...extra])
    expect(rejectionCodes(run(c.world, outcome('A-DYN-02', 3, [setDynasty('person-new-1', 'dynasty-nalven')]), c.tx))).toEqual(['LEGAL_DYNASTY_EVIDENCE_MISSING'])
  })
  it('条項と異なる王朝への確定、確定済みの上書きは拒否', () => {
    const c = born([outcome('A-LEG-01', 3, [marry(withClause)])])
    expect(rejectionCodes(run(c.world, outcome('A-DYN-02', 3, [setDynasty('person-new-1', 'dynasty-vargas')]), c.tx))).toEqual(['LEGAL_DYNASTY_EVIDENCE_MISSING'])
    expect(rejectionCodes(run(c.world, outcome('A-DYN-02', 3, [setDynasty('person-exp-02', 'dynasty-vargas')]), c.tx))).toEqual(['LEGAL_DYNASTY_ALREADY_DETERMINED'])
  })
  it('UNDETERMINED（理由コード更新）は証拠なしでも可能', () => {
    const c = born()
    const cmd: DomainCommand = { type: 'LEGAL_DYNASTY_SET', commandId: 'u', source: source('A-DYN-02', 3, 'u'), personId: 'person-new-1', legalDynasty: { status: 'UNDETERMINED', reasonCodes: ['NO_CLAUSE_EVIDENCE'] } }
    expect(run(c.world, outcome('A-DYN-02', 3, [cmd]), c.tx).status).toBe('APPLIED')
  })
})

describe('Title・LegalCase・委任・徴税権', () => {
  const kase = (extra: Partial<{ status: 'PENDING' | 'APPROVED' | 'REJECTED'; candidates: string[]; id: string }> = {}): DomainCommand => ({
    type: 'LEGAL_CASE_SET', commandId: `case-${extra.id ?? 'c1'}-${extra.status ?? 'APPROVED'}`, source: source('A-SUC-04', 4, 'case'),
    legalCase: { caseId: extra.id ?? 'case-1', titleId: 'title-exp-central', kind: 'SUCCESSION', status: extra.status ?? 'APPROVED', candidatePersonIds: extra.candidates ?? ['person-exp-02'], reasonCodes: [] },
  })
  const transfer = (legalCaseId?: string, to: 'person-exp-02' | 'none' = 'person-exp-02', titleId = 'title-exp-central'): DomainCommand => ({
    type: 'LEGAL_TITLE_TRANSFER', commandId: `tr-${legalCaseId ?? 'x'}-${to}`, source: source('A-TIT-07', 4, 'tr'), titleId,
    toHolder: to === 'none' ? { status: 'UNDETERMINED', ...(legalCaseId ? { legalCaseId } : {}) } : { status: 'HELD', personId: to },
    ...(legalCaseId ? { legalCaseId } : {}),
  })
  const holderDead = () => chain([cohortOutcome('group-central-elite', 0, 1), outcome('B-003', 3, [natural('person-exp-01')])])

  it('保持者の死亡後、承認済み SUCCESSION ケースに基づき Title を移転できる', () => {
    const c = chain([outcome('A-SUC-04', 4, [kase()]), outcome('A-TIT-07', 4, [transfer('case-1')])], holderDead().world, holderDead().tx)
    expect(c.world.titles.find((t) => t.titleId === 'title-exp-central')?.holder).toEqual({ status: 'HELD', personId: 'person-exp-02' })
    expect(validateWorldState(c.world).ok).toBe(true)
  })
  it('存命の保持者からの移転は適用しない（授与・剥奪は未実装）', () => {
    const c = chain([outcome('A-SUC-04', 4, [kase()])])
    expect(rejectionCodes(run(c.world, outcome('A-TIT-07', 4, [transfer('case-1')]), c.tx))).toEqual(['TITLE_HOLDER_ALIVE'])
  })
  it('根拠ケースなし／PENDING／候補外への移転は拒否（相続順位を推測しない）', () => {
    const h = holderDead()
    expect(rejectionCodes(run(h.world, outcome('A-TIT-07', 4, [transfer()]), h.tx))).toEqual(['LEGAL_BASIS_MISSING'])
    const pending = chain([outcome('A-SUC-04', 4, [kase({ status: 'PENDING' })])], h.world, h.tx)
    expect(rejectionCodes(run(pending.world, outcome('A-TIT-07', 4, [transfer('case-1')]), pending.tx))).toEqual(['LEGAL_BASIS_MISSING'])
    const other = chain([outcome('A-SUC-04', 4, [kase({ candidates: ['person-exp-03'] })])], h.world, h.tx)
    expect(rejectionCodes(run(other.world, outcome('A-TIT-07', 4, [transfer('case-1')]), other.tx))).toEqual(['LEGAL_BASIS_MISSING'])
  })
  it('継承未確定（UNDETERMINED）への移転は PENDING として許可され、承認は変更しない', () => {
    const h = holderDead()
    const r = run(h.world, outcome('A-TIT-07', 4, [transfer(undefined, 'none')]), h.tx)
    expect(r.status).toBe('APPLIED')
    const t = r.world.titles.find((x) => x.titleId === 'title-exp-central')
    expect(t?.holder).toEqual({ status: 'UNDETERMINED' })
    expect(t?.recognition.status).toBe('ACTIVE')
  })
  it('確定済み LegalCase は更新できない', () => {
    const c = chain([outcome('A-SUC-04', 4, [kase()])])
    const again: DomainCommand = { ...kase({ status: 'REJECTED' }) }
    expect(rejectionCodes(run(c.world, outcome('A-SUC-04', 4, [again]), c.tx))).toEqual(['LEGAL_CASE_FINALIZED'])
  })
  it('ACTIVE 承認には authority と sourceDecisionId が必要（権限を後付けしない）', () => {
    const c: DomainCommand = { type: 'TITLE_RECOGNITION_SET', commandId: 'rc', source: source('A-TIT-06', 4, 'rc'), titleId: 'title-exp-west', recognition: { status: 'ACTIVE' } }
    expect(rejectionCodes(run(newWorld(), outcome('A-TIT-06', 4, [c])))).toEqual(['RECOGNITION_EVIDENCE_MISSING'])
    const revoke: DomainCommand = { ...c, commandId: 'rv', recognition: { status: 'REVOKED' } }
    const r = run(newWorld(), outcome('A-TIT-06', 4, [revoke]))
    expect(r.status).toBe('APPLIED')
    // 剥奪しても領土返還・委任・徴税権などの連鎖変更はしない
    const paths = r.applied.flatMap((a) => a.stateChanges.map((s) => s.path))
    expect(paths).toContain('$.titles[title-exp-west].recognition.status')
    expect(paths.every((x) => x.startsWith('$.titles[title-exp-west].recognition.'))).toBe(true)
  })
  it('承認を PENDING へ戻すことができる（権限者の後付け無し）', () => {
    const c: DomainCommand = { type: 'TITLE_RECOGNITION_SET', commandId: 'rc', source: source('A-TIT-06', 4, 'rc'), titleId: 'title-exp-west', recognition: { status: 'PENDING' } }
    expect(run(newWorld(), outcome('A-TIT-06', 4, [c])).status).toBe('APPLIED')
  })

  const mandate = (over: object = {}): DomainCommand => ({
    type: 'CONTROL_MANDATE_SET', commandId: 'cm', source: source('A-TIT-07', 4, 'cm'),
    mandate: { mandateId: 'cm-1', regionId: 'region-eldia-west', controllerRef: { kind: 'PERSON', id: 'person-exp-04' }, beneficiaryPersonId: 'person-exp-04', authorizingTitleId: 'title-exp-west', sourceEventId: 'ev-1', effectiveFromYear: 1250, endExclusiveYear: 1300, ...over },
  }) as DomainCommand
  it('ControlMandate: 受益者が根拠 Title の保持者である場合のみ登録（自動付替えなし）', () => {
    expect(run(newWorld(), outcome('A-TIT-07', 4, [mandate()])).status).toBe('APPLIED')
    expect(rejectionCodes(run(newWorld(), outcome('A-TIT-07', 4, [mandate({ beneficiaryPersonId: 'person-exp-05' })])))).toEqual(['MANDATE_BENEFICIARY_NOT_HOLDER'])
    expect(rejectionCodes(run(newWorld(), outcome('A-TIT-07', 4, [mandate({ sourceEventId: '' })])))).toEqual(['MANDATE_EVIDENCE_MISSING'])
    expect(rejectionCodes(run(newWorld(), outcome('A-TIT-07', 4, [mandate({ effectiveFromYear: 1249 })])))).toEqual(['RETROACTIVE_MANDATE'])
    expect(rejectionCodes(run(newWorld(), outcome('A-TIT-07', 4, [mandate({ regionId: 'region-eldia-east' })])))).toEqual(['INTEGRITY_VIOLATION'])
  })

  const tax = (over: object = {}): DomainCommand => ({
    type: 'TAX_MANDATE_SET', commandId: 'tx', source: source('A-TIT-09', 4, 'tx'),
    mandate: { mandateId: 'tax-new', regionId: 'region-eldia-west', collectorCountryId: 'country-margald', effectiveFromYear: 1251, endExclusiveYear: 1300, sourceTreatyOrLawId: 'law-1', ...over },
  }) as DomainCommand
  it('TaxCollectionMandate: 当年へ遡及しない／地域×年度で 1 件まで', () => {
    expect(rejectionCodes(run(newWorld(), outcome('A-TIT-09', 4, [tax({ effectiveFromYear: 1250 })])))).toEqual(['RETROACTIVE_MANDATE'])
    // 初期世界は 1350 年まで既存 mandate があるため、期間が重なる新規は拒否
    expect(rejectionCodes(run(newWorld(), outcome('A-TIT-09', 4, [tax()])))).toEqual(['INTEGRITY_VIOLATION'])
    expect(rejectionCodes(run(newWorld(), outcome('A-TIT-09', 4, [tax({ sourceTreatyOrLawId: '' })])))).toEqual(['MANDATE_EVIDENCE_MISSING'])
  })
})

describe('未実装の種別・効果は成功扱いにせず拒否する', () => {
  it('TREATY_COMMIT は UNIMPLEMENTED_COMMAND（A の適法性審査の証拠を契約が表現しないため）', () => {
    const c: DomainCommand = { type: 'TREATY_COMMIT', commandId: 't', source: source('D-DIP-002', 6, 't'), treatyId: 'tr', deltas: [] }
    const w: WorldState = newWorld()
    const r = run(w, outcome('D-DIP-002', 6, [c]))
    expect(r.status).toBe('REJECTED')
    expect(rejectionCodes(r)).toEqual(['UNIMPLEMENTED_COMMAND'])
    expect(r.world).toBe(w)
  })
  it('DeferredEffect を含む Outcome は全体を拒否（commands も適用しない）', () => {
    const w = newWorld()
    const r = run(w, outcome('B-006', 3, [], {
      deferred: [{ deferredId: 'd1', source: source('B-006', 3, 'd'), effectiveFromYear: 1251, payload: { kind: 'SUPPORT_SIGNAL', groupId: 'group-west-elite', houseId: 'house-vargas', signal: 1, causeEventId: 'e' } }],
    }))
    expect(rejectionCodes(r)).toEqual(['UNIMPLEMENTED_DEFERRED_EFFECT'])
    expect(r.world).toBe(w)
  })
  it('commands が空の Outcome は NO_OP（偽の成功差分を作らない）', () => {
    const r = run(newWorld(), outcome('B-001', 3, []))
    expect(r.status).toBe('NO_OP')
    expect(r.applied).toEqual([])
  })
})
