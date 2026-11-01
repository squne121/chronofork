import { describe, expect, it } from 'vitest'
import { createExperimentalWorld } from '../../../src/scenario/experimental/index.ts'
import type {
  CrossDomainRequest,
  Marriage,
  Source,
  WorldState,
} from '../../../src/simulation/contracts/index.ts'
import { COMMAND_WRITE_OWNER } from '../../../src/simulation/contracts/index.ts'
import { validateWorldState } from '../../../src/simulation/validation/index.ts'
import { codes, editedWorld } from './helpers.ts'

const source: Source = { requestId: 'r', year: 1250, phase: 3, sourceRuleId: 'B-001', sourceTraceId: 't' }

describe('DeferredEffect の施行年', () => {
  const deferredAt = (year: number) => editedWorld((w) => {
    w.deferred.push({ deferredId: 'd', source, effectiveFromYear: year, payload: { kind: 'SUPPORT_SIGNAL', groupId: 'group-west-elite', houseId: 'house-vargas', signal: 1, causeEventId: 'e' } })
  })
  it('source.year + 1 のみ受理する', () => {
    expect(validateWorldState(deferredAt(1251)).ok).toBe(true)
  })
  it.each([1250, 1252, 1260])('%i 年施行は拒否する', (y) => {
    const r = validateWorldState(deferredAt(y))
    expect(codes(r.diagnostics)).toContain('INVALID_PERIOD')
  })
})

describe('FORCE_HEADCOUNT は集団由来の単一 ForcePool', () => {
  const world: WorldState = createExperimentalWorld()
  const pools = world.resources.filter((a) => a.kind === 'FORCE_HEADCOUNT')
  it('初期世界の兵源は集団所有で sourceGroupId を持ち、国家別の兵源は無い', () => {
    expect(pools.length).toBeGreaterThan(0)
    for (const a of pools) {
      expect(a.ownerRef.kind).toBe('GROUP')
      expect(a.sourceGroupId).toBe(a.ownerRef.id)
    }
    expect(new Set(pools.map((a) => a.sourceGroupId)).size).toBe(pools.length) // 排他: 集団ごとに 1 つ
    for (const a of pools) {
      const g = world.groups.find((x) => x.groupId === a.sourceGroupId)
      expect(g && a.quantity <= g.population).toBe(true)
      expect(a.sourceRegionId).toBe(g?.regionId)
    }
  })
  const firstForce = (w: { resources: { kind: string }[] }) => w.resources.findIndex((a) => a.kind === 'FORCE_HEADCOUNT')
  it('国家所有の FORCE_HEADCOUNT を拒否する', () => {
    const r = validateWorldState(editedWorld((w) => {
      w.resources[firstForce(w)]!.ownerRef = { kind: 'COUNTRY', id: 'country-eldia' }
    }))
    expect(codes(r.diagnostics)).toContain('FORCE_POOL_SOURCE_INVALID')
  })
  it('sourceGroupId 欠落・不一致を拒否する', () => {
    const missing = validateWorldState(editedWorld((w) => { Reflect.deleteProperty(w.resources[firstForce(w)]!, 'sourceGroupId') }))
    expect(codes(missing.diagnostics)).toContain('FORCE_POOL_SOURCE_INVALID')
    const mismatch = validateWorldState(editedWorld((w) => { w.resources[firstForce(w)]!.sourceGroupId = 'group-versa' }))
    expect(codes(mismatch.diagnostics)).toContain('FORCE_POOL_SOURCE_INVALID')
  })
  it('sourceRegionId が集団の地域と不一致なら拒否する', () => {
    const r = validateWorldState(editedWorld((w) => { w.resources[firstForce(w)]!.sourceRegionId = 'region-versa-coast' }))
    expect(codes(r.diagnostics)).toContain('FORCE_POOL_SOURCE_INVALID')
  })
  it('同一集団の Pool 重複（重複計上）を拒否する', () => {
    const r = validateWorldState(editedWorld((w) => {
      const base = w.resources[firstForce(w)]!
      w.resources.push({ ...base, accountId: 'acct-force-dup', quantity: 1 })
    }))
    expect(codes(r.diagnostics)).toContain('FORCE_POOL_DUPLICATE')
  })
  it('兵源が人口を超える場合を拒否する', () => {
    const r = validateWorldState(editedWorld((w) => {
      const a = w.resources[firstForce(w)]!
      a.quantity = (w.groups.find((g) => g.groupId === a.sourceGroupId)?.population ?? 0) + 1
    }))
    expect(codes(r.diagnostics)).toContain('FORCE_POOL_EXCEEDS_POPULATION')
  })
})

describe('CrossDomainRequest の判別可能 union', () => {
  const base = { source, targetDomain: 'C', requiredResponseYear: 1250 } as const
  it('kind と payload.kind が一致する組合せのみコンパイルできる', () => {
    const ok: CrossDomainRequest = { ...base, kind: 'COHORT_SLOT_CLAIM', payload: { kind: 'COHORT_SLOT_CLAIM', groupId: 'g', year: 1250, births: 1, deaths: 0 } }
    const check = () => {
      // @ts-expect-error kind と payload.kind が不一致
      const mismatch: CrossDomainRequest = { ...base, kind: 'CASUALTY_NOTICE', payload: { kind: 'COHORT_SLOT_CLAIM', groupId: 'g', year: 1250, births: 1, deaths: 0 } }
      return mismatch
    }
    expect(ok.payload.kind).toBe(ok.kind)
    expect(typeof check).toBe('function')
  })
})

describe('TAX_MANDATE_SET の書込 owner', () => {
  it('徴税権の法的確定は A、台帳は現金取引のみ（混同しない）', () => {
    expect(COMMAND_WRITE_OWNER.TAX_MANDATE_SET).toBe('A_LEGAL')
    expect(COMMAND_WRITE_OWNER.RESOURCE_TRANSACTION).toBe('RESOURCE_LEDGER_REDUCER')
  })
})

describe('Marriage の明示契約条項・証拠', () => {
  const marriage = (extra: Partial<Marriage> = {}): Marriage => ({
    marriageId: 'm1', personIds: ['person-exp-02', 'person-exp-03'], registeredYear: 1250, status: 'ACTIVE', ...extra,
  })
  const withMarriage = (m: Marriage) => editedWorld((w) => { w.legal.marriages.push(JSON.parse(JSON.stringify(m))) })
  it('契約なし（条項なし）の婚姻を受理し、帰属を推定しない', () => {
    const r = validateWorldState(withMarriage(marriage()))
    expect(r.ok).toBe(true)
    expect(r.world?.legal.marriages[0]?.contract).toBeUndefined()
  })
  it('明示条項と証拠を保持して往復できる', () => {
    const contract = { contractId: 'c1', evidenceId: 'ev1', clauses: [{ clauseId: 'cl1', kind: 'CHILD_LEGAL_DYNASTY' as const, dynastyId: 'dynasty-vargas' }] }
    const r = validateWorldState(withMarriage(marriage({ contract })))
    expect(r.ok).toBe(true)
    expect(r.world?.legal.marriages[0]?.contract).toEqual(contract)
  })
  it('存在しない王朝を指す条項を拒否する', () => {
    const contract = { contractId: 'c1', evidenceId: 'ev1', clauses: [{ clauseId: 'cl1', kind: 'CHILD_LEGAL_DYNASTY' as const, dynastyId: 'dynasty-none' }] }
    expect(codes(validateWorldState(withMarriage(marriage({ contract }))).diagnostics)).toContain('DANGLING_REF')
  })
  it('矛盾する条項は優先順位を自動決定せず拒否する', () => {
    const contract = { contractId: 'c1', evidenceId: 'ev1', clauses: [
      { clauseId: 'a', kind: 'CHILD_LEGAL_DYNASTY' as const, dynastyId: 'dynasty-vargas' },
      { clauseId: 'b', kind: 'CHILD_LEGAL_DYNASTY' as const, dynastyId: 'dynasty-cardon' },
    ] }
    expect(codes(validateWorldState(withMarriage(marriage({ contract }))).diagnostics)).toContain('MARRIAGE_CLAUSE_CONFLICT')
  })
  it('証拠 ID 欠落を拒否する', () => {
    const r = validateWorldState(editedWorld((w) => {
      w.legal.marriages.push({ marriageId: 'm1', personIds: ['person-exp-02', 'person-exp-03'], registeredYear: 1250, status: 'ACTIVE', contract: { contractId: 'c1', clauses: [] } } as never)
    }))
    expect(codes(r.diagnostics)).toContain('MISSING_FIELD')
  })
})
