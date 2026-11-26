import type { ObservationInput, ObservationSlice, PlayInput, PlayView } from '../branch-play-source.ts'
import type { DeskComparisonSelection } from '../desk/comparison/DeskInterventionWindow.tsx'
import type { HistoryYear } from '../desk/data/history.ts'
import { historyFromPlayView, sameHistoryYearRef } from '../desk/data/history.ts'
import type { DocumentFilter } from '../desk/documents/record-filter.ts'
import type { EvidenceBuild, EvidenceSource } from '../playtest-evidence.ts'
import type { PublicSelection } from './types.ts'

export type AcceptedObservation = Readonly<{
  input: ObservationInput; outcome: { kind: 'DONE'; requestId: number; result: ObservationSlice }
}>
export type AcceptedComparison = Readonly<{
  input: PlayInput; outcome: { kind: 'DONE'; requestId: number; result: PlayView }; observationId: number
}>

const hasPerson = (history: HistoryYear, id: string) => {
  const kind = history.person(id).kind
  return kind === 'ALIVE' || kind === 'DEAD'
}

type Unavailable = { reason: string }
type Available = { source: EvidenceSource; isCurrent: () => boolean }
export type BrowserSource = Available | Unavailable

export function observationSource(build: EvidenceBuild, requestId: number, accepted: AcceptedObservation | undefined,
  history: HistoryYear | undefined, filter: DocumentFilter | undefined, isCurrent: () => boolean): BrowserSource {
  if (!accepted || !history || accepted.outcome.requestId !== requestId || accepted.input.year !== history.ref.year)
    return { reason: '現行の確定済み原史がありません。原史を観測してください。' }
  let selection: PublicSelection | undefined
  // 主観測と同じ参照のときだけ、観測欄にもこの絞り込みが適用される。
  if (filter && sameHistoryYearRef(history.ref, filter.ref)) {
    const { kind, id } = filter.target
    if (kind === 'person' && hasPerson(history, id)) selection = { personId: id }
    else if (kind === 'event' && history.event(id).kind === 'RECORDED') selection = { event: { branch: 'A0', id } }
    else return { reason: 'この絞り込みは保存未対応です。絞り込みを解除してください。' }
  }
  return { source: { kind: 'OBSERVATION', build, requestId, ...accepted, selected: history.ref, selection }, isCurrent }
}

export function comparisonSource(build: EvidenceBuild, observationId: number, accepted: AcceptedComparison | undefined,
  shown: DeskComparisonSelection | undefined, isCurrent: () => boolean): BrowserSource {
  if (!shown) return { reason: 'A0/A1 の比較資料を開いてください。' }
  if (shown.pair !== 'A0_A1' || shown.view.second || accepted?.input.second)
    return { reason: 'A2 を含む比較は保存未対応です。' }
  if (!accepted || accepted.observationId !== observationId || accepted.outcome.result !== shown.view)
    return { reason: '表示中の比較は現行の採用結果ではありません。' }
  const branch = shown.focus?.branch ?? 'A0'
  if (branch !== 'A0' && branch !== 'A1') return { reason: 'この比較枝は保存未対応です。' }
  if (shown.target && shown.target.kind !== 'person') return { reason: '人物以外に絞った比較は保存未対応です。' }
  if (shown.focus?.kind === 'trace') return { reason: 'Trace の絞り込みは保存未対応です。根拠の絞り込みを解除してください。' }
  const history = historyFromPlayView(shown.view)
  const before = history?.at('A0', shown.year)
  const after = history?.at('A1', shown.year)
  if (!before || !after || ![before, after].every(entry => entry.start.kind === 'CONFIRMED' &&
    (entry.records.kind === 'COMMITTED' || entry.records.kind === 'EVALUATION_ONLY')))
    return { reason: '比較年に両枝の確定済み記録がありません。' }
  const selected = branch === 'A0' ? before : after
  const personId = shown.target?.id
  const event = shown.focus && { branch, id: shown.focus.id }
  if (event && selected.event(event.id).kind !== 'RECORDED') return { reason: '選択した Event はこの枝・年に取得できません。' }
  // 調査元で確認済みの人物なら、両枝で出生前の年でも同じ対象を保つ。
  if (personId && ![before, after, shown.context.history].some(entry => hasPerson(entry, personId)))
    return { reason: '比較の対象人物を採用済みの記録と照合できません。' }
  const selection: PublicSelection = { personId, event }
  return { source: { kind: 'COMPARISON', build, requestId: accepted.outcome.requestId,
    input: accepted.input, outcome: accepted.outcome, selected: selected.ref, selection }, isCurrent }
}
