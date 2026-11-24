import { expect, it } from 'vitest'
import { createMultiHouseWorld, MULTI_HOUSE_GOAL, MULTI_HOUSE_SEED, multiHouseRunConfigDigest }
  from '../../../src/scenario/experimental/multi-house-playtest.ts'
import { createMultiHouseAbstractEvaluators, multiHouseAbstractRunConfigDigest, multiHouseAbstractRunConfigIdentity }
  from '../../../src/scenario/experimental/multi-house-abstract-marriage.ts'
import { createRootBranch, forkHistory } from '../../../src/simulation/branching/index.ts'
import type { DecisionTrace, EventLogEntry, StatModifier, WorldState } from '../../../src/simulation/contracts/index.ts'
import { PAIR_TRUST_STAT_KEY, STAT_MODIFIER_RULE_VERSION } from '../../../src/simulation/contracts/index.ts'
import { runTimeline, runYear } from '../../../src/simulation/engine/index.ts'

const full = process.env.CHRONOFORK_LONG_ABSTRACT_MARRIAGE === '1' ? it : it.skip
const caseSeed = MULTI_HOUSE_SEED
const options = {seed: caseSeed, goal: MULTI_HOUSE_GOAL, technicalGoalEvaluation: true}
const pairKey = (p: readonly string[]) => JSON.stringify([...p].sort())
const birthId = (e: EventLogEntry) => {
  const ref = e.involvedRefs.find(r => r.kind === 'PERSON')
  return ref?.kind === 'PERSON' ? ref.id : undefined
}
const isOffer = (t: DecisionTrace) => t.ruleId === 'B-001' && t.status === 'ACCEPT' && t.reasonCodes.includes('SUPPORTING_CANDIDATE_ONLY')

it('v1は明示的な別構成でありv0のdigestと入力を変更しない', () => {
  expect(multiHouseRunConfigDigest()).toBe('5090c8485f4b8570')
  expect(multiHouseAbstractRunConfigDigest()).not.toBe(multiHouseRunConfigDigest())
  const identity = multiHouseAbstractRunConfigIdentity()
  expect(identity).toMatchObject({configId: 'experimental-multi-house-v1',
    abstractMarriageSupply: {status: 'CALIBRATION_ONLY'}, ruleVersions: {abstractMarriageBackground: expect.any(String)}})
  expect(identity).not.toHaveProperty('supportingCandidateTrustBase')
  expect(identity).not.toHaveProperty('supportingKinshipClearances')
})

full('実1250–1350年: 特定の人物・相手・成功年を指定せず、実出生から次の合法王朝成員に至る', () => {
  const initial = createMultiHouseWorld()
  const evaluators = createMultiHouseAbstractEvaluators(initial)
  const run = runTimeline(initial, {...options, branchId: 'A0', evaluators})
  expect(run.halt).toBeNull()
  expect(run.transitions).toBe(100)
  const final = run.snapshots.at(-1)!
  const traces = new Map(run.decisionTraces.map(t => [t.traceId, t]))
  const birthEvents = run.eventLog.filter(e => e.eventType === 'PERSON_BIRTH' &&
    e.sourceTraceIds.some(id => traces.get(id)?.ruleId === 'B-002' && traces.get(id)?.status === 'ACCEPT'))
  const born = new Map(birthEvents.map(e => [birthId(e), e]))
  const persons = new Map(final.persons.map(p => [p.personId, p]))
  const candidates = run.decisionTraces.filter(isOffer)
  const fromBorn = candidates.filter(t => born.has(String(t.candidates[0]?.inputs.seekerPersonId)))
  expect(new Set(fromBorn.map(t => t.candidates[0]?.inputs.seekerPersonId)).size).toBeGreaterThan(1)
  const registrations = run.eventLog.flatMap(e => (e.supportingMarriageRegistrations ?? []).map(row => ({e, row})))
  const unique = new Set(registrations.map(({row}) => row.registration.person.personId))
  expect(unique.size).toBe(registrations.length)
  expect(final.persons.filter(p => p.interactionRole === 'SUPPORTING').map(p => p.personId).sort()).toEqual([...unique].sort())
  const marriages = new Map(final.legal.marriages.map(m => [m.marriageId, m]))
  const paths = registrations.flatMap(({e, row}) => {
    const {person, sourceEvidenceId, survivorAttestationId, birthBacking} = row.registration
    const m = marriages.get(row.marriageId)!
    const seeker = m.personIds.find(id => id !== person.personId)!
    const birth = born.get(seeker)
    if (!birth || birth.year + 18 > e.year) return []
    const offer = fromBorn.find(t => t.year === e.year && t.candidates.some(c =>
      c.inputs.seekerPersonId === seeker && c.inputs.supportingCandidateId === person.personId))
    if (birthBacking !== 'C004_COHORT' || !offer || !survivorAttestationId || survivorAttestationId === sourceEvidenceId) return []
    const preceding = run.snapshots[e.year - initial.year]!
    expect(preceding.persons.some(p => p.personId === person.personId)).toBe(false)
    expect(preceding.demographics.anonymousBirthHistory?.some(r =>
      r.year === person.birthYear && r.groupId === person.originGroupId && r.anonymousBirths > 0)).toBe(true)
    const review = traces.get(row.sourceTraceId)
    const consent = run.decisionTraces.find(t => t.year === e.year && t.ruleId === 'B-005' && t.status === 'ACCEPT' &&
      t.actorRef.kind === 'PERSON_PAIR' && pairKey(t.actorRef.ids) === pairKey(m.personIds))
    expect(review?.ruleId).toBe('A-LEG-01')
    expect(review?.status).toBe('ACCEPT')
    expect(consent?.candidates[0]?.inputs.supportingKinshipClearanceRecordKey).toEqual(expect.any(String))
    for (const childBirth of birthEvents) {
      if (childBirth.year <= e.year || (m.dissolvedYear !== undefined && childBirth.year >= m.dissolvedYear)) continue
      const child = persons.get(birthId(childBirth)!)!
      if (!child.fatherId || !child.motherId || pairKey([child.fatherId, child.motherId]) !== pairKey(m.personIds) ||
          child.legalDynasty.status !== 'DETERMINED') continue
      const expectedDynasty = m.contract?.clauses.find(c => c.kind === 'CHILD_LEGAL_DYNASTY')?.dynastyId
      expect(child.legalDynasty.dynastyId).toBe(expectedDynasty)
      const dynasty = run.decisionTraces.find(t => t.year === childBirth.year && t.ruleId === 'A-DYN-02' &&
        t.status === 'ACCEPT' && t.actorRef.kind === 'PERSON' && t.actorRef.id === child.personId)
      if (dynasty) return [{birth, e, childBirth, child, dynasty}]
    }
    return []
  })
  expect(paths.length).toBeGreaterThan(0)
  const withRegistered = final.legal.marriages.filter(m => m.personIds.some(id => unique.has(id)) &&
    registrations.every(({row}) => row.marriageId !== m.marriageId))
  expect(withRegistered.length).toBeGreaterThan(0)
  for (const m of withRegistered) {
    const consent = run.decisionTraces.find(t => t.year === m.registeredYear && t.ruleId === 'B-005' &&
      t.status === 'ACCEPT' && t.actorRef.kind === 'PERSON_PAIR' && pairKey(t.actorRef.ids) === pairKey(m.personIds))
    expect(consent?.candidates[0]?.inputs.supportingKinshipClearanceRecordKey).toEqual(expect.any(String))
  }
  expect(run.decisionTraces.some(t => t.ruleId === 'B-005' && t.status === 'DEFER' &&
    t.reasonCodes.some(code => ['ABSTRACT_KINSHIP_PROHIBITED', 'ABSTRACT_KINSHIP_INVESTIGATION_INCOMPLETE'].includes(code)))).toBe(true)

  // 保存・再開: B-001→A-LEG-01まで実行して、年次証拠を新しい評価器で再照合する。
  const year = paths[0]!.e.year
  const index = year - initial.year
  const saved = JSON.parse(JSON.stringify(run.snapshots[index])) as WorldState
  const resumed = runYear(saved, {seed: options.seed, branchId: 'A0', evaluators: createMultiHouseAbstractEvaluators(saved)})
  if (resumed.status !== 'COMPLETED') throw new Error(JSON.stringify(resumed.halt))
  expect(resumed.world).toEqual(run.snapshots[index + 1])
  expect(resumed.traces).toEqual(run.decisionTraces.filter(t => t.year === year))
  expect(resumed.events).toEqual(run.eventLog.filter(e => e.year === year))

  const root = createRootBranch(run, [], evaluators)
  if (!root.ok) throw new Error(root.message)
  const source = root.branch.snapshots.at(-1)
  const fork = (parent: typeof root.branch, branchId: string, year: number) => {
    const start = parent.snapshots[year - initial.year]!
    const modifier: StatModifier = {modifierId: `abstract-fork:${branchId}`, interventionId: `abstract-fork:${branchId}`,
      targetRef: {kind: 'PERSON_PAIR', ids: ['person-exp-01', 'person-exp-05']}, statKey: PAIR_TRUST_STAT_KEY,
      signedDelta: 20, startYear: year, endExclusiveYear: year + 1, decayPolicy: 'NONE', ruleVersion: STAT_MODIFIER_RULE_VERSION}
    const result = forkHistory({parent, branchId, forkYear: year, modifiers: [modifier],
      evaluatorsFor: ({ledger}) => createMultiHouseAbstractEvaluators(start, ledger)})
    if (!result.ok) throw new Error(result.message)
    expect(result.branch.status).toBe('COMPLETED')
    expect(result.branch.snapshots.slice(0, year - initial.year + 1)).toEqual(parent.snapshots.slice(0, year - initial.year + 1))
    expect(result.branch.decisionTraces.filter(t => t.year < year)).toEqual(parent.decisionTraces.filter(t => t.year < year))
    const rows = (ts: readonly DecisionTrace[]) => ts.filter(t => t.year === year && isOffer(t)).flatMap(t =>
      t.candidates.map(({inputs: {candidateBranchId, ...inputs}}) => { void candidateBranchId; return inputs }))
    const prefork = rows(parent.decisionTraces)
    expect(prefork.length).toBeGreaterThan(0)
    expect(rows(result.branch.decisionTraces)).toEqual(prefork)
    return result.branch
  }
  // 介入の成功ではなく、有根拠候補が観測できる末尾の2年を枝隔離に使う。
  const years = [...new Set(candidates.map(t => t.year))].slice(-2)
  expect(years).toHaveLength(2)
  const a1 = fork(root.branch, 'A1', years[0]!)
  const a1Last = a1.snapshots.at(-1)
  const a2 = fork(a1, 'A2', years[1]!)
  expect(root.branch.snapshots.at(-1)).toBe(source)
  expect(a1.snapshots.at(-1)).toBe(a1Last)
  expect(root.branch.ledger).toHaveLength(0)
  expect(a1.ledger).toHaveLength(1)
  expect(a2.ledger).toHaveLength(2)
}, 300_000)
