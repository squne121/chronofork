import { useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'
import type { Id } from '../../../simulation/contracts/index.ts'
import type { ObservationSlice } from '../../branch-play-source.ts'
import type { Selection } from '../../inspection-source.ts'
import { FamilyTree } from '../../observation/FamilyTree.tsx'
import { PersonHistory } from '../../observation/PersonHistory.tsx'
import { personDisplayNames } from '../../observation/person-display.ts'
import { reasonSentence } from '../../observation/reason-labels.ts'
import { documentKinds as labels, documentPresentation, targetFromRef } from './presentation.ts'
import { historyFromObservation, sameHistoryYearRef } from '../data/history.ts'
import type { HistoryYear, HistoryYearRef } from '../data/history.ts'
import { PersonRelationship, RecordedTrust, RelationshipBasis } from './RelationshipEvidence.tsx'
import './documents.css'

export type DocumentTarget = Selection | { [K in 'country' | 'family' | 'event' | 'trace']: Readonly<{ kind: K; id: Id }> }['country' | 'family' | 'event' | 'trace']
export type DocumentOpenRequest = Readonly<{ requestId: string; ref: HistoryYearRef; target: DocumentTarget; source?: DocumentTarget; history?: HistoryYear; internallyOpened?: true; windowId?: string; sourceHistory?: HistoryYear }>
type DocumentSource = Readonly<{ windowId: string; sourceHistory?: HistoryYear }>
export type DeskDocumentsProps = Readonly<{
  history?: HistoryYear
  slice?: ObservationSlice
  openRequest?: DocumentOpenRequest
  historyUpdate?: Readonly<{ windowId: string; history: HistoryYear }>
  onOpenRelated?: (request: DocumentOpenRequest) => void
  onYear?: (ref: HistoryYearRef, context: DocumentSource) => void
  onFilter?: (target: DocumentTarget, ref: HistoryYearRef, context?: DocumentSource) => void
  interventionDisabled?: boolean
  onIntervene?: (year: number, personId: Id, partnerId: Id | undefined, ref: HistoryYearRef) => void
}>
type WindowState = { id: string; ref: HistoryYearRef; target: DocumentTarget; source?: DocumentTarget; sourceName?: string; history?: HistoryYear; sourceHistory?: HistoryYear; slice?: ObservationSlice; pinned: boolean; x: number; y: number; z: number }
const clamp = (n: number, max: number) => Math.max(0, Math.min(n, Math.max(0, max)))
const limitPosition = (x: number, y: number) => ({ x: clamp(x, window.innerWidth - Math.min(420, window.innerWidth)), y: clamp(y, window.innerHeight - 80) })
const statusText: Record<string, string> = { NOT_LOADED: '未取得', UNCOMPUTED: '未計算', OUT_OF_RANGE: '範囲外', HALTED: '計算停止', EVALUATION_ONLY: '年初評価のみ', NO_RECORD: '記録なし（照会範囲）', POSSIBLY_OMITTED: '転送省略の可能性', NOT_BORN: '年初は出生前', NOT_PRESENT: '年初に不在', ABSENT_FROM_BRANCH: 'この枝に存在を確認できない', UNKNOWN: '未確認' }
export const externalDocumentWindowId = (requestId: string) => `external:${requestId}`

export function DeskDocuments({ history: suppliedHistory, slice, openRequest, historyUpdate, onOpenRelated, onYear, onFilter, onIntervene, interventionDisabled }: DeskDocumentsProps) {
  const history = suppliedHistory
  const [windows, setWindows] = useState<WindowState[]>([])
  const [preview, setPreview] = useState<{ windowId: string; target: DocumentTarget }>()
  const [menu, setMenu] = useState<{ windowId: string; target: DocumentTarget }>()
  const seen = useRef(new Set<string>())
  const serial = useRef(0)
  const z = useRef(0)
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null)
  const sliceRef = useMemo(() => slice && historyFromObservation(slice).at(slice.year).ref, [slice])
  const matchingSlice = slice && sliceRef && history && sameHistoryYearRef(sliceRef, history.ref) && slice.world.year === history.ref.year
    && history.start.kind === 'CONFIRMED' && history.start.world === slice.world
    && (history.records.kind === 'EVALUATION_ONLY' || (history.records.kind === 'COMMITTED' && history.records.coverage.kind === 'COMPLETE')) ? slice : undefined
  useEffect(() => {
    if (!openRequest || openRequest.internallyOpened === true || seen.current.has(openRequest.requestId)) return
    seen.current.add(openRequest.requestId)
    const offset = (serial.current++ % 6) * 28
    setWindows(ws => [...ws, { id: externalDocumentWindowId(openRequest.requestId), ref: openRequest.ref, target: openRequest.target, source: openRequest.source, pinned: openRequest.history !== undefined, sourceHistory: openRequest.history, history: openRequest.history && sameHistoryYearRef(openRequest.history.ref, openRequest.ref) ? openRequest.history : undefined, ...limitPosition(24 + offset, 24 + offset), z: ++z.current }])
  }, [openRequest])
  useEffect(() => {
    if (!history) return
    // 最初に一致した転送ビューを保持する。同じ年の再取得で確定済みの窓を上書きしない。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWindows(ws => ws.map(w => {
      if (w.pinned || !sameHistoryYearRef(w.ref, history.ref)) return w
      if (!w.history || ((w.history.records.kind !== 'COMMITTED' && w.history.records.kind !== 'EVALUATION_ONLY') &&
        ((w.history.start.kind !== 'CONFIRMED' && history.start.kind === 'CONFIRMED') || history.records.kind === 'COMMITTED' || history.records.kind === 'EVALUATION_ONLY'))) {
        return { ...w, history, slice: matchingSlice }
      }
      return w.history === history && matchingSlice && !w.slice ? { ...w, slice: matchingSlice } : w
    }))
  }, [history, matchingSlice, openRequest])
  useEffect(() => {
    if (!historyUpdate) return
    // The owner explicitly supplies the same comparison source for this window.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWindows(ws => ws.map(w => w.id === historyUpdate.windowId && sameHistoryYearRef(w.ref, historyUpdate.history.ref) && (!w.history || (w.history.records.kind !== 'COMMITTED' && w.history.records.kind !== 'EVALUATION_ONLY' && ((w.history.start.kind !== 'CONFIRMED' && historyUpdate.history.start.kind === 'CONFIRMED') || historyUpdate.history.records.kind === 'COMMITTED' || historyUpdate.history.records.kind === 'EVALUATION_ONLY'))) ? { ...w, history: historyUpdate.history } : w))
  }, [historyUpdate])
  useEffect(() => {
    const resize = () => setWindows(ws => ws.map(w => ({ ...w, ...limitPosition(w.x, w.y) })))
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])
  const front = (id: string) => setWindows(ws => ws.map(w => w.id === id ? { ...w, z: ++z.current } : w))
  const close = (id: string) => setWindows(ws => ws.filter(w => w.id !== id))
  const move = (id: string, x: number, y: number) => setWindows(ws => ws.map(w => w.id === id ? { ...w, ...limitPosition(x, y) } : w))
  const open = (w: WindowState, target: DocumentTarget, year = w.ref.year) => {
    const ref = { ...w.ref, year }
    const request = { requestId: `related-${++serial.current}`, ref, target, source: w.target }
    // Internal windows use their own identity, independent of caller request IDs.
    const windowId = `internal:${serial.current}:${z.current}`
    const fromCurrent = !w.pinned && history && sameHistoryYearRef(ref, history.ref)
    const inheritedHistory = year === w.ref.year ? w.history : fromCurrent ? history : undefined
    const inheritedSlice = year === w.ref.year ? w.slice : fromCurrent ? matchingSlice : undefined
    setWindows(ws => [...ws, { id: windowId, ref, target, source: w.target, sourceName: documentPresentation(w.history).name(w.target), pinned: w.pinned, sourceHistory: w.sourceHistory, history: inheritedHistory, slice: inheritedSlice, ...limitPosition(w.x + 28, w.y + 28), z: ++z.current }])
    const notice: DocumentOpenRequest = { ...request, history: year === w.ref.year ? w.history : undefined, sourceHistory: w.sourceHistory, windowId, internallyOpened: true }
    onOpenRelated?.(notice)
    if (year !== w.ref.year) onYear?.(ref, { windowId, sourceHistory: w.sourceHistory })
  }
  const filter = (w: WindowState, target: DocumentTarget) => {
    if (w.pinned) onFilter?.(target, w.ref, { windowId: w.id, sourceHistory: w.sourceHistory })
    else onFilter?.(target, w.ref)
  }
  const keyMove = (e: KeyboardEvent<HTMLButtonElement>, w: WindowState) => {
    const delta: Record<string, [number, number]> = { ArrowLeft: [-20, 0], ArrowRight: [20, 0], ArrowUp: [0, -20], ArrowDown: [0, 20] }
    const d = delta[e.key]
    if (d) { e.preventDefault(); move(w.id, w.x + d[0], w.y + d[1]) }
  }
  const beginDrag = (e: PointerEvent<HTMLButtonElement>, w: WindowState) => { e.currentTarget.setPointerCapture(e.pointerId); drag.current = { id: w.id, dx: e.clientX - w.x, dy: e.clientY - w.y } }
  const link = (w: WindowState, target: DocumentTarget, text: string) => <button type="button" data-testid={`document-link-${target.kind}-${target.id}`} onMouseEnter={() => setPreview({ windowId: w.id, target })} onMouseLeave={() => setPreview(undefined)} onFocus={() => setPreview({ windowId: w.id, target })} onBlur={() => setPreview(undefined)} onContextMenu={e => { e.preventDefault(); setMenu({ windowId: w.id, target }) }} onClick={() => open(w, target)}>{text}</button>
  const content = (w: WindowState, view: ReturnType<typeof documentPresentation>) => {
    const history = w.history
    if (!history || !sameHistoryYearRef(w.ref, history.ref)) return <><p>未取得（参照文脈が一致しません）</p><button type="button" onClick={() => onYear?.(w.ref, { windowId: w.id, sourceHistory: w.sourceHistory })}>この参照へ移動</button></>
    const target = w.target
    const namedLink = (t: DocumentTarget) => link(w, t, view.name(t))
    const actorLinks = (r: Parameters<typeof targetFromRef>[0]) => {
      if (r.kind === 'PERSON_PAIR') return r.ids.map(id => <span key={id}>{namedLink({ kind: 'person', id })}</span>)
      const t = targetFromRef(r)
      return t ? namedLink(t) : 'この種別の参照は未対応です'
    }
    const raw = (label: string, value: unknown) => <details><summary>{label}</summary><pre>{JSON.stringify(value, null, 2)}</pre></details>
    if (target.kind === 'event' || target.kind === 'trace') {
      if (target.kind === 'event') {
        const found = history.event(target.id)
        if (found.kind !== 'RECORDED') return <p>{statusText[found.kind] ?? found.kind}</p>
        const e = found.record
        const description = view.describe(e)
        return <><h4>年内の出来事：{view.eventName(e)}</h4>
          {description?.lines.map((line, i) => <p key={i}>{line}</p>)}
          {!description && <p>この種類の出来事の説明は未対応です。確認できる参照と実状態差分を示します。</p>}
          <ul>{e.involvedRefs.map((r, i) => <li key={i}>{actorLinks(r)}</li>)}</ul>
          <h4>実判断記録</h4>{e.sourceTraceIds.length ? <ul>{e.sourceTraceIds.map(id => <li key={id}>{namedLink({ kind: 'trace', id })}</li>)}</ul> : <p>参照記録なし</p>}
          {raw(`技術詳細：${e.eventType} の記録・状態差分`, e)}</>
      }
      const found = history.trace(target.id)
      if (found.kind !== 'RECORDED') return <p>{statusText[found.kind] ?? found.kind}</p>
      const t = found.record
      const limited = history.ref.origin.configuration.configIdentity !== undefined
      return <><p>記録された判断：{view.traceStatus(t)}。{reasonSentence(t.reasonCodes)}</p>
        <p>判断の対象：{actorLinks(t.actorRef)}</p>
        {limited && t.ruleId === 'A-LEG-01' && t.reasonCodes.includes('SUPPORTING_REGISTRATION_BUDGET_EXCEEDED') &&
          <p>試遊の技術上の登録・追跡枠による保留であり、法的・政治的な拒否ではありません。</p>}
        {limited && t.actorRef.kind === 'PERSON_PAIR' && <>
          <RelationshipBasis history={history} left={t.actorRef.ids[0]} right={t.actorRef.ids[1]} />
          <RecordedTrust trace={t} />
        </>}
        {history.records.kind === 'COMMITTED' && history.records.coverage.kind === 'TRANSFER_OMISSION' &&
          <p>転送省略あり。関連記録をすべて取得したとは限りません。</p>}
        <h4>関連Event</h4>{t.eventIds.length ? <ul>{t.eventIds.map(id => <li key={id}>{namedLink({ kind: 'event', id })}</li>)}</ul> : <p>Event参照なし</p>}
        {raw(`技術詳細（実判断: ${t.ruleId} / ${t.status}）`, t)}</>
    }
    if (history.start.kind !== 'CONFIRMED') return <p>{statusText[history.start.kind] ?? history.start.kind}</p>
    const world = history.start.world
    const index = view.index!
    const relatedRecords = history.records.kind === 'COMMITTED' ? history.records : undefined
    const { events = [], traces = [] } = view.related(target) ?? {}
    const observed = w.slice ?? (w.pinned && w.history === suppliedHistory ? matchingSlice : undefined)
    const personNames = observed && (target.kind === 'person' || target.kind === 'family' ||
      (target.kind === 'title' && history.ref.origin.configuration.configIdentity !== undefined))
      ? personDisplayNames([...world.persons, ...observed.personRecords]) : view.names.person
    const personHistory = observed && target.kind === 'person' && <PersonHistory
      records={observed.personRecords} personId={target.id} currentYear={w.ref.year} nameOf={personNames}
      onFocusPerson={(id, year) => open(w, { kind: 'person', id }, year)} onOpenEvent={(id, year) => open(w, { kind: 'event', id }, year)}
      onOpenTrace={(id, year) => open(w, { kind: 'trace', id }, year)} onYear={year => onYear?.({ ...w.ref, year }, { windowId: w.id, sourceHistory: w.sourceHistory })}
      onSelectTitle={(id, year) => open(w, { kind: 'title', id }, year)}
      onIntervene={onIntervene && !w.pinned && !interventionDisabled ? (year, personId, partnerId) => onIntervene(year, personId, partnerId, { ...w.ref, year }) : undefined} />
    let facts
    switch (target.kind) {
      case 'person': case 'family': {
        const presence = history.person(target.id)
        if (presence.kind !== 'ALIVE' && presence.kind !== 'DEAD') {
          facts = <><p>{statusText[presence.kind] ?? presence.kind}（{presence.kind}）</p>
            {target.kind === 'person' ? personHistory : observed && namedLink({ kind: 'person', id: target.id })}</>
          break
        }
        const person = presence.person
        if (target.kind === 'family') {
          const displayWorld = { ...world, persons: world.persons.map(p => ({ ...p, name: personNames(p.personId) ?? p.name })) }
          facts = <FamilyTree world={displayWorld} personId={target.id} onSelectPerson={id => open(w, { kind: 'person', id })} onSelectTitle={id => open(w, { kind: 'title', id })} />
        } else {
          const group = index.group(person.originGroupId)
          const titles = world.titles.filter(t => t.holder.status === 'HELD' && t.holder.personId === target.id)
          facts = <><p>{person.birthYear}年生・年初に{person.alive ? '存命' : '死亡'}。</p>
            <p>出身集団：{group ? namedLink({ kind: 'group', id: group.groupId }) : '記録未確認'}</p>
            <p>年初の保持称号：{titles.length ? titles.map(t => <span key={t.titleId}>{namedLink({ kind: 'title', id: t.titleId })}</span>) : '記録なし'}</p>
            {link(w, { kind: 'family', id: target.id }, '家系を開く')}
            {!w.pinned && observed && onIntervene && person.alive && person.interactionRole !== 'SUPPORTING' && w.ref.year < 1350 &&
              <button type="button" disabled={interventionDisabled} onClick={() => onIntervene(w.ref.year, person.personId, undefined, w.ref)}>この人物と年から介入を検討する</button>}
            {history.ref.origin.configuration.configIdentity !== undefined && <PersonRelationship history={history} personId={target.id}
              nameOf={id => view.name({ kind: 'person', id })} onTrace={t => open(w, { kind: 'trace', id: t.traceId })} />}
            {personHistory}
            {raw('技術詳細：人物の年初状態', person)}</>
        }
        break
      }
      case 'country': {
        const country = world.countries.find(c => c.countryId === target.id)
        if (country) facts = <><p>統治者：{country.rulerPersonId ? namedLink({ kind: 'person', id: country.rulerPersonId }) : '未確定'}</p>
          {country.suzerainCountryId && <p>宗主国：{namedLink({ kind: 'country', id: country.suzerainCountryId })}</p>}
          <p>主権下の地域：</p><ul>{world.regions.filter(r => r.sovereignCountryId === country.countryId).map(r => <li key={r.regionId}>{namedLink({ kind: 'region', id: r.regionId })}</li>)}</ul>
          {raw('技術詳細：国家の年初状態', country)}</>
        break
      }
      case 'group': {
        const group = index.group(target.id)
        if (group) facts = <><p>人口：{group.population.toLocaleString('ja-JP')}人</p>
          <p>所属地域：{namedLink({ kind: 'region', id: group.regionId })}</p>{raw('技術詳細：集団の年初状態', group)}</>
        break
      }
      case 'region': {
        const region = index.region(target.id)
        if (region) facts = <><p>上位主権：{namedLink({ kind: 'country', id: region.sovereignCountryId })}</p>
          <p>地域の集団：</p><ul>{world.groups.filter(g => g.regionId === region.regionId).map(g => <li key={g.groupId}>{namedLink({ kind: 'group', id: g.groupId })}</li>)}</ul>
          {raw('技術詳細：地域の年初状態', region)}</>
        break
      }
      case 'title': {
        const title = index.title(target.id)
        const limited = history.ref.origin.configuration.configIdentity !== undefined
        const succession = limited ? relatedRecords?.traces.filter(t => t.ruleId === 'A-SUC-04' &&
          t.candidates.some(c => c.inputs?.titleId === target.id)) : undefined
        const titleHistory = limited ? observed?.titleHistories.find(h => h.titleId === target.id) : undefined
        const loss = limited ? observed?.titleLossRecords.find(l => l.titleId === target.id) : undefined
        if (title) facts = <><p>年初の保持者：{title.holder.status === 'HELD' ? namedLink({ kind: 'person', id: title.holder.personId }) : '未確定'}</p>
          {raw('技術詳細：称号の年初状態', title)}
          {!!succession?.length && <div><h4>{w.ref.year}年の継承判断</h4><ul>{succession.map(t => <li key={t.traceId}>
            {link(w, { kind: 'trace', id: t.traceId }, `${view.traceStatus(t)}：${reasonSentence(t.reasonCodes)}`)}
            {t.eventIds.length === 0 && '（関連Eventなし）'}</li>)}</ul></div>}
          {(loss || !!titleHistory?.transfers.length) && <section aria-label="1350年初までの原史の称号履歴">
            <h4>1350年初までの原史の称号履歴</h4>
            {loss && <>
              <p>1350年初には保持者を確認できません。最後に保持が確認された人物：<button type="button" onClick={() => open(w, { kind: 'person', id: loss.lastHolderId }, loss.heldFromYear)}>
                {personNames(loss.lastHolderId) ?? '名前未確認の保持者'}（{loss.heldFromYear}年初）</button>。</p>
              {w.ref.year !== loss.lostFromYear && <button type="button" onClick={() => open(w, target, loss.lostFromYear)}>
                保持者が未確定になった{loss.lostFromYear}年初の称号と判断を見る
              </button>}
            </>}
            {!!titleHistory?.transfers.length && <details><summary>歴代の称号移転（{titleHistory.transfers.length}件）</summary>
              <ul>{titleHistory.transfers.map(e => <li key={e.eventId}><button type="button" onClick={() => open(w, { kind: 'event', id: e.eventId }, e.year)}>
                {e.year}年の移転と判断を開く</button></li>)}</ul>
            </details>}
          </section>}</>
        break
      }
    }
    return <><h4>年初の実記録</h4>{facts ?? <p>年初に参照した対象の記録がありません。</p>}
      <h4>選択年の実Event・判断</h4>{relatedRecords ? <>
        {relatedRecords.coverage.kind === 'TRANSFER_OMISSION' && <p>転送省略あり。表示は取得済み記録のみ。</p>}
        {events.map(e => <div key={e.eventId}>{namedLink({ kind: 'event', id: e.eventId })}</div>)}
        {traces.map(t => <div key={t.traceId}>{namedLink({ kind: 'trace', id: t.traceId })}</div>)}
        {!events.length && !traces.length && <p>取得範囲に関連記録なし。関係や判断の不存在は意味しません。</p>}
      </> : <p>{statusText[history.records.kind] ?? history.records.kind}</p>}</>

  }
  return <>{windows.map(w => {
    const view = documentPresentation(w.history)
    const filterLabel = w.pinned && w.ref.origin.configuration.configIdentity !== undefined
      ? 'この資料の出典の比較で絞り込む' : '年表で絞り込む'
    return <section key={w.id} role="dialog" aria-label={`${labels[w.target.kind]} ${w.target.id}`} className="desk-document" style={{ left: w.x, top: w.y, zIndex: w.z, maxHeight: `min(78vh, calc(100vh - ${w.y}px))` }} onPointerDown={() => front(w.id)} onFocus={() => front(w.id)} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); if (menu?.windowId === w.id) setMenu(undefined); else close(w.id) } }}>
      <header><strong>{labels[w.target.kind]}：{view.name(w.target)}</strong><button type="button" aria-label="資料を移動" onKeyDown={e => keyMove(e, w)} onPointerDown={e => beginDrag(e, w)} onPointerMove={e => { if (drag.current?.id === w.id) move(w.id, e.clientX - drag.current.dx, e.clientY - drag.current.dy) }} onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }}>移動</button><button type="button" aria-label="資料を閉じる" onClick={() => close(w.id)}>閉じる</button></header>
      <div className="desk-document-body">
        <p data-testid="document-reference">{w.ref.origin.branch} / {w.ref.year}年 / seed {w.ref.origin.seed}</p>
        {w.source && <p>参照元: {labels[w.source.kind]}：{w.sourceName ?? view.name(w.source)}</p>}
        <details><summary>資料の出典・技術情報</summary>対象ID {w.target.id}{w.source && <> / 参照元ID {w.source.id}</>} / {w.ref.origin.configuration.configId ?? '構成未確認'} / {w.ref.origin.configuration.configDigest ?? 'digest未確認'} / 介入 {w.ref.origin.modifierIds.join(', ') || 'なし'}</details>
        {!w.pinned && w.history?.start.kind === 'CONFIRMED' && onYear && history && !sameHistoryYearRef(w.ref, history.ref) &&
          <button type="button" onClick={() => onYear(w.ref, { windowId: w.id })}>この年を観測</button>}
        {w.history?.start.kind === 'CONFIRMED' && onFilter && <button type="button" onClick={() => filter(w, w.target)}>
          {filterLabel}
        </button>}
        {interventionDisabled && w.target.kind === 'person' && w.slice && <p>観測の取得中、別の計算中、または seed が一致しない間は介入フォームへ移れません。</p>}
        {content(w, view)}
        {w.history && (w.history.start.kind !== 'CONFIRMED' || (w.history.records.kind !== 'COMMITTED' && w.history.records.kind !== 'EVALUATION_ONLY')) && <button type="button" onClick={() => onYear?.(w.ref, { windowId: w.id, sourceHistory: w.sourceHistory })}>この参照を取得</button>}
        {preview?.windowId === w.id && <p role="status">プレビュー: {view.name(preview.target)}（クリックで開く）</p>}
        {menu?.windowId === w.id && <div role="menu" aria-label="対象の文脈操作"><button type="button" role="menuitem" onClick={() => { open(w, menu.target); setMenu(undefined) }}>資料を開く</button>
          {onFilter && <button type="button" role="menuitem" onClick={() => { filter(w, menu.target); setMenu(undefined) }}>{filterLabel}</button>}
          {menu.target.kind === 'person' && <button type="button" role="menuitem" onClick={() => { open(w, { kind: 'family', id: menu.target.id }); setMenu(undefined) }}>家系を開く</button>}
          <button type="button" role="menuitem" onClick={() => setMenu(undefined)}>メニューを閉じる</button></div>}
      </div>
    </section>
  })}</>
}
