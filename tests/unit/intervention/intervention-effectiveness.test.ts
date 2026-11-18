// Issue #71 / A: 信頼介入が B-004 → B-005 → 婚姻登録(MARRIAGE_REGISTER) → 出生へ届く条件の実計算検証（CALIBRATION_ONLY）。
// 統合実行構成（INTEGRATED_*）の実WorldState・EventLog・DecisionTraceだけを使い、結果は固定していない。
// 介入量は閾値の境界を探るための値で、勝利に都合のよい seed 探索・固定イベントは行わない。
// 判明した事実:
//  - 既存の −20/5年は P2/P5 の 1250 年判断（score 69→49、閾値30）を反転させない（正常動作。Trace上は差が出る）。
//  - 契約案の効用は全案に trust を同じ量だけ加えるため、契約の選択は trust では変わらず、同意閾値の越境でのみ効く。
//  - −40 で B-004 が REJECT へ反転。当年の婚姻が成立せず、B-009 の基礎値が下降するため後年も婚姻・出生が起きない。
//  - P1/P5 への +55 は P5 の最上位が同率となり DEFER、+56 以上で P5 の配偶者が P2 から P1 へ変わる。
import { describe, expect, it } from 'vitest'
import {
  createExperimentalIntegratedEvaluators, createExperimentalIntegratedWorld,
  INTEGRATED_PAIR, INTEGRATED_SEED, INTEGRATED_TRUST_REDUCTION,
} from '../../../src/scenario/experimental/index.ts'
import { runYear } from '../../../src/simulation/engine/index.ts'
import type { DecisionTrace, EventLogEntry, StatModifier, WorldState } from '../../../src/simulation/contracts/index.ts'

const P1_P5 = ['person-exp-01', 'person-exp-05'] as const
const isPair = (t: DecisionTrace, pair: readonly string[]) =>
  t.actorRef.kind === 'PERSON_PAIR' && t.actorRef.ids[0] === pair[0] && t.actorRef.ids[1] === pair[1]
const modifier = (pair: readonly string[], signedDelta: number): StatModifier => ({
  ...INTEGRATED_TRUST_REDUCTION, targetRef: { kind: 'PERSON_PAIR', ids: [...pair] as [string, string] }, signedDelta,
})

type Year = Readonly<{ year: number; world: WorldState; events: readonly EventLogEntry[]; traces: readonly DecisionTrace[] }>
function run(ledger: readonly StatModifier[], years: number): readonly Year[] {
  const start = createExperimentalIntegratedWorld()
  const evaluators = createExperimentalIntegratedEvaluators(start, ledger)
  let world = start
  const out: Year[] = []
  for (let i = 0; i < years; i++) {
    const r = runYear(world, { seed: INTEGRATED_SEED, evaluators })
    if (r.status !== 'COMPLETED') throw new Error('HALT ' + JSON.stringify(r.halt))
    out.push({ year: world.year, world: r.world, events: r.events, traces: r.traces })
    world = r.world
  }
  return out
}
const eventsOf = (ys: readonly Year[], type: string) => ys.flatMap((y) => y.events.filter((e) => e.eventType === type).map((e) => ({ year: y.year, e })))
const trace = (y: Year, ruleId: string, pair: readonly string[]) => y.traces.find((t) => t.ruleId === ruleId && isPair(t, pair))

describe('介入の実効性: 1250年の B-004/B-005 判断（P2/P5）', () => {
  const a0 = run([], 1)[0]!
  it('A0: P2/P5 は B-009 の更新後 69 で B-004 ACCEPT、B-005 がナルヴェン条項を選び婚姻が登録される', () => {
    expect(trace(a0, 'B-004', INTEGRATED_PAIR)).toMatchObject({ status: 'ACCEPT' })
    expect(trace(a0, 'B-004', INTEGRATED_PAIR)!.candidates[0]).toMatchObject({ score: 69, threshold: 30 })
    expect(trace(a0, 'B-005', INTEGRATED_PAIR)!.candidates[0]!.inputs.selectedContractKey).toBe('CHILD_DYNASTY:dynasty-nalven')
    expect(eventsOf([a0], 'MARRIAGE_REGISTER')).toHaveLength(1)
  })

  it('既存の −20: 判断・Event は同一で、差は B-004 score・modifierIds・B-005 参照スコアに現れる（B-009 基礎値は不変）', () => {
    const a1 = run([INTEGRATED_TRUST_REDUCTION], 1)[0]!
    expect(trace(a1, 'B-004', INTEGRATED_PAIR)).toMatchObject({ status: 'ACCEPT', modifierIds: [INTEGRATED_TRUST_REDUCTION.modifierId] })
    expect(trace(a1, 'B-004', INTEGRATED_PAIR)!.candidates[0]).toMatchObject({ score: 49, threshold: 30 })
    expect(trace(a1, 'B-004', INTEGRATED_PAIR)!.candidates[0]!.inputs).toMatchObject({ baseTrust: 69, rawModifierSum: -20, effectiveTrust: 49 })
    expect(trace(a1, 'B-005', INTEGRATED_PAIR)!.candidates[0]!.inputs).toMatchObject({ sourceB004Score: 49, selectedContractKey: 'CHILD_DYNASTY:dynasty-nalven' })
    expect(a1.events.map((e) => [e.eventType, e.semanticEventKey])).toEqual(a0.events.map((e) => [e.eventType, e.semanticEventKey]))
    expect(a1.world.pairTrust).toEqual(a0.world.pairTrust) // 介入は読取時に適用され、累積基礎値へ書き込まれない
  })

  it('契約案の選択は trust の増減で変わらない（全案に同量を加算）。変わるのは同意閾値の越境だけ', () => {
    const options = (d: number) => (trace(run(d === 0 ? [] : [modifier(INTEGRATED_PAIR, d)], 1)[0]!, 'B-005', INTEGRATED_PAIR)!
      .candidates[0]!.inputs.contractOptions as { key: string; firstConsentScore: number; secondConsentScore: number }[])
    const base = options(0), up = options(20)
    expect(up.map((o) => o.key)).toEqual(base.map((o) => o.key))
    up.forEach((o, i) => {
      expect(o.firstConsentScore - base[i]!.firstConsentScore).toBe(20)
      expect(o.secondConsentScore - base[i]!.secondConsentScore).toBe(20)
    })
  })

  it('B-004 の閾値境界: −39 は score 30 で ACCEPT、−40 は score 29 で REJECT となり B-005 は B004_NOT_ACCEPTED で保留する', () => {
    const keep = run([modifier(INTEGRATED_PAIR, -39)], 1)[0]!
    expect(trace(keep, 'B-004', INTEGRATED_PAIR)).toMatchObject({ status: 'ACCEPT' })
    expect(trace(keep, 'B-004', INTEGRATED_PAIR)!.candidates[0]!.score).toBe(30)
    expect(eventsOf([keep], 'MARRIAGE_REGISTER')).toHaveLength(1)
    const flip = run([modifier(INTEGRATED_PAIR, -40)], 1)[0]!
    expect(trace(flip, 'B-004', INTEGRATED_PAIR)).toMatchObject({ status: 'REJECT' })
    expect(trace(flip, 'B-004', INTEGRATED_PAIR)!.candidates[0]!.score).toBe(29)
    expect(trace(flip, 'B-005', INTEGRATED_PAIR)).toMatchObject({ status: 'DEFER' })
    expect(trace(flip, 'B-005', INTEGRATED_PAIR)!.reasonCodes).toContain('B004_NOT_ACCEPTED')
    expect(eventsOf([flip], 'MARRIAGE_REGISTER')).toHaveLength(0)
  })

  it('P1/P5 への正の介入: +55 は P5 の最上位が同率で全案 DEFER、+56 で P5 の配偶者が P2 から P1 に変わる', () => {
    const tie = run([modifier(P1_P5, 55)], 1)[0]!
    expect(trace(tie, 'B-004', P1_P5)!.candidates[0]!.score).toBe(69)
    expect(trace(tie, 'B-004', INTEGRATED_PAIR)!.candidates[0]!.score).toBe(69)
    expect(trace(tie, 'B-005', P1_P5)!.reasonCodes).toContain('MUTUAL_UNIQUE_PARTNER_NOT_ESTABLISHED')
    expect(trace(tie, 'B-005', INTEGRATED_PAIR)!.reasonCodes).toContain('MUTUAL_UNIQUE_PARTNER_NOT_ESTABLISHED')
    expect(eventsOf([tie], 'MARRIAGE_REGISTER')).toHaveLength(0) // ID順などで同率を解消しない（DEC-058）
    const switched = run([modifier(P1_P5, 56)], 1)[0]!
    expect(trace(switched, 'B-004', P1_P5)!.candidates[0]!.score).toBe(70)
    expect(trace(switched, 'B-004', INTEGRATED_PAIR)).toMatchObject({ status: 'ACCEPT' }) // P2 側も採択のまま、P1が上回って置き換わる
    expect(trace(switched, 'B-005', P1_P5)).toMatchObject({ status: 'ACCEPT' })
    expect(trace(switched, 'B-005', P1_P5)!.candidates[0]!.inputs.selectedContractKey).toBe('CHILD_DYNASTY:dynasty-nalven')
    expect(trace(switched, 'B-005', INTEGRATED_PAIR)!.reasonCodes).toContain('MUTUAL_UNIQUE_PARTNER_NOT_ESTABLISHED')
    const marriages = eventsOf([switched], 'MARRIAGE_REGISTER')
    expect(marriages).toHaveLength(1)
    expect(marriages[0]!.e.involvedRefs).toEqual([{ kind: 'PERSON_PAIR', ids: [...P1_P5] }])
  })
})

describe('介入の下流への因果: 婚姻・出生・法的王朝（1250〜1262）', () => {
  const YEARS = 13 // 1250〜1262年（初期の出生が出そろう範囲。長期は別の100年診断で扱う）
  const a0 = run([], YEARS)
  const births = (ys: readonly Year[]) => eventsOf(ys, 'PERSON_BIRTH')
  // 最終世界に記録された B-002 出生児（実在の fatherId を持つ人物）の父の集合。
  const fathersOf = (ys: readonly Year[]) => new Set(ys.at(-1)!.world.persons.filter((p) => p.fatherId !== undefined && p.birthYear > 1250).map((p) => p.fatherId))

  it('A0: P2/P5 の婚姻から出生が起き、子は P2 を父とする', () => {
    expect(births(a0).length).toBeGreaterThan(0)
    expect([...fathersOf(a0)]).toEqual(['person-exp-02'])
  })

  it('P2/P5 −40: 1250年の婚姻が成立せず、B-009 基礎値の下降で後年も婚姻・出生が一切起きない', () => {
    const a1 = run([modifier(INTEGRATED_PAIR, -40)], YEARS)
    expect(eventsOf(a1, 'MARRIAGE_REGISTER')).toHaveLength(0)
    expect(births(a1)).toHaveLength(0)
    // 介入期間(〜1254)後も P2/P5 の信頼は閾値30へ戻らない（修正すべき不具合ではなく校正値の帰結）。
    const afterIdx = INTEGRATED_TRUST_REDUCTION.endExclusiveYear - 1250 + 1 // 介入期間終了の翌年
    const after = trace(a1[afterIdx]!, 'B-004', INTEGRATED_PAIR)!
    expect(after.modifierIds).toEqual([])
    expect(after.candidates[0]!.score).toBeLessThan(30)
  })

  it('P1/P5 +56: P5 の婚姻相手と子の父が変わり、出生が起きる（修正前後で婚姻・出生の Event が異なる）', () => {
    const a1 = run([modifier(P1_P5, 56)], YEARS)
    const marriage = eventsOf(a1, 'MARRIAGE_REGISTER')[0]!
    expect(marriage.year).toBe(1250)
    expect(marriage.e.involvedRefs).toEqual([{ kind: 'PERSON_PAIR', ids: [...P1_P5] }])
    expect(births(a1).length).toBeGreaterThan(0)
    expect([...fathersOf(a1)]).toEqual(['person-exp-01'])
  })
})
