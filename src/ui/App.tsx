import { useMemo, useState } from 'react'
import { Inspector } from './Inspector.tsx'
import { RegionMap } from './RegionMap.tsx'
import { goalLabel, indexWorld, loadExperimentalSource } from './inspection-source.ts'
import type { EntityKind, InspectionSource, Selection } from './inspection-source.ts'

function Unconnected({ children }: { children: string }) {
  return <span className="badge badge-off">未接続: {children}</span>
}

export default function App({ source: injected }: Readonly<{ source?: InspectionSource }>) {
  const source = useMemo(() => injected ?? loadExperimentalSource(), [injected])
  const index = useMemo(() => indexWorld(source.world), [source])
  const [tab, setTab] = useState<EntityKind>('region')
  const [selection, setSelection] = useState<Selection | undefined>(undefined)

  const select = (s: Selection) => {
    setTab(s.kind)
    setSelection(s)
  }
  const events = source.events
  const traces = source.traces

  return (
    <div className="app">
      <header className="topbar">
        <h1>Project Chronofork</h1>
        {source.experimental && (
          <p className="badge badge-warn" role="status" data-testid="experimental-banner">
            experimental / 仮データ / 歴史計算未接続
          </p>
        )}
        <dl className="status-list">
          <div>
            <dt>表示年</dt>
            <dd data-testid="current-year">{source.world.year}年（年初の初期状態）</dd>
          </div>
          <div>
            <dt>1350年判定</dt>
            <dd data-testid="goal-status">{goalLabel(source.goal)}</dd>
          </div>
          <div>
            <dt>現在の歴史</dt>
            <dd>
              <Unconnected>歴史履歴</Unconnected>
            </dd>
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

        <section aria-labelledby="chronicle-heading" className="panel">
          <h2 id="chronicle-heading">年・年代記</h2>
          <label htmlFor="year-slider">年</label>
          <input
            id="year-slider"
            type="range"
            min={1250}
            max={1350}
            value={source.world.year}
            disabled
            aria-describedby="year-note"
          />
          <p id="year-note" className="note">
            {source.world.year}年の初期状態のみ閲覧できます。他の年は未計算のため選べません。
          </p>
          <h3>年代記</h3>
          {events && events.length > 0 ? (
            <ol data-testid="chronicle-list">
              {events.map((e) => (
                <li key={e.eventId}>
                  {e.year}年 {e.eventType}
                </li>
              ))}
            </ol>
          ) : (
            <p data-testid="chronicle-status">
              <Unconnected>年代記（EventLog）</Unconnected> 事件は表示されません。
            </p>
          )}
        </section>

        <div className="right-col">
          <Inspector source={source} index={index} tab={tab} selection={selection} onTab={setTab} onSelect={select} />

          <section aria-labelledby="reserved-heading" className="panel">
            <h2 id="reserved-heading">介入・比較・判断根拠</h2>
            <ul className="reserved" data-testid="reserved-areas">
              <li>
                介入: <Unconnected>介入機能</Unconnected>
              </li>
              <li>
                2つの歴史の比較: <Unconnected>比較機能</Unconnected>
              </li>
              <li>
                判断根拠:{' '}
                {traces && traces.length > 0 ? `${traces.length}件の記録` : <Unconnected>DecisionTrace</Unconnected>}
              </li>
            </ul>
          </section>
        </div>
      </main>
    </div>
  )
}
