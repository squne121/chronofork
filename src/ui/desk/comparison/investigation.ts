import type { PlayView } from '../../branch-play-source.ts'
import type { DocumentOpenRequest, DocumentTarget } from '../documents/index.tsx'
import { sameHistoryYearRef } from '../data/history.ts'
import type { HistoryYear, HistoryYearRef } from '../data/history.ts'
import { comparisonAt } from './DeskComparison.tsx'
import type { ComparisonTarget, InvestigationContext } from './DeskComparison.tsx'
import type { DeskPair } from './DeskInterventionWindow.tsx'

export type ComparisonSource = Readonly<{ view: PlayView; pair: DeskPair }>

export function comparisonHistoryAt(source: ComparisonSource, ref: HistoryYearRef): HistoryYear | undefined {
  const compared = comparisonAt(source.view, source.pair, ref.year)
  return [compared?.before, compared?.after].find(history => history && sameHistoryYearRef(history.ref, ref))
}

export function comparisonTarget(target: DocumentTarget): ComparisonTarget | undefined {
  if (target.kind === 'trace' || target.kind === 'event' || target.kind === 'records' || target.kind === 'ending') return undefined
  if (target.kind === 'family') return { kind: 'person', id: target.id }
  return target
}

/** C の通知から得られた関連根拠のみを保存する。ID が同じ別の出典は結合しない。 */
export function investigationFromLink(history: HistoryYear, { ref, target, source }: Pick<DocumentOpenRequest, 'ref' | 'target' | 'source'>): InvestigationContext | undefined {
  if (!sameHistoryYearRef(history.ref, ref)) return undefined
  const selected = comparisonTarget(target) ?? (source && comparisonTarget(source))
  const evidence = target.kind === 'event' || target.kind === 'trace' ? target
    : source?.kind === 'event' || source?.kind === 'trace' ? source : undefined
  if (!selected) return undefined
  if (!evidence) return { history, target: selected }
  const found = evidence.kind === 'event' ? history.event(evidence.id) : history.trace(evidence.id)
  return found.kind === 'RECORDED' ? { history, target: selected, evidence } : undefined
}

/** C の既存介入通知には資料窓IDがない。同一年で候補が複数なら、別の根拠を推測せず資料だけを復帰する。 */
export function investigationForIntervention(history: HistoryYear, contexts: readonly InvestigationContext[], personId: string, partnerId?: string): InvestigationContext {
  const sameHistory = contexts.filter(context => context.history === history && context.evidence)
  const relevant = partnerId === undefined ? sameHistory : sameHistory.filter(({ evidence }) => {
    if (evidence?.kind === 'trace') {
      const trace = history.trace(evidence.id)
      return trace.kind === 'RECORDED' && trace.record.actorRef.kind === 'PERSON_PAIR'
        && trace.record.actorRef.ids.includes(personId) && trace.record.actorRef.ids.includes(partnerId)
    }
    if (evidence?.kind === 'event') {
      const event = history.event(evidence.id)
      return event.kind === 'RECORDED' && event.record.involvedRefs.some(ref => ref.kind === 'PERSON_PAIR'
        && ref.ids.includes(personId) && ref.ids.includes(partnerId))
    }
    return false
  })
  return relevant.length === 1 ? relevant[0]! : { history, target: { kind: 'person', id: personId } }
}
