// 統合モードのEvent差を実ログから絞り込む閲覧専用UI。
// 事件の重要度・原因・未成立判断は推測しない。年・関与対象・Event IDの比較のみ。
import { useMemo, useState } from 'react'
import type { EventLogEntry, WorldState } from '../simulation/contracts/index.ts'
import type { BranchChoice } from './branch-play-source.ts'
import { eventHeadline, namesOf } from './integrated-overview.ts'
import type { CategoryRow } from './integrated-overview.ts'

export type ChangeRecord = Readonly<{
  branch: BranchChoice
  kind: 'A0_ONLY' | 'A1_ONLY' | 'CHANGED'
  event: EventLogEntry
  /** 複合Eventが複数の既存カテゴリに当てはまっても、一件として表示する。 */
  categories: readonly Readonly<{ key: string; label: string }>[]
}>

const PAGE_SIZE = 20
const KIND_LABEL: Readonly<Record<ChangeRecord['kind'], string>> = {
  A0_ONLY: 'A0にのみEvent IDあり',
  A1_ONLY: 'A1にのみEvent IDあり',
  CHANGED: '同じEvent IDで内容差',
}
const REF_LABEL: Readonly<Record<string, string>> = {
  PERSON: '人物', HOUSE: '家門', GROUP: '集団', COUNTRY: '国家', REGION: '地域',
}

/** 既存buildOverviewで確定したカテゴリ別Event差だけを集約する（WorldStateは変更しない）。 */
export function collectChangeRecords(rows: readonly CategoryRow[]): readonly ChangeRecord[] {
  const found = new Map<string, ChangeRecord>()
  for (const row of rows) {
    const kindRows = [
      ['A0', 'A0_ONLY', row.a0Only],
      ['A1', 'A1_ONLY', row.a1Only],
      ['A1', 'CHANGED', row.changed],
    ] as const
    for (const [branch, kind, events] of kindRows) {
      for (const event of events) {
        const key = JSON.stringify([branch, kind, event.eventId])
        const category = { key: row.category.key, label: row.category.label }
        const previous = found.get(key)
        found.set(key, previous
          ? { ...previous, categories: [...previous.categories, category] }
          : { branch, kind, event, categories: [category] })
      }
    }
  }
  return [...found.values()].sort((a, b) =>
    a.event.year - b.event.year || a.event.phase - b.event.phase ||
    a.event.eventId.localeCompare(b.event.eventId) || a.branch.localeCompare(b.branch))
}

/** Event.involvedRefsに明示された参照だけを対象フィルタに使う。 */
export function eventTargetKeys(event: EventLogEntry): readonly string[] {
  const keys = new Set<string>()
  for (const ref of event.involvedRefs) {
    if (ref.kind === 'PERSON_PAIR') {
      for (const id of ref.ids) keys.add(`PERSON:${id}`)
    } else {
      keys.add(`${ref.kind}:${ref.id}`)
    }
  }
  return [...keys]
}

function targetName(key: string, worlds: readonly (WorldState | undefined)[]): string {
  const separator = key.indexOf(':')
  const kind = key.slice(0, separator)
  const id = key.slice(separator + 1)
  for (const w of worlds) {
    if (!w) continue
    const name = kind === 'PERSON' ? w.persons.find(p => p.personId === id)?.name
      : kind === 'HOUSE' ? w.houses.find(h => h.houseId === id)?.name
      : kind === 'GROUP' ? w.groups.find(g => g.groupId === id)?.name
      : kind === 'COUNTRY' ? w.countries.find(c => c.countryId === id)?.name
      : kind === 'REGION' ? w.regions.find(r => r.regionId === id)?.name : undefined
    if (name) return `${REF_LABEL[kind] ?? kind}: ${name}`
  }
  return `${REF_LABEL[kind] ?? kind}: ${id}`
}

type Props = Readonly<{
  rows: readonly CategoryRow[]
  /** buildOverviewのEvent差分総数。9分類外も含めた、表示用の実記録差。 */
  totalDifferences: number
  worldA0: WorldState | undefined
  worldA1: WorldState | undefined
  onInspectEvent: (branch: BranchChoice, eventId: string) => void
}>

/** UX第1段階：分野・発生年・Event直接関与対象から実際の記録差を探す。 */
export function HistoricalChangesExplorer({ rows, totalDifferences, worldA0, worldA1, onInspectEvent }: Props) {
  const [category, setCategory] = useState('')
  const [year, setYear] = useState('')
  const [target, setTarget] = useState('')
  const [limit, setLimit] = useState(PAGE_SIZE)
  const changes = useMemo(() => collectChangeRecords(rows), [rows])
  // 同じbuildOverviewの差分集合から、分類に含まれないEventを明示する。
  // 分類外の信頼更新などを「歴史上の変化160件」と誤読させない。
  const outsideCount = totalDifferences - changes.length
  const categories = rows.map(r => r.category)
  const years = [...new Set(changes.map(x => x.event.year))].sort((a, b) => a - b)
  const targetKeys = [...new Set(changes.flatMap(x => eventTargetKeys(x.event)))]
  const targets = targetKeys.map(key => ({ key, label: targetName(key, [worldA0, worldA1]) }))
    .sort((a, b) => a.label.localeCompare(b.label, 'ja'))
  const activeCategory = categories.some(c => c.key === category) ? category : ''
  const activeYear = years.some(y => String(y) === year) ? year : ''
  const activeTarget = targetKeys.includes(target) ? target : ''
  const shown = changes.filter(change =>
    (!activeCategory || change.categories.some(c => c.key === activeCategory)) &&
    (!activeYear || String(change.event.year) === activeYear) &&
    (!activeTarget || eventTargetKeys(change.event).includes(activeTarget)))
  const namesA0 = namesOf(worldA0), namesA1 = namesOf(worldA1)
  const resetLimit = () => setLimit(PAGE_SIZE)

  return (
    <section className="change-explorer" aria-labelledby="change-explorer-heading" data-testid="change-explorer">
      <h4 id="change-explorer-heading">歴史の変化を探す（Eventの記録差）</h4>
      <p className="note">
        実際のEventを分野・発生年・関与対象で絞ります。現行のEvent IDによる比較を使用し、事件の重要度や介入との因果は判定しません。
        婚姻の見送りなどEventにならない判断は、下のDecisionTraceから確認してください。
      </p>
      <div className="filters">
        <label>分野
          <select data-testid="change-category" value={activeCategory} onChange={e => { setCategory(e.target.value); resetLimit() }}>
            <option value="">すべての分野</option>
            {categories.map(c => <option key={c.key} value={c.key}>{c.label}</option>)}
          </select>
        </label>
        <label>年
          <select data-testid="change-year" value={activeYear} onChange={e => { setYear(e.target.value); resetLimit() }}>
            <option value="">全年</option>
            {years.map(y => <option key={y} value={String(y)}>{y}年</option>)}
          </select>
        </label>
        <label>Eventの関与対象
          <select data-testid="change-target" value={activeTarget} onChange={e => { setTarget(e.target.value); resetLimit() }}>
            <option value="">すべての対象</option>
            {targets.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
          </select>
        </label>
      </div>
      <p className="note" data-testid="change-count" aria-live="polite">
        条件に一致する分類対象の記録差 {shown.length}件／既存9分野の分類対象 全{changes.length}件／分類外 {outsideCount}件（全Event記録差 {totalDifferences}件）。
        分類外には人物ペア信頼の更新などが含まれます。同一Eventが複数分野に該当しても重複計上しません。
      </p>
      {shown.length === 0
        ? <p data-testid="change-empty">この条件に一致するEventの記録差はありません。判断Traceや各枝の全記録は従来の欄から確認できます。</p>
        : <>
          <ol className="compare-event-list" data-testid="change-list">
            {shown.slice(0, limit).map(record =>
              <li key={`${record.branch}:${record.kind}:${record.event.eventId}`}>
                <button type="button" onClick={() => onInspectEvent(record.branch, record.event.eventId)}>
                  {record.event.year}年・{KIND_LABEL[record.kind]}・{record.categories.map(c => c.label).join('／')}：
                  {eventHeadline(record.event, record.branch === 'A0' ? namesA0 : namesA1, record.categories[0]!.label)}
                </button>
              </li>)}
          </ol>
          {shown.length > limit && <button type="button" data-testid="change-more" onClick={() => setLimit(n => n + PAGE_SIZE)}>
            続きを表示（残り{shown.length - limit}件）
          </button>}
        </>}
    </section>
  )
}
