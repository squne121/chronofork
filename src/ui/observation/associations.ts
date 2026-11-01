// 観測対象と Event/Trace の関連付け（表示用・読み取り専用）。
// 未採用の「注目対象ピン」構想に向けた技術検証であり、ゲーム仕様・UI 体験の採用ではない。
// ルールの再計算・Event/Trace の生成・ID の自動補完はしない。根拠のない関連は作らず UNVERIFIED に残す。
import type { DecisionTrace, EventLogEntry, Id, StateChange, WorldState, Year } from '../../simulation/contracts/index.ts'

/** 関連付けの対象。PERSON_PAIR は展開済み（両人物へ個別に関連付ける）。 */
export type EntityRef = Readonly<{ kind: 'PERSON' | 'HOUSE' | 'GROUP' | 'COUNTRY' | 'REGION'; id: Id }>

/**
 * 根拠の種類。
 * - DIRECT_REF: Event.involvedRefs に直接含まれる
 * - PAIR_MEMBER: involvedRefs / actorRef の PERSON_PAIR の構成員
 * - ACTOR_REF: DecisionTrace.actorRef
 * - STATE_CHANGE: Event 発生時の確定差分（path/before/after）から読み取れる
 * - SNAPSHOT_CONTEXT: 年初 WorldState の既存関係。年内の発生瞬間は証明しない
 */
export type EvidenceKind = 'DIRECT_REF' | 'PAIR_MEMBER' | 'ACTOR_REF' | 'STATE_CHANGE' | 'SNAPSHOT_CONTEXT'

export type AssociationRole =
  | 'INVOLVED'
  | 'PAIR_MEMBER'
  | 'ACTOR'
  | 'NEWBORN'
  | 'FATHER'
  | 'MOTHER'
  | 'PREVIOUS_HOLDER'
  | 'NEW_HOLDER'
  | 'PARENT_OF_SNAPSHOT_PERSON'
  | 'SPOUSE_IN_SNAPSHOT'
  | 'TITLE_HOLDER_IN_SNAPSHOT'

export type AssociationSource =
  | Readonly<{ type: 'EVENT'; eventId: Id; phase: number }>
  | Readonly<{ type: 'TRACE'; traceId: Id; phase: number }>
  | Readonly<{ type: 'SNAPSHOT'; snapshotYear: Year }>

export type Association = Readonly<{
  target: EntityRef
  role: AssociationRole
  evidence: EvidenceKind
  year: Year
  source: AssociationSource
  /** STATE_CHANGE の根拠となった差分 path。 */
  statePath?: string
  /** TargetRef に称号 kind は無いため、称号 ID は文脈として持つ。 */
  titleId?: Id
  /** SNAPSHOT_CONTEXT の相手側（子→親、配偶者など）。 */
  counterpart?: EntityRef
}>

export type UnverifiedReason =
  | 'EVENT_YEAR_MISMATCH'
  | 'TRACE_YEAR_MISMATCH'
  | 'SNAPSHOT_YEAR_MISMATCH'
  | 'MALFORMED_EVENT'
  | 'MALFORMED_TRACE'
  | 'MALFORMED_STATE_CHANGE'
  | 'FATHER_NOT_EVIDENCED'
  | 'MOTHER_NOT_EVIDENCED'
  | 'PREVIOUS_HOLDER_NOT_EVIDENCED'
  | 'NEW_HOLDER_NOT_EVIDENCED'

export type Unverified = Readonly<{
  reason: UnverifiedReason
  sourceId?: Id
  statePath?: string
  titleId?: Id
}>

export type ObservationInput = Readonly<{
  /** 観測する年。これと異なる年の Event/Trace/snapshot は関連付けず UNVERIFIED に残す。 */
  year: Year
  /** 確定した EventLog のみ。 */
  events?: readonly EventLogEntry[]
  /** 確定した decisionTraces のみ。 */
  traces?: readonly DecisionTrace[]
  /** 年初 WorldState（任意）。 */
  snapshot?: WorldState
  /** 失敗年 RunHalt.traces。確定履歴とは混ぜず diagnostic に分離する。 */
  haltTraces?: readonly DecisionTrace[]
}>

export type ObservationAssociations = Readonly<{
  /** 確定した Event / Trace / 年初 snapshot に基づく関連。決定的に整列済み。 */
  confirmed: readonly Association[]
  /** 失敗年の診断用 Trace に基づく関連。確定履歴ではない。 */
  diagnostic: readonly Association[]
  unverified: readonly Unverified[]
}>

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isId = (v: unknown): v is Id => typeof v === 'string' && v.length > 0
const ENTITY_KINDS: ReadonlySet<string> = new Set(['PERSON', 'HOUSE', 'GROUP', 'COUNTRY', 'REGION'])

/** TargetRef を個別対象へ展開する。不正な形は空配列（推測しない）。 */
function expandRef(ref: unknown): { entities: EntityRef[]; pair: boolean } | undefined {
  if (!isRecord(ref)) return undefined
  if (ref.kind === 'PERSON_PAIR') {
    const ids = ref.ids
    if (!Array.isArray(ids) || ids.length !== 2 || !ids.every(isId)) return undefined
    return { entities: [...new Set(ids as string[])].map((id) => ({ kind: 'PERSON', id })), pair: true }
  }
  if (typeof ref.kind === 'string' && ENTITY_KINDS.has(ref.kind) && isId(ref.id)) {
    return { entities: [{ kind: ref.kind as EntityRef['kind'], id: ref.id }], pair: false }
  }
  return undefined
}

const PERSON_PATH = /^\$\.persons\[([^\]]+)\]$/
const HOLDER_PERSON_PATH = /^\$\.titles\[([^\]]+)\]\.holder\.personId$/
const HOLDER_ANY_PATH = /^\$\.titles\[([^\]]+)\]\.holder(\.|$)/

const hasType = (eventType: unknown, type: string): boolean => typeof eventType === 'string' && eventType.split('+').includes(type)

function fromEvent(e: EventLogEntry, year: Year, out: Association[], un: Unverified[]): void {
  if (!isRecord(e) || !isId(e.eventId) || typeof e.year !== 'number') {
    un.push({ reason: 'MALFORMED_EVENT', ...(isRecord(e) && isId(e.eventId) ? { sourceId: e.eventId } : {}) })
    return
  }
  if (e.year !== year) {
    un.push({ reason: 'EVENT_YEAR_MISMATCH', sourceId: e.eventId })
    return
  }
  const source: AssociationSource = { type: 'EVENT', eventId: e.eventId, phase: e.phase }
  const add = (a: Omit<Association, 'year' | 'source'>) => out.push({ ...a, year, source })

  for (const ref of Array.isArray(e.involvedRefs) ? e.involvedRefs : []) {
    const x = expandRef(ref)
    if (!x) continue
    for (const target of x.entities)
      add(x.pair ? { target, role: 'PAIR_MEMBER', evidence: 'PAIR_MEMBER' } : { target, role: 'INVOLVED', evidence: 'DIRECT_REF' })
  }

  const changes: readonly StateChange[] = Array.isArray(e.stateChanges) ? e.stateChanges : []
  const isBirth = hasType(e.eventType, 'PERSON_BIRTH')
  const isTransfer = hasType(e.eventType, 'LEGAL_TITLE_TRANSFER')
  const touchedTitles = new Set<Id>()
  const previous = new Set<Id>()
  const next = new Set<Id>()

  for (const c of changes) {
    if (!isRecord(c) || typeof c.path !== 'string') {
      un.push({ reason: 'MALFORMED_STATE_CHANGE', sourceId: e.eventId })
      continue
    }
    if (isBirth) {
      const m = PERSON_PATH.exec(c.path)
      // 新規 Person 差分のみ（before=null）。既存人物の変更や id 不一致は出生の根拠にしない。
      if (m && c.before === null && isRecord(c.after) && c.after.personId === m[1]) {
        const childId = m[1] as Id
        add({ target: { kind: 'PERSON', id: childId }, role: 'NEWBORN', evidence: 'STATE_CHANGE', statePath: c.path })
        for (const [field, role, reason] of [
          ['fatherId', 'FATHER', 'FATHER_NOT_EVIDENCED'],
          ['motherId', 'MOTHER', 'MOTHER_NOT_EVIDENCED'],
        ] as const) {
          const pid = c.after[field]
          if (isId(pid)) add({ target: { kind: 'PERSON', id: pid }, role, evidence: 'STATE_CHANGE', statePath: `${c.path}.${field}` })
          else un.push({ reason, sourceId: e.eventId, statePath: c.path })
        }
      }
    }
    if (isTransfer) {
      const any = HOLDER_ANY_PATH.exec(c.path)
      if (any) touchedTitles.add(any[1] as Id)
      const m = HOLDER_PERSON_PATH.exec(c.path)
      if (m) {
        const titleId = m[1] as Id
        if (c.before !== c.after) {
          if (isId(c.before)) {
            previous.add(titleId)
            add({ target: { kind: 'PERSON', id: c.before }, role: 'PREVIOUS_HOLDER', evidence: 'STATE_CHANGE', statePath: c.path, titleId })
          }
          if (isId(c.after)) {
            next.add(titleId)
            add({ target: { kind: 'PERSON', id: c.after }, role: 'NEW_HOLDER', evidence: 'STATE_CHANGE', statePath: c.path, titleId })
          }
        }
      }
    }
  }
  // 称号差分があるのに保持者の前後が読めない場合は、旧/新保持者を推測せず UNVERIFIED。
  for (const titleId of [...touchedTitles].sort()) {
    if (!previous.has(titleId)) un.push({ reason: 'PREVIOUS_HOLDER_NOT_EVIDENCED', sourceId: e.eventId, titleId })
    if (!next.has(titleId)) un.push({ reason: 'NEW_HOLDER_NOT_EVIDENCED', sourceId: e.eventId, titleId })
  }
}

/** actorRef から。eventIds が空の REJECT/DEFER も対象。candidateId は人物 ID と同一視せず無視する。 */
function fromTrace(t: DecisionTrace, year: Year, out: Association[], un: Unverified[]): void {
  if (!isRecord(t) || !isId(t.traceId) || typeof t.year !== 'number') {
    un.push({ reason: 'MALFORMED_TRACE', ...(isRecord(t) && isId(t.traceId) ? { sourceId: t.traceId } : {}) })
    return
  }
  if (t.year !== year) {
    un.push({ reason: 'TRACE_YEAR_MISMATCH', sourceId: t.traceId })
    return
  }
  const x = expandRef(t.actorRef)
  if (!x) {
    un.push({ reason: 'MALFORMED_TRACE', sourceId: t.traceId })
    return
  }
  for (const target of x.entities)
    out.push({
      target,
      role: 'ACTOR',
      evidence: x.pair ? 'PAIR_MEMBER' : 'ACTOR_REF',
      year,
      source: { type: 'TRACE', traceId: t.traceId, phase: t.phase },
    })
}

/** 年初 snapshot の既存関係。Event ではなく、年内のいつ成立したかは主張しない。 */
function fromSnapshot(w: WorldState, out: Association[]): void {
  const source: AssociationSource = { type: 'SNAPSHOT', snapshotYear: w.year }
  const add = (a: Omit<Association, 'year' | 'source' | 'evidence'>) => out.push({ ...a, evidence: 'SNAPSHOT_CONTEXT', year: w.year, source })
  const person = (id: Id): EntityRef => ({ kind: 'PERSON', id })
  for (const p of w.persons ?? []) {
    if (!isRecord(p) || !isId(p.personId)) continue
    const child = person(p.personId)
    if (isId(p.fatherId)) add({ target: person(p.fatherId), role: 'PARENT_OF_SNAPSHOT_PERSON', counterpart: child })
    if (isId(p.motherId)) add({ target: person(p.motherId), role: 'PARENT_OF_SNAPSHOT_PERSON', counterpart: child })
  }
  for (const m of w.legal?.marriages ?? []) {
    if (!isRecord(m) || m.status !== 'ACTIVE' || !Array.isArray(m.personIds) || m.personIds.length !== 2 || !m.personIds.every(isId)) continue
    const [a, b] = m.personIds as [Id, Id]
    if (a === b) continue
    add({ target: person(a), role: 'SPOUSE_IN_SNAPSHOT', counterpart: person(b) })
    add({ target: person(b), role: 'SPOUSE_IN_SNAPSHOT', counterpart: person(a) })
  }
  for (const t of w.titles ?? []) {
    if (!isRecord(t) || !isId(t.titleId) || !isRecord(t.holder) || t.holder.status !== 'HELD' || !isId(t.holder.personId)) continue
    add({ target: person(t.holder.personId), role: 'TITLE_HOLDER_IN_SNAPSHOT', titleId: t.titleId })
  }
}

const cmp = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0)
const srcKey = (s: AssociationSource) => (s.type === 'EVENT' ? `E:${s.eventId}` : s.type === 'TRACE' ? `T:${s.traceId}` : `S:${s.snapshotYear}`)
const assocKey = (a: Association) =>
  [a.target.kind, a.target.id, srcKey(a.source), a.evidence, a.role, a.statePath ?? '', a.titleId ?? '', a.counterpart?.id ?? ''].join('\u0000')

function finalize<T>(items: readonly T[], key: (t: T) => string): T[] {
  const seen = new Map<string, T>()
  for (const i of items) seen.set(key(i), i)
  return [...seen.entries()].sort(([a], [b]) => cmp(a, b)).map(([, v]) => v)
}

/** 入力順に依存しない関連付け。入力は変更しない。 */
export function collectAssociations(input: ObservationInput): ObservationAssociations {
  const confirmed: Association[] = []
  const diagnostic: Association[] = []
  const un: Unverified[] = []
  for (const e of input.events ?? []) fromEvent(e, input.year, confirmed, un)
  for (const t of input.traces ?? []) fromTrace(t, input.year, confirmed, un)
  for (const t of input.haltTraces ?? []) fromTrace(t, input.year, diagnostic, un)
  if (input.snapshot) {
    if (input.snapshot.year === input.year) fromSnapshot(input.snapshot, confirmed)
    else un.push({ reason: 'SNAPSHOT_YEAR_MISMATCH' })
  }
  return {
    confirmed: finalize(confirmed, assocKey),
    diagnostic: finalize(diagnostic, assocKey),
    unverified: finalize(un, (u) => [u.reason, u.sourceId ?? '', u.statePath ?? '', u.titleId ?? ''].join('\u0000')),
  }
}

/** 特定の対象に関する関連だけを取り出す。 */
export function associationsFor(list: readonly Association[], target: EntityRef): Association[] {
  return list.filter((a) => a.target.kind === target.kind && a.target.id === target.id)
}
