// pair.trust の StatModifier 検証・台帳・有効値解決。純粋関数。入力は変更しない。
// 丸め・線形減衰・範囲は CALIBRATION_ONLY の技術選択で、仕様ではない。
// 解決値が婚姻（B-004/B-005）を成立させるロジックはここに無い。
import type {
  Id,
  PairTrustBase,
  PairTrustResolution,
  StatModifier,
  StatModifierIssue,
  StatModifierIssueCode,
  Year,
} from '../contracts/index.ts'
import { GOAL_YEAR, PAIR_TRUST_STAT_KEY, START_YEAR, STAT_MODIFIER_RULE_VERSION } from '../contracts/index.ts'
import { normalizePersonPair, pairKey } from './pair.ts'
import { PAIR_TRUST_DEFINITION, getStatDefinition } from './stat-registry.ts'

/** modifier 台帳。順序に意味を持たせない（解決は modifierId 昇順）。 */
export type StatModifierLedger = readonly StatModifier[]

export type StatModifierContext = Readonly<{
  /** 実在する人物の ID。ここに無い人物へのペアは拒否する。 */
  knownPersonIds: ReadonlySet<Id>
}>

export type Validation = Readonly<{ ok: true }> | Readonly<{ ok: false; issues: readonly StatModifierIssue[] }>

export type AddModifierResult =
  | Readonly<{ ok: true; outcome: 'ADDED' | 'DUPLICATE'; ledger: StatModifierLedger }>
  | Readonly<{ ok: false; issues: readonly StatModifierIssue[] }>

const isInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v)
const isNonEmpty = (v: unknown): v is string => typeof v === 'string' && v !== ''

/** 単体の StatModifier を検証する（台帳内の重複は見ない）。 */
export function validateStatModifier(m: StatModifier, ctx: StatModifierContext): readonly StatModifierIssue[] {
  const out: StatModifierIssue[] = []
  const add = (code: StatModifierIssueCode, path: string, message: string) => out.push({ code, path, message })
  if (typeof m !== 'object' || m === null) {
    add('INVALID_ID', '', 'modifier はオブジェクトが必要です')
    return out
  }

  if (!isNonEmpty(m.modifierId)) add('INVALID_ID', 'modifierId', 'modifierId は空でない文字列が必要です')
  if (!isNonEmpty(m.interventionId)) add('INVALID_ID', 'interventionId', 'interventionId は空でない文字列が必要です')

  const def = getStatDefinition(m.statKey)
  if (def === undefined) add('UNREGISTERED_STAT_KEY', 'statKey', `未登録の statKey です: ${String(m.statKey)}`)

  const t = m.targetRef as { kind?: unknown; ids?: unknown }
  if (t?.kind !== 'PERSON_PAIR') {
    add('INVALID_TARGET_KIND', 'targetRef.kind', `${PAIR_TRUST_STAT_KEY} の対象は PERSON_PAIR のみです`)
  } else {
    const ids = t.ids
    if (!Array.isArray(ids) || ids.length !== 2 || !isNonEmpty(ids[0]) || !isNonEmpty(ids[1])) {
      add('INVALID_PERSON_ID', 'targetRef.ids', '人物 ID は空でない文字列 2 件が必要です')
    } else {
      const [a, b] = ids as [string, string]
      if (a === b) add('SELF_PAIR', 'targetRef.ids', '同一人物同士のペアは指定できません')
      else if (a > b) add('PERSON_PAIR_NOT_NORMALIZED', 'targetRef.ids', 'ids は ID 昇順に正規化します')
      ;[a, b].forEach((id, i) => {
        if (!ctx.knownPersonIds.has(id)) add('UNKNOWN_PERSON', `targetRef.ids[${i}]`, `存在しない人物 ID です: ${id}`)
      })
    }
  }

  if (!isInt(m.signedDelta) || m.signedDelta === 0) {
    add('INVALID_DELTA', 'signedDelta', 'signedDelta は 0 以外の安全な整数が必要です')
  } else if (def !== undefined && Math.abs(m.signedDelta) > def.max - def.min) {
    add('DELTA_OUT_OF_RANGE', 'signedDelta', `signedDelta の絶対値が値域幅 ${def.max - def.min} を超えています（校正値）`)
  }

  if (
    !isInt(m.startYear) || !isInt(m.endExclusiveYear) ||
    m.startYear < START_YEAR || m.endExclusiveYear > GOAL_YEAR || m.startYear >= m.endExclusiveYear
  ) {
    add('INVALID_PERIOD', 'startYear', `期間 [startYear, endExclusiveYear) は ${START_YEAR} <= start < end <= ${GOAL_YEAR} の整数が必要です`)
  }
  if (m.decayPolicy !== 'NONE' && m.decayPolicy !== 'LINEAR') {
    add('INVALID_DECAY_POLICY', 'decayPolicy', 'decayPolicy は NONE か LINEAR です')
  }
  if (m.ruleVersion !== STAT_MODIFIER_RULE_VERSION) {
    add('UNSUPPORTED_RULE_VERSION', 'ruleVersion', `未対応の ruleVersion です（対応: ${STAT_MODIFIER_RULE_VERSION}）。旧版を暗黙に新規則へ当てません`)
  }
  return out
}

const sameModifier = (a: StatModifier, b: StatModifier) => JSON.stringify(canon(a)) === JSON.stringify(canon(b))
const canon = (m: StatModifier) => [
  m.modifierId, m.interventionId, m.targetRef.kind, 'ids' in m.targetRef ? m.targetRef.ids : null,
  m.statKey, m.signedDelta, m.startYear, m.endExclusiveYear, m.decayPolicy, m.ruleVersion,
]

/** 同年・同対象・同 statKey の二重命令キー。startYear が「その年の命令」を表す。 */
const slotKey = (m: StatModifier) =>
  JSON.stringify([m.startYear, m.statKey, 'ids' in m.targetRef ? pairKey(m.targetRef.ids) : null])

/** 検証済み modifier の防御的複製（ネストした ids も複製し凍結）。外部可変参照を断つ。 */
function cloneModifier(m: StatModifier): StatModifier {
  const ref = m.targetRef as Extract<StatModifier['targetRef'], { kind: 'PERSON_PAIR' }>
  return Object.freeze({
    modifierId: m.modifierId,
    interventionId: m.interventionId,
    targetRef: Object.freeze({ kind: 'PERSON_PAIR' as const, ids: Object.freeze([ref.ids[0], ref.ids[1]] as const) }),
    statKey: m.statKey,
    signedDelta: m.signedDelta,
    startYear: m.startYear,
    endExclusiveYear: m.endExclusiveYear,
    decayPolicy: m.decayPolicy,
    ruleVersion: m.ruleVersion,
  })
}

/** 台帳全体の検証（個別検証 + modifierId 重複 + 同年同対象同項目の重複）。 */
export function validateStatModifierLedger(ledger: StatModifierLedger, ctx: StatModifierContext): Validation {
  if (!Array.isArray(ledger)) return { ok: false, issues: [{ code: 'INVALID_ID', path: 'ledger', message: 'ledger は配列が必要です' }] }
  const issues: StatModifierIssue[] = []
  const ids = new Set<Id>()
  const slots = new Set<string>()
  ledger.forEach((m, i) => {
    const own = validateStatModifier(m, ctx)
    for (const x of own) issues.push({ ...x, path: `ledger[${i}].${x.path}` })
    // 個別要素が不正なら重複キーを算出しない（例外を避け、不正要素を重複判定へ混ぜない）。
    if (own.length > 0) return
    if (ids.has(m.modifierId)) issues.push({ code: 'DUPLICATE_MODIFIER_ID', path: `ledger[${i}].modifierId`, message: `modifierId が重複しています: ${m.modifierId}` })
    ids.add(m.modifierId)
    const k = slotKey(m)
    if (slots.has(k)) issues.push({ code: 'DUPLICATE_SAME_YEAR_TARGET_STAT', path: `ledger[${i}]`, message: '同じ年・対象・statKey の modifier が重複しています' })
    slots.add(k)
  })
  return issues.length === 0 ? { ok: true } : { ok: false, issues }
}

/**
 * modifier を台帳へ追加した新しい台帳を返す（元の台帳は変更しない）。
 * - 同一内容の再送（同 modifierId・同内容）は冪等: `DUPLICATE` で台帳不変。
 * - 同 modifierId で内容が異なる → 拒否。同年・同対象・同 statKey の別 modifier → 拒否。
 * - 別年・別対象は重ね掛け可。
 */
export function addStatModifier(ledger: StatModifierLedger, modifier: StatModifier, ctx: StatModifierContext): AddModifierResult {
  // 既存台帳が破損していれば fail-closed（例外にも不正な ADDED にもしない）。
  const existing = validateStatModifierLedger(ledger, ctx)
  if (!existing.ok) return { ok: false, issues: existing.issues }
  const own = validateStatModifier(modifier, ctx)
  if (own.length > 0) return { ok: false, issues: own }
  const kept = ledger.map(cloneModifier)
  const sameId = kept.find((x) => x.modifierId === modifier.modifierId)
  if (sameId !== undefined) {
    if (sameModifier(sameId, modifier)) return { ok: true, outcome: 'DUPLICATE', ledger: Object.freeze(kept) }
    return { ok: false, issues: [{ code: 'DUPLICATE_MODIFIER_ID', path: 'modifierId', message: `同じ modifierId で内容が異なります: ${modifier.modifierId}` }] }
  }
  if (kept.some((x) => slotKey(x) === slotKey(modifier))) {
    return { ok: false, issues: [{ code: 'DUPLICATE_SAME_YEAR_TARGET_STAT', path: 'startYear', message: '同じ年・対象・statKey への命令は既にあります' }] }
  }
  return { ok: true, outcome: 'ADDED', ledger: Object.freeze([...kept, cloneModifier(modifier)]) }
}

/** 基礎値テーブルの検証。ペアは昇順・相異・一意、値は値域内の安全な整数。 */
export function validatePairTrustBase(table: readonly PairTrustBase[], ctx: StatModifierContext): Validation {
  if (!Array.isArray(table)) return { ok: false, issues: [{ code: 'INVALID_BASE_VALUE', path: 'base', message: 'base は配列が必要です' }] }
  const issues: StatModifierIssue[] = []
  const seen = new Set<string>()
  table.forEach((e, i) => {
    const p = `base[${i}]`
    if (typeof e !== 'object' || e === null || !Array.isArray(e.personIds) || e.personIds.length !== 2) {
      issues.push({ code: 'INVALID_PERSON_ID', path: p, message: '基礎値は personIds が厳密に 2 要素の配列である必要があります' })
      return
    }
    const [a, b] = e.personIds
    const norm = normalizePersonPair(a, b)
    if (norm === null) issues.push({ code: a === b ? 'SELF_PAIR' : 'INVALID_PERSON_ID', path: `${p}.personIds`, message: 'ペアは空でない相異な人物 ID 2 件が必要です' })
    else {
      if (norm[0] !== a) issues.push({ code: 'PERSON_PAIR_NOT_NORMALIZED', path: `${p}.personIds`, message: 'personIds は ID 昇順に正規化します' })
      norm.forEach((id) => {
        if (!ctx.knownPersonIds.has(id)) issues.push({ code: 'UNKNOWN_PERSON', path: `${p}.personIds`, message: `存在しない人物 ID です: ${id}` })
      })
      const k = pairKey(norm)
      if (seen.has(k)) issues.push({ code: 'DUPLICATE_BASE_PAIR', path: p, message: '同じペアの基礎値が重複しています（(A,B) と (B,A) は同一）' })
      seen.add(k)
    }
    const { min, max } = PAIR_TRUST_DEFINITION
    if (!isInt(e.value) || e.value < min || e.value > max) {
      issues.push({ code: 'INVALID_BASE_VALUE', path: `${p}.value`, message: `基礎値は ${min}..${max}（校正値）の安全な整数が必要です` })
    }
  })
  return issues.length === 0 ? { ok: true } : { ok: false, issues }
}

/** t 年の寄与。NONE は signedDelta、LINEAR は期間開始年が全量で 1 年ごとに (end-t)/(end-start) へ逓減（校正値）。 */
export function modifierContribution(m: StatModifier, year: Year): number {
  if (year < m.startYear || year >= m.endExclusiveYear) return 0
  if (m.decayPolicy === 'NONE') return m.signedDelta
  return (m.signedDelta * (m.endExclusiveYear - year)) / (m.endExclusiveYear - m.startYear)
}

/** 四捨五入（0.5 は 0 から遠い側）。浮動小数の誤差は 1e-9 で吸収する。 */
export function roundHalfAwayFromZero(x: number): number {
  const snapped = Math.round(x * 1e9) / 1e9
  return Math.sign(snapped) * Math.floor(Math.abs(snapped) + 0.5) || 0 // -0 を 0 へ正規化
}

export type PairTrustViewInput = Readonly<{
  base: readonly PairTrustBase[]
  ledger: StatModifierLedger
  knownPersonIds: ReadonlySet<Id>
}>

export type PairTrustView = Readonly<{
  /** 年初 t（START_YEAR..GOAL_YEAR）の pair.trust を解決する。a と b は任意順。不正入力は null。 */
  resolve(a: Id, b: Id, year: Year): PairTrustResolution | null
}>

/**
 * 基礎値と台帳を一度だけ検証して参照 view を作る。B-009/B-004/B-005 が同じ境界でこれを参照する。
 * 基礎値は不変で、有効値は「base + 有効 modifier の寄与合計」を一度だけ丸め・clamp して決定的に得る。
 */
export function createPairTrustView(input: PairTrustViewInput): Readonly<{ ok: true; view: PairTrustView }> | Readonly<{ ok: false; issues: readonly StatModifierIssue[] }> {
  const ctx = { knownPersonIds: input.knownPersonIds }
  const issues: StatModifierIssue[] = []
  for (const v of [validatePairTrustBase(input.base, ctx), validateStatModifierLedger(input.ledger, ctx)]) {
    if (!v.ok) issues.push(...v.issues)
  }
  if (issues.length > 0) return { ok: false, issues }

  // 検証通過後は複製だけを使い、呼出元の後続変更（modifier / ids / known 集合）から隔離する。
  const knownPersonIds: ReadonlySet<Id> = new Set(input.knownPersonIds)
  const baseByPair = new Map<string, number>(input.base.map((e) => [pairKey(e.personIds), e.value]))
  const sorted = input.ledger.map(cloneModifier).sort((x, y) => (x.modifierId < y.modifierId ? -1 : x.modifierId > y.modifierId ? 1 : 0))
  const { min, max } = PAIR_TRUST_DEFINITION

  const view: PairTrustView = {
    resolve(a, b, year) {
      const ids = normalizePersonPair(a, b)
      if (ids === null || !knownPersonIds.has(ids[0]) || !knownPersonIds.has(ids[1])) return null
      if (!isInt(year) || year < START_YEAR || year > GOAL_YEAR) return null
      const key = pairKey(ids)
      const active = sorted.filter((m) => 'ids' in m.targetRef && pairKey(m.targetRef.ids) === key && m.startYear <= year && year < m.endExclusiveYear)
      const modifierIds = active.map((m) => m.modifierId)
      const base = baseByPair.get(key)
      if (base === undefined) return { status: 'NO_BASE', personIds: ids, year, modifierIds }
      const contributions = active.map((m) => ({ modifierId: m.modifierId, contribution: modifierContribution(m, year) }))
      const rawModifierSum = contributions.reduce((s, c) => s + c.contribution, 0)
      const effective = Math.min(max, Math.max(min, roundHalfAwayFromZero(base + rawModifierSum)))
      return { status: 'RESOLVED', personIds: ids, year, base, rawModifierSum, effective, modifierIds, contributions }
    },
  }
  return { ok: true, view }
}
