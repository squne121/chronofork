// DEC-061: 公開reducerからも婚姻成立前の補助人物の個別化を拒否する。
import { describe, expect, it } from 'vitest'
import type { MarriageRegisterCommand, Person, PersonSupportingRecordCommand } from '../../../../src/simulation/contracts/index.ts'
import { newTx, newWorld, outcome, rejectionCodes, run, source } from './helpers.ts'

const world = (() => {
  const w = newWorld()
  return { ...w, year: 1270, demographics: { ...w.demographics,
    anonymousBirthHistory: [{ groupId: 'group-east-elite', year: 1250, anonymousBirths: 1 }] } }
})()

const command = (cohortId: string, tag: string): PersonSupportingRecordCommand => {
  const person: Person = {
    personId: 'support:population:' + JSON.stringify([cohortId, 0]),
    name: '試験用補助人物 ' + cohortId, interactionRole: 'SUPPORTING', sex: 'FEMALE',
    birthYear: 1250, alive: true, originGroupId: 'group-east-elite', houseId: 'house-cardon',
    legalDynasty: { status: 'UNDETERMINED', reasonCodes: ['POPULATION_COHORT_NOT_A_DYNASTY_PROOF'] },
  }
  return {
    type: 'PERSON_SUPPORTING_RECORD', commandId: 'cmd-' + tag, source: source('B-001', 3, tag, 1270),
    person, cohortId, cohortSize: 1, memberOrdinal: 0, familyPoolId: 'pool-' + tag,
    sourceEvidenceId: 'ev-' + tag, birthBacking: 'C004_COHORT', survivorAttestationId: 'att-' + tag,
  }
}

const marriage = (tag: string, spouse: string, overrides: Partial<MarriageRegisterCommand['marriage']> = {}): MarriageRegisterCommand => {
  const { type: _, commandId, source: _source, ...supportingPerson } = command('cohort-' + tag, tag)
  void _; void _source
  return { type: 'MARRIAGE_REGISTER', commandId, source: source('A-LEG-01', 3, tag, 1270), supportingPerson,
    marriage: { marriageId: 'marriage-' + tag, personIds: [spouse, supportingPerson.person.personId],
      registeredYear: 1270, status: 'ACTIVE', ...overrides } }
}

describe('補助人物の成立前個別化（DEC-061）', () => {
  it('婚姻が非成立なら補助人物追加もロールバックし、匿名出生枠を消費しない', () => {
    const tx = newTx('main', 1270)
    const bad = run(world, outcome('A-LEG-01', 3, [marriage('bad', 'person-missing')]), tx)
    expect(bad.status).toBe('REJECTED')
    expect(bad.world).toEqual(world)
    expect(bad.transaction).toBe(tx)
    expect(bad.applied).toEqual([])
    const first = run(bad.world, outcome('A-LEG-01', 3, [marriage('a', 'person-exp-01')]), bad.transaction)
    expect(first.status).toBe('APPLIED')
    expect(first.world.persons).toHaveLength(world.persons.length + 1)
    expect(first.world.groups).toEqual(world.groups)
    const second = run(first.world, outcome('A-LEG-01', 3, [marriage('b', 'person-exp-02')]), first.transaction)
    expect(rejectionCodes(second)).toContain('COHORT_CAPACITY_CONFLICT')
    expect(second.world).toEqual(first.world)
    expect(second.transaction).toBe(first.transaction)
  })
  it('有効な匿名出生枠があっても、旧B-001コマンドの単独適用を拒否する', () => {
    const tx = newTx('main', 1270)
    const result = run(world, outcome('B-001', 3, [command('cohort-a', 'a')]), tx)
    expect(result.status).toBe('REJECTED')
    expect(rejectionCodes(result)).toContain('WRITE_OWNER_VIOLATION')
    expect(result.world).toEqual(world)
    expect(result.transaction).toBe(tx)
    expect(result.applied).toHaveLength(0)
  })
  it.each(['SUPPORTING', 'KEY'] as const)('人口候補を人物昇格で登録できない（%s）', interactionRole => {
    const record = command('cohort-a', 'a')
    const tx = newTx('main', 1270)
    const result = run(world, outcome('B-001', 3, [{
      type: 'PERSON_PROMOTE', commandId: record.commandId, source: record.source,
      person: { ...record.person, interactionRole }, cohortId: record.cohortId,
      cohortBirthYear: record.person.birthYear, cohortSize: 1, memberOrdinal: 0,
      identityEvidenceId: 'independent-test-identity',
    }]), tx)
    expect(rejectionCodes(result)).toContain('WRITE_OWNER_VIOLATION')
    expect(result.world).toEqual(world)
    expect(result.transaction).toBe(tx)
  })
})
