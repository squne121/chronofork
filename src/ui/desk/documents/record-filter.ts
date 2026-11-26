import type { EventLogEntry, DecisionTrace } from '../../../simulation/contracts/index.ts'
import type { DocumentTarget } from './index.tsx'
import type { HistoryYearRef } from '../data/history.ts'
import type { Association } from '../../observation/associations.ts'

export type DocumentFilter = Readonly<{ target: DocumentTarget; ref: HistoryYearRef }>

/** 実記録と既存の根拠付き関連だけを採用する。家系は中心人物の記録を指す。 */
export function documentRecordFilter(target: DocumentTarget, events: readonly EventLogEntry[], traces: readonly DecisionTrace[], associations: readonly Association[]) {
  const eventIds = new Set<string>()
  const traceIds = new Set<string>()
  if (target.kind === 'event') {
    const event = events.find(e => e.eventId === target.id)
    if (event) {
      eventIds.add(event.eventId)
      for (const id of event.sourceTraceIds) traceIds.add(id)
    }
  } else if (target.kind === 'trace') {
    const trace = traces.find(t => t.traceId === target.id)
    if (trace) {
      traceIds.add(trace.traceId)
      for (const id of trace.eventIds) eventIds.add(id)
    }
  } else {
    const kind = target.kind === 'family' ? 'PERSON' : target.kind.toUpperCase()
    for (const a of associations) {
      if (target.kind === 'title' ? a.titleId !== target.id : a.target.kind !== kind || a.target.id !== target.id) continue
      if (a.source.type === 'EVENT') eventIds.add(a.source.eventId)
      if (a.source.type === 'TRACE') traceIds.add(a.source.traceId)
    }
    if (target.kind === 'title') {
      const path = `$.titles[${target.id}]`
      for (const event of events) {
        if (eventIds.has(event.eventId) || event.stateChanges.some(c => c.path === path || c.path.startsWith(path + '.'))) {
          eventIds.add(event.eventId)
          for (const id of event.sourceTraceIds) traceIds.add(id)
        }
      }
    }
  }
  return { eventIds, traceIds }
}
