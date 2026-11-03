import type { DecisionTrace, EventLogEntry, Id, TargetRef } from '../simulation/contracts/index.ts'
import type { TimelineResult } from '../simulation/engine/index.ts'
import type { EntityKind, Selection, WorldIndex } from './inspection-source.ts'
import { formatDelta, formatJson, numericChanges } from './timeline-source.ts'
import type { TraceIndex } from './timeline-source.ts'

const REF_KIND: Partial<Record<string, EntityKind>> = { GROUP: 'group', REGION: 'region', PERSON: 'person' }

function refKey(r: TargetRef): string {
  return r.kind === 'PERSON_PAIR' ? `PERSON_PAIR:${r.ids.join('+')}` : `${r.kind}:${r.id}`
}

function RefView({ r, index, onSelect }: { r: TargetRef; index: WorldIndex; onSelect: (s: Selection) => void }) {
  if (r.kind === 'PERSON_PAIR') return <span>{r.ids.join('・')}</span>
  const kind = REF_KIND[r.kind]
  if (!kind) return <span>{r.kind}:{r.id}</span>
  const link = index.link(kind, r.id)
  if (!link.resolved) return <span className="missing">{link.label}</span>
  return (
    <button type="button" className="link" onClick={() => onSelect({ kind, id: r.id })}>
      {link.label}
    </button>
  )
}

export type TargetOption = Readonly<{ key: string; ref: TargetRef; label: string }>

export function targetOptions(events: readonly EventLogEntry[], index: WorldIndex): readonly TargetOption[] {
  const seen = new Map<string, TargetOption>()
  for (const e of events) {
    for (const r of e.involvedRefs) {
      const key = refKey(r)
      if (seen.has(key)) continue
      const kind = r.kind === 'PERSON_PAIR' ? undefined : REF_KIND[r.kind]
      const label = r.kind === 'PERSON_PAIR' ? r.ids.map((id) => index.link('person', id).label).join('・') : kind ? index.link(kind, r.id).label : key
      seen.set(key, { key, ref: r, label })
    }
  }
  return [...seen.values()].sort((a, b) => a.key.localeCompare(b.key))
}

export const involves = (e: EventLogEntry, key: string) => e.involvedRefs.some((r) => refKey(r) === key)

type Props = Readonly<{
  result: TimelineResult
  history: TraceIndex
  index: WorldIndex
  year: number
  scope: 'year' | 'all'
  targetKey: string
  events: readonly EventLogEntry[]
  allEvents: readonly EventLogEntry[]
  eventId: Id | undefined
  traceId: Id | undefined
  onScope: (s: 'year' | 'all') => void
  onTarget: (key: string) => void
  onEvent: (id: Id) => void
  onTrace: (id: Id) => void
  onSelect: (s: Selection) => void
}>

export function HistoryPanel(p: Props) {
  const { history, index } = p
  const event = p.eventId ? history.event(p.eventId) : undefined
  const trace = p.traceId ? history.trace(p.traceId) : undefined
  const options = targetOptions(p.allEvents, index)
  return (
    <section aria-labelledby="chronicle-heading" className="panel">
      <h2 id="chronicle-heading">年表（Event）と判断根拠（DecisionTrace）</h2>
      <p className="note">
        EventLog に記録された確定済みの状態差分のみを表示します。
        {p.year >= 1350
          ? '1350年は評価専用の年で、年内の事件は生成されません（1350年初が最終の状態です）。'
          : `${p.year}年の事件は${p.year}年の年内に確定し、${p.year + 1}年初の状態に反映されます。`}
      </p>
      <div className="filters">
        <label>
          表示範囲{' '}
          <select value={p.scope} onChange={(e) => p.onScope(e.target.value === 'all' ? 'all' : 'year')} data-testid="event-scope">
            <option value="year">選択年のみ</option>
            <option value="all">全年</option>
          </select>
        </label>
        <label>
          対象{' '}
          <select value={p.targetKey} onChange={(e) => p.onTarget(e.target.value)} data-testid="event-target">
            <option value="">すべて</option>
            {options.map((o) => (
              <option key={o.key} value={o.key}>
                {o.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      {p.events.length === 0 ? (
        <p data-testid="chronicle-status">
          この条件に該当する実計算済みの事件はありません（{p.result.eventLog.length === 0 ? '計算結果全体でも EventLog は空です' : `全体では${p.result.eventLog.length}件`}）。
        </p>
      ) : (
        <ol data-testid="chronicle-list" className="event-list">
          {p.events.map((e) => (
            <li key={e.eventId}>
              <button
                type="button"
                aria-pressed={e.eventId === p.eventId}
                data-testid={`event-${e.eventId}`}
                onClick={() => p.onEvent(e.eventId)}
              >
                {e.year}年 {e.eventType}
                {' / '}
                {e.involvedRefs.map((r) => (r.kind === 'PERSON_PAIR' ? refKey(r) : (REF_KIND[r.kind] ? index.link(REF_KIND[r.kind]!, r.id).label : refKey(r)))).join('、')}
                {numericChanges(e)
                  .filter((c) => c.path.endsWith('population'))
                  .map((c) => ` / 人口 ${c.before.toLocaleString('ja-JP')}→${c.after.toLocaleString('ja-JP')}（${formatDelta(c.delta)}）`)
                  .join('')}
              </button>
            </li>
          ))}
        </ol>
      )}

      <div data-testid="event-detail" aria-live="polite" className="detail">
        {p.eventId && !event ? (
          <p className="missing">参照不明（Event {p.eventId}）</p>
        ) : event ? (
          <EventDetail event={event} history={history} index={index} traceId={p.traceId} onTrace={p.onTrace} onSelect={p.onSelect} />
        ) : (
          <p className="note">事件を選ぶと、確定した状態差分と判断根拠への参照を表示します。</p>
        )}
      </div>

      <div data-testid="trace-detail" aria-live="polite" className="detail">
        {p.traceId && !trace ? (
          <p className="missing">参照不明（Trace {p.traceId}）</p>
        ) : trace ? (
          <TraceDetail trace={trace} history={history} index={index} eventId={p.eventId} onEvent={p.onEvent} onSelect={p.onSelect} />
        ) : (
          <p className="note">Event の「判断根拠を開く」から DecisionTrace を表示します。</p>
        )}
      </div>
    </section>
  )
}

function EventDetail({
  event, history, index, traceId, onTrace, onSelect,
}: Readonly<{
  event: EventLogEntry
  history: TraceIndex
  index: WorldIndex
  traceId: Id | undefined
  onTrace: (id: Id) => void
  onSelect: (s: Selection) => void
}>) {
  const ok = history.backlinkConsistent(event)
  return (
    <>
      <h3>Event: {event.eventType}</h3>
      <dl>
        <dt>年・フェーズ</dt>
        <dd>
          {event.year}年 フェーズ{event.phase}
        </dd>
        <dt>対象</dt>
        <dd>
          <ul className="inline-list">
            {event.involvedRefs.map((r) => (
              <li key={refKey(r)}>
                <RefView r={r} index={index} onSelect={onSelect} />
              </li>
            ))}
          </ul>
        </dd>
        <dt>状態差分</dt>
        <dd>
          <table data-testid="state-changes">
            <thead>
              <tr>
                <th scope="col">項目</th>
                <th scope="col">変更前</th>
                <th scope="col">変更後</th>
                <th scope="col">差</th>
              </tr>
            </thead>
            <tbody>
              {event.stateChanges.map((c) => {
                const n = typeof c.before === 'number' && typeof c.after === 'number' ? c.after - c.before : undefined
                return (
                  <tr key={c.path}>
                    <th scope="row">{c.path}</th>
                    <td>{formatJson(c.before)}</td>
                    <td>{formatJson(c.after)}</td>
                    <td>{n === undefined ? '' : formatDelta(n)}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </dd>
        <dt>判断根拠（sourceTraceIds）</dt>
        <dd>
          {event.sourceTraceIds.length === 0 ? (
            '記録なし'
          ) : (
            <ul className="inline-list">
              {event.sourceTraceIds.map((id) => (
                <li key={id}>
                  {history.trace(id) ? (
                    <button type="button" className="link" aria-pressed={id === traceId} onClick={() => onTrace(id)}>
                      判断根拠を開く（{id}）
                    </button>
                  ) : (
                    <span className="missing">参照不明（Trace {id}）</span>
                  )}
                </li>
              ))}
            </ul>
          )}
        </dd>
      </dl>
      <details className="dev-details">
        <summary>開発・検証情報（Event）</summary>
        <dl>
          <dt>eventId</dt>
          <dd data-testid="event-id">{event.eventId}</dd>
          <dt>逆参照の一致</dt>
          <dd data-testid="event-backlink">{ok ? '一致（Trace.eventIds がこの Event を含む）' : '不一致または未確認'}</dd>
        </dl>
      </details>
    </>
  )
}

function TraceDetail({
  trace, history, index, eventId, onEvent, onSelect,
}: Readonly<{
  trace: DecisionTrace
  history: TraceIndex
  index: WorldIndex
  eventId: Id | undefined
  onEvent: (id: Id) => void
  onSelect: (s: Selection) => void
}>) {
  const ok = history.forwardConsistent(trace)
  return (
    <>
      <h3>DecisionTrace: {trace.ruleId}</h3>
      <dl>
        <dt>年・フェーズ</dt>
        <dd>
          {trace.year}年 フェーズ{trace.phase}
        </dd>
        <dt>判断主体</dt>
        <dd>
          <RefView r={trace.actorRef} index={index} onSelect={onSelect} />
        </dd>
        <dt>判定</dt>
        <dd>{trace.status}</dd>
        <dt>理由コード</dt>
        <dd>{trace.reasonCodes.join('、') || 'なし'}</dd>
        <dt>候補と入力</dt>
        <dd>
          <ul>
            {trace.candidates.map((c) => (
              <li key={c.candidateId}>
                {c.candidateId}
                {c.candidateId === trace.selectedCandidateId ? '（採用）' : ''}
                {' '}
                {c.eligible ? '適格' : '不適格'}: {Object.entries(c.inputs).map(([k, v]) => `${k}=${formatJson(v as never)}`).join('、')}
              </li>
            ))}
          </ul>
        </dd>
        <dt>対応する Event（eventIds）</dt>
        <dd>
          <ul className="inline-list">
            {trace.eventIds.map((id) => (
              <li key={id}>
                {history.event(id) ? (
                  <button type="button" className="link" aria-pressed={id === eventId} onClick={() => onEvent(id)}>
                    Event を開く（{id}）
                  </button>
                ) : (
                  <span className="missing">参照不明（Event {id}）</span>
                )}
              </li>
            ))}
          </ul>
        </dd>
      </dl>
      <details className="dev-details">
        <summary>開発・検証情報（Trace）</summary>
        <dl>
          <dt>traceId</dt>
          <dd data-testid="trace-id">{trace.traceId}</dd>
          <dt>ruleVersion</dt>
          <dd>{trace.ruleVersion}</dd>
          <dt>順参照の一致</dt>
          <dd data-testid="trace-forwardlink">{ok ? '一致（Event.sourceTraceIds がこの Trace を含む）' : '不一致または未確認'}</dd>
        </dl>
      </details>
    </>
  )
}
