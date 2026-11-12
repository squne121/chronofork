import { useMemo, useState } from 'react'
import type { ObservationSlice } from '../branch-play-source.ts'
import type { PlayProgress } from '../play-progress.ts'
import { associationsFor, collectAssociations } from './associations.ts'
import { FamilyTree } from './FamilyTree.tsx'
import { eventHeadline, namesOf, EVENT_CATEGORIES, inCategory } from '../integrated-overview.ts'
import { describeEvent, shortPersonName } from '../event-summary.ts'
import type { EventLogEntry, DecisionTrace, Id } from '../../simulation/contracts/index.ts'
import './observation.css'

type Props = Readonly<{
  observation?:ObservationSlice
  loading:boolean
  progress?:PlayProgress
  error?:Readonly<{code:string;message:string}>
  seedText:string
  onSeedText:(text:string)=>void
  onReset:()=>void
  onLoad:(year:number)=>void
  onCancel:()=>void
  onIntervene:(year:number,personId:string)=>void
}>

const EVENT_LABELS:Readonly<Record<string,string>>={
  PERSON_BIRTH:'出生',MARRIAGE_REGISTER:'婚姻',LEGAL_TITLE_TRANSFER:'称号移転',
  LEGAL_DYNASTY_SET:'法的王朝帰属',PERSON_DEATH:'死亡',
}
const labelOf=(type:string)=>EVENT_LABELS[type]??type
const SHOW=35
const reason=(codes:readonly string[])=>codes.length?codes.join('、'):'理由コードの記録なし'

/** PR-2: 介入前の原史A0を、証拠のある履歴だけで調べる。WorldStateは選択年の年初。 */
export function ObservationPanel(p:Props){
  const v=p.observation
  const seedValid=/^\d+$/.test(p.seedText.trim())&&Number.isSafeInteger(Number(p.seedText.trim()))&&Number(p.seedText.trim())>=0
  const seedMatches=v!==undefined&&v.seed===Number(p.seedText.trim())&&seedValid
  const [selectedPerson,setSelectedPerson]=useState('')
  const [selectedTitle,setSelectedTitle]=useState('')
  const [eventId,setEventId]=useState('')
  const [traceId,setTraceId]=useState('')
  const [eventType,setEventType]=useState('ALL')
  const [traceFilter,setTraceFilter]=useState('EVENTLESS')
  const [relatedOnly,setRelatedOnly]=useState(false)
  const [eventLimit,setEventLimit]=useState(SHOW)
  const [traceLimit,setTraceLimit]=useState(SHOW)
  const [showAllEvents,setShowAllEvents]=useState(false)
  const [yearHintLimit,setYearHintLimit]=useState(8)
  const persons=useMemo(()=>v?.world.persons.filter(x=>x.birthYear<=v.year)??[],[v])
  const person=persons.some(x=>x.personId===selectedPerson)?selectedPerson:
    (persons.find(x=>x.interactionRole!=='SUPPORTING')??persons[0])?.personId??''
  const associations=useMemo(()=>v?collectAssociations({
    year:v.year,events:v.events,traces:v.traces,snapshot:v.world,
  }):undefined,[v])
  const refs=useMemo(()=>associationsFor(associations?.confirmed??[],{kind:'PERSON',id:person}),
    [associations,person])
  const eventRefs=new Set(refs.filter(x=>x.source.type==='EVENT').map(x=>(x.source as {eventId:string}).eventId))
  const traceRefs=new Set(refs.filter(x=>x.source.type==='TRACE').map(x=>(x.source as {traceId:string}).traceId))
  const names=useMemo(()=>namesOf(v?.world),[v])
  const eventKind=(e:EventLogEntry)=>EVENT_CATEGORIES.find(c=>inCategory(e,c))?.label??labelOf(e.eventType)
  const readableEvent=(e:EventLogEntry)=>eventHeadline(e,names,eventKind(e))
  const isPeopleTitleEvent=(e:EventLogEntry)=>EVENT_CATEGORIES.some(c=>inCategory(e,c))
  const yearHints=(v?.counts??[]).filter(c=>(c.focusEvents??0)>0)
  const types=[...new Set(v?.events.map(e=>e.eventType)??[])].sort()
  const events=(v?.events??[]).filter(e=>(eventType==='ALL'||e.eventType===eventType)&&
    (showAllEvents||eventType!=='ALL'||isPeopleTitleEvent(e))&&(!relatedOnly||eventRefs.has(e.eventId)))
  const traces=(v?.traces??[]).filter(t=>(traceFilter==='ALL'||
    traceFilter==='EVENTLESS'&&t.eventIds.length===0&&(t.status==='DEFER'||t.status==='REJECT')||
    traceFilter===t.status)&&(!relatedOnly||traceRefs.has(t.traceId)))
  const chosenEvent=v?.events.find(x=>x.eventId===eventId)
  const chosenTrace=v?.traces.find(x=>x.traceId===traceId)
  const sourcePersonIds=(e:EventLogEntry)=>(associations?.confirmed??[])
    .filter(a=>a.source.type==='EVENT'&&a.source.eventId===e.eventId&&a.target.kind==='PERSON')
    .map(a=>a.target.id)
    .filter((id,i,all)=>all.indexOf(id)===i)
  const evidencePersons=chosenEvent?sourcePersonIds(chosenEvent)
    .filter(id=>persons.some(x=>x.personId===id)):[]
  const chooseEvent=(e:EventLogEntry)=>{
    setEventId(e.eventId);setTraceId('')
    const first=sourcePersonIds(e).find(id=>persons.some(x=>x.personId===id))
    if(first)setSelectedPerson(first)
  }
  const traceActor=(t:DecisionTrace)=>{
    const label=(id:Id)=>shortPersonName(persons.find(x=>x.personId===id)?.name??id)
    return t.actorRef.kind==='PERSON_PAIR'?t.actorRef.ids.map(label).join(' と ')
      :t.actorRef.kind==='PERSON'?label(t.actorRef.id):'人物以外の対象'
  }
  const statusText=(status:string)=>status==='ACCEPT'?'採用':status==='DEFER'?'保留':
    status==='REJECT'?'不採用':status
  const title=v?.world.titles.find(x=>x.titleId===selectedTitle)
  // 実stateChangeにTitle IDがあるEvent、または根拠付きAssociationだけを関連として表示する。
  const titleEvidenceIds=new Set((associations?.confirmed??[])
    .filter(a=>a.titleId===selectedTitle&&a.source.type==='EVENT')
    .map(a=>a.source.type==='EVENT'?a.source.eventId:''))
  const titlePrefix=title?'$.titles['+title.titleId+']':''
  const titleEvents=title?(v?.events??[]).filter(e=>titleEvidenceIds.has(e.eventId)||
    e.stateChanges.some(c=>c.path===titlePrefix||c.path.startsWith(titlePrefix+'.'))):[]
  const titleTraces=title?(v?.traces??[]).filter(t=>
    titleEvents.some(e=>e.sourceTraceIds.includes(t.traceId)&&t.eventIds.includes(e.eventId))):[]
  const openTitleEvent=(id:string)=>{setEventId(id);setTraceId('');setEventType('ALL');setRelatedOnly(false)}
  const openTitleTrace=(id:string)=>{setTraceId(id);setEventId('');setTraceFilter('ALL');setRelatedOnly(false)}
  const goal=v?.technicalGoal
  const assessments=(goal?.status==='NOT_ACHIEVED'||goal?.status==='ACHIEVED')?goal.assessments:[]
  const yearChange=(y:number)=>{
    setEventId('');setTraceId('');setSelectedTitle('');setEventType('ALL');setEventLimit(SHOW);setTraceLimit(SHOW)
    p.onLoad(y)
  }
  return <section className="panel obs" aria-labelledby="obs-heading" data-testid="observation-main">
    <header className="obs-head">
      <div>
        <p className="obs-eyebrow">亡国の王冠 — 1250〜1350年</p>
        <h2 id="obs-heading">原史A0を観測する</h2>
        <p className="obs-question">1350年、ナルヴェン王朝には合法な世襲所領が残るのか？</p>
        <p className="note">歴史がどう動くかを見て、人物・婚姻・土地称号（Title）と判断の記録を辿ります。調べた人物から介入を試せます。</p>
        {!v&&!p.loading&&<p className="obs-guidance" data-testid="obs-intro">まだ原史の計算結果は表示していません。下のボタンで1250〜1350年の世界を計算します。</p>}
        <p className="note">試験構成（EXPERIMENTAL / CALIBRATION_ONLY）。1350年の技術判定は正式な勝敗ではありません（goal=null）。</p>
      </div>
      <div className="obs-seed-tools">
        <label htmlFor="obs-seed-input">統合A0のseed
          <input id="obs-seed-input" data-testid="obs-seed-input" type="text" inputMode="numeric"
            value={p.seedText} disabled={p.loading} aria-invalid={!seedValid}
            onChange={e=>p.onSeedText(e.target.value)}/>
        </label>
        <button type="button" className="cta" data-testid="obs-start"
          onClick={()=>{setEventType('ALL');p.onLoad(v?.year??1250)}} disabled={p.loading||!seedValid}>
          {!v?'統合A0を計算して観測':seedMatches?'このseedの原史A0を再表示':'このseedで原史A0を計算'}
        </button>
        {v&&<button type="button" data-testid="obs-reset" disabled={p.loading} onClick={p.onReset}>旧試験画面へ戻る</button>}
        {!seedValid&&<span className="missing" role="alert">seedは0以上の安全な整数で指定してください。</span>}
        {v&&!seedMatches&&<p role="status" data-testid="obs-seed-mismatch">
          表示中の原史はseed {v.seed}です。入力seedが異なるため、再観測するまでこの結果から介入できません。
        </p>}
        {v&&seedMatches&&<p className="note" data-testid="obs-seed-active">観測中の原史seed {v.seed}</p>}
      </div>
    </header>
    {p.loading&&<div role="status" data-testid="obs-loading">
      <p>原史A0の確定データを取得中です。計算が完了するまで未来の結果を表示しません。</p>
      {p.progress&&<p data-testid="obs-progress">{p.progress.confirmedYear}年初まで計算済み（A0 {p.progress.transitionsDone}/{p.progress.transitionsTotal}年分）。</p>}
      <button type="button" onClick={p.onCancel} data-testid="obs-cancel">観測の取得を中止</button>
    </div>}
    {p.error&&<p role="alert" data-testid="obs-error">観測に失敗しました（{p.error.code}）。{p.error.message}</p>}
    {v&&<div className="obs-body">
      <div className="obs-year-nav">
        <label htmlFor="obs-year">年表・観測する年（年初）</label>
        <input id="obs-year" type="range" min={1250} max={1350} step={1} value={v.year}
          disabled={p.loading||!seedMatches} aria-valuetext={v.year+'年'} onChange={e=>yearChange(Number(e.target.value))}/>
        <output data-testid="obs-year-label">{v.year}年初</output>
        <div className="obs-year-controls">
          <button type="button" disabled={p.loading||!seedMatches||v.year<=1250} onClick={()=>yearChange(v.year-1)}>前年</button>
          <button type="button" disabled={p.loading||!seedMatches||v.year>=1350} onClick={()=>yearChange(v.year+1)}>翌年</button>
          <span data-testid="obs-cache-source">A0：{v.a0Source==='REUSED'?'保存済みの原史を再利用':'この条件で実計算済み'}</span>
        </div>
        <section className="obs-year-hints" data-testid="obs-year-hints">
          <h3>人物・家系・所領の記録がある年から探す</h3>
          <p className="note">実Eventに該当種別が記録された年を年代順に示します。重要度の順位ではありません。</p>
          {yearHints.length===0?<p className="note">この原史で該当年の記録は確認できません。</p>:<>
            <div className="obs-year-jumps">
              {yearHints.slice(0,yearHintLimit).map(c=><button type="button" key={c.year}
                disabled={p.loading||!seedMatches} data-testid={'obs-hint-year-'+c.year}
                onClick={()=>yearChange(c.year)}>{c.year}年・人物/所領 {c.focusEvents}件</button>)}
            </div>
            {yearHints.length>yearHintLimit&&<button type="button" className="obs-more" onClick={()=>setYearHintLimit(n=>n+12)}>
              残り{yearHints.length-yearHintLimit}年の候補を見る
            </button>}
          </>}
        </section>
        <details>
          <summary>すべての年の記録件数を見る（Event・Trace）</summary>
          <div className="obs-year-jumps">
            {v.counts.map(c=><button type="button" key={c.year} disabled={p.loading||!seedMatches}
              aria-current={c.year===v.year?'date':undefined}
              onClick={()=>yearChange(c.year)}>{c.year}年・事件{c.events}／判断{c.traces}</button>)}
          </div>
        </details>
      </div>
      <div className="obs-goal" data-testid="obs-goal">
        <h3>1350年の王朝存続条件（技術判定）</h3>
        <p>正式勝敗：未成立。技術判定：{goal?.status??'記録なし'}（介入前のA0、1350年初の実状態）</p>
        {assessments.length>0&&<details open>
          <summary>Title別の不足条件と根拠</summary>
          <ul>{assessments.map(a=><li key={a.titleId}>
            <strong>{a.titleId}</strong>：{a.qualifies?'条件に一致':reason(a.failures)}
          </li>)}</ul>
        </details>}
        {goal?.status==='INVALID_INPUT'&&<p>計算結果の技術評価はデータ不正のため成立していません。</p>}
      </div>
      <div className="obs-two-col">
        <div className="obs-timeline">
          <h3>年表・{v.year}年に記録された出来事</h3>
          <p className="note">最初は、婚姻・出生・死亡・王朝帰属・土地Titleなどの確定記録だけを示します。人口等の記録も下で確認できます。</p>
          <label>Event種別
            <select data-testid="obs-event-type" value={eventType} onChange={e=>{setEventType(e.target.value);setEventLimit(SHOW)}}>
              <option value="ALL">全種類</option>
              {types.map(x=><option key={x} value={x}>{labelOf(x)}</option>)}
            </select>
          </label>
          <label className="obs-check">
            <input type="checkbox" checked={relatedOnly} onChange={e=>setRelatedOnly(e.target.checked)}/>
            選択人物に根拠のある記録だけ
          </label>
          <label className="obs-check">
            <input type="checkbox" data-testid="obs-all-events" checked={showAllEvents}
              onChange={e=>{setShowAllEvents(e.target.checked);setEventLimit(SHOW)}}/>
            人口などを含む全Eventを表示
          </label>
          <p className="note" data-testid="obs-event-count">この年の確定Event {v.events.length}件／表示 {events.length}件。
            年初の人物状態とは時点が異なります。非表示の記録も削除していません。</p>
          <ol className="obs-record-list" data-testid="obs-event-list">
            {events.slice(0,eventLimit).map(e=><li key={e.eventId}>
              <button type="button" aria-pressed={eventId===e.eventId} onClick={()=>chooseEvent(e)}>
                {readableEvent(e)}
              </button>
            </li>)}
          </ol>
          {events.length>eventLimit&&<button type="button" onClick={()=>setEventLimit(n=>n+SHOW)}>Eventをさらに表示</button>}
          {chosenEvent&&<div className="obs-record-detail" data-testid="obs-event-detail">
            <h4>{readableEvent(chosenEvent)}</h4>
            {describeEvent(chosenEvent,names)?.lines.map(line=><p key={line}>{line}</p>)}
            <p>実際の状態変化 {chosenEvent.stateChanges.length}件。関係する人物と記録上の判断だけを辿れます。</p>
            {evidencePersons.length>0&&<div className="obs-related-links" data-testid="obs-event-people">
              {evidencePersons.map(id=><button type="button" key={id} onClick={()=>setSelectedPerson(id)}>
                {shortPersonName(persons.find(x=>x.personId===id)!.name)}の家系を見る
              </button>)}
            </div>}
            {chosenEvent.sourceTraceIds.length===0
              ?<p className="note">このEventに直接紐づくDecisionTraceは記録されていません。</p>
              :<div data-testid="obs-event-reasons">
                <h4>この出来事につながる判断の記録</h4>
                {chosenEvent.sourceTraceIds.map(id=>{
                  const t=v.traces.find(x=>x.traceId===id)
                  return <p key={id}>{t
                    ?<><strong>{statusText(t.status)}</strong> — {traceActor(t)}／判断規則 {t.ruleId}
                      <button type="button" onClick={()=>{setTraceId(id);setTraceFilter('ALL')}}>根拠を詳しく見る</button></>
                    :<>参照された判断 {id} の詳細は、この年の表示にはありません</>}</p>
                })}
              </div>}
            <details><summary>検証用：Eventの出典・実状態差分（{chosenEvent.eventType}）</summary>
              <pre>{JSON.stringify(chosenEvent,null,2)}</pre></details>
          </div>}
          <h3>DecisionTrace（実際の採否・判断根拠）</h3>
          <label>判断種別
            <select data-testid="obs-trace-filter" value={traceFilter} onChange={e=>{setTraceFilter(e.target.value);setTraceLimit(SHOW)}}>
              <option value="EVENTLESS">EventなしのDEFER・REJECT</option>
              <option value="ALL">全判断</option>
              <option value="DEFER">DEFER</option>
              <option value="REJECT">REJECT</option>
              <option value="ACCEPT">ACCEPT</option>
            </select>
          </label>
          <p className="note" data-testid="obs-trace-count">この年のTrace {v.traces.length}件／表示条件に一致 {traces.length}件。Eventのない判断も含みます。</p>
          <ol className="obs-record-list" data-testid="obs-trace-list">
            {traces.slice(0,traceLimit).map(t=><li key={t.traceId}>
              <button type="button" aria-pressed={traceId===t.traceId} onClick={()=>{setTraceId(t.traceId);setEventId('')}}>
                {statusText(t.status)}／{traceActor(t)}（規則 {t.ruleId}・{t.status}、Event {t.eventIds.length}件）
              </button>
            </li>)}
          </ol>
          {traces.length>traceLimit&&<button type="button" onClick={()=>setTraceLimit(n=>n+SHOW)}>Traceをさらに表示</button>}
          {chosenTrace&&<div className="obs-record-detail" data-testid="obs-trace-detail">
            <h4>{traceActor(chosenTrace)}についての判断：{statusText(chosenTrace.status)}</h4>
            <p>規則 {chosenTrace.ruleId}（{chosenTrace.status}）。記録された理由：{reason(chosenTrace.reasonCodes)}</p>
            <p>実際に関連づくEvent：{chosenTrace.eventIds.length}件。記録されていない事件は補いません。</p>
            <div className="obs-related-links">{chosenTrace.eventIds.map(id=><button type="button" key={id}
              onClick={()=>{setEventId(id);setEventType('ALL')}}>関連Eventを開く</button>)}</div>
            <details><summary>DecisionTraceの詳細</summary><pre>{JSON.stringify(chosenTrace,null,2)}</pre></details>
          </div>}
        </div>
        <aside className="obs-person">
          <h3>この年の人物・法的関係</h3>
          <label>調べる人物
            <select data-testid="obs-person" value={person} onChange={e=>{setSelectedPerson(e.target.value);setSelectedTitle('')}}>
              {persons.map(x=><option value={x.personId} key={x.personId}>{shortPersonName(x.name)}（{x.birthYear}年生）</option>)}
            </select>
          </label>
          {person&&<FamilyTree world={v.world} personId={person} onSelectPerson={setSelectedPerson} onSelectTitle={setSelectedTitle}/>}
          <label>調べるTitle（選択年初の記録）
            <select data-testid="obs-title-select" value={title?.titleId??''} onChange={e=>setSelectedTitle(e.target.value)}>
              <option value="">選択してください</option>
              {v.world.titles.map(t=><option key={t.titleId} value={t.titleId}>{t.titleId}</option>)}
            </select>
          </label>
          {title&&<div data-testid="obs-title-detail">
            <h4>選択したTitle：{title.titleId}</h4>
            <p>種類：{title.kind}／有効：{title.valid?'はい':'いいえ'}／承認：{title.recognition.status}</p>
            <p>保持と合法的な王朝存続判定は別の条件です。上段の1350年技術判定と、以下の選択年の実記録を区別してください。</p>
            <p className="note">Title IDへの直接の根拠があるEvent {titleEvents.length}件、双方向参照が一致するTrace {titleTraces.length}件。</p>
            {titleEvents.length===0&&<p className="note">この年の記録では直接の変化・関連を確認できません。何も起きなかったとは断定しません。</p>}
            {titleEvents.length>0&&<ul>{titleEvents.map(e=><li key={e.eventId}>
              <button type="button" data-testid="obs-title-event-link" onClick={()=>openTitleEvent(e.eventId)}>
                {e.year}年 {labelOf(e.eventType)}（Event）
              </button>
            </li>)}</ul>}
            {titleTraces.length>0&&<ul>{titleTraces.map(t=><li key={t.traceId}>
              <button type="button" data-testid="obs-title-trace-link" onClick={()=>openTitleTrace(t.traceId)}>
                {t.ruleId}・{t.status}（DecisionTrace）
              </button>
            </li>)}</ul>}
          </div>}
          {person&&v.year<1350&&persons.find(x=>x.personId===person)?.interactionRole!=='SUPPORTING'&&
            <button type="button" className="cta" data-testid="obs-to-intervention" disabled={!seedMatches||p.loading} onClick={()=>p.onIntervene(v.year,person)}>
              この人物と年から介入を検討する
            </button>}
          <p className="note">介入は既存の人物間信頼調整のみです。対象者の適格性・成立・歴史変化は保証しません。</p>
        </aside>
      </div>
    </div>}
  </section>
}
