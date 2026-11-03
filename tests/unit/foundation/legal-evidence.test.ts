import { describe, expect, it } from 'vitest'
import {
  EXPERIMENTAL_MARRIAGE_CANDIDATES,
  NALVEN_DYNASTY_ID,
  createExperimentalLegalEvidence,
  createExperimentalWorld,
} from '../../../src/scenario/experimental/index.ts'
import type { ControlMandate, WorldState } from '../../../src/simulation/contracts/index.ts'
import type { LegalEvidenceBook } from '../../../src/simulation/legal/evidence.ts'
import {
  resolveChildLegalDynasty, reviewApprovalAuthority, reviewMandateBeneficiary, reviewNewDelegation, verifyInitialLegalEvidence,
} from '../../../src/simulation/legal/evidence.ts'
import { validateWorldState } from '../../../src/simulation/validation/index.ts'

const codesOf = (w: WorldState, b: LegalEvidenceBook) => verifyInitialLegalEvidence(w, b).map((i) => i.code)
const dynasties = (w: WorldState) => new Set(w.legal.dynasties.map((d) => d.dynastyId))

describe('experimental 1250 世界と法的証拠の整合', () => {
  it('世界は validateWorldState で受理され、証拠記録との相互参照に不整合がない', () => {
    const w = createExperimentalWorld()
    expect(validateWorldState(w).ok).toBe(true)
    expect(verifyInitialLegalEvidence(w, createExperimentalLegalEvidence())).toEqual([])
  })

  it('初期家系: 01 当主、02 嫡男(男)、03 娘(女)、05 は女性・1230 年生の試験設定、全 8 人', () => {
    const p = new Map(createExperimentalWorld().persons.map((x) => [x.personId, x]))
    expect(p.size).toBe(8)
    expect(p.get('person-exp-02')).toMatchObject({ sex: 'MALE', birthYear: 1230, fatherId: 'person-exp-01' })
    expect(p.get('person-exp-03')).toMatchObject({ sex: 'FEMALE', fatherId: 'person-exp-01' })
    expect(p.get('person-exp-05')).toMatchObject({ sex: 'FEMALE', birthYear: 1230 })
    expect(p.get('person-exp-04')).toMatchObject({ sex: 'MALE' }) // P4/P5 UI 試験の組は維持
  })

  it('中央 Title は授与・承認・主権・行政支配・徴税が相互参照で辿れる（根拠は互いに別記録）', () => {
    const w = createExperimentalWorld()
    const b = createExperimentalLegalEvidence()
    const t = w.titles.find((x) => x.titleId === 'title-exp-central')!
    const grant = b.titleGrants.find((g) => g.grantBasisId === t.grantBasisId)!
    expect(grant).toMatchObject({ titleId: t.titleId, initialGranteePersonId: 'person-exp-01', hereditary: true, origin: 'BACKGROUND_PRE_1250', sovereignCountryId: 'country-eldia' })
    expect(b.titleRecognitions.find((d) => d.decisionId === t.recognition.sourceDecisionId)).toMatchObject({ titleId: t.titleId, authority: t.recognition.authority })
    expect(b.administrations.some((a) => a.regionId === t.regionId)).toBe(true)
    expect(b.taxBases[0]!.collectors).toContainEqual({ regionId: t.regionId, collectorCountryId: 'country-eldia' })
    // 背景史の契約を 1250 以降の EventLog / ControlMandate として偽造しない
    expect(w.legal.controlMandates).toEqual([])
    expect(w.legal.marriages).toEqual([])
  })
})

describe('証拠の欠落・不一致を診断し、補完しない', () => {
  const book = () => createExperimentalLegalEvidence() as { -readonly [K in keyof LegalEvidenceBook]: LegalEvidenceBook[K][number][] }
  const mk = (edit: (b: ReturnType<typeof book>) => void, w: WorldState = createExperimentalWorld()) => {
    const b = book(); edit(b); return codesOf(w, b as unknown as LegalEvidenceBook)
  }

  it('授与根拠の欠落は GRANT_BASIS_MISSING（ID 文字列だけでは証明にならない）', () => {
    expect(mk((b) => { b.titleGrants = b.titleGrants.filter((g) => g.titleId !== 'title-exp-central') })).toContain('GRANT_BASIS_MISSING')
  })
  it('主権国・対象 Title・被授与者の不一致', () => {
    expect(mk((b) => { b.titleGrants[1] = { ...b.titleGrants[1]!, sovereignCountryId: 'country-margald' } })).toContain('GRANT_SOVEREIGN_MISMATCH')
    expect(mk((b) => { b.titleGrants[1] = { ...b.titleGrants[1]!, titleId: 'title-exp-west' } })).toContain('GRANT_TITLE_MISMATCH')
    expect(mk((b) => { b.titleGrants[1] = { ...b.titleGrants[1]!, initialGranteePersonId: 'person-exp-02' } })).toContain('GRANT_GRANTEE_MISMATCH')
  })
  it('承認記録の欠落・不一致', () => {
    expect(mk((b) => { b.titleRecognitions = b.titleRecognitions.filter((d) => d.titleId !== 'title-exp-central') })).toContain('RECOGNITION_DECISION_MISSING')
    expect(mk((b) => { b.titleRecognitions[1] = { ...b.titleRecognitions[1]!, authority: { kind: 'COUNTRY', id: 'country-versa' } } })).toContain('RECOGNITION_MISMATCH')
  })
  it('行政支配・徴税根拠の欠落と不一致', () => {
    expect(mk((b) => { b.administrations = [] })).toContain('ADMINISTRATION_BASIS_MISSING')
    expect(mk((b) => { b.administrations[0] = { ...b.administrations[0]!, controllerRef: { kind: 'COUNTRY', id: 'country-versa' } } })).toContain('ADMINISTRATION_MISMATCH')
    expect(mk((b) => { b.taxBases = [] })).toContain('TAX_BASIS_MISSING')
    expect(mk((b) => { b.taxBases[0] = { ...b.taxBases[0]!, collectors: [] } })).toContain('TAX_BASIS_MISMATCH')
  })
  it('無効な契約候補（未知王朝・不在人物・重複）と ID 重複', () => {
    const c = EXPERIMENTAL_MARRIAGE_CANDIDATES[1]!
    expect(mk((b) => { b.marriageCandidates = [{ ...c, contract: { ...c.contract!, clauses: [{ ...c.contract!.clauses[0]!, dynastyId: 'dynasty-ghost' }] } }] })).toContain('CANDIDATE_CONTRACT_INVALID')
    expect(mk((b) => { b.marriageCandidates = [{ ...c, personIds: ['person-exp-02', 'person-zzz'] }] })).toContain('CANDIDATE_PERSON_INVALID')
    expect(mk((b) => { b.marriageCandidates = [c, c] })).toContain('DUPLICATE_EVIDENCE_ID')
  })
  it('後年の合法相続で保有者が変わった世界を GRANT_GRANTEE_MISMATCH と誤検出しない（初期世界専用）', () => {
    const w = createExperimentalWorld()
    const later = { ...w, year: 1285, titles: w.titles.map((t) => (t.titleId === 'title-exp-central' ? { ...t, holder: { status: 'HELD' as const, personId: 'person-exp-02' } } : t)) }
    const issues = verifyInitialLegalEvidence(later, createExperimentalLegalEvidence())
    expect(issues.map((i) => i.code)).toEqual(['NOT_INITIAL_WORLD'])
  })
  it('世界側を不一致にしても検出する（Title の保有者を変更）', () => {
    const w = createExperimentalWorld()
    const edited = { ...w, titles: w.titles.map((t) => (t.titleId === 'title-exp-central' ? { ...t, holder: { status: 'HELD' as const, personId: 'person-exp-02' } } : t)) }
    expect(codesOf(edited, createExperimentalLegalEvidence())).toContain('GRANT_GRANTEE_MISMATCH')
  })
})

describe('GAME-01: 子の法的王朝は有効な明示条項があるときのみ', () => {
  const known = dynasties(createExperimentalWorld())
  it('02/05 の候補は 2 件。条項なしは UNDETERMINED、父系既定値で補わない', () => {
    expect(EXPERIMENTAL_MARRIAGE_CANDIDATES.map((c) => c.personIds)).toEqual([['person-exp-02', 'person-exp-05'], ['person-exp-02', 'person-exp-05']])
    expect(resolveChildLegalDynasty(EXPERIMENTAL_MARRIAGE_CANDIDATES[0]!.contract, known)).toEqual({ status: 'UNDETERMINED', reasonCodes: ['GAME_01_DYNASTY_CLAUSE_MISSING'] })
    expect(resolveChildLegalDynasty(undefined, known)).toMatchObject({ status: 'UNDETERMINED' })
  })
  it('契約 ID・証拠 ID・条項 ID の欠落した契約から王朝を確定しない', () => {
    const base = EXPERIMENTAL_MARRIAGE_CANDIDATES[1]!.contract!
    expect(resolveChildLegalDynasty({ ...base, evidenceId: '' }, known)).toEqual({ status: 'UNDETERMINED', reasonCodes: ['MARRIAGE_CONTRACT_EVIDENCE_MISSING'] })
    expect(resolveChildLegalDynasty({ ...base, contractId: '' }, known)).toMatchObject({ status: 'UNDETERMINED' })
    expect(resolveChildLegalDynasty({ ...base, clauses: [{ ...base.clauses[0]!, clauseId: '' }] }, known)).toEqual({ status: 'UNDETERMINED', reasonCodes: ['CLAUSE_ID_MISSING'] })
  })
  it('明示条項があれば DETERMINED。矛盾・未知王朝は UNDETERMINED', () => {
    expect(resolveChildLegalDynasty(EXPERIMENTAL_MARRIAGE_CANDIDATES[1]!.contract, known)).toEqual({ status: 'DETERMINED', dynastyId: NALVEN_DYNASTY_ID })
    const cl = (id: string, d: string) => ({ clauseId: id, kind: 'CHILD_LEGAL_DYNASTY' as const, dynastyId: d })
    expect(resolveChildLegalDynasty({ contractId: 'c', evidenceId: 'e', clauses: [cl('1', NALVEN_DYNASTY_ID), cl('2', 'dynasty-cardon')] }, known)).toMatchObject({ status: 'UNDETERMINED', reasonCodes: ['AMBIGUOUS_DYNASTY_CLAUSES'] })
    expect(resolveChildLegalDynasty({ contractId: 'c', evidenceId: 'e', clauses: [cl('1', 'dynasty-ghost')] }, known)).toMatchObject({ status: 'UNDETERMINED', reasonCodes: ['CLAUSE_DYNASTY_UNKNOWN'] })
  })
  it('候補は未登録で、成立年・子・結果を持たず、世界の婚姻にも入らない', () => {
    for (const c of EXPERIMENTAL_MARRIAGE_CANDIDATES) {
      expect(c.registration).toBe('NOT_REGISTERED')
      expect(Object.keys(c)).not.toContain('registeredYear')
    }
    expect(createExperimentalWorld().legal.marriages).toEqual([])
  })
})

describe('GAME-02: 発行者の存在だけでは権限とみなさない', () => {
  const w = createExperimentalWorld()
  const q = { action: 'NORMAL_MARRIAGE' as const, issuerRef: { kind: 'COUNTRY' as const, id: 'country-eldia' }, sovereignCountryId: 'country-eldia' }
  it('権限記録が無ければ PENDING（初期データには承認権限の記録を置かない）', () => {
    expect(createExperimentalLegalEvidence().approvalAuthorities).toEqual([])
    expect(reviewApprovalAuthority(w, createExperimentalLegalEvidence(), q)).toEqual({ status: 'PENDING', reasonCodes: ['GAME_02_AUTHORITY_BASIS_MISSING'] })
    expect(reviewApprovalAuthority(w, createExperimentalLegalEvidence(), { ...q, issuerRef: { kind: 'HOUSE', id: 'house-ghost' } })).toMatchObject({ status: 'PENDING', reasonCodes: ['ISSUER_NOT_FOUND'] })
  })
  it('action・保有者・主権国が一致する明示記録のみ AUTHORIZED', () => {
    const rec = { authorityBasisId: 'auth-1', action: 'NORMAL_MARRIAGE' as const, holderRef: q.issuerRef, sovereignCountryId: 'country-eldia', provenance: 'CALIBRATION_ONLY' as const }
    const book = { ...createExperimentalLegalEvidence(), approvalAuthorities: [rec] }
    expect(reviewApprovalAuthority(w, book, q)).toEqual({ status: 'AUTHORIZED', authorityBasisId: 'auth-1' })
    expect(reviewApprovalAuthority(w, book, { ...q, action: 'NORMAL_LAND_SUCCESSION' })).toMatchObject({ status: 'PENDING' })
    expect(reviewApprovalAuthority(w, { ...book, approvalAuthorities: [rec, { ...rec, authorityBasisId: 'auth-2' }] }, q)).toMatchObject({ status: 'PENDING', reasonCodes: ['AMBIGUOUS_AUTHORITY_BASIS'] })
  })
})

describe('GAME-03: 旧委任の受益者を自動付替えしない', () => {
  const w0 = createExperimentalWorld()
  const mandate: ControlMandate = { mandateId: 'cm-old', regionId: 'region-eldia-central', controllerRef: { kind: 'PERSON', id: 'person-exp-01' }, beneficiaryPersonId: 'person-exp-01', authorizingTitleId: 'title-exp-central', sourceEventId: 'ev-test', effectiveFromYear: 1250, endExclusiveYear: 1300 }
  const afterSuccession: WorldState = { ...w0, titles: w0.titles.map((t) => (t.titleId === 'title-exp-central' ? { ...t, holder: { status: 'HELD' as const, personId: 'person-exp-02' } } : t)) }
  const delegation = { delegationId: 'del-new', titleId: 'title-exp-central', delegatorPersonId: 'person-exp-02', delegateePersonId: 'person-exp-03', regionId: 'region-eldia-central', effectiveFromYear: 1260, endExclusiveYear: 1270, evidenceId: 'ev-new', provenance: 'CALIBRATION_ONLY' as const }

  it('保有者交替後、旧受益者の委任は新根拠が必要と返し、委任自体は変更しない', () => {
    const before = structuredClone(mandate)
    expect(reviewMandateBeneficiary(w0, mandate)).toEqual({ status: 'BENEFICIARY_IS_CURRENT_HOLDER' })
    expect(reviewMandateBeneficiary(afterSuccession, mandate)).toEqual({ status: 'REQUIRES_NEW_DELEGATION', reasonCodes: ['GAME_03_BENEFICIARY_NOT_CURRENT_HOLDER'] })
    expect(mandate).toEqual(before)
  })
  it('新規委任は構造整合のみ返し（法的成立とはしない）、旧世界の保有者では PENDING', () => {
    expect(reviewNewDelegation(afterSuccession, delegation)).toEqual({ status: 'STRUCTURALLY_CONSISTENT', authorityVerified: false })
    expect(reviewNewDelegation(w0, delegation)).toMatchObject({ status: 'PENDING', reasonCodes: ['DELEGATOR_NOT_CURRENT_HOLDER'] })
    expect(reviewNewDelegation(afterSuccession, { ...delegation, evidenceId: '', endExclusiveYear: 1260 })).toMatchObject({ status: 'PENDING', reasonCodes: ['INVALID_PERIOD', 'EVIDENCE_MISSING'] })
  })
})
