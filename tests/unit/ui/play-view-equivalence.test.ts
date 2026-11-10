// P2-②: toDisplayView最適化前の実装(参照実装)と、新実装の出力が構造・順序・参照共有まで一致することを確認する。
// 参照実装は最適化前のsrc/ui/play-view.tsを逐語で保持している(JSON比較・Set/Mapの不動点計算を含む)。
import { describe, expect, it } from 'vitest'
import type { DecisionTrace, EventLogEntry } from '../../../src/simulation/contracts/index.ts'
import type { TimelineResult } from '../../../src/simulation/engine/index.ts'
import type { DisplayOmission, PlayComparison, PlayView } from '../../../src/ui/branch-play-source.ts'
import type { TimelineRun } from '../../../src/ui/timeline-source.ts'
import { jsonSame, toDisplayView } from '../../../src/ui/play-view.ts'

const LEGACY_EVENT_TYPE='PERSON_PAIR_TRUST_SET'
const LEGACY_RULE='B-009'
const legacyJson=JSON.stringify

/** A0/A1の同一内容は同じオブジェクトとして共有する(構造化複製で一度だけ複製される)。 */
function legacyShared<T>(a0:readonly T[],a1:readonly T[],key:(x:T)=>string):readonly T[]{
  const byKey=new Map(a0.map(x=>[key(x),x] as const))
  return a1.map(x=>{const o=byKey.get(key(x));return o!==undefined&&legacyJson(o)===legacyJson(x)?o:x})
}

export function legacyToDisplayView(c:PlayComparison):PlayView{
  const r0=c.a0.result,r1=c.a1.result
  const ev0=new Map(r0.eventLog.map(e=>[e.eventId,e])),ev1=new Map(r1.eventLog.map(e=>[e.eventId,e]))
  const tr0=new Map(r0.decisionTraces.map(t=>[t.traceId,t])),tr1=new Map(r1.decisionTraces.map(t=>[t.traceId,t]))
  const sameEvent=(id:string)=>{const a=ev0.get(id),b=ev1.get(id);return a!==undefined&&b!==undefined&&legacyJson(a)===legacyJson(b)}
  const sameTrace=(id:string)=>{const a=tr0.get(id),b=tr1.get(id);return a!==undefined&&b!==undefined&&legacyJson(a)===legacyJson(b)}
  // 候補: 両枝で同一の信頼更新Eventと B-009 Trace。その上で相互参照が閉じる集合だけを省略する。
  const candEvents=new Set(r0.eventLog.filter(e=>e.eventType===LEGACY_EVENT_TYPE&&sameEvent(e.eventId)).map(e=>e.eventId))
  const candTraces=new Set(r0.decisionTraces.filter(t=>t.ruleId===LEGACY_RULE&&sameTrace(t.traceId)).map(t=>t.traceId))
  // 省略を確定する前に、A0側・A1側の両方で「残るものの参照先が残る」ことを不動点まで確認し、崩れる省略は取り消す。
  const keepE=new Set<string>(),keepT=new Set<string>()
  let omitTraces=new Set<string>(),omitEvents=new Set<string>()
  for(let round=0;round<20;round++){
    const events1=new Set(r0.eventLog.filter(e=>candEvents.has(e.eventId)&&!keepE.has(e.eventId)&&
      e.sourceTraceIds.every(id=>candTraces.has(id)&&!keepT.has(id))).map(e=>e.eventId))
    omitTraces=new Set(r0.decisionTraces.filter(t=>candTraces.has(t.traceId)&&!keepT.has(t.traceId)&&
      t.eventIds.every(id=>events1.has(id))).map(t=>t.traceId))
    omitEvents=new Set(r0.eventLog.filter(e=>events1.has(e.eventId)&&e.sourceTraceIds.every(id=>omitTraces.has(id))).map(e=>e.eventId))
    let changed=false
    for(const side of [r0,r1]){
      for(const e of side.eventLog)if(!omitEvents.has(e.eventId))for(const id of e.sourceTraceIds)
        if(omitTraces.has(id)&&!keepT.has(id)){keepT.add(id);changed=true}
      for(const t of side.decisionTraces)if(!omitTraces.has(t.traceId))for(const id of t.eventIds)
        if(omitEvents.has(id)&&!keepE.has(id)){keepE.add(id);changed=true}
    }
    if(!changed)break
  }
  const shownE=(e:EventLogEntry)=>!omitEvents.has(e.eventId)
  const shownT=(t:DecisionTrace)=>!omitTraces.has(t.traceId)
  const tally=<T,>(xs:readonly T[],k:(x:T)=>string)=>{const m:Record<string,number>={};for(const x of xs)m[k(x)]=(m[k(x)]??0)+1;return m}
  const evKept0=r0.eventLog.filter(shownE),trKept0=r0.decisionTraces.filter(shownT)
  const slim=(run:TimelineRun,events:readonly EventLogEntry[],traces:readonly DecisionTrace[]):TimelineRun=>({
    ...run,result:{...run.result,eventLog:events,decisionTraces:traces} as TimelineResult,
  })
  const a0=slim(c.a0,evKept0,trKept0)
  const a1=slim(c.a1,legacyShared(evKept0,r1.eventLog.filter(e=>!(omitEvents.has(e.eventId)&&sameEvent(e.eventId))),e=>e.eventId),
    legacyShared(trKept0,r1.decisionTraces.filter(t=>!(omitTraces.has(t.traceId)&&sameTrace(t.traceId))),t=>t.traceId))
  const displayOmission:DisplayOmission={
    fullEventCount:{a0:r0.eventLog.length,a1:r1.eventLog.length},
    fullTraceCount:{a0:r0.decisionTraces.length,a1:r1.decisionTraces.length},
    omittedEventsByType:tally(r0.eventLog.filter(e=>omitEvents.has(e.eventId)),e=>e.eventType),
    omittedTracesByRule:tally(r0.decisionTraces.filter(t=>omitTraces.has(t.traceId)),t=>t.ruleId),
  }
  return {mode:c.mode,input:c.input,modifier:c.modifier,a0,a1,displayOmission}
}

// ---- 比較ヘルパー ----
const ev = (id: string, type: string, traces: string[], extra = ''): EventLogEntry => ({
  eventId: id, eventType: type, year: 1250, semanticEventKey: id, involvedRefs: [], sourceTraceIds: traces,
  stateChanges: [{ path: '$.x' + extra, before: 1, after: 2 }],
}) as unknown as EventLogEntry
const tr = (id: string, rule: string, events: string[], mods: string[] = []): DecisionTrace => ({
  traceId: id, year: 1250, phase: 'B', ruleId: rule, actorRef: { kind: 'PERSON', id: 'p' }, status: 'ACCEPT',
  candidates: [], eventIds: events, modifierIds: mods, reasonCodes: [],
}) as unknown as DecisionTrace
const run = (events: EventLogEntry[], traces: DecisionTrace[]) => ({
  inputs: {}, initialWorld: { year: 1250 },
  result: { status: 'COMPLETED', eventLog: events, decisionTraces: traces, snapshots: [{ year: 1250 }], coverage: { todoRuleIds: [] }, technicalGoal: null },
}) as unknown as TimelineRun
const cmp = (a0: [EventLogEntry[], DecisionTrace[]], a1: [EventLogEntry[], DecisionTrace[]]) =>
  ({ mode: 'INTEGRATED_EXPERIMENTAL', input: {}, modifier: { modifierId: 'm' }, root: {}, branch: {}, a0: run(...a0), a1: run(...a1) }) as unknown as PlayComparison

/** 順序・内容・省略件数に加え、A1要素がA0要素と同一オブジェクトとして共有されるかの配置まで一致を見る。 */
function expectSameView(c: PlayComparison): PlayView {
  const o = legacyToDisplayView(c), n = toDisplayView(c)
  expect(n.displayOmission as DisplayOmission).toEqual(o.displayOmission)
  for (const side of ['a0', 'a1'] as const) {
    expect(n[side].result.eventLog).toEqual(o[side].result.eventLog)
    expect(n[side].result.decisionTraces).toEqual(o[side].result.decisionTraces)
    expect(n[side].result.eventLog.map(e => e.eventId)).toEqual(o[side].result.eventLog.map(e => e.eventId))
    expect(n[side].result.decisionTraces.map(t => t.traceId)).toEqual(o[side].result.decisionTraces.map(t => t.traceId))
  }
  const sharing = (v: PlayView) => ({
    e: v.a1.result.eventLog.map((x, i) => x === v.a0.result.eventLog.find(y => y.eventId === x.eventId) ? i : -1),
    t: v.a1.result.decisionTraces.map((x, i) => x === v.a0.result.decisionTraces.find(y => y.traceId === x.traceId) ? i : -1),
  })
  expect(sharing(n)).toEqual(sharing(o))
  expect(n.a0.result.snapshots).toBe(c.a0.result.snapshots)
  expect(n.a1.result.technicalGoal).toBe(c.a1.result.technicalGoal)
  expect(JSON.stringify(n)).toBe(JSON.stringify(o))
  return n
}

describe('toDisplayView: 最適化前の参照実装と一致する(境界ケース)', () => {
  const base = (): [EventLogEntry[], DecisionTrace[]] => [
    [ev('e-trust', 'PERSON_PAIR_TRUST_SET', ['t-b009']), ev('e-birth', 'PERSON_BIRTH', ['t-b002'])],
    [tr('t-b009', 'B-009', ['e-trust']), tr('t-b002', 'B-002', ['e-birth'])],
  ]
  it('同一・Event内容差・Trace内容差・A1専用Event・A1専用Trace・双方別の差分', () => {
    expectSameView(cmp(base(), base()))
    const d1 = base(); d1[0][0] = ev('e-trust', 'PERSON_PAIR_TRUST_SET', ['t-b009'], 'x'); expectSameView(cmp(base(), d1))
    const d2 = base(); d2[1][0] = tr('t-b009', 'B-009', ['e-trust'], ['m']); expectSameView(cmp(base(), d2))
    const d3 = base(); d3[0].push(ev('e-new', 'MARRIAGE_REGISTER', ['t-b009'])); expectSameView(cmp(base(), d3))
    const d4 = base(); d4[1].push(tr('t-new', 'B-009', ['e-trust'])); expectSameView(cmp(base(), d4))
    const a0 = base(); a0[0].push(ev('e-a0only', 'PERSON_PAIR_TRUST_SET', ['t-b009'])); expectSameView(cmp(a0, base()))
  })
  it('同ID異内容・重複ID・孤立/逆参照・循環参照・多段収束', () => {
    const dup = base(); dup[0].push(ev('e-trust', 'PERSON_PAIR_TRUST_SET', ['t-b009'], 'dup')); expectSameView(cmp(dup, base()))
    const dup1 = base(); dup1[1].push(tr('t-b009', 'B-009', ['e-trust'], ['dup'])); expectSameView(cmp(base(), dup1))
    const orphan = base(); orphan[0].push(ev('e-orphan', 'PERSON_PAIR_TRUST_SET', ['t-missing'])); expectSameView(cmp(orphan, orphan))
    const back = base(); back[1][1] = tr('t-b002', 'B-002', ['e-trust']); expectSameView(cmp(back, back)) // 残るTraceが省略候補Eventを参照
    // 多段: e1->t1->e2->t2->e3(A1だけ差分)。差分が連鎖して逆向きに残りを増やす。
    const chain = (extra: string): [EventLogEntry[], DecisionTrace[]] => [
      [ev('c1', 'PERSON_PAIR_TRUST_SET', ['ct1']), ev('c2', 'PERSON_PAIR_TRUST_SET', ['ct1', 'ct2']), ev('c3', 'PERSON_PAIR_TRUST_SET', ['ct2'], extra)],
      [tr('ct1', 'B-009', ['c1', 'c2']), tr('ct2', 'B-009', ['c2', 'c3'])],
    ]
    expectSameView(cmp(chain(''), chain('')))
    expectSameView(cmp(chain(''), chain('diff')))
    const cyc: [EventLogEntry[], DecisionTrace[]] = [
      [ev('y1', 'PERSON_PAIR_TRUST_SET', ['yt2']), ev('y2', 'PERSON_PAIR_TRUST_SET', ['yt1'])],
      [tr('yt1', 'B-009', ['y1']), tr('yt2', 'B-009', ['y2'])],
    ]
    expectSameView(cmp(cyc, cyc))
  })
  it('JSON化で意味が変わる値(undefined・キー順・NaN・Date)でも参照実装と一致する', () => {
    const mk = (mut: (e: Record<string, unknown>) => void) => { const b = base(); mut(b[0][0] as unknown as Record<string, unknown>); return b }
    expectSameView(cmp(mk(e => { e.u = undefined }), mk(() => {})))
    expectSameView(cmp(mk(e => { e.n = NaN }), mk(e => { e.n = null })))
    expectSameView(cmp(mk(e => { e.d = new Date(0) }), mk(e => { e.d = new Date(0).toISOString() })))
    expectSameView(cmp(mk(e => { e.p = 1; e.q = 2 }), mk(e => { e.q = 2; e.p = 1 })))
  })
  it('疑似乱数で生成した多数の組合せで参照実装と完全一致する', () => {
    let s = 20261110
    const rnd = (n: number) => { s = (s * 1664525 + 1013904223) >>> 0; return s % n }
    for (let trial = 0; trial < 150; trial++) {
      const N = 3 + rnd(10)
      const mkSide = (diverge: boolean): [EventLogEntry[], DecisionTrace[]] => {
        const es: EventLogEntry[] = [], ts: DecisionTrace[] = []
        for (let i = 0; i < N; i++) {
          const trust = i % 3 !== 2
          const refT = [`t${i}`, ...(rnd(4) === 0 ? [`t${rnd(N)}`] : [])]
          es.push(ev(`e${i}`, trust ? 'PERSON_PAIR_TRUST_SET' : 'PERSON_BIRTH', refT, diverge && rnd(5) === 0 ? 'D' : ''))
          ts.push(tr(`t${i}`, trust ? 'B-009' : 'B-002', [`e${i}`, ...(rnd(4) === 0 ? [`e${rnd(N)}`] : [])], diverge && rnd(6) === 0 ? ['m'] : []))
        }
        return [es, ts]
      }
      const saved = s
      const a0 = mkSide(false); s = saved
      const a1 = mkSide(rnd(2) === 0)
      expectSameView(cmp(a0, a1))
    }
  })
})

describe('jsonSame: JSON.stringify の一致判定と同値', () => {
  it('素のJSON値・特殊値を含む組合せで常に一致する', () => {
    const values: unknown[] = [
      {}, [], { a: 1 }, { a: 1, b: 2 }, { b: 2, a: 1 }, { a: [1, 2] }, { a: [1, 2, 3] }, { a: null }, { a: undefined }, { a: undefined, b: 1 }, { b: 1 },
      { a: NaN }, { a: Infinity }, { a: -0 }, { a: 0 }, { a: '1' }, { a: 1 }, { a: [undefined] }, { a: [null] }, { a: () => 1 }, { a: new Date(0) },
      { a: new Date(0).toISOString() }, { a: { b: { c: [1, { d: 2 }] } } }, { a: { b: { c: [1, { d: 3 }] } } }, { a: true }, { a: false }, { a: { toJSON: () => 5 } },
      [[]], [{}], [null], Object.create(null), { a: 10 }, { a: Symbol.iterator }, { '': 1 }, { 0: 'x' }, ['x'],
    ]
    for (const a of values) for (const b of values) {
      const expected = JSON.stringify(a) === JSON.stringify(b)
      expect(jsonSame(a as object, b as object), `${String(JSON.stringify(a))} vs ${String(JSON.stringify(b))}`).toBe(expected)
    }
  })
})

// ---- 実100年A0/A1との一致(オプトイン: 約70秒の実計算 + 旧実装約6秒) ----
//   CHRONOFORK_LONG_DISPLAY_VIEW=1 npx vitest run tests/unit/ui/play-view-equivalence.test.ts
const longTest = process.env.CHRONOFORK_LONG_DISPLAY_VIEW === '1' ? describe : describe.skip
longTest('toDisplayView: 実100年(CALIBRATION_ONLY)で参照実装と一致する', () => {
  it.each([1250, 1290, 1340])('介入年 %i', async (year) => {
    const { runPlayComparison } = await import('../../../src/ui/branch-play-source.ts')
    const r = runPlayComparison({ mode: 'INTEGRATED_EXPERIMENTAL', seed: 20260101, year, firstPersonId: 'person-exp-02', secondPersonId: 'person-exp-05', signedDelta: -20, durationYears: 5 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const t0 = performance.now(); const o = legacyToDisplayView(r.comparison); const tOld = performance.now() - t0
    const t1 = performance.now(); const n = toDisplayView(r.comparison); const tNew = performance.now() - t1
    console.info(`CHRONOFORK_DISPLAY_VIEW year=${year} legacyMs=${Math.round(tOld)} newMs=${Math.round(tNew)}`)
    expect(n.displayOmission).toEqual(o.displayOmission)
    for (const side of ['a0', 'a1'] as const) {
      const a = n[side].result, b = o[side].result
      expect(a.eventLog.length).toBe(b.eventLog.length)
      expect(a.decisionTraces.length).toBe(b.decisionTraces.length)
      for (let i = 0; i < a.eventLog.length; i++) if (JSON.stringify(a.eventLog[i]) !== JSON.stringify(b.eventLog[i])) throw new Error(`${side} event ${i}`)
      for (let i = 0; i < a.decisionTraces.length; i++) if (JSON.stringify(a.decisionTraces[i]) !== JSON.stringify(b.decisionTraces[i])) throw new Error(`${side} trace ${i}`)
      expect(a.snapshots).toBe(b.snapshots)
    }
    // 参照整合: 省略したEvent/Traceを、残ったTrace/Eventが参照していない(各側)
    for (const side of ['a0', 'a1'] as const) {
      const full = r.comparison[side].result, v = n[side].result
      const kept = (xs: readonly { eventId?: string; traceId?: string }[]) => new Set(xs.map(x => x.eventId ?? x.traceId))
      const eKept = kept(v.eventLog), tKept = kept(v.decisionTraces)
      const eOmitted = new Set(full.eventLog.map(e => e.eventId).filter(i => !eKept.has(i)))
      const tOmitted = new Set(full.decisionTraces.map(t => t.traceId).filter(i => !tKept.has(i)))
      expect(v.decisionTraces.some(t => t.eventIds.some(i => eOmitted.has(i)))).toBe(false)
      expect(v.eventLog.some(e => e.sourceTraceIds.some(i => tOmitted.has(i)))).toBe(false)
    }
  }, 600_000)
})
