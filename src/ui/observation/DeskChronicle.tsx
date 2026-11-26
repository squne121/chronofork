import { useEffect, useMemo, useRef, useState } from 'react'
import type { ObservationSlice } from '../branch-play-source.ts'
import type { DocumentFilter } from '../desk/documents/record-filter.ts'
import type { DeskDocumentTarget } from '../desk/layout/document-link.ts'
import { EVENT_CATEGORIES } from '../integrated-overview.ts'
import { chronicleRows, groupBy } from './history-digest.ts'

export function DeskChronicle({ view, open, move, disabled, filter, clearFilter, filterName }: Readonly<{
  view: ObservationSlice; open: (target: DeskDocumentTarget, source?: DeskDocumentTarget, year?: number) => void;
  move: (year: number) => void; disabled: boolean; filter?: DocumentFilter; clearFilter?: () => void; filterName?: string
}>) {
  const [type, setType] = useState('all')
  const [personQuery, setPersonQuery] = useState('')
  const viewport = useRef<HTMLDivElement>(null)
  const activeYear = useRef<HTMLElement>(null)
  useEffect(() => {
    const area = viewport.current, section = activeYear.current
    if (area && section) area.scrollTop = section.offsetTop
  }, [view.year])
  const byYear = useMemo(() => groupBy(view.digest?.chronicle ?? chronicleRows(view.world, view.events, view.traces, false), r => r.year), [view])
  const query = personQuery.trim().toLocaleLowerCase()
  return <div className="obs-timeline desk-chronicle" data-testid="obs-chronicle" data-year={view.year}>
    <h3>年代記</h3>
    <div className="desk-chronicle-filters">
      <label>種類 <select value={type} onChange={e => setType(e.target.value)}>
        <option value="all">すべて</option>
        {EVENT_CATEGORIES.filter(c => c.key !== 'supporting').map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
        <option value="decision">出来事のない継承審査</option>
      </select></label>
      <label>人物名 <input type="search" value={personQuery} onChange={e => setPersonQuery(e.target.value)} /></label>
    </div>
    {filter && <p data-testid="obs-document-filter" role="status">{filterName ?? '資料の対象'}で絞り込み中 <button type="button" onClick={clearFilter}>解除</button></p>}
    <div ref={viewport} className="desk-chronicle-years" aria-label="年代順の記録" tabIndex={0}>
      {view.counts.map(c => {
        const observed = c.year === view.year
        const major = byYear.get(c.year) ?? []
        const target = filter?.target
        const rows = major.filter(r => (type === 'all' || r.categories.includes(type)) &&
          (!query || r.people.some(id => view.digest?.personNames[id]?.toLocaleLowerCase().includes(query))) &&
          (!target || (target.kind === 'person' || target.kind === 'family' ? r.people.includes(target.id) : r.targets.includes(`${target.kind}:${target.id}`))))
        return <section key={c.year} ref={observed ? activeYear : undefined} aria-current={observed ? 'date' : undefined} data-chronicle-year={c.year}>
          <header><strong>{c.year}年{observed ? ' · 観測中' : ''}</strong>
            <button type="button" disabled={observed || disabled} onClick={() => move(c.year)}>{c.year}年へ移動</button></header>
          {rows.length ? <ol>{rows.map(r => <li key={`${r.kind}:${r.id}`}>
            <button type="button" disabled={disabled} onClick={() => open({ kind: r.kind, id: r.id }, undefined, c.year)}>{r.label}</button>
          </li>)}</ol> : <p className="note">{c.events + c.traces === 0 ? (c.year === 1350 ? '年初の評価のみ' : '記録なし')
            : !observed && !view.digest ? '未取得' : query || filter || type !== 'all' ? '該当する主要記録なし' : '主要記録なし'}</p>}
          {c.events + c.traces > 0 && <button className="chronicle-all" type="button" disabled={disabled}
            onClick={() => open({ kind: 'records', id: String(c.year) }, undefined, c.year)}>全記録（{c.events + c.traces}件）</button>}
        </section>
      })}
    </div>
  </div>
}
