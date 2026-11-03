// DEC-057: 通常婚姻・土地相続・新規統治委任の法的授権照合。
// 国/発行者IDだけでは成功にしない。背景法令・初期証拠台帳・現在のWorldStateの三者を照合する。
// 特定年の婚姻・相続・勝利を予約しない。具体値はexperimental/CALIBRATION_ONLYに限定。
import type { ControllerRef, Id, WorldState, Year } from '../contracts/index.ts'
import type { ApprovalAction, LegalEvidenceBook } from './evidence.ts'

export type OrdinaryLegalAction = ApprovalAction | 'NEW_CONTROL_MANDATE'

/** 特定のイベントではなく、法的権限が与えられた範囲・有効期間を表す背景法令。 */
export type OrdinaryLaw = Readonly<{
  lawId: Id
  action: OrdinaryLegalAction
  issuerRef: ControllerRef
  sovereignCountryId: Id
  /** NEW_CONTROL_MANDATEのみ指定。地域とTitle・初期授与の三者を限定する。 */
  regionId?: Id
  titleId?: Id
  grantBasisId?: Id
  effectiveFromYear: Year
  endExclusiveYear: Year
  origin: 'BACKGROUND_PRE_1250'
  provenance: 'CALIBRATION_ONLY'
}>

export type OrdinaryAuthorityReview =
  | Readonly<{ status: 'AUTHORIZED'; lawId: Id; authorityBasisId: Id }>
  | Readonly<{ status: 'PENDING'; reasonCodes: readonly string[] }>

const sameRef = (a: ControllerRef, b: ControllerRef) => a.kind === b.kind && a.id === b.id
const id = (v: unknown): v is Id => typeof v === 'string' && v.length > 0
const pending = (code: string): OrdinaryAuthorityReview => ({ status: 'PENDING', reasonCodes: [code] })

export function validateOrdinaryLaws(laws: readonly OrdinaryLaw[]): readonly string[] {
  if (!Array.isArray(laws)) return ['LAWS_INVALID']
  const errors: string[] = []
  const seen = new Set<string>()
  for (const [i, l] of laws.entries()) {
    if (!l || !id(l.lawId) || !id(l.sovereignCountryId) || !id(l.issuerRef?.id) ||
        l.issuerRef.kind !== 'COUNTRY' || l.issuerRef.id !== l.sovereignCountryId ||
        !['NORMAL_MARRIAGE','NORMAL_LAND_SUCCESSION','NEW_CONTROL_MANDATE'].includes(l.action) ||
        !Number.isSafeInteger(l.effectiveFromYear) || !Number.isSafeInteger(l.endExclusiveYear) ||
        l.effectiveFromYear >= l.endExclusiveYear ||
        l.origin !== 'BACKGROUND_PRE_1250' || l.provenance !== 'CALIBRATION_ONLY') {
      errors.push('INVALID_LAW:' + i)
      continue
    }
    if (seen.has(l.lawId)) errors.push('DUPLICATE_LAW:' + l.lawId)
    seen.add(l.lawId)
    if (l.action === 'NEW_CONTROL_MANDATE') {
      if (![l.regionId,l.titleId,l.grantBasisId].every(id)) errors.push('MANDATE_SCOPE_MISSING:' + i)
    } else if ([l.regionId,l.titleId,l.grantBasisId].some(x => x !== undefined)) {
      errors.push('ORDINARY_SCOPE_INVALID:' + i)
    }
  }
  return errors
}

/** 婚姻/通常相続は背景法令+別のApprovalAuthorityRecordを両方要求。 */
export function reviewOrdinaryAuthority(
  world: WorldState,
  book: LegalEvidenceBook,
  laws: readonly OrdinaryLaw[],
  q: Readonly<{ action: ApprovalAction; sovereignCountryId: Id; issuerRef: ControllerRef; year: Year }>,
): OrdinaryAuthorityReview {
  if (q.issuerRef.kind !== 'COUNTRY' || q.issuerRef.id !== q.sovereignCountryId ||
      !world.countries.some(c => c.countryId === q.sovereignCountryId)) return pending('JURISDICTION_UNVERIFIED')
  const matching = laws.filter(l => l.action === q.action &&
    l.sovereignCountryId === q.sovereignCountryId && sameRef(l.issuerRef, q.issuerRef) &&
    l.effectiveFromYear <= q.year && q.year < l.endExclusiveYear)
  if (matching.length !== 1) return pending(matching.length === 0 ? 'ORDINARY_LAW_MISSING' : 'ORDINARY_LAW_AMBIGUOUS')
  const law = matching[0]!
  const grants = book.approvalAuthorities.filter(a => a.authorityBasisId === law.lawId &&
    a.action === q.action && sameRef(a.holderRef, q.issuerRef) &&
    a.sovereignCountryId === q.sovereignCountryId)
  if (grants.length !== 1) return pending(grants.length === 0 ? 'AUTHORITY_RECORD_MISSING' : 'AUTHORITY_RECORD_AMBIGUOUS')
  return { status: 'AUTHORIZED', lawId: law.lawId, authorityBasisId: grants[0]!.authorityBasisId }
}

/** 旧Mandateは履歴として残る。同時点に実効性があるものだけ競合する。 */
export function mandateEffectiveNow(
  world: WorldState, mandate: WorldState['legal']['controlMandates'][number], year: Year,
): boolean {
  if (mandate.effectiveFromYear > year || year >= mandate.endExclusiveYear) return false
  const title = world.titles.find(t => t.titleId === mandate.authorizingTitleId)
  const region = world.regions.find(r => r.regionId === mandate.regionId)
  const person = world.persons.find(p => p.personId === mandate.beneficiaryPersonId)
  return !!(title?.holder.status === 'HELD' && title.holder.personId === mandate.beneficiaryPersonId &&
    person?.alive && title.valid && title.recognition.status === 'ACTIVE' &&
    region && sameRef(region.deFactoControllerRef, mandate.controllerRef) &&
    title.recognition.sovereignCountryId === region.sovereignCountryId)
}

/** 統治委任には実効支配主体・主権・Title承認・授与記録と、独立した背景授権が必要。 */
export function reviewOrdinaryDelegation(
  world: WorldState, book: LegalEvidenceBook, laws: readonly OrdinaryLaw[],
  titleId: Id, year: Year,
): OrdinaryAuthorityReview {
  const title = world.titles.find(t => t.titleId === titleId)
  const region = title && world.regions.find(r => r.regionId === title.regionId)
  if (!title || !region || !title.valid || !title.hereditary || title.kind !== 'TERRITORIAL' ||
      title.recognition.status !== 'ACTIVE' || !title.recognition.authority ||
      region.deFactoControllerRef.kind !== 'COUNTRY' ||
      region.deFactoControllerRef.id !== region.sovereignCountryId ||
      title.recognition.sovereignCountryId !== region.sovereignCountryId)
    return pending('DOMESTIC_DELEGATION_JURISDICTION_UNVERIFIED')
  const grants = book.titleGrants.filter(g => g.grantBasisId === title.grantBasisId &&
    g.titleId === title.titleId && g.sovereignCountryId === region.sovereignCountryId)
  const recognition = book.titleRecognitions.filter(r => r.decisionId === title.recognition.sourceDecisionId &&
    r.titleId === titleId && r.sovereignCountryId === region.sovereignCountryId &&
    sameRef(r.authority, title.recognition.authority!))
  if (grants.length !== 1 || recognition.length !== 1) return pending('TITLE_GRANT_OR_RECOGNITION_UNVERIFIED')
  const found = laws.filter(l => l.action === 'NEW_CONTROL_MANDATE' &&
    l.issuerRef.kind === 'COUNTRY' && sameRef(l.issuerRef, region.deFactoControllerRef) &&
    l.regionId === region.regionId && l.titleId === titleId &&
    l.grantBasisId === title.grantBasisId && l.sovereignCountryId === region.sovereignCountryId &&
    l.effectiveFromYear <= year && year < l.endExclusiveYear)
  if (found.length !== 1) return pending(found.length === 0 ? 'NEW_DELEGATION_LAW_MISSING' : 'NEW_DELEGATION_LAW_AMBIGUOUS')
  return { status: 'AUTHORIZED', lawId: found[0]!.lawId, authorityBasisId: found[0]!.lawId }
}
