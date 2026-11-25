import { createMultiHouseDemandWorld, digestMultiHouseIdentity, multiHouseDemandRunConfigIdentity } from '../../../scenario/experimental/index.ts'
import { GOAL_YEAR, START_YEAR } from '../../../simulation/contracts/index.ts'
import { rngVersion } from '../../../simulation/random.ts'
import { EXPERIMENTAL_TUNING } from '../../../simulation/tuning.ts'
import type { TimelineRun } from '../../timeline-source.ts'
import type { WorldState } from '../../../simulation/contracts/index.ts'

export type PlayConfiguration = 'LIMITED_PLAYTEST'
export const LIMITED_PLAYTEST_SEED = 20260303
export const LIMITED_PLAYTEST_DRIFT = 0

// キャッシュ・転送境界では、短い digest だけでなく SIM の構成全体を照合する。
let config: Readonly<{ configId: string; configDigest: string; configIdentity: string }> | undefined
export function limitedPlayConfig() {
  if (config === undefined) {
    const identity = multiHouseDemandRunConfigIdentity(LIMITED_PLAYTEST_DRIFT)
    if (typeof identity.configId !== 'string') throw new Error('限定試遊構成に ID がありません')
    config = Object.freeze({
      configId: identity.configId,
      configDigest: digestMultiHouseIdentity(identity),
      configIdentity: JSON.stringify(identity),
    })
  }
  return config
}

let modelKey: string | undefined
/** 枝・seed の検証に加え、年初 snapshot のモデルと確定境界を照合する。 */
export function isLimitedYearStart(world: WorldState, year: number): boolean {
  modelKey ??= createMultiHouseDemandWorld(LIMITED_PLAYTEST_DRIFT).pairTrustModelKey
  return modelKey !== undefined && world.year === year && world.pairTrustDrift === LIMITED_PLAYTEST_DRIFT
    && world.pairTrustModelKey === modelKey && world.pairTrustThroughYear === year - 1
}

export const hasDemandTrust = (world: WorldState): boolean =>
  world.pairTrustDrift !== undefined || world.pairTrustModelKey !== undefined || world.pairTrustThroughYear !== undefined

/** 通常の every は疎配列の欠番を検査しない。Worker DTO の必須列はこちらを使う。 */
export function denseArray<T>(items: readonly T[], accepts: (item: T, index: number) => boolean): boolean {
  if (!Array.isArray(items)) return false
  for (let index = 0; index < items.length; index++) {
    const item = items[index]
    if (item == null || !accepts(item, index)) return false
  }
  return true
}

export function isLimitedTimeline(run: TimelineRun, branchId: 'A0-play' | 'A1-play'): boolean {
  const { inputs, result } = run
  const config = limitedPlayConfig()
  return inputs.seed === LIMITED_PLAYTEST_SEED && result.seed === inputs.seed && result.branchId === branchId
    && inputs.configId === config.configId && inputs.configDigest === config.configDigest && inputs.configIdentity === config.configIdentity
    && inputs.rngVersion === rngVersion && result.rngVersion === rngVersion && inputs.rulesetVersion === EXPERIMENTAL_TUNING.rulesetVersion
    && !run.pending && result.status === 'COMPLETED' && result.halt === null && result.goal === null
    && result.startYear === START_YEAR && result.transitions === GOAL_YEAR - START_YEAR
    && isLimitedYearStart(run.initialWorld, START_YEAR) && result.snapshots.length === GOAL_YEAR - START_YEAR + 1
    && denseArray(result.snapshots, (world, i) => isLimitedYearStart(world, START_YEAR + i) && Array.isArray(world.persons))
    && denseArray(result.eventLog, e => typeof e.eventId === 'string' && e.year >= START_YEAR && e.year < GOAL_YEAR)
    && denseArray(result.decisionTraces, t => typeof t.traceId === 'string' && t.year >= START_YEAR && t.year < GOAL_YEAR)
}

export function isCompleteLimitedA0(run: TimelineRun): boolean {
  return !run.logsOmitted && run.playLedger?.length === 0 && run.playModifierIds?.length === 0 && isLimitedTimeline(run, 'A0-play')
}
