import { useMemo, useState } from 'react'
import type { ReactNode } from 'react'
import type { HistoryYear } from '../data/history.ts'
import { chronicleRows } from '../../observation/history-digest.ts'
import type { DocumentTarget } from './index.tsx'

const PAGE = 24

export function YearRecordsDocument({ history, open }: Readonly<{
  history: HistoryYear; open: (target: DocumentTarget, text: string) => ReactNode
}>) {
  const [limit, setLimit] = useState(PAGE)
  const [kind, setKind] = useState('all')
  const { records, start } = history
  const rows = useMemo(() => start.kind === 'CONFIRMED' && records.kind === 'COMMITTED' ? chronicleRows(start.world, records.events, records.traces, true) : [], [start, records])
  if (records.kind === 'EVALUATION_ONLY') return <p>この年は年初の評価のみ。</p>
  if (records.kind !== 'COMMITTED') return <p>年内の記録は未取得です。</p>
  const filtered = rows.filter(r => kind === 'all' || r.kind === kind)
  return <>
    <h3>{history.ref.year}年内の記録</h3>
    {records.coverage.kind === 'TRANSFER_OMISSION' && <p>転送省略あり。取得分のみ表示。</p>}
    <label>記録の種類 <select value={kind} onChange={e => { setKind(e.target.value); setLimit(PAGE) }}>
      <option value="all">すべて</option><option value="event">出来事</option><option value="trace">判断</option>
    </select></label>
    {filtered.length ? <ol>{filtered.slice(0, limit).map(r => <li key={`${r.kind}:${r.id}`}>
      {open({ kind: r.kind, id: r.id }, r.label)}
    </li>)}</ol> : <p>{rows.length ? '絞り込みに該当する記録なし。' : '取得範囲に記録なし。'}</p>}
    {filtered.length > limit && <button type="button" onClick={() => setLimit(n => n + PAGE)}>さらに表示</button>}
  </>
}
