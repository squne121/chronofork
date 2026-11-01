import { describe, expect, it } from 'vitest'
import type { PairTrustBase, StatModifier } from '../../../src/simulation/contracts/index.ts'
import { STAT_MODIFIER_RULE_VERSION } from '../../../src/simulation/contracts/index.ts'
import {
  PAIR_TRUST_DEFINITION,
  addStatModifier,
  createPairTrustView,
  getStatDefinition,
  normalizePersonPair,
  roundHalfAwayFromZero,
  toPairRef,
  validatePairTrustBase,
  validateStatModifier,
} from '../../../src/simulation/intervention/index.ts'
import type { StatModifierLedger } from '../../../src/simulation/intervention/index.ts'
import {
  EXPERIMENTAL_EMPTY_LEDGER,
  EXPERIMENTAL_PAIR_TRUST_BASE,
  EXPERIMENTAL_TRUST_BOOST,
  experimentalKnownPersonIds,
} from '../../../src/scenario/experimental/index.ts'
import { getRule, listRulesByStatus } from '../../../src/simulation/rule-registry.ts'
import { deepFreeze } from '../foundation/helpers.ts'

const known = experimentalKnownPersonIds()
const ctx = { knownPersonIds: known }
const P1 = 'person-exp-01'
const P2 = 'person-exp-02'
const P3 = 'person-exp-03'
const P4 = 'person-exp-04'

const mod = (over: Partial<StatModifier> = {}): StatModifier => ({
  ...EXPERIMENTAL_TRUST_BOOST,
  ...over,
})
const codesOf = (m: StatModifier) => validateStatModifier(m, ctx).map((i) => i.code)

function view(ledger: StatModifierLedger, base: readonly PairTrustBase[] = EXPERIMENTAL_PAIR_TRUST_BASE) {
  const r = createPairTrustView({ base, ledger, knownPersonIds: known })
  if (!r.ok) throw new Error(JSON.stringify(r.issues))
  return r.view
}

describe('PERSON_PAIR の対称性', () => {
  it('(A,B) と (B,A) は同じ昇順ペアへ正規化される', () => {
    expect(normalizePersonPair(P2, P1)).toEqual([P1, P2])
    expect(normalizePersonPair(P1, P2)).toEqual([P1, P2])
    expect(toPairRef(P2, P1)).toEqual({ kind: 'PERSON_PAIR', ids: [P1, P2] })
  })
  it('同一人物・空・非文字列は null（推測しない）', () => {
    expect(normalizePersonPair(P1, P1)).toBeNull()
    expect(normalizePersonPair('', P1)).toBeNull()
    expect(normalizePersonPair(1, P1)).toBeNull()
  })
  it('参照は引数順に依らず同じ信頼値を返す', () => {
    const v = view(EXPERIMENTAL_EMPTY_LEDGER)
    expect(v.resolve(P1, P2, 1250)).toEqual(v.resolve(P2, P1, 1250))
    expect(v.resolve(P2, P1, 1250)).toMatchObject({ status: 'RESOLVED', base: 10, effective: 10 })
  })
  it('基礎値の (B,A) 逆順登録・重複は拒否する', () => {
    const rev = [{ personIds: [P2, P1] as const, value: 5 }]
    expect(validatePairTrustBase(rev, ctx)).toMatchObject({ ok: false, issues: [{ code: 'PERSON_PAIR_NOT_NORMALIZED' }] })
    const dup = [...EXPERIMENTAL_PAIR_TRUST_BASE, { personIds: [P1, P2] as const, value: 1 }]
    const r = validatePairTrustBase(dup, ctx)
    expect(r.ok === false && r.issues.map((i) => i.code)).toContain('DUPLICATE_BASE_PAIR')
  })
  it('無関係な（基礎値の無い）ペアの信頼値は発明しない', () => {
    const v = view([mod({ targetRef: { kind: 'PERSON_PAIR', ids: [P1, P4] } })])
    expect(v.resolve(P1, P4, 1250)).toEqual({ status: 'NO_BASE', personIds: [P1, P4], year: 1250, modifierIds: ['mod-exp-trust-boost'] })
    expect(view([]).resolve(P3, P4, 1250)).toMatchObject({ status: 'NO_BASE', modifierIds: [] })
  })
})

describe('有効期間 [startYear, endExclusiveYear)', () => {
  const v = view([mod({ startYear: 1252, endExclusiveYear: 1257 })])
  it('開始年から有効、終了年は期限切れ', () => {
    expect(v.resolve(P1, P2, 1251)).toMatchObject({ effective: 10, modifierIds: [] })
    expect(v.resolve(P1, P2, 1252)).toMatchObject({ effective: 30, modifierIds: ['mod-exp-trust-boost'] })
    expect(v.resolve(P1, P2, 1256)).toMatchObject({ effective: 30 })
    expect(v.resolve(P1, P2, 1257)).toMatchObject({ effective: 10, modifierIds: [] })
  })
  it('基礎値は不変（base は常に元の値）', () => {
    for (const y of [1251, 1253, 1257]) expect(v.resolve(P1, P2, y)).toMatchObject({ base: 10 })
  })
  it('範囲外の年・未知人物・自己ペアは null', () => {
    expect(v.resolve(P1, P2, 1249)).toBeNull()
    expect(v.resolve(P1, P2, 1250.5)).toBeNull()
    expect(v.resolve(P1, P2, 1351)).toBeNull()
    expect(v.resolve(P1, 'person-none', 1250)).toBeNull()
    expect(v.resolve(P1, P1, 1250)).toBeNull()
  })
})

describe('重ね合わせ・減衰・clamp/round', () => {
  it('別年の modifier は重なる期間で合算される', () => {
    const second = mod({ modifierId: 'mod-2', interventionId: 'int-2', startYear: 1252, endExclusiveYear: 1254, signedDelta: -5 })
    const v = view([EXPERIMENTAL_TRUST_BOOST, second])
    expect(v.resolve(P1, P2, 1251)).toMatchObject({ effective: 30 })
    expect(v.resolve(P1, P2, 1252)).toMatchObject({ effective: 25, rawModifierSum: 15 })
    expect(v.resolve(P1, P2, 1254)).toMatchObject({ effective: 30 })
  })
  it('合計後に一度だけ clamp する（途中経過の clamp で結果が変わらない）', () => {
    // base 95 + 20 - 20 は 95。逐次 clamp(95+20=100)-20=80 とは異なる。
    const up = mod({ modifierId: 'a', interventionId: 'ia', targetRef: { kind: 'PERSON_PAIR', ids: [P2, P3] }, signedDelta: 20 })
    const down = mod({ modifierId: 'b', interventionId: 'ib', targetRef: { kind: 'PERSON_PAIR', ids: [P2, P3] }, signedDelta: -20, startYear: 1251, endExclusiveYear: 1255 })
    const v = view([up, down])
    expect(v.resolve(P2, P3, 1251)).toMatchObject({ effective: 95, rawModifierSum: 0 })
    expect(v.resolve(P2, P3, 1250)).toMatchObject({ effective: 100, rawModifierSum: 20 })
  })
  it('LINEAR は開始年が全量で逓減し、合計後に一度だけ丸める', () => {
    const lin = mod({ decayPolicy: 'LINEAR', signedDelta: 20, startYear: 1250, endExclusiveYear: 1254 })
    const v = view([lin])
    const sums = [1250, 1251, 1252, 1253, 1254].map((y) => (v.resolve(P1, P2, y) as { rawModifierSum: number }).rawModifierSum)
    expect(sums).toEqual([20, 15, 10, 5, 0])
  })
  it('丸めは 0.5 を 0 から遠い側へ', () => {
    expect(roundHalfAwayFromZero(2.5)).toBe(3)
    expect(roundHalfAwayFromZero(-2.5)).toBe(-3)
    expect(roundHalfAwayFromZero(0.49)).toBe(0)
    const lin = mod({ decayPolicy: 'LINEAR', signedDelta: 5, startYear: 1250, endExclusiveYear: 1252 })
    expect(view([lin]).resolve(P1, P2, 1251)).toMatchObject({ rawModifierSum: 2.5, effective: 13 })
  })
  it('下限側も clamp される', () => {
    const down = mod({ modifierId: 'd', targetRef: { kind: 'PERSON_PAIR', ids: [P1, P3] }, signedDelta: -100 })
    expect(view([down]).resolve(P1, P3, 1250)).toMatchObject({ base: -30, rawModifierSum: -100, effective: -100 })
  })
})

describe('検証', () => {
  it('正常な fixture は通る', () => {
    expect(codesOf(EXPERIMENTAL_TRUST_BOOST)).toEqual([])
  })
  it('未登録 statKey', () => {
    expect(codesOf(mod({ statKey: 'region.production' }))).toContain('UNREGISTERED_STAT_KEY')
    expect(getStatDefinition('region.production')).toBeUndefined()
  })
  it('不正な対象種別・人物 ID', () => {
    expect(codesOf(mod({ targetRef: { kind: 'PERSON', id: P1 } }))).toContain('INVALID_TARGET_KIND')
    expect(codesOf(mod({ targetRef: { kind: 'PERSON_PAIR', ids: [P1, P1] } }))).toContain('SELF_PAIR')
    expect(codesOf(mod({ targetRef: { kind: 'PERSON_PAIR', ids: [P2, P1] } }))).toContain('PERSON_PAIR_NOT_NORMALIZED')
    expect(codesOf(mod({ targetRef: { kind: 'PERSON_PAIR', ids: ['', P1] } }))).toContain('INVALID_PERSON_ID')
    expect(codesOf(mod({ targetRef: { kind: 'PERSON_PAIR', ids: [P1, 'person-zzz'] } }))).toContain('UNKNOWN_PERSON')
  })
  it('signedDelta: 0・非整数・非安全整数・値域幅超過', () => {
    for (const d of [0, 1.5, NaN, Infinity, 2 ** 53]) expect(codesOf(mod({ signedDelta: d }))).toContain('INVALID_DELTA')
    const width = PAIR_TRUST_DEFINITION.max - PAIR_TRUST_DEFINITION.min
    expect(codesOf(mod({ signedDelta: width + 1 }))).toContain('DELTA_OUT_OF_RANGE')
    expect(codesOf(mod({ signedDelta: -(width + 1) }))).toContain('DELTA_OUT_OF_RANGE')
    expect(codesOf(mod({ signedDelta: width }))).toEqual([])
  })
  it('期間・減衰・版', () => {
    expect(codesOf(mod({ startYear: 1255, endExclusiveYear: 1255 }))).toContain('INVALID_PERIOD')
    expect(codesOf(mod({ startYear: 1249 }))).toContain('INVALID_PERIOD')
    expect(codesOf(mod({ endExclusiveYear: 1351 }))).toContain('INVALID_PERIOD')
    expect(codesOf(mod({ startYear: 1250.5 }))).toContain('INVALID_PERIOD')
    expect(codesOf(mod({ endExclusiveYear: 1350 }))).toEqual([])
    expect(codesOf(mod({ decayPolicy: 'EXP' as never }))).toContain('INVALID_DECAY_POLICY')
    expect(codesOf(mod({ ruleVersion: 'old' }))).toContain('UNSUPPORTED_RULE_VERSION')
    expect(codesOf(mod({ modifierId: '' }))).toContain('INVALID_ID')
  })
  it('基礎値: 値域外・非整数は拒否', () => {
    for (const value of [101, -101, 1.5, NaN]) {
      const r = validatePairTrustBase([{ personIds: [P1, P2], value }], ctx)
      expect(r.ok === false && r.issues.map((i) => i.code)).toContain('INVALID_BASE_VALUE')
    }
    expect(validatePairTrustBase([{ personIds: [P1, 'person-zzz'], value: 0 }], ctx).ok).toBe(false)
  })
  it('不正な台帳・基礎値では view を作らない', () => {
    const bad = createPairTrustView({ base: [], ledger: [mod({ signedDelta: 0 })], knownPersonIds: known })
    expect(bad.ok).toBe(false)
    const badBase = createPairTrustView({ base: [{ personIds: [P1, P2], value: 999 }], ledger: [], knownPersonIds: known })
    expect(badBase.ok).toBe(false)
  })
})

describe('台帳: 重複・冪等・入力不変', () => {
  it('追加は新しい台帳を返し、元の台帳は変わらない', () => {
    const ledger = deepFreeze([] as StatModifier[])
    const r = addStatModifier(ledger, EXPERIMENTAL_TRUST_BOOST, ctx)
    expect(r).toMatchObject({ ok: true, outcome: 'ADDED' })
    expect(ledger).toEqual([])
    expect(r.ok && r.ledger).toEqual([EXPERIMENTAL_TRUST_BOOST])
  })
  it('同一 modifier の再送は DUPLICATE で台帳不変（冪等）', () => {
    const r1 = addStatModifier([], EXPERIMENTAL_TRUST_BOOST, ctx)
    if (!r1.ok) throw new Error('unreachable')
    const r2 = addStatModifier(r1.ledger, { ...EXPERIMENTAL_TRUST_BOOST }, ctx)
    expect(r2).toMatchObject({ ok: true, outcome: 'DUPLICATE' })
    expect(r2.ok && r2.ledger).toEqual(r1.ok && r1.ledger)
  })
  it('同 modifierId で内容が違う場合は拒否', () => {
    const r = addStatModifier([EXPERIMENTAL_TRUST_BOOST], mod({ signedDelta: 21 }), ctx)
    expect(r).toMatchObject({ ok: false, issues: [{ code: 'DUPLICATE_MODIFIER_ID' }] })
  })
  it('同年・同対象・同 statKey の別 modifier は拒否（(B,A) 順の別名でも同一対象）', () => {
    const other = mod({ modifierId: 'mod-other', interventionId: 'int-other', signedDelta: 5 })
    expect(addStatModifier([EXPERIMENTAL_TRUST_BOOST], other, ctx)).toMatchObject({ ok: false, issues: [{ code: 'DUPLICATE_SAME_YEAR_TARGET_STAT' }] })
    // 逆順 ids は正規化違反として拒否（別名で重複回避できない）
    const rev = mod({ modifierId: 'mod-rev', targetRef: { kind: 'PERSON_PAIR', ids: [P2, P1] } })
    expect(addStatModifier([EXPERIMENTAL_TRUST_BOOST], rev, ctx)).toMatchObject({ ok: false })
  })
  it('別年・別対象は追加できる', () => {
    const otherYear = mod({ modifierId: 'm-y', interventionId: 'i-y', startYear: 1251, endExclusiveYear: 1253 })
    const otherPair = mod({ modifierId: 'm-p', interventionId: 'i-p', targetRef: { kind: 'PERSON_PAIR', ids: [P1, P3] } })
    let ledger: StatModifierLedger = [EXPERIMENTAL_TRUST_BOOST]
    for (const m of [otherYear, otherPair]) {
      const r = addStatModifier(ledger, m, ctx)
      expect(r).toMatchObject({ ok: true, outcome: 'ADDED' })
      if (r.ok) ledger = r.ledger
    }
    expect(ledger).toHaveLength(3)
  })
  it('台帳へ重複が含まれていれば view 作成で拒否', () => {
    const r = createPairTrustView({ base: [], ledger: [EXPERIMENTAL_TRUST_BOOST, mod({ modifierId: 'x', interventionId: 'ix' })], knownPersonIds: known })
    expect(r.ok === false && r.issues.map((i) => i.code)).toContain('DUPLICATE_SAME_YEAR_TARGET_STAT')
  })
  it('凍結した入力でも解決でき、入力は変更されない', () => {
    const base = deepFreeze(EXPERIMENTAL_PAIR_TRUST_BASE.map((b) => ({ ...b })))
    const ledger = deepFreeze([{ ...EXPERIMENTAL_TRUST_BOOST }])
    const before = JSON.stringify([base, ledger])
    view(ledger, base).resolve(P1, P2, 1251)
    expect(JSON.stringify([base, ledger])).toBe(before)
  })
})

describe('境界の堅牢性', () => {
  it('丸めは -0 を返さない', () => {
    expect(Object.is(roundHalfAwayFromZero(-0.2), 0)).toBe(true)
    const lin = mod({ decayPolicy: 'LINEAR', signedDelta: -1, startYear: 1250, endExclusiveYear: 1255, targetRef: { kind: 'PERSON_PAIR', ids: [P3, P4] } })
    const base = [{ personIds: [P3, P4] as const, value: 0 }]
    const r = view([lin], base).resolve(P3, P4, 1253)
    expect(r).toMatchObject({ status: 'RESOLVED', rawModifierSum: -0.4 })
    expect(Object.is((r as { effective: number }).effective, 0)).toBe(true)
  })
  it('null など不正な要素は例外でなく issues を返す', () => {
    const bad = createPairTrustView({ base: [null as never], ledger: [null as never], knownPersonIds: known })
    expect(bad.ok).toBe(false)
    expect(validateStatModifier(null as never, ctx)).not.toHaveLength(0)
  })
})

describe('fail-closed と防御的複製', () => {
  const valid = EXPERIMENTAL_TRUST_BOOST
  it('不正な targetRef（undefined/null/型違い）や null 要素の台帳は例外でなく ok:false', () => {
    for (const bad of [undefined, null, 5, { kind: 'PERSON_PAIR' }, { kind: 'PERSON_PAIR', ids: null }]) {
      const r = createPairTrustView({ base: [], ledger: [{ ...valid, targetRef: bad as never }], knownPersonIds: known })
      expect(r.ok).toBe(false)
    }
    expect(createPairTrustView({ base: [], ledger: [null as never, undefined as never], knownPersonIds: known }).ok).toBe(false)
    expect(createPairTrustView({ base: [], ledger: 'x' as never, knownPersonIds: known }).ok).toBe(false)
  })
  it('addStatModifier は破損した既存台帳を ok:false で拒否する（例外・不正な ADDED にしない）', () => {
    expect(addStatModifier([null as never], valid, ctx).ok).toBe(false)
    expect(addStatModifier([{ ...valid, targetRef: undefined } as never], mod({ modifierId: 'n', startYear: 1260, endExclusiveYear: 1261 }), ctx).ok).toBe(false)
    expect(addStatModifier([valid, { ...valid, modifierId: 'dup' }], mod({ modifierId: 'n2', startYear: 1260, endExclusiveYear: 1261 }), ctx).ok).toBe(false)
  })
  it('作成済み view は呼出元の modifier / ids / known 集合の後続変更の影響を受けない', () => {
    const m = { ...valid, targetRef: { kind: 'PERSON_PAIR' as const, ids: [P1, P2] as [string, string] } }
    const k = new Set(known)
    const base = [{ personIds: [P1, P2] as [string, string], value: 10 }]
    const r = createPairTrustView({ base, ledger: [m], knownPersonIds: k })
    if (!r.ok) throw new Error('unreachable')
    const before = r.view.resolve(P1, P2, 1250)
    ;(m as { signedDelta: number }).signedDelta = -99
    m.targetRef.ids[1] = P3
    base[0]!.value = -50
    base[0]!.personIds[0] = P4
    k.delete(P1)
    expect(r.view.resolve(P1, P2, 1250)).toEqual(before)
    expect(r.view.resolve(P1, P2, 1250)).toMatchObject({ effective: 30 })
  })
  it('addStatModifier の返却台帳は入力・返却後の外部変更から隔離される', () => {
    const input = { ...valid, targetRef: { kind: 'PERSON_PAIR' as const, ids: [P1, P2] as [string, string] } }
    const r = addStatModifier([], input, ctx)
    if (!r.ok) throw new Error('unreachable')
    ;(input as { signedDelta: number }).signedDelta = -1
    input.targetRef.ids[0] = P4
    expect(r.ledger[0]).toMatchObject({ signedDelta: 20, targetRef: { ids: [P1, P2] } })
    expect(Object.isFrozen(r.ledger)).toBe(true)
    expect(() => { (r.ledger[0] as { signedDelta: number }).signedDelta = 1 }).toThrow()
    expect(() => { (r.ledger[0]!.targetRef as unknown as { ids: string[] }).ids[0] = P4 }).toThrow()
  })
  it('基礎値の personIds は厳密に 2 要素（3 要素以上・1 要素は拒否）', () => {
    for (const ids of [[P1, P2, P3], [P1], [], [P1, P2, P2]]) {
      const r = validatePairTrustBase([{ personIds: ids as never, value: 0 }], ctx)
      expect(r.ok).toBe(false)
    }
    expect(validatePairTrustBase([null as never], ctx).ok).toBe(false)
    expect(validatePairTrustBase('x' as never, ctx).ok).toBe(false)
  })
})

describe('決定性とレジストリ', () => {
  it('同入力の再実行は完全一致、台帳の並び順にも依らない', () => {
    const a = mod({ modifierId: 'm-a', interventionId: 'i-a', startYear: 1251, endExclusiveYear: 1256, decayPolicy: 'LINEAR', signedDelta: 7 })
    const b = mod({ modifierId: 'm-b', interventionId: 'i-b', startYear: 1252, endExclusiveYear: 1258, decayPolicy: 'LINEAR', signedDelta: -3 })
    const l1 = [EXPERIMENTAL_TRUST_BOOST, a, b]
    const l2 = [b, a, EXPERIMENTAL_TRUST_BOOST]
    for (let y = 1249; y <= 1260; y++) {
      expect(view(l1).resolve(P1, P2, y)).toEqual(view(l1).resolve(P1, P2, y))
      expect(view(l1).resolve(P1, P2, y)).toEqual(view(l2).resolve(P1, P2, y))
    }
  })
  it('modifier の有無で参照される pair.trust が変わる（B の意思決定の変化は主張しない）', () => {
    const without = view(EXPERIMENTAL_EMPTY_LEDGER).resolve(P1, P2, 1250)
    const withMod = view([EXPERIMENTAL_TRUST_BOOST]).resolve(P1, P2, 1250)
    expect(without).toMatchObject({ status: 'RESOLVED', effective: 10 })
    expect(withMod).toMatchObject({ status: 'RESOLVED', effective: 30 })
    // 他ペアは影響を受けない
    expect(view([EXPERIMENTAL_TRUST_BOOST]).resolve(P1, P3, 1250)).toMatchObject({ effective: -30, modifierIds: [] })
  })
  it('pair.trust のみ登録・範囲は CALIBRATION_ONLY・B-009 等は TODO のまま', () => {
    expect(PAIR_TRUST_DEFINITION).toMatchObject({ statKey: 'pair.trust', rangeStatus: 'CALIBRATION_ONLY', editPolicy: 'BOUNDED_MODIFIER' })
    expect(listRulesByStatus('IMPLEMENTED')).toHaveLength(0)
    expect(listRulesByStatus('TODO')).toHaveLength(37)
    expect(getRule('B-009').implementationStatus).toBe('TODO')
    expect(STAT_MODIFIER_RULE_VERSION).toBe(EXPERIMENTAL_TRUST_BOOST.ruleVersion)
  })
})
