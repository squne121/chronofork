// DEC-190: 出生児の家門所属（houseId）を父方原則と婚姻契約の明示的な母方例外から決める。
// 法的王朝（CHILD_LEGAL_DYNASTY）・実親子・出身人口集団（originGroupId）とは独立に扱い、相互に代用しない。
// 例外は婚姻当事者である母の実在家門で、父の家門と異なり同じ国家管轄にある場合だけ。不正・不足は保留し、父方へ暗黙にfallbackしない。
import type {
  ChildHouseAffiliationClause, DecisionTrace, Id, Marriage, MarriageContract, Person, WorldState, Year,
} from '../contracts/index.ts'
import { NEXTGEN_CONTRACT_SELECTION_VERSION } from '../contracts/index.ts'
import { canonicalize } from '../engine/reducer/canonical.ts'
import {
  nextgenContractIdentityKey, nextgenContractIdentityOf, nextgenSelectionContract, nextgenSelectionRecordKey,
  sameNextgenChildHouse, sameNextgenContractIdentity,
} from './nextgen-contract-ids.ts'

/**
 * 1: 母方家門条項に登録時の双方合意の記録を保存し、出生時に契約全体との結合を照合する。
 * 2: 正規の契約IDが母方案を示すのに家門条項が無い契約を父方原則とせず保留する。
 * 3: 正規IDの母方案判定を現存する王朝条項の実dynastyIdに結び付ける。
 * 4: 契約案を構造化同一性（王朝案・家門選択・出典）で識別し、v4の父方案・母方案の双方に条項から独立した
 *    版付き選択記録を保存する。A/Bの照合は同一性・選択肢・得点の完全一致で行い、IDの文字列解析をしない。
 *    旧版（1〜3）の家門条項内の合意記録・連結キーの証跡とは別版。
 * 5: 契約に選択記録と独立した版付きの正規記録キー（selectionRecordKey）を保存し、選択記録・記録キーの一方だけの
 *    欠落・改変（父方案の記録削除による旧契約化、合意得点・閾値・年・当事者・同一性・出典の単独改変）を保留・拒否する。
 *    選択記録版1（記録キーなし）の旧v4契約はparseで版不一致として拒否する。
 */
export const CHILD_HOUSE_AFFILIATION_VERSION = 'dec190-child-house-affiliation-5'

export type ChildHouseResolution =
  | Readonly<{ status: 'RESOLVED'; houseId: Id; basis: 'PATERNAL_DEFAULT'; clauseId: null }>
  | Readonly<{ status: 'RESOLVED'; houseId: Id; basis: 'MATERNAL_CONTRACT_CLAUSE'; clauseId: Id }>
  | Readonly<{ status: 'UNRESOLVED'; reasonCode: string }>

const present = (v: unknown): v is string => typeof v === 'string' && v.length > 0

export const childHouseClauses = (contract: MarriageContract | undefined): readonly ChildHouseAffiliationClause[] =>
  contract?.clauses.filter((c): c is ChildHouseAffiliationClause => c.kind === 'CHILD_HOUSE_AFFILIATION') ?? []

/**
 * 子の家門を契約から決める婚姻か（v4の選択記録・正規記録キーのいずれかがある、または家門条項がある）。reducer の出生照合に使う。
 * いずれも無い旧構成の契約・任意IDの契約は、IDを解析せず従来どおり（評価器の判断）とする。
 * 選択記録と記録キーの両方を同時に消去した契約は旧契約と区別できない（記録間の比較の範囲外）。
 */
export const childHouseGovernedByContract = (contract: MarriageContract | undefined): boolean =>
  contract?.selection !== undefined || contract?.selectionRecordKey !== undefined || childHouseClauses(contract).length > 0

/**
 * 当事者の現在の記録に照らした家門条項の適格性。婚姻登録時と出生時に同じ基準で使う。
 * 父方と同じ家門の重複案、第三者・未知の家門、当事者以外・父を出典とする条項、管轄外の家門は不適格。
 */
export function childHouseClauseIssue(
  world: WorldState, parties: readonly [Person, Person],
  clause: Pick<ChildHouseAffiliationClause, 'clauseId' | 'houseId' | 'sourcePersonId'>,
): string | null {
  if (!present(clause.clauseId) || !present(clause.houseId) || !present(clause.sourcePersonId)) return 'CHILD_HOUSE_CLAUSE_ID_MISSING'
  const mother = parties.find((p) => p.sex === 'FEMALE')
  const father = parties.find((p) => p.sex === 'MALE')
  if (!mother || !father) return 'CHILD_HOUSE_PARENT_ROLE_MISMATCH'
  if (clause.sourcePersonId !== mother.personId) return 'CHILD_HOUSE_SOURCE_NOT_MOTHER'
  if (clause.houseId !== mother.houseId) return 'CHILD_HOUSE_NOT_MATERNAL_HOUSE'
  if (clause.houseId === father.houseId) return 'CHILD_HOUSE_CLAUSE_REDUNDANT_PATERNAL'
  const house = world.houses.find((h) => h.houseId === clause.houseId)
  const paternal = world.houses.find((h) => h.houseId === father.houseId)
  if (!house || !paternal) return 'CHILD_HOUSE_UNKNOWN'
  if (!present(house.countryId) || house.countryId !== paternal.countryId) return 'CHILD_HOUSE_JURISDICTION_MISMATCH'
  return null
}

/**
 * 契約全体の家門条項の適格性。0件は父方原則のため妥当（v4の母方案の欠落は合意記録の結合で検出）、
 * 2件以上は優先順位を自動決定せず不適格。v4の母方案は選択記録の家門も同じ基準で検査する。
 */
export function childHouseContractIssue(
  world: WorldState, parties: readonly [Person, Person], contract: MarriageContract | undefined,
): string | null {
  const clauses = childHouseClauses(contract)
  if (clauses.length > 1) return 'AMBIGUOUS_CHILD_HOUSE_CLAUSES'
  if (clauses.length === 1) {
    const issue = childHouseClauseIssue(world, parties, clauses[0]!)
    if (issue) return issue
  }
  const h = nextgenContractIdentityOf(contract?.selection?.identity)?.childHouse
  return h?.basis === 'MATERNAL_CONTRACT_CLAUSE'
    ? childHouseClauseIssue(world, parties, { clauseId: 'selection', houseId: h.houseId, sourcePersonId: h.sourcePersonId })
    : null
}

/**
 * 選択記録と契約全体の結合。登録時（A・reducer）と出生時に WorldState だけで同じ照合を行う。
 * 記録の版・形が正しく、選択記録と独立に保存した正規記録キーと一致し、当事者・年が婚姻と一致し、双方の得点が閾値以上で、記録から再構成した A の発行契約
 * （契約ID・証拠ID・全条項・記録）が保存済み契約と完全に一致する場合だけ妥当。
 * 選択記録の無い家門条項・記録キー、記録キーの無い選択記録、母方案の家門条項の欠落、父方案への後付け、条項・記録の改変、別契約・別ペア・別年の流用は不一致。
 */
export function childHouseAgreementIssue(
  marriage: Pick<Marriage, 'registeredYear' | 'personIds'>, contract: MarriageContract | undefined,
): string | null {
  if (!contract) return null
  const clauses = childHouseClauses(contract)
  const s = contract.selection, recordKey = contract.selectionRecordKey
  if (s === undefined) return clauses.length === 0 && recordKey === undefined ? null : 'CHILD_HOUSE_SELECTION_MISSING'
  if (s === null || typeof s !== 'object' || s.version !== NEXTGEN_CONTRACT_SELECTION_VERSION) return 'CHILD_HOUSE_SELECTION_VERSION_MISMATCH'
  // 選択記録と独立に保存した正規記録キーとの内容比較。記録の単独改変・記録キーの単独欠落/改変を、改変後の記録からの再構成で通さない。
  if (!present(recordKey)) return 'CHILD_HOUSE_SELECTION_RECORD_KEY_MISSING'
  if (recordKey !== nextgenSelectionRecordKey(s)) return 'CHILD_HOUSE_SELECTION_RECORD_KEY_MISMATCH'
  const identity = nextgenContractIdentityOf(s.identity)
  if (identity === null) return 'CHILD_HOUSE_SELECTION_INVALID'
  const a = s.agreement
  if (a === null || typeof a !== 'object') return 'CHILD_HOUSE_AGREEMENT_MISSING'
  if (a.registeredYear !== marriage.registeredYear || !Array.isArray(a.personIds) || a.personIds.length !== 2 ||
      a.personIds[0] !== marriage.personIds[0] || a.personIds[1] !== marriage.personIds[1]) {
    return 'CHILD_HOUSE_AGREEMENT_MARRIAGE_MISMATCH'
  }
  const scores = [a.firstConsentScore, a.secondConsentScore, a.consentThreshold]
  if (!scores.every(Number.isSafeInteger) || a.firstConsentScore < a.consentThreshold || a.secondConsentScore < a.consentThreshold) {
    return 'CHILD_HOUSE_AGREEMENT_CONSENT_MISSING'
  }
  if (!present(a.sourceTraceId)) return 'CHILD_HOUSE_AGREEMENT_MISSING'
  if (clauses.length > 1) return 'AMBIGUOUS_CHILD_HOUSE_CLAUSES'
  if (identity.childHouse.basis === 'MATERNAL_CONTRACT_CLAUSE') {
    if (clauses.length === 0) return 'CHILD_HOUSE_CLAUSE_MISSING'
  } else if (clauses.length > 0) return 'CHILD_HOUSE_CLAUSE_NOT_SELECTED'
  const issued = nextgenSelectionContract({ version: s.version, identity, agreement: a })
  return canonicalize(issued) === canonicalize(contract) ? null : 'CHILD_HOUSE_AGREEMENT_CONTRACT_MISMATCH'
}

const sameSortedPair = (a: readonly unknown[], b: readonly Id[]): boolean => {
  if (a.length !== 2 || !a.every(present)) return false
  const x = [...a].sort(), y = [...b].sort()
  return x[0] === y[0] && x[1] === y[1]
}

type RecordedOption = Readonly<{
  key: string; identity: NonNullable<ReturnType<typeof nextgenContractIdentityOf>>
  firstConsentScore: number; secondConsentScore: number; mutuallyAccepted: boolean; minimumUtility: number
}>
/** B-005 Traceの選択肢を厳密に読む。キーは自身の構造化同一性の正規キーでなければならない（同じキー・異なる案を拒否）。 */
function recordedOption(o: unknown): RecordedOption | null {
  if (o === null || typeof o !== 'object' || Array.isArray(o)) return null
  const r = o as Readonly<Record<string, unknown>>
  const keys = ['key', 'dynastyId', 'firstConsentScore', 'secondConsentScore', 'mutuallyAccepted', 'minimumUtility', 'childHouse']
  if (Object.keys(r).length !== keys.length || !keys.every((k) => Object.hasOwn(r, k))) return null
  const identity = nextgenContractIdentityOf({ dynastyId: r.dynastyId, childHouse: r.childHouse })
  const f = r.firstConsentScore, g = r.secondConsentScore, m = r.minimumUtility
  if (identity === null || typeof r.key !== 'string' || r.key !== nextgenContractIdentityKey(identity) ||
      !Number.isSafeInteger(f) || !Number.isSafeInteger(g) || typeof r.mutuallyAccepted !== 'boolean' ||
      m !== Math.min(f as number, g as number)) return null
  return { key: r.key, identity, firstConsentScore: f as number, secondConsentScore: g as number,
    mutuallyAccepted: r.mutuallyAccepted, minimumUtility: m as number }
}

/**
 * A-LEG-01 の登録時審査。当事者の適格性・選択記録の結合に加え、記録が指す当年の B-005 ACCEPT Trace の
 * 選択案の構造化同一性・選択肢・双方の得点が記録と完全に一致し、その案が双方同意の一意な最大であることを確認する。
 * キーだけを合意の証拠にしない。手動の候補・承認記録だけではv4契約を登録しない。旧構成の契約（記録・家門条項なし）は対象外。
 */
export function childHouseRegistrationIssue(
  world: WorldState, year: Year, pair: readonly [Id, Id], parties: readonly [Person, Person],
  contract: MarriageContract | undefined, priorTraces: readonly DecisionTrace[],
): string | null {
  if (!childHouseGovernedByContract(contract)) return null
  const issue = childHouseContractIssue(world, parties, contract) ?? childHouseAgreementIssue({ registeredYear: year, personIds: pair }, contract)
  if (issue) return issue
  const s = contract!.selection!, a = s.agreement
  const identity = nextgenContractIdentityOf(s.identity)!
  const key = nextgenContractIdentityKey(identity)
  const traces = priorTraces.filter((t) => t.traceId === a.sourceTraceId)
  const t = traces.length === 1 ? traces[0]! : undefined
  if (!t || t.ruleId !== 'B-005' || t.year !== year || t.phase !== 3 || t.status !== 'ACCEPT' ||
      t.actorRef.kind !== 'PERSON_PAIR' || !sameSortedPair(t.actorRef.ids, pair) ||
      t.candidates.length !== 1 || t.selectedCandidateId !== t.candidates[0]!.candidateId) {
    return 'CHILD_HOUSE_AGREEMENT_TRACE_MISSING'
  }
  const inputs = t.candidates[0]!.inputs
  if (inputs.selectedContractKey !== key || !sameNextgenContractIdentity(inputs.selectedContractIdentity, identity) ||
      !sameNextgenChildHouse(inputs.selectedChildHouse, identity.childHouse) || !Array.isArray(inputs.contractOptions)) {
    return 'CHILD_HOUSE_AGREEMENT_TRACE_MISMATCH'
  }
  const options = inputs.contractOptions.map(recordedOption)
  if (options.some((o) => o === null)) return 'CHILD_HOUSE_AGREEMENT_TRACE_MISMATCH'
  const valid = options as RecordedOption[]
  // 正規キーは同一性の単射符号化。重複した案・閾値と矛盾する同意記録は改変された記録とみなす。
  if (new Set(valid.map((o) => o.key)).size !== valid.length || valid.some((o) =>
    o.mutuallyAccepted !== (o.firstConsentScore >= a.consentThreshold && o.secondConsentScore >= a.consentThreshold))) {
    return 'CHILD_HOUSE_AGREEMENT_TRACE_MISMATCH'
  }
  const chosen = valid.filter((o) => sameNextgenContractIdentity(o.identity, identity))
  if (chosen.length !== 1) return 'CHILD_HOUSE_AGREEMENT_TRACE_MISMATCH'
  const c = chosen[0]!
  if (!c.mutuallyAccepted || c.firstConsentScore !== a.firstConsentScore || c.secondConsentScore !== a.secondConsentScore ||
      valid.some((o) => o !== c && o.mutuallyAccepted && o.minimumUtility >= c.minimumUtility)) {
    return 'CHILD_HOUSE_AGREEMENT_TRACE_MISMATCH'
  }
  return null
}

/**
 * 登録済みで有効な父母の婚姻から出生児の家門を決める。呼出側が当年の婚姻（ACTIVE・登録年）を確認済みであること。
 * 選択記録・家門条項の無い旧契約は父の実在家門。v4契約は選択記録と契約全体が結合していることを要し（母方案の条項欠落を含む）、不足・不正はUNRESOLVED。
 */
export function resolveChildHouseAffiliation(
  world: WorldState, father: Person, mother: Person, marriage: Marriage,
): ChildHouseResolution {
  if (father.sex !== 'MALE' || mother.sex !== 'FEMALE' ||
      !marriage.personIds.includes(father.personId) || !marriage.personIds.includes(mother.personId)) {
    return { status: 'UNRESOLVED', reasonCode: 'CHILD_HOUSE_PARENT_ROLE_MISMATCH' }
  }
  if (!childHouseGovernedByContract(marriage.contract)) {
    return world.houses.some((h) => h.houseId === father.houseId)
      ? { status: 'RESOLVED', houseId: father.houseId, basis: 'PATERNAL_DEFAULT', clauseId: null }
      : { status: 'UNRESOLVED', reasonCode: 'PATERNAL_HOUSE_UNKNOWN' }
  }
  const contract = marriage.contract!
  if (!present(contract.contractId) || !present(contract.evidenceId)) return { status: 'UNRESOLVED', reasonCode: 'MARRIAGE_CONTRACT_EVIDENCE_MISSING' }
  const issue = childHouseContractIssue(world, [father, mother], contract) ?? childHouseAgreementIssue(marriage, contract)
  if (issue) return { status: 'UNRESOLVED', reasonCode: issue }
  const clause = childHouseClauses(contract)[0]
  if (clause === undefined) {
    // v4の父方案: 選択記録は父方原則。出生時の父の実在家門を用いる（従来の父方原則と同じ）。
    return world.houses.some((h) => h.houseId === father.houseId)
      ? { status: 'RESOLVED', houseId: father.houseId, basis: 'PATERNAL_DEFAULT', clauseId: null }
      : { status: 'UNRESOLVED', reasonCode: 'PATERNAL_HOUSE_UNKNOWN' }
  }
  return { status: 'RESOLVED', houseId: clause.houseId, basis: 'MATERNAL_CONTRACT_CLAUSE', clauseId: clause.clauseId }
}
