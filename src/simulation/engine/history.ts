// RuleOutcome × applyOutcome の結果 → EventLog（確定差分のみ）と DecisionTrace（判断記録）。
// - Event: 適用に成功した単位（batch または単独 command）の実差分のみ。拒否・重複・TODO は作らない。
// - Trace: traceDrafts から決定的 ID で確定。状態不変の判断も残す。
import type {
  DecisionTrace,
  DecisionTraceDraft,
  DomainCommand,
  EventLogEntry,
  Id,
  RuleOutcome,
  StateChange,
  TargetRef,
  WorldState,
} from '../contracts/index.ts'
import { cloneData } from './reducer/canonical.ts'
import type { ApplyResult } from './reducer/index.ts'
import { eventIdOf, semanticEventKeyOf, traceIdOf } from './ids.ts'

const refKey = (r: TargetRef) => (r.kind === 'PERSON_PAIR' ? `PERSON_PAIR:${r.ids.join('|')}` : `${r.kind}:${r.id}`)

function refsOfCommand(c: DomainCommand, world: WorldState): TargetRef[] {
  const regionOfTitle = (titleId: Id): TargetRef[] => {
    const t = world.titles.find((x) => x.titleId === titleId)
    return t ? [{ kind: 'REGION', id: t.regionId }] : []
  }
  switch (c.type) {
    case 'MARRIAGE_REGISTER':
      return [{ kind: 'PERSON_PAIR', ids: [c.marriage.personIds[0], c.marriage.personIds[1]] }]
    case 'MARRIAGE_DISSOLVE':
      return [{ kind: 'PERSON', id: c.deceasedPersonId }]
    case 'LEGAL_DYNASTY_SET':
    case 'PERSON_DEATH':
      return [{ kind: 'PERSON', id: c.personId }]
    case 'LEGAL_TITLE_TRANSFER':
      return [
        ...regionOfTitle(c.titleId),
        ...(c.toHolder.status === 'HELD' ? [{ kind: 'PERSON', id: c.toHolder.personId } as const] : []),
      ]
    case 'TITLE_RECOGNITION_SET':
      return regionOfTitle(c.titleId)
    case 'LEGAL_CASE_SET':
      return regionOfTitle(c.legalCase.titleId)
    case 'CONTROL_MANDATE_SET':
    case 'TAX_MANDATE_SET':
      return [{ kind: 'REGION', id: c.mandate.regionId }]
    case 'PERSON_PAIR_TRUST_SET':
      return [{kind:'PERSON_PAIR',ids:c.relation.personIds}]
    case 'PERSON_PROMOTE':
    case 'PERSON_SUPPORTING_RECORD':
      return [{ kind: 'PERSON', id: c.person.personId }, { kind: 'GROUP', id: c.person.originGroupId }]
    case 'PERSON_BIRTH':
      return [
        { kind: 'PERSON', id: c.person.personId },
        { kind: 'GROUP', id: c.cohortGroupId },
      ]
    case 'POPULATION_COHORT':
    case 'SUPPORT_SET':
      return [{ kind: 'GROUP', id: c.groupId }]
    case 'POPULATION_CASUALTY':
      return [{ kind: 'GROUP', id: c.groupId }, ...c.namedPersonIds.map((id) => ({ kind: 'PERSON', id }) as const)]
    case 'RESOURCE_TRANSACTION': {
      const a = world.resources.find((x) => x.accountId === c.accountId)
      return a ? [{ kind: a.ownerRef.kind, id: a.ownerRef.id }] : []
    }
    case 'REGION_CONTROL_SET':
      return [{ kind: 'REGION', id: c.regionId }]
    case 'TREATY_COMMIT':
      return c.deltas.flatMap((d) => refsOfCommand(d, world))
  }
}

/** 適用に成功した単位ごとに 1 件の EventLogEntry。差分が空の単位は reducer が拒否済みで存在しない。 */
export function buildEvents(outcome: RuleOutcome, result: ApplyResult, worldAfter: WorldState): EventLogEntry[] {
  const byId = new Map<Id, DomainCommand>(outcome.commands.map((c) => [c.commandId, c]))
  const changesById = new Map<Id, readonly StateChange[]>(result.applied.map((a) => [a.commandId, a.stateChanges]))
  const events: EventLogEntry[] = []
  for (const unit of result.units) {
    if (unit.status !== 'APPLIED') continue
    const cmds = unit.commandIds.map((id) => byId.get(id)).filter((c): c is DomainCommand => c !== undefined)
    const first = cmds[0]
    if (!first) continue
    const refs = new Map<string, TargetRef>()
    for (const r of cmds.flatMap((c) => refsOfCommand(c, worldAfter))) refs.set(refKey(r), r)
    events.push({
      eventId: eventIdOf(first.source.year, first.source.phase, outcome.ruleId, first.commandId),
      semanticEventKey: semanticEventKeyOf(
        first.source.year,
        first.source.phase,
        outcome.ruleId,
        cmds.map((c) => c.source.requestId),
        cmds.map((c) => c.type),
      ),
      year: first.source.year,
      phase: first.source.phase,
      eventType: [...new Set(cmds.map((c) => c.type))].sort().join('+'),
      involvedRefs: [...refs.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([, r]) => r),
      stateChanges: cmds.flatMap((c) => changesById.get(c.commandId) ?? []),
      sourceTraceIds: [...new Set(cmds.map((c) => c.source.sourceTraceId))].sort(),
    })
  }
  return cloneData(events)
}

/**
 * traceDrafts → DecisionTrace。events の sourceTraceIds から eventIds を逆引きで決める（参照を補完・捏造しない）。
 * rejectedBy を与えた場合（Outcome 全体が確定しなかった）は ACCEPT を REJECT に下げ、理由コードを足す。
 */
export function buildTraces(
  outcome: RuleOutcome,
  events: readonly EventLogEntry[],
  year: number,
  rejectedBy?: readonly string[],
): DecisionTrace[] {
  return outcome.traceDrafts.map((d: DecisionTraceDraft, i) => {
    const traceId = traceIdOf(year, outcome.phase, outcome.ruleId, i)
    const eventIds = events.filter((e) => e.sourceTraceIds.includes(traceId)).map((e) => e.eventId)
    const linked = outcome.commands.filter((c) => c.source.sourceTraceId === traceId)
    const reasonCodes = [...d.reasonCodes]
    let status = d.status
    if (rejectedBy) {
      if (status === 'ACCEPT') status = 'REJECT'
      reasonCodes.push(...rejectedBy)
    } else if (linked.length > 0 && eventIds.length === 0) {
      reasonCodes.push('DUPLICATE_COMMAND')
    }
    const base = {
      traceId,
      year: d.year,
      phase: d.phase,
      ruleId: d.ruleId,
      actorRef: d.actorRef,
      candidates: d.candidates,
      status,
      reasonCodes,
      modifierIds: d.modifierIds,
      eventIds: rejectedBy ? [] : eventIds,
      ruleVersion: d.ruleVersion,
    }
    const withSelected = d.selectedCandidateId === undefined ? base : { ...base, selectedCandidateId: d.selectedCandidateId }
    return cloneData(d.random === undefined ? withSelected : { ...withSelected, random: d.random }) as DecisionTrace
  })
}
