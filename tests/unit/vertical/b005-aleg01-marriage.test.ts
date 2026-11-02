// B-004 → B-005 → A-LEG-01 → reducerの実婚姻登録を、同一のrunTimeline/forkHistoryで検証。
// synthetic/CALIBRATION_ONLYの明示承認証拠だけを使う。GAME-01/02の法的権限・婚姻規則を正式化しない。
import { describe, expect, it } from 'vitest'
import { createRootBranch, forkHistory } from '../../../src/simulation/branching/index.ts'
import type { Branch } from '../../../src/simulation/branching/index.ts'
import type { CrossDomainRequest, DecisionTrace, RuleOutcome, WorldState } from '../../../src/simulation/contracts/index.ts'
import { runTimeline, runYear } from '../../../src/simulation/engine/index.ts'
import type { EvaluatorMap } from '../../../src/simulation/engine/index.ts'
import { RULE_REGISTRY } from '../../../src/simulation/rule-registry.ts'
import { createALeg01CalibrationEvaluator } from '../../../src/simulation/rules/a/index.ts'
import type { MarriageApprovalEvidence } from '../../../src/simulation/rules/a/index.ts'
import { createB005CalibrationEvaluator } from '../../../src/simulation/rules/b/index.ts'
import {
  B004_BRANCH_CONFIG as CFG, FORK_YEAR, P4, P5, TRUST_BOOST, createSyntheticWorld, evaluatorsForLedger,
} from './b004-branch-fixture.ts'

const TEST_APPROVAL: MarriageApprovalEvidence = {
  approvalId: 'synthetic-a-approval-1260',
  personIds: [P4, P5],
  authorizedYear: FORK_YEAR,
  status: 'APPROVED',
  issuerRef: { kind: 'COUNTRY', id: 'country-eldia' },
  evidenceId: 'synthetic-decision-document-1260',
  provenance: 'CALIBRATION_ONLY',
  contract: { contractId: 'synthetic-marriage-contract', evidenceId: 'synthetic-decision-document-1260', clauses: [] },
}

function evaluators(ledger: readonly import('../../../src/simulation/contracts/index.ts').StatModifier[], approvals: readonly MarriageApprovalEvidence[] = [TEST_APPROVAL]): EvaluatorMap {
  const a = createALeg01CalibrationEvaluator(approvals)
  if (!a.ok) throw new Error(JSON.stringify(a.issues))
  return { ...evaluatorsForLedger(ledger), 'B-005': createB005CalibrationEvaluator(), 'A-LEG-01': a.evaluator }
}
function root() {
  const es = evaluators([])
  const timeline = runTimeline(createSyntheticWorld(), { seed: CFG.seed, branchId: 'A0', evaluators: es })
  const r = createRootBranch(timeline, [], es)
  if (!r.ok) throw new Error(r.code + ': ' + r.message)
  return { a0: r.branch, timeline }
}
function fork(a0: Branch, approvals: readonly MarriageApprovalEvidence[] = [TEST_APPROVAL]) {
  const r = forkHistory({
    parent: a0, branchId: 'A1', forkYear: FORK_YEAR,
    modifiers: [TRUST_BOOST],
    evaluatorsFor: ({ ledger }) => evaluators(ledger, approvals),
  })
  if (!r.ok) throw new Error(r.code + ': ' + r.message)
  return r.branch
}
const tr = (b: Branch, ruleId: string, year: number): DecisionTrace | undefined =>
  b.decisionTraces.find((t) => t.ruleId === ruleId && t.year === year)
const marriageEvents = (b: Branch) => b.eventLog.filter((e) => e.eventType.includes('MARRIAGE_REGISTER'))
const marriageAt = (b: Branch, year: number) => b.snapshots[year - b.startYear]?.legal.marriages ?? []

describe('B-005 → A-LEG-01の実婚姻成立（explicit synthetic evidence）', () => {
  const { a0, timeline } = root()
  const a1 = fork(a0)

  it('介入なしA0: B004 REJECT → B005 DEFER、法照会・婚姻・Eventなし', () => {
    expect(timeline.status).toBe('COMPLETED')
    expect(a0.snapshots).toHaveLength(101)
    expect(marriageAt(a0, 1350)).toHaveLength(0)
    expect(marriageEvents(a0)).toHaveLength(0)
    for (const year of [1250,1260,1264,1265,1349]) {
      expect(tr(a0,'B-004',year)?.status).toBe('REJECT')
      expect(tr(a0,'B-005',year)?.status).toBe('DEFER')
      expect(tr(a0,'A-LEG-01',year)).toBeUndefined()
    }
  })

  it('A1は1260年初から再計算し、B004→B005の交渉意思を経てAのみが婚姻Eventを確定', () => {
    expect(a1.status).toBe('COMPLETED')
    expect(a1.recompute).toMatchObject({ fromYear: 1260, transitions: 90, status: 'COMPLETED' })
    expect(a0.snapshots.slice(0,11)).toEqual(a1.snapshots.slice(0,11))
    expect(a0.decisionTraces.filter((t) => t.year < 1260)).toEqual(a1.decisionTraces.filter((t) => t.year < 1260))
    expect(marriageAt(a1,1260)).toHaveLength(0)
    expect(marriageAt(a1,1261)).toHaveLength(1)
    expect(marriageAt(a1,1350)).toHaveLength(1)
    expect(marriageAt(a1,1261)[0]).toMatchObject({
      personIds: [P4,P5], registeredYear: 1260, status: 'ACTIVE',
      contract: { evidenceId: TEST_APPROVAL.evidenceId, clauses: [] },
    })
    const b4 = tr(a1,'B-004',1260)!
    const b5 = tr(a1,'B-005',1260)!
    const al = tr(a1,'A-LEG-01',1260)!
    expect([b4.status,b5.status,al.status]).toEqual(['ACCEPT','ACCEPT','ACCEPT'])
    expect(b5.candidates[0]?.inputs.sourceB004TraceId).toBe(b4.traceId)
    expect(al.candidates[0]?.inputs.sourceB005TraceId).toBe(b5.traceId)
    expect(al.candidates[0]?.inputs.evidenceId).toBe(TEST_APPROVAL.evidenceId)
    const events = marriageEvents(a1)
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ year: 1260, phase: 3, eventType: 'MARRIAGE_REGISTER' })
    expect(events[0]?.sourceTraceIds).toEqual([al.traceId])
    expect(al.eventIds).toEqual([events[0]?.eventId])
    expect(b5.eventIds).toEqual([])
    expect(events[0]?.stateChanges.some((x) => x.path.includes('marriages'))).toBe(true)
    expect(a0.goal).toBeNull()
    expect(a1.goal).toBeNull()
  })

  it('婚姻は1回だけ。1261年以降もB004採択期間は続くがB005が既婚を検出して再登録しない', () => {
    for (const year of [1261,1262,1263,1264]) {
      expect(tr(a1,'B-004',year)?.status).toBe('ACCEPT')
      expect(tr(a1,'B-005',year)?.status).toBe('DEFER')
      expect(tr(a1,'B-005',year)?.reasonCodes).toContain('ACTIVE_MARRIAGE_EXISTS')
      expect(tr(a1,'A-LEG-01',year)).toBeUndefined()
    }
    expect(tr(a1,'B-004',1265)?.status).toBe('REJECT')
    expect(marriageEvents(a1)).toHaveLength(1)
    expect(a1.snapshots[100]?.persons).toEqual(a0.snapshots[100]?.persons)
    expect(a1.snapshots[100]?.titles).toEqual(a0.snapshots[100]?.titles)
    expect(a1.eventLog.filter((e) => e.eventType === 'POPULATION_COHORT')).toEqual(a0.eventLog.filter((e) => e.eventType === 'POPULATION_COHORT'))
    expect(fork(a0)).toEqual(a1) // 同seed決定性
  })

  it('Aの明示的な承認がない場合はDEFERし、婚姻Eventを一切生成しない', () => {
    for (const records of [[], [{ ...TEST_APPROVAL, status: 'PENDING' as const }]]) {
      const b = fork(a0, records)
      expect(b.status).toBe('COMPLETED')
      expect(marriageEvents(b)).toHaveLength(0)
      expect(marriageAt(b,1350)).toHaveLength(0)
      expect(tr(b,'B-005',1260)?.status).toBe('ACCEPT')
      expect(tr(b,'A-LEG-01',1260)?.status).toBe('DEFER')
      expect(tr(b,'A-LEG-01',1260)?.eventIds).toEqual([])
    }
  })

  it('明示的拒否証拠はREJECT、無権限・未知の発行者はDEFER', () => {
    const rejected = fork(a0,[{ ...TEST_APPROVAL, status: 'REJECTED' }])
    expect(tr(rejected,'A-LEG-01',1260)?.status).toBe('REJECT')
    expect(marriageEvents(rejected)).toHaveLength(0)
    const unknownIssuer = fork(a0,[{ ...TEST_APPROVAL, issuerRef: { kind:'PERSON', id: 'person-no-evidence' } }])
    expect(tr(unknownIssuer,'A-LEG-01',1260)?.status).toBe('DEFER')
    expect(marriageEvents(unknownIssuer)).toHaveLength(0)
  })

  it('台帳の重複・不正な承認書は評価器生成時に拒否し、無言の法的承認を行わない', () => {
    expect(createALeg01CalibrationEvaluator([TEST_APPROVAL, TEST_APPROVAL]).ok).toBe(false)
    expect(createALeg01CalibrationEvaluator([{ ...TEST_APPROVAL, evidenceId: '' }]).ok).toBe(false)
    expect(createALeg01CalibrationEvaluator([{ ...TEST_APPROVAL, contract: { ...TEST_APPROVAL.contract!, evidenceId: 'different' } }]).ok).toBe(false)
    expect(createALeg01CalibrationEvaluator([{ ...TEST_APPROVAL, personIds: [P5,P4] }]).ok).toBe(false)
  })

  it('同年の未対応照会は従来通りHALTED。発行ドメインも制限', () => {
    const out = (world: WorldState, requestRule: 'B-005' | 'B-006', kind: CrossDomainRequest['kind']): RuleOutcome => ({
      ruleId: requestRule, phase: 3, commands: [], deferred: [],
      traceDrafts: [{ year:world.year, phase:3, ruleId:requestRule, actorRef:{kind:'PERSON_PAIR',ids:[P4,P5]},
        candidates:[], status:'DEFER', reasonCodes:[], modifierIds:[], ruleVersion:'synthetic' }],
      requests: [{
        kind, targetDomain: 'A', requiredResponseYear: world.year,
        source: { requestId: 'test-wrong', year: world.year, phase:3, sourceRuleId:requestRule, sourceTraceId:'trace:'+world.year+':p3:'+requestRule+':0' },
        payload: {kind:'LEGAL_MARRIAGE_QUERY',personIds:[P4,P5]},
      } as CrossDomainRequest],
    })
    for (const id of ['B-005','B-006'] as const) {
      const e = (_world: WorldState) => out(_world,id,'LEGAL_MARRIAGE_QUERY')
      const r = runYear(createSyntheticWorld(),{seed:CFG.seed,evaluators:{ [id]:e }})
      expect(r.status).toBe('HALTED')
      if(r.status==='HALTED')expect(r.halt.code).toBe('UNRESOLVED_CROSS_DOMAIN_REQUEST')
    }
  })

  it('37件TODO維持・A/B/C既存RuleIDだけ実行、正式勝利や子の法的王朝を偽装しない', () => {
    expect(RULE_REGISTRY).toHaveLength(37)
    expect(RULE_REGISTRY.every((x) => x.implementationStatus === 'TODO')).toBe(true)
    expect(timeline.autonomousHistory.status).toBe('NOT_ESTABLISHED')
    expect(timeline.goal).toBeNull()
    expect(a1.recompute?.suffixCoverage.injectedTodoRuleIds).toContain('A-LEG-01')
    expect(a1.recompute?.suffixCoverage.injectedTodoRuleIds).toContain('B-005')
    expect(a1.snapshots[100]?.persons).toEqual(a0.snapshots[100]?.persons)
  })
})
