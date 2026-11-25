import type { ProgressObserver, SecondPlayInput } from '../../branch-play-source.ts'
import { createWorkerPlayRunner } from '../../play-runner.ts'
import type { ObservationHandle, PlayRunHandle, PlayRunHooks } from '../../play-runner.ts'
import { LIMITED_PLAYTEST_SEED, limitedPlayConfig } from './limited-config.ts'

const selection = {
  mode: 'MULTI_HOUSE_EXPERIMENTAL', configuration: 'LIMITED_PLAYTEST', seed: LIMITED_PLAYTEST_SEED,
} as const

export function limitedObservationInput(year: number) {
  return { ...selection, year }
}

export function limitedComparisonInput(year: number, intervention: SecondPlayInput) {
  const { firstPersonId, secondPersonId, signedDelta, durationYears } = intervention
  return { ...selection, year, firstPersonId, secondPersonId, signedDelta, durationYears }
}

/** 画面の限定試遊入口ごとに作成し、退出時に reset する。通常入口の Worker とは共有しない。 */
export function createLimitedPlaytestSession() {
  const runner = createWorkerPlayRunner()
  return {
    configuration: limitedPlayConfig(),
    seed: LIMITED_PLAYTEST_SEED,
    observe(year: number, onProgress?: ProgressObserver): ObservationHandle {
      return runner.observe(limitedObservationInput(year), onProgress)
    },
    compare(year: number, intervention: SecondPlayInput, onProgress?: ProgressObserver, hooks?: PlayRunHooks): PlayRunHandle {
      return runner(limitedComparisonInput(year, intervention), onProgress, hooks)
    },
    reset: runner.reset,
  } as const
}
