// 1250 年初期シナリオ専用の規模検証（DEC-014）。
// 後年の WorldState に「常に 8 人」等を要求しないため、validateWorldState とは分離している。
import type { WorldState } from '../contracts/index.ts'
import { START_YEAR } from '../contracts/index.ts'
import type { Diagnostic } from './diagnostics.ts'

export const INITIAL_SCALE = Object.freeze({
  countries: 3,
  regions: 6,
  groups: 10,
  houses: 6,
  persons: 8,
})

export function validateInitialScale(world: WorldState): Diagnostic[] {
  const out: Diagnostic[] = []
  const check = (label: string, path: string, actual: number, expected: number) => {
    if (actual !== expected) {
      out.push({
        code: 'INITIAL_SCALE_MISMATCH',
        severity: 'ERROR',
        path,
        target: null,
        message: `初期世界の${label}は ${expected} です（実際: ${actual}）`,
        related: [],
      })
    }
  }
  check('年', '$.year', world.year, START_YEAR)
  check('国家数', '$.countries', world.countries.length, INITIAL_SCALE.countries)
  check('地域数', '$.regions', world.regions.length, INITIAL_SCALE.regions)
  check('人口集団数', '$.groups', world.groups.length, INITIAL_SCALE.groups)
  check('家門数', '$.houses', world.houses.length, INITIAL_SCALE.houses)
  check('重要人物数', '$.persons', world.persons.length, INITIAL_SCALE.persons)
  return out
}
