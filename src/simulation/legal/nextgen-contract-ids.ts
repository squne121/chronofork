// DEC-058/190: A-LEG-01が当年の合意から発行する婚姻契約のIDと条項の正規形。
// 旧構成（v0〜v3）は文字列キー（NO_CLAUSE / CHILD_DYNASTY:<id>）を不変のまま使う。
// DEC-190 v4は構造化された契約案の同一性（NextgenContractIdentity）を版付きの非交差タグ＋JSON配列で符号化し、
// 父方案・母方案の双方の契約に条項から独立した選択記録を保存する。IDを解析して契約の種類を推定しない。
import { canonicalize } from '../engine/reducer/canonical.ts'
import type {
  Id, MarriageClause, MarriageContract, NextgenContractChildHouse, NextgenContractIdentity, NextgenContractSelection, Year,
} from '../contracts/index.ts'

/** 旧構成（v0〜v3）の契約案キー。王朝条項なしはNO_CLAUSE。v4の案には使わない。 */
export const nextgenContractKey = (dynastyId: Id | null): string =>
  dynastyId === null ? 'NO_CLAUSE' : 'CHILD_DYNASTY:' + dynastyId

/** v4の正規キーの版付きタグ。旧キー（NO_CLAUSE / CHILD_DYNASTY:）のどちらの接頭辞とも交差しない。 */
const IDENTITY_KEY_TAG = 'DEC190_CONTRACT_IDENTITY_1:'

const present = (v: unknown): v is string => typeof v === 'string' && v.length > 0
const plain = (v: unknown): v is Readonly<Record<string, unknown>> =>
  v !== null && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype
const exactKeys = (o: Readonly<Record<string, unknown>>, keys: readonly string[]) =>
  Object.keys(o).length === keys.length && keys.every((k) => Object.hasOwn(o, k))

/**
 * 未知の値（Trace・保存記録）を厳密に検査して契約案の同一性を返す。余分・欠落フィールド、空ID、未知のbasisはnull。
 * 返す値は新しいオブジェクトで、フィールド順に依存しない比較に使う。
 */
export function nextgenContractIdentityOf(v: unknown): NextgenContractIdentity | null {
  if (!plain(v) || !exactKeys(v, ['dynastyId', 'childHouse'])) return null
  const d = v.dynastyId, h = v.childHouse
  if (d !== null && !present(d)) return null
  if (!plain(h)) return null
  if (h.basis === 'PATERNAL_DEFAULT' && exactKeys(h, ['basis', 'houseId']) && present(h.houseId)) {
    return { dynastyId: d, childHouse: { basis: 'PATERNAL_DEFAULT', houseId: h.houseId } }
  }
  if (h.basis === 'MATERNAL_CONTRACT_CLAUSE' && exactKeys(h, ['basis', 'houseId', 'sourcePersonId']) &&
      present(h.houseId) && present(h.sourcePersonId)) {
    return { dynastyId: d, childHouse: { basis: 'MATERNAL_CONTRACT_CLAUSE', houseId: h.houseId, sourcePersonId: h.sourcePersonId } }
  }
  return null
}

const identityTuple = (x: NextgenContractIdentity): readonly [Id | null, string, Id, Id | null] =>
  [x.dynastyId, x.childHouse.basis, x.childHouse.houseId,
    x.childHouse.basis === 'MATERNAL_CONTRACT_CLAUSE' ? x.childHouse.sourcePersonId : null]

/** v4契約案の正規キー。構造の全成分をJSON配列で符号化するため、異なる案は異なるキーになる（区切り文字の連結はしない）。 */
export const nextgenContractIdentityKey = (x: NextgenContractIdentity): string =>
  IDENTITY_KEY_TAG + JSON.stringify(identityTuple(x))

/** 正規キーの逆変換。再符号化が完全一致する場合だけ同一性を返す（旧キー・非正規表記・任意文字列はnull）。 */
export function parseNextgenContractIdentityKey(key: string): NextgenContractIdentity | null {
  if (!key.startsWith(IDENTITY_KEY_TAG)) return null
  let t: unknown
  try { t = JSON.parse(key.slice(IDENTITY_KEY_TAG.length)) } catch { return null }
  if (!Array.isArray(t) || t.length !== 4) return null
  const [dynastyId, basis, houseId, sourcePersonId] = t as unknown[]
  const childHouse = basis === 'MATERNAL_CONTRACT_CLAUSE' ? { basis, houseId, sourcePersonId }
    : sourcePersonId === null ? { basis, houseId } : null
  const x = nextgenContractIdentityOf({ dynastyId, childHouse })
  return x !== null && nextgenContractIdentityKey(x) === key ? x : null
}

/** 2つの値が同じ正規の契約案か（いずれも厳密な形であることを要する）。フィールド順・文字列連結に依存しない。 */
export function sameNextgenContractIdentity(a: unknown, b: unknown): boolean {
  const x = nextgenContractIdentityOf(a), y = nextgenContractIdentityOf(b)
  if (x === null || y === null) return false
  const p = identityTuple(x), q = identityTuple(y)
  return p.every((v, i) => v === q[i])
}

/** 正規の子の家門選択どうしの比較。 */
export const sameNextgenChildHouse = (a: unknown, b: NextgenContractChildHouse): boolean =>
  sameNextgenContractIdentity({ dynastyId: null, childHouse: a }, { dynastyId: null, childHouse: b })

/** 旧構成（v0〜v3）の契約。ID・条項・JSONは従来と同一。 */
export function nextgenMarriageContract(
  year: Year, pair: readonly [Id, Id], contractKey: string, dynastyId: Id | null, sourceTraceId: Id,
): MarriageContract {
  const key = JSON.stringify([year, pair, contractKey])
  const clauses: MarriageClause[] = dynastyId === null ? [] : [{
    clauseId: 'clause:nextgen:' + key, kind: 'CHILD_LEGAL_DYNASTY', dynastyId,
  }]
  return { contractId: 'contract:nextgen:' + key, evidenceId: 'evidence:nextgen-agreement:' + sourceTraceId, clauses }
}

/** v4の選択記録の正規記録キーの版付きタグ。契約ID・契約案キーの接頭辞とは別。 */
const SELECTION_RECORD_KEY_TAG = 'DEC190_SELECTION_RECORD_1:'

/**
 * v4の選択記録の正規記録キー。選択記録の全成分（版・同一性・当事者・年・Trace・双方得点・閾値）の正規形で、
 * 契約に選択記録と独立に保存し、一方だけの欠落・改変を内容比較で検出する。暗号署名ではない。
 */
export const nextgenSelectionRecordKey = (selection: NextgenContractSelection): string =>
  SELECTION_RECORD_KEY_TAG + canonicalize(selection)

/**
 * v4の契約。選択記録だけから契約ID・証拠ID・全条項・正規記録キーを決定的に再構成する。
 * 登録時（A・reducer）と出生時に同じ式で保存済み契約と比較し、条項の削除・後付け・改変・流用を検出する。
 */
export function nextgenSelectionContract(selection: NextgenContractSelection): MarriageContract {
  const { identity, agreement } = selection
  const key = JSON.stringify([agreement.registeredYear, agreement.personIds, nextgenContractIdentityKey(identity)])
  const clauses: MarriageClause[] = identity.dynastyId === null ? [] : [{
    clauseId: 'clause:nextgen:' + key, kind: 'CHILD_LEGAL_DYNASTY', dynastyId: identity.dynastyId,
  }]
  const h = identity.childHouse
  if (h.basis === 'MATERNAL_CONTRACT_CLAUSE') {
    clauses.push({ clauseId: 'clause:nextgen-house:' + key, kind: 'CHILD_HOUSE_AFFILIATION', houseId: h.houseId, sourcePersonId: h.sourcePersonId })
  }
  const recorded: NextgenContractSelection = {
    version: selection.version,
    identity: { dynastyId: identity.dynastyId, childHouse: { ...h } },
    agreement: {
      registeredYear: agreement.registeredYear, personIds: [agreement.personIds[0], agreement.personIds[1]],
      sourceTraceId: agreement.sourceTraceId, firstConsentScore: agreement.firstConsentScore,
      secondConsentScore: agreement.secondConsentScore, consentThreshold: agreement.consentThreshold,
    },
  }
  return {
    contractId: 'contract:nextgen:' + key, evidenceId: 'evidence:nextgen-agreement:' + agreement.sourceTraceId, clauses,
    selection: recorded, selectionRecordKey: nextgenSelectionRecordKey(recorded),
  }
}
