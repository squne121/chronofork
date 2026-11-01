import type { WorldState } from '../../../src/simulation/contracts/index.ts'
import { createExperimentalWorld } from '../../../src/scenario/experimental/index.ts'
import type { Diagnostic } from '../../../src/simulation/validation/index.ts'

export type DeepWritable<T> = T extends readonly (infer U)[]
  ? DeepWritable<U>[]
  : T extends object
    ? { -readonly [K in keyof T]: DeepWritable<T[K]> }
    : T

export function deepFreeze<T>(value: T): T {
  if (typeof value === 'object' && value !== null && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const v of Object.values(value)) deepFreeze(v)
  }
  return value
}

/** 正常な experimental 世界の新しい複製を編集して返す。 */
export function editedWorld(edit: (w: DeepWritable<WorldState>) => void): unknown {
  const w: DeepWritable<WorldState> = createExperimentalWorld() as unknown as DeepWritable<WorldState>
  edit(w)
  return w
}

export function codes(diagnostics: readonly Diagnostic[]): string[] {
  return diagnostics.map((d) => d.code)
}
