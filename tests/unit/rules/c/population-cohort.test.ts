import { describe, expect, it } from 'vitest'
import { createExperimentalWorld } from '../../../../src/scenario/experimental/index.ts'
import type { WorldState } from '../../../../src/simulation/contracts/index.ts'
import { applyOutcome, createTransaction } from '../../../../src/simulation/engine/reducer/index.ts'
import {
  cohortCommandId,
  cohortRequestId,
  decomposePopulation,
  evaluatePopulationCohorts,
} from '../../../../src/simulation/rules/c/index.ts'
import { getRule } from '../../../../src/simulation/rule-registry.ts'
import { EXPERIMENTAL_TUNING } from '../../../../src/simulation/tuning.ts'
import type { TuningConfig } from '../../../../src/simulation/tuning.ts'

// 試験専用の係数。契約 §4 の「人口1000・出生20・自然死16→1004」を再現するためだけの値で、
// 正式なゲーム設定へは昇格しない（TuningConfig は CALIBRATION_ONLY のまま）。
const FIXTURE_TUNING: TuningConfig = {
  ...EXPERIMENTAL_TUNING,
  birthRatePermille: { value: 20, origin: 'PLACEHOLDER', note: '試験専用: P=1000 で B=20' },
  growthRatePermille: { value: 4, origin: 'PLACEHOLDER', note: '試験専用: P=1000 で delta=+4' },
}

const withPopulations = (w: WorldState, pops: Record<string, number>): WorldState => ({
  ...w,
  groups: w.groups.map((g) => (g.groupId in pops ? { ...g, population: pops[g.groupId] as number } : g)),
})

const GID = 'group-central-elite'
const world1000 = (): WorldState => withPopulations(createExperimentalWorld(), { [GID]: 1000 })
const deepFreeze = <T>(v: T): T => {
  if (typeof v === 'object' && v !== null && !Object.isFrozen(v)) {
    Object.freeze(v)
    for (const x of Object.values(v)) deepFreeze(x)
  }
  return v
}
const apply = (w: WorldState, o: ReturnType<typeof evaluatePopulationCohorts>['outcome'], tx = createTransaction({ branchId: 'main', year: w.year })) =>
  applyOutcome(w, o, { transaction: tx })

describe('RULE-C-004 暫定分解式', () => {
  it('P=1000, b=20‰, g=4‰ → delta=4, B=20, N=16', () => {
    expect(decomposePopulation(1000, 20, 4)).toEqual({ delta: 4, birthSlots: 20, deathSlots: 16 })
  })
  it('B は delta を下回らない（増加が出生率を上回る場合 N=0）', () => {
    expect(decomposePopulation(1000, 1, 50)).toEqual({ delta: 50, birthSlots: 50, deathSlots: 0 })
  })
  it('負の成長でも B>=0・N=B−delta で人口が負にならない', () => {
    const s = decomposePopulation(1000, 10, -20)
    expect(s).toEqual({ delta: -20, birthSlots: 10, deathSlots: 30 })
    expect(1000 + s.birthSlots - s.deathSlots).toBe(980)
  })
  it('.5 は切り上げ、人口 0 は 0 枠', () => {
    expect(decomposePopulation(25, 20, 0).birthSlots).toBe(1) // 0.5 → 1
    expect(decomposePopulation(0, 30, 2)).toEqual({ delta: 0, birthSlots: 0, deathSlots: 0 })
  })
})

describe('evaluatePopulationCohorts', () => {
  it('Group ごとに型付き POPULATION_COHORT を 1 件ずつ生成する（係数は TuningConfig 由来）', () => {
    const w = world1000()
    const r = evaluatePopulationCohorts(w, FIXTURE_TUNING)
    expect(r.ok).toBe(true)
    expect(r.diagnostics).toEqual([])
    expect(r.outcome.ruleId).toBe('RULE-C-004')
    expect(r.outcome.phase).toBe(1)
    expect(r.outcome.commands).toHaveLength(w.groups.length)
    expect(r.outcome.commands.every((c) => c.type === 'POPULATION_COHORT')).toBe(true)
    const c = r.outcome.commands.find((x) => x.type === 'POPULATION_COHORT' && x.groupId === GID)
    expect(c).toMatchObject({ birthSlots: 20, deathSlots: 16, year: w.year })
    // 係数を変えれば結果が変わる = 係数がハードコードされていない。
    const other = evaluatePopulationCohorts(w, { ...FIXTURE_TUNING, birthRatePermille: { ...FIXTURE_TUNING.birthRatePermille, value: 40 } })
    expect(other.allocations.find((a) => a.groupId === GID)?.birthSlots).toBe(40)
  })

  it('決定的: 同一入力で完全一致し、Group の配列順に依存しない', () => {
    const w = world1000()
    const a = evaluatePopulationCohorts(w, FIXTURE_TUNING)
    const b = evaluatePopulationCohorts(w, FIXTURE_TUNING)
    const reversed = evaluatePopulationCohorts({ ...w, groups: [...w.groups].reverse() }, FIXTURE_TUNING)
    expect(b).toEqual(a)
    expect(reversed).toEqual(a)
  })

  it('入力不変: 深く凍結した world / tuning を受け取っても変更・例外なし', () => {
    const w = deepFreeze(structuredClone(world1000()))
    const t = deepFreeze(structuredClone(FIXTURE_TUNING))
    const before = JSON.stringify([w, t])
    expect(() => evaluatePopulationCohorts(w, t)).not.toThrow()
    expect(JSON.stringify([w, t])).toBe(before)
  })

  it('Source / ID は 年・RuleID・Group・意味的原因から決定的で Group ごとに一意、batchId は使わない', () => {
    const w = world1000()
    const { outcome } = evaluatePopulationCohorts(w, FIXTURE_TUNING)
    const reqs = outcome.commands.map((c) => c.source.requestId)
    const cmds = outcome.commands.map((c) => c.commandId)
    expect(new Set(reqs).size).toBe(reqs.length)
    expect(new Set(cmds).size).toBe(cmds.length)
    expect(new Set(outcome.commands.map((c) => c.source.sourceTraceId)).size).toBe(reqs.length)
    for (const c of outcome.commands) {
      if (c.type !== 'POPULATION_COHORT') throw new Error('unexpected')
      expect(c.source).toMatchObject({ year: w.year, phase: 1, sourceRuleId: 'RULE-C-004', requestId: cohortRequestId(w.year, c.groupId) })
      expect(c.commandId).toBe(cohortCommandId(w.year, c.groupId))
      expect(c.batchId).toBeUndefined()
    }
    expect(cohortRequestId(1250, GID)).toContain('1250')
    expect(cohortRequestId(1250, GID)).toContain('RULE-C-004')
    expect(cohortRequestId(1250, GID)).toContain(GID)
    expect(cohortRequestId(1251, GID)).not.toBe(cohortRequestId(1250, GID))
  })

  it('traceDrafts / requests / deferred は生成しない（Trace・Event 統合は #15 の境界確定後）', () => {
    const { outcome } = evaluatePopulationCohorts(world1000(), FIXTURE_TUNING)
    expect(outcome.traceDrafts).toEqual([])
    expect(outcome.requests).toEqual([])
    expect(outcome.deferred).toEqual([])
  })

  it('37 RuleID の実装済み宣言は変更しない（単体評価器≠年次ランナー組込）', () => {
    expect(getRule('RULE-C-004').implementationStatus).toBe('TODO')
  })
})

describe('applyOutcome との整合（WorldState の変更は reducer に委譲）', () => {
  it('人口1000・出生20・自然死16 → 1004、枠は一重計上', () => {
    const w = world1000()
    const frozen = deepFreeze(structuredClone(w))
    const { outcome } = evaluatePopulationCohorts(frozen, FIXTURE_TUNING)
    const r = apply(frozen, outcome)
    expect(r.status).toBe('APPLIED')
    const g = r.world.groups.find((x) => x.groupId === GID)
    expect(g?.population).toBe(1004)
    const slot = r.world.demographics.cohortSlots.filter((s) => s.groupId === GID && s.year === w.year)
    expect(slot).toEqual([{ groupId: GID, year: w.year, birthSlots: 20, deathSlots: 16, claimedBirths: 0, claimedDeaths: 0 }])
    // 全 Group: 人口 = 元 + B − N、枠は 1 Group 1 件のみ。
    for (const a of evaluatePopulationCohorts(frozen, FIXTURE_TUNING).allocations) {
      expect(r.world.groups.find((x) => x.groupId === a.groupId)?.population).toBe(a.population + a.birthSlots - a.deathSlots)
      expect(r.world.demographics.cohortSlots.filter((s) => s.groupId === a.groupId && s.year === w.year)).toHaveLength(1)
    }
    expect(r.world.demographics.cohortSlots).toHaveLength(w.groups.length)
    // 入力 world は不変。
    expect(w).toEqual(structuredClone(w))
  })

  it('再送は DUPLICATE で二重計上しない（同一 Transaction）', () => {
    const w = world1000()
    const { outcome } = evaluatePopulationCohorts(w, FIXTURE_TUNING)
    const first = apply(w, outcome)
    expect(first.status).toBe('APPLIED')
    const again = applyOutcome(first.world, outcome, { transaction: first.transaction })
    expect(again.status).toBe('DUPLICATE')
    expect(again.world.groups.find((x) => x.groupId === GID)?.population).toBe(1004)
    expect(again.world.demographics.cohortSlots).toHaveLength(w.groups.length)
  })

  it('新しい Transaction で再送しても reducer が COHORT_ALREADY_SET で拒否し、人口は 1004 のまま', () => {
    const w = world1000()
    const { outcome } = evaluatePopulationCohorts(w, FIXTURE_TUNING)
    const first = apply(w, outcome)
    const again = apply(first.world, outcome, createTransaction({ branchId: 'main', year: w.year }))
    expect(again.status).not.toBe('APPLIED')
    expect(again.world.groups.find((x) => x.groupId === GID)?.population).toBe(1004)
  })

  it('確定済み Group は再評価で診断付きに保留（コマンドを出さず成功扱いにしない）', () => {
    const w = world1000()
    const first = apply(w, evaluatePopulationCohorts(w, FIXTURE_TUNING).outcome)
    const r = evaluatePopulationCohorts(first.world, FIXTURE_TUNING)
    expect(r.ok).toBe(false)
    expect(r.outcome.commands).toEqual([])
    expect(r.diagnostics.every((d) => d.code === 'COHORT_ALREADY_SET')).toBe(true)
  })
})

describe('不正入力は例外ではなく診断付きで保留', () => {
  const codesOf = (r: ReturnType<typeof evaluatePopulationCohorts>) => r.diagnostics.map((d) => d.code)

  it.each([1349.5, Number.NaN])('整数でない年 %s', (year) => {
    const r = evaluatePopulationCohorts({ ...world1000(), year }, FIXTURE_TUNING)
    expect(r.ok).toBe(false)
    expect(r.outcome.commands).toEqual([])
    expect(codesOf(r)).toContain('INVALID_YEAR')
  })

  it.each([1249, 1350, 1351])('範囲外の年 %i（1350 年は新年度計算を実行しない）', (year) => {
    const r = evaluatePopulationCohorts({ ...world1000(), year }, FIXTURE_TUNING)
    expect(r.ok).toBe(false)
    expect(r.outcome.commands).toEqual([])
    expect(codesOf(r)).toContain('YEAR_OUT_OF_RANGE')
  })

  it('1349 年は評価できる', () => {
    expect(evaluatePopulationCohorts({ ...world1000(), year: 1349 }, FIXTURE_TUNING).ok).toBe(true)
  })

  it('CALIBRATION_ONLY 以外の TuningConfig を拒否', () => {
    const bad = { ...FIXTURE_TUNING, status: 'ADOPTED' } as unknown as TuningConfig
    const r = evaluatePopulationCohorts(world1000(), bad)
    expect(r.ok).toBe(false)
    expect(codesOf(r)).toContain('TUNING_INVALID')
    expect(r.outcome.commands).toEqual([])
  })

  it.each([
    ['小数の出生率', { birthRatePermille: { value: 2.5, origin: 'PLACEHOLDER', note: '' } }],
    ['負の出生率', { birthRatePermille: { value: -1, origin: 'PLACEHOLDER', note: '' } }],
    ['−1000 未満の成長率', { growthRatePermille: { value: -1001, origin: 'PLACEHOLDER', note: '' } }],
  ] as const)('係数不正: %s', (_name, patch) => {
    const r = evaluatePopulationCohorts(world1000(), { ...FIXTURE_TUNING, ...patch } as TuningConfig)
    expect(r.ok).toBe(false)
    expect(codesOf(r)).toContain('TUNING_COEFFICIENT_INVALID')
    expect(r.outcome.commands).toEqual([])
  })

  it('不正な人口の Group のみ除外し、診断を残す', () => {
    const w = world1000()
    const broken: WorldState = {
      ...w,
      groups: w.groups.map((g, i) => (i === 0 ? { ...g, population: -5 } : g)),
    }
    const r = evaluatePopulationCohorts(broken, FIXTURE_TUNING)
    expect(r.ok).toBe(false)
    expect(codesOf(r)).toEqual(['INVALID_POPULATION'])
    expect(r.outcome.commands).toHaveLength(w.groups.length - 1)
  })
})
