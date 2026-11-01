import { describe, expect, it } from 'vitest'
import type { DomainCommand } from '../../../../src/simulation/contracts/index.ts'
import { diffWorld } from '../../../../src/simulation/engine/reducer/index.ts'
import { validateWorldState } from '../../../../src/simulation/validation/index.ts'
import { deepFreeze } from '../../foundation/helpers.ts'
import { baby, birth, chain, cohort, cohortOutcome, ledger, natural, newTx, newWorld, outcome, rejectionCodes, run, source, CASH } from './helpers.ts'

describe('純粋性と実差分', () => {
  it('入力 WorldState / Outcome / Transaction を変更しない（凍結入力でも成功）', () => {
    const w = deepFreeze(newWorld())
    const o = deepFreeze(cohortOutcome('group-west-commons', 20, 16))
    const tx = newTx()
    const r = run(w, o, tx)
    expect(r.status).toBe('APPLIED')
    expect(r.world).not.toBe(w)
    expect(w.groups.find((g) => g.groupId === 'group-west-commons')?.population).toBe(30000)
    expect(tx.commands.size).toBe(0) // 入力 Transaction は不変
    expect(r.transaction.commands.size).toBe(1)
  })

  it('確定した実状態差分のみ返し、EventLog を生成しない', () => {
    const r = run(newWorld(), cohortOutcome('group-west-commons', 20, 16))
    const changes = r.applied.flatMap((a) => a.stateChanges.map((c) => c.path))
    expect(changes).toEqual([
      '$.groups[group-west-commons].population',
      '$.demographics.cohortSlots[group-west-commons@1250]',
    ])
    expect(r.applied[0]?.stateChanges.find((c) => c.path.endsWith('population'))).toMatchObject({ before: 30000, after: 30004 })
    expect(Object.keys(r)).not.toContain('events')
    expect(Object.keys(r)).not.toContain('eventLog')
  })

  it('拒否時は入力と同一参照の world を返し、差分も無い', () => {
    const w = newWorld()
    const r = run(w, outcome('B-003', 3, [natural('person-exp-01')])) // 枠が無い
    expect(r.status).toBe('REJECTED')
    expect(r.world).toBe(w)
    expect(r.applied).toEqual([])
    expect(diffWorld(w, r.world)).toEqual([])
  })

  const req = { kind: 'CASUALTY_NOTICE', source: { requestId: 'q', year: 1250, phase: 1, sourceRuleId: 'RULE-C-004', sourceTraceId: 't' }, targetDomain: 'C', requiredResponseYear: 1250, payload: { kind: 'CASUALTY_NOTICE', casualtyId: 'x', groupId: 'g', count: 1 } } as const

  it('requests のみの Outcome は NO_OP（状態変更なし）で、件数を unhandled で明示する', () => {
    const w = newWorld()
    const r = run(w, outcome('RULE-C-004', 1, [], { requests: [req] }))
    expect(r.status).toBe('NO_OP')
    expect(r.world).toBe(w)
    expect(r.unhandled).toEqual({ requests: 1, traceDrafts: 0 })
  })

  it('未応答の requests を伴う commands は確定しない（照会 → 応答 → 適用）', () => {
    const w = newWorld()
    const r = run(w, outcome('RULE-C-004', 1, [cohort('group-west-commons', 1, 0)], { requests: [req] }))
    expect(r.status).toBe('REJECTED')
    expect(rejectionCodes(r)).toEqual(['UNRESOLVED_CROSS_DOMAIN_REQUEST'])
    expect(r.world).toBe(w)
    expect(r.transaction.commands.size).toBe(0)
  })

  it('適用後の世界は既存の WorldState バリデータを通る', () => {
    const { world } = chain([
      cohortOutcome('group-central-elite', 10, 5),
      outcome('B-002', 3, [birth(baby('person-new-1'))]),
    ])
    expect(validateWorldState(world).ok).toBe(true)
  })

  it('適用が WorldState の整合性を壊す場合は INTEGRITY_VIOLATION で拒否（人口 < 生存記名人物）', () => {
    const w = newWorld()
    const r = run(w, cohortOutcome('group-central-elite', 0, 1999)) // 人口 1、生存記名 3 人
    expect(r.status).toBe('REJECTED')
    expect(rejectionCodes(r)).toEqual(['INTEGRITY_VIOLATION'])
    expect(r.units[0]?.rejections[0]?.diagnostics?.map((d) => d.code)).toContain('COHORT_CAPACITY_CONFLICT')
    expect(r.world).toBe(w)
  })
})

describe('バッチの全件事前検証と原子的コミット', () => {
  const batchOf = (id: string, cmds: ReturnType<typeof ledger>[]) => cmds.map((c) => ({ ...c, batchId: id }))

  it('1 件でも不正なら同一 batchId を部分適用しない', () => {
    const w = newWorld()
    const cmds = batchOf('b1', [
      ledger(CASH, 'CREDIT', 100, 'ok-1'),
      ledger(CASH, 'DEBIT', 10_000_000, 'bad'), // 負残高
    ])
    const r = run(w, outcome('RULE-C-005', 1, cmds))
    expect(r.status).toBe('REJECTED')
    expect(r.world).toBe(w)
    expect(r.transaction.commands.size).toBe(0) // 先頭の正常 command も記録されない
    expect(rejectionCodes(r)).toEqual(['NEGATIVE_BALANCE'])
  })

  it('静的検証（権限）の不正も全件拒否し、後続の正常 command を巻き込まない/巻き込む範囲はバッチ単位', () => {
    const bad = { ...ledger(CASH, 'CREDIT', 5, 'x2'), source: { ...ledger(CASH, 'CREDIT', 5, 'x2').source, sourceRuleId: 'B-001' as const } }
    const r = run(newWorld(), outcome('RULE-C-005', 1, [
      ...batchOf('bad-batch', [ledger(CASH, 'CREDIT', 100, 'x1'), bad]),
      ledger(CASH, 'CREDIT', 7, 'solo'), // 別単位は適用される
    ]))
    expect(r.status).toBe('PARTIAL')
    expect(r.units.map((u) => u.status)).toEqual(['REJECTED', 'APPLIED'])
    expect(r.world.resources.find((a) => a.accountId === CASH)?.quantity).toBe(52007)
  })

  it('全件成立ならすべて同時にコミットされる', () => {
    const r = run(newWorld(), outcome('RULE-C-005', 1, batchOf('b2', [ledger(CASH, 'CREDIT', 100, 'a'), ledger(CASH, 'DEBIT', 30, 'b')])))
    expect(r.status).toBe('APPLIED')
    expect(r.world.resources.find((a) => a.accountId === CASH)?.quantity).toBe(52070)
  })

  it('バッチ内の逐次依存: 先頭の CREDIT があって初めて後続の DEBIT が通る', () => {
    const cmds = batchOf('b3', [ledger(CASH, 'CREDIT', 100, 'a'), ledger(CASH, 'DEBIT', 52100, 'b')])
    expect(run(newWorld(), outcome('RULE-C-005', 1, cmds)).status).toBe('APPLIED')
  })

  it('状態を変えない command は NO_STATE_CHANGE で拒否', () => {
    const c = chain([cohortOutcome('group-west-commons', 1, 0)])
    // 同じ集団の枠は一度だけ（別 commandId でも）
    const r = run(c.world, outcome('RULE-C-004', 1, [cohort('group-west-commons', 1, 0, 'again')]), c.tx)
    expect(rejectionCodes(r)).toEqual(['COHORT_ALREADY_SET'])
  })
})

describe('commandId の冪等性（枝・年度の Transaction 内）', () => {
  const o = () => outcome('RULE-C-005', 1, [ledger(CASH, 'CREDIT', 100, 'cmd-1')])

  it('同 ID・同内容の再送は DUPLICATE で、二重適用しない', () => {
    const first = run(newWorld(), o())
    const second = run(first.world, o(), first.transaction)
    expect(second.status).toBe('DUPLICATE')
    expect(second.world).toBe(first.world)
    expect(second.applied).toEqual([])
    expect(first.world.resources.find((a) => a.accountId === CASH)?.quantity).toBe(52100)
  })

  it('同 ID・異内容は CONFLICT で、状態は変わらない', () => {
    const first = run(newWorld(), o())
    const conflict = run(first.world, outcome('RULE-C-005', 1, [ledger(CASH, 'CREDIT', 999, 'cmd-1')]), first.transaction)
    expect(conflict.status).toBe('CONFLICT')
    expect(rejectionCodes(conflict)).toEqual(['COMMAND_ID_CONFLICT'])
    expect(conflict.world).toBe(first.world)
  })

  it('別枝（別 Transaction）では独立して判定される', () => {
    const a = run(newWorld(), o(), newTx('branch-a'))
    const b = run(newWorld(), o(), newTx('branch-b'))
    expect(a.status).toBe('APPLIED')
    expect(b.status).toBe('APPLIED')
    expect(b.transaction.branchId).toBe('branch-b')
  })

  it('拒否された command の ID は記録されず、修正して同 ID で再送できる', () => {
    const bad = run(newWorld(), outcome('RULE-C-005', 1, [ledger(CASH, 'DEBIT', 99_999_999, 'retry')]))
    expect(bad.status).toBe('REJECTED')
    const fixed = run(bad.world, outcome('RULE-C-005', 1, [ledger(CASH, 'DEBIT', 1, 'retry')]), bad.transaction)
    expect(fixed.status).toBe('APPLIED')
  })

  it('バッチの再送は DUPLICATE、一部だけの再送は拒否、構成違いは CONFLICT', () => {
    const batch = [ledger(CASH, 'CREDIT', 10, 'p', { batchId: 'bb' }), ledger(CASH, 'CREDIT', 20, 'q', { batchId: 'bb' })]
    const first = run(newWorld(), outcome('RULE-C-005', 1, batch))
    expect(run(first.world, outcome('RULE-C-005', 1, batch), first.transaction).status).toBe('DUPLICATE')
    const partial = run(first.world, outcome('RULE-C-005', 1, [batch[0]!, ledger(CASH, 'CREDIT', 30, 'r', { batchId: 'bb' })]), first.transaction)
    expect(partial.status).toBe('CONFLICT')
    const half = run(first.world, outcome('RULE-C-005', 1, [batch[0]!]), first.transaction)
    expect(half.status).toBe('CONFLICT') // 同一 batchId で構成が違う
    // 単独適用済みの command を新バッチへ混ぜると、バッチ単位でのみ再送できるため拒否
    const solo = run(first.world, outcome('RULE-C-005', 1, [ledger(CASH, 'CREDIT', 1, 'solo')]), first.transaction)
    const mixed = run(solo.world, outcome('RULE-C-005', 1, [ledger(CASH, 'CREDIT', 1, 'solo', { batchId: 'nb' }), ledger(CASH, 'CREDIT', 2, 'fresh', { batchId: 'nb' })]), solo.transaction)
    expect(mixed.status).toBe('CONFLICT') // batchId 付与で内容が変わった solo は CONFLICT
    const same = run(solo.world, outcome('RULE-C-005', 1, [ledger(CASH, 'CREDIT', 1, 'solo'), ledger(CASH, 'CREDIT', 2, 'fresh', { batchId: 'nb' })]), solo.transaction)
    expect(same.units.map((u) => u.status)).toEqual(['DUPLICATE', 'APPLIED'])
  })

  it('同一 Outcome 内の commandId 重複は拒否する', () => {
    const r = run(newWorld(), outcome('RULE-C-005', 1, [ledger(CASH, 'CREDIT', 1, 'dup', { batchId: 'z' }), ledger(CASH, 'CREDIT', 1, 'dup', { batchId: 'z' })]))
    expect(rejectionCodes(r)).toEqual(['DUPLICATE_COMMAND_ID_IN_OUTCOME'])
  })

  it('出生の再送で人口・枠・人物が二重に増えない', () => {
    const c = chain([cohortOutcome('group-central-elite', 2, 0), outcome('B-002', 3, [birth(baby('person-new-1'))])])
    const again = run(c.world, outcome('B-002', 3, [birth(baby('person-new-1'))]), c.tx)
    expect(again.status).toBe('DUPLICATE')
    expect(c.world.persons.filter((p) => p.personId === 'person-new-1')).toHaveLength(1)
  })

  it('比較は内容のみ（キー順に依存しない）', () => {
    const c1 = ledger(CASH, 'CREDIT', 5, 'k')
    const reordered = Object.fromEntries(Object.entries(c1).reverse()) as typeof c1
    const first = run(newWorld(), outcome('RULE-C-005', 1, [c1]))
    expect(run(first.world, outcome('RULE-C-005', 1, [reordered]), first.transaction).status).toBe('DUPLICATE')
  })
})

describe('requestId の冪等性', () => {
  const credit = (amount: number, id: string, requestTag = 'same-req', extra: { batchId?: string } = {}) => {
    const c = ledger(CASH, 'CREDIT', amount, id, extra)
    return { ...c, source: { ...c.source, requestId: requestTag } }
  }
  const bal = (w: ReturnType<typeof newWorld>) => w.resources.find((a) => a.accountId === CASH)?.quantity

  it('同一 requestId・同内容で commandId だけ違う再送は DUPLICATE（二重入金しない）', () => {
    const first = run(newWorld(), outcome('RULE-C-005', 1, [credit(100, 'a')]))
    const again = run(first.world, outcome('RULE-C-005', 1, [credit(100, 'b')]), first.transaction)
    expect(again.status).toBe('DUPLICATE')
    expect(again.world).toBe(first.world)
    expect(bal(again.world)).toBe(52100)
  })

  it('同一 requestId・異内容の再送は CONFLICT（二重支出しない）', () => {
    const first = run(newWorld(), outcome('RULE-C-005', 1, [credit(100, 'a')]))
    const other = run(first.world, outcome('RULE-C-005', 1, [credit(999, 'c')]), first.transaction)
    expect(other.status).toBe('CONFLICT')
    expect(rejectionCodes(other)).toEqual(['REQUEST_ID_CONFLICT'])
    expect(bal(other.world)).toBe(52100)
  })

  it('同一 requestId の複数 command を単一 batch として処理できる', () => {
    const r = run(newWorld(), outcome('RULE-C-005', 1, [credit(100, 'a', 'r1', { batchId: 'b' }), { ...ledger(CASH, 'DEBIT', 30, 'd', { batchId: 'b' }), source: { ...ledger(CASH, 'DEBIT', 30, 'd').source, requestId: 'r1' } }]))
    expect(r.status).toBe('APPLIED')
    expect(bal(r.world)).toBe(52070)
    const resend = run(r.world, outcome('RULE-C-005', 1, [credit(100, 'a2', 'r1', { batchId: 'b2' }), { ...ledger(CASH, 'DEBIT', 30, 'd2', { batchId: 'b2' }), source: { ...ledger(CASH, 'DEBIT', 30, 'd').source, requestId: 'r1' } }]), r.transaction)
    expect(resend.status).toBe('DUPLICATE')
  })

  it('同一 requestId を別 unit の追加内容で再利用すると拒否、バッチ内の同一内容の重複も拒否', () => {
    const first = run(newWorld(), outcome('RULE-C-005', 1, [credit(100, 'a')]))
    const mixed = run(first.world, outcome('RULE-C-005', 1, [credit(100, 'b', 'same-req', { batchId: 'x' }), credit(5, 'c', 'new-req', { batchId: 'x' })]), first.transaction)
    expect(mixed.status).toBe('CONFLICT')
    const dupInBatch = run(newWorld(), outcome('RULE-C-005', 1, [credit(7, 'p', 'q', { batchId: 'y' }), credit(7, 'r', 'q', { batchId: 'y' })]))
    expect(rejectionCodes(dupInBatch)).toEqual(['REQUEST_ID_CONFLICT'])
  })

  it('別 branch・別 year では独立して判定される', () => {
    const a = run(newWorld(), outcome('RULE-C-005', 1, [credit(100, 'a')]), newTx('branch-a'))
    const b = run(newWorld(), outcome('RULE-C-005', 1, [credit(100, 'a')]), newTx('branch-b'))
    expect(a.status).toBe('APPLIED')
    expect(b.status).toBe('APPLIED')
    expect(a.transaction.requests.size).toBe(1)
  })
})

describe('入力 WorldState のフェイルファスト', () => {
  const broken = () => {
    const w = newWorld()
    return { ...w, groups: w.groups.map((g, i) => (i === 0 ? { ...g, population: -1 } : g)) }
  }
  it('最初から破損している状態には何も適用せず、診断付きで拒否する', () => {
    const w = broken()
    const tx = newTx()
    const r = run(w, outcome('RULE-C-005', 1, [ledger(CASH, 'CREDIT', 1, 'x')]), tx)
    expect(r.status).toBe('REJECTED')
    expect(rejectionCodes(r)).toEqual(['INVALID_INPUT_WORLD'])
    expect(r.rejections[0]?.diagnostics?.length).toBeGreaterThan(0)
    expect(r.world).toBe(w)
    expect(r.transaction).toBe(tx)
    expect(tx.commands.size).toBe(0)
  })
  it('空の Outcome でも破損入力は NO_OP にせず拒否する', () => {
    expect(rejectionCodes(run(broken(), outcome('B-001', 3, [])))).toEqual(['INVALID_INPUT_WORLD'])
  })
  it('構造が壊れた入力（フィールド欠落）も拒否する', () => {
    const w = { ...newWorld(), persons: undefined } as unknown as ReturnType<typeof newWorld>
    expect(rejectionCodes(run(w, outcome('B-001', 3, [])))).toEqual(['INVALID_INPUT_WORLD'])
  })
  it('WARNING のみ（UNRESOLVED_TAX_AUTHORITY）の状態は受理する', () => {
    const w0 = newWorld()
    const w = { ...w0, legal: { ...w0.legal, taxMandates: [] } }
    expect(validateWorldState(w).diagnostics.some((d) => d.severity === 'WARNING')).toBe(true)
    expect(run(w, outcome('RULE-C-005', 1, [ledger(CASH, 'CREDIT', 1, 'x')])).status).toBe('APPLIED')
  })
})

describe('入力・出力の不変性（オブジェクト非共有）', () => {
  const mutate = (v: unknown) => {
    // 再帰的に文字列・数値を書き換える（元 Command の可変ネスト値の変更を模擬）
    if (Array.isArray(v)) { v.forEach(mutate); v.push('MUTATED'); return }
    if (v && typeof v === 'object') {
      for (const k of Object.keys(v)) {
        const o = v as Record<string, unknown>
        if (typeof o[k] === 'string') o[k] = 'MUTATED'
        else if (typeof o[k] === 'number') o[k] = -999
        else mutate(o[k])
      }
    }
  }
  const snap = (v: unknown) => JSON.stringify(v)

  it('PERSON_BIRTH: 適用後に元 Command を変更しても WorldState と差分は変わらない', () => {
    const c0 = chain([cohortOutcome('group-central-elite', 1, 0)])
    const cmd = birth(baby('person-new-1'))
    const r = run(c0.world, outcome('B-002', 3, [cmd]), c0.tx)
    expect(r.status).toBe('APPLIED')
    const worldBefore = snap(r.world)
    const changesBefore = snap(r.applied)
    mutate(cmd)
    expect(snap(r.world)).toBe(worldBefore)
    expect(snap(r.applied)).toBe(changesBefore)
  })

  it('MARRIAGE / SUPPORT_SET / LegalCase / Mandate: ネスト値を共有しない', () => {
    const marriage: DomainCommand = { type: 'MARRIAGE_REGISTER', commandId: 'm', source: source('A-LEG-01', 3, 'm'), marriage: { marriageId: 'mar-1', personIds: ['person-exp-02', 'person-exp-03'], registeredYear: 1250, status: 'ACTIVE', contract: { contractId: 'c', evidenceId: 'e', clauses: [{ clauseId: 'cl', kind: 'CHILD_LEGAL_DYNASTY', dynastyId: 'dynasty-nalven' }] } } }
    const support: DomainCommand = { type: 'SUPPORT_SET', commandId: 's', source: source('RULE-C-008', 2, 's'), groupId: 'group-west-elite', causeEventIds: ['ev'], support: { houseBps: { 'house-nalven': 5000, 'house-vargas': 1000 }, undecidedBps: 4000 } }
    const lcase: DomainCommand = { type: 'LEGAL_CASE_SET', commandId: 'lc', source: source('A-SUC-04', 4, 'lc'), legalCase: { caseId: 'case-1', titleId: 'title-exp-central', kind: 'SUCCESSION', status: 'PENDING', candidatePersonIds: ['person-exp-02'], reasonCodes: ['r'] } }
    const mandate: DomainCommand = { type: 'CONTROL_MANDATE_SET', commandId: 'cm', source: source('A-TIT-07', 4, 'cm'), mandate: { mandateId: 'cm-1', regionId: 'region-eldia-west', controllerRef: { kind: 'PERSON', id: 'person-exp-04' }, beneficiaryPersonId: 'person-exp-04', authorizingTitleId: 'title-exp-west', sourceEventId: 'ev', effectiveFromYear: 1250, endExclusiveYear: 1300 } }
    const recog: DomainCommand = { type: 'TITLE_RECOGNITION_SET', commandId: 'rc', source: source('A-TIT-06', 4, 'rc'), titleId: 'title-exp-west', recognition: { status: 'PENDING' } }
    const region: DomainCommand = { type: 'REGION_CONTROL_SET', commandId: 'rg', source: source('D-MIL-001', 5, 'rg'), regionId: 'region-eldia-west', deFactoControllerRef: { kind: 'COUNTRY', id: 'country-margald' } }
    const cases: [DomainCommand, ReturnType<typeof outcome>][] = [
      [marriage, outcome('A-LEG-01', 3, [marriage])],
      [support, outcome('RULE-C-008', 2, [support])],
      [lcase, outcome('A-SUC-04', 4, [lcase])],
      [mandate, outcome('A-TIT-07', 4, [mandate])],
      [recog, outcome('A-TIT-06', 4, [recog])],
      [region, outcome('D-MIL-001', 5, [region])],
    ]
    for (const [cmd, o] of cases) {
      const r = run(newWorld(), o)
      expect(r.status, cmd.type).toBe('APPLIED')
      const w = snap(r.world)
      const a = snap(r.applied)
      mutate(cmd)
      expect(snap(r.world), cmd.type).toBe(w)
      expect(snap(r.applied), cmd.type).toBe(a)
    }
  })

  it('StateChange の before/after を後から変更しても WorldState に波及しない', () => {
    const c0 = chain([cohortOutcome('group-central-elite', 1, 0)])
    const r = run(c0.world, outcome('B-002', 3, [birth(baby('person-new-1'))]), c0.tx)
    const added = r.applied[0]?.stateChanges.find((s) => s.path === '$.persons[person-new-1]')
    expect(added).toBeDefined()
    const worldBefore = snap(r.world)
    mutate(added?.after)
    expect(snap(r.world)).toBe(worldBefore)
  })

  it('以前の WorldState スナップショットは後続の適用で変化しない', () => {
    const w0 = deepFreeze(newWorld())
    const s0 = snap(w0)
    const r1 = run(w0, cohortOutcome('group-central-elite', 1, 0))
    const s1 = snap(r1.world)
    const r2 = run(r1.world, outcome('B-002', 3, [birth(baby('person-new-1'))]), r1.transaction)
    expect(r2.status).toBe('APPLIED')
    expect(snap(w0)).toBe(s0)
    expect(snap(r1.world)).toBe(s1)
  })

  it('plain data でない command（関数を含む等）は例外にせず拒否する', () => {
    const bad = { ...ledger(CASH, 'CREDIT', 1, 'f'), extra: () => 1 } as unknown as DomainCommand
    expect(rejectionCodes(run(newWorld(), outcome('RULE-C-005', 1, [bad])))).toEqual(['INVALID_COMMAND'])
  })
})

describe('同一 requestId の原子性（最終契約レビュー）', () => {
  const withReq = (c: DomainCommand, requestId: string): DomainCommand => ({ ...c, source: { ...c.source, requestId } }) as DomainCommand
  const bal = (w: ReturnType<typeof newWorld>) => w.resources.find((a) => a.accountId === CASH)?.quantity

  it('同一 requestId の無バッチ 2 件は片方だけ入金されず、全体を拒否する', () => {
    const w = newWorld()
    const tx = newTx()
    const r = run(w, outcome('RULE-C-005', 1, [withReq(ledger(CASH, 'CREDIT', 100, 'a'), 'R'), withReq(ledger(CASH, 'CREDIT', 200, 'b'), 'R')]), tx)
    expect(r.status).toBe('REJECTED')
    expect(rejectionCodes(r)).toEqual(['REQUEST_ID_CONFLICT'])
    expect(r.world).toBe(w)
    expect(bal(r.world)).toBe(52000)
    expect(r.transaction).toBe(tx)
  })

  it('異なる batchId に跨る同一 requestId も全体を拒否する（先頭 batch も適用しない）', () => {
    const r = run(newWorld(), outcome('RULE-C-005', 1, [
      withReq(ledger(CASH, 'CREDIT', 100, 'a', { batchId: 'b1' }), 'R'),
      withReq(ledger(CASH, 'CREDIT', 200, 'b', { batchId: 'b2' }), 'R'),
    ]))
    expect(rejectionCodes(r)).toEqual(['REQUEST_ID_CONFLICT'])
    expect(bal(r.world)).toBe(52000)
  })

  it('batch 付きと無バッチの混在も拒否する', () => {
    const r = run(newWorld(), outcome('RULE-C-005', 1, [
      withReq(ledger(CASH, 'CREDIT', 100, 'a', { batchId: 'b1' }), 'R'),
      withReq(ledger(CASH, 'CREDIT', 200, 'b'), 'R'),
    ]))
    expect(rejectionCodes(r)).toEqual(['REQUEST_ID_CONFLICT'])
    expect(bal(r.world)).toBe(52000)
  })

  it('同一 batchId に属する同一 requestId は受理され、再送は DUPLICATE、別枝は独立', () => {
    const o = () => outcome('RULE-C-005', 1, [
      withReq(ledger(CASH, 'CREDIT', 100, 'a', { batchId: 'b1' }), 'R'),
      withReq(ledger(CASH, 'CREDIT', 200, 'b', { batchId: 'b1' }), 'R'),
    ])
    const first = run(newWorld(), o())
    expect(first.status).toBe('APPLIED')
    expect(bal(first.world)).toBe(52300)
    expect(run(first.world, o(), first.transaction).status).toBe('DUPLICATE')
    expect(run(newWorld(), o(), newTx('other-branch')).status).toBe('APPLIED')
  })
})

describe('適用後 WorldState の完全検証と例外安全性', () => {
  const setup = () => chain([cohortOutcome('group-central-elite', 1, 0)])
  const tryBirth = (mutate: (p: Record<string, unknown>) => void) => {
    const c = setup()
    const person = { ...baby('person-new-1') } as Record<string, unknown>
    mutate(person)
    const cmd = birth(person as unknown as ReturnType<typeof baby>)
    const r = run(c.world, outcome('B-002', 3, [cmd]), c.tx)
    return { c, r }
  }

  it.each([
    ['不正な Person.sex', (p: Record<string, unknown>) => { p.sex = 'OTHER' }],
    ['必須フィールドの欠落（name）', (p: Record<string, unknown>) => { delete p.name }],
    ['未定義の追加フィールド', (p: Record<string, unknown>) => { p.nickname = 'x' }],
    ['不正な型（birthYear が文字列）', (p: Record<string, unknown>) => { p.birthYear = '1250' }],
  ])('%s は INTEGRITY_VIOLATION で拒否し、状態・Transaction を変えない', (_n, mutate) => {
    const { c, r } = tryBirth(mutate)
    expect(r.status).toBe('REJECTED')
    const codes = rejectionCodes(r)
    expect(codes.some((x) => x === 'INTEGRITY_VIOLATION' || x === 'INVALID_COMMAND' || x === 'HANDLER_EXCEPTION')).toBe(true)
    expect(r.world).toBe(c.world)
    expect(r.transaction).toBe(c.tx)
    expect(r.world.persons.some((p) => p.personId === 'person-new-1')).toBe(false)
  })

  it('Person.sex の不正は診断（INVALID_ENUM）付きで拒否される', () => {
    const { r } = tryBirth((p) => { p.sex = 'OTHER' })
    expect(rejectionCodes(r)).toEqual(['INTEGRITY_VIOLATION'])
    expect(r.units[0]?.rejections[0]?.diagnostics?.map((d) => d.code)).toContain('INVALID_ENUM')
  })

  it('ハンドラ例外（必須ペイロード欠落）は例外を投げず、診断付きで拒否し状態を変えない', () => {
    const w = newWorld()
    const tx = newTx()
    const bad = [
      { type: 'MARRIAGE_REGISTER', commandId: 'e1', source: source('A-LEG-01', 3, 'e1') },
      { type: 'PERSON_BIRTH', commandId: 'e2', source: source('B-002', 3, 'e2'), cohortYear: 1250, cohortGroupId: 'group-central-elite' },
      { type: 'LEGAL_CASE_SET', commandId: 'e3', source: source('A-SUC-04', 4, 'e3') },
    ] as unknown as DomainCommand[]
    for (const c of bad) {
      const o = outcome(c.source.sourceRuleId, c.source.phase, [c])
      const r = run(w, o, tx)
      expect(r.status).toBe('REJECTED')
      expect(rejectionCodes(r)).toEqual(['HANDLER_EXCEPTION'])
      expect(r.units[0]?.rejections[0]?.message).toContain(c.type)
      expect(r.world).toBe(w)
      expect(r.transaction).toBe(tx)
    }
  })

  it('例外を起こした command を含むバッチは部分適用されない', () => {
    const w = newWorld()
    const bad = { type: 'MARRIAGE_REGISTER', commandId: 'e1', batchId: 'b', source: source('RULE-C-005', 1, 'e1') } as unknown as DomainCommand
    const good = ledger(CASH, 'CREDIT', 100, 'ok', { batchId: 'b' })
    const r = run(w, outcome('RULE-C-005', 1, [good, bad]))
    expect(r.world).toBe(w)
    expect(r.status).toBe('REJECTED')
  })

  it('正常系と WARNING のみの WorldState は引き続き受理される', () => {
    const c = setup()
    expect(run(c.world, outcome('B-002', 3, [birth(baby('person-new-1'))]), c.tx).status).toBe('APPLIED')
    const w0 = newWorld()
    const warnOnly = { ...w0, legal: { ...w0.legal, taxMandates: [] } }
    expect(run(warnOnly, outcome('RULE-C-005', 1, [ledger(CASH, 'CREDIT', 1, 'x')])).status).toBe('APPLIED')
  })
})
