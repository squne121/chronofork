// 内容比較用の正規化（キー順非依存・undefined 無視）。冪等性の「同内容」判定と差分検出に使う。
export function canonicalize(value: unknown): string {
  if (value === undefined) return 'undefined'
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'undefined'
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(',')}}`
}

/**
 * 外部オブジェクトと一切共有しない深い複製（plain object / 配列 / プリミティブのみ）。
 * undefined 値のキーは落とす。関数・Map・クラスインスタンス等は拒否（例外）。
 */
export function cloneData<T>(value: T): T {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'function' || typeof value === 'symbol' || typeof value === 'bigint') {
      throw new TypeError(`複製できない値です: ${typeof value}`)
    }
    return value
  }
  if (Array.isArray(value)) return value.map((v) => cloneData(v)) as T
  const proto = Object.getPrototypeOf(value)
  if (proto !== Object.prototype && proto !== null) throw new TypeError('plain object ではない値は複製できません')
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => [k, cloneData(v)]),
  ) as T
}
