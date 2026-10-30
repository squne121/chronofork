// WorldState（年初状態）と主要エンティティ。契約 §2/§4/§5。
// 派生値（Country.treasury / militaryStrength、House.mobilizationPower、Region.population、
// hasTerritorialControl）は意図的に持たない。一次値は PopulationGroup.population と ResourceLedger のみ。
import type { ControllerRef, Id, ResourceOwnerRef, Source, Year } from './primitives.ts'

export type Country = Readonly<{
  countryId: Id
  name: string
  rulerPersonId?: Id // 未設定は「未確定」であり、他者への自動補完は行わない
  suzerainCountryId?: Id
}>

export type Region = Readonly<{
  regionId: Id
  name: string
  sovereignCountryId: Id // 上位主権（D）
  deFactoControllerRef: ControllerRef // 実効支配（D）。主権・税権・Title とは別
  adjacentRegionIds: readonly Id[]
}>

/** 支持は bps。houseBps の総和 + undecidedBps = 10000。 */
export type SupportDistribution = Readonly<{
  houseBps: Readonly<Record<Id, number>>
  undecidedBps: number
}>

export type PopulationGroup = Readonly<{
  groupId: Id
  regionId: Id
  name: string
  population: number // 唯一の一次値（非負整数）
  prosperity: number // 0..100
  unrest: number // 0..100
  support: SupportDistribution
}>

export type House = Readonly<{
  houseId: Id
  name: string
  countryId?: Id
  headPersonId?: Id
}>

/** 法的王朝所属。出生者は A が決定するまで UNDETERMINED（GAME-01）。 */
export type LegalDynastyState =
  | Readonly<{ status: 'DETERMINED'; dynastyId: Id }>
  | Readonly<{ status: 'UNDETERMINED'; reasonCodes: readonly string[] }>

export type Person = Readonly<{
  personId: Id
  name: string
  sex: 'MALE' | 'FEMALE'
  birthYear: Year
  alive: boolean
  deathYear?: Year
  originGroupId: Id // 人口の内訳（人口へ再加算しない）
  houseId: Id
  fatherId?: Id
  motherId?: Id
  bloodlineDynastyId?: Id // 血統。法的王朝所属・家名とは別データ
  legalDynasty: LegalDynastyState
}>

export type TitleHolder =
  | Readonly<{ status: 'HELD'; personId: Id }>
  | Readonly<{ status: 'UNDETERMINED'; legalCaseId?: Id }> // 継承未確定（PENDING）

export type TitleRecognition = Readonly<{
  status: 'ACTIVE' | 'PENDING' | 'REVOKED'
  authority?: ControllerRef // ACTIVE では必須（権限を後付けしない: GAME-02）
  sovereignCountryId?: Id
  sourceDecisionId?: Id // ACTIVE では必須
}>

export type Title = Readonly<{
  titleId: Id
  kind: 'TERRITORIAL' | 'CROWN'
  regionId: Id
  holder: TitleHolder
  hereditary: boolean
  valid: boolean
  grantBasisId: Id
  recognition: TitleRecognition
}>

// Office（非世襲の行政職）は Title と別型。MVP 基盤では型境界のみ確保する。
export type Office = Readonly<{
  officeId: Id
  holderPersonId?: Id
  appointedByRef: ControllerRef
}>

export type Dynasty = Readonly<{ dynastyId: Id; name: string }>

export type Marriage = Readonly<{
  marriageId: Id
  personIds: readonly [Id, Id] // ID 昇順
  registeredYear: Year
  status: 'ACTIVE' | 'DISSOLVED'
}>

export type LegalCase = Readonly<{
  caseId: Id
  titleId: Id
  kind: 'SUCCESSION' | 'RECOGNITION' | 'REVOCATION'
  status: 'PENDING' | 'APPROVED' | 'REJECTED'
  candidatePersonIds: readonly Id[]
  reasonCodes: readonly string[]
}>

export type ControlMandate = Readonly<{
  mandateId: Id
  regionId: Id
  controllerRef: ControllerRef
  beneficiaryPersonId: Id
  authorizingTitleId: Id
  sourceEventId: Id
  effectiveFromYear: Year
  endExclusiveYear: Year
}>

export type TaxCollectionMandate = Readonly<{
  mandateId: Id
  regionId: Id
  collectorCountryId: Id
  effectiveFromYear: Year
  endExclusiveYear: Year
  sourceTreatyOrLawId: Id
}>

export type LegalState = Readonly<{
  dynasties: readonly Dynasty[]
  marriages: readonly Marriage[]
  cases: readonly LegalCase[]
  controlMandates: readonly ControlMandate[]
  taxMandates: readonly TaxCollectionMandate[]
}>

export type ResourceKind = 'CASH_MILLI_BU' | 'FORCE_HEADCOUNT'
export type ResourceOperation = 'CREDIT' | 'DEBIT' | 'COMMIT' | 'RELEASE' | 'CASUALTY'

export type ResourceAccount = Readonly<{
  accountId: Id
  kind: ResourceKind
  ownerRef: ResourceOwnerRef
  quantity: number // 非負整数
  committed: number // 0 <= committed <= quantity
  sourceGroupId?: Id
  sourceRegionId?: Id
}>

/** C① が確定する当年の出生・自然死枠。B③ の請求済み数は枠を超えない。 */
export type CohortSlot = Readonly<{
  groupId: Id
  year: Year
  birthSlots: number
  deathSlots: number
  claimedBirths: number
  claimedDeaths: number
}>

export type Demographics = Readonly<{ cohortSlots: readonly CohortSlot[] }>

/** 翌年施行（effectiveFromYear = t+1）の効果。型付き union のみ。汎用更新は持たない。 */
export type DeferredPayload = Readonly<{
  kind: 'SUPPORT_SIGNAL'
  groupId: Id
  houseId: Id
  signal: number
  causeEventId: Id
}>

export type DeferredEffect = Readonly<{
  deferredId: Id
  source: Source
  effectiveFromYear: Year
  payload: DeferredPayload
}>

export type WorldState = Readonly<{
  year: Year
  countries: readonly Country[]
  regions: readonly Region[]
  groups: readonly PopulationGroup[]
  houses: readonly House[]
  persons: readonly Person[]
  titles: readonly Title[]
  legal: LegalState
  resources: readonly ResourceAccount[]
  demographics: Demographics
  deferred: readonly DeferredEffect[]
}>
