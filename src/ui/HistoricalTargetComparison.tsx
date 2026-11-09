// DEC-073 第2段階：関与対象に関係する確定Eventと判断Traceを、A0/A1別に閲覧する。
// EventとTraceの同一性・因果・領主権の合法性を推定しない。元のIDにだけリンクする。
import { useMemo, useState } from 'react'
import type { DecisionTrace, EventLogEntry, TargetRef } from '../simulation/contracts/index.ts'
import type { BranchChoice, PlayView } from './branch-play-source.ts'
import { eventHeadline, inCategory, namesOf, EVENT_CATEGORIES } from './integrated-overview.ts'
import { eventTargetKeys } from './HistoricalChangesExplorer.tsx'

const PAGE_SIZE = 12
const STATUS_LABEL: Readonly<Record<DecisionTrace['status'], string>> = {
  ACCEPT: '採択',
  REJECT: '不採択',
  DEFER: '保留',
  NOT_IMPLEMENTED: '未実装',
}

function actorMatches(ref: TargetRef, targetKey: string): boolean {
  if (ref.kind === 'PERSON_PAIR') return ref.ids.some(id => targetKey === `PERSON:${id}`)
  return targetKey === `${ref.kind}:${ref.id}`
}

type BranchProps = Readonly<{
  choice: BranchChoice
  run: PlayView['a0']
  targetKey: string
  year: string
  categoryKey: string
  onInspectEvent: (choice: BranchChoice, id: string) => void
  onInspectTrace: (choice: BranchChoice, id: string) => void
}>

/** 描画件数の増加はユーザーのクリック時のみ。対象や年が変われば親のkeyで初期化する。 */
function BranchEvidence({ choice, run, targetKey, year, categoryKey, onInspectEvent, onInspectTrace }: BranchProps) {
  const [eventLimit, setEventLimit] = useState(PAGE_SIZE)
  const [traceLimit, setTraceLimit] = useState(PAGE_SIZE)
  const category = EVENT_CATEGORIES.find(c => c.key === categoryKey)
  const yearMatches = (y: number) => !year || String(y) === year
  const events = useMemo(() =>
    run.result.eventLog.filter(e => yearMatches(e.year) &&
      (!category || inCategory(e, category)) && eventTargetKeys(e).includes(targetKey)),
  [run, targetKey, year, categoryKey])
  const traces = useMemo(() =>
    run.result.decisionTraces.filter(t => yearMatches(t.year) && actorMatches(t.actorRef, targetKey)),
  [run, targetKey, year])
  const names = namesOf(run.result.snapshots.at(-1))
  const subtitle = choice === 'A0' ? '介入なしの歴史' : '介入ありの歴史'
  return <div data-testid={`target-compare-${choice.toLowerCase()}`}>
    <h5>{choice}：{subtitle}</h5>
    <p className="note" data-testid={`target-count-${choice.toLowerCase()}`}>
      確定Event {events.length}件／判断Trace {traces.length}件（表示用データ内）
    </p>
    <div>
      <strong>確定Event</strong>
      {events.length === 0
        ? <p className="note">この条件で、直接関与が記録された確定Eventはありません。</p>
        : <ol className="compare-event-list" data-testid={`target-event-list-${choice.toLowerCase()}`}>
          {events.slice(0, eventLimit).map(e => <li key={e.eventId}>
            <button type="button" onClick={() => onInspectEvent(choice, e.eventId)}>
              {eventHeadline(e, names, e.eventType)}
            </button>
          </li>)}
        </ol>}
      {events.length > eventLimit && <button type="button" data-testid={`target-event-more-${choice.toLowerCase()}`}
        onClick={() => setEventLimit(n => n + PAGE_SIZE)}>Eventをさらに表示（残り{events.length - eventLimit}件）</button>}
    </div>
    <div>
      <strong>判断Trace（Eventの成立とは別）</strong>
      {traces.length === 0
        ? <p className="note">この条件で、判断主体として直接記録されたTraceはありません。</p>
        : <ol className="compare-trace-list" data-testid={`target-trace-list-${choice.toLowerCase()}`}>
          {traces.slice(0, traceLimit).map(t => <li key={t.traceId}>
            <button type="button" onClick={() => onInspectTrace(choice, t.traceId)}>
              {t.year}年・{t.ruleId}・{STATUS_LABEL[t.status]}（{t.status}）・対応Event {t.eventIds.length}件
            </button>
          </li>)}
        </ol>}
      {traces.length > traceLimit && <button type="button" data-testid={`target-trace-more-${choice.toLowerCase()}`}
        onClick={() => setTraceLimit(n => n + PAGE_SIZE)}>Traceをさらに表示（残り{traces.length - traceLimit}件）</button>}
    </div>
  </div>
}

type Props = Readonly<{
  view: PlayView
  targetKey: string
  targetLabel: string
  year: string
  categoryKey: string
  onInspectEvent: (choice: BranchChoice, id: string) => void
  onInspectTrace: (choice: BranchChoice, id: string) => void
}>

/** ある対象について両枝の実ログを見渡す。IDの自動対応付けや因果判定は行わない。 */
export function HistoricalTargetComparison({ view, targetKey, targetLabel, year, categoryKey, onInspectEvent, onInspectTrace }: Props) {
  const selectionKey = JSON.stringify([targetKey, year, categoryKey])
  return <section aria-labelledby="target-comparison-heading" data-testid="target-comparison">
    <h5 id="target-comparison-heading">{targetLabel}のA0/A1記録を比べる</h5>
    <p className="note">
      Eventは分野・年と直接関与の記録で、Traceは年と判断主体（人物ペアの場合は構成員）で検索しています。
      分野フィルタをTraceのRuleIDへ推測で適用しません。判断の採択とEvent成立は同義ではありません。
      A0/A1の同名事件や同じ意味の判断が対応するかは、この一覧からは断定できません。
      同一の高頻度記録は表示用ビューで省略されている場合があります。
    </p>
    <div className="comparison-columns">
      <BranchEvidence key={selectionKey + ':A0'} choice="A0" run={view.a0}
        targetKey={targetKey} year={year} categoryKey={categoryKey} onInspectEvent={onInspectEvent} onInspectTrace={onInspectTrace}/>
      <BranchEvidence key={selectionKey + ':A1'} choice="A1" run={view.a1}
        targetKey={targetKey} year={year} categoryKey={categoryKey} onInspectEvent={onInspectEvent} onInspectTrace={onInspectTrace}/>
    </div>
  </section>
}
