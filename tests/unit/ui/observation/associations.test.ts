// 注意: このファイルの Event / Trace / WorldState は全て「synthetic fixture（架空の型付きテスト入力）」。
// 実際の B/A ルール（婚姻・出生・継承）が動作した証拠ではない。実ルールの出力は未実装（RuleRegistry TODO）。
import { describe, expect, it } from 'vitest'
import { createExperimentalScenario } from '../../../../src/scenario/experimental/index.ts'
import type { DecisionTrace, EventLogEntry, StateChange, WorldState } from '../../../../src/simulation/contracts/index.ts'
import { diffWorld } from '../../../../src/simulation/engine/reducer/index.ts'
import { associationsFor, collectAssociations } from '../../../../src/ui/observation/associations.ts'

const Y = 1260
const person = (id: string) => ({ kind: 'PERSON', id }) as const

// ---- synthetic fixture builders ----
const event = (over: Partial<EventLogEntry> & Pick<EventLogEntry, 'eventId' | 'eventType'>): EventLogEntry => ({
  semanticEventKey: `synthetic:${over.eventId}`,
  year: Y,
  phase: 3,
  involvedRefs: [],
  stateChanges: [],
  sourceTraceIds: [],
  ...over,
})
const trace = (over: Partial<DecisionTrace> & Pick<DecisionTrace, 'traceId'>): DecisionTrace => ({
  year: Y,
  phase: 3,
  ruleId: 'B-FIXTURE' as DecisionTrace['ruleId'],
  actorRef: person('p-actor'),
  candidates: [],
  status: 'REJECT',
  reasonCodes: [],
  modifierIds: [],
  eventIds: [],
  ruleVersion: 'synthetic',
  ...over,
})
const birthChange = (childId: string, extra: Record<string, unknown>): StateChange => ({
  path: `$.persons[${childId}]`,
  before: null,
  after: { personId: childId, ...extra } as StateChange['after'],
})
const holderChange = (titleId: string, before: unknown, after: unknown): StateChange => ({
  path: `$.titles[${titleId}].holder.personId`,
  before: before as StateChange['before'],
  after: after as StateChange['after'],
})

const marriage = event({
  eventId: 'ev-marriage',
  eventType: 'MARRIAGE_REGISTER',
  involvedRefs: [{ kind: 'PERSON_PAIR', ids: ['p-a', 'p-b'] }],
})
const birth = event({
  eventId: 'ev-birth',
  eventType: 'PERSON_BIRTH',
  involvedRefs: [person('p-child'), { kind: 'GROUP', id: 'g1' }],
  stateChanges: [birthChange('p-child', { fatherId: 'p-father', motherId: 'p-mother' })],
})
const transfer = event({
  eventId: 'ev-transfer',
  eventType: 'LEGAL_TITLE_TRANSFER',
  involvedRefs: [{ kind: 'REGION', id: 'r1' }, person('p-new')],
  stateChanges: [holderChange('t1', 'p-old', 'p-new')],
})

const roles = (events: EventLogEntry[], target: { kind: 'PERSON'; id: string }, extra = {}) =>
  associationsFor(collectAssociations({ year: Y, events, ...extra }).confirmed, target).map((a) => `${a.role}/${a.evidence}`)

describe('婚姻（PERSON_PAIR）', () => {
  it('両人物にそれぞれ PAIR_MEMBER として関連付き、Event ID を保持する', () => {
    const r = collectAssociations({ year: Y, events: [marriage] })
    for (const id of ['p-a', 'p-b']) {
      const [a, ...rest] = associationsFor(r.confirmed, person(id))
      expect(rest).toEqual([])
      expect(a).toMatchObject({ role: 'PAIR_MEMBER', evidence: 'PAIR_MEMBER', source: { type: 'EVENT', eventId: 'ev-marriage' } })
    }
    expect(associationsFor(r.confirmed, person('p-c'))).toEqual([])
  })
  it('不正な PERSON_PAIR（片側欠落）は推測せず無視する', () => {
    const bad = event({ eventId: 'ev-bad', eventType: 'MARRIAGE_REGISTER', involvedRefs: [{ kind: 'PERSON_PAIR', ids: ['p-a'] } as never] })
    expect(collectAssociations({ year: Y, events: [bad] }).confirmed).toEqual([])
  })
})

describe('出生（PERSON_BIRTH の新規 Person 差分）', () => {
  it('父母を STATE_CHANGE 根拠で関連付ける', () => {
    expect(roles([birth], person('p-father'))).toEqual(['FATHER/STATE_CHANGE'])
    expect(roles([birth], person('p-mother'))).toEqual(['MOTHER/STATE_CHANGE'])
    expect(roles([birth], person('p-child')).sort()).toEqual(['INVOLVED/DIRECT_REF', 'NEWBORN/STATE_CHANGE'])
    const f = associationsFor(collectAssociations({ year: Y, events: [birth] }).confirmed, person('p-father'))[0]
    expect(f?.statePath).toBe('$.persons[p-child].fatherId')
  })
  it('片親しか差分にない場合、欠けた親を推測せず UNVERIFIED', () => {
    const e = event({ ...birth, stateChanges: [birthChange('p-child', { motherId: 'p-mother' })] })
    const r = collectAssociations({ year: Y, events: [e] })
    expect(r.unverified.map((u) => u.reason)).toEqual(['FATHER_NOT_EVIDENCED'])
    expect(r.confirmed.some((a) => a.role === 'FATHER')).toBe(false)
  })
  it('既存人物の変更（before≠null）や personId 不一致は出生の根拠にしない', () => {
    const existing = event({ ...birth, stateChanges: [{ path: '$.persons[p-child].fatherId', before: 'x', after: 'p-father' }] })
    const mismatch = event({ ...birth, eventId: 'ev-mm', stateChanges: [birthChange('p-other', {}) , { ...birthChange('p-child', {}), after: { personId: 'p-zzz', fatherId: 'p-father' } }] })
    expect(roles([existing], person('p-father'))).toEqual([])
    expect(roles([mismatch], person('p-father'))).toEqual([])
  })
  it('eventType が PERSON_BIRTH でない Event の Person 差分からは親子を作らない', () => {
    const e = event({ ...birth, eventType: 'PERSON_DEATH' })
    expect(roles([e], person('p-father'))).toEqual([])
  })
  it('複合 eventType でも PERSON_BIRTH を認識する', () => {
    const e = event({ ...birth, eventType: 'PERSON_BIRTH+POPULATION_COHORT' })
    expect(roles([e], person('p-father'))).toEqual(['FATHER/STATE_CHANGE'])
  })
})

describe('称号移転（LEGAL_TITLE_TRANSFER の状態差分）', () => {
  it('旧保持者・新保持者を称号 ID 付きで関連付ける', () => {
    const r = collectAssociations({ year: Y, events: [transfer] })
    expect(associationsFor(r.confirmed, person('p-old'))).toMatchObject([{ role: 'PREVIOUS_HOLDER', evidence: 'STATE_CHANGE', titleId: 't1', statePath: '$.titles[t1].holder.personId' }])
    expect(associationsFor(r.confirmed, person('p-new')).map((a) => a.role).sort()).toEqual(['INVOLVED', 'NEW_HOLDER'])
    expect(r.unverified).toEqual([])
  })
  it('旧保持者が未確定（before=null）なら推測せず UNVERIFIED', () => {
    const e = event({ ...transfer, stateChanges: [holderChange('t1', null, 'p-new'), { path: '$.titles[t1].holder.status', before: 'UNDETERMINED', after: 'HELD' }] })
    const r = collectAssociations({ year: Y, events: [e] })
    expect(r.confirmed.some((a) => a.role === 'PREVIOUS_HOLDER')).toBe(false)
    expect(r.unverified).toEqual([{ reason: 'PREVIOUS_HOLDER_NOT_EVIDENCED', sourceId: 'ev-transfer', titleId: 't1' }])
  })
  it('新保持者が空（HELD→UNDETERMINED）なら新保持者を作らない', () => {
    const e = event({ ...transfer, involvedRefs: [], stateChanges: [holderChange('t1', 'p-old', null)] })
    const r = collectAssociations({ year: Y, events: [e] })
    expect(r.confirmed.map((a) => a.role)).toEqual(['PREVIOUS_HOLDER'])
    expect(r.unverified.map((u) => u.reason)).toEqual(['NEW_HOLDER_NOT_EVIDENCED'])
  })
  it('personId が数値など不正な差分は無視する', () => {
    const e = event({ ...transfer, involvedRefs: [], stateChanges: [holderChange('t1', 42, { x: 1 })] })
    expect(collectAssociations({ year: Y, events: [e] }).confirmed).toEqual([])
  })
})

describe('DecisionTrace（actorRef）', () => {
  it('eventIds=[] の REJECT/DEFER も actorRef から見つかる', () => {
    const traces = [
      trace({ traceId: 'tr-reject', status: 'REJECT', actorRef: person('p-x') }),
      trace({ traceId: 'tr-defer', status: 'DEFER', actorRef: person('p-x') }),
    ]
    const found = associationsFor(collectAssociations({ year: Y, traces }).confirmed, person('p-x'))
    expect(found.map((a) => (a.source.type === 'TRACE' ? a.source.traceId : ''))).toEqual(['tr-defer', 'tr-reject'])
    expect(found.every((a) => a.role === 'ACTOR' && a.evidence === 'ACTOR_REF')).toBe(true)
  })
  it('candidateId は人物 ID と同一視しない', () => {
    const t = trace({
      traceId: 'tr-c',
      actorRef: person('p-x'),
      candidates: [{ candidateId: 'p-cand', eligible: true, inputs: {}, reasonCodes: [] }],
      selectedCandidateId: 'p-cand',
    })
    const r = collectAssociations({ year: Y, traces: [t] })
    expect(associationsFor(r.confirmed, person('p-cand'))).toEqual([])
    expect(r.confirmed).toHaveLength(1)
  })
  it('actorRef が PERSON_PAIR なら両人物、HOUSE などはそのまま', () => {
    const r = collectAssociations({
      year: Y,
      traces: [trace({ traceId: 'tr-p', actorRef: { kind: 'PERSON_PAIR', ids: ['p-a', 'p-b'] } }), trace({ traceId: 'tr-h', actorRef: { kind: 'HOUSE', id: 'h1' } })],
    })
    expect(associationsFor(r.confirmed, person('p-a'))).toHaveLength(1)
    expect(associationsFor(r.confirmed, person('p-b'))).toHaveLength(1)
    expect(associationsFor(r.confirmed, { kind: 'HOUSE', id: 'h1' })).toHaveLength(1)
  })
  it('失敗年 RunHalt.traces は確定側に混ぜず diagnostic に分離する', () => {
    const halt = trace({ traceId: 'tr-halt', actorRef: person('p-h') })
    const r = collectAssociations({ year: Y, haltTraces: [halt] })
    expect(r.confirmed).toEqual([])
    expect(r.diagnostic).toHaveLength(1)
  })
})

describe('年初 snapshot と Event 差分の区別', () => {
  const snapshot = {
    year: Y,
    persons: [{ personId: 'p-kid', fatherId: 'p-dad', motherId: 'p-mom' }],
    legal: { marriages: [{ marriageId: 'm1', personIds: ['p-dad', 'p-mom'], status: 'ACTIVE' }, { marriageId: 'm0', personIds: ['p-q', 'p-r'], status: 'DISSOLVED' }] },
    titles: [{ titleId: 't9', holder: { status: 'HELD', personId: 'p-dad' } }, { titleId: 't8', holder: { status: 'UNDETERMINED' } }],
  } as unknown as WorldState

  it('SNAPSHOT_CONTEXT として明示し、Event ID を持たない', () => {
    const r = collectAssociations({ year: Y, snapshot })
    const dad = associationsFor(r.confirmed, person('p-dad'))
    expect(dad.map((a) => a.role).sort()).toEqual(['PARENT_OF_SNAPSHOT_PERSON', 'SPOUSE_IN_SNAPSHOT', 'TITLE_HOLDER_IN_SNAPSHOT'])
    expect(dad.every((a) => a.evidence === 'SNAPSHOT_CONTEXT' && a.source.type === 'SNAPSHOT')).toBe(true)
    expect(associationsFor(r.confirmed, person('p-q'))).toEqual([]) // DISSOLVED は関連にしない
    expect(r.confirmed.some((a) => a.titleId === 't8')).toBe(false) // 未確定保持者は推測しない
  })
  it('Event 差分と snapshot は同じ人物でも根拠種類で区別される', () => {
    const r = collectAssociations({ year: Y, snapshot, events: [birth] })
    const evidences = associationsFor(r.confirmed, person('p-father')).map((a) => a.evidence)
    expect(evidences).toEqual(['STATE_CHANGE'])
    expect(associationsFor(r.confirmed, person('p-dad')).every((a) => a.evidence === 'SNAPSHOT_CONTEXT')).toBe(true)
  })
  it('年が異なる snapshot は関連付けず UNVERIFIED', () => {
    const r = collectAssociations({ year: Y + 1, snapshot })
    expect(r.confirmed).toEqual([])
    expect(r.unverified.map((u) => u.reason)).toEqual(['SNAPSHOT_YEAR_MISMATCH'])
  })
})

describe('頑健性', () => {
  it('異なる年の Event/Trace は関連付けず UNVERIFIED', () => {
    const r = collectAssociations({ year: Y, events: [{ ...marriage, year: Y + 1 }], traces: [trace({ traceId: 'tr-old', year: Y - 1 })] })
    expect(r.confirmed).toEqual([])
    expect(r.unverified.map((u) => u.reason).sort()).toEqual(['EVENT_YEAR_MISMATCH', 'TRACE_YEAR_MISMATCH'])
  })
  it('欠落した参照・フィールドで例外を出さない', () => {
    const junk = [{}, { eventId: 'e', year: Y }, { eventId: 'e2', year: Y, eventType: 'PERSON_BIRTH', involvedRefs: [null, { kind: 'X' }], stateChanges: [null, { path: 5 }] }] as unknown as EventLogEntry[]
    const traces = [{}, { traceId: 't', year: Y }, null] as unknown as DecisionTrace[]
    const r = collectAssociations({ year: Y, events: junk, traces })
    expect(r.confirmed).toEqual([])
    expect(r.unverified.length).toBeGreaterThan(0)
  })
  it('入力順に依存しない（結果が同一）', () => {
    const events = [marriage, birth, transfer]
    const traces = [trace({ traceId: 'tr-1' }), trace({ traceId: 'tr-2', actorRef: person('p-old') })]
    const a = collectAssociations({ year: Y, events, traces })
    const b = collectAssociations({ year: Y, events: [...events].reverse(), traces: [...traces].reverse() })
    expect(b).toEqual(a)
  })
  it('入力を変更せず、重複入力は重複関連を作らない', () => {
    const events = [transfer, transfer]
    const frozen = structuredClone(events)
    const r = collectAssociations({ year: Y, events })
    expect(events).toEqual(frozen)
    expect(associationsFor(r.confirmed, person('p-old'))).toHaveLength(1)
  })
  it('参照のない無関係な対象には何も関連付けない', () => {
    const r = collectAssociations({ year: Y, events: [marriage, birth, transfer], traces: [trace({ traceId: 'tr' })] })
    expect(associationsFor(r.confirmed, person('p-nobody'))).toEqual([])
  })
})

describe('実 diffWorld の path 形式との整合（reducer 差分の形式確認。実ルールの動作証拠ではない）', () => {
  const base = createExperimentalScenario().world
  it('称号保持者変更・新規 Person の実 diff 出力から読み取れる', () => {
    const title = base.titles.find((t) => t.holder.status === 'HELD')
    const [p0, p1] = base.persons
    if (!title || title.holder.status !== 'HELD' || !p0 || !p1) throw new Error('fixture 前提が崩れた')
    const oldHolderId = title.holder.personId
    const newHolder = base.persons.find((p) => p.personId !== oldHolderId)!
    const child = { ...p0, personId: 'p-synthetic-child', fatherId: p0.personId, motherId: p1.personId }
    const after: WorldState = {
      ...base,
      persons: [...base.persons, child],
      titles: base.titles.map((t) => (t.titleId === title.titleId ? { ...t, holder: { status: 'HELD', personId: newHolder.personId } } : t)),
    }
    const changes = diffWorld(base, after)
    const e = event({ eventId: 'ev-real-diff-shape', eventType: 'PERSON_BIRTH+LEGAL_TITLE_TRANSFER', stateChanges: changes })
    const r = collectAssociations({ year: Y, events: [e] })
    const has = (role: string, id: string) => r.confirmed.some((a) => a.role === role && a.target.id === id)
    expect(has('FATHER', p0.personId)).toBe(true)
    expect(has('MOTHER', p1.personId)).toBe(true)
    expect(has('PREVIOUS_HOLDER', oldHolderId)).toBe(true)
    expect(has('NEW_HOLDER', newHolder.personId)).toBe(true)
  })
  it('同年比較: WorldState 同士は diffWorld で path 単位に差分表示できるが、異年 Event の対応付けは行わない', () => {
    const other: WorldState = { ...base, persons: base.persons.map((p, i) => (i === 0 ? { ...p, alive: false } : p)) }
    const changes = diffWorld(base, other)
    expect(changes.map((c) => c.path)).toEqual([`$.persons[${base.persons[0]!.personId}].alive`])
  })
})
