import { useMemo, useState } from 'react'
import { HistoryPanel, involves } from './HistoryPanel.tsx'
import { InterventionComparePanel } from './InterventionComparePanel.tsx'
import { runPlayComparison } from './branch-play-source.ts'
import type { BranchChoice, PlayComparison, PlayInput } from './branch-play-source.ts'
import { Inspector } from './Inspector.tsx'
import { RegionMap } from './RegionMap.tsx'
import { RunPanel } from './RunPanel.tsx'
import { indexWorld } from './inspection-source.ts'
import type { EntityKind, InspectionSource, Selection } from './inspection-source.ts'
import {
  DEFAULT_SEED,
  YEAR_RANGE,
  eventsOfYear,
  indexHistory,
  lastComputedYear,
  runExperimentalTimeline,
  snapshotOf,
} from './timeline-source.ts'
import type { TimelineRun } from './timeline-source.ts'

function Unconnected({ children }: { children: string }) {
  return <span className="badge badge-off">未接続: {children}</span>
}

/** run は試験用の注入口。未指定なら初期化時に一度だけ試験計算を行う。 */
export default function App({ run: injected }: Readonly<{ run?: TimelineRun }>) {
  const [run, setRun] = useState<TimelineRun>(() => injected ?? runExperimentalTimeline(DEFAULT_SEED))
  const [seedText, setSeedText] = useState(String(run.inputs.seed))
  const [comparison, setComparison] = useState<PlayComparison | undefined>(undefined)
  const [playError, setPlayError] = useState<{code:string;message:string} | undefined>(undefined)
  const [activeBranch, setActiveBranch] = useState<BranchChoice>('A1')
  const { result } = run
  const history = useMemo(() => indexHistory(result), [result])

  const last = lastComputedYear(result)
  const [requestedYear, setYear] = useState<number>(YEAR_RANGE.min)
  // 未計算の年は選べない: 範囲外の要求は計算済みの最終年へ丸める。
  const year = last === undefined ? run.initialWorld.year : Math.min(Math.max(requestedYear, YEAR_RANGE.min), last)
  const world = snapshotOf(result, year) ?? run.initialWorld
  const index = useMemo(() => indexWorld(world), [world])

  const [tab, setTab] = useState<EntityKind>('region')
  const [selection, setSelection] = useState<Selection | undefined>(undefined)
  const [scope, setScope] = useState<'year' | 'all'>('year')
  const [targetKey, setTargetKey] = useState('')
  const [eventId, setEventId] = useState<string | undefined>(undefined)
  const [traceId, setTraceId] = useState<string | undefined>(undefined)

  const select = (s: Selection) => {
    setTab(s.kind)
    setSelection(s)
  }
  // タブ操作（クリック/キーボード）: カテゴリが変わるときは古い選択を解除する
  const changeTab = (kind: EntityKind) => {
    if (kind === tab) return
    setTab(kind)
    setSelection(undefined)
  }
  const changeYear = (y: number) => {
    setYear(y)
    setEventId(undefined)
    setTraceId(undefined)
  }
  const openEvent = (id: string) => {
    const e = history.event(id)
    if (e && snapshotOf(result, e.year)) setYear(e.year)
    setEventId(id)
    // 現在の Trace が新しい Event を参照していなければ解除する（無関係な判断根拠を残さない）。
    setTraceId((cur) => (cur !== undefined && history.trace(cur)?.eventIds.includes(id) ? cur : undefined))
  }
  const changeTarget = (key: string) => {
    setTargetKey(key)
    // 新しい対象に関与しない Event/Trace の詳細は解除する。
    const e = eventId ? history.event(eventId) : undefined
    if (key && !(e && involves(e, key))) {
      setEventId(undefined)
      setTraceId(undefined)
    }
  }
  const rerun = () => {
    const seed = Number(seedText.trim())
    setRun(runExperimentalTimeline(seed))
    setComparison(undefined)
    setPlayError(undefined)
    setEventId(undefined)
    setTraceId(undefined)
  }

  const runComparison = (input:PlayInput) => {
    const outcome = runPlayComparison(input)
    if (!outcome.ok) {
      setPlayError({code:outcome.code,message:outcome.message})
      return
    }
    const c=outcome.comparison
    setPlayError(undefined)
    setComparison(c)
    setActiveBranch('A1')
    setRun(c.a1)
    setYear(input.year)
    setScope('year')
    setTargetKey('')
    setEventId(undefined)
    setTraceId(undefined)
    setSelection(undefined)
  }
  const switchBranch = (choice:BranchChoice) => {
    if (!comparison) return
    setActiveBranch(choice)
    setRun(choice==='A0'?comparison.a0:comparison.a1)
    setTargetKey('')
    setEventId(undefined)
    setTraceId(undefined)
    setSelection(undefined)
  }
  const openComparisonEvent = (choice:BranchChoice,id:string) => {
    if (!comparison) return
    const other=choice==='A0'?comparison.a0:comparison.a1
    const e=other.result.eventLog.find(x=>x.eventId===id)
    if (!e) return
    setActiveBranch(choice)
    setRun(other)
    setYear(e.year)
    setScope('year')
    setTargetKey('')
    setEventId(id)
    setTraceId(undefined)
    setSelection(undefined)
  }

  const source: InspectionSource = {
    label: run.inputs.scenarioId,
    world,
    experimental: true,
    events: result.eventLog,
    traces: result.decisionTraces,
  }
  const allEvents = scope === 'all' ? result.eventLog : eventsOfYear(result, year)
  const shown = targetKey ? allEvents.filter((e) => involves(e, targetKey)) : allEvents

  return (
    <div className="app">
      <header className="topbar">
        <h1>Project Chronofork</h1>
        <p className="badge badge-warn" role="status" data-testid="experimental-banner">
          {comparison ? 'experimental / 仮データ / 人口・人物・法制の試験計算（partial）' : 'experimental / 仮データ / 人口コホートのみの試験計算（partial）'}
        </p>
        <dl className="status-list">
          <div>
            <dt>表示年</dt>
            <dd data-testid="current-year">{world.year}年（年初の状態）</dd>
          </div>
          <div>
            <dt>現在の歴史</dt>
            <dd data-testid="history-status">正式な歴史は未成立（{result.autonomousHistory.status}）</dd>
          </div>
        </dl>
      </header>

      <main className="layout">
        <RegionMap
          source={source}
          index={index}
          selectedRegionId={selection?.kind === 'region' ? selection.id : undefined}
          onSelect={(id) => select({ kind: 'region', id })}
        />

        <div className="mid-col">
          <InterventionComparePanel seedText={seedText} year={year} comparison={comparison} error={playError}
            activeBranch={activeBranch} onRun={runComparison} onViewBranch={switchBranch}
            onInspectEvent={openComparisonEvent} />
          <RunPanel inputs={run.inputs} result={result} seedText={seedText} onSeedText={setSeedText} onRerun={rerun} />
          <section aria-labelledby="year-heading" className="panel">
            <h2 id="year-heading">年</h2>
            <label htmlFor="year-slider">年</label>
            <input
              id="year-slider"
              type="range"
              min={YEAR_RANGE.min}
              max={last ?? YEAR_RANGE.min}
              step={1}
              value={year}
              disabled={last === undefined || last === YEAR_RANGE.min}
              aria-describedby="year-note"
              aria-valuetext={`${year}年`}
              onChange={(e) => changeYear(Number(e.target.value))}
            />
            <output data-testid="slider-year">{year}</output>
            <p id="year-note" className="note" data-testid="year-note">
              計算済み: {YEAR_RANGE.min}〜{last ?? '—'}年（年初の状態）。
              {last !== undefined && last < YEAR_RANGE.max
                ? `${last + 1}〜${YEAR_RANGE.max}年は未計算のため選べません。`
                : `${YEAR_RANGE.max}年は評価専用の年で、年内の事件はありません。`}
            </p>
          </section>
          <HistoryPanel
            result={result}
            history={history}
            index={index}
            year={year}
            scope={scope}
            targetKey={targetKey}
            events={shown}
            allEvents={result.eventLog}
            eventId={eventId}
            traceId={traceId}
            onScope={(s) => {
              setScope(s)
              setEventId(undefined)
              setTraceId(undefined)
            }}
            onTarget={changeTarget}
            onEvent={openEvent}
            onTrace={setTraceId}
            onSelect={select}
          />
        </div>

        <div className="right-col">
          <Inspector source={source} index={index} tab={tab} selection={selection} onTab={changeTab} onSelect={select} />

          <section aria-labelledby="reserved-heading" className="panel">
            <h2 id="reserved-heading">未実装の機能</h2>
            <ul className="reserved" data-testid="reserved-areas">
              <li>介入・2枝比較: <span className="badge badge-off">試験版で接続済み（CALIBRATION_ONLY）</span></li>
              <li>保存・3枝以上の比較: <Unconnected>未実装</Unconnected></li>
              <li>人物・法制の正式自律判断: <Unconnected>未承認</Unconnected></li>
            </ul>
          </section>
        </div>
      </main>
    </div>
  )
}
