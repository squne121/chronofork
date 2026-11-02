// 明示出生候補で実B-002→A-DYN-02の決定的縦断。試験専用、GAME-01/02の正式規則ではない。
// C-004は集団人口と出生枠のみを確定。Bは出生Personを内訳として追加し、Aが明示条項で法的王朝を確定。
import { describe, expect, it } from 'vitest'
import { createRootBranch, forkHistory } from '../../../src/simulation/branching/index.ts'
import type { Branch } from '../../../src/simulation/branching/index.ts'
import type { DecisionTrace, EventLogEntry, StatModifier, WorldState } from '../../../src/simulation/contracts/index.ts'
import { runTimeline, runYear } from '../../../src/simulation/engine/index.ts'
import type { EvaluatorMap } from '../../../src/simulation/engine/index.ts'
import { RULE_REGISTRY } from '../../../src/simulation/rule-registry.ts'
import { createADyn02EvidenceEvaluator, createALeg01CalibrationEvaluator } from '../../../src/simulation/rules/a/index.ts'
import type { MarriageApprovalEvidence } from '../../../src/simulation/rules/a/index.ts'
import { createB002CalibrationEvaluator, createB005CalibrationEvaluator } from '../../../src/simulation/rules/b/index.ts'
import type { BirthCandidateEvidence } from '../../../src/simulation/rules/b/index.ts'
import {
  B004_BRANCH_CONFIG as CFG, FORK_YEAR, P4, P5, SEED, TRUST_BOOST, createSyntheticWorld, evaluatorsForLedger,
} from './b004-branch-fixture.ts'

const BIRTH_YEAR = FORK_YEAR + 1
// test-local: 母親役P5を1261年時点31歳とする試験用の生年補正（正式scenarioは変更しない）。
const createBirthWorld = (): WorldState => {
  const w = createSyntheticWorld()
  return { ...w, persons: w.persons.map(p => p.personId === P5 ? { ...p, birthYear: 1230 } : p) }
}
const BIRTH: BirthCandidateEvidence = Object.freeze({
  candidateId: 'explicit-candidate-p4p5-child-01',
  evidenceId: 'synthetic-child-evidence-1261',
  birthYear: BIRTH_YEAR,
  fatherId: P4, motherId: P5, childName: '試験児（明示出生候補）', childSex: 'FEMALE',
  cohortGroupId: 'group-east-elite', houseId: 'house-cardon', provenance: 'CALIBRATION_ONLY',
})
const CONTRACT_CLAUSE = Object.freeze({
  clauseId: 'synthetic-clause-child-vargas',
  kind: 'CHILD_LEGAL_DYNASTY' as const,
  dynastyId: 'dynasty-vargas',
})
const APPROVAL_NO_CLAUSE: MarriageApprovalEvidence = Object.freeze({
  approvalId: 'synthetic-approved-pair45',
  personIds: [P4,P5], authorizedYear: FORK_YEAR, status: 'APPROVED',
  issuerRef: { kind: 'COUNTRY', id: 'country-eldia' }, evidenceId: 'synthetic-approved-document',
  provenance: 'CALIBRATION_ONLY',
  contract: { contractId: 'synthetic-p4p5-contract', evidenceId: 'synthetic-approved-document', clauses: [] },
})
const APPROVAL_WITH_CLAUSE: MarriageApprovalEvidence = Object.freeze({
  ...APPROVAL_NO_CLAUSE,
  contract: { ...APPROVAL_NO_CLAUSE.contract!, clauses: [CONTRACT_CLAUSE] },
})

function evaluate(ledger: readonly StatModifier[], approvals: readonly MarriageApprovalEvidence[] = [APPROVAL_WITH_CLAUSE],
  candidates: readonly BirthCandidateEvidence[] = [BIRTH]): EvaluatorMap {
  const a = createALeg01CalibrationEvaluator(approvals)
  const b = createB002CalibrationEvaluator(candidates)
  if (!a.ok || !b.ok) throw new Error('test fixture evidence invalid')
  return {
    ...evaluatorsForLedger(ledger),
    'B-002': b.evaluator,
    'A-DYN-02': createADyn02EvidenceEvaluator(),
    'B-005': createB005CalibrationEvaluator(),
    'A-LEG-01': a.evaluator,
  }
}
function root(): { a0: Branch; timeline: ReturnType<typeof runTimeline> } {
  const evaluators = evaluate([])
  const timeline = runTimeline(createBirthWorld(), { seed: SEED, branchId:'A0', evaluators })
  const result = createRootBranch(timeline, [], evaluators)
  if (!result.ok) throw new Error(result.code + ': ' + result.message)
  return { a0: result.branch, timeline }
}
function fork(a0: Branch, approvals: readonly MarriageApprovalEvidence[] = [APPROVAL_WITH_CLAUSE],
  candidates: readonly BirthCandidateEvidence[] = [BIRTH], branchId = 'A1'): Branch {
  const result = forkHistory({ parent:a0, forkYear:FORK_YEAR, branchId, modifiers:[TRUST_BOOST],
    evaluatorsFor: ({ ledger }) => evaluate(ledger, approvals, candidates) })
  if (!result.ok) throw new Error(result.code + ': ' + result.message)
  return result.branch
}
const traceAt = (branch: Branch, ruleId: string, year: number): DecisionTrace | undefined =>
  branch.decisionTraces.find((t) => t.ruleId === ruleId && t.year === year)
const eventAt = (branch: Branch, type: string, year: number): EventLogEntry[] =>
  branch.eventLog.filter((e) => e.eventType === type && e.year === year)
const personAt = (branch: Branch, year: number, childId: string) =>
  branch.snapshots[year - branch.startYear]?.persons.find((p) => p.personId === childId)
const childId = (branch: Branch): string => {
  const id = traceAt(branch,'B-002',BIRTH_YEAR)?.candidates[0]?.inputs.childPersonId
  if (typeof id !== 'string') throw new Error('no birth candidate ID')
  return id
}
const childCount = (branch: Branch, year: number): number =>
  branch.snapshots[year - branch.startYear]?.persons.length ?? -1

describe('B-005婚姻 → C-004枠 → B-002出生 → A-DYN-02法的王朝（明示試験証拠）', () => {
  const { a0, timeline } = root()
  const a1 = fork(a0)
  const id = childId(a1)

  it('A0は婚姻がなく、同じ試験出生候補を与えても実Person・出生Event・王朝Eventを作らない', () => {
    expect(timeline.status).toBe('COMPLETED')
    expect(a0.snapshots).toHaveLength(101)
    expect(a0.snapshots[0]?.legal.marriages).toEqual([])
    expect(a0.snapshots[100]?.legal.marriages).toEqual([])
    expect(traceAt(a0,'B-002',BIRTH_YEAR)).toMatchObject({status:'DEFER',reasonCodes:['CALIBRATION_ONLY','ACTIVE_MARRIAGE_REQUIRED']})
    expect(eventAt(a0,'PERSON_BIRTH',BIRTH_YEAR)).toHaveLength(0)
    expect(eventAt(a0,'LEGAL_DYNASTY_SET',BIRTH_YEAR)).toHaveLength(0)
    expect(personAt(a0,BIRTH_YEAR+1,id)).toBeUndefined()
    expect(childCount(a0,1350)).toBe(childCount(a0,1250))
  })

  it('A1は1260年婚姻成立後、1261年のC出生枠でBが記名児1人を登録する（人口二重加算なし）', () => {
    expect(a1.status).toBe('COMPLETED')
    expect(a1.recompute).toMatchObject({fromYear:1260,transitions:90,status:'COMPLETED'})
    expect(a1.snapshots.slice(0,11)).toEqual(a0.snapshots.slice(0,11))
    expect(eventAt(a1,'MARRIAGE_REGISTER',1260)).toHaveLength(1)
    expect(personAt(a1,1261,id)).toBeUndefined()
    const child = personAt(a1,1262,id)!
    expect(child).toMatchObject({personId:id,fatherId:P4,motherId:P5,birthYear:1261,sex:'FEMALE',originGroupId:'group-east-elite',
      alive:true,houseId:'house-cardon'})
    expect(childCount(a1,1262)).toBe(childCount(a0,1262)+1)
    expect(a1.snapshots.map((w)=>w.groups)).toEqual(a0.snapshots.map((w)=>w.groups))
    const birth = traceAt(a1,'B-002',BIRTH_YEAR)!
    expect(birth).toMatchObject({status:'ACCEPT',ruleId:'B-002',year:1261})
    expect(birth.candidates[0]?.inputs).toMatchObject({evidenceId:BIRTH.evidenceId,childPersonId:id,marriageId:a1.snapshots[11]!.legal.marriages[0]!.marriageId})
    const events = eventAt(a1,'PERSON_BIRTH',BIRTH_YEAR)
    expect(events).toHaveLength(1)
    expect(events[0]?.sourceTraceIds).toEqual([birth.traceId])
    expect(birth.eventIds).toEqual([events[0]?.eventId])
    expect(events[0]?.involvedRefs).toContainEqual({kind:'PERSON',id})
    expect(events[0]?.stateChanges.some((s)=>s.path.includes('persons'))).toBe(true)
    expect(a1.eventLog.filter((e)=>e.eventType==='POPULATION_COHORT')).toEqual(a0.eventLog.filter((e)=>e.eventType==='POPULATION_COHORT'))
  })

  it('A-DYN-02は同年に実出生Eventを参照し、明示されたCHILD_LEGAL_DYNASTY条項だけで法的王朝を確定する', () => {
    expect(personAt(a1,1262,id)?.legalDynasty).toEqual({status:'DETERMINED',dynastyId:'dynasty-vargas'})
    const bt = traceAt(a1,'B-002',1261)!
    const lt = traceAt(a1,'A-DYN-02',1261)!
    expect(lt.status).toBe('ACCEPT')
    expect(lt.candidates[0]?.inputs).toMatchObject({
      sourceB002TraceId:bt.traceId,
      sourceBirthEventIds:bt.eventIds,
      childPersonId:id,
      marriageId:traceAt(a1,'B-002',1261)!.candidates[0]!.inputs.marriageId,
      contractEvidenceId:APPROVAL_WITH_CLAUSE.evidenceId,
      dynastyId:'dynasty-vargas',clauseId:CONTRACT_CLAUSE.clauseId,
    })
    const events = eventAt(a1,'LEGAL_DYNASTY_SET',1261)
    expect(events).toHaveLength(1)
    expect(lt.eventIds).toEqual([events[0]?.eventId])
    expect(events[0]?.sourceTraceIds).toEqual([lt.traceId])
    expect(events[0]?.stateChanges.some(s=>s.path.includes('legalDynasty'))).toBe(true)
    const birthEvents = eventAt(a1,'PERSON_BIRTH',1261)
    expect(a1.eventLog.indexOf(birthEvents[0]!) < a1.eventLog.indexOf(events[0]!)).toBe(true)
    expect(a1.snapshots[100]?.titles).toEqual(a0.snapshots[100]?.titles)
    expect(a1.goal).toBeNull()
  })

  it('明示王朝条項なしでもBは出生を登録するがAはDEFERし法的王朝を推定しない（GAME-01）', () => {
    const noClause = fork(a0,[APPROVAL_NO_CLAUSE])
    const child = personAt(noClause,1262,id)
    expect(child?.legalDynasty.status).toBe('UNDETERMINED')
    expect(traceAt(noClause,'B-002',1261)?.status).toBe('ACCEPT')
    expect(traceAt(noClause,'A-DYN-02',1261)).toMatchObject({status:'DEFER',reasonCodes:['CALIBRATION_ONLY','GAME_01_EXPLICIT_CLAUSE_ONLY','GAME_01_DYNASTY_CLAUSE_MISSING']})
    expect(eventAt(noClause,'PERSON_BIRTH',1261)).toHaveLength(1)
    expect(eventAt(noClause,'LEGAL_DYNASTY_SET',1261)).toHaveLength(0)
    expect(personAt(noClause,1350,id)?.legalDynasty.status).toBe('UNDETERMINED')
  })

  it('婚姻承認の欠落/PENDINGではA1でも実婚姻・出生・子の王朝Eventは作らない', () => {
    for (const records of [[], [{ ...APPROVAL_WITH_CLAUSE,status:'PENDING' as const }]]) {
      const noApproval=fork(a0,records)
      expect(eventAt(noApproval,'MARRIAGE_REGISTER',1260)).toHaveLength(0)
      expect(traceAt(noApproval,'B-002',1261)?.status).toBe('DEFER')
      expect(eventAt(noApproval,'PERSON_BIRTH',1261)).toHaveLength(0)
      expect(eventAt(noApproval,'LEGAL_DYNASTY_SET',1261)).toHaveLength(0)
    }
  })

  it('出生候補がないと婚姻だけが成立し、Bは出生Personを作らない', () => {
    const withoutCandidate=fork(a0,[APPROVAL_WITH_CLAUSE],[])
    expect(eventAt(withoutCandidate,'MARRIAGE_REGISTER',1260)).toHaveLength(1)
    expect(eventAt(withoutCandidate,'PERSON_BIRTH',1261)).toHaveLength(0)
    expect(traceAt(withoutCandidate,'B-002',1261)).toBeUndefined()
    expect(childCount(withoutCandidate,1350)).toBe(childCount(a0,1350))
  })

  it('C004出生枠なし・空枠の年はB002がDEFERしPerson/Eventを偽造しない', () => {
    const w = a1.snapshots.find(s=>s.year===1261)!
    const b = createB002CalibrationEvaluator([BIRTH])
    expect(b.ok).toBe(true)
    if(!b.ok)return
    const empty = runYear(w,{seed:SEED,evaluators:{'B-002':b.evaluator,'A-DYN-02':createADyn02EvidenceEvaluator()}})
    expect(empty.status).toBe('COMPLETED')
    if(empty.status!=='COMPLETED')return
    expect(empty.traces.find(x=>x.ruleId==='B-002')).toMatchObject({status:'DEFER',reasonCodes:['CALIBRATION_ONLY','COHORT_SLOT_UNAVAILABLE']})
    expect(empty.events).toHaveLength(0)
    expect(empty.world.persons.find(p=>p.personId===id)).toBeUndefined()
    const zeroWorld:WorldState={...w,demographics:{cohortSlots:[{groupId:BIRTH.cohortGroupId,year:1261,birthSlots:0,deathSlots:0,claimedBirths:0,claimedDeaths:0}]}}
    const zero=runYear(zeroWorld,{seed:SEED,evaluators:{'B-002':b.evaluator,'A-DYN-02':createADyn02EvidenceEvaluator()}})
    expect(zero.status).toBe('COMPLETED')
    if(zero.status!=='COMPLETED')return
    expect(zero.traces.find(x=>x.ruleId==='B-002')).toMatchObject({status:'DEFER',reasonCodes:['CALIBRATION_ONLY','COHORT_SLOT_EXHAUSTED']})
    expect(zero.events).toHaveLength(0)
  })

  it('親の死亡・不在では候補はDEFERで、出生Event・Personを作らない', () => {
    const born = a1.snapshots.find(s=>s.year===1261)!
    const dead:WorldState={...born,persons:born.persons.map(p=>p.personId===P4?{...p,alive:false,deathYear:1260}:p)}
    const b=createB002CalibrationEvaluator([BIRTH])
    if(!b.ok)throw new Error('unexpected candidate failure')
    const r=runYear(dead,{seed:SEED,evaluators:{'B-002':b.evaluator}})
    expect(r.status).toBe('COMPLETED')
    if(r.status!=='COMPLETED')return
    expect(r.traces.find(t=>t.ruleId==='B-002')).toMatchObject({status:'DEFER',reasonCodes:['CALIBRATION_ONLY','PARENTS_UNAVAILABLE']})
    expect(r.events).toHaveLength(0)
    expect(r.world.persons.some(p=>p.personId===id)).toBe(false)
  })

  it('不正・重複した出生候補は事前拒否、同seed/別branchIdでも新PersonとEvent IDは決定的', () => {
    expect(createB002CalibrationEvaluator([BIRTH,BIRTH]).ok).toBe(false)
    expect(createB002CalibrationEvaluator([{...BIRTH,birthYear:1350}]).ok).toBe(false)
    expect(createB002CalibrationEvaluator([{...BIRTH,fatherId:P5,motherId:P5}]).ok).toBe(false)
    expect(createB002CalibrationEvaluator([]).ok).toBe(true)
    const second=fork(a0,[APPROVAL_WITH_CLAUSE],[BIRTH],'A1-alt')
    expect(personAt(second,1262,id)).toEqual(personAt(a1,1262,id))
    expect(eventAt(second,'PERSON_BIRTH',1261)).toEqual(eventAt(a1,'PERSON_BIRTH',1261))
    expect(eventAt(second,'LEGAL_DYNASTY_SET',1261)).toEqual(eventAt(a1,'LEGAL_DYNASTY_SET',1261))
    expect(fork(a0)).toEqual(a1)
  })

  it('37 RuleIDをTODOのまま、実C004人口Eventの再計算、1350のGoal未成立を維持', () => {
    expect(RULE_REGISTRY).toHaveLength(37)
    expect(RULE_REGISTRY.every(x=>x.implementationStatus==='TODO')).toBe(true)
    expect(timeline.coverage.todoRuleIds).toHaveLength(37)
    expect(timeline.autonomousHistory.status).toBe('NOT_ESTABLISHED')
    expect(a1.recompute?.suffixCoverage.injectedTodoRuleIds).toContain('B-002')
    expect(a1.recompute?.suffixCoverage.injectedTodoRuleIds).toContain('A-DYN-02')
    expect(timeline.goal).toBeNull()
    expect(a1.goal).toBeNull()
    expect(a1.snapshots[100]?.year).toBe(1350)
    expect(a0.snapshots[100]?.year).toBe(1350)
  })
})
