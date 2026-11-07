// DEC-061 レビューP2-1: 別コホートが同じ集団・出生年の匿名出生枠を共有しても、reducerが超過を拒否する。
import { describe, expect, it } from 'vitest'
import type { Person, PersonSupportingRecordCommand } from '../../../../src/simulation/contracts/index.ts'
import { newTx, newWorld, outcome, run, source } from './helpers.ts'

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

describe('補助人物の匿名出生枠の共有上限（CALIBRATION_ONLY）', () => {
  it('枠1の集団・出生年では、別コホートの2人目をreducerが拒否する', () => {
    const first = run(world, outcome('B-001', 3, [command('cohort-a', 'a')]), newTx('main', 1270))
    expect(first.status).toBe('APPLIED')
    const second = run(first.world, outcome('B-001', 3, [command('cohort-b', 'b')]), first.transaction)
    expect(second.status).not.toBe('APPLIED')
    expect(JSON.stringify(second.units)).toContain('COHORT_CAPACITY_CONFLICT')
    expect(second.world.persons.filter(p => p.interactionRole === 'SUPPORTING')).toHaveLength(1)
  })
})
