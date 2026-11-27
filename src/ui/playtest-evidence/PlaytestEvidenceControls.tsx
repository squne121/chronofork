import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import type { DeskComparisonSelection } from '../desk/comparison/DeskInterventionWindow.tsx'
import type { HistoryYear } from '../desk/data/history.ts'
import type { DocumentFilter } from '../desk/documents/record-filter.ts'
import { evidenceBuild } from '../playtest-evidence.ts'
import { deliverEvidence } from './browser-delivery.ts'
import type { Delivery } from './browser-delivery.ts'
import { comparisonSource, observationSource } from './browser-source.ts'
import type { AcceptedComparison, AcceptedObservation, BrowserSource } from './browser-source.ts'

/** Worker の採用判定とは独立に、表示の復元や同じ入力の再試行で旧証跡が復活しないようにする。 */
export function useEvidenceObservationGeneration() {
  const live = useRef(0)
  const [current, setCurrent] = useState(0)
  const advance = useCallback(() => {
    const id = ++live.current
    setCurrent(id)
    return id
  }, [])
  const isCurrent = useCallback((id: number) => live.current === id, [])
  return { current, advance, isCurrent }
}

const build = evidenceBuild(import.meta.env.VITE_BUILD_SHA || 'local')

type Props = Readonly<{
  observationId: number
  observation?: AcceptedObservation
  history?: HistoryYear
  filter?: DocumentFilter
  comparison?: AcceptedComparison
  shown?: DeskComparisonSelection
  busy: boolean
  observationError: boolean
  comparisonError: boolean
  isObservationCurrent: (id: number) => boolean
  isComparisonCurrent: (id: number) => boolean
}>

export function PlaytestEvidenceControls({ observationId, observation, history, filter, comparison, shown, busy,
  observationError, comparisonError, isObservationCurrent, isComparisonCurrent }: Props) {
  const a0 = useMemo(() => busy ? { reason: '計算中は保存できません。' }
    : observationError ? { reason: '観測が完了していません。原史を観測し直してください。' }
      : observationSource(build, observationId, observation, history, filter, () => isObservationCurrent(observationId)),
  [busy, observationError, observationId, observation, history, filter, isObservationCurrent])
  const pair = useMemo(() => busy ? { reason: '計算中は保存できません。' }
    : comparisonError ? { reason: '介入が完了していません。比較のために再計算してください。' }
      : comparisonSource(build, observationId, comparison, shown, () => !!comparison &&
        isObservationCurrent(observationId) && isComparisonCurrent(comparison.outcome.requestId)),
  [busy, comparisonError, observationId, comparison, shown, isObservationCurrent, isComparisonCurrent])
  return <section aria-label="試遊証跡" data-testid="playtest-evidence">
    <p>試遊証跡（JSON v1、最大 64 KiB）。ゲームのセーブではありません。資料窓そのもの、非人物対象、複数年、A2、DEBUG は保存未対応です。正式な勝敗は未成立です。</p>
    <p>主観測は確定済みの年を保存します。人物や Event の絞り込みは、下に対象が表示される場合だけ反映します。</p>
    <EvidenceActions title="A0 原史観測" target={a0} />
    <EvidenceActions title="A0/A1 比較（両枝を保存）" target={pair} />
  </section>
}

function EvidenceActions({ title, target }: { title: string; target: BrowserSource }) {
  const lifetime = useRef<object | undefined>(undefined)
  const [result, setResult] = useState<{ target: BrowserSource; pending?: boolean; text?: string; error?: boolean; json?: string }>()
  useLayoutEffect(() => {
    lifetime.current = {}
    return () => { lifetime.current = undefined }
  }, [target])
  const active = result?.target === target ? result : undefined
  const run = async (action: Delivery) => {
    if (!('source' in target) || active?.pending) return
    const started = lifetime.current
    const isCurrent = () => started !== undefined && lifetime.current === started && target.isCurrent()
    if (!isCurrent()) return
    setResult({ target, pending: true })
    try {
      const outcome = await deliverEvidence(target.source, action, isCurrent, active?.json)
      if (!isCurrent()) return
      if (outcome.kind === 'copy-failed') setResult({ target, error: true, json: outcome.json,
        text: 'クリップボードに書き込めませんでした。同じ JSON を保存するか、手動でコピーしてください。' })
      else if (outcome.kind === 'copied') setResult({ target, text: 'JSON をコピーしました。' })
      else if (outcome.kind === 'downloaded') setResult({ target, text: 'JSON のダウンロードを開始しました。' })
    } catch {
      if (isCurrent()) setResult({ target, error: true, json: active?.json, text: '証跡を生成または保存できませんでした。' })
    }
  }
  const source = 'source' in target ? target.source : undefined
  return <fieldset>
    <legend>{title}</legend>
    {source ? <p>{source.selected.year}年・{source.kind === 'OBSERVATION' ? '主観測' : '比較資料の選択年'}
      {source.selection?.personId && ` / 人物 ${source.selection.personId}`}
      {source.selection?.event && ` / ${source.selection.event.branch} Event ${source.selection.event.id}`}</p>
      : <p>{'reason' in target && target.reason}</p>}
    <button type="button" disabled={!source || active?.pending} onClick={() => void run('copy')}>JSON をコピー</button>{' '}
    <button type="button" disabled={!source || active?.pending} onClick={() => void run('download')}>JSON を保存</button>
    {active?.pending && <p role="status">証跡を準備中…</p>}
    {active?.text && <p role={active.error ? 'alert' : 'status'}>{active.text}</p>}
    {active?.json !== undefined && <label>手動コピー用 JSON <textarea readOnly value={active.json} onFocus={e => e.currentTarget.select()} /></label>}
  </fieldset>
}
