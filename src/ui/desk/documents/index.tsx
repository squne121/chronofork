import { useEffect, useRef, useState } from 'react'
import type { KeyboardEvent, PointerEvent } from 'react'
import type { Id, TargetRef } from '../../../simulation/contracts/index.ts'
import type { ObservationSlice } from '../../branch-play-source.ts'
import { indexWorld } from '../../inspection-source.ts'
import type { Selection } from '../../inspection-source.ts'
import { FamilyTree } from '../../observation/FamilyTree.tsx'
import { PersonHistory } from '../../observation/PersonHistory.tsx'
import { historyFromObservation } from '../data/history.ts'
import type { HistoryYear, HistoryYearRef } from '../data/history.ts'
import './documents.css'

export type DocumentTarget = Selection | { [K in 'country' | 'family' | 'event' | 'trace']: Readonly<{ kind: K; id: Id }> }['country' | 'family' | 'event' | 'trace']
export type DocumentOpenRequest = Readonly<{ requestId: string; ref: HistoryYearRef; target: DocumentTarget; source?: DocumentTarget; history?: HistoryYear; internallyOpened?: true }>
export type DeskDocumentsProps = Readonly<{
  history?: HistoryYear
  slice?: ObservationSlice
  openRequest?: DocumentOpenRequest
  onOpenRelated?: (request: DocumentOpenRequest) => void
  onYear?: (ref: HistoryYearRef) => void
  onFilter?: (target: DocumentTarget, ref: HistoryYearRef) => void
  onIntervene?: (year: number, personId: Id, partnerId: Id, ref: HistoryYearRef) => void
}>
type WindowState = { id: string; ref: HistoryYearRef; target: DocumentTarget; source?: DocumentTarget; history?: HistoryYear; pinned: boolean; x: number; y: number; z: number }
const labels: Record<DocumentTarget['kind'], string> = { person: '人物', group: '集団', region: '地域', title: '称号', country: '国家', family: '家系', event: 'Event', trace: 'Trace' }
const sameRef = (a: HistoryYearRef, b: HistoryYearRef) => a.year === b.year && a.origin.seed === b.origin.seed && a.origin.branch === b.origin.branch && a.origin.configuration.mode === b.origin.configuration.mode && a.origin.configuration.configId === b.origin.configuration.configId && a.origin.configuration.configDigest === b.origin.configuration.configDigest && a.origin.modifierIds.length === b.origin.modifierIds.length && a.origin.modifierIds.every((id, i) => id === b.origin.modifierIds[i])
const clamp = (n: number, max: number) => Math.max(0, Math.min(n, Math.max(0, max)))
const limitPosition = (x: number, y: number) => ({ x: clamp(x, window.innerWidth - Math.min(420, window.innerWidth)), y: clamp(y, window.innerHeight - 80) })
const statusText: Record<string, string> = { NOT_LOADED: '未取得', UNCOMPUTED: '未計算', OUT_OF_RANGE: '範囲外', HALTED: '計算停止', EVALUATION_ONLY: '年初評価のみ', NO_RECORD: '記録なし（照会範囲）', POSSIBLY_OMITTED: '転送省略の可能性', NOT_BORN: '年初は出生前', NOT_PRESENT: '年初に不在', ABSENT_FROM_BRANCH: 'この枝に存在を確認できない', UNKNOWN: '未確認' }
const targetFromRef = (r: TargetRef): DocumentTarget | undefined => {
  switch (r.kind) {
    case 'PERSON': return { kind: 'person', id: r.id }
    case 'GROUP': return { kind: 'group', id: r.id }
    case 'REGION': return { kind: 'region', id: r.id }
    case 'COUNTRY': return { kind: 'country', id: r.id }
    default: return undefined
  }
}

export function DeskDocuments({ history, slice, openRequest, onOpenRelated, onYear, onFilter, onIntervene }: DeskDocumentsProps) {
  const [windows, setWindows] = useState<WindowState[]>([])
  const [preview, setPreview] = useState<{ windowId: string; target: DocumentTarget }>()
  const [menu, setMenu] = useState<{ windowId: string; target: DocumentTarget }>()
  const seen = useRef(new Set<string>())
  const serial = useRef(0)
  const z = useRef(0)
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null)
  useEffect(() => {
    if (!openRequest || openRequest.internallyOpened === true || seen.current.has(openRequest.requestId)) return
    seen.current.add(openRequest.requestId)
    const offset = (serial.current++ % 6) * 28
    setWindows(ws => [...ws, { id: `external-${++serial.current}`, ref: openRequest.ref, target: openRequest.target, source: openRequest.source, pinned: openRequest.history !== undefined, history: openRequest.history && sameRef(openRequest.history.ref, openRequest.ref) ? openRequest.history : undefined, ...limitPosition(24 + offset, 24 + offset), z: ++z.current }])
  }, [openRequest])
  useEffect(() => {
    if (!history) return
    // Capture the first matching supplied transfer view for each window.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setWindows(ws => ws.map(w => (!w.pinned && (!w.history || ((w.history.records.kind !== 'COMMITTED' && w.history.records.kind !== 'EVALUATION_ONLY') && ((w.history.start.kind !== 'CONFIRMED' && history.start.kind === 'CONFIRMED') || history.records.kind === 'COMMITTED' || history.records.kind === 'EVALUATION_ONLY')))) && sameRef(w.ref, history.ref) ? { ...w, history } : w))
  }, [history, openRequest])
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
    setWindows(ws => [...ws, { id: `internal-${serial.current}-${z.current}`, ref, target, source: w.target, pinned: year === w.ref.year && w.pinned, history: year === w.ref.year ? w.history : undefined, ...limitPosition(w.x + 28, w.y + 28), z: ++z.current }])
    const notice: DocumentOpenRequest = { ...request, history: year === w.ref.year ? w.history : undefined, internallyOpened: true }
    onOpenRelated?.(notice)
    if (year !== w.ref.year) onYear?.(ref)
  }
  const keyMove = (e: KeyboardEvent<HTMLButtonElement>, w: WindowState) => {
    const delta: Record<string, [number, number]> = { ArrowLeft: [-20, 0], ArrowRight: [20, 0], ArrowUp: [0, -20], ArrowDown: [0, 20] }
    const d = delta[e.key]
    if (d) { e.preventDefault(); move(w.id, w.x + d[0], w.y + d[1]) }
  }
  const beginDrag = (e: PointerEvent<HTMLButtonElement>, w: WindowState) => { e.currentTarget.setPointerCapture(e.pointerId); drag.current = { id: w.id, dx: e.clientX - w.x, dy: e.clientY - w.y } }
  const link = (w: WindowState, target: DocumentTarget, text: string) => <button type="button" onMouseEnter={() => setPreview({ windowId: w.id, target })} onMouseLeave={() => setPreview(undefined)} onFocus={() => setPreview({ windowId: w.id, target })} onBlur={() => setPreview(undefined)} onContextMenu={e => { e.preventDefault(); setMenu({ windowId: w.id, target }) }} onClick={() => open(w, target)}>{text}</button>
  const content = (w: WindowState) => {
    const history = w.history
    if (!history || !sameRef(w.ref, history.ref)) return <><p>未取得（参照文脈が一致しません）</p><button type="button" onClick={() => onYear?.(w.ref)}>この参照へ移動</button></>
    const target = w.target
    if (target.kind === 'event' || target.kind === 'trace') {
      if (target.kind === 'event') {
        const found = history.event(target.id)
        if (found.kind !== 'RECORDED') return <p>{statusText[found.kind] ?? found.kind}</p>
        const e = found.record
        return <><p>年内の実Event: {e.eventType} / {e.phase}</p><ul>{e.involvedRefs.map((r, i) => { const t = targetFromRef(r); return <li key={i}>{r.kind === 'PERSON_PAIR' ? r.ids.map(id => <span key={id}>{link(w, { kind: 'person', id }, `人物 ${id}`)}</span>) : t ? link(w, t, `${labels[t.kind]} ${t.id}`) : `${r.kind} ${'id' in r ? r.id : ''}（参照未対応）`}</li> })}</ul><h4>実判断記録</h4>{e.sourceTraceIds.length ? e.sourceTraceIds.map(id => <span key={id}>{link(w, { kind: 'trace', id }, `Trace ${id}`)}</span>) : <p>参照記録なし</p>}<details><summary>状態差分</summary><pre>{JSON.stringify(e.stateChanges, null, 2)}</pre></details></>
      }
      const found = history.trace(target.id)
      if (found.kind !== 'RECORDED') return <p>{statusText[found.kind] ?? found.kind}</p>
      const t = found.record
      const actor = targetFromRef(t.actorRef)
      return <><p>実判断: {t.ruleId} / {t.status}</p><p>理由: {t.reasonCodes.join('、') || '記録なし'}</p>{actor && link(w, actor, `${labels[actor.kind]} ${actor.id}`)}{t.actorRef.kind === 'PERSON_PAIR' && t.actorRef.ids.map(id => <span key={id}>{link(w, { kind: 'person', id }, `人物 ${id}`)}</span>)}<h4>関連Event</h4>{t.eventIds.length ? t.eventIds.map(id => <span key={id}>{link(w, { kind: 'event', id }, `Event ${id}`)}</span>) : <p>Event参照なし</p>}<details><summary>判断の詳細</summary><pre>{JSON.stringify(t, null, 2)}</pre></details></>
    }
    if (history.start.kind !== 'CONFIRMED') return <p>{statusText[history.start.kind] ?? history.start.kind}</p>
    const world = history.start.world
    const index = indexWorld(world)
    if (target.kind === 'person' || target.kind === 'family') {
      const person = history.person(target.id)
      if (person.kind !== 'ALIVE' && person.kind !== 'DEAD') return <p>{statusText[person.kind] ?? person.kind}（{person.kind}）</p>
      if (target.kind === 'family') return <><FamilyTree world={world} personId={target.id} onSelectPerson={id => open(w, { kind: 'person', id })} onSelectTitle={id => open(w, { kind: 'title', id })} /><h4>中心人物の選択年の実Event</h4>{history.records.kind === 'COMMITTED' ? <>{history.records.coverage.kind === 'TRANSFER_OMISSION' && <p>転送省略あり。</p>}{history.records.events.filter(e => e.involvedRefs.some(r => (r.kind === 'PERSON' && r.id === target.id) || (r.kind === 'PERSON_PAIR' && r.ids.includes(target.id)))).map(e => <div key={e.eventId}>{link(w, { kind: 'event', id: e.eventId }, `Event ${e.eventId}`)}</div>)}</> : <p>{statusText[history.records.kind] ?? history.records.kind}</p>}</>
    }
    if (target.kind === 'country') {
      const country = world.countries.find(c => c.countryId === target.id)
      return country ? <><h4>{country.name}</h4><p>年初の実記録</p><pre>{JSON.stringify(country, null, 2)}</pre></> : <p>年初に参照不明（{target.id}）</p>
    }
    const relatedRecords = history.records.kind === 'COMMITTED' ? history.records : undefined
    const refKind = target.kind.toUpperCase()
    const events = relatedRecords?.events.filter(e => e.involvedRefs.some(r => ('id' in r && r.kind === refKind && r.id === target.id) || (target.kind === 'person' && r.kind === 'PERSON_PAIR' && r.ids.includes(target.id)))) ?? []
    const traces = relatedRecords?.traces.filter(t => ('id' in t.actorRef && t.actorRef.kind === refKind && t.actorRef.id === target.id) || (target.kind === 'person' && t.actorRef.kind === 'PERSON_PAIR' && t.actorRef.ids.includes(target.id))) ?? []
    const validSlice = slice && w.ref.origin.branch === 'A0' && sameRef(historyFromObservation(slice).at(slice.year).ref, w.ref) && slice.world.year === w.ref.year
    const entity = target.kind === 'person' ? index.person(target.id) : target.kind === 'group' ? index.group(target.id) : target.kind === 'region' ? index.region(target.id) : index.title(target.id)
    return <><h4>年初の実記録</h4>{entity ? <pre>{JSON.stringify(entity, null, 2)}</pre> : <p>年初に参照不明（{target.id}）</p>}
      {target.kind === 'person' && index.person(target.id) && (() => { const id = index.person(target.id)!.originGroupId; const group = index.group(id); return group ? link(w, { kind: 'group', id }, group.name) : <p>出身集団の参照不明（{id}）</p> })()}
      {target.kind === 'group' && index.group(target.id) && link(w, { kind: 'region', id: index.group(target.id)!.regionId }, '所属地域を開く')}
      {target.kind === 'person' && <>{link(w, { kind: 'family', id: target.id }, '家系を開く')}{validSlice && <PersonHistory records={slice.personRecords} personId={target.id} currentYear={w.ref.year} nameOf={id => index.person(id)?.name} onFocusPerson={(id, year) => open(w, { kind: 'person', id }, year)} onOpenEvent={(id, year) => open(w, { kind: 'event', id }, year)} onOpenTrace={(id, year) => open(w, { kind: 'trace', id }, year)} onYear={year => onYear?.({ ...w.ref, year })} onSelectTitle={(id, year) => open(w, { kind: 'title', id }, year)} onIntervene={onIntervene ? (year, personId, partnerId) => onIntervene(year, personId, partnerId, { ...w.ref, year }) : undefined} />}</>}
      <button type="button" onClick={() => onFilter?.(target, w.ref)}>年表で絞り込む</button><h4>選択年の実Event・判断</h4>{relatedRecords ? <>{relatedRecords.coverage.kind === 'TRANSFER_OMISSION' && <p>転送省略あり。表示は取得済み記録のみ。</p>}{events.map(e => <div key={e.eventId}>{link(w, { kind: 'event', id: e.eventId }, `Event ${e.eventId}`)}</div>)}{traces.map(t => <div key={t.traceId}>{link(w, { kind: 'trace', id: t.traceId }, `Trace ${t.traceId}`)}</div>)}{!events.length && !traces.length && <p>取得範囲に関連記録なし。関係や判断の不存在は意味しません。</p>}</> : <p>{statusText[history.records.kind] ?? history.records.kind}</p>}</>
  }
  return <>{windows.map(w => <section key={w.id} role="dialog" aria-label={`${labels[w.target.kind]} ${w.target.id}`} className="desk-document" style={{ left: w.x, top: w.y, zIndex: w.z, maxHeight: `calc(100vh - ${w.y}px)` }} onPointerDown={() => front(w.id)} onFocus={() => front(w.id)} onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); close(w.id) } }}>
    <header><strong>{labels[w.target.kind]} {w.target.id}</strong><button type="button" aria-label="資料を移動" onKeyDown={e => keyMove(e, w)} onPointerDown={e => beginDrag(e, w)} onPointerMove={e => { if (drag.current?.id === w.id) move(w.id, e.clientX - drag.current.dx, e.clientY - drag.current.dy) }} onPointerUp={() => { drag.current = null }} onPointerCancel={() => { drag.current = null }}>移動</button><button type="button" aria-label="資料を閉じる" onClick={() => close(w.id)}>閉じる</button></header>
    <div className="desk-document-body"><p>{w.ref.origin.branch} / {w.ref.year}年 / seed {w.ref.origin.seed} / {w.ref.origin.configuration.configId ?? '構成未確認'} / {w.ref.origin.configuration.configDigest ?? 'digest未確認'} / 介入 {w.ref.origin.modifierIds.join(', ') || 'なし'}</p>{w.source && <p>参照元: {labels[w.source.kind]} {w.source.id}</p>}{content(w)}{preview?.windowId === w.id && <p role="status">プレビュー: {labels[preview.target.kind]} {preview.target.id}（クリックで開く）</p>}{menu?.windowId === w.id && <div role="menu" aria-label="対象の文脈操作"><button type="button" role="menuitem" onClick={() => { open(w, menu.target); setMenu(undefined) }}>資料を開く</button><button type="button" role="menuitem" onClick={() => { onFilter?.(menu.target, w.ref); setMenu(undefined) }}>年表で絞り込む</button>{menu.target.kind === 'person' && <button type="button" role="menuitem" onClick={() => { open(w, { kind: 'family', id: menu.target.id }); setMenu(undefined) }}>家系を開く</button>}<button type="button" role="menuitem" onClick={() => setMenu(undefined)}>メニューを閉じる</button></div>}</div>
  </section>)}</>
}
