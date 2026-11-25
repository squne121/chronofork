import { useMemo } from 'react'
import type { DecisionTrace, EventLogEntry, TargetRef } from '../../../simulation/contracts/index.ts'
import type { PlayView } from '../../branch-play-source.ts'
import { historyFromPlayView } from '../data/history.ts'
import type { HistoryYear } from '../data/history.ts'
import { documentPresentation } from '../documents/presentation.ts'
import { reasonSentence } from '../../observation/reason-labels.ts'
import { trialGoalStatus } from './goal-view.ts'

type TargetKind = 'person' | 'group' | 'region' | 'title' | 'country' | 'house'
export type ComparisonTarget = { [K in TargetKind]: Readonly<{ kind: K; id: string }> }[TargetKind]
export type InvestigationContext = Readonly<{
  history: HistoryYear
  target?: ComparisonTarget
  evidence?: { [K in 'event' | 'trace']: Readonly<{ kind: K; id: string }> }['event' | 'trace']
}>
export type EvidenceRequest = Readonly<{ history: HistoryYear; kind: 'event' | 'trace'; id: string }>
export type ComparedRecord = Readonly<{ branch: HistoryYear['ref']['origin']['branch']; kind: 'event' | 'trace'; id: string }>
type Pair = 'A0_A1' | 'A1_A2'

/** 元の比較で得たHistoryYearを保持し、別の転送範囲の同枝に取り替えない。 */
export function comparisonAt(view: PlayView, pair: Pair, year: number) {
  return historyFromPlayView(view)?.compare(pair, year)
}

function matches(ref: TargetRef, target: ComparisonTarget): boolean {
  if (ref.kind === 'PERSON_PAIR') return target.kind === 'person' && ref.ids.includes(target.id)
  return ref.kind.toLowerCase() === target.kind && ref.id === target.id
}

function targetState(history: HistoryYear, target: ComparisonTarget) {
  if (history.start.kind !== 'CONFIRMED') return undefined
  const w = history.start.world
  return target.kind === 'person' ? w.persons.find(x => x.personId === target.id)
    : target.kind === 'group' ? w.groups.find(x => x.groupId === target.id)
    : target.kind === 'region' ? w.regions.find(x => x.regionId === target.id)
    : target.kind === 'title' ? w.titles.find(x => x.titleId === target.id)
    : target.kind === 'house' ? w.houses.find(x => x.houseId === target.id)
    : w.countries.find(x => x.countryId === target.id)
}

const yearStatus: Readonly<Record<string, string>> = {
  CONFIRMED: '確定', COMMITTED: '確定', EVALUATION_ONLY: '評価のみ', HALTED: '計算停止（HALTED）',
  UNCOMPUTED: '未計算', NOT_LOADED: '未取得', OUT_OF_RANGE: '範囲外',
  ALIVE: '存命', DEAD: '死亡', NOT_BORN: '出生前', NOT_PRESENT: '対象は存在しません',
  ABSENT_FROM_BRANCH: 'この枝に対象は存在しません', UNKNOWN: '存在未確認（UNKNOWN）',
}

function targetName(history: HistoryYear, target: ComparisonTarget): string {
  if (target.kind === 'house') return history.start.kind === 'CONFIRMED'
    ? history.start.world.houses.find(x => x.houseId === target.id)?.name ?? '名前未確認の家門' : '名前未確認の家門'
  return documentPresentation(history).name(target)
}

type StateFact = Readonly<{ label: string; value: unknown; text: string }>
const fact = (label: string, value: unknown, text = String(value)): StateFact => ({ label, value, text })

function stateFacts(history: HistoryYear, target: ComparisonTarget): readonly StateFact[] {
  if (history.start.kind !== 'CONFIRMED') return []
  const w = history.start.world
  const { name } = documentPresentation(history)
  const named = (label: string, kind: 'person' | 'title' | 'country' | 'region', id: string | undefined, missing = '未確定') =>
    fact(label, id, id === undefined ? missing : name({ kind, id }))
  const list = (label: string, kind: 'person' | 'title', ids: string[]) =>
    fact(label, ids.sort(), ids.map(id => name({ kind, id })).join('、') || '記録なし')
  switch (target.kind) {
    case 'person': {
      const p = w.persons.find(x => x.personId === target.id)
      if (!p) return []
      const dynasty = p.legalDynasty.status === 'DETERMINED' ? p.legalDynasty.dynastyId : undefined
      return [
        fact('生死', [p.alive, p.deathYear], p.alive ? '存命' : `死亡${p.deathYear === undefined ? '' : `（${p.deathYear}年）`}`),
        fact('法的王朝', dynasty, dynasty ? w.legal.dynasties.find(x => x.dynastyId === dynasty)?.name ?? '名称未確認' : '未確定'),
        list('有効な婚姻の相手', 'person', w.legal.marriages.filter(m => m.status === 'ACTIVE' && m.personIds.includes(p.personId))
          .flatMap(m => m.personIds.filter(id => id !== p.personId))),
        list('保持称号・所領', 'title', w.titles.filter(t => t.holder.status === 'HELD' && t.holder.personId === p.personId).map(t => t.titleId)),
      ]
    }
    case 'group': {
      const g = w.groups.find(x => x.groupId === target.id)
      if (!g) return []
      const support = Object.entries(g.support.houseBps).sort(([a], [b]) => a.localeCompare(b))
      return [fact('人口', g.population, g.population.toLocaleString('ja-JP') + '人'), fact('不満', g.unrest),
        fact('家門支持', support, support.map(([id, bps]) => `${targetName(history, { kind: 'house', id })} ${bps / 100}%`).join('、') || '記録なし'),
        fact('態度未定', g.support.undecidedBps, `${g.support.undecidedBps / 100}%`)]
    }
    case 'country': {
      const c = w.countries.find(x => x.countryId === target.id)
      return c ? [named('統治者', 'person', c.rulerPersonId), named('宗主国', 'country', c.suzerainCountryId, '記録なし')] : []
    }
    case 'region': {
      const r = w.regions.find(x => x.regionId === target.id)
      return r ? [named('上位主権', 'country', r.sovereignCountryId), list('地域の称号', 'title', w.titles.filter(t => t.regionId === r.regionId).map(t => t.titleId))] : []
    }
    case 'title': {
      const t = w.titles.find(x => x.titleId === target.id)
      return t ? [named('保持者', 'person', t.holder.status === 'HELD' ? t.holder.personId : undefined), named('地域', 'region', t.regionId)] : []
    }
    case 'house': {
      const h = w.houses.find(x => x.houseId === target.id)
      return h ? [named('当主', 'person', h.headPersonId)] : []
    }
  }
}

function EventLink({ history, event, onEvidence }: Readonly<{
  history: HistoryYear; event: EventLogEntry; onEvidence: (request: EvidenceRequest) => void
}>) {
  return <button type="button" data-testid={`comparison-event-${event.eventId}`}
    onClick={() => onEvidence({ history, kind: 'event', id: event.eventId })}>{documentPresentation(history).eventName(event)}</button>
}

function TraceLink({ history, trace, onEvidence }: Readonly<{
  history: HistoryYear; trace: DecisionTrace; onEvidence: (request: EvidenceRequest) => void
}>) {
  const view = documentPresentation(history)
  return <button type="button" data-testid={`comparison-trace-${trace.traceId}`}
    onClick={() => onEvidence({ history, kind: 'trace', id: trace.traceId })}>{view.traceStatus(trace)}：{reasonSentence(trace.reasonCodes)}</button>
}

function Branch({ history, target, focus, onEvidence }: Readonly<{
  history: HistoryYear; target?: ComparisonTarget; focus?: ComparedRecord; onEvidence: (request: EvidenceRequest) => void
}>) {
  const records = history.records
  const onBranch = focus?.branch === history.ref.origin.branch
  const events = records.kind === 'COMMITTED' ? records.events.filter(e => focus
    ? onBranch && focus.kind === 'event' && e.eventId === focus.id : !target || e.involvedRefs.some(r => matches(r, target))) : []
  const traces = records.kind === 'COMMITTED' ? records.traces.filter(t => focus
    ? onBranch && focus.kind === 'trace' && t.traceId === focus.id : !target || matches(t.actorRef, target)) : []
  const state = target && targetState(history, target)
  const presence = target?.kind === 'person' ? yearStatus[history.person(target.id).kind]
    : state ? '年初に存在' : history.start.kind === 'CONFIRMED' ? '年初に存在しない' : yearStatus[history.start.kind]
  return <section aria-label={`${history.ref.origin.branch}の記録`}>
    <h4>{history.ref.origin.branch}・{history.ref.year}年</h4>
    <p>年初: {yearStatus[history.start.kind]}{target && `／${targetName(history, target)}：${presence}`}</p>
    {target && state && <details><summary>対象の年初状態（実値）</summary><pre>{JSON.stringify(state, null, 2)}</pre></details>}
    <p>年内記録: {yearStatus[records.kind]}</p>
    {records.kind === 'COMMITTED' && <>
      {records.coverage.kind === 'TRANSFER_OMISSION'
        ? <p>転送省略あり（{records.coverage.scope === 'YEAR' ? 'この年' : '全期間'}）。未表示の記録の不存在は断定できません。</p>
        : <p>この年の転送記録は完全です。</p>}
      {target?.kind === 'title' && <p>称号はEvent関与先・Trace主体の直接参照に含まれません。</p>}
      {(!focus || onBranch && focus.kind === 'event') && <details open={focus ? true : undefined}><summary>年内の出来事（直接関与・{events.length}件）</summary>
        {events.length === 0 ? <p>表示データ内に該当記録なし。</p> : <ul>{events.map(e => <li key={e.eventId}><EventLink history={history} event={e} onEvidence={onEvidence} /></li>)}</ul>}
      </details>}
      {(!focus || onBranch && focus.kind === 'trace') && <details open={focus ? true : undefined}><summary>判断根拠（判断主体・{traces.length}件）</summary>
        {traces.length === 0 ? <p>表示データ内に該当記録なし。</p> : <ul>{traces.map(t => <li key={t.traceId}><TraceLink history={history} trace={t} onEvidence={onEvidence} /></li>)}</ul>}
      </details>}
    </>}
  </section>
}

function Differences({ comparison, target, focus, onEvidence }: Readonly<{
  comparison: NonNullable<ReturnType<typeof comparisonAt>>; target?: ComparisonTarget; focus?: ComparedRecord
  onEvidence: (request: EvidenceRequest) => void
}>) {
  const { before, after, changes } = comparison
  if (before.records.kind === 'EVALUATION_ONLY' || after.records.kind === 'EVALUATION_ONLY')
    return <p>評価年は年内Event・Traceを比較しません。</p>
  if (!changes) return <p>両枝の年内記録が確定していないため差分は表示できません。</p>
  const eventMatches = (e: (typeof changes.events)[number]['event']) => !target || e.involvedRefs.some(r => matches(r, target))
  const traceMatches = (t: NonNullable<(typeof changes.traces)[number]['before']>) => !target || matches(t.actorRef, target)
  const beforeSide = focus?.branch === before.ref.origin.branch
  const events = changes.events.filter(d => focus ? focus.kind === 'event' && (beforeSide
    ? (d.kind === 'A0_ONLY' ? d.event : d.counterpart)?.eventId === focus.id
    : d.kind !== 'A0_ONLY' && d.event.eventId === focus.id) : eventMatches(d.event) || (d.counterpart && eventMatches(d.counterpart)))
  const traces = changes.traces.filter(d => focus ? focus.kind === 'trace' && (beforeSide
    ? [d.before, ...(d.ambiguousBefore ?? [])] : [d.after, ...(d.ambiguousAfter ?? [])]).some(t => t?.traceId === focus.id)
    : [d.before, d.after, ...(d.ambiguousBefore ?? []), ...(d.ambiguousAfter ?? [])].some(t => t && traceMatches(t)))
  const omitted = [before, after].some(y => y.records.kind === 'COMMITTED' && y.records.coverage.kind === 'TRANSFER_OMISSION')
  return <section aria-label="記録差分">
    <h4>表示データ内の記録差 {focus ? '（指定した根拠）' : target ? '（対象の直接関与・判断主体）' : '（全対象）'}</h4>
    {omitted && <p>転送省略があるため、表示データからの比較は暫定です。片側のみ・差分なしに加え、同一IDの内容差や判断の一対一対応・内容差も完全記録で確定できません。片枝のEvent省略だけでも、参照先を含む判断Traceに見かけ上の差が生じる場合があります。</p>}
    <p>Event {events.length}件／判断Trace {traces.length}件。対応は既存の比較結果であり、因果を示しません。</p>
    {events.length === 0 && traces.length === 0 && <p>表示データ内に該当する記録差はありません。</p>}
    <ul>{events.map((d, i) => {
      const b = d.kind === 'A0_ONLY' ? d.event : d.counterpart
      const a = d.kind === 'A0_ONLY' ? undefined : d.event
      return <li key={`event-${i}`}>Event {d.kind === 'CHANGED' ? '同じIDで内容差' : d.kind === 'A0_ONLY' ? `${before.ref.origin.branch}側のみ` : `${after.ref.origin.branch}側のみ`}
        {[{ h: before, e: b }, { h: after, e: a }].map(({ h, e }) => e && <div key={h.ref.origin.branch}>{h.ref.origin.branch}: <EventLink history={h} event={e} onEvidence={onEvidence} /></div>)}
      </li>
    })}</ul>
    <ul>{traces.map((d, i) => <li key={`trace-${i}`}>判断 {d.kind === 'AMBIGUOUS' ? 'AMBIGUOUS（対応不明）' : d.kind === 'CHANGED' ? '対応する判断に内容差' : d.kind === 'A0_ONLY' ? `${before.ref.origin.branch}側のみ` : `${after.ref.origin.branch}側のみ`}
      {[{ h: before, items: d.ambiguousBefore ?? (d.before ? [d.before] : []) }, { h: after, items: d.ambiguousAfter ?? (d.after ? [d.after] : []) }].flatMap(({ h, items }) => items.map(t => <div key={`${h.ref.origin.branch}:${t.traceId}`}>{h.ref.origin.branch}: <TraceLink history={h} trace={t} onEvidence={onEvidence} /></div>))}
    </li>)}</ul>
  </section>
}

function TargetStateComparison({ before, after, target }: Readonly<{ before: HistoryYear; after: HistoryYear; target: ComparisonTarget }>) {
  const b = targetState(before, target), a = targetState(after, target)
  const left = stateFacts(before, target), right = new Map(stateFacts(after, target).map(row => [row.label, row]))
  const comparable = b !== undefined && a !== undefined
  const facts = comparable ? left.flatMap(row => {
    const other = right.get(row.label)
    return other && JSON.stringify(row.value) !== JSON.stringify(other.value) ? [{ name: row.label, before: row.text, after: other.text }] : []
  }) : []
  return <section aria-label="年初の状態差">
    <h4>対象の年初状態</h4>
    <p>対象年初状態: {comparable ? facts.length === 0 && JSON.stringify(b) === JSON.stringify(a) ? '実値に差なし' : '実値に差あり' : '両枝での比較はできません'}（詳細は各枝の年初状態）</p>
    {facts.length > 0 && <dl>{facts.map(f => <div key={f.name}><dt>{f.name}</dt><dd>{before.ref.origin.branch}：{f.before} → {after.ref.origin.branch}：{f.after}</dd></div>)}</dl>}
  </section>
}

/** 窓の内容だけを提供する。Worker発行・窓管理・介入は呼び出し側の責務。 */
export function DeskComparison({ view, pair, year, target, focus, context, onReturn, onEvidence }: Readonly<{
  view: PlayView; pair: Pair; year: number; target?: ComparisonTarget; focus?: ComparedRecord; context: InvestigationContext
  onReturn: (context: InvestigationContext) => void; onEvidence: (request: EvidenceRequest) => void
}>) {
  const comparison = useMemo(() => comparisonAt(view, pair, year), [view, pair, year])
  const comparedView = pair === 'A1_A2' ? view.second : view
  return <section aria-label="歴史の比較">
    <h3>同じ年の歴史を比較</h3>
    <button type="button" onClick={() => onReturn(context)}>元の調査へ戻る</button>
    {pair === 'A1_A2' && view.second && <p>第1介入入力年 {view.input.year}年／第2介入入力年 {view.second.input.year}年</p>}
    {!comparison ? <p>この比較は取得できません。</p> : <>
      {comparedView && <p>介入：{[comparedView.input.firstPersonId, comparedView.input.secondPersonId].map(id =>
        documentPresentation(comparison.before).name({ kind: 'person', id })).join(' と ')}の信頼を {comparedView.input.signedDelta > 0 ? '+' : ''}{comparedView.input.signedDelta}、{comparedView.input.durationYears}年間補正。</p>}
      {comparedView && <p>1350年の技術判定（正式勝敗ではありません）：{comparison.before.ref.origin.branch} {trialGoalStatus(comparedView.a0.result.technicalGoal)} ／ {comparison.after.ref.origin.branch} {trialGoalStatus(comparedView.a1.result.technicalGoal)}</p>}
      <p>{pair === 'A0_A1' && `介入年 ${view.input.year}年／`}観測年 {year}年。年初の状態と年内の記録は別です。記録差は因果を証明しません。</p>
      {target && <TargetStateComparison before={comparison.before} after={comparison.after} target={target} />}
      <Differences comparison={comparison} target={target} focus={focus} onEvidence={onEvidence}/>
      <Branch history={comparison.before} target={target} focus={focus} onEvidence={onEvidence}/>
      <Branch history={comparison.after} target={target} focus={focus} onEvidence={onEvidence}/>
    </>}
  </section>
}
