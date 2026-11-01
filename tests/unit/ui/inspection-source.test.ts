import { describe, expect, it } from 'vitest'
import { bpsToPercent, goalLabel, indexWorld, loadExperimentalSource } from '../../../src/ui/inspection-source.ts'

describe('読み取り境界', () => {
  const source = loadExperimentalSource()
  const index = indexWorld(source.world)

  it('experimental の 1250 年のみで、評価・ログ・Trace を持たない', () => {
    expect(source.experimental).toBe(true)
    expect(source.world.year).toBe(1250)
    expect(source.goal).toBeUndefined()
    expect(source.events).toBeUndefined()
    expect(source.traces).toBeUndefined()
  })

  it('世界内のすべての参照が解決できる', () => {
    const w = source.world
    for (const r of w.regions) {
      expect(index.countryName(r.sovereignCountryId)).not.toContain('参照不明')
      expect(index.controller(r.deFactoControllerRef).resolved).toBe(true)
      for (const adj of r.adjacentRegionIds) expect(index.link('region', adj).resolved).toBe(true)
    }
    for (const g of w.groups) {
      expect(index.link('region', g.regionId).resolved).toBe(true)
      for (const houseId of Object.keys(g.support.houseBps)) expect(index.houseName(houseId)).not.toContain('参照不明')
    }
    for (const p of w.persons) {
      expect(index.link('group', p.originGroupId).resolved).toBe(true)
      expect(index.houseName(p.houseId)).not.toContain('参照不明')
      for (const parent of [p.fatherId, p.motherId]) {
        if (parent) expect(index.link('person', parent).resolved).toBe(true)
      }
    }
    for (const t of w.titles) {
      expect(index.link('title', t.titleId).resolved).toBe(true)
      expect(index.link('region', t.regionId).resolved).toBe(true)
      if (t.holder.status === 'HELD') expect(index.link('person', t.holder.personId).resolved).toBe(true)
    }
  })

  it('存在しない ID は ID 付きで参照不明と表示する', () => {
    const l = index.link('person', 'person-none')
    expect(l.resolved).toBe(false)
    expect(l.label).toBe('参照不明（person-none）')
  })

  it('支持 bps を % に換算する', () => {
    expect(bpsToPercent(5000)).toBe('50.0%')
    expect(bpsToPercent(1500)).toBe('15.0%')
  })

  it('Goal 未接続では未計算と表示し、勝敗を示さない', () => {
    expect(goalLabel(undefined)).toContain('未計算')
    expect(goalLabel({ status: 'NOT_EVALUABLE', year: 1250 })).toBe('1250年は判定対象外')
  })
})
