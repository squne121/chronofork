import { describe, expect, it } from 'vitest'
import {
  EXPERIMENTAL_PROVENANCE,
  NALVEN_DYNASTY_ID,
  createExperimentalScenario,
  createExperimentalWorld,
} from '../../../src/scenario/experimental/index.ts'
import {
  INITIAL_SCALE,
  validateInitialScale,
  validateWorldState,
} from '../../../src/simulation/validation/index.ts'
import type { DeepWritable } from './helpers.ts'
import { codes, deepFreeze, editedWorld } from './helpers.ts'
import type { WorldState } from '../../../src/simulation/contracts/index.ts'

describe('experimental 初期世界', () => {
  it('正常な初期世界を受理し、診断がなく、規模が 3/6/10/6/8 である', () => {
    const input = createExperimentalWorld()
    const r = validateWorldState(input)
    expect(r.diagnostics).toEqual([])
    expect(r.ok).toBe(true)
    expect(r.world).toEqual(input)
    expect(r.world).not.toBe(input) // 複製であり、入力そのものではない
    expect(validateInitialScale(input)).toEqual([])
    expect(INITIAL_SCALE).toMatchObject({ countries: 3, regions: 6, groups: 10, houses: 6, persons: 8 })
  })

  it('JSON 往復した外部入力も受理する（型アサーションに依存しない）', () => {
    const r = validateWorldState(JSON.parse(JSON.stringify(createExperimentalWorld())))
    expect(r.ok).toBe(true)
  })

  it('由来を区別し、仮値・法的根拠を試験データとして明示する', () => {
    const s = createExperimentalScenario()
    expect(s.status).toBe('EXPERIMENTAL')
    expect(s.tuning.status).toBe('CALIBRATION_ONLY')
    expect(s.versions.rulesetVersion).toBe(s.tuning.rulesetVersion)
    const origins = new Set(EXPERIMENTAL_PROVENANCE.map((e) => e.origin))
    expect(origins).toEqual(new Set(['SPEC_KNOWN', 'PLACEHOLDER']))
    expect(EXPERIMENTAL_PROVENANCE.find((e) => e.subject.startsWith('Title'))?.origin).toBe('PLACEHOLDER')
    expect(EXPERIMENTAL_PROVENANCE.find((e) => e.subject.startsWith('初期 TaxCollectionMandate'))?.origin).toBe('PLACEHOLDER')
  })

  it('国庫 45/100 を 45BU（45000）と断定せず、勝利経路・固定イベントを持たない', () => {
    const s = createExperimentalScenario()
    expect(s.tendencies.eldiaTreasuryOutOf100).toBe(45)
    expect(s.world.resources.some((a) => a.kind === 'CASH_MILLI_BU' && a.quantity === 45 * 1000)).toBe(false)
    expect(s.world.deferred).toEqual([])
    expect(s.world.legal.cases).toEqual([])
    expect(s.world.legal.controlMandates).toEqual([])
  })

  it('既知の不満（西70・東55・南35）が反映される', () => {
    const w = createExperimentalWorld()
    const unrest = (id: string) => w.groups.find((g) => g.groupId === id)?.unrest
    expect(unrest('group-west-elite')).toBe(70)
    expect(unrest('group-east-commons')).toBe(55)
    expect(unrest('group-south-elite')).toBe(35)
    expect(w.persons.every((p) => p.legalDynasty.status === 'DETERMINED')).toBe(true)
    expect(w.legal.dynasties.some((d) => d.dynastyId === NALVEN_DYNASTY_ID)).toBe(true)
  })
})

type Case = readonly [name: string, edit: (w: DeepWritable<WorldState>) => void, code: string]

const REJECTED: readonly Case[] = [
  ['人物 ID 重複', (w) => { w.persons[1]!.personId = w.persons[0]!.personId }, 'DUPLICATE_ID'],
  ['種別違いの ID 衝突', (w) => { w.houses[0]!.houseId = w.countries[0]!.countryId }, 'DUPLICATE_ID'],
  ['親の参照切れ', (w) => { w.persons[1]!.fatherId = 'person-missing' }, 'DANGLING_REF'],
  ['参照種別違い（所属集団に家門 ID）', (w) => { w.persons[0]!.originGroupId = 'house-nalven' }, 'WRONG_REF_KIND'],
  ['参照種別違い（支配者 PERSON に国家 ID）', (w) => { w.regions[0]!.deFactoControllerRef = { kind: 'PERSON', id: 'country-eldia' } }, 'WRONG_REF_KIND'],
  ['親子循環', (w) => { w.persons[0]!.fatherId = 'person-exp-02' }, 'PARENT_CYCLE'],
  ['自己を親とする', (w) => { w.persons[1]!.fatherId = 'person-exp-02' }, 'PARENT_CYCLE'],
  ['親が子より後の生年', (w) => { w.persons[1]!.birthYear = 1200 }, 'PARENT_BIRTH_YEAR_CONTRADICTION'],
  ['死亡年が出生年より前', (w) => { w.persons[3]!.alive = false; w.persons[3]!.deathYear = 1200 }, 'DEATH_BEFORE_BIRTH'],
  ['生存者に死亡年', (w) => { w.persons[3]!.deathYear = 1249 }, 'ALIVE_STATE_CONTRADICTION'],
  ['生存記名人数が人口超過', (w) => { w.groups[0]!.population = 2 }, 'COHORT_CAPACITY_CONFLICT'],
  ['人口が負', (w) => { w.groups[0]!.population = -1 }, 'NOT_NON_NEGATIVE_INTEGER'],
  ['人口が小数', (w) => { w.groups[1]!.population = 100.5 }, 'NOT_NON_NEGATIVE_INTEGER'],
  ['支持 bps 総和が 10000 でない', (w) => { w.groups[0]!.support.undecidedBps += 1 }, 'SUPPORT_BPS_SUM_MISMATCH'],
  ['支持 bps が負', (w) => { w.groups[0]!.support.houseBps['house-nalven'] = -5000; w.groups[0]!.support.undecidedBps = 11500 }, 'NOT_NON_NEGATIVE_INTEGER'],
  ['支持先の家門が存在しない', (w) => { w.groups[0]!.support.houseBps['house-ghost'] = 0 }, 'DANGLING_REF'],
  ['資源が負', (w) => { w.resources[0]!.quantity = -1 }, 'RESOURCE_INVALID_QUANTITY'],
  ['資源が小数', (w) => { w.resources[0]!.quantity = 10.5 }, 'RESOURCE_INVALID_QUANTITY'],
  ['committed が quantity 超過', (w) => { w.resources[1]!.committed = w.resources[1]!.quantity + 1 }, 'RESOURCE_OVER_COMMITTED'],
  ['有効な排他 Title の競合', (w) => {
    w.titles.push({ ...w.titles[2]!, titleId: 'title-exp-west-dup', holder: { status: 'HELD', personId: 'person-exp-05' } })
  }, 'DUPLICATE_EXCLUSIVE_TITLE'],
  ['ACTIVE 承認に権限・根拠が無い', (w) => { delete w.titles[2]!.recognition.authority }, 'RECOGNITION_EVIDENCE_MISSING'],
  ['徴税権の期間重複', (w) => {
    w.legal.taxMandates.push({ ...w.legal.taxMandates[0]!, mandateId: 'tax-exp-dup', collectorCountryId: 'country-margald', effectiveFromYear: 1300 })
  }, 'TAX_AUTHORITY_CONFLICT'],
  ['徴税権の期間が逆転', (w) => { w.legal.taxMandates[0]!.endExclusiveYear = 1250 }, 'INVALID_PERIOD'],
  ['婚姻の組が昇順でない', (w) => {
    w.legal.marriages.push({ marriageId: 'm1', personIds: ['person-exp-02', 'person-exp-01'], registeredYear: 1249, status: 'ACTIVE' })
  }, 'PERSON_PAIR_NOT_NORMALIZED'],
  ['委任の地域が根拠 Title と不一致', (w) => {
    w.legal.controlMandates.push({ mandateId: 'cm1', regionId: 'region-eldia-east', controllerRef: { kind: 'PERSON', id: 'person-exp-04' }, beneficiaryPersonId: 'person-exp-04', authorizingTitleId: 'title-exp-west', sourceEventId: 'e', effectiveFromYear: 1250, endExclusiveYear: 1300 })
  }, 'MANDATE_TITLE_REGION_MISMATCH'],
  ['派生値 treasury の保存', (w) => { Object.assign(w.countries[0]!, { treasury: 45 }) }, 'DERIVED_FIELD_STORED'],
  ['派生値 Region.population の保存', (w) => { Object.assign(w.regions[0]!, { population: 1000 }) }, 'DERIVED_FIELD_STORED'],
  ['派生値 hasTerritorialControl の保存', (w) => { Object.assign(w.titles[0]!, { hasTerritorialControl: true }) }, 'DERIVED_FIELD_STORED'],
  ['未知フィールド', (w) => { Object.assign(w.persons[0]!, { fieldPath: 'x' }) }, 'UNKNOWN_FIELD'],
  ['配列であるべき項目が配列でない', (w) => { Object.assign(w, { persons: 'none' }) }, 'INVALID_TYPE'],
  ['数値に NaN', (w) => { w.groups[0]!.prosperity = NaN }, 'INVALID_TYPE'],
  ['列挙値の不正', (w) => { Object.assign(w.persons[0]!, { sex: 'OTHER' }) }, 'INVALID_ENUM'],
  ['必須フィールド欠落', (w) => { Reflect.deleteProperty(w.persons[0]!, 'houseId') }, 'MISSING_FIELD'],
  ['繰延効果の RuleID が未登録', (w) => {
    w.deferred.push({ deferredId: 'd1', source: { requestId: 'r', year: 1250, phase: 3, sourceRuleId: 'ENGINE-INIT' as 'B-001', sourceTraceId: 't' }, effectiveFromYear: 1251, payload: { kind: 'SUPPORT_SIGNAL', groupId: 'group-west-elite', houseId: 'house-vargas', signal: 1, causeEventId: 'e' } })
  }, 'UNKNOWN_RULE_ID'],
  ['隣接が非対称', (w) => { w.regions[4]!.adjacentRegionIds = [] }, 'ADJACENCY_ASYMMETRIC'],
  ['年初状態の範囲外', (w) => { w.year = 1400 }, 'OUT_OF_RANGE'],
]

describe('不整合の拒否', () => {
  it.each(REJECTED)('%s を原因コード付きで拒否し、入力を変更しない', (_name, edit, code) => {
    const input = deepFreeze(editedWorld(edit)) // 凍結済み入力: 変更しようとすれば TypeError
    const before = JSON.stringify(input)
    const r = validateWorldState(input)
    expect(r.ok).toBe(false)
    expect(r.world).toBeNull()
    expect(codes(r.diagnostics)).toContain(code)
    const hit = r.diagnostics.find((d) => d.code === code)
    expect(hit?.severity).toBe('ERROR')
    expect(hit?.path.startsWith('$')).toBe(true)
    expect(JSON.stringify(input)).toBe(before)
  })

  it('特定可能な原因には target と related が付く', () => {
    const r = validateWorldState(editedWorld((w) => { w.persons[1]!.fatherId = 'person-missing' }))
    const d = r.diagnostics.find((x) => x.code === 'DANGLING_REF')
    expect(d?.target).toEqual({ kind: 'PERSON', id: 'person-exp-02' })
    expect(d?.related).toEqual(['person-missing'])
    const wrong = validateWorldState(editedWorld((w) => { w.persons[0]!.originGroupId = 'house-nalven' }))
    expect(wrong.diagnostics.find((x) => x.code === 'WRONG_REF_KIND')?.message).toContain('HOUSE')
  })

  it('オブジェクトでない入力を拒否する', () => {
    for (const bad of [null, undefined, 42, 'world', []]) {
      const r = validateWorldState(bad)
      expect(r.ok).toBe(false)
      expect(codes(r.diagnostics)).toContain('INVALID_TYPE')
    }
  })

  it('複数の不整合をまとめて報告する', () => {
    const r = validateWorldState(editedWorld((w) => {
      w.persons[1]!.fatherId = 'person-missing'
      w.groups[0]!.support.undecidedBps += 1
      w.resources[0]!.quantity = -1
    }))
    expect(codes(r.diagnostics)).toEqual(expect.arrayContaining(['DANGLING_REF', 'SUPPORT_BPS_SUM_MISMATCH', 'RESOURCE_INVALID_QUANTITY']))
  })
})

describe('PENDING / UNDETERMINED と壊れた参照の区別', () => {
  const pending = (w: DeepWritable<WorldState>) => {
    w.titles[2]!.holder = { status: 'UNDETERMINED', legalCaseId: 'case-west' }
    w.titles[2]!.recognition = { status: 'PENDING', sovereignCountryId: 'country-eldia' }
    w.legal.cases.push({ caseId: 'case-west', titleId: 'title-exp-west', kind: 'SUCCESSION', status: 'PENDING', candidatePersonIds: ['person-exp-04'], reasonCodes: ['AWAITING_APPROVAL'] })
    w.persons[2]!.legalDynasty = { status: 'UNDETERMINED', reasonCodes: ['NO_EVIDENCE'] }
  }

  it('正当な PENDING/UNDETERMINED を受理し、補完・自動実行しない', () => {
    const input = deepFreeze(editedWorld(pending))
    const r = validateWorldState(input)
    expect(r.diagnostics).toEqual([])
    expect(r.ok).toBe(true)
    expect(r.world).toEqual(input) // 保有者・承認・王朝所属・徴税先が変わらない
    expect(r.world?.titles[2]?.holder.status).toBe('UNDETERMINED')
    expect(r.world?.persons[2]?.legalDynasty.status).toBe('UNDETERMINED')
    expect(r.world?.legal.cases).toHaveLength(1)
  })

  it('壊れた参照（未存在の案件 ID）は UNDETERMINED と区別して拒否する', () => {
    const r = validateWorldState(editedWorld((w) => { w.titles[2]!.holder = { status: 'UNDETERMINED', legalCaseId: 'case-ghost' } }))
    expect(codes(r.diagnostics)).toEqual(['DANGLING_REF'])
    const held = validateWorldState(editedWorld((w) => { w.titles[2]!.holder = { status: 'HELD', personId: 'person-ghost' } }))
    expect(codes(held.diagnostics)).toEqual(['DANGLING_REF'])
  })

  it('PENDING 承認の Title 競合は排他違反にしない（争訟の候補が併存し得る）', () => {
    const r = validateWorldState(editedWorld((w) => {
      w.titles.push({ ...w.titles[2]!, titleId: 'title-exp-west-claim', holder: { status: 'UNDETERMINED' }, recognition: { status: 'PENDING' } })
    }))
    expect(r.ok).toBe(true)
  })

  it('徴税先が無い地域は診断（WARNING）のみで、徴税先を補完しない', () => {
    const input = editedWorld((w) => { w.legal.taxMandates = w.legal.taxMandates.filter((m) => m.regionId !== 'region-eldia-east') })
    const r = validateWorldState(input)
    expect(r.ok).toBe(true)
    const d = r.diagnostics.find((x) => x.code === 'UNRESOLVED_TAX_AUTHORITY')
    expect(d?.severity).toBe('WARNING')
    expect(d?.target).toEqual({ kind: 'REGION', id: 'region-eldia-east' })
    expect(r.world?.legal.taxMandates).toHaveLength(5)
  })

  it('死亡した Title 保有者を自動で相続させない', () => {
    const input = editedWorld((w) => { w.persons[3]!.alive = false; w.persons[3]!.deathYear = 1249 })
    const r = validateWorldState(input)
    expect(r.ok).toBe(true)
    expect(r.world?.titles[2]?.holder).toEqual({ status: 'HELD', personId: 'person-exp-04' })
  })
})

describe('初期規模は初期シナリオ検証だけに使う', () => {
  it('初期シナリオの規模違反は validateInitialScale が検出する', () => {
    const w = editedWorld((x) => { x.persons.pop() })
    expect(codes(validateInitialScale(w as WorldState))).toEqual(['INITIAL_SCALE_MISMATCH'])
    expect(validateWorldState(w).ok).toBe(false) // 家門の頭領参照が切れるため（規模とは別の理由）
  })

  it('後年の人物増減（9 人・7 人）を WorldState 検証は妨げない', () => {
    const later = (edit: (w: DeepWritable<WorldState>) => void) =>
      editedWorld((w) => { w.year = 1300; edit(w) })
    const born = later((w) => {
      w.persons.push({
        personId: 'person-gen-0001', name: '後年の出生者', sex: 'FEMALE', birthYear: 1295, alive: true,
        originGroupId: 'group-central-commons', houseId: 'house-nalven', fatherId: 'person-exp-02',
        legalDynasty: { status: 'UNDETERMINED', reasonCodes: ['NO_EVIDENCE'] },
      })
    })
    const died = later((w) => { w.persons[2]!.alive = false; w.persons[2]!.deathYear = 1290 })
    const empty = later((w) => { w.persons = []; w.houses.forEach((h) => { delete h.headPersonId }); w.countries.forEach((c) => { delete c.rulerPersonId }); w.titles = [] })
    for (const input of [born, died, empty]) {
      const r = validateWorldState(input)
      expect(r.diagnostics.filter((d) => d.severity === 'ERROR')).toEqual([])
      expect(r.ok).toBe(true)
      expect(validateInitialScale(r.world!).length).toBeGreaterThan(0) // 初期規模検証にだけ落ちる
    }
    expect((validateWorldState(born).world?.persons.length)).toBe(9)
    expect((validateWorldState(died).world?.persons.length)).toBe(8)
  })
})
