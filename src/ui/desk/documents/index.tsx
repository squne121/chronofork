import { useEffect, useMemo, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import type { Id } from '../../../simulation/contracts/index.ts'
import { interventionTargetIssue } from '../../branch-play-source.ts'
import { endingHolderEvidence } from '../../observation/ending-evidence.ts'
import { A0FutureContext } from '../../observation/A0FutureContext.tsx'
import { collectAssociations } from '../../observation/associations.ts'
import type { ObservationSlice, PlayView } from '../../branch-play-source.ts'
import { InspectorDetail } from '../../Inspector.tsx'
import type { Selection } from '../../inspection-source.ts'
import { FamilyTree } from '../../observation/FamilyTree.tsx'
import { PersonHistory } from '../../observation/PersonHistory.tsx'
import { personDisplayNames } from '../../observation/person-display.ts'
import { reasonSentence } from '../../observation/reason-labels.ts'
import { documentKinds as labels, documentPresentation, targetFromRef } from './presentation.ts'
import { historyFromObservation, sameHistoryYearRef } from '../data/history.ts'
import type { HistoryYear, HistoryYearRef } from '../data/history.ts'
import { PersonRelationship, RecordedNegotiation, RecordedTrust, RelationshipBasis } from './RelationshipEvidence.tsx'
import { SuccessionDocument } from './SuccessionDocument.tsx'
import { YearRecordsDocument } from './YearRecordsDocument.tsx'
import './documents.css'

export type DocumentTarget = Selection | { [K in 'country' | 'family' | 'event' | 'trace' | 'ending' | 'records']: Readonly<{ kind: K; id: Id }> }['country' | 'family' | 'event' | 'trace' | 'ending' | 'records']
type DocumentData = Readonly<{ history?: HistoryYear; slice?: ObservationSlice; error?: string }>
export type DocumentOpenRequest = Readonly<{
  requestId: string; ref: HistoryYearRef; target: DocumentTarget; source?: DocumentTarget; history?: HistoryYear;
  sourceHistory?: HistoryYear; comparison?: PlayView
}>
export type DeskDocumentsProps = Readonly<{
  history?: HistoryYear
  slice?: ObservationSlice
  openRequest?: DocumentOpenRequest
  historyUpdate?: DocumentData & Readonly<{ requestId: string; ref: HistoryYearRef; comparison?: PlayView }>
  onResolve?: (request: DocumentOpenRequest) => void
  onYear?: (ref: HistoryYearRef) => void
  onFilter?: (target: DocumentTarget, ref: HistoryYearRef, sourceHistory?: HistoryYear) => void
  interventionDisabled?: boolean
  onIntervene?: (year: number, personId: Id, partnerId: Id | undefined, ref: HistoryYearRef, evidence: { history: HistoryYear; traceId?: Id }) => void
}>
type WindowState = DocumentOpenRequest & DocumentData & Readonly<{ sourceName?: string; partner?: { id: string; serial: number } }>
type Desk = Readonly<{ work?: WindowState; fixed?: WindowState; back: readonly WindowState[]; front?: 'work' | 'fixed' }>
const sameDocument = (a: DocumentOpenRequest, b: DocumentOpenRequest) => a.target.kind === b.target.kind && a.target.id === b.target.id &&
  a.comparison === b.comparison && sameHistoryYearRef(a.ref, b.ref)
const statusText: Record<string, string> = { NOT_LOADED: '未取得', UNCOMPUTED: '未計算', OUT_OF_RANGE: '範囲外', HALTED: '計算停止', EVALUATION_ONLY: '年初評価のみ', NO_RECORD: '記録なし（照会範囲）', POSSIBLY_OMITTED: '転送省略の可能性', NOT_BORN: '年初は出生前', NOT_PRESENT: '年初に不在', ABSENT_FROM_BRANCH: 'この枝に存在を確認できない', UNKNOWN: '未確認' }

function show(desk: Desk, doc: WindowState): Desk {
  if (desk.fixed && sameDocument(desk.fixed, doc)) return { ...desk, front: 'fixed' }
  if (desk.work?.history && sameDocument(desk.work, doc)) return { ...desk, front: 'work' }
  if (desk.work && sameDocument(desk.work, doc)) return { ...desk, work: doc, front: 'work' }
  // 戻るための参照だけを保管し、選択年ごとの WorldState・全記録を溜めない。
  const previous = desk.work && { ...desk.work, history: undefined, slice: undefined }
  return { ...desk, work: doc, front: 'work', back: previous ? [...desk.back, previous] : desk.back }
}

function joinObservation(doc: WindowState, history?: HistoryYear, slice?: ObservationSlice): WindowState {
  if (!doc.sourceHistory && history && sameHistoryYearRef(history.ref, doc.ref) && (!doc.history ||
    (doc.history.records.kind !== 'COMMITTED' && doc.history.records.kind !== 'EVALUATION_ONLY' &&
      (history.records.kind === 'COMMITTED' || history.records.kind === 'EVALUATION_ONLY')))) return { ...doc, history, slice, error: undefined }
  return doc
}

function StateDetails({children}: Readonly<{children: ReactNode}>) {
  const [expanded, setExpanded] = useState(false)
  return <details onToggle={event => setExpanded(event.currentTarget.open)}>
    <summary>この年初の状態を詳しく見る</summary>
    {expanded && children}
  </details>
}

export function DeskDocuments({ history, slice, openRequest, historyUpdate, onResolve, onYear, onFilter, onIntervene, interventionDisabled }: DeskDocumentsProps) {
  const [desk, setDesk] = useState<Desk>({ back: [] })
  const serial = useRef(0)
  const seen = useRef<string | undefined>(undefined)
  const workRef = useRef<HTMLElement>(null)
  const fixedRef = useRef<HTMLElement>(null)
  const sliceRef = useMemo(() => slice && historyFromObservation(slice).at(slice.year).ref, [slice])
  const matchingSlice = slice && sliceRef && history && sameHistoryYearRef(sliceRef, history.ref) && history.start.kind === 'CONFIRMED'
    && history.start.world === slice.world && history.records.kind !== 'NOT_LOADED' ? slice : undefined
  useEffect(() => {
    if (!openRequest || seen.current === openRequest.requestId) return
    seen.current = openRequest.requestId
    const doc = { ...openRequest, history: openRequest.history && sameHistoryYearRef(openRequest.ref, openRequest.history.ref) ? openRequest.history : undefined }
    setDesk(d => show(d, doc))
  }, [openRequest])
  useEffect(() => {
    const update = (doc?: WindowState): WindowState | undefined => {
      if (!doc) return undefined
      if (historyUpdate?.requestId === doc.requestId && doc.comparison === historyUpdate.comparison && sameHistoryYearRef(doc.ref, historyUpdate.ref) &&
        (!historyUpdate.history || sameHistoryYearRef(doc.ref, historyUpdate.history.ref))) return { ...doc, ...historyUpdate }
      return joinObservation(doc, history, matchingSlice)
    }
    // 観測・資料の非同期応答を、同じ出典の開いている窓にだけ反映する。
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setDesk(d => {
      const work = update(d.work), fixed = update(d.fixed)
      return work !== d.work || fixed !== d.fixed ? { ...d, work, fixed } : d
    })
  }, [history, matchingSlice, openRequest, historyUpdate])
  const frontId = desk.front === 'fixed' ? desk.fixed?.requestId : desk.work?.requestId
  useEffect(() => {
    if (frontId) (desk.front === 'fixed' ? fixedRef.current : workRef.current)?.focus({ preventScroll: true })
  }, [frontId, desk.front])
  const open = (w: WindowState, target: DocumentTarget, year = w.ref.year) => {
    const ref = { ...w.ref, year }
    const sameYear = year === w.ref.year
    const doc = { requestId: `related:${++serial.current}`, ref, target, source: w.target,
      sourceName: documentPresentation(w.history).name(w.target), history: sameYear ? w.history : undefined,
      slice: sameYear ? w.slice : undefined, sourceHistory: w.sourceHistory, comparison: w.comparison }
    setDesk(d => show(d, joinObservation(doc, history, matchingSlice)))
    onResolve?.(doc)
  }
  const back = () => {
    const previous = desk.back.at(-1)
    if (!previous) return
    const doc = joinObservation({ ...previous, error: undefined, requestId: `back:${++serial.current}` }, history, matchingSlice)
    setDesk(d => ({ ...show({ ...d, work: undefined }, doc), work: d.fixed && sameDocument(d.fixed, doc) ? d.work : doc, back: d.back.slice(0, -1) }))
    onResolve?.(doc)
  }
  const close = (slot: 'work' | 'fixed') => setDesk(d => slot === 'work'
    ? { ...d, work: undefined, back: [], front: d.fixed ? 'fixed' : undefined }
    : { ...d, fixed: undefined, front: d.work ? 'work' : undefined })
  const toggleFixed = (slot: 'work' | 'fixed') => setDesk(d => slot === 'work'
    ? { ...d, fixed: d.work, work: undefined, front: 'fixed' }
    : { ...d, work: d.fixed, fixed: undefined, front: 'work', back: d.work ? [...d.back, { ...d.work, history: undefined, slice: undefined }] : d.back })
  const link = (w: WindowState, target: DocumentTarget, text: string, year = w.ref.year) => <button type="button"
    data-testid={`document-link-${target.kind}-${target.id}`} onClick={() => open(w, target, year)}>{text}</button>
  const content = (w: WindowState, view: ReturnType<typeof documentPresentation>) => {
    const history = w.history
    if (!history || !sameHistoryYearRef(w.ref, history.ref)) return <><p role="status">{w.error ?? '資料は未取得'}</p>
      {onResolve && <button type="button" onClick={() => onResolve(w)}>取得</button>}</>
    const target = w.target
    const observed = w.slice ?? (!w.sourceHistory && history.start.kind === 'CONFIRMED' && matchingSlice?.world === history.start.world ? matchingSlice : undefined)
    if (target.kind === 'ending') {
      const evidence = observed?.digest?.succession.find(e => e.titleId === target.id)
      return evidence ? <SuccessionDocument evidence={evidence} nameOf={id => observed?.digest?.personNames[id] ?? '名前未確認'}
        open={(target, text, year) => link(w, target, text, year)} /> : <p>この領地の継承経緯は未取得です。</p>
    }
    if (target.kind === 'records') return <YearRecordsDocument history={history} open={(target, text) => link(w, target, text)} />
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
        const newbornYear = w.ref.year + 1
        const associations = history.start.kind === 'CONFIRMED'
          ? collectAssociations({ year: e.year, events: [e], traces: [], snapshot: history.start.world }).confirmed : []
        const newborns = newbornYear <= 1350
          ? associations.filter(a => a.role === 'NEWBORN' && a.target.kind === 'PERSON').map(a => a.target.id) : []
        const involved = new Set(e.involvedRefs.flatMap(r => r.kind === 'PERSON_PAIR' ? r.ids : r.kind === 'PERSON' ? [r.id] : []))
        const people = [...new Set(associations.filter(a => a.target.kind === 'PERSON').map(a => a.target.id))].filter(id => {
          const person = history.person(id)
          return !involved.has(id) && (person.kind === 'ALIVE' || person.kind === 'DEAD')
        })
        return <><h4>年内の出来事：{view.eventName(e)}</h4>
          {description?.lines.map((line, i) => <p key={i}>{line}</p>)}
          {!description && <p>この種類の出来事の説明は未対応です。確認できる参照と実状態差分を示します。</p>}
          <ul>{e.involvedRefs.map((r, i) => <li key={i}>{actorLinks(r)}</li>)}</ul>
          {people.length > 0 && <ul aria-label="状態差分などに記録された関連人物">{people.map(id => <li key={id}>{namedLink({kind:'person',id})}</li>)}</ul>}
          {[...new Set(newborns)].map(id => <button type="button" key={id} onClick={() => open(w, {kind: 'person', id}, newbornYear)}>{newbornYear}年初の出生人物の記録を見る</button>)}
          <h4>実判断記録</h4>{e.sourceTraceIds.length ? <ul>{e.sourceTraceIds.map(id => <li key={id}>{namedLink({ kind: 'trace', id })}</li>)}</ul> : <p>参照記録なし</p>}
          {raw(`技術詳細：${e.eventType} の記録・状態差分`, e)}</>
      }
      const found = history.trace(target.id)
      if (found.kind !== 'RECORDED') return <p>{statusText[found.kind] ?? found.kind}</p>
      const t = found.record
      const limited = history.ref.origin.configuration.configIdentity !== undefined
      const pair = t.actorRef.kind === 'PERSON_PAIR' ? t.actorRef.ids : undefined
      const marriage = t.ruleId === 'B-004' || t.ruleId === 'B-005'
      const succession = t.ruleId === 'A-SUC-04'
      const registration = t.ruleId === 'A-LEG-01' && t.reasonCodes.includes('SUPPORTING_REGISTRATION_BUDGET_EXCEEDED')
      const candidateInputs = t.candidates.map(c => c.inputs)
      const inputIds = (single: string, multiple?: string) => [...new Set(candidateInputs.flatMap(inputs => {
        const value = inputs?.[single]
        const values = multiple ? inputs?.[multiple] : undefined
        return [...(typeof value === 'string' ? [value] : []), ...(Array.isArray(values) ? values.filter(v => typeof v === 'string') : [])]
      }))]
      const predecessors = succession ? inputIds('predecessorPersonId') : []
      const heirs = succession ? [...new Set([...inputIds('candidatePersonId', 'proposedHeirPersonIds'), ...inputIds('candidatePersonId', 'candidatePersonIds')])] : []
      const deathEvents = succession ? inputIds('sourceB003EventId', 'sourceB003EventIds') : []
      const deathTraces = succession ? inputIds('sourceB003TraceId') : []
      const b004Sources = t.ruleId === 'B-005' ? inputIds('sourceB004TraceId') : []
      const eligible = pair && pair[0] !== pair[1] && history.start.kind === 'CONFIRMED' &&
        history.ref.origin.branch === 'A0' && !w.sourceHistory && w.ref.year < 1350 &&
        interventionTargetIssue(history.start.world, pair) === null &&
        pair.every(id => history.person(id).kind === 'ALIVE')
      const usedTrust = t.ruleId === 'B-004' && t.candidates.some(c => typeof c.inputs?.effectiveTrust === 'number')
      return <>{(marriage || succession) && <h4>{succession ? '称号の継承' : t.ruleId === 'B-004' ? '婚姻候補の審査' : '婚姻契約の交渉'}</h4>}
        <p>記録された判断：{view.traceStatus(t)}。{reasonSentence(t.reasonCodes)}</p>
        <p>判断の対象：{actorLinks(t.actorRef)}</p>
        {registration && <p>試遊の技術上の登録・追跡枠による保留であり、法的・政治的な拒否ではありません。この枠は介入で変更できません。</p>}
        {succession && <>
          <p>後継者や継承結果を直接変更する介入はありません。前の保持者・候補の実記録から、家系や過去の婚姻・候補判断を調べられます。</p>
          {predecessors.map(id => <p key={id}>前の保持者：{namedLink({kind:'person',id})}{' '}{link(w, {kind:'family',id}, '家系を開く')}</p>)}
          {deathEvents.map(id => <p key={id}>{link(w,{kind:'event',id},'継承判断が参照した死亡記録を開く')}</p>)}
          {deathTraces.map(id => <p key={id}>{link(w,{kind:'trace',id},'継承判断が参照した死亡の判断を開く')}</p>)}
          {heirs.length > 0 && <ul aria-label="記録に挙がった継承候補">{heirs.map(id => <li key={id}>{namedLink({kind:'person',id})}{' '}{link(w,{kind:'family',id},'家系を開く')}</li>)}</ul>}
        </>}
        {marriage && pair && <>
          {limited && <RelationshipBasis history={history} left={pair[0]} right={pair[1]} />}
          <RecordedTrust trace={t} />
          <RecordedNegotiation trace={t} nameOf={id => view.name({kind:'person',id})}
            dynastyOf={id => history.start.kind === 'CONFIRMED' ? history.start.world.legal.dynasties.find(d => d.dynastyId === id)?.name : undefined} />
          {b004Sources.map(id => <p key={id}>{link(w,{kind:'trace',id},'この交渉が参照した婚姻候補の審査を開く')}</p>)}
          <p>{usedTrust ? 'この審査が参照した項目のうち、2人の信頼は調整できます。閾値や法的承認は直接変更できません。'
            : t.ruleId === 'B-005' ? '交渉結果を直接指定する介入はありません。交渉が参照した得点と信頼の関係は、元の候補審査で確認できます。'
            : 'この記録では実効信頼を使った比較を確認できません。'}</p>
          {usedTrust && eligible && onIntervene && <button type="button" disabled={interventionDisabled}
            onClick={() => onIntervene(w.ref.year,pair[0],pair[1],w.ref,{history,traceId:t.traceId})}>
            {w.ref.year}年のこの2人の信頼を介入として検討する
          </button>}
          {usedTrust && !eligible && <p>{w.sourceHistory || history.ref.origin.branch !== 'A0' ? 'この資料は参照専用です。' : 'この年初の2人は、ここからの介入対象にできません。'}</p>}
        </>}
        {history.records.kind === 'COMMITTED' && history.records.coverage.kind === 'TRANSFER_OMISSION' &&
          <p>転送省略あり。関連記録をすべて取得したとは限りません。</p>}
        <h4>関連Event</h4>{t.eventIds.length ? <ul>{t.eventIds.map(id => <li key={id}>{namedLink({ kind: 'event', id })}</li>)}</ul> : <p>Event参照なし</p>}
        {raw(`技術詳細（実判断: ${t.ruleId} / ${t.status}）`, t)}</>
    }
    if (history.start.kind !== 'CONFIRMED') return <p>{statusText[history.start.kind] ?? history.start.kind}</p>
    const world = history.start.world
    const index = view.index!
    const stateDetail = (selection: Selection) => <StateDetails>
      <InspectorDetail selection={selection} source={{world,label:'資料',experimental:true,events:[],traces:[]}} index={index} onSelect={t => open(w,t)} />
    </StateDetails>
    const relatedRecords = history.records.kind === 'COMMITTED' ? history.records : undefined
    const { events = [], traces = [] } = view.related(target) ?? {}
    const personNames = observed && (target.kind === 'person' || target.kind === 'family' ||
      (target.kind === 'title' && history.ref.origin.configuration.configIdentity !== undefined))
      ? personDisplayNames([...world.persons, ...observed.personRecords]) : view.names.person
    const personHistory = observed && target.kind === 'person' && <PersonHistory
      records={observed.personRecords} personId={target.id} currentYear={w.ref.year} nameOf={personNames}
      onFocusPerson={(id, year) => open(w, { kind: 'person', id }, year)} onOpenEvent={(id, year) => open(w, { kind: 'event', id }, year)}
      onOpenTrace={(id, year) => open(w, { kind: 'trace', id }, year)} onYear={year => open(w, w.target, year)}
      onSelectTitle={(id, year) => open(w, { kind: 'title', id }, year)}
      onReviewIntervention={onIntervene && !w.sourceHistory && !interventionDisabled ? (judgment, personId, partnerId) => {
        if (judgment.fromYear === w.ref.year) onIntervene(w.ref.year, personId, partnerId, w.ref, {history})
        else open(w, {kind:'trace',id:judgment.firstTraceId}, judgment.fromYear)
      } : undefined} />
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
          facts = <><p>{person.birthYear}年生・{person.alive ? `年初 ${w.ref.year - person.birthYear}歳（存命）` : `年初は死亡済み${person.deathYear === null ? '' : `（${person.deathYear}年没）`}`}。</p>
            <p>法的王朝：{person.legalDynasty.status === 'DETERMINED' ? world.legal.dynasties.find(d => person.legalDynasty.status === 'DETERMINED' && d.dynastyId === person.legalDynasty.dynastyId)?.name ?? '名称未確認' : '未確定'}</p>
            <p>出身集団：{group ? namedLink({ kind: 'group', id: group.groupId }) : '記録未確認'}</p>
            <p>年初の保持称号：{titles.length ? titles.map(t => <span key={t.titleId}>{namedLink({ kind: 'title', id: t.titleId })}</span>) : '記録なし'}</p>
            {link(w, { kind: 'family', id: target.id }, '家系を開く')}
            {!w.sourceHistory && observed && onIntervene && person.alive && person.interactionRole !== 'SUPPORTING' && w.ref.year < 1350 &&
              <button type="button" disabled={interventionDisabled} onClick={() => onIntervene(w.ref.year, person.personId, undefined, w.ref, {history})}>この人物と年から介入を検討する</button>}
            {history.ref.origin.configuration.configIdentity !== undefined && <PersonRelationship key={w.partner?.serial} history={history} personId={target.id}
              partner={w.partner?.id} nameOf={id => personNames(id) ?? view.name({ kind: 'person', id })} onTrace={t => open(w, { kind: 'trace', id: t.traceId })}
              onIntervene={!w.sourceHistory && observed && onIntervene && !interventionDisabled && person.interactionRole !== 'SUPPORTING' && w.ref.year < 1350 ?
                id => onIntervene(w.ref.year, person.personId, id, w.ref, {history}) : undefined} />}
            {observed && <A0FutureContext observation={observed} personId={target.id}
              onYearSelect={year => open(w, target, year)} onTitleSelect={id => open(w, {kind:'title',id})} />}
            {personHistory && <details><summary>生涯の婚姻・称号・過去の判断を調べる</summary>{personHistory}</details>}
            {stateDetail({kind:'person',id:target.id})}{raw('技術詳細：人物の年初状態', person)}</>
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
          <p>所属地域：{namedLink({ kind: 'region', id: group.regionId })}</p>{stateDetail(target)}{raw('技術詳細：集団の年初状態', group)}</>
        break
      }
      case 'region': {
        const region = index.region(target.id)
        if (region) facts = <><p>上位主権：{namedLink({ kind: 'country', id: region.sovereignCountryId })}</p>
          <p>地域の集団：</p><ul>{world.groups.filter(g => g.regionId === region.regionId).map(g => <li key={g.groupId}>{namedLink({ kind: 'group', id: g.groupId })}</li>)}</ul>
          {stateDetail(target)}{raw('技術詳細：地域の年初状態', region)}</>
        break
      }
      case 'title': {
        const title = index.title(target.id)
        const succession = relatedRecords?.traces.filter(t => t.ruleId === 'A-SUC-04' &&
          t.candidates.some(c => c.inputs?.titleId === target.id))
        const titleHistory = observed?.titleHistories.find(h => h.titleId === target.id)
        const ending = endingHolderEvidence(titleHistory, observed?.titleLossRecords.find(l => l.titleId === target.id), observed?.counts[0]?.year, 1350)
        const loss = ending.kind === 'LOST' ? ending.loss : undefined
        if (title || titleHistory) facts = <>{title ? <><p>{title.kind === 'CROWN' ? '王冠称号' : '領地称号'}</p><p>年初の保持者：{title.holder.status === 'HELD' ? namedLink({ kind: 'person', id: title.holder.personId }) : '未確定'}</p>
          {stateDetail(target)}{raw('技術詳細：称号の年初状態', title)}</> : <p>この年初に称号の記録はありません。</p>}
          {!!succession?.length && <div><h4>{w.ref.year}年内の継承判断</h4><p className="note">年初の保持状況とは別の時点の記録です。</p><ul>{succession.map(t => <li key={t.traceId}>
            {link(w, { kind: 'trace', id: t.traceId }, `${view.traceStatus(t)}：${reasonSentence(t.reasonCodes)}`)}
            {t.eventIds.length === 0 && '（関連Eventなし）'}</li>)}</ul></div>}
          {titleHistory && <section aria-label="1350年初までの原史の称号履歴">
            <h4>1350年初までの原史の称号履歴</h4>
            {loss && <>
              <p>1350年初には保持者を確認できません。最後に保持が確認された人物：<button type="button" onClick={() => open(w, { kind: 'person', id: loss.lastHolderId }, loss.heldFromYear)}>
                {personNames(loss.lastHolderId) ?? '名前未確認の保持者'}（{loss.heldFromYear}年初）</button>。</p>
              {loss.transferEventId !== undefined && loss.transferYear !== undefined && <button type="button"
                onClick={() => open(w,{kind:'event',id:loss.transferEventId!},loss.transferYear)}>{loss.transferYear}年内の移転記録</button>}
              {w.ref.year === loss.lostFromYear && <p><button type="button" onClick={() => open(w, target, loss.lostFromYear - 1)}>
                年初の変化に先立つ{loss.lostFromYear - 1}年の称号資料を調べる
              </button></p>}
              {w.ref.year !== loss.lostFromYear && <button type="button" onClick={() => open(w, target, loss.lostFromYear)}>
                保持者が未確定になった{loss.lostFromYear}年初の称号と判断を見る
              </button>}
            </>}
            <details><summary>歴代の保持者（{titleHistory.intervals.length}期間）</summary><ol>{titleHistory.intervals.map(i => {
              const holder = i.holder
              return <li key={i.fromYear}>{i.fromYear}{i.fromYear !== i.throughYear && `〜${i.throughYear}`}年初：{holder.status === 'HELD'
                ? <><button type="button" onClick={() => open(w, {kind:'person',id:holder.personId}, i.fromYear)}>{personNames(holder.personId) ?? holder.personName}</button>
                  {holder.life === 'DEAD' ? '（故人の名義が残る）' : holder.life === 'UNKNOWN' ? '（生死未確認）' : ''}</>
                : holder.status === 'UNDETERMINED' ? '保持者未確定' : '称号の記録なし'}{' '}
                <button type="button" onClick={() => open(w,target,i.fromYear)}>その年の称号資料を開く</button></li>
            })}</ol></details>
            {!!titleHistory?.transfers.length && <details><summary>歴代の称号移転（{titleHistory.transfers.length}件）</summary>
              <ul>{titleHistory.transfers.map(e => <li key={e.eventId}><button type="button" onClick={() => open(w, { kind: 'event', id: e.eventId }, e.year)}>
                {e.year}年の移転と判断を開く</button></li>)}</ul>
            </details>}
          </section>}</>
        break
      }
    }
    return <><h4>年初の実記録</h4>{facts ?? <p>年初に参照した対象の記録がありません。</p>}
      <details><summary>選択年の実Event・判断（取得分 {events.length + traces.length}件）</summary>{relatedRecords ? <>
        {relatedRecords.coverage.kind === 'TRANSFER_OMISSION' && <p>転送省略あり。表示は取得済み記録のみ。</p>}
        {events.map(e => <div key={e.eventId}>{namedLink({ kind: 'event', id: e.eventId })}</div>)}
        {traces.map(t => <div key={t.traceId}>{namedLink({ kind: 'trace', id: t.traceId })}</div>)}
        {!events.length && !traces.length && <p>取得範囲に関連記録なし。関係や判断の不存在は意味しません。</p>}
      </> : <p>{statusText[history.records.kind] ?? history.records.kind}</p>}</details></>

  }
  return <>{(['work', 'fixed'] as const).map(slot => {
    const w = desk[slot]
    if (!w) return null
    const view = documentPresentation(w.history)
    const indexed = !['trace', 'event'].includes(w.target.kind) || w.slice?.digest?.chronicle.some(r => r.kind === w.target.kind && r.id === w.target.id)
    const otherSlot = slot === 'work' ? 'fixed' : 'work'
    const other = desk[otherSlot]
    const canPair = w.target.kind === 'person' && other?.target.kind === 'person' && w.target.id !== other.target.id &&
      w.comparison === other.comparison && sameHistoryYearRef(w.ref, other.ref) && w.history?.person(w.target.id).kind === 'ALIVE'
    return <section key={w.requestId} ref={slot === 'work' ? workRef : fixedRef} tabIndex={-1} role="dialog" aria-label={`${labels[w.target.kind]} ${view.name(w.target)}`}
      data-testid="desk-document" data-slot={slot} data-kind={w.target.kind} data-target={w.target.id} className={`desk-document desk-document-${slot}`}
      onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); close(slot) } }}>
      <header><strong>{slot === 'fixed' && '固定 · '}{labels[w.target.kind]}：{view.name(w.target)}</strong>
        {slot === 'work' && desk.back.length > 0 && <button type="button" onClick={back}>戻る</button>}
        {(slot === 'fixed' || !desk.fixed) && <button type="button" disabled={!w.history} onClick={() => toggleFixed(slot)}>{slot === 'work' ? '固定' : '解除'}</button>}
        <button type="button" aria-label="資料を閉じる" onClick={() => close(slot)}>閉じる</button></header>
      <div className="desk-document-body" key={w.requestId}>
        <p className="note">{w.target.kind === 'ending' ? '結末の評価時点：' : '資料の参照年：'}<span data-testid="document-reference">{w.ref.origin.branch} / {w.ref.year}年 / seed {w.ref.origin.seed}</span></p>
        {w.source && <p className="note">参照元: {labels[w.source.kind]}：{w.sourceName ?? view.name(w.source)}</p>}
        {!w.sourceHistory && w.history?.start.kind === 'CONFIRMED' && onYear && history && !sameHistoryYearRef(w.ref, history.ref) &&
          <button type="button" onClick={() => onYear(w.ref)}>{w.ref.year}年へ移動</button>}
        {w.history?.start.kind === 'CONFIRMED' && onFilter && w.target.kind !== 'records' && w.target.kind !== 'ending' && (w.sourceHistory || indexed) &&
          <button type="button" onClick={() => onFilter(w.target, w.ref, w.sourceHistory)}>{w.sourceHistory ? '比較で絞る' : '年代記で絞る'}</button>}
        {canPair && <button type="button" onClick={() => {
          const serialNo = ++serial.current
          setDesk(d => ({ ...d, front: otherSlot, [otherSlot]: { ...other, partner: { id: w.target.id, serial: serialNo } } }))
        }}>{documentPresentation(other.history).name(other.target)}の信頼相手にする</button>}
        {content(w, view)}
        {w.history && w.history.records.kind !== 'COMMITTED' && w.history.records.kind !== 'EVALUATION_ONLY' && onResolve &&
          <button type="button" onClick={() => onResolve(w)}>取得</button>}
        <details><summary>出典</summary>対象ID {w.target.id}{w.source && <> / 参照元ID {w.source.id}</>} / {w.ref.origin.configuration.configId ?? '構成未確認'} / {w.ref.origin.configuration.configDigest ?? 'digest未確認'} / 介入 {w.ref.origin.modifierIds.join(', ') || 'なし'}</details>
      </div>
    </section>
  })}</>
}
