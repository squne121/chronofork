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

/** B-009が保持する現在の人物ペア信頼基礎値。StatModifierは含まない（CALIBRATION_ONLY）。 */
export type PersonPairTrust = Readonly<{
  personIds: readonly [Id, Id]
  value: number
  lastUpdatedYear: Year
}>

export type Person = Readonly<{
  personId: Id
  name: string
  /** 重要人物以外でも婚姻/出生/親族を法的に追跡できる。省略は従来互換のKEY。 */
  interactionRole?: 'KEY' | 'SUPPORTING'
  sex: 'MALE' | 'FEMALE'
  birthYear: Year
  /** 初めてB-009の位相に登録済みとなる年。必要時評価モデルだけが保持する。 */
  firstPairTrustYear?: Year
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

/**
 * 婚姻契約の明示条項。子の法的王朝帰属を契約が明示する場合のみ表現する（GAME-01）。
 * 父系・母系などの既定規則は持たない。条項が無ければ子の帰属は A が証拠なしに決めず UNDETERMINED。
 */
export type ChildLegalDynastyClause = Readonly<{
  clauseId: Id
  kind: 'CHILD_LEGAL_DYNASTY'
  dynastyId: Id
}>

/**
 * DEC-190: v4契約案の子の家門。PATERNAL_DEFAULTは家門条項なし（父の家門）、MATERNALは母の家門を指定する明示条項。
 */
export type NextgenContractChildHouse =
  | Readonly<{ basis: 'PATERNAL_DEFAULT'; houseId: Id }>
  | Readonly<{ basis: 'MATERNAL_CONTRACT_CLAUSE'; houseId: Id; sourcePersonId: Id }>

/**
 * DEC-190: v4契約案の構造化された同一性。王朝条項（null は王朝条項なし）と子の家門の選択を別々に持つ。
 * 契約案の比較はこの構造で行い、文字列キーの分割・連結で案を同一視しない。
 */
export type NextgenContractIdentity = Readonly<{ dynastyId: Id | null; childHouse: NextgenContractChildHouse }>

/**
 * v4契約の選択記録の版。旧v4（家門条項内の合意記録・連結キー、および記録キーを持たない選択記録版1）とは別版で、同一視しない。
 * 版2から、契約は選択記録と独立した正規記録キー（selectionRecordKey）を併せ持つ。
 */
export const NEXTGEN_CONTRACT_SELECTION_VERSION = 'dec190-nextgen-contract-selection-2' as const

/**
 * DEC-190: A-LEG-01 が登録時に B-005 の当年 Trace と照合して確定した双方合意の内容。
 * 出生時はこの記録から A が発行する契約を再構成し、保存済みの契約と一致する場合だけ用いる
 * （当年の交渉を現在の得点で再計算しない）。後付け・改変・他婚姻からの流用を検出するための記録で、暗号署名ではない。
 */
export type ChildHouseAgreementRecord = Readonly<{
  registeredYear: Year
  personIds: readonly [Id, Id] // ID 昇順
  /** A-LEG-01 が照合した B-005 ACCEPT の TraceID。 */
  sourceTraceId: Id
  firstConsentScore: number
  secondConsentScore: number
  consentThreshold: number
}>

/**
 * DEC-190: v4構成でAが発行した契約の、条項から独立した版付き選択記録。父方案・母方案の双方に付く。
 * 条項の削除・後付けがあっても選んだ案と合意の根拠が契約に残る。旧構成（v0〜v3）の契約は持たない。
 */
export type NextgenContractSelection = Readonly<{
  version: typeof NEXTGEN_CONTRACT_SELECTION_VERSION
  identity: NextgenContractIdentity
  agreement: ChildHouseAgreementRecord
}>

/**
 * DEC-190: 出生児の家門所属を父方原則の例外として母方家門へ置く明示条項。法的王朝・出身人口集団とは独立。
 * MVPでは婚姻当事者である母（sourcePersonId）の実在する家門だけを指定できる。無条項は父方。
 * 合意の根拠は契約の選択記録（NextgenContractSelection）にあり、記録の無い条項は解決しない。
 */
export type ChildHouseAffiliationClause = Readonly<{
  clauseId: Id
  kind: 'CHILD_HOUSE_AFFILIATION'
  houseId: Id
  sourcePersonId: Id
}>

export type MarriageClause = ChildLegalDynastyClause | ChildHouseAffiliationClause

/** 契約の証拠。evidenceId は A が適法性を確認した根拠（契約書・決定）の ID。 */
export type MarriageContract = Readonly<{
  contractId: Id
  evidenceId: Id
  clauses: readonly MarriageClause[]
  /** DEC-190 v4構成の契約だけが持つ版付き選択記録。省略は旧構成の契約。 */
  selection?: NextgenContractSelection
  /**
   * DEC-190 v4構成の契約だけが持つ、選択記録とは独立した版付きの正規記録キー（登録時の選択記録の正規形）。
   * 選択記録・記録キーの一方だけの欠落・改変を、記録間の決定的な内容比較で検出する（暗号署名ではない）。
   * 両方の省略は旧構成の契約。
   */
  selectionRecordKey?: string
}>

export type Marriage = Readonly<{
  marriageId: Id
  personIds: readonly [Id, Id] // ID 昇順
  registeredYear: Year
  status: 'ACTIVE' | 'DISSOLVED'
  /** 配偶者死亡により婚姻が終了した年。旧DISSOLVED状態では省略を許可。 */
  dissolvedYear?: Year
  /** 未設定は「契約条項なし／証拠なし」であり、帰属を推定しない（子の帰属は UNDETERMINED のまま）。 */
  contract?: MarriageContract
  /** 成立時に消費した人口出典。再開後も個別禁親の証拠に流用しない。 */
  supportingPopulationEvidenceIds?: readonly Id[]
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

/** C004確定後に個別出生B002へ割り当てなかった出生数の年次履歴。生存証明ではない。 */
export type AnonymousBirthRecord = Readonly<{
  groupId: Id
  year: Year
  anonymousBirths: number
}>
export type Demographics = Readonly<{
  cohortSlots: readonly CohortSlot[]
  /** 古いWorldStateでは省略可能。個人や成人生存を推定する根拠にしてはならない。 */
  anonymousBirthHistory?: readonly AnonymousBirthRecord[]
}>

/** 翌年施行（effectiveFromYear = source.year + 1 のみ）の効果。型付き union のみ。汎用更新は持たない。 */
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
  /** B-009年次確定の関係値。省略時は旧WorldStateと互換（旧試験では未計算）。 */
  pairTrust?: readonly PersonPairTrust[]
  /** DEC-179定数ドリフトモデル。省略は旧方式。保存再開時の係数混同を拒否する。 */
  pairTrustDrift?: 0 | 1
  /** 必要時評価の規則版・校正・明示初期値の照合キー。 */
  pairTrustModelKey?: string
  /** 年次runnerが確定した連続評価の最終年度。年初ではyear - 1。 */
  pairTrustThroughYear?: Year
  titles: readonly Title[]
  legal: LegalState
  resources: readonly ResourceAccount[]
  demographics: Demographics
  deferred: readonly DeferredEffect[]
}>
