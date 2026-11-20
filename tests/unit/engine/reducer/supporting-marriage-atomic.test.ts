import { describe, expect, it } from 'vitest'
import type { MarriageRegisterCommand, SupportingPersonRegistration, WorldState } from '../../../../src/simulation/contracts/index.ts'
import { buildEvents } from '../../../../src/simulation/engine/history.ts'
import { runYear } from '../../../../src/simulation/engine/index.ts'
import { newTx, newWorld, outcome, rejectionCodes, run, source } from './helpers.ts'

const initial = (): WorldState => ({ ...newWorld(), year: 1270, demographics: {
  ...newWorld().demographics, anonymousBirthHistory: [{ groupId: 'group-east-elite', year: 1250, anonymousBirths: 1 }],
} })
const supporting = (cohortId = 'cohort-a'): SupportingPersonRegistration => ({
  person: { personId: 'support:population:' + JSON.stringify([cohortId, 0]), name: '補助人物', interactionRole: 'SUPPORTING', sex: 'FEMALE', birthYear: 1250, alive: true, originGroupId: 'group-east-elite', houseId: 'house-cardon', legalDynasty: { status: 'UNDETERMINED', reasonCodes: ['POPULATION_COHORT_NOT_A_DYNASTY_PROOF'] } },
  cohortId, cohortSize: 1, memberOrdinal: 0, familyPoolId: 'pool', sourceEvidenceId: 'evidence', birthBacking: 'C004_COHORT', survivorAttestationId: 'survivor',
})
const command = (p = supporting(), id = 'one'): MarriageRegisterCommand => ({
  type: 'MARRIAGE_REGISTER', commandId: id, source: source('A-LEG-01', 3, id, 1270), supportingPerson: p,
  marriage: { marriageId: 'mar-' + id, personIds: ['person-exp-02', p.person.personId], registeredYear: 1270, status: 'ACTIVE' },
})
const apply = (w: WorldState, c: MarriageRegisterCommand, tx = newTx('main', 1270)) => run(w, outcome('A-LEG-01', 3, [c]), tx)

describe('成立時の補助人物と婚姻の原子的登録', () => {
  it('一つのcommandで両方を登録し、人口と参照を保持する', () => {
    const w = initial(), c = command(), o = outcome('A-LEG-01', 3, [c])
    const r = run(w, o, newTx('main', 1270))
    expect(r.status).toBe('APPLIED')
    expect(r.world.persons).toContainEqual(c.supportingPerson!.person)
    expect(r.world.legal.marriages).toContainEqual({ ...c.marriage, supportingPopulationEvidenceIds: [
      c.supportingPerson!.sourceEvidenceId, c.supportingPerson!.survivorAttestationId,
    ] })
    expect(r.world.groups).toEqual(w.groups)
    expect(r.world.demographics).toEqual(w.demographics)
    expect(r.applied).toHaveLength(1)
    const event = buildEvents(o, r, r.world)[0]!
    expect(event.involvedRefs).toContainEqual({ kind: 'PERSON', id: c.supportingPerson!.person.personId })
    expect(event.involvedRefs).toContainEqual({ kind: 'GROUP', id: 'group-east-elite' })
    expect(event.supportingMarriageRegistrations).toEqual([{ commandId: c.commandId, requestId: c.source.requestId,
      sourceTraceId: c.source.sourceTraceId, marriageId: c.marriage.marriageId, registration: c.supportingPerson }])
  })
  it('人物検証と婚姻検証のそれぞれの失敗で何も確定しない', () => {
    const w = initial(), c = command()
    for (const invalid of [
      { ...c, supportingPerson: { ...c.supportingPerson!, survivorAttestationId: undefined } },
      { ...c, marriage: { ...c.marriage, registeredYear: 1269 } },
      { ...c, marriage: { ...c.marriage, personIds: ['person-exp-02', 'person-exp-03'] as [string, string] } },
    ]) {
      const tx = newTx('main', 1270), r = apply(w, invalid, tx)
      expect(r.status).toBe('REJECTED')
      expect(r.world).toEqual(w)
      expect(r.transaction).toBe(tx)
      expect(r.applied).toHaveLength(0)
    }
  })
  it('再送は重複扱いとし、requestId競合と候補の再使用を拒否する', () => {
    const w = initial(), c = command(), first = apply(w, c)
    expect(first.status).toBe('APPLIED')
    expect(apply(first.world, c, first.transaction).status).toBe('DUPLICATE')
    expect(apply(first.world, { ...c, commandId: 'new' }, first.transaction).status).toBe('DUPLICATE')
    const conflict = apply(first.world, { ...c, commandId: 'new', marriage: { ...c.marriage, marriageId: 'different' } }, first.transaction)
    expect(conflict.status).toBe('CONFLICT')
    expect(rejectionCodes(conflict)).toContain('REQUEST_ID_CONFLICT')
    expect(apply(first.world, command(supporting(), 'other'), first.transaction).status).toBe('REJECTED')
  })
  it('年次経路はACCEPT照会に偽の補助人物登録を付けても停止する', () => {
    const w = initial(), c = command(), ids = c.marriage.personIds
    const r = runYear(w, { seed: 1, evaluators: {
      'B-005': (_world, ctx) => ({ ruleId: 'B-005', phase: 3, commands: [], deferred: [],
        traceDrafts: [{ year: w.year, phase: 3, ruleId: 'B-005', actorRef: { kind: 'PERSON_PAIR', ids }, candidates: [], status: 'ACCEPT', reasonCodes: [], modifierIds: [], ruleVersion: 'test' }],
        requests: [{ kind: 'LEGAL_MARRIAGE_QUERY', targetDomain: 'A', requiredResponseYear: w.year,
          source: { ...source('B-005', 3, 'one', w.year), sourceTraceId: ctx.traceId(0) }, payload: { kind: 'LEGAL_MARRIAGE_QUERY', personIds: ids } }] }),
      'A-LEG-01': (_world, ctx) => ({ ruleId: 'A-LEG-01', phase: 3, requests: [], deferred: [],
        commands: [{ ...c, source: { ...c.source, sourceTraceId: ctx.traceId(0) } }],
        responses: [{ requestId: c.source.requestId, status: 'ACCEPT', reasonCodes: [] }],
        traceDrafts: [{ year: w.year, phase: 3, ruleId: 'A-LEG-01', actorRef: { kind: 'PERSON_PAIR', ids },
          candidates: [{ candidateId: 'candidate', eligible: true, inputs: { sourceRequestId: c.source.requestId }, reasonCodes: [] }],
          status: 'ACCEPT', reasonCodes: [], modifierIds: [], ruleVersion: 'test' }] }),
    } })
    expect(r.status).toBe('HALTED')
    expect(r.world).toEqual(w)
    if (r.status === 'HALTED') {
      expect(r.halt.code).toBe('INVALID_OUTCOME')
      expect(r.halt.message).toContain('当年・当枝のB-001候補供給から再導出できません')
    }
  })
  it('A-LEG-01以外には成立時の補助人物登録を許可しない', () => {
    const w = initial(), c = command()
    const other = { ...c, source: source('A-DYN-02', 3, 'other', 1270) }
    const r = run(w, outcome('A-DYN-02', 3, [other]), newTx('main', 1270))
    expect(rejectionCodes(r)).toContain('WRITE_OWNER_VIOLATION')
    expect(r.world).toEqual(w)
  })
  it('共有C004出生枠と重婚を拒否し部分確定しない', () => {
    const first = apply(initial(), command())
    const second = command(supporting('cohort-b'), 'two')
    const capacity = apply(first.world, second, first.transaction)
    expect(rejectionCodes(capacity)).toContain('COHORT_CAPACITY_CONFLICT')
    expect(capacity.world).toEqual(first.world)
    const w = initial(), ordinary: MarriageRegisterCommand = { type: 'MARRIAGE_REGISTER', commandId: 'ordinary', source: source('A-LEG-01', 3, 'ordinary', 1270), marriage: { marriageId: 'ordinary', personIds: ['person-exp-02', 'person-exp-03'], registeredYear: 1270, status: 'ACTIVE' } }
    const married = apply(w, ordinary)
    expect(married.status).toBe('APPLIED')
    const bigamy = apply(married.world, command(), married.transaction)
    expect(rejectionCodes(bigamy)).toContain('PERSON_ALREADY_MARRIED')
    expect(bigamy.world).toEqual(married.world)
  })
})
