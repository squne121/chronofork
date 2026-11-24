// 実A0の全期間（1250〜1350）から作る、人物ごとの観測履歴と、称号の喪失記録。
// WorldState・Event・DecisionTraceの確定記録だけを集約する読み取り専用の関数で、規則・係数・原因は新設しない。
// 「選択年初の状態」(FamilyTree等) とは別に、この世界線の観測期間内で何があったかを引くための索引。
import type { DecisionTrace, EventLogEntry, Id, Person, WorldState } from '../../simulation/contracts/index.ts'
import type { TitleHoldingHistory } from './title-history.ts'

export type MarriageRecord = Readonly<{
  marriageId: Id
  partnerId: Id
  registeredYear: number
  dissolvedYear?: number
  status: 'ACTIVE' | 'DISSOLVED'
}>

export type JudgmentRule = 'B-004' | 'B-005' | 'B-002' | 'B-001'
export type JudgmentStatus = 'ACCEPT' | 'DEFER' | 'REJECT'

/** 連続する年の同じ内容の判断を1つにまとめた記録。traceIdは先頭・末尾のDecisionTrace。 */
export type JudgmentSpan = Readonly<{
  ruleId: JudgmentRule
  status: JudgmentStatus
  fromYear: number
  toYear: number
  /** まとめた判断（Trace）の件数。 */
  count: number
  partnerId?: Id
  /** B-002: 判断対象となった子の候補ID（ACCEPTのときは実際に出生した人物）。 */
  childId?: Id
  reasonCodes: readonly string[]
  knownKinship?: string
  trustMin?: number
  trustMax?: number
  threshold?: number
  motherAge?: number
  fatherAge?: number
  firstTraceId: Id
  lastTraceId: Id
}>

export type TitleHoldRecord = Readonly<{
  titleId: Id
  label: string
  fromYear: number
  throughYear: number
  life: 'ALIVE' | 'DEAD' | 'UNKNOWN'
}>

type BirthEvidence =
  | Readonly<{ kind: 'BIRTH_EVENT'; eventId: Id; year: number }>
  | Readonly<{ kind: 'MARRIAGE_REGISTRATION'; eventId: Id; year: number;
    birthBacking: NonNullable<EventLogEntry['supportingMarriageRegistrations']>[number]['registration']['birthBacking'] }>
  | Readonly<{ kind: 'BEFORE_OBSERVATION' | 'UNCONFIRMED' }>

export type PersonRecord = Readonly<{
  personId: Id
  name: string
  sex: 'MALE' | 'FEMALE'
  birthYear: number
  deathYear?: number
  houseId: Id
  originGroupId: Id
  supporting: boolean
  /** この人物が年初WorldStateに初めて現れる年（出生年の翌年初になることがある）。 */
  firstYear: number
  fatherId?: Id
  motherId?: Id
  marriages: readonly MarriageRecord[]
  childIds: readonly Id[]
  /** 個人の出生と、人口内訳からの個別化は別の記録。 */
  birthEvidence: BirthEvidence
  deathEventId?: Id
  titles: readonly TitleHoldRecord[]
  judgments: readonly JudgmentSpan[]
}>

export type TitleLossRecord = Readonly<{
  titleId: Id
  label: string
  /** 保持者が確認できなくなった最初の年初。 */
  lostFromYear: number
  lastHolderId: Id
  lastHolderLife: 'ALIVE' | 'DEAD' | 'UNKNOWN'
  lastHolderDeathYear?: number
  heldFromYear: number
  /** 保持者の変更を確定したEvent（確認できた場合のみ）。 */
  transferEventId?: Id
  transferYear?: number
}>

type Obj = Readonly<Record<string, unknown>>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const num = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined)
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)

type SpanAcc = { key: string; span: { -readonly [K in keyof JudgmentSpan]: JudgmentSpan[K] } }

function addSpan(map: Map<Id, SpanAcc[]>, personId: Id, key: string, make: () => JudgmentSpan, year: number,
  traceId: Id, patch?: (s: SpanAcc['span']) => void): void {
  const list = map.get(personId) ?? []
  if (!map.has(personId)) map.set(personId, list)
  const last = list.findLast(a => a.key === key)
  if (last && year - last.span.toYear <= 1 && year >= last.span.toYear) {
    last.span.toYear = year
    last.span.count++
    last.span.lastTraceId = traceId
    patch?.(last.span)
    return
  }
  const span = { ...make() }
  patch?.(span)
  list.push({ key, span })
}

function otherOf(ids: readonly unknown[], self: Id): Id | undefined {
  const o = ids.find(i => typeof i === 'string' && i !== self)
  return typeof o === 'string' ? o : undefined
}

/** B-001の個別の探索者を読む。人口集団自体の判断・人物昇格は婚姻候補の供給ではない。 */
function supplySeeker(t: DecisionTrace): Id | undefined {
  if (t.actorRef.kind === 'PERSON' && t.status === 'DEFER' && t.reasonCodes.includes('SUPPORTING_SUPPLY_DEFERRED')) {
    const self = t.actorRef.id
    return t.candidates.some(c => c.inputs.seekerPersonId === self) ? self : undefined
  }
  if (t.actorRef.kind !== 'GROUP' || t.status !== 'ACCEPT' ||
    !t.reasonCodes.includes('SUPPORTING_CANDIDATE_ONLY') || !t.reasonCodes.includes('NOT_MARRIAGE_APPROVAL')) return undefined
  const candidate = t.candidates.find(c => c.candidateId === t.selectedCandidateId && c.eligible)
  const inputs = candidate?.inputs
  if (!inputs || inputs.candidateGroupId !== t.actorRef.id || inputs.candidateYear !== t.year ||
    typeof inputs.supportingCandidateId !== 'string' || inputs.supportingCandidateId === inputs.seekerPersonId) return undefined
  return str(inputs.seekerPersonId)
}

function judgmentSpans(traces: readonly DecisionTrace[]): Map<Id, SpanAcc[]> {
  const map = new Map<Id, SpanAcc[]>()
  const seenSupply = new Set<Id>()
  for (const t of traces) {
    if (t.ruleId !== 'B-004' && t.ruleId !== 'B-005' && t.ruleId !== 'B-002' && t.ruleId !== 'B-001') continue
    if (t.status !== 'ACCEPT' && t.status !== 'DEFER' && t.status !== 'REJECT') continue
    if (t.ruleId === 'B-001') {
      const self = supplySeeker(t)
      if (self === undefined || seenSupply.has(t.traceId)) continue
      seenSupply.add(t.traceId)
      // 提示は一候補ずつ元の記録を開けるようにし、保留だけを従来どおり期間で集約する。
      const key = t.status === 'ACCEPT' ? `B-001#${t.traceId}` : ['B-001', t.status, t.reasonCodes.join('|')].join('#')
      addSpan(map, self, key, () => ({
        ruleId: 'B-001', status: t.status as JudgmentStatus, fromYear: t.year, toYear: t.year, count: 1,
        reasonCodes: [...t.reasonCodes], firstTraceId: t.traceId, lastTraceId: t.traceId,
      }), t.year, t.traceId)
      continue
    }
    const cd = t.candidates[0]
    const inputs: Obj = cd && isObj(cd.inputs) ? cd.inputs : {}
    let ids: readonly Id[] = []
    if (t.ruleId === 'B-002') {
      const parents = Array.isArray(inputs.personIds) ? inputs.personIds.filter((i): i is string => typeof i === 'string') : []
      ids = parents
    } else if (t.actorRef.kind === 'PERSON_PAIR') ids = t.actorRef.ids
    if (ids.length !== 2) continue
    const childId = t.ruleId === 'B-002' ? str(inputs.childPersonId) : undefined
    const trust = num(inputs.trustWeight)
    for (const self of ids) {
      const partnerId = otherOf(ids, self)
      const codes = [...t.reasonCodes]
      const key = [t.ruleId, t.status, partnerId ?? '', codes.join('|'), str(inputs.knownKinship) ?? '',
        t.ruleId === 'B-002' && t.status === 'ACCEPT' ? childId ?? '' : ''].join('#')
      addSpan(map, self, key, () => ({
        ruleId: t.ruleId as JudgmentRule, status: t.status as JudgmentStatus,
        fromYear: t.year, toYear: t.year, count: 1,
        ...(partnerId === undefined ? {} : { partnerId }),
        ...(childId === undefined ? {} : { childId }),
        reasonCodes: codes,
        ...(str(inputs.knownKinship) === undefined ? {} : { knownKinship: str(inputs.knownKinship)! }),
        ...(num(inputs.acceptThreshold) === undefined ? {} : { threshold: num(inputs.acceptThreshold)! }),
        firstTraceId: t.traceId, lastTraceId: t.traceId,
      }), t.year, t.traceId, s => {
        if (trust !== undefined) {
          s.trustMin = Math.min(s.trustMin ?? trust, trust)
          s.trustMax = Math.max(s.trustMax ?? trust, trust)
        }
        const m = num(inputs.motherAge), f = num(inputs.fatherAge)
        if (m !== undefined) s.motherAge = m
        if (f !== undefined) s.fatherAge = f
      })
    }
  }
  return map
}

/** 全snapshot・全EventLog・全DecisionTraceを一度だけ走査して人物履歴を作る。 */
export function buildPersonRecords(
  snapshots: readonly WorldState[], eventLog: readonly EventLogEntry[], traces: readonly DecisionTrace[],
  titleHistories: readonly TitleHoldingHistory[],
): readonly PersonRecord[] {
  const latest = new Map<Id, Person>()
  const marriages = new Map<Id, WorldState['legal']['marriages'][number]>()
  const firstYear = new Map<Id, number>()
  const ordered = [...snapshots].sort((a, b) => a.year - b.year)
  const observationStart = ordered[0]?.year
  for (const w of ordered) {
    for (const p of w.persons) {
      latest.set(p.personId, p)
      if (!firstYear.has(p.personId)) firstYear.set(p.personId, w.year)
    }
    for (const m of w.legal.marriages) marriages.set(m.marriageId, m)
  }
  const birthEvent = new Map<Id, BirthEvidence>()
  const registrations = new Map<Id, BirthEvidence>()
  const deathEvent = new Map<Id, Id>()
  for (const e of eventLog) {
    const types = e.eventType.split('+')
    const registeredHere = new Set<Id>()
    if (types.includes('MARRIAGE_REGISTER')) {
      for (const { registration } of e.supportingMarriageRegistrations ?? []) {
        const id = registration.person.personId
        registeredHere.add(id)
        if (!registrations.has(id)) registrations.set(id, {
          kind: 'MARRIAGE_REGISTRATION', eventId: e.eventId, year: e.year, birthBacking: registration.birthBacking,
        })
      }
    }
    if (types.includes('PERSON_BIRTH')) {
      for (const c of e.stateChanges) {
        if (c.before !== null || !isObj(c.after) || c.after.birthYear !== e.year) continue
        const id = str(c.after.personId)
        if (id !== undefined && c.path === `$.persons[${id}]` && !registeredHere.has(id) && !birthEvent.has(id)) {
          birthEvent.set(id, { kind: 'BIRTH_EVENT', eventId: e.eventId, year: e.year })
        }
      }
    }
    if (types.includes('PERSON_DEATH')) {
      for (const r of e.involvedRefs) if (r.kind === 'PERSON' && !deathEvent.has(r.id)) deathEvent.set(r.id, e.eventId)
    }
  }
  const marriagesOf = new Map<Id, MarriageRecord[]>()
  for (const m of [...marriages.values()].sort((a, b) => a.registeredYear - b.registeredYear)) {
    const [a, b] = m.personIds
    for (const [self, partner] of [[a, b], [b, a]] as const) {
      const list = marriagesOf.get(self) ?? []
      list.push({ marriageId: m.marriageId, partnerId: partner, registeredYear: m.registeredYear,
        ...(m.dissolvedYear === undefined ? {} : { dissolvedYear: m.dissolvedYear }), status: m.status })
      marriagesOf.set(self, list)
    }
  }
  const children = new Map<Id, Id[]>()
  for (const p of [...latest.values()].sort((a, b) => a.birthYear - b.birthYear || a.personId.localeCompare(b.personId))) {
    for (const parent of new Set([p.fatherId, p.motherId])) {
      if (parent === undefined) continue
      const list = children.get(parent) ?? []
      list.push(p.personId)
      children.set(parent, list)
    }
  }
  const titlesOf = new Map<Id, TitleHoldRecord[]>()
  for (const h of titleHistories) {
    for (const i of h.intervals) {
      if (i.holder.status !== 'HELD') continue
      const list = titlesOf.get(i.holder.personId) ?? []
      list.push({ titleId: h.titleId, label: h.label, fromYear: i.fromYear, throughYear: i.throughYear, life: i.holder.life })
      titlesOf.set(i.holder.personId, list)
    }
  }
  const spans = judgmentSpans(traces)
  return [...latest.values()].sort((a, b) => a.birthYear - b.birthYear || a.personId.localeCompare(b.personId)).map(p => ({
    personId: p.personId, name: p.name, sex: p.sex, birthYear: p.birthYear,
    ...(p.deathYear === undefined ? {} : { deathYear: p.deathYear }),
    houseId: p.houseId, originGroupId: p.originGroupId, supporting: p.interactionRole === 'SUPPORTING', firstYear: firstYear.get(p.personId) ?? p.birthYear,
    ...(p.fatherId === undefined ? {} : { fatherId: p.fatherId }),
    ...(p.motherId === undefined ? {} : { motherId: p.motherId }),
    marriages: marriagesOf.get(p.personId) ?? [],
    childIds: children.get(p.personId) ?? [],
    birthEvidence: birthEvent.get(p.personId) ?? registrations.get(p.personId) ?? {
      kind: observationStart !== undefined && firstYear.get(p.personId) === observationStart && p.birthYear < observationStart
        ? 'BEFORE_OBSERVATION' : 'UNCONFIRMED',
    },
    ...(deathEvent.has(p.personId) ? { deathEventId: deathEvent.get(p.personId)! } : {}),
    titles: (titlesOf.get(p.personId) ?? []).sort((a, b) => a.fromYear - b.fromYear || a.titleId.localeCompare(b.titleId)),
    judgments: (spans.get(p.personId) ?? []).map(a => a.span).sort((a, b) => a.fromYear - b.fromYear || a.ruleId.localeCompare(b.ruleId)),
  }))
}

/**
 * 1350年初に保持者を確認できない称号について、最後に保持者を失った記録を実履歴から引く。
 * 特定の年・人物・称号を固定せず、Title保持者の年初履歴と確定したTitle移転Eventだけを使う。
 * 「喪失の原因」は示さない（原因は該当年のEvent・DecisionTraceで確認する）。
 */
export function buildTitleLossRecords(histories: readonly TitleHoldingHistory[], persons: readonly PersonRecord[] = []): readonly TitleLossRecord[] {
  const deathOf = new Map(persons.map(x => [x.personId, x.deathYear]))
  const out: TitleLossRecord[] = []
  for (const h of histories) {
    const iv = h.intervals
    const final = iv.at(-1)
    if (!final || final.holder.status === 'HELD') continue
    let j = -1
    for (let k = iv.length - 2; k >= 0; k--) if (iv[k]!.holder.status === 'HELD') { j = k; break }
    if (j < 0) continue
    const held = iv[j]!
    if (held.holder.status !== 'HELD') continue
    const lostFromYear = iv[j + 1]!.fromYear
    const lastId = held.holder.personId
    const transfer = [...h.transfers].reverse().find(t => t.year < lostFromYear && t.year >= held.fromYear &&
      t.beforeHolderId === lastId && t.afterHolderId !== lastId)
    out.push({
      titleId: h.titleId, label: h.label, lostFromYear,
      lastHolderId: held.holder.personId, lastHolderLife: held.holder.life,
      ...((deathOf.get(held.holder.personId) ?? held.holder.deathYear) === undefined ? {} : { lastHolderDeathYear: (deathOf.get(held.holder.personId) ?? held.holder.deathYear)! }),
      heldFromYear: held.fromYear,
      ...(transfer ? { transferEventId: transfer.eventId, transferYear: transfer.year } : {}),
    })
  }
  return out.sort((a, b) => a.titleId.localeCompare(b.titleId))
}
