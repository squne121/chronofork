import { beforeAll, describe, expect, it } from 'vitest'
import {
  createMultiHouseEvaluators, createMultiHouseWorld, MULTI_HOUSE_RUN_CONDITIONS as config,
  multiHousePersonRecords, multiHouseRunConfigDigest,
} from '../../../src/scenario/experimental/multi-house-playtest.ts'
import { createRootBranch, forkHistory } from '../../../src/simulation/branching/index.ts'
import type { Branch } from '../../../src/simulation/branching/index.ts'
import { PAIR_TRUST_STAT_KEY, STAT_MODIFIER_RULE_VERSION } from '../../../src/simulation/contracts/index.ts'
import type { DecisionTrace, RuleId, StatModifier, TargetRef } from '../../../src/simulation/contracts/index.ts'
import { runTimeline } from '../../../src/simulation/engine/index.ts'
import { evaluateGoal } from '../../../src/simulation/goal.ts'
import { supportingCandidateId } from '../../../src/simulation/population/supporting-marriage.ts'

const year = 1251
const ids = ['person-exp-03', 'person-exp-04'] as const
const a0Id = 'c1-a0'
const a1Id = 'c1-a1'
const timeout = 120_000
const modifier = {
  modifierId: 'c1-trust', interventionId: 'c1', targetRef: { kind: 'PERSON_PAIR', ids },
  statKey: PAIR_TRUST_STAT_KEY, signedDelta: 20, startYear: year, endExclusiveYear: year + 1,
  decayPolicy: 'NONE', ruleVersion: STAT_MODIFIER_RULE_VERSION,
} satisfies StatModifier

const agePeer = supportingCandidateId('multi-house:initial:east:1232:male', 0)
const competingPair = [ids[0], agePeer] as const
const samePair = (ref: TargetRef, pair: readonly [string, string]) =>
  ref.kind === 'PERSON_PAIR' && ref.ids[0] === pair[0] && ref.ids[1] === pair[1]

function pairTrace(branch: Branch, ruleId: RuleId, pair: readonly [string, string] = ids) {
  const matches = branch.decisionTraces.filter(t => t.year === year && t.ruleId === ruleId && samePair(t.actorRef, pair))
  expect(matches).toHaveLength(1)
  return matches[0]!
}

function linkedEvent(branch: Branch, trace: DecisionTrace, eventType: string) {
  expect(trace.eventIds).toHaveLength(1)
  const event = branch.eventLog.find(e => e.eventId === trace.eventIds[0])
  expect(event).toMatchObject({ year: trace.year, phase: trace.phase, eventType, sourceTraceIds: [trace.traceId] })
  return event!
}

// B-001の候補出典にだけ残る枝ラベルを対応づける。判断や照合IDは除外しない。
function rebindSupplyTrace(trace: DecisionTrace) {
  return trace.ruleId !== 'B-001' ? trace : {
    ...trace,
    candidates: trace.candidates.map(c => c.inputs.candidateBranchId === a0Id
      ? { ...c, inputs: { ...c.inputs, candidateBranchId: a1Id } } : c),
  }
}

describe('担当B C1: 主試遊の年初forkから判断・法的履歴まで', () => {
  let a0: Branch
  let a1: Branch
  let before: Branch
  const at = (branch: Branch, y: number) => branch.snapshots[y - branch.startYear]!
  const start = () => at(a0, year)
  const fork = (change: StatModifier = modifier) => forkHistory({
    parent: a0, forkYear: year, branchId: a1Id, modifiers: [change],
    evaluatorsFor: ({ ledger }) => createMultiHouseEvaluators(start(), ledger),
  })

  beforeAll(() => {
    const initial = createMultiHouseWorld()
    const result = runTimeline(initial, {
      seed: config.primarySeed, branchId: a0Id, evaluators: createMultiHouseEvaluators(initial),
      goal: config.goal, technicalGoalEvaluation: true,
    })
    expect(result).toMatchObject({ status: 'COMPLETED', goal: null, technicalGoal: { status: 'NOT_ACHIEVED' } })
    const root = createRootBranch(result)
    if (!root.ok) throw new Error(`${root.code}: ${root.message}`)
    a0 = root.branch
    before = structuredClone(a0)
    const child = fork()
    if (!child.ok) throw new Error(`${child.code}: ${child.message}`)
    a1 = child.branch
    expect(a1).toMatchObject({ status: 'COMPLETED', seed: a0.seed, rngVersion: a0.rngVersion, ledger: [modifier] })
    expect(multiHousePersonRecords(start()).filter(p => ids.some(id => p.personId === id))).toMatchObject([
      { personId: ids[0], origin: 'INITIAL_KEY', alive: true },
      { personId: ids[1], origin: 'INITIAL_KEY', alive: true },
    ])
  }, timeout)

  it('同じ構成で再現し、無介入対照はA0と一致し、介入前と親枝を保持する', () => {
    // 空台帳は forkHistory の入力にならない。同じ年初・同じA1枝名の再実行を無介入対照にする。
    const control = runTimeline(start(), {
      seed: a0.seed, branchId: a1Id, evaluators: createMultiHouseEvaluators(start()),
    })
    expect(control.status).toBe('COMPLETED')
    expect(control.snapshots).toStrictEqual(a0.snapshots.slice(year - a0.startYear))
    expect(control.eventLog).toStrictEqual(a0.eventLog.filter(e => e.year >= year))
    expect(control.decisionTraces).toStrictEqual(a0.decisionTraces.filter(t => t.year >= year).map(rebindSupplyTrace))
    expect(fork()).toStrictEqual({ ok: true, branch: a1 })
    expect(a0).toStrictEqual(before)
    expect(a1.snapshots.slice(0, year - a0.startYear + 1)).toStrictEqual(a0.snapshots.slice(0, year - a0.startYear + 1))
    expect(a1.eventLog.filter(e => e.year < year)).toStrictEqual(a0.eventLog.filter(e => e.year < year))
    expect(a1.decisionTraces.filter(t => t.year < year)).toStrictEqual(a0.decisionTraces.filter(t => t.year < year))
    expect(multiHouseRunConfigDigest()).toBe('1342c44ee5aff1ba')
  }, timeout)

  it('B-004は信頼だけを補正し、B-005の選択差を法的登録・出生・帰属・相続につなぐ', () => {
    const base = pairTrace(a0, 'B-009')
    expect(base.candidates[0]?.inputs.updatedBaseTrust).toBe(30)
    expect(pairTrace(a1, 'B-009')).toStrictEqual(base)
    for (const [branch, delta] of [[a0, 0], [a1, 20]] as const) {
      expect(pairTrace(branch, 'B-004')).toMatchObject({
        status: 'ACCEPT', modifierIds: delta ? [modifier.modifierId] : [], eventIds: [],
        candidates: [{ score: 30 + delta, threshold: 30, inputs: { baseTrust: 30, effectiveTrust: 30 + delta, rawModifierSum: delta, trustSource: 'B009_WORLDSTATE' } }],
      })
      expect(pairTrace(branch, 'B-004', competingPair)).toMatchObject({ modifierIds: [], candidates: [{
        score: 40, inputs: { rawModifierSum: 0 },
      }] })
    }
    const deferred = pairTrace(a0, 'B-005')
    expect(deferred).toMatchObject({ status: 'DEFER', eventIds: [], candidates: [{ inputs: { sourceRequestId: null } }] })
    expect(deferred.reasonCodes).toContain('MUTUAL_UNIQUE_PARTNER_NOT_ESTABLISHED')
    const competingAgreement = pairTrace(a0, 'B-005', competingPair)
    const competingReview = pairTrace(a0, 'A-LEG-01', competingPair)
    expect(competingAgreement.status).toBe('ACCEPT')
    expect(competingReview).toMatchObject({ status: 'ACCEPT', candidates: [{ inputs: {
      sourceRequestId: competingAgreement.candidates[0]!.inputs.sourceRequestId,
    } }] })
    expect(linkedEvent(a0, competingReview, 'MARRIAGE_REGISTER').involvedRefs.some(ref => samePair(ref, competingPair))).toBe(true)
    const displaced = pairTrace(a1, 'B-005', competingPair)
    expect(displaced).toMatchObject({ status: 'DEFER', eventIds: [], candidates: [{ inputs: { sourceRequestId: null } }] })
    expect(displaced.reasonCodes).toContain('MUTUAL_UNIQUE_PARTNER_NOT_ESTABLISHED')
    expect(a1.decisionTraces.filter(t => t.year > year && t.modifierIds.includes(modifier.modifierId))).toEqual([])
    const agreement = pairTrace(a1, 'B-005')
    expect(agreement).toMatchObject({ status: 'ACCEPT', modifierIds: [modifier.modifierId], eventIds: [], candidates: [{ inputs: {
      sourceB004TraceId: pairTrace(a1, 'B-004').traceId, sourceB004Score: 50,
      selectedContractKey: 'CHILD_DYNASTY:dynasty-nalven',
    } }] })
    expect(agreement.reasonCodes).toContain('BOTH_PARTIES_ACCEPT_UNIQUE_CONTRACT')

    const legal = pairTrace(a1, 'A-LEG-01')
    const matching = linkedEvent(a1, legal, 'MARRIAGE_REGISTER')
    expect(matching.involvedRefs.some(ref => samePair(ref, ids))).toBe(true)
    expect(legal).toMatchObject({ status: 'ACCEPT', candidates: [{ inputs: {
      sourceRequestId: agreement.candidates[0]!.inputs.sourceRequestId, lawId: 'exp-law-domestic-marriage',
    } }] })
    expect(legal.candidates[0]!.inputs.sourceRequestId).toEqual(expect.any(String))
    expect(a0.eventLog.some(e => e.eventType === 'MARRIAGE_REGISTER' && e.involvedRefs.some(ref => samePair(ref, ids)))).toBe(false)
    const marriage = at(a1, year + 1).legal.marriages.find(m => m.personIds.every((id, i) => id === ids[i]))!
    expect(marriage).toMatchObject({ status: 'ACTIVE', registeredYear: year, contract: {
      contractId: legal.candidates[0]!.inputs.contractId, evidenceId: `evidence:nextgen-agreement:${agreement.traceId}`,
      clauses: [{ kind: 'CHILD_LEGAL_DYNASTY', dynastyId: 'dynasty-nalven' }],
    } })
    expect(at(a0, year + 1).persons.some(p => p.personId === agePeer)).toBe(true)
    expect(at(a1, year + 1).persons.some(p => p.personId === agePeer)).toBe(false)

    const children = at(a1, 1261).persons.filter(p => p.fatherId === ids[1] && p.motherId === ids[0])
    expect(children).toHaveLength(1)
    const child = children[0]!
    expect(child).toMatchObject({ birthYear: 1260, legalDynasty: { status: 'DETERMINED', dynastyId: 'dynasty-nalven' } })
    expect(a0.snapshots.at(-1)!.persons.some(p => p.fatherId === ids[1] && p.motherId === ids[0])).toBe(false)
    const childTraces = a1.decisionTraces.filter(t => t.year === child.birthYear && t.actorRef.kind === 'PERSON' && t.actorRef.id === child.personId)
    const birth = childTraces.find(t => t.ruleId === 'B-002')!
    const birthEvent = linkedEvent(a1, birth, 'PERSON_BIRTH')
    expect(birth).toMatchObject({ status: 'ACCEPT', random: { stream: 'ENDOGENOUS', value: 0.059185454723618025 },
      candidates: [{ inputs: { marriageId: marriage.marriageId, childPersonId: child.personId, fertilityChancePermille: 150 } }],
    })
    const dynasty = childTraces.find(t => t.ruleId === 'A-DYN-02')!
    expect(dynasty).toMatchObject({ status: 'ACCEPT', candidates: [{ inputs: {
      sourceB002TraceId: birth.traceId, sourceBirthEventIds: [birthEvent.eventId], marriageId: marriage.marriageId,
      contractId: marriage.contract!.contractId, contractEvidenceId: marriage.contract!.evidenceId,
      clauseId: marriage.contract!.clauses[0]!.clauseId, dynastyId: 'dynasty-nalven',
    } }] })
    expect(linkedEvent(a1, dynasty, 'LEGAL_DYNASTY_SET').stateChanges).toContainEqual({
      path: `$.persons[${child.personId}].legalDynasty.status`, before: 'UNDETERMINED', after: 'DETERMINED',
    })

    for (const [caseYear, titleId] of [[1264, 'title-exp-west'], [1278, 'title-exp-south']] as const) {
      const caseId = `case:asuc04:auto:${JSON.stringify([caseYear, titleId])}`
      const pending = at(a1, caseYear + 1).legal.cases.find(c => c.caseId === caseId)
      expect(pending).toMatchObject({ kind: 'SUCCESSION', titleId, status: 'PENDING' })
      const reviewYear = caseYear + 1
      const reviewOf = (ruleId: RuleId) => a1.decisionTraces.find(t => t.year === reviewYear &&
        t.ruleId === ruleId && t.status === 'ACCEPT' && t.candidates[0]?.inputs['legalCaseId'] === caseId)!
      const approval = reviewOf('A-SUC-04')
      expect(approval.reasonCodes).toContain('EXPLICIT_AUTHORITY_AND_HEIR_VERIFIED')
      const proof = approval.candidates[0]!.inputs['decisionId']
      expect(proof).toEqual(expect.stringMatching(/.+/))
      expect(approval.candidates[0]!.inputs).toMatchObject({
        candidatePersonId: child.personId, authorityBasisId: expect.stringMatching(/.+/),
      })
      linkedEvent(a1, approval, 'LEGAL_CASE_SET')
      expect(at(a1, reviewYear + 1).legal.cases.find(c => c.caseId === caseId)).toMatchObject({
        status: 'APPROVED', candidatePersonIds: [child.personId],
      })
      const transfer = reviewOf('A-TIT-07')
      expect(transfer.candidates[0]!.inputs).toMatchObject({ successorPersonId: child.personId, sourceDecisionId: proof })
      expect(linkedEvent(a1, transfer, 'LEGAL_TITLE_TRANSFER').stateChanges).toContainEqual({
        path: `$.titles[${titleId}].holder.personId`, before: null, after: child.personId,
      })
      const after = at(a1, reviewYear + 1)
      expect(after.titles.find(t => t.titleId === titleId)?.holder).toEqual({ status: 'HELD', personId: child.personId })
      expect(after.legal.controlMandates.some(m => m.authorizingTitleId === titleId && m.beneficiaryPersonId === child.personId)).toBe(false)
    }
    expect(at(a1, 1318).persons.find(p => p.personId === child.personId)?.alive).toBe(false)
    for (const branch of [a0, a1]) {
      const last = branch.snapshots.at(-1)!
      expect(last.year).toBe(1350)
      expect(branch.goal).toBeNull()
      expect(evaluateGoal(last, config.goal)).toMatchObject({ status: 'NOT_ACHIEVED' })
      expect(last.persons.every(p => !p.alive)).toBe(true)
      expect(last.titles.every(t => t.holder.status === 'UNDETERMINED')).toBe(true)
    }
  })

  it('ゼロ差・未登録候補・法的状態への直接介入を拒否し、管轄不明のペアを登録しない', () => {
    for (const [change, code] of [
      [{ ...modifier, signedDelta: 0 }, 'INVALID_DELTA'],
      [{ ...modifier, targetRef: { kind: 'PERSON_PAIR', ids: competingPair } }, 'UNKNOWN_PERSON'],
      [{ ...modifier, statKey: 'legal.marriage' }, 'UNREGISTERED_STAT_KEY'],
    ] as const) {
      expect(fork(change)).toMatchObject({ ok: false, code: 'MODIFIER_REJECTED', issues: [expect.objectContaining({ code })] })
    }
    const unverified = ['person-exp-05', 'person-exp-07'] as const
    for (const branch of [a0, a1]) {
      expect(pairTrace(branch, 'B-004', unverified).status).toBe('ACCEPT')
      const noAuthority = pairTrace(branch, 'B-005', unverified)
      expect(noAuthority).toMatchObject({ status: 'DEFER', eventIds: [], candidates: [{ inputs: { sourceRequestId: null } }] })
      expect(noAuthority.reasonCodes).toContain('SAME_COUNTRY_JURISDICTION_UNVERIFIED')
      expect(branch.decisionTraces.some(t => t.year === year && t.ruleId === 'A-LEG-01' && samePair(t.actorRef, unverified))).toBe(false)
      expect(branch.eventLog.some(e => e.eventType.split('+').includes('MARRIAGE_REGISTER') &&
        e.involvedRefs.some(ref => samePair(ref, unverified)))).toBe(false)
      expect(branch.snapshots.at(-1)!.legal.marriages.some(m => m.personIds.every((id, i) => id === unverified[i]))).toBe(false)
      expect(branch.eventLog.some(e => e.eventType.split('+').includes('TITLE_RECOGNITION_SET'))).toBe(false)
    }
  })
})
