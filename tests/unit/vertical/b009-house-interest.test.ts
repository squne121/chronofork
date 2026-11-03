// B-009の家門支持から人物判断への接続（CALIBRATION_ONLY）。承認済み相続・婚姻法を変更しない。
import { describe, expect, it } from 'vitest'
import type { WorldState } from '../../../src/simulation/contracts/index.ts'
import { runYear } from '../../../src/simulation/engine/index.ts'
import { createPairTrustView } from '../../../src/simulation/intervention/index.ts'
import { EXPERIMENTAL_AUTONOMY } from '../../../src/simulation/autonomy/index.ts'
import { createB004WorldStateEvaluator } from '../../../src/simulation/rules/b/b004-worldstate.ts'
import { createB009WorldStateEvaluator, EXPERIMENTAL_B009_HOUSE_INTEREST, EXPERIMENTAL_B009_CALIBRATION, validateB009Calibration } from '../../../src/simulation/rules/b/b009-relationships.ts'
import { createSyntheticWorld, P4, P5, SEED } from './b004-branch-fixture.ts'

const TRUST_BASE = [{ personIds: [P4,P5] as const, value: 10 }]
const CONFIG = { ...EXPERIMENTAL_B009_HOUSE_INTEREST, houseSupportWeight: 3 }
function withReversedHouseSupport(w: WorldState): WorldState {
  return { ...w, groups: w.groups.map(g => {
    if (g.groupId === 'group-west-elite' || g.groupId === 'group-east-elite') {
      const bs = g.support.houseBps
      return { ...g, support: { ...g.support, houseBps: { ...bs, 
        'house-vargas': bs['house-cardon'] ?? 0, 'house-cardon': bs['house-vargas'] ?? 0 } } }
    }
    return g
  }) }
}
function compute(w: WorldState, cfg = CONFIG) {
  const view = createPairTrustView({ base: TRUST_BASE, ledger: [], knownPersonIds: new Set(w.persons.map(p=>p.personId)) })
  if (!view.ok) throw new Error('bad pair trust input')
  return runYear(w, { seed: SEED, evaluators: {
    'B-009': createB009WorldStateEvaluator(TRUST_BASE, cfg),
    'B-004': createB004WorldStateEvaluator(view.view, EXPERIMENTAL_AUTONOMY),
  } })
}
const rel = (w: WorldState) => w.pairTrust?.find(r=>r.personIds[0]===P4 && r.personIds[1]===P5)
const findTrace = (traces: readonly import('../../../src/simulation/contracts/index.ts').DecisionTrace[], ruleId:string) =>
  traces.find(t=>t.ruleId===ruleId && t.actorRef.kind==='PERSON_PAIR' && t.actorRef.ids.includes(P4) && t.actorRef.ids.includes(P5))

describe('B-009の家門利益→人物縁談判断の校正モデル',()=>{
  it('双方の家門支持が異なるとB009信頼差分とB004の採否が実WorldStateから変わる',()=>{
    const original=createSyntheticWorld()
    const aligned=withReversedHouseSupport(original)
    const opposedResult=compute(original)
    const alignedResult=compute(aligned)
    expect(opposedResult.status).toBe('COMPLETED')
    expect(alignedResult.status).toBe('COMPLETED')
    if (opposedResult.status!=='COMPLETED'||alignedResult.status!=='COMPLETED') return
    expect(rel(opposedResult.world)?.value).toBe(-10) // 初期10 + 年1 − 家門支持21
    expect(rel(alignedResult.world)?.value).toBe(32) // 初期10 + 年1 + 家門支持21
    const o9=findTrace(opposedResult.traces,'B-009')!, a9=findTrace(alignedResult.traces,'B-009')!
    expect(o9.candidates[0]?.inputs).toMatchObject({
      houseIds:['house-vargas','house-cardon'],
      originGroupIds:['group-west-elite','group-east-elite'],
      reciprocalHouseSupportBps:[-3500,-3500], houseSupportSignal:-7,
      houseSupportDelta:-21, rawDelta:-20, updatedBaseTrust:-10,
    })
    expect(a9.candidates[0]?.inputs).toMatchObject({
      reciprocalHouseSupportBps:[3500,3500], houseSupportSignal:7,
      houseSupportDelta:21, rawDelta:22, updatedBaseTrust:32,
    })
    const o4=findTrace(opposedResult.traces,'B-004')!, a4=findTrace(alignedResult.traces,'B-004')!
    expect([o4.status,a4.status]).toEqual(['REJECT','ACCEPT'])
    expect([o4.candidates[0]?.score,a4.candidates[0]?.score]).toEqual([-10,32])
    expect(o4.reasonCodes).toContain('MARRIAGE_ELIGIBILITY_UNREVIEWED')
    expect(a4.reasonCodes).toContain('MARRIAGE_ELIGIBILITY_UNREVIEWED')
    expect(alignedResult.events.some(e=>e.eventType==='MARRIAGE_REGISTER')).toBe(false)
    expect(alignedResult.events.some(e=>e.eventType==='PERSON_PAIR_TRUST_SET')).toBe(true)
    expect(alignedResult.events.every(e=>e.sourceTraceIds.every(id=>alignedResult.traces.some(t=>t.traceId===id)))).toBe(true)
  })

  it('デフォルト係数では旧仕様どおり家門要因を使わず、B004試験スコアは11',()=>{
    const r=compute(createSyntheticWorld(),EXPERIMENTAL_B009_CALIBRATION)
    expect(r.status).toBe('COMPLETED')
    if (r.status!=='COMPLETED') return
    expect(rel(r.world)?.value).toBe(11)
    const tr=findTrace(r.traces,'B-009')!
    expect(tr.candidates[0]?.inputs).toMatchObject({ houseSupportWeight:0,houseSupportDelta:0,houseAffinityDelta:0,updatedBaseTrust:11 })
    expect(findTrace(r.traces,'B-004')?.candidates[0]?.score).toBe(11)
  })

  it('同家門ペアには任意の校正ボーナスを加え、欠落支持値は0とみなす',()=>{
    const w=createSyntheticWorld()
    const same = { ...EXPERIMENTAL_B009_CALIBRATION, annualDelta:0, sameHouseBonus:4 }
    const r=compute(w,same)
    expect(r.status).toBe('COMPLETED')
    if (r.status!=='COMPLETED') return
    const x=r.world.pairTrust?.find(t=>t.personIds[0]==='person-exp-01' && t.personIds[1]==='person-exp-02')
    expect(x?.value).toBe(4)
    const tr=r.traces.find(t=>t.ruleId==='B-009' && t.actorRef.kind==='PERSON_PAIR' &&
      t.actorRef.ids[0]==='person-exp-01' && t.actorRef.ids[1]==='person-exp-02')
    expect(tr?.candidates[0]?.inputs.houseAffinityDelta).toBe(4)
  })

  it('係数が不正なら評価器を生成せず、家門状態/介入とは独立に値域を保つ',()=>{
    expect(validateB009Calibration({ ...CONFIG,houseSupportWeight:11 }).ok).toBe(false)
    expect(validateB009Calibration({ ...CONFIG,sameHouseBonus:30 }).ok).toBe(false)
    expect(validateB009Calibration(EXPERIMENTAL_B009_HOUSE_INTEREST).ok).toBe(true)
    const w=withReversedHouseSupport(createSyntheticWorld())
    const r=compute(w,{...CONFIG,annualDelta:100})
    expect(r.status).toBe('COMPLETED')
    if (r.status!=='COMPLETED') return
    expect(rel(r.world)?.value).toBe(100)
    expect(r.world.pairTrust?.every(x=>x.value>=-100 && x.value<=100)).toBe(true)
  })
})
