import type { TargetRef } from '../../../simulation/contracts/index.ts'
import type { PlayView } from '../../branch-play-source.ts'
import { historyFromPlayView } from '../data/history.ts'
import type { HistoryYear } from '../data/history.ts'

export type ComparisonTarget = Readonly<{ kind: 'person' | 'group' | 'region' | 'title' | 'country' | 'house'; id: string }>
export type InvestigationContext = Readonly<{
  history: HistoryYear
  target?: ComparisonTarget
  evidence?: Readonly<{ kind: 'event' | 'trace'; id: string }>
}>
export type EvidenceRequest = Readonly<{ history: HistoryYear; kind: 'event' | 'trace'; id: string }>
type Pair = 'A0_A1' | 'A1_A2'

/** 元の比較で得たHistoryYearを保持し、別の転送範囲の同枝に取り替えない。 */
export function comparisonAt(view: PlayView, pair: Pair, year: number) {
  return historyFromPlayView(view)?.compare(pair, year)
}

function matches(ref: TargetRef, target: ComparisonTarget): boolean {
  if (ref.kind === 'PERSON_PAIR') return target.kind === 'person' && ref.ids.includes(target.id)
  return ref.kind.toLowerCase() === target.kind && ref.id === target.id
}

function targetState(history: HistoryYear, target: ComparisonTarget): unknown {
  if (history.start.kind !== 'CONFIRMED') return undefined
  const w = history.start.world
  return target.kind === 'person' ? w.persons.find(x => x.personId === target.id)
    : target.kind === 'group' ? w.groups.find(x => x.groupId === target.id)
    : target.kind === 'region' ? w.regions.find(x => x.regionId === target.id)
    : target.kind === 'title' ? w.titles.find(x => x.titleId === target.id)
    : target.kind === 'house' ? w.houses.find(x => x.houseId === target.id)
    : w.countries.find(x => x.countryId === target.id)
}

function presence(history: HistoryYear, target: ComparisonTarget): string {
  if (target.kind === 'person') return history.person(target.id).kind
  if (history.start.kind !== 'CONFIRMED') return history.start.kind
  const w = history.start.world
  const exists = target.kind === 'group' ? w.groups.some(x => x.groupId === target.id)
    : target.kind === 'region' ? w.regions.some(x => x.regionId === target.id)
    : target.kind === 'title' ? w.titles.some(x => x.titleId === target.id)
    : target.kind === 'house' ? w.houses.some(x => x.houseId === target.id)
    : w.countries.some(x => x.countryId === target.id)
  return exists ? '年初に存在' : '年初に存在しない'
}

function Branch({ history, target, onEvidence }: Readonly<{
  history: HistoryYear; target?: ComparisonTarget; onEvidence: (request: EvidenceRequest) => void
}>) {
  const records = history.records
  const events = records.kind === 'COMMITTED' ? records.events.filter(e => !target || e.involvedRefs.some(r => matches(r, target))) : []
  const traces = records.kind === 'COMMITTED' ? records.traces.filter(t => !target || matches(t.actorRef, target)) : []
  return <section aria-label={`${history.ref.origin.branch}の記録`}>
    <h4>{history.ref.origin.branch}・{history.ref.year}年</h4>
    <p>年初: {history.start.kind}{target && `／対象 ${target.kind}: ${target.id} — ${presence(history, target)}`}</p>
    {target && targetState(history, target) !== undefined && <details><summary>対象の年初状態（実値）</summary><pre>{JSON.stringify(targetState(history, target), null, 2)}</pre></details>}
    <p>年内記録: {records.kind}</p>
    {records.kind === 'COMMITTED' && <>
      {records.coverage.kind === 'TRANSFER_OMISSION'
        ? <p>転送省略あり（{records.coverage.scope === 'YEAR' ? 'この年' : '全期間'}）: Event {JSON.stringify(records.coverage.counts.omittedEventsByType)}／Trace {JSON.stringify(records.coverage.counts.omittedTracesByRule)}。未表示の記録の不存在は断定できません。</p>
        : <p>この年の転送記録は完全です。</p>}
      {target?.kind === 'title' && <p>TitleはEvent関与先・Trace主体の直接参照に含まれないため、対象で絞った記録は表示できません。</p>}
      <h5>年内Event（直接関与）</h5>
      {events.length === 0 ? <p>表示データ内に該当記録なし。</p> : <ul>{events.map(e => <li key={e.eventId}>
        <button type="button" onClick={() => onEvidence({ history, kind: 'event', id: e.eventId })}>{e.eventType}・{e.eventId}</button>
      </li>)}</ul>}
      <h5>判断Trace（判断主体、Eventとは別）</h5>
      {traces.length === 0 ? <p>表示データ内に該当記録なし。</p> : <ul>{traces.map(t => <li key={t.traceId}>
        <button type="button" onClick={() => onEvidence({ history, kind: 'trace', id: t.traceId })}>{t.ruleId}・{t.status}・{t.traceId}</button>
      </li>)}</ul>}
    </>}
  </section>
}

function Differences({ comparison, target, onEvidence }: Readonly<{
  comparison: NonNullable<ReturnType<typeof comparisonAt>>; target?: ComparisonTarget
  onEvidence: (request: EvidenceRequest) => void
}>) {
  const { before, after, changes } = comparison
  if (before.records.kind === 'EVALUATION_ONLY' || after.records.kind === 'EVALUATION_ONLY')
    return <p>評価年は年内Event・Traceを比較しません。</p>
  if (!changes) return <p>両枝の年内記録が確定していないため差分は表示できません。</p>
  const eventMatches = (e: (typeof changes.events)[number]['event']) => !target || e.involvedRefs.some(r => matches(r, target))
  const traceMatches = (t: NonNullable<(typeof changes.traces)[number]['before']>) => !target || matches(t.actorRef, target)
  const events = changes.events.filter(d => eventMatches(d.event) || (d.counterpart && eventMatches(d.counterpart)))
  const traces = changes.traces.filter(d => [d.before, d.after, ...(d.ambiguousBefore ?? []), ...(d.ambiguousAfter ?? [])].some(t => t && traceMatches(t)))
  const omitted = [before, after].some(y => y.records.kind === 'COMMITTED' && y.records.coverage.kind === 'TRANSFER_OMISSION')
  return <section aria-label="記録差分">
    <h4>表示データ内の記録差 {target ? '（対象の直接関与・判断主体）' : '（全対象）'}</h4>
    {omitted && <p>転送省略があるため、表示データからの比較は暫定です。片側のみ・差分なしに加え、同一IDの内容差や判断の一対一対応・内容差も完全記録で確定できません。片枝のEvent省略だけでも、参照先を含む判断Traceに見かけ上の差が生じる場合があります。</p>}
    <p>Event {events.length}件／判断Trace {traces.length}件。対応は既存の比較結果であり、因果を示しません。</p>
    {events.length === 0 && traces.length === 0 && <p>表示データ内に該当する記録差はありません。</p>}
    <ul>{events.map((d, i) => {
      const b = d.kind === 'A0_ONLY' ? d.event : d.counterpart
      const a = d.kind === 'A0_ONLY' ? undefined : d.event
      return <li key={`event-${i}`}>Event {d.kind === 'CHANGED' ? '同じIDで内容差' : d.kind === 'A0_ONLY' ? `${before.ref.origin.branch}側のみ` : `${after.ref.origin.branch}側のみ`}
        {[{ h: before, e: b }, { h: after, e: a }].map(({ h, e }) => e && <details key={h.ref.origin.branch}><summary>{h.ref.origin.branch}: {e.eventType}・{e.eventId}</summary><pre>{JSON.stringify(e, null, 2)}</pre><button type="button" onClick={() => onEvidence({ history: h, kind: 'event', id: e.eventId })}>このEventの根拠を開く</button></details>)}
      </li>
    })}</ul>
    <ul>{traces.map((d, i) => <li key={`trace-${i}`}>判断 {d.kind === 'AMBIGUOUS' ? 'AMBIGUOUS（対応不明）' : d.kind === 'CHANGED' ? '対応する判断に内容差' : d.kind === 'A0_ONLY' ? `${before.ref.origin.branch}側のみ` : `${after.ref.origin.branch}側のみ`}・{d.ruleId}
      {[{ h: before, items: d.ambiguousBefore ?? (d.before ? [d.before] : []) }, { h: after, items: d.ambiguousAfter ?? (d.after ? [d.after] : []) }].flatMap(({ h, items }) => items.map(t => <details key={`${h.ref.origin.branch}:${t.traceId}`}><summary>{h.ref.origin.branch}: {t.status}・{t.traceId}</summary><pre>{JSON.stringify(t, null, 2)}</pre><button type="button" onClick={() => onEvidence({ history: h, kind: 'trace', id: t.traceId })}>この判断根拠を開く</button></details>))}
    </li>)}</ul>
  </section>
}

/** 窓の内容だけを提供する。Worker発行・窓管理・介入は呼び出し側の責務。 */
export function DeskComparison({ view, pair, year, target, context, onReturn, onEvidence }: Readonly<{
  view: PlayView; pair: Pair; year: number; target?: ComparisonTarget; context: InvestigationContext
  onReturn: (context: InvestigationContext) => void; onEvidence: (request: EvidenceRequest) => void
}>) {
  const comparison = comparisonAt(view, pair, year)
  return <section aria-label="歴史の比較">
    <h3>同じ年の歴史を比較</h3>
    <button type="button" onClick={() => onReturn(context)}>元の調査へ戻る</button>
    {pair === 'A1_A2' && view.second && <p>第1介入入力年 {view.input.year}年／第2介入入力年 {view.second.input.year}年</p>}
    {!comparison ? <p>この比較は取得できません。</p> : <>
      <p>{pair === 'A0_A1' && `介入年 ${view.input.year}年／`}観測年 {year}年。年初の状態と年内の記録は別です。記録差は因果を証明しません。</p>
      {target && comparison.before.start.kind === 'CONFIRMED' && comparison.after.start.kind === 'CONFIRMED' && <p>対象年初状態: {targetState(comparison.before, target) === undefined || targetState(comparison.after, target) === undefined ? '両枝での比較はできません' : JSON.stringify(targetState(comparison.before, target)) === JSON.stringify(targetState(comparison.after, target)) ? '実値に差なし' : '実値に差あり'}（詳細は各枝の年初状態）</p>}
      <Differences comparison={comparison} target={target} onEvidence={onEvidence}/>
      <Branch history={comparison.before} target={target} onEvidence={onEvidence}/>
      <Branch history={comparison.after} target={target} onEvidence={onEvidence}/>
    </>}
  </section>
}
