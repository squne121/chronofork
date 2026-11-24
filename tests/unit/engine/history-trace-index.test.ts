// Issue #110 工程2C: buildTraces の索引化（traceId → eventIds / 紐づく command）が、Trace ごとに events・commands を
// 全走査していた旧実装と同一の DecisionTrace（eventIds の順序・重複除去・DUPLICATE_COMMAND・REJECT 化）を返すこと。
import { describe, expect, it } from 'vitest'
import type { DecisionTrace, DecisionTraceDraft, DomainCommand, EventLogEntry, RuleOutcome } from '../../../src/simulation/contracts/index.ts'
import { buildTraces } from '../../../src/simulation/engine/history.ts'
import { traceIdOf } from '../../../src/simulation/engine/ids.ts'
import { cloneData } from '../../../src/simulation/engine/reducer/canonical.ts'

/** 最適化前の buildTraces（参照実装）。 */
function referenceBuildTraces(outcome: RuleOutcome, events: readonly EventLogEntry[], year: number, rejectedBy?: readonly string[]): DecisionTrace[] {
  return outcome.traceDrafts.map((d: DecisionTraceDraft, i) => {
    const traceId = traceIdOf(year, outcome.phase, outcome.ruleId, i)
    const eventIds = events.filter((e) => e.sourceTraceIds.includes(traceId)).map((e) => e.eventId)
    const linked = outcome.commands.filter((c) => c.source.sourceTraceId === traceId)
    const reasonCodes = [...d.reasonCodes]
    let status = d.status
    if (rejectedBy) {
      if (status === 'ACCEPT') status = 'REJECT'
      reasonCodes.push(...rejectedBy)
    } else if (linked.length > 0 && eventIds.length === 0) reasonCodes.push('DUPLICATE_COMMAND')
    const base = { traceId, year: d.year, phase: d.phase, ruleId: d.ruleId, actorRef: d.actorRef, candidates: d.candidates, status,
      reasonCodes, modifierIds: d.modifierIds, eventIds: rejectedBy ? [] : eventIds, ruleVersion: d.ruleVersion }
    const withSelected = d.selectedCandidateId === undefined ? base : { ...base, selectedCandidateId: d.selectedCandidateId }
    return cloneData(d.random === undefined ? withSelected : { ...withSelected, random: d.random }) as DecisionTrace
  })
}

const rng = (seed: number) => () => {
  seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0
  return seed / 0x100000000
}
const YEAR = 1260

describe('buildTraces: 索引化は参照実装と同一', () => {
  it('乱数 2000 件（重複参照・未知 trace・紐づく command のみ・REJECT 化を含む）', () => {
    const r = rng(5)
    for (let n = 0; n < 2000; n++) {
      const drafts = Array.from({ length: Math.floor(r() * 8) }, (_, i): DecisionTraceDraft => ({
        year: YEAR, phase: 3, ruleId: 'B-009', actorRef: { kind: 'PERSON', id: `p${i}` }, candidates: [],
        status: r() < 0.7 ? 'ACCEPT' : r() < 0.5 ? 'REJECT' : 'DEFER', reasonCodes: ['X'], modifierIds: [], ruleVersion: 'v',
        ...(r() < 0.3 ? { selectedCandidateId: 'c' } : {}),
      }))
      const tid = () => r() < 0.1 ? 'trace:unknown' : traceIdOf(YEAR, 3, 'B-009', Math.floor(r() * (drafts.length + 1)))
      const commands = Array.from({ length: Math.floor(r() * 8) }, (_, i) => ({
        type: 'PERSON_DEATH', commandId: `c${i}`, personId: 'p',
        source: { requestId: `r${i}`, year: YEAR, phase: 3, sourceRuleId: 'B-009', sourceTraceId: tid() },
      }) as unknown as DomainCommand)
      const events = Array.from({ length: Math.floor(r() * 8) }, (_, i) => ({
        eventId: `e${i}`, sourceTraceIds: Array.from({ length: Math.floor(r() * 4) }, tid),
      }) as unknown as EventLogEntry)
      const outcome = { ruleId: 'B-009', phase: 3, commands, requests: [], deferred: [], traceDrafts: drafts } as RuleOutcome
      const rejectedBy = r() < 0.2 ? ['OUTCOME_REJECTED'] : undefined
      expect(buildTraces(outcome, events, YEAR, rejectedBy), `case ${n}`).toEqual(referenceBuildTraces(outcome, events, YEAR, rejectedBy))
    }
  })

  it('Draft が無ければ events / commands の形を参照しない（旧実装と同じく例外にならない）', () => {
    const outcome = { ruleId: 'B-009', phase: 3, commands: [{}], requests: [], deferred: [], traceDrafts: [] } as unknown as RuleOutcome
    expect(buildTraces(outcome, [{}] as unknown as EventLogEntry[], YEAR)).toEqual([])
  })
})
