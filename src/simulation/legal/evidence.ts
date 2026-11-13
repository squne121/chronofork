// 法的証拠の最小共有境界（Issue #53）。WorldState には保存しない独立の証拠定義と、純粋な照合関数のみ。
// 相続評価器・Goal 公開条件・UI は含まない。GAME-01/02/03 は未承認のため、
// 明示記録が無いものを補完せず UNDETERMINED / PENDING を返す。1200〜1249 の背景史は EventLog に偽造しない。
import { START_YEAR } from '../contracts/index.ts'
import type {
  ControllerRef, ControlMandate, Id, LegalDynastyState, MarriageContract, Person, WorldState, Year,
} from '../contracts/index.ts'

export type EvidenceProvenance = 'CALIBRATION_ONLY'

/** 世襲 Title の授与根拠。Title.grantBasisId が指す先。文字列 ID だけでは権限の証明にならない。 */
export type TitleGrantRecord = Readonly<{
  grantBasisId: Id
  titleId: Id
  initialGranteePersonId: Id
  grantorRef: ControllerRef
  sovereignCountryId: Id
  hereditary: true
  /** 1200〜1249 の背景史に属し、1250 以降のイベントとしては再現しない。 */
  origin: 'BACKGROUND_PRE_1250'
  provenance: EvidenceProvenance
}>

/** Title の法的承認（Title.recognition.sourceDecisionId が指す先）。 */
export type TitleRecognitionRecord = Readonly<{
  decisionId: Id
  titleId: Id
  authority: ControllerRef
  sovereignCountryId: Id
  provenance: EvidenceProvenance
}>

/** 初期の実効行政支配（ControlMandate とは別。合法委任ではない）。 */
export type InitialAdministrationRecord = Readonly<{
  basisId: Id
  regionId: Id
  controllerRef: ControllerRef
  provenance: EvidenceProvenance
}>

/** 初期の徴税根拠（TaxCollectionMandate.sourceTreatyOrLawId が指す先）。主権・行政支配とは別。 */
export type TaxBasisRecord = Readonly<{
  sourceTreatyOrLawId: Id
  /** 1 つの法・条約が地域ごとの徴収国を定める。記載の無い地域には効力を持たない。 */
  collectors: readonly Readonly<{ regionId: Id; collectorCountryId: Id }>[]
  provenance: EvidenceProvenance
}>

export type ApprovalAction = 'NORMAL_MARRIAGE' | 'NORMAL_LAND_SUCCESSION' | 'CROWN_SUCCESSION'

/** 法的承認の権限記録（GAME-02）。発行者が存在するだけでは権限とみなさない。 */
export type ApprovalAuthorityRecord = Readonly<{
  authorityBasisId: Id
  action: ApprovalAction
  holderRef: ControllerRef
  sovereignCountryId: Id
  provenance: EvidenceProvenance
}>

/** 婚姻契約の候補。成立年・成立結果・子・相続・勝敗は持たない。 */
export type MarriageContractCandidate = Readonly<{
  candidateId: Id
  personIds: readonly [Id, Id]
  /** 未設定は契約なし。条項が無ければ子の帰属は UNDETERMINED（父系既定値は無い）。 */
  contract?: MarriageContract
  registration: 'NOT_REGISTERED'
  provenance: EvidenceProvenance
}>

export type LegalEvidenceBook = Readonly<{
  titleGrants: readonly TitleGrantRecord[]
  titleRecognitions: readonly TitleRecognitionRecord[]
  administrations: readonly InitialAdministrationRecord[]
  taxBases: readonly TaxBasisRecord[]
  approvalAuthorities: readonly ApprovalAuthorityRecord[]
  marriageCandidates: readonly MarriageContractCandidate[]
}>

export type LegalEvidenceIssueCode =
  | 'NOT_INITIAL_WORLD'
  | 'DUPLICATE_EVIDENCE_ID'
  | 'GRANT_BASIS_MISSING'
  | 'GRANT_TITLE_MISMATCH'
  | 'GRANT_SOVEREIGN_MISMATCH'
  | 'GRANT_GRANTEE_MISMATCH'
  | 'GRANT_NOT_HEREDITARY'
  | 'GRANT_REF_UNRESOLVED'
  | 'RECOGNITION_DECISION_MISSING'
  | 'RECOGNITION_MISMATCH'
  | 'ADMINISTRATION_BASIS_MISSING'
  | 'ADMINISTRATION_MISMATCH'
  | 'TAX_BASIS_MISSING'
  | 'TAX_BASIS_MISMATCH'
  | 'CANDIDATE_PERSON_INVALID'
  | 'CANDIDATE_CONTRACT_INVALID'

export type LegalEvidenceIssue = Readonly<{ code: LegalEvidenceIssueCode; path: string; message: string; related: readonly Id[] }>

const sameRef = (a: ControllerRef, b: ControllerRef) => a.kind === b.kind && a.id === b.id
const refExists = (w: WorldState, r: ControllerRef) =>
  r.kind === 'COUNTRY' ? w.countries.some((x) => x.countryId === r.id)
    : r.kind === 'HOUSE' ? w.houses.some((x) => x.houseId === r.id)
      : w.persons.some((x) => x.personId === r.id)

/**
 * 契約の明示条項だけから子の法的王朝を決める。条項なし／矛盾／未知の王朝／ID 欠落は UNDETERMINED。父系既定値は持たない。
 * 境界: これは契約オブジェクトの構造検証のみ。その契約が登録・承認済みの有効な婚姻（親の婚姻）に属するかは
 * この引数では確認できないため、呼び出し側が登録済み婚姻（Marriage.status=ACTIVE と契約の対応）を確認した後にだけ使うこと。
 * 未登録の婚姻契約候補（MarriageContractCandidate）の契約を渡して出生の帰属を確定してはならない。
 */
export function resolveChildLegalDynasty(
  contract: MarriageContract | undefined, knownDynastyIds: ReadonlySet<Id>,
): LegalDynastyState {
  if (contract === undefined) return { status: 'UNDETERMINED', reasonCodes: ['GAME_01_NO_CONTRACT'] }
  if (!contract.contractId || !contract.evidenceId) return { status: 'UNDETERMINED', reasonCodes: ['MARRIAGE_CONTRACT_EVIDENCE_MISSING'] }
  if (contract.clauses.some((c) => !c.clauseId)) return { status: 'UNDETERMINED', reasonCodes: ['CLAUSE_ID_MISSING'] }
  const ids = new Set(contract.clauses.filter((c) => c.kind === 'CHILD_LEGAL_DYNASTY').map((c) => c.dynastyId))
  if (ids.size === 0) return { status: 'UNDETERMINED', reasonCodes: ['GAME_01_DYNASTY_CLAUSE_MISSING'] }
  if (ids.size > 1) return { status: 'UNDETERMINED', reasonCodes: ['AMBIGUOUS_DYNASTY_CLAUSES'] }
  const [dynastyId] = [...ids] as [Id]
  if (!knownDynastyIds.has(dynastyId)) return { status: 'UNDETERMINED', reasonCodes: ['CLAUSE_DYNASTY_UNKNOWN'] }
  return { status: 'DETERMINED', dynastyId }
}

/**
 * 1250 年の初期世界専用: 世界と初期証拠記録の相互参照を検証する。補完・修正はしない。
 * 初期授与記録の被授与者（initialGranteePersonId）は初期保有者であり、合法相続後の現在の保有者とは別。
 * 後年の世界では保有者・支配・徴税先が合法に変わるため、照合せず NOT_INITIAL_WORLD のみ返す（誤検出しない）。
 */
export function verifyInitialLegalEvidence(world: WorldState, book: LegalEvidenceBook): readonly LegalEvidenceIssue[] {
  if (world.year !== START_YEAR) {
    return [{ code: 'NOT_INITIAL_WORLD', path: 'year', message: `初期世界(${START_YEAR})専用です。後年の保有・支配の変化は初期記録と照合しません`, related: [] }]
  }
  const issues: LegalEvidenceIssue[] = []
  const add = (code: LegalEvidenceIssueCode, path: string, message: string, related: readonly Id[] = []) =>
    issues.push({ code, path, message, related })
  const dup = (path: string, ids: readonly Id[]) => {
    const seen = new Set<Id>()
    ids.forEach((id, i) => {
      if (seen.has(id)) add('DUPLICATE_EVIDENCE_ID', `${path}[${i}]`, `証拠 ID が重複しています: ${id}`, [id])
      seen.add(id)
    })
  }
  dup('titleGrants', book.titleGrants.map((x) => x.grantBasisId))
  dup('titleRecognitions', book.titleRecognitions.map((x) => x.decisionId))
  dup('administrations', book.administrations.map((x) => x.basisId))
  dup('taxBases', book.taxBases.map((x) => x.sourceTreatyOrLawId))
  dup('approvalAuthorities', book.approvalAuthorities.map((x) => x.authorityBasisId))
  dup('marriageCandidates', book.marriageCandidates.map((x) => x.candidateId))

  const regionById = new Map(world.regions.map((r) => [r.regionId, r]))
  world.titles.forEach((t, i) => {
    const p = `titles[${i}]`
    const region = regionById.get(t.regionId)
    const grant = book.titleGrants.find((g) => g.grantBasisId === t.grantBasisId)
    if (grant === undefined) {
      add('GRANT_BASIS_MISSING', `${p}.grantBasisId`, `授与根拠 ${t.grantBasisId} の記録がありません（ID 文字列のみでは権限の証明になりません）`, [t.titleId])
    } else {
      if (grant.titleId !== t.titleId) add('GRANT_TITLE_MISMATCH', p, '授与根拠の対象 Title が一致しません', [grant.titleId])
      if (region !== undefined && grant.sovereignCountryId !== region.sovereignCountryId) {
        add('GRANT_SOVEREIGN_MISMATCH', p, '授与根拠の主権国が地域の上位主権と一致しません', [grant.sovereignCountryId])
      }
      if (t.hereditary && !grant.hereditary) add('GRANT_NOT_HEREDITARY', p, '世襲 Title の授与根拠が世襲を明示していません')
      if (t.holder.status === 'HELD' && grant.initialGranteePersonId !== t.holder.personId) {
        add('GRANT_GRANTEE_MISMATCH', p, '初期世界の保有者が授与根拠の被授与者と一致しません', [grant.initialGranteePersonId])
      }
      if (!refExists(world, grant.grantorRef) || !world.persons.some((x) => x.personId === grant.initialGranteePersonId)) {
        add('GRANT_REF_UNRESOLVED', p, '授与者または被授与者が世界に存在しません')
      }
    }
    const rec = t.recognition
    if (rec.status === 'ACTIVE') {
      const decision = book.titleRecognitions.find((d) => d.decisionId === rec.sourceDecisionId)
      if (decision === undefined) {
        add('RECOGNITION_DECISION_MISSING', `${p}.recognition.sourceDecisionId`, `承認根拠 ${rec.sourceDecisionId ?? '(未設定)'} の記録がありません`, [t.titleId])
      } else if (decision.titleId !== t.titleId || rec.authority === undefined || !sameRef(decision.authority, rec.authority) ||
        decision.sovereignCountryId !== rec.sovereignCountryId) {
        add('RECOGNITION_MISMATCH', `${p}.recognition`, '承認記録の Title・権限者・主権国が Title の承認と一致しません', [decision.decisionId])
      }
    }
  })

  world.regions.forEach((r, i) => {
    const p = `regions[${i}]`
    // 実効支配の根拠は主権とは別に、地域ごとに 1 件の明示記録を要する。
    const admin = book.administrations.filter((a) => a.regionId === r.regionId)
    if (admin.length === 0) add('ADMINISTRATION_BASIS_MISSING', p, `地域 ${r.regionId} の初期行政支配の記録がありません`, [r.regionId])
    else if (!admin.some((a) => sameRef(a.controllerRef, r.deFactoControllerRef))) {
      add('ADMINISTRATION_MISMATCH', p, '行政支配の記録が地域の deFactoControllerRef と一致しません', admin.map((a) => a.basisId))
    }
  })

  world.legal.taxMandates.forEach((m, i) => {
    const p = `legal.taxMandates[${i}]`
    const basis = book.taxBases.find((b) => b.sourceTreatyOrLawId === m.sourceTreatyOrLawId)
    if (basis === undefined) add('TAX_BASIS_MISSING', p, `徴税根拠 ${m.sourceTreatyOrLawId} の記録がありません`, [m.mandateId])
    else if (!basis.collectors.some((c) => c.regionId === m.regionId && c.collectorCountryId === m.collectorCountryId)) {
      add('TAX_BASIS_MISMATCH', p, '徴税根拠に、この地域と徴収国の組がありません', [basis.sourceTreatyOrLawId])
    }
  })

  const dynastyIds = new Set(world.legal.dynasties.map((d) => d.dynastyId))
  book.marriageCandidates.forEach((c, i) => {
    const p = `marriageCandidates[${i}]`
    const [a, b] = c.personIds
    const pa = world.persons.find((x) => x.personId === a)
    const pb = world.persons.find((x) => x.personId === b)
    if (!(a < b) || pa === undefined || pb === undefined) {
      add('CANDIDATE_PERSON_INVALID', `${p}.personIds`, '候補の人物が不在、または ID 昇順の異なる 2 名ではありません', [a, b])
    }
    if (c.contract !== undefined) {
      const clauseIds = c.contract.clauses.map((x) => x.clauseId)
      if (new Set(clauseIds).size !== clauseIds.length || !c.contract.contractId || !c.contract.evidenceId ||
        c.contract.clauses.some((x) => !dynastyIds.has(x.dynastyId))) {
        add('CANDIDATE_CONTRACT_INVALID', `${p}.contract`, '契約の ID・条項 ID が不正、または未知の王朝を参照しています', [c.candidateId])
      }
    }
  })
  return issues
}

export type AuthorityReview =
  | Readonly<{ status: 'AUTHORIZED'; authorityBasisId: Id }>
  | Readonly<{ status: 'PENDING'; reasonCodes: readonly string[] }>

/**
 * GAME-02: 発行者が存在するだけでは合法とみなさない。action・保有者・主権国が一致する明示記録があるときのみ AUTHORIZED。
 * 記録が無ければ PENDING（拒否でも成功でもない）。
 */
export function reviewApprovalAuthority(
  world: WorldState, book: LegalEvidenceBook,
  q: Readonly<{ action: ApprovalAction; issuerRef: ControllerRef; sovereignCountryId: Id }>,
): AuthorityReview {
  if (!refExists(world, q.issuerRef)) return { status: 'PENDING', reasonCodes: ['ISSUER_NOT_FOUND'] }
  const hit = book.approvalAuthorities.filter((a) =>
    a.action === q.action && sameRef(a.holderRef, q.issuerRef) && a.sovereignCountryId === q.sovereignCountryId)
  if (hit.length === 0) return { status: 'PENDING', reasonCodes: ['GAME_02_AUTHORITY_BASIS_MISSING'] }
  if (hit.length > 1) return { status: 'PENDING', reasonCodes: ['AMBIGUOUS_AUTHORITY_BASIS'] }
  return { status: 'AUTHORIZED', authorityBasisId: hit[0]!.authorityBasisId }
}

/** 新規の統治委任の明示根拠（GAME-03）。旧 ControlMandate の受益者付替えではない。 */
export type ControlDelegationBasis = Readonly<{
  delegationId: Id
  titleId: Id
  delegatorPersonId: Id
  delegateePersonId: Id
  regionId: Id
  effectiveFromYear: Year
  endExclusiveYear: Year
  evidenceId: Id
  provenance: EvidenceProvenance
}>

export type MandateBeneficiaryReview =
  | Readonly<{ status: 'BENEFICIARY_IS_CURRENT_HOLDER' }>
  | Readonly<{ status: 'REQUIRES_NEW_DELEGATION'; reasonCodes: readonly string[] }>

/** 旧委任の受益者が現在の Title 保有者でなくなっても、受益者を自動で付替えない。新しい根拠が要るとだけ返す。 */
export function reviewMandateBeneficiary(world: WorldState, mandate: ControlMandate): MandateBeneficiaryReview {
  const title = world.titles.find((t) => t.titleId === mandate.authorizingTitleId)
  if (title === undefined) return { status: 'REQUIRES_NEW_DELEGATION', reasonCodes: ['AUTHORIZING_TITLE_NOT_FOUND'] }
  if (title.holder.status === 'HELD' && title.holder.personId === mandate.beneficiaryPersonId) {
    return { status: 'BENEFICIARY_IS_CURRENT_HOLDER' }
  }
  return { status: 'REQUIRES_NEW_DELEGATION', reasonCodes: ['GAME_03_BENEFICIARY_NOT_CURRENT_HOLDER'] }
}

export type DelegationReview =
  /** 構造上の整合のみ。法的に有効な委任の成立ではない（evidenceId の実在・権限・主権/支配の検証は未実施）。 */
  | Readonly<{ status: 'STRUCTURALLY_CONSISTENT'; authorityVerified: false }>
  | Readonly<{ status: 'PENDING'; reasonCodes: readonly string[] }>

/**
 * 新規委任の構造審査（非権威）。現在の保有者が委任者で、地域・期間・対象人物が整合するかだけを見る。旧委任は変更しない。
 * 未検証: evidenceId が実在する承認記録か、地域の主権・実効支配者がその委任を許すか（GAME-03 は未承認領域）。
 * 呼び出し側は STRUCTURALLY_CONSISTENT を ControlMandate の成立として扱わず、別途の権限確認を経ること。
 */
export function reviewNewDelegation(world: WorldState, d: ControlDelegationBasis): DelegationReview {
  const reasons: string[] = []
  const title = world.titles.find((t) => t.titleId === d.titleId)
  const person = (id: Id): Person | undefined => world.persons.find((x) => x.personId === id)
  if (title === undefined) reasons.push('TITLE_NOT_FOUND')
  else {
    if (!title.valid || title.recognition.status !== 'ACTIVE') reasons.push('TITLE_NOT_ACTIVE')
    if (title.holder.status !== 'HELD' || title.holder.personId !== d.delegatorPersonId) reasons.push('DELEGATOR_NOT_CURRENT_HOLDER')
    if (title.regionId !== d.regionId) reasons.push('REGION_TITLE_MISMATCH')
  }
  if (!person(d.delegatorPersonId)?.alive || !person(d.delegateePersonId)?.alive) reasons.push('PERSON_NOT_ALIVE')
  if (!(d.effectiveFromYear < d.endExclusiveYear)) reasons.push('INVALID_PERIOD')
  if (!d.evidenceId) reasons.push('EVIDENCE_MISSING')
  return reasons.length === 0 ? { status: 'STRUCTURALLY_CONSISTENT', authorityVerified: false } : { status: 'PENDING', reasonCodes: reasons }
}
