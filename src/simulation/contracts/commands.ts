// 判別可能な DomainCommand と書込 owner（契約 §2.1/§3）。
// 任意 fieldPath を書き換える Command は存在しない。新しい書込は union に型付きで追加する。
import type {
  ControllerRef,
  Domain,
  Id,
  Source,
  Year,
} from './primitives.ts'
import type { DecisionTraceDraft } from './trace.ts'
import type { RuleId } from './rule-ids.ts'
import type {
  ControlMandate,
  DeferredEffect,
  LegalCase,
  LegalDynastyState,
  Marriage,
  Person,
  PersonPairTrust,
  ResourceOperation,
  SupportDistribution,
  TaxCollectionMandate,
  TitleHolder,
  TitleRecognition,
} from './world.ts'

type CommandBase = Readonly<{
  commandId: Id // 冪等性キー
  source: Source
  batchId?: Id // 同一意味操作の全件事前検証 → 全件コミット
}>

type CommandOf<T extends string, P> = CommandBase & Readonly<{ type: T }> & Readonly<P>

export type MarriageRegisterCommand = CommandOf<'MARRIAGE_REGISTER', { marriage: Marriage }>
/** B-003の確定死亡を根拠にA-LEG-01のみが婚姻を解消する。 */
export type MarriageDissolveCommand = CommandOf<'MARRIAGE_DISSOLVE', {
  marriageId: Id; deceasedPersonId: Id; dissolvedYear: Year; cause: 'SPOUSE_DEATH'
}>
export type LegalDynastySetCommand = CommandOf<
  'LEGAL_DYNASTY_SET',
  { personId: Id; legalDynasty: LegalDynastyState }
>
export type LegalTitleTransferCommand = CommandOf<
  'LEGAL_TITLE_TRANSFER',
  { titleId: Id; toHolder: TitleHolder; legalCaseId?: Id }
>
export type TitleRecognitionSetCommand = CommandOf<
  'TITLE_RECOGNITION_SET',
  { titleId: Id; recognition: TitleRecognition }
>
export type LegalCaseSetCommand = CommandOf<'LEGAL_CASE_SET', { legalCase: LegalCase }>
export type ControlMandateSetCommand = CommandOf<
  'CONTROL_MANDATE_SET',
  { mandate: ControlMandate }
>
export type TaxMandateSetCommand = CommandOf<'TAX_MANDATE_SET', { mandate: TaxCollectionMandate }>
export type PersonBirthCommand = CommandOf<
  'PERSON_BIRTH',
  { person: Person; cohortGroupId: Id; cohortYear: Year }
>
/** B-001: 既存人口集団の年齢コホート・人物身元証拠で匿名住民を記名Personへ昇格。 */
export type PersonPromotionCommand = CommandOf<'PERSON_PROMOTE', {
  person: Person; cohortId: Id; cohortBirthYear: Year;
  cohortSize: number; memberOrdinal: number; identityEvidenceId: Id
}>
/** B-009だけが更新できる人物ペアの累積信頼基礎値。介入修正値は含めない。 */
export type PersonPairTrustSetCommand = CommandOf<'PERSON_PAIR_TRUST_SET', { relation: PersonPairTrust }>
export type PersonDeathCommand = CommandOf<
  'PERSON_DEATH',
  { personId: Id; deathYear: Year; cause: 'NATURAL' | 'BATTLE'; casualtyId?: Id }
>
export type PopulationCohortCommand = CommandOf<
  'POPULATION_COHORT',
  { groupId: Id; year: Year; birthSlots: number; deathSlots: number }
>
export type PopulationCasualtyCommand = CommandOf<
  'POPULATION_CASUALTY',
  { casualtyId: Id; groupId: Id; count: number; namedPersonIds: readonly Id[] }
>
export type SupportSetCommand = CommandOf<
  'SUPPORT_SET',
  { groupId: Id; support: SupportDistribution; causeEventIds: readonly Id[] }
>
export type ResourceTransactionCommand = CommandOf<
  'RESOURCE_TRANSACTION',
  { accountId: Id; operation: ResourceOperation; amount: number; casualtyId?: Id }
>
export type RegionControlSetCommand = CommandOf<
  'REGION_CONTROL_SET',
  { regionId: Id; deFactoControllerRef: ControllerRef; sovereignCountryId?: Id }
>

/** 条約が追加する A/D の法的・主権 Delta を一体で確定する（入れ子の TREATY_COMMIT は不可）。 */
export type TreatyDeltaCommand =
  | RegionControlSetCommand
  | TaxMandateSetCommand
  | ControlMandateSetCommand
  | TitleRecognitionSetCommand
export type TreatyCommitCommand = CommandOf<
  'TREATY_COMMIT',
  { treatyId: Id; deltas: readonly TreatyDeltaCommand[] }
>

export type DomainCommand =
  | MarriageRegisterCommand
  | MarriageDissolveCommand
  | LegalDynastySetCommand
  | LegalTitleTransferCommand
  | TitleRecognitionSetCommand
  | LegalCaseSetCommand
  | ControlMandateSetCommand
  | TaxMandateSetCommand
  | PersonBirthCommand
  | PersonPromotionCommand
  | PersonPairTrustSetCommand
  | PersonDeathCommand
  | PopulationCohortCommand
  | PopulationCasualtyCommand
  | SupportSetCommand
  | ResourceTransactionCommand
  | RegionControlSetCommand
  | TreatyCommitCommand

export type CommandType = DomainCommand['type']

export type WriteOwner =
  | 'A_LEGAL' // A の検証済み command を共通 reducer が適用
  | 'B_PERSON'
  | 'D_MILITARY_DIPLOMACY'
  | 'COMMON_DEATH_REDUCER'
  | 'COMMON_POPULATION_REDUCER'
  | 'RESOURCE_LEDGER_REDUCER'

/** 契約 §2.1 の唯一の確定者。reducer は owner/発行ドメインが合わない command を拒否する。 */
export const COMMAND_WRITE_OWNER: Readonly<Record<CommandType, WriteOwner>> = {
  MARRIAGE_REGISTER: 'A_LEGAL',
  MARRIAGE_DISSOLVE: 'A_LEGAL',
  LEGAL_DYNASTY_SET: 'A_LEGAL',
  LEGAL_TITLE_TRANSFER: 'A_LEGAL',
  TITLE_RECOGNITION_SET: 'A_LEGAL',
  LEGAL_CASE_SET: 'A_LEGAL',
  CONTROL_MANDATE_SET: 'A_LEGAL',
  // 徴税権の法的確定は A（権原）＋D（支配事実）。ResourceLedger は確定済み mandate を参照して
  // 現金取引（RESOURCE_TRANSACTION）を行うのみで、mandate 自体の書込 owner ではない（契約 §2.1/§5）。
  TAX_MANDATE_SET: 'A_LEGAL',
  PERSON_BIRTH: 'B_PERSON',
  PERSON_PROMOTE: 'B_PERSON',
  PERSON_PAIR_TRUST_SET: 'B_PERSON',
  PERSON_DEATH: 'COMMON_DEATH_REDUCER',
  POPULATION_COHORT: 'COMMON_POPULATION_REDUCER',
  POPULATION_CASUALTY: 'COMMON_POPULATION_REDUCER',
  SUPPORT_SET: 'COMMON_POPULATION_REDUCER',
  RESOURCE_TRANSACTION: 'RESOURCE_LEDGER_REDUCER',
  REGION_CONTROL_SET: 'D_MILITARY_DIPLOMACY',
  TREATY_COMMIT: 'D_MILITARY_DIPLOMACY', // A の適法性審査後の A/D 一括 Delta
}

// --- 領域間要求・応答（照会 → 応答 → 適用。同年の上流フェーズを再実行しない）---

export type RequestKind =
  | 'LEGAL_MARRIAGE_QUERY'
  | 'LEGAL_DYNASTY_QUERY'
  | 'TREATY_LEGALITY_QUERY'
  | 'COHORT_SLOT_CLAIM'
  | 'FORCE_COMMIT_REQUEST'
  | 'CASUALTY_NOTICE'

export type RequestPayload =
  | Readonly<{ kind: 'LEGAL_MARRIAGE_QUERY'; personIds: readonly [Id, Id] }>
  | Readonly<{ kind: 'LEGAL_DYNASTY_QUERY'; childPersonId: Id; evidenceMarriageId?: Id }>
  | Readonly<{ kind: 'TREATY_LEGALITY_QUERY'; treatyId: Id; deltas: readonly TreatyDeltaCommand[] }>
  | Readonly<{ kind: 'COHORT_SLOT_CLAIM'; groupId: Id; year: Year; births: number; deaths: number }>
  | Readonly<{ kind: 'FORCE_COMMIT_REQUEST'; accountId: Id; amount: number }>
  | Readonly<{ kind: 'CASUALTY_NOTICE'; casualtyId: Id; groupId: Id; count: number }>

type RequestBase = Readonly<{
  source: Source
  targetDomain: Domain
  requiredResponseYear: Year
}>

/** kind と payload.kind は型レベルで一致する（不一致の組合せはコンパイル時に拒否）。 */
export type CrossDomainRequest = {
  [K in RequestKind]: RequestBase &
    Readonly<{ kind: K; payload: Extract<RequestPayload, { kind: K }> }>
}[RequestKind]

export type ResponsePayload =
  | Readonly<{ kind: 'LEGAL_DYNASTY'; legalDynasty: LegalDynastyState }>
  | Readonly<{ kind: 'REQUIRES_RECOGNITION'; titleId: Id }>

export type CrossDomainResponse = Readonly<{
  requestId: Id
  status: 'ACCEPT' | 'REJECT' | 'DEFER'
  reasonCodes: readonly string[]
  payload?: ResponsePayload
}>

export type RuleOutcome = Readonly<{
  ruleId: RuleId
  phase: Source['phase']
  commands: readonly DomainCommand[]
  requests: readonly CrossDomainRequest[]
  deferred: readonly DeferredEffect[] // 翌年施行 (effectiveFromYear = t+1)
  /** 同年の型付き照会に対する応答。A-LEG-01のLEGAL_MARRIAGE_QUERYだけが初期実装で利用。 */
  responses?: readonly CrossDomainResponse[]
  traceDrafts: readonly DecisionTraceDraft[]
}>
