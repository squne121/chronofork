import { useEffect, useMemo, useRef, useState } from 'react'
import { HistoryPanel, involves } from './HistoryPanel.tsx'
import { InterventionComparePanel } from './InterventionComparePanel.tsx'
import { runPlayComparison } from './branch-play-source.ts'
import type { BranchChoice, PlayInput, PlayView } from './branch-play-source.ts'
import { workerPlayRunner } from './play-runner.ts'
import type { PlayRunHandle, PlayRunner } from './play-runner.ts'
import type { CalcInfo } from './IntegratedOverview.tsx'
import { Inspector } from './Inspector.tsx'
import { RegionMap } from './RegionMap.tsx'
import { RunPanel } from './RunPanel.tsx'
import { indexWorld, worldWithHistoricPersons } from './inspection-source.ts'
import type { EntityKind, InspectionSource, Selection } from './inspection-source.ts'
import {
  DEFAULT_SEED,
  YEAR_RANGE,
  eventsOfYear,
  goalStatusLabel,
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
export default function App({ run: injected, playRunner = workerPlayRunner }:
  Readonly<{ run?: TimelineRun; playRunner?: PlayRunner }>) {
  const [run, setRun] = useState<TimelineRun>(() => injected ?? runExperimentalTimeline(DEFAULT_SEED))
  const [seedText, setSeedText] = useState(String(run.inputs.seed))
  const [comparison, setComparison] = useState<PlayView | undefined>(undefined)
  const [running, setRunning] = useState<{ startedAt: number } | undefined>(undefined)
  const [elapsedSec, setElapsedSec] = useState(0)
  const [notice, setNotice] = useState<string | undefined>(undefined)
  const [calc, setCalc] = useState<CalcInfo | undefined>(undefined)
  // 古い結果で上書きしないための世代番号と、キャンセル用の実行ハンドル。
  const tokenRef = useRef(0)
  const handleRef = useRef<PlayRunHandle | undefined>(undefined)
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
  // 年内Eventが指す新生児など、年初snapshotに無い人物を他年snapshotから補って参照解決する。
  const refIndex = useMemo(() => indexWorld(worldWithHistoricPersons(world, result.snapshots)), [world, result.snapshots])

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
  // 計算中の経過秒(実測できる値のみ)。進捗率・残り時間は出さない。
  const startedAt = running?.startedAt
  useEffect(() => {
    if (startedAt === undefined) return
    const id = setInterval(() => setElapsedSec(Math.floor((Date.now() - startedAt) / 1000)), 1000)
    return () => clearInterval(id)
  }, [startedAt])
  // 画面を離れるときは計算を中断してWorkerを解放する。
  useEffect(() => () => {
    tokenRef.current++
    handleRef.current?.cancel()
  }, [])
  const stopRunning = () => {
    tokenRef.current++
    handleRef.current?.cancel()
    handleRef.current = undefined
    setRunning(undefined)
    setElapsedSec(0)
  }
  const rerun = () => {
    stopRunning()
    setNotice(undefined)
    setCalc(undefined)
    const seed = Number(seedText.trim())
    setRun(runExperimentalTimeline(seed))
    setComparison(undefined)
    setPlayError(undefined)
    setEventId(undefined)
    setTraceId(undefined)
  }

  const applyView = (c:PlayView, input:PlayInput) => {
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
  const runComparison = (input:PlayInput) => {
    setNotice(undefined)
    if (input.mode === 'INTEGRATED_EXPERIMENTAL') {
      // 100年のA0/A1はWorkerで再計算する。計算中の二重起動は無視し、古い結果は破棄する。
      if (handleRef.current) return
      const token = ++tokenRef.current
      const started = Date.now()
      setPlayError(undefined)
      setElapsedSec(0)
      setRunning({ startedAt: started })
      let handle: PlayRunHandle
      try {
        handle = playRunner(input)
      } catch (error) {
        setRunning(undefined)
        setPlayError({ code: 'WORKER_START_FAILED', message: error instanceof Error ? error.message : String(error) })
        return
      }
      handleRef.current = handle
      void handle.promise.then((o) => {
        if (token !== tokenRef.current) return
        handleRef.current = undefined
        setRunning(undefined)
        if (o.kind === 'CANCELLED') { setNotice('計算を中断しました。表示中の結果は変わっていません。'); return }
        if (o.kind === 'FAILED') { setPlayError({ code: o.code, message: o.message }); return }
        if (!o.result.ok) { setPlayError({ code: o.result.code, message: o.result.message }); return }
        setCalc({ computeMs: o.computeMs, wallMs: Date.now() - started })
        applyView(o.result.view, input)
      })
      return
    }
    const outcome = runPlayComparison(input)
    if (!outcome.ok) {
      setPlayError({code:outcome.code,message:outcome.message})
      return
    }
    applyView(outcome.comparison, input)
  }
  const cancelRun = () => {
    stopRunning()
    setNotice('計算をキャンセルしました。表示中の結果は変わっていません。')
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
    // 幅が狭く1列になる場合でも詳細へ辿れるよう、理由欄へ移動する。
    setTimeout(() => document.getElementById('reasons')?.scrollIntoView?.({ block: 'start' }), 0)
  }

  // Eventが確定しなかった判断も、実際に記録されたDecisionTraceから直接検証できる。
  const openComparisonTrace = (choice:BranchChoice,id:string) => {
    if (!comparison) return
    const chosen=choice==='A0'?comparison.a0:comparison.a1
    const trace=chosen.result.decisionTraces.find(t=>t.traceId===id)
    if (!trace || !snapshotOf(chosen.result,trace.year)) return
    setActiveBranch(choice)
    setRun(chosen)
    setYear(trace.year)
    setScope('year')
    setTargetKey('')
    setEventId(undefined)
    setTraceId(trace.traceId)
    setSelection(undefined)
    // 縦長の比較欄から、年表の下にあるTrace詳細そのものへ移動する。
    // Reactの描画完了後にスクロールし、HistoryPanel側のフォーカスも維持する。
    setTimeout(() => document.querySelector('[data-testid="trace-detail"]')?.scrollIntoView?.({ block: 'start' }), 0)
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

  const branchLabel = comparison ? (activeBranch === 'A0' ? 'A0（介入なしの歴史）' : 'A1（介入ありの歴史）') : '原史（試験計算）'
  return (
    <div className="app">
      <header className="topbar">
        <h1>Project Chronofork</h1>
        <p className="badge badge-warn" role="status" data-testid="experimental-banner">
          EXPERIMENTAL / CALIBRATION_ONLY ・試験計算（仮データ・partial）
        </p>
        <dl className="status-list">
          <div>
            <dt>観測中の年</dt>
            <dd data-testid="current-year">{world.year}年（年初の状態）</dd>
          </div>
          <div>
            <dt>観測中の歴史</dt>
            <dd data-testid="history-status">{branchLabel}</dd>
          </div>
          <div>
            <dt>1350年の正式勝敗</dt>
            <dd data-testid="goal-status">{goalStatusLabel(result)}</dd>
          </div>
        </dl>
        <p className="lead" data-testid="trial-guide">
          この試験版でできること: 2人の人物の信頼に介入して再計算し、同じ年の「介入なし(A0)」と「介入あり(A1)」を比べ、婚姻や出生がなぜ変わったかをEventと判断根拠で確認できます。正式な歴史・勝敗はまだ評価できません。
        </p>
      </header>

      <main className="layout">
        <div className="flow-col">
          <InterventionComparePanel seedText={seedText} year={year} comparison={comparison} error={playError}
            running={running ? { elapsedSec } : undefined} notice={notice} calc={calc} onCancel={cancelRun}
            onSeedText={setSeedText}
            activeBranch={activeBranch} onRun={runComparison} onViewBranch={switchBranch}
            onInspectEvent={openComparisonEvent} onInspectTrace={openComparisonTrace} />
        </div>

        <div className="reason-col" id="reasons">
          <section aria-labelledby="year-heading" className="panel">
            <h2 id="year-heading"><span className="step-no">4</span>理由を確認する: 年を選ぶ</h2>
            <label htmlFor="year-slider">観測する年</label>
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
            refIndex={refIndex}
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

        <div className="world-row">
          <RegionMap
            source={source}
            index={index}
            selectedRegionId={selection?.kind === 'region' ? selection.id : undefined}
            onSelect={(id) => select({ kind: 'region', id })}
          />
          <Inspector source={source} index={index} tab={tab} selection={selection} onTab={changeTab} onSelect={select} />
        </div>

        <div className="dev-row">
          <details className="panel dev-details" data-testid="dev-info">
            <summary>開発・検証情報（RuleID・バージョン・seed・未実装ルール）</summary>
            <RunPanel inputs={run.inputs} result={result} seedText={seedText} onSeedText={setSeedText} onRerun={rerun} />
          </details>

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
