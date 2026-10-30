import { describe, expect, it } from 'vitest'
import {
  drawRandom,
  encodeRandomInput,
  rngVersion,
  sha256,
  type RandomKey,
} from '../../src/simulation/random.ts'

const hex = (b: Uint8Array) => [...b].map((x) => x.toString(16).padStart(2, '0')).join('')
const text = (s: string) => new TextEncoder().encode(s)

const base: RandomKey = {
  stream: 'EXOGENOUS',
  year: 1300,
  phase: 'PRODUCTION',
  ruleId: 'RULE-C-002',
  actorId: 'region-1',
  targetId: null,
  eventKey: 'weather',
}

describe('rngVersion', () => {
  it('固定値', () => {
    expect(rngVersion).toBe('chronofork-rng-1')
  })
})

describe('SHA-256 実装（FIPS 180-4 / NIST の参照値）', () => {
  it('空文字列・abc・56 バイト（2 ブロック）', () => {
    expect(hex(sha256(text('')))).toBe(
      'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
    )
    expect(hex(sha256(text('abc')))).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    )
    expect(hex(sha256(text('abcdbcdecdefdefgefghfghighijhijkijkljklmklmnlmnomnopnopq')))).toBe(
      '248d6a61d20638b8e5c026930c3e6039a33ce45964ff2167f6ecedd419db06c1',
    )
  })
})

describe('既知ベクトル（rngVersion chronofork-rng-1）', () => {
  // 期待値は実装と独立に Python hashlib.sha256 で、同じ仕様（src/simulation/random.ts
  // 冒頭の符号化）から算出した: value = (digest 先頭 8 バイトの u64 >> 11) / 2**53。
  const vectors: [string, number, RandomKey, number][] = [
    ['外生', 20261028, base, 0.3956778567886915],
    ['内生（stream 違い）', 20261028, { ...base, stream: 'ENDOGENOUS' }, 0.5576488717920662],
    [
      '最小値・全 null',
      0,
      { stream: 'EXOGENOUS', year: 0, phase: 'p', ruleId: 'r', actorId: null, targetId: null, eventKey: null },
      0.3067029656712026,
    ],
    [
      '最大 seed・非 ASCII',
      Number.MAX_SAFE_INTEGER,
      { stream: 'ENDOGENOUS', year: 1349, phase: 'ⅳ', ruleId: 'B-001', actorId: '人物', targetId: 't', eventKey: 'e😀' },
      0.7753758601053544,
    ],
  ]
  it.each(vectors)('%s', (_n, seed, key, expected) => {
    expect(drawRandom(seed, key)).toBe(expected)
  })
})

describe('決定性', () => {
  it('反復しても同値', () => {
    const v = drawRandom(1, base)
    for (let i = 0; i < 100; i++) expect(drawRandom(1, base)).toBe(v)
  })

  it('評価順の変更・無関係な抽選の挿入で既存キーの結果が変わらない', () => {
    const keys: RandomKey[] = Array.from({ length: 20 }, (_, i) => ({ ...base, year: 1300 + i }))
    const forward = keys.map((k) => drawRandom(7, k))
    const reversed = [...keys].reverse().map((k) => drawRandom(7, k)).reverse()
    expect(reversed).toEqual(forward)
    const interleaved = keys.map((k, i) => {
      drawRandom(7, { ...base, ruleId: `OTHER-${i}` })
      drawRandom(99, k)
      return drawRandom(7, k)
    })
    expect(interleaved).toEqual(forward)
  })

  it('同じ外生キーは別々の履歴計算（別オブジェクト・別順序）で同値', () => {
    const historyA = [{ ...base, year: 1301 }, { ...base }].map((k) => drawRandom(5, k))
    const historyB = [{ ...base }, { ...base, year: 1301 }].map((k) => drawRandom(5, k))
    expect(historyA[1]).toBe(historyB[0])
    expect(historyA[0]).toBe(historyB[1])
  })

  it('プロパティ列挙順やキー外の追加プロパティに影響されない', () => {
    const reordered = {
      eventKey: 'weather', targetId: null, actorId: 'region-1', ruleId: 'RULE-C-002',
      phase: 'PRODUCTION', year: 1300, stream: 'EXOGENOUS',
      branchId: 'A1', score: 0.9,
    } as RandomKey
    expect(drawRandom(20261028, reordered)).toBe(drawRandom(20261028, base))
  })
})

describe('符号化', () => {
  it('seed・stream・各要素が値に影響する', () => {
    const v = drawRandom(1, base)
    const variants: [number, RandomKey][] = [
      [2, base],
      [1, { ...base, stream: 'ENDOGENOUS' }],
      [1, { ...base, year: 1301 }],
      [1, { ...base, phase: 'TAX' }],
      [1, { ...base, ruleId: 'RULE-C-003' }],
      [1, { ...base, actorId: 'region-2' }],
      [1, { ...base, targetId: 'x' }],
      [1, { ...base, eventKey: 'other' }],
    ]
    for (const [s, k] of variants) expect(drawRandom(s, k)).not.toBe(v)
  })

  it('フィールド境界が曖昧にならない', () => {
    const k = (actorId: string | null, targetId: string | null): RandomKey => ({
      ...base, actorId, targetId, eventKey: null,
    })
    expect(drawRandom(1, k('ab', 'c'))).not.toBe(drawRandom(1, k('a', 'bc')))
    expect(drawRandom(1, k('a|b', null))).not.toBe(drawRandom(1, k('a', 'b')))
    expect(drawRandom(1, k('ab', null))).not.toBe(drawRandom(1, k(null, 'ab')))
    expect(encodeRandomInput(1, k('ab', 'c'))).not.toEqual(encodeRandomInput(1, k('a', 'bc')))
  })

  it('バイト列レイアウト（長さ接頭辞・stream・null タグ）', () => {
    const bytes = encodeRandomInput(0x0102, {
      stream: 'ENDOGENOUS', year: 2, phase: 'P', ruleId: 'R', actorId: null, targetId: 'T', eventKey: null,
    })
    const expected = [
      1, 0, 0, 0, 16, ...text(rngVersion),
      0, 0, 0, 0, 0, 0, 1, 2,
      1,
      0, 0, 0, 2,
      1, 0, 0, 0, 1, 0x50,
      1, 0, 0, 0, 1, 0x52,
      0,
      1, 0, 0, 0, 1, 0x54,
      0,
    ]
    expect([...bytes]).toEqual(expected)
  })
})

describe('値域と不正入力', () => {
  it('有限で 0 以上 1 未満', () => {
    let min = 1
    let max = 0
    for (let i = 0; i < 2000; i++) {
      const v = drawRandom(i, { ...base, year: i })
      expect(Number.isFinite(v)).toBe(true)
      expect(v).toBeGreaterThanOrEqual(0)
      expect(v).toBeLessThan(1)
      min = Math.min(min, v)
      max = Math.max(max, v)
    }
    expect(min).toBeLessThan(0.05)
    expect(max).toBeGreaterThan(0.95)
  })

  it.each([-1, 1.5, NaN, Infinity, 2 ** 53, '1' as unknown as number])('不正 seed %s', (seed) => {
    expect(() => drawRandom(seed, base)).toThrow(RangeError)
  })

  it.each([1.5, NaN, Infinity, 2 ** 31, -(2 ** 31) - 1, '1300' as unknown as number])(
    '不正 year %s',
    (year) => {
      expect(() => drawRandom(1, { ...base, year })).toThrow(RangeError)
    },
  )

  it('負の year（int32 範囲内）は許容し、正の year と異なる', () => {
    expect(drawRandom(1, { ...base, year: -1 })).not.toBe(drawRandom(1, { ...base, year: 1 }))
  })

  it('不正 stream・空文字列・undefined・不正サロゲートを拒否', () => {
    expect(() => drawRandom(1, { ...base, stream: 'X' as never })).toThrow(RangeError)
    expect(() => drawRandom(1, { ...base, stream: 'toString' as never })).toThrow(RangeError)
    expect(() => drawRandom(1, { ...base, phase: '' })).toThrow(RangeError)
    expect(() => drawRandom(1, { ...base, ruleId: '' })).toThrow(RangeError)
    expect(() => drawRandom(1, { ...base, actorId: '' })).toThrow(RangeError)
    expect(() => drawRandom(1, { ...base, targetId: undefined as never })).toThrow(RangeError)
    expect(() => drawRandom(1, { ...base, eventKey: '\uD800' })).toThrow(RangeError)
    expect(() => drawRandom(1, { ...base, ruleId: 5 as never })).toThrow(RangeError)
  })
})
