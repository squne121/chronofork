/**
 * 決定的乱数（契約 §7 / 仕様 §6 / DEC-026・DEC-037）。
 *
 * `drawRandom(seed, key)` は (seed, key) のみから値を定める同期の純粋関数。
 * 可変状態・Math.random・Date.now・Registry には依存しない。
 * RuleID が Registry の 37 件に存在するかの検証は呼出側の責務。
 *
 * rngVersion `chronofork-rng-1`:
 *   message = field(DOMAIN) ‖ u64be(seed) ‖ u8(stream) ‖ i32be(year)
 *             ‖ field(phase) ‖ field(ruleId) ‖ opt(actorId) ‖ opt(targetId) ‖ opt(eventKey)
 *   field(s) = 0x01 ‖ u32be(UTF-8 バイト長) ‖ UTF-8 バイト列
 *   opt(null) = 0x00 / opt(s) = field(s)
 *   digest = SHA-256(message)。先頭 8 バイトの上位 53 bit を 2^53 で割った値を返す。
 * 各可変長フィールドは長さ接頭辞付きで、連結の曖昧さ（"ab"+"c" と "a"+"bc"）が生じない。
 * stream が異なれば値は独立。branchId・配列走査順・状態スコアは鍵に含めない。
 */

export const rngVersion = 'chronofork-rng-1'

export type RandomStream = 'EXOGENOUS' | 'ENDOGENOUS'

export interface RandomKey {
  readonly stream: RandomStream
  /** 整数（int32 範囲）。 */
  readonly year: number
  /** 空でない文字列。 */
  readonly phase: string
  /** 空でない文字列。Registry 照合はしない。 */
  readonly ruleId: string
  /** 空でない文字列、または欠損を表す null。 */
  readonly actorId: string | null
  readonly targetId: string | null
  readonly eventKey: string | null
}

const STREAM_CODE: Readonly<Record<RandomStream, number>> = {
  EXOGENOUS: 0,
  ENDOGENOUS: 1,
}

const encoder = new TextEncoder()
const LONE_SURROGATE = /[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/

function requireString(name: string, value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new RangeError(`${name} は空でない文字列でなければならない`)
  }
  if (LONE_SURROGATE.test(value)) {
    throw new RangeError(`${name} に不正なサロゲートが含まれる`)
  }
  return value
}

function u32(n: number): number[] {
  return [(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]
}

function field(bytes: Uint8Array): number[] {
  return [1, ...u32(bytes.length), ...bytes]
}

function optional(name: string, value: unknown): number[] {
  if (value === null) return [0]
  return field(encoder.encode(requireString(name, value)))
}

/** 鍵を曖昧さのないバイト列へ符号化する（検証を含む）。テスト用に公開。 */
export function encodeRandomInput(seed: number, key: RandomKey): Uint8Array {
  if (!Number.isSafeInteger(seed) || seed < 0) {
    throw new RangeError('seed は 0 以上の安全な整数でなければならない')
  }
  if (!Object.hasOwn(STREAM_CODE, key.stream)) {
    throw new RangeError('stream は EXOGENOUS または ENDOGENOUS でなければならない')
  }
  if (!Number.isInteger(key.year) || key.year < -0x80000000 || key.year > 0x7fffffff) {
    throw new RangeError('year は int32 範囲の整数でなければならない')
  }
  const bytes = [
    ...field(encoder.encode(rngVersion)),
    ...u32(Math.floor(seed / 2 ** 32)),
    ...u32(seed >>> 0),
    STREAM_CODE[key.stream],
    ...u32(key.year >>> 0),
    ...field(encoder.encode(requireString('phase', key.phase))),
    ...field(encoder.encode(requireString('ruleId', key.ruleId))),
    ...optional('actorId', key.actorId),
    ...optional('targetId', key.targetId),
    ...optional('eventKey', key.eventKey),
  ]
  return Uint8Array.from(bytes)
}

// --- SHA-256 (FIPS 180-4) ---

const K = Uint32Array.from([
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
])

const rotr = (x: number, n: number): number => (x >>> n) | (x << (32 - n))

/** SHA-256 ダイジェスト（32 バイト）。テストで NIST 参照値と照合する。 */
export function sha256(message: Uint8Array): Uint8Array {
  const padded = new Uint8Array((((message.length + 9 + 63) >> 6) << 6))
  padded.set(message)
  padded[message.length] = 0x80
  const view = new DataView(padded.buffer)
  view.setUint32(padded.length - 8, Math.floor(message.length / 2 ** 29))
  view.setUint32(padded.length - 4, (message.length << 3) >>> 0)

  const h = Uint32Array.from([
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ])
  const w = new Uint32Array(64)
  for (let off = 0; off < padded.length; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4)
    for (let i = 16; i < 64; i++) {
      const s0 = rotr(w[i - 15], 7) ^ rotr(w[i - 15], 18) ^ (w[i - 15] >>> 3)
      const s1 = rotr(w[i - 2], 17) ^ rotr(w[i - 2], 19) ^ (w[i - 2] >>> 10)
      w[i] = (w[i - 16] + s0 + w[i - 7] + s1) >>> 0
    }
    let [a, b, c, d, e, f, g, hh] = h
    for (let i = 0; i < 64; i++) {
      const t1 =
        (hh + (rotr(e, 6) ^ rotr(e, 11) ^ rotr(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + w[i]) >>> 0
      const t2 = ((rotr(a, 2) ^ rotr(a, 13) ^ rotr(a, 22)) + ((a & b) ^ (a & c) ^ (b & c))) >>> 0
      hh = g
      g = f
      f = e
      e = (d + t1) >>> 0
      d = c
      c = b
      b = a
      a = (t1 + t2) >>> 0
    }
    h[0] += a
    h[1] += b
    h[2] += c
    h[3] += d
    h[4] += e
    h[5] += f
    h[6] += g
    h[7] += hh
  }
  const out = new Uint8Array(32)
  const outView = new DataView(out.buffer)
  h.forEach((v, i) => outView.setUint32(i * 4, v))
  return out
}

/** [0, 1) の有限値を返す。同じ (seed, key) なら常に同値。不正入力は RangeError。 */
export function drawRandom(seed: number, key: RandomKey): number {
  const digest = sha256(encodeRandomInput(seed, key))
  const view = new DataView(digest.buffer)
  const high = view.getUint32(0)
  const low = view.getUint32(4)
  return (high * 2 ** 21 + (low >>> 11)) / 2 ** 53
}
