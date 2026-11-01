// 閲覧 API。年単位で snapshot / Event / Trace と出典を返す。未計算年は UNCOMPUTED（作らない）。
import type { Year } from '../contracts/index.ts'
import type { StateChange } from '../contracts/index.ts'
import { diffWorld } from '../engine/reducer/index.ts'
import type { Branch, YearRead, YearSource } from './types.ts'

export function yearSourceOf(branch: Branch, year: Year): YearSource {
  if (branch.forkYear === null) return 'ROOT'
  return year < branch.forkYear ? 'INHERITED_PREFIX' : year === branch.forkYear ? 'FORK_POINT' : 'RECOMPUTED'
}

export function readYear(branch: Branch, year: Year): YearRead {
  const snapshot = Number.isSafeInteger(year) ? branch.snapshots[year - branch.startYear] : undefined
  if (snapshot === undefined || year < branch.startYear) {
    const beyond = Number.isSafeInteger(year) && branch.status === 'HALTED' && year > branch.startYear
    return { status: 'UNCOMPUTED', year, reason: beyond ? 'NOT_COMPUTED_AFTER_HALT' : 'OUT_OF_RANGE' }
  }
  const last = branch.snapshots[branch.snapshots.length - 1]?.year
  const hasTransition = last !== undefined && year < last
  return {
    status: 'COMPUTED',
    year,
    source: yearSourceOf(branch, year),
    snapshot,
    transition: hasTransition
      ? { events: branch.eventLog.filter((e) => e.year === year), traces: branch.decisionTraces.filter((t) => t.year === year) }
      : null,
  }
}

/** 計算済みの年初（昇順）。 */
export const computedYears = (branch: Branch): readonly Year[] => branch.snapshots.map((s) => s.year)

export type YearDiff =
  | Readonly<{ status: 'DIFFERENCE'; year: Year; changes: readonly StateChange[] }>
  | Readonly<{ status: 'UNCOMPUTED'; year: Year }>

/** 同年初の客観的な状態差分のみ（diffWorld）。意味づけ・勝敗・Event 同一性の推論はしない。 */
export function diffBranchesAtYear(a: Branch, b: Branch, year: Year): YearDiff {
  const x = readYear(a, year)
  const y = readYear(b, year)
  if (x.status !== 'COMPUTED' || y.status !== 'COMPUTED') return { status: 'UNCOMPUTED', year }
  return { status: 'DIFFERENCE', year, changes: diffWorld(x.snapshot, y.snapshot) }
}
