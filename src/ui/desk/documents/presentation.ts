import type { DecisionTrace, EventLogEntry, TargetRef } from '../../../simulation/contracts/index.ts'
import type { HistoryYear } from '../data/history.ts'
import type { DocumentTarget } from './index.tsx'
import { describeEvent } from '../../event-summary.ts'
import { EVENT_CATEGORIES, eventHeadline, inCategory, namesOfYear } from '../../integrated-overview.ts'
import { indexWorld } from '../../inspection-source.ts'
import type { Association } from '../../observation/associations.ts'
import { collectAssociations } from '../../observation/associations.ts'
import { documentRecordFilter } from './record-filter.ts'
import { reasonSentence } from '../../observation/reason-labels.ts'
import { titleLabel } from '../../observation/title-history.ts'

export const documentKinds: Record<DocumentTarget['kind'], string> = {
  person: '人物', group: '集団', region: '地域', title: '称号', country: '国家', family: '家系', event: 'Event', trace: 'Trace',
}

function createPresentation(history?: HistoryYear) {
  const world = history?.start.kind === 'CONFIRMED' ? history.start.world : undefined
  const records = history?.records.kind === 'COMMITTED' ? history.records : undefined
  const index = world && indexWorld(world)
  const names = { ...namesOfYear(world, records?.events ?? []),
    region: (id: string) => index?.region(id)?.name,
    title: (id: string) => { const title = index?.title(id); return title && world ? titleLabel(title, world) : undefined },
  }
  const eventName = (event: EventLogEntry) => eventHeadline(event, names,
    EVENT_CATEGORIES.find(c => inCategory(event, c))?.label ?? '出来事の記録')
  const traceStatus = (trace: DecisionTrace) => ({ ACCEPT: '採用', DEFER: '保留', REJECT: '不採用', NOT_IMPLEMENTED: '未実装' })[trace.status]
  function name(target: DocumentTarget): string {
    switch (target.kind) {
      case 'person': case 'family': return names.person(target.id) ?? '名前未確認の人物'
      case 'title': return names.title(target.id) ?? '名前未確認の称号'
      case 'region': return names.region(target.id) ?? '名前未確認の地域'
      case 'group': return names.group(target.id) ?? '名前未確認の集団'
      case 'country': return names.country?.(target.id) ?? '名前未確認の国家'
      case 'event': {
        const result = history?.event(target.id)
        return result?.kind === 'RECORDED' ? eventName(result.record) : '出来事の参照'
      }
      case 'trace': {
        const result = history?.trace(target.id)
        return result?.kind === 'RECORDED' ? `${traceStatus(result.record)}：${reasonSentence(result.record.reasonCodes)}` : '判断の参照'
      }
    }
  }
  let associations: readonly Association[] | undefined
  function related(target: DocumentTarget) {
    if (!records || !world) return undefined
    associations ??= collectAssociations({ year: world.year, events: records.events, traces: records.traces, snapshot: world }).confirmed
    const { eventIds, traceIds } = documentRecordFilter(target, records.events, records.traces, associations)
    return { events: records.events.filter(e => eventIds.has(e.eventId)), traces: records.traces.filter(t => traceIds.has(t.traceId)) }
  }
  return { index, names, name, eventName, traceStatus, related, describe: (event: EventLogEntry) => describeEvent(event, names) }
}

// DTO の参照単位で再利用する。窓の移動・前面化ごとに同じ年の根拠を再索引しない。
const presentations = new WeakMap<HistoryYear, ReturnType<typeof createPresentation>>()
const unloaded = createPresentation()
export function documentPresentation(history?: HistoryYear) {
  if (!history) return unloaded
  const existing = presentations.get(history)
  if (existing) return existing
  const view = createPresentation(history)
  presentations.set(history, view)
  return view
}

export function targetFromRef(ref: TargetRef): DocumentTarget | undefined {
  switch (ref.kind) {
    case 'PERSON': return { kind: 'person', id: ref.id }
    case 'GROUP': return { kind: 'group', id: ref.id }
    case 'REGION': return { kind: 'region', id: ref.id }
    case 'COUNTRY': return { kind: 'country', id: ref.id }
    default: return undefined
  }
}
