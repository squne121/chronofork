import { useEffect, useEffectEvent, useMemo, useState } from 'react'
import { titleLabel } from './title-history.ts'
import { A0FutureContext } from './A0FutureContext.tsx'
import type { ObservationMode, ObservationSlice } from '../branch-play-source.ts'
import type { CalcInfo } from '../IntegratedOverview.tsx'
import type { PlayProgress } from '../play-progress.ts'
import { associationsFor, collectAssociations } from './associations.ts'
import { FamilyTree } from './FamilyTree.tsx'
import { PersonHistory } from './PersonHistory.tsx'
import { personDisplayNames } from './person-display.ts'
import { reasonSentence, reasonView } from './reason-labels.ts'
import { Inspector } from '../Inspector.tsx'
import { RegionMap } from '../RegionMap.tsx'
import { indexWorld } from '../inspection-source.ts'
import type { EntityKind, InspectionSource, Selection } from '../inspection-source.ts'
import { eventHeadline, namesOfYear, EVENT_CATEGORIES, inCategory, isObservationFocusEvent } from '../integrated-overview.ts'
import { describeEvent, shortPersonName, unresolvedLabel } from '../event-summary.ts'
import type { EventLogEntry, DecisionTrace, Id } from '../../simulation/contracts/index.ts'
import type { GoalFailureCode } from '../../simulation/goal.ts'
import { historyFromObservation } from '../desk/data/history.ts'
import { DeskLayout } from '../desk/layout/DeskLayout.tsx'
import type { OpenDeskDocument } from '../desk/layout/document-link.ts'
import './observation.css'

type Props = Readonly<{
  observation?:ObservationSlice
  loading:boolean
  progress?:PlayProgress
  error?:Readonly<{code:string;message:string}>
  seedText:string
  onSeedText:(text:string)=>void
  mode?:ObservationMode
  calc?:CalcInfo
  onReset:()=>void
  desk?:boolean
  pendingYear?:number
  blocked?:boolean
  draining?:boolean
  worldInspectorVisible?:boolean
  onInspectWorld?:()=>void
  onLoad:(year:number, playback?:true)=>void
  onPause?:()=>void
  onOpenDocument?:OpenDeskDocument
  onCancel:()=>void
  onIntervene:(year:number,personId:string,secondPersonId?:string)=>void
}>

const EVENT_LABELS:Readonly<Record<string,string>>={
  PERSON_BIRTH:'出生',MARRIAGE_REGISTER:'婚姻',LEGAL_TITLE_TRANSFER:'称号移転',
  LEGAL_DYNASTY_SET:'法的王朝帰属',PERSON_DEATH:'死亡',
  COUNTRY_RULER_SET:'国家統治者の更新',COUNTRY_RULER_VACATE:'国家統治者の未確定化',
}
const labelOf=(type:string)=>EVENT_LABELS[type]??type
const SHOW=35
const GOAL_REASON:Readonly<Record<GoalFailureCode,string>>={
  NOT_TERRITORIAL:'土地の称号ではない',TITLE_INVALID:'称号が無効',TITLE_NOT_HEREDITARY:'世襲できない称号',
  TITLE_NOT_RECOGNIZED:'称号の承認が不足',REQUIRES_RECOGNITION:'現在の主権による承認が必要',
  HOLDER_UNDETERMINED:'保持者が未確定',HOLDER_NOT_FOUND:'保持者の人物記録がない',
  HOLDER_DEAD:'保持者が死亡している',DYNASTY_UNDETERMINED:'法的王朝所属が未確定',
  DYNASTY_MISMATCH:'保持者の法的王朝が対象と異なる',REGION_NOT_FOUND:'対象の地域記録がない',
  NO_CONTROL:'直接支配または有効な統治委任がない',
}
/** 通常表示は日本語の理由だけ。理由コードは reasonCodes として技術詳細に残す。 */
const reason=(codes:readonly string[])=>codes.length
  ?codes.map(code=>code in GOAL_REASON?GOAL_REASON[code as GoalFailureCode]:'未分類の不足条件').join('、')
  :'理由の記録なし'
const reasonCodes=(codes:readonly string[])=>codes.length?codes.join(', '):'記録なし'
const goalStatusText=(status:string)=>status==='ACHIEVED'?'条件を満たしている':
  status==='NOT_ACHIEVED'?'条件を満たしていない':status==='INVALID_INPUT'?'検証不能な入力':'評価対象外'

/** PR-2: 介入前の原史A0を、証拠のある履歴だけで調べる。WorldStateは選択年の年初。 */
export function ObservationPanel(p:Props){
  const v=p.observation
  const historyYear = useMemo(() => v && historyFromObservation(v).at(v.year), [v])
  const yearStart = historyYear?.start.kind === 'CONFIRMED' ? historyYear.start.world : undefined
  const yearEvents = historyYear?.records.kind === 'COMMITTED' ? historyYear.records.events : undefined
  const yearTraces = historyYear?.records.kind === 'COMMITTED' ? historyYear.records.traces : undefined
  const seedValid=/^\d+$/.test(p.seedText.trim())&&Number.isSafeInteger(Number(p.seedText.trim()))&&Number(p.seedText.trim())>=0
  const seedMatches=v!==undefined&&v.seed===Number(p.seedText.trim())&&seedValid
  const [confirmReset,setConfirmReset]=useState(false)
  const [selectedPerson,setSelectedPerson]=useState('')
  const [selectedTitle,setSelectedTitle]=useState('')
  const [eventId,setEventId]=useState('')
  const [traceId,setTraceId]=useState('')
  const [eventType,setEventType]=useState('ALL')
  const [traceFilter,setTraceFilter]=useState('EVENTLESS')
  const [relatedOnly,setRelatedOnly]=useState(false)
  const [eventLimit,setEventLimit]=useState(SHOW)
  const [traceLimit,setTraceLimit]=useState(SHOW)
  const [traceOpen,setTraceOpen]=useState(false)
  const [showAllEvents,setShowAllEvents]=useState(false)
  const [yearHintLimit,setYearHintLimit]=useState(8)
  // 旧検証入口だけで従来のタブを維持する。
  const [mainTab,setMainTab]=useState<'investigate'|'world'>('investigate')
  const [invTab,setInvTab]=useState<EntityKind>('region')
  const [invSelection,setInvSelection]=useState<Selection|undefined>(undefined)
  // 別の年の記録を開くとき、その年の観測が届いてから対象のEvent/Traceを選ぶ。
  const [pendingOpen,setPendingOpen]=useState<{kind:'event'|'trace';id:string;year:number;seed:number;error?:Props['error']}|undefined>(undefined)
  const [recordReveal, setRecordReveal] = useState<{kind:'event'|'trace';id:string}>()
  const [recordIdentity,setRecordIdentity]=useState(()=>v?`${v.seed}:${v.year}`:'')
  const [scrubYear,setScrubYear]=useState<number|null>(null) // ドラッグ中のみ表示を更新する
  const [playing, setPlaying] = useState(false)
  const [delay, setDelay] = useState(850)
  const lastYear = v?.counts.at(-1)?.year ?? v?.year
  const atEnd = v !== undefined && v.year === lastYear
  const { onLoad, loading, error, blocked } = p
  const advance = useEffectEvent((year: number) => onLoad(year, true))
  const pause = () => { setPlaying(false); p.onPause?.() }
  if (playing && (!seedMatches || blocked || error || atEnd)) setPlaying(false)
  useEffect(() => {
    if (!playing || !v || loading || error || blocked || !seedMatches || atEnd) return
    const id = setTimeout(() => advance(v.year + 1), delay)
    return () => clearTimeout(id)
  }, [playing, v, loading, error, blocked, seedMatches, atEnd, delay])
  const persons=useMemo(()=>v?.world.persons.filter(x=>x.birthYear<=v.year)??[],[v])
  const records=useMemo(()=>v?.personRecords??[],[v])
  // 選択人物は、選択年に未出生でも別人へ切り替えない（記録にある人物ならそのまま保持する）。
  const person=records.some(x=>x.personId===selectedPerson)||persons.some(x=>x.personId===selectedPerson)?selectedPerson:
    (persons.find(x=>x.interactionRole!=='SUPPORTING')??persons[0])?.personId??''
  const nameOf=useMemo(()=>personDisplayNames([...(v?.world.persons??[]),...records]),[v,records])
  const personName=(id:string)=>nameOf(id)??unresolvedLabel('person',id)
  /** 画面表示用の複製。シミュレーション状態は変えず、仮名の表示だけを統一する。 */
  const displayWorld=useMemo(()=>v?{...v.world,persons:v.world.persons.map(x=>({...x,name:nameOf(x.personId)??x.name}))}:undefined,[v,nameOf])
  const inspSource:InspectionSource|undefined=v&&displayWorld?{
    label:'原史A0 seed '+v.seed,world:displayWorld,experimental:true,events:v.events,traces:v.traces}:undefined
  const mapSource: InspectionSource | undefined = inspSource && yearStart && {
    ...inspSource, world: yearStart, events: yearEvents ?? [], traces: yearTraces ?? [],
  }
  const inspIndex=useMemo(()=>displayWorld?indexWorld(displayWorld):undefined,[displayWorld])
  const associations=useMemo(()=>v?collectAssociations({
    year:v.year,events:v.events,traces:v.traces,snapshot:v.world,
  }):undefined,[v])
  const refs=useMemo(()=>associationsFor(associations?.confirmed??[],{kind:'PERSON',id:person}),
    [associations,person])
  const eventRefs=new Set(refs.filter(x=>x.source.type==='EVENT').map(x=>(x.source as {eventId:string}).eventId))
  const traceRefs=new Set(refs.filter(x=>x.source.type==='TRACE').map(x=>(x.source as {traceId:string}).traceId))
  const names=useMemo(()=>{
    const base=namesOfYear(v?.world,v?.events??[])
    const w=v?.world
    return {...base,person:(id:string)=>nameOf(id)??base.person(id),
      title:(id:string)=>{const t=w?.titles.find(x=>x.titleId===id);return t&&w?titleLabel(t,w):undefined},
      region:(id:string)=>w?.regions.find(r=>r.regionId===id)?.name}
  },[v,nameOf])
  const eventKind=(e:EventLogEntry)=>EVENT_CATEGORIES.find(c=>inCategory(e,c))?.label??labelOf(e.eventType)
  const readableEvent=(e:EventLogEntry)=>eventHeadline(e,names,eventKind(e))
  const isPeopleTitleEvent=(e:EventLogEntry)=>isObservationFocusEvent(e)
  const yearHints=(v?.counts??[]).filter(c=>(c.focusEvents??0)>0)
  const types=[...new Set(yearEvents?.map(e=>e.eventType)??[])].sort()
  const events=(yearEvents??[]).filter(e=>(eventType==='ALL'||e.eventType===eventType)&&
    (showAllEvents||eventType!=='ALL'||isPeopleTitleEvent(e))&&(!relatedOnly||eventRefs.has(e.eventId)))
  const traces=(yearTraces??[]).filter(t=>(traceFilter==='ALL'||
    traceFilter==='EVENTLESS'&&t.eventIds.length===0&&(t.status==='DEFER'||t.status==='REJECT')||
    traceFilter===t.status)&&(!relatedOnly||traceRefs.has(t.traceId)))
  const chosenEvent=yearEvents?.find(x=>x.eventId===eventId)
  const chosenTrace=yearTraces?.find(x=>x.traceId===traceId)
  const sourcePersonIds=(e:EventLogEntry)=>(associations?.confirmed??[])
    .filter(a=>a.source.type==='EVENT'&&a.source.eventId===e.eventId&&a.target.kind==='PERSON')
    .map(a=>a.target.id)
    .filter((id,i,all)=>all.indexOf(id)===i)
  const evidencePersons=chosenEvent?sourcePersonIds(chosenEvent)
    .filter(id=>persons.some(x=>x.personId===id)):[]
  // 出生Eventの子は年Y初に存在しない。既存の状態差分に裏付けられたNEWBORNだけを翌年初へ導く。
  const newbornNextYear=v&&v.year<1350?v.year+1:null
  const newbornIds=chosenEvent&&newbornNextYear!==null
    ?[...new Set((associations?.confirmed??[])
      .filter(a=>a.source.type==='EVENT'&&a.source.eventId===chosenEvent.eventId&&
        a.role==='NEWBORN'&&a.target.kind==='PERSON'&&!persons.some(p=>p.personId===a.target.id))
      .map(a=>a.target.id))]:[]
  const requestDocument = (target: Parameters<OpenDeskDocument>[0]) => {
    if (!historyYear || historyYear.start.kind !== 'CONFIRMED' || p.loading || !seedMatches) return
    pause()
    p.onOpenDocument?.(target, historyYear.ref)
  }
  const chooseTrace = (id: string) => {
    setTraceId(id); setTraceOpen(true)
    if (historyYear?.trace(id).kind === 'RECORDED') requestDocument({ kind: 'trace', id })
  }
  const chooseEvent=(e:EventLogEntry)=>{
    if (historyYear?.event(e.eventId).kind === 'RECORDED') requestDocument({ kind: 'event', id: e.eventId })
    setEventId(e.eventId);setTraceId('')
    const first=sourcePersonIds(e).find(id=>persons.some(x=>x.personId===id))
    if(first)setSelectedPerson(first)
  }
  const traceActor=(t:DecisionTrace)=>{
    const label=(id:Id)=>names.person(id)??(()=>{const n=persons.find(x=>x.personId===id)?.name;return n?shortPersonName(n):unresolvedLabel('person',id)})()
    return t.actorRef.kind==='PERSON_PAIR'?t.actorRef.ids.map(label).join(' と ')
      :t.actorRef.kind==='PERSON'?label(t.actorRef.id):'人物以外の対象'
  }
  const statusText=(status:string)=>status==='ACCEPT'?'採用':status==='DEFER'?'保留':
    status==='REJECT'?'不採用':status
  const title=v?.world.titles.find(x=>x.titleId===selectedTitle)
  const titleHistory=v?.titleHistories.find(x=>x.titleId===selectedTitle)
  // 実stateChangeにTitle IDがあるEvent、または根拠付きAssociationだけを関連として表示する。
  const titleEvidenceIds=new Set((associations?.confirmed??[])
    .filter(a=>a.titleId===selectedTitle&&a.source.type==='EVENT')
    .map(a=>a.source.type==='EVENT'?a.source.eventId:''))
  const titlePrefix=title?'$.titles['+title.titleId+']':''
  const titleEvents=title?(v?.events??[]).filter(e=>titleEvidenceIds.has(e.eventId)||
    e.stateChanges.some(c=>c.path===titlePrefix||c.path.startsWith(titlePrefix+'.'))):[]
  const titleTraces=title?(v?.traces??[]).filter(t=>
    titleEvents.some(e=>e.sourceTraceIds.includes(t.traceId)&&t.eventIds.includes(e.eventId))):[]
  const goal=v?.technicalGoal
  const assessments=(goal?.status==='NOT_ACHIEVED'||goal?.status==='ACHIEVED')?goal.assessments:[]
  const territorialAssessments=assessments.filter(a=>v?.world.titles.find(t=>t.titleId===a.titleId)?.kind==='TERRITORIAL')
  const yearChange=(y:number)=>{
    pause()
    setScrubYear(null)
    setPendingOpen(undefined)
    setRecordReveal(undefined)
    setEventId('');setTraceId('')
    if (!p.desk) { setEventType('ALL'); setRelatedOnly(false) }
    setEventLimit(SHOW);setTraceLimit(SHOW)
    if(y!==v?.year || p.loading)p.onLoad(y)
  }
  const selectIns=(sel:Selection)=>{
    requestDocument(sel)
    setInvTab(sel.kind);setInvSelection(sel)
    if(sel.kind==='person'&&records.some(r=>r.personId===sel.id))setSelectedPerson(sel.id)
    if(sel.kind==='title')setSelectedTitle(sel.id)
  }
  const changeInvTab=(k:EntityKind)=>{if(k!==invTab){setInvTab(k);setInvSelection(undefined)}}
  const inspSel:Selection|undefined=invSelection??(invTab==='person'&&person?{kind:'person',id:person}:undefined)
  /** 年・人物・調査対象を保ったまま、別の年の記録を開く。年の観測が届いてから対象を選ぶ。 */
  const openRecord=(kind:'event'|'trace',id:string,year:number)=>{
    pause()
    setMainTab('investigate')
    if(v&&v.year===year){applyOpen(kind,id);return}
    yearChange(year)
    if(v)setPendingOpen({kind,id,year,seed:v.seed,error:p.error})
  }
  const applyOpen=(kind:'event'|'trace',id:string)=>{
    if (p.desk) setRecordReveal({kind,id})
    if(kind==='event'){setEventId(id);setTraceId('');setEventType('ALL');setShowAllEvents(true);setRelatedOnly(false)}
    else{setTraceId(id);setTraceOpen(true);setEventId('');setTraceFilter('ALL');setRelatedOnly(false)}
  }
  // IDはseed・年をまたいで同一の記録を意味しない。
  const identity=v?`${v.seed}:${v.year}`:''
  if(identity!==recordIdentity){
    setRecordIdentity(identity)
    setEventId('');setTraceId('')
  }
  // 失敗やseed変更後に、後から届いた別の観測で保留を復活させない。
  if(pendingOpen){
    if(!seedValid||Number(p.seedText.trim())!==pendingOpen.seed||
      (v&&v.seed!==pendingOpen.seed)||(p.error&&p.error!==pendingOpen.error)){
      setPendingOpen(undefined)
    }else if(v?.seed===pendingOpen.seed&&v.year===pendingOpen.year&&!p.loading){
      setPendingOpen(undefined)
      applyOpen(pendingOpen.kind,pendingOpen.id)
    }
  }
  /** 人物と、その人物が記録に現れる年を一緒に選ぶ。未出生の年のまま別人へ切り替えない。 */
  const focusPerson=(personId:string,year:number)=>{
    pause()
    setSelectedPerson(personId);setMainTab('investigate')
    if(v&&year!==v.year)yearChange(year)
    else requestDocument({kind:'person',id:personId})
  }
  const selectTitleAt=(titleId:string,year:number)=>{
    pause()
    setSelectedTitle(titleId);setMainTab('investigate')
    if(v&&year!==v.year)yearChange(year)
    else requestDocument({kind:'title',id:titleId})
  }
  const jumpTo = (id: string) => {
    const target = document.getElementById(id)
    target?.focus({preventScroll:true})
    target?.scrollIntoView?.({block:'nearest'})
  }
  const revealRecord = useEffectEvent((record: NonNullable<typeof recordReveal>) => {
    const found = record.kind === 'event' ? historyYear?.event(record.id) : historyYear?.trace(record.id)
    if (found?.kind !== 'RECORDED' || !historyYear || loading || !seedMatches) return
    p.onOpenDocument?.(record, historyYear.ref)
    jumpTo(`obs-desk-${record.kind}-detail`)
  })
  useEffect(() => {
    if (!recordReveal) return
    const id = requestAnimationFrame(() => revealRecord(recordReveal))
    return () => cancelAnimationFrame(id)
  }, [recordReveal])
  const goalPanel = v && (
      <div className="obs-goal" data-testid="obs-goal">
        <h3>1350年の王朝存続条件 — 何が不足している？</h3>
        <p>ナルヴェン王朝の存命人物が、承認済みで世襲可能な領地を保持し、直接支配または有効な委任を持つことが条件です。王位のみでは達成できません。</p>
        {territorialAssessments.length>0&&<p data-testid="obs-goal-snapshot">
          領地称号 {territorialAssessments.length}件中、条件を満たすもの {territorialAssessments.filter(a=>a.qualifies).length}件。
        </p>}
        <p>正式勝敗：未成立。参考判定：{goal?goalStatusText(goal.status):'記録なし'}
          （介入前A0・1350年初の実状態。正式なゲームの勝敗ではありません）</p>
        {assessments.length>0&&<details data-testid="obs-goal-reasons">
          <summary>各称号の不足理由（王位と領主権を区別・{assessments.length}件）</summary>
          <ul>{assessments.map(a=><li key={a.titleId}>
            <strong>{(()=>{const t=v.world.titles.find(x=>x.titleId===a.titleId);
              return t?titleLabel(t,v.world):'名前未確認の称号'})()}</strong>：
              {a.qualifies?'条件を満たしている（参考判定）':'不足している条件：'+reason(a.failures)}
            {(()=>{
              const loss=v.titleLossRecords.find(l=>l.titleId===a.titleId)
              if(loss)return <div className="obs-related-links" data-testid="obs-loss-link">
                <button type="button" disabled={p.loading||!seedMatches}
                  onClick={()=>loss.transferEventId&&loss.transferYear!==undefined?openRecord('event',loss.transferEventId,loss.transferYear):yearChange(loss.lostFromYear)}>
                  最後に保持者を失った記録を開く（{loss.transferYear??loss.lostFromYear}年）</button></div>
              return a.failures.includes('HOLDER_UNDETERMINED')&&!v.titleHistories.find(h=>h.titleId===a.titleId)?.intervals.some(i=>i.holder.status==='HELD')?<p className="note" data-testid="obs-no-loss">
                この称号は、観測期間に保持者が確認できた年初の記録がありません（最初から未確定）。喪失ではありません。</p>:null
            })()}
            <details className="dev-details"><summary>技術詳細</summary>
              <span className="note">titleId {a.titleId} / 理由コード {reasonCodes(a.failures)}</span></details>
          </li>)}</ul>
        </details>}
        {v.titleLossRecords.length>0&&<section className="obs-loss" data-testid="obs-loss-records">
          <h4>保持者を失った称号の記録</h4>
          <p className="note">1350年初に保持者を確認できない称号のうち、以前は保持者がいた称号について、最後に保持者を確認できなくなった年を年初履歴から示します。
            原因は断定せず、該当年のEvent・判断の記録で確認します。</p>
          <ul>{v.titleLossRecords.map(l=><li key={l.titleId}>
            <strong>{l.label}</strong>：最後の保持者は{personName(l.lastHolderId)}（{l.heldFromYear}年初〜）。
            {l.lostFromYear}年初に保持者を確認できなくなった
            {l.lastHolderDeathYear!==undefined?'（この人物の没年は'+l.lastHolderDeathYear+'年）':''}。
            <span className="obs-related-links">
              <button type="button" disabled={p.loading||!seedMatches} data-testid="obs-loss-person"
                onClick={()=>focusPerson(l.lastHolderId,l.transferYear??l.lostFromYear-1)}>{personName(l.lastHolderId)}の履歴を見る</button>
              {l.transferEventId&&l.transferYear!==undefined&&<button type="button" disabled={p.loading||!seedMatches}
                onClick={()=>openRecord('event',l.transferEventId!,l.transferYear!)}>{l.transferYear}年の称号移転の記録を開く</button>}
            </span></li>)}</ul>
        </section>}
        {goal?.status==='INVALID_INPUT'&&<p>計算結果の技術評価はデータ不正のため成立していません。</p>}
      </div>
  )
  const navigation = v && (
      <div className={playing ? "obs-year-nav obs-year-nav-playing" : "obs-year-nav"} data-testid="obs-time-controls">
        {(!p.desk || !playing) && <><label htmlFor="obs-year">年表・観測する年（年初）</label>
        <input id="obs-year" type="range" min={1250} max={p.desk ? lastYear : 1350} step={1}
          value={scrubYear??v.year} disabled={(!p.desk&&p.loading)||blocked||!seedMatches}
          aria-valuetext={(scrubYear??v.year)+'年初'} data-testid="obs-year-slider"
          onChange={e=>setScrubYear(Number(e.currentTarget.value))}
          onPointerUp={e=>yearChange(Number(e.currentTarget.value))}
          onPointerCancel={()=>setScrubYear(null)}
          onKeyUp={e=>{if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Home','End','PageUp','PageDown'].includes(e.key))
            yearChange(Number(e.currentTarget.value))}}
          onBlur={e=>{if(scrubYear!==null)yearChange(Number(e.currentTarget.value))}}/>
        <div className="obs-year-ticks" aria-hidden="true"><span>1250</span><span>1275</span><span>1300</span><span>1325</span><span>{p.desk ? lastYear : 1350}</span></div></>}
        <output data-testid="obs-year-label">{scrubYear===null?v.year+'年初'+(p.desk&&loading?'（直前の確定年）':''):scrubYear+'年初（離すと観測）'}</output>
        <div className="obs-year-controls">
          {p.desk && <>
            <button type="button" disabled={!playing && (loading || blocked || !seedMatches || atEnd || !!error)}
              onClick={()=>playing ? pause() : setPlaying(true)}>{playing ? '停止' : '再生'}</button>
            <label>再生速度 <select value={delay} onChange={e=>setDelay(Number(e.target.value))}>
              <option value={1700}>0.5倍</option><option value={850}>1倍</option><option value={425}>2倍</option>
            </select></label>
          </>}
          {!playing && <>
          <button type="button" disabled={p.loading||blocked||!seedMatches||v.year<=1250} onClick={()=>yearChange(v.year-1)}>前年</button>
          <button type="button" disabled={p.loading||blocked||!seedMatches||v.year>=(p.desk ? lastYear! : 1350)} onClick={()=>yearChange(v.year+1)}>翌年</button>
          <span data-testid="obs-cache-source">A0：{v.a0Source==='REUSED'?'保存済みの原史を再利用':'この条件で実計算済み'}</span>
          </>}
        </div>
        {p.desk && error && <p className="note">年を選び直すか、原史を再表示してから再生できます。</p>}
        {p.desk && p.draining && <p className="note">直前の取得が終わるまで介入の実行を待機します。</p>}
        {p.desk && atEnd && <p className="note">計算済み履歴の末尾です。年を戻すと再生できます。</p>}
      </div>
  )
  const yearIndex = v && (
      <div className="obs-year-index">
        <section className="obs-year-hints" data-testid="obs-year-hints">
          <h3>{p.desk ? '重大事件の手がかり' : '人物・家系・所領の記録がある年から探す'}</h3>
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
  )
  const contextLine = v && (
      <p className="note" data-testid="obs-context-line">調査中：原史A0 seed {v.seed}・{v.year}年初
        {person?'・'+personName(person):''}{title?'・'+titleLabel(title,v.world):''}。{!p.desk && 'タブを切り替えても同じ原史・年・対象を保ちます。'}</p>
  )
  const worldPanel = v && mapSource && inspSource && inspIndex && <>
          {!p.desk && <p className="note">観測中の原史A0（seed {v.seed}）の{v.year}年初の世界です。旧試験計算のデータは混ざりません。年は上の年表で変更します。</p>}
          <div className={p.desk ? "obs-world-inline" : "world-row"}>
            <RegionMap source={mapSource} desk={p.desk} index={inspIndex} selectedRegionId={inspSel?.kind==='region'?inspSel.id:undefined}
              onSelect={id=>{p.onInspectWorld?.();selectIns({kind:'region',id})}}/>
            {p.worldInspectorVisible === false
              ? <button type="button" onClick={p.onInspectWorld}>原史A0の世界資料を表示</button>
              : <Inspector source={inspSource} index={inspIndex} tab={invTab} selection={inspSel} onTab={changeInvTab} onSelect={selectIns}/>}
          </div>
          {p.worldInspectorVisible !== false && inspSel?.kind==='person'&&records.some(r=>r.personId===inspSel.id)&&<button type="button" data-testid="obs-world-to-person"
            onClick={()=>{setSelectedPerson(inspSel.id);setMainTab('investigate');if(p.desk)jumpTo('obs-desk-person')}}>この人物のこの世界線の履歴を{p.desk ? '人物資料' : '調査欄'}で見る</button>}
  </>
  const chronicle = v && (
        <div className="obs-timeline" data-testid="obs-chronicle" data-year={v.year}>
          <h3>{p.desk ? '年代記' : '年表'}・{v.year}年に記録された出来事</h3>
          <p className="note">最初は婚姻・出生・死亡・王朝帰属・土地Titleなどを示します。人口や補助人物の登録を含む全Eventも下から表示できます。</p>
          <label>Event種別
            <select data-testid="obs-event-type" value={eventType} onChange={e=>{setEventType(e.target.value);setEventLimit(SHOW)}}>
              <option value="ALL">全種類</option>
              {eventType !== 'ALL' && !types.includes(eventType) && <option value={eventType}>{labelOf(eventType)}（当年なし）</option>}
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
          <p className="note" data-testid="obs-event-count">この年の確定Event {yearEvents?.length ?? 0}件／表示 {events.length}件。
            年初の人物状態とは時点が異なります。非表示の記録も削除していません。</p>
          <ol className="obs-record-list" data-testid="obs-event-list">
            {events.slice(0,eventLimit).map(e=><li key={e.eventId}>
              <button type="button" aria-pressed={eventId===e.eventId} onClick={()=>chooseEvent(e)}>
                {readableEvent(e)}
              </button>
            </li>)}
          </ol>
          {events.length>eventLimit&&<button type="button" onClick={()=>setEventLimit(n=>n+SHOW)}>Eventをさらに表示</button>}
          {chosenEvent&&<div className="obs-record-detail" id={p.desk ? "obs-desk-event-detail" : undefined} tabIndex={p.desk ? -1 : undefined} data-testid="obs-event-detail">
            <h4>{readableEvent(chosenEvent)}</h4>
            {describeEvent(chosenEvent,names)?.lines.map(line=><p key={line}>{line}</p>)}
            <p>実際の状態変化 {chosenEvent.stateChanges.length}件。関係する人物と記録上の判断だけを辿れます。</p>
            {describeEvent(chosenEvent,names)===undefined&&<p className="missing" data-testid="obs-event-unexplained">
              この種類の出来事は、通常表示ではまだ内容を読み替えていません。実際の状態差分は下の検証用表示にあります。</p>}
            {evidencePersons.length>0&&<div className="obs-related-links" data-testid="obs-event-people">
              {evidencePersons.map(id=><button type="button" key={id} onClick={()=>{setSelectedPerson(id);requestDocument({kind:'person',id})}}>
                {personName(id)}の家系を見る
              </button>)}
            </div>}
            {newbornIds.length>0&&newbornNextYear!==null&&<div className="obs-related-links" data-testid="obs-event-newborns">
              <p className="note">出生した人物はこの年の年初にはまだいません。実際の翌年初の人物記録を確認します。</p>
              {newbornIds.map(id=><button type="button" key={id} data-testid={'obs-newborn-next-year-'+id}
                disabled={p.loading||!seedMatches} onClick={()=>{setSelectedPerson(id);yearChange(newbornNextYear)}}>
                {newbornNextYear}年初の出生人物の記録を見る
              </button>)}
            </div>}
            {chosenEvent.sourceTraceIds.length===0
              ?<p className="note">このEventに直接紐づくDecisionTraceは記録されていません。</p>
              :<div data-testid="obs-event-reasons">
                <h4>この出来事につながる判断の記録</h4>
                {chosenEvent.sourceTraceIds.map(id=>{
                  const t=yearTraces?.find(x=>x.traceId===id)
                  return <p key={id}>{t
                    ?<><strong>{statusText(t.status)}</strong> — {traceActor(t)}／判断規則 {t.ruleId}
                      <span data-testid="obs-trace-reason">（{reasonSentence(t.reasonCodes)}）</span>
                      <button type="button" onClick={()=>{chooseTrace(id);setTraceFilter('ALL')}}>根拠を詳しく見る</button></>
                    :<>参照された判断の詳細は、この年の表示にはありません<span hidden data-trace-id={id}/></>}</p>
                })}
              </div>}
            <details><summary>検証用：Eventの出典・実状態差分（{chosenEvent.eventType}）</summary>
              <pre>{JSON.stringify(chosenEvent,null,2)}</pre></details>
          </div>}
          <details className="obs-technical" data-testid="obs-technical" open={traceOpen}
            onToggle={e=>setTraceOpen(e.currentTarget.open)}>
          <summary>技術的な詳細：DecisionTrace（実際の採否・判断根拠）</summary>
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
              <button type="button" aria-pressed={traceId===t.traceId} onClick={()=>{chooseTrace(t.traceId);setEventId('')}}>
                {statusText(t.status)}／{traceActor(t)}（規則 {t.ruleId}・{t.status}、Event {t.eventIds.length}件）
              </button>
            </li>)}
          </ol>
          {traces.length>traceLimit&&<button type="button" onClick={()=>setTraceLimit(n=>n+SHOW)}>Traceをさらに表示</button>}
          {chosenTrace&&<div className="obs-record-detail" id={p.desk ? "obs-desk-trace-detail" : undefined} tabIndex={p.desk ? -1 : undefined} data-testid="obs-trace-detail">
            <h4>{traceActor(chosenTrace)}についての判断：{statusText(chosenTrace.status)}</h4>
            <p>規則 {chosenTrace.ruleId}（{chosenTrace.status}）。記録された理由：{reasonSentence(chosenTrace.reasonCodes)}</p>
            <p className="note">理由コード：{reasonCodes(chosenTrace.reasonCodes)}{reasonView(chosenTrace.reasonCodes).unclassified.length>0?'（未分類のコードを含みます）':''}</p>
            <p>実際に関連づくEvent：{chosenTrace.eventIds.length}件。記録されていない事件は補いません。</p>
            <div className="obs-related-links">{chosenTrace.eventIds.map(id=><button type="button" key={id}
              onClick={()=>openRecord('event',id,v.year)}>関連Eventを開く</button>)}</div>
            <details><summary>DecisionTraceの詳細</summary><pre>{JSON.stringify(chosenTrace,null,2)}</pre></details>
          </div>}
          </details>
        </div>
  )
  const personPanel = v && (
        <aside className="obs-person" id={p.desk ? "obs-desk-person" : undefined} tabIndex={p.desk ? -1 : undefined}>
          <h3>人物と称号を調べる</h3>
          <label>調べる人物
            <select data-testid="obs-person" value={person} onChange={e=>{setSelectedPerson(e.target.value);setSelectedTitle('')}}>
              {records.map(x=><option value={x.personId} key={x.personId}>
                {personName(x.personId)}（{x.birthYear}年生{x.deathYear===undefined?'':'・'+x.deathYear+'年没'}）{x.birthYear>v.year||x.firstYear>v.year?'・この年初には未出生/未記録':''}</option>)}
              {persons.filter(x=>!records.some(r=>r.personId===x.personId)).map(x=>
                <option value={x.personId} key={x.personId}>{shortPersonName(x.name)}（{x.birthYear}年生）</option>)}
            </select>
          </label>
          <section className="obs-person-year" data-testid="obs-person-year-state">
            <h4>選択年初の状態（{v.year}年初）</h4>
            <p className="note">この年の年初に記録されている関係です。別の年の関係や、この世界線の全期間の履歴は下の別欄にあります。</p>
            {person&&seedMatches&&<A0FutureContext observation={v} personId={person}
              disabled={p.loading} onYearSelect={yearChange} onTitleSelect={setSelectedTitle}/>}
            {person&&displayWorld&&<FamilyTree world={displayWorld} personId={person} onSelectPerson={id=>focusPerson(id,v.year)} onSelectTitle={setSelectedTitle}/>}
            <details className="obs-family-help">
              <summary>子どもの数・配偶者の表示の意味</summary>
              <p>子はこの年初までに確認できる親子関係（死亡した子も含む）です。</p>
              <p>配偶者はこの年に有効（ACTIVE）な婚姻だけを表示しています。「記録なし」は生涯未婚を意味しません。生涯の婚姻歴は下の「この世界線の観測期間内の履歴」にあります。</p>
              <p>出生は婚姻・両親の年齢・出生枠・CALIBRATION_ONLYの抽選に基づきます。実際の成立・不成立はその年のB-002 DecisionTraceで確認できます。</p>
            </details>
          </section>
          {person&&<PersonHistory records={records} personId={person} currentYear={v.year} nameOf={nameOf}
            disabled={p.loading||!seedMatches} onFocusPerson={focusPerson} onOpenEvent={(id,y)=>openRecord('event',id,y)}
            onOpenTrace={(id,y)=>openRecord('trace',id,y)} onYear={yearChange} onSelectTitle={selectTitleAt}
            {...(seedMatches?{onIntervene:(y:number,a:string,b:string)=>{pause();p.onIntervene(y,a,b)}}:{})}/>}
          <label>称号の歴代保持者を調べる（王位・領地別）
            <select data-testid="obs-title-select" value={title?.titleId??''} onChange={e=>setSelectedTitle(e.target.value)}>
              <option value="">選択してください</option>
              {v.world.titles.map(t=><option key={t.titleId} value={t.titleId}>{titleLabel(t,v.world)}</option>)}
            </select>
          </label>
          {title&&<div data-testid="obs-title-detail">
            <h4>{titleLabel(title,v.world)}</h4>
            <details><summary>技術情報：称号のIDと権利状態</summary>
              <p>ID：{title.titleId}／種類：{title.kind}／有効：{title.valid?'はい':'いいえ'}／承認：{title.recognition.status}</p>
            </details>
            <p>保持と合法的な王朝存続判定は別の条件です。上段の1350年技術判定と、以下の選択年の実記録を区別してください。</p>
            {titleHistory&&<section className="obs-holder-history" data-testid="obs-title-history">
              <h5>歴代の保持者（年初の実記録）</h5>
              <p className="note">各年の年初に確認された保持状況です。正式な継承の成立や移転理由を推定しません。保持者名を選ぶと、その人物とその年を一緒に開きます。</p>
              <ol>{titleHistory.intervals.map((period,i)=><li key={period.fromYear+'-'+i}>
                <strong>{period.fromYear}{period.throughYear>period.fromYear?'〜'+period.throughYear:''}年初：</strong>
                {period.holder.status==='HELD'
                  ?<span><button type="button" data-testid={'obs-holder-person-'+period.fromYear} disabled={p.loading||!seedMatches}
                    onClick={()=>focusPerson((period.holder as {personId:string}).personId,period.fromYear)}>{personName(period.holder.personId)}</button>（{period.holder.life==='DEAD'
                    ?'故人の名義が残る・継承未確認'+(period.holder.deathYear===undefined?'':'／'+period.holder.deathYear+'年没')
                    :period.holder.life==='UNKNOWN'?'人物の生死を確認できない':'記録上の保持者'}）</span>
                  :period.holder.status==='UNDETERMINED'?'保持者未確定（相続等は別途確認）':'当年初の称号記録なし'}
                <button type="button" data-testid={'obs-holder-year-'+period.fromYear}
                  disabled={p.loading||!seedMatches} onClick={()=>yearChange(period.fromYear)}>その年へ</button>
              </li>)}</ol>
              <details>
                <summary>実際に記録されたTitle移転Event（{titleHistory.transfers.length}件）</summary>
                {titleHistory.transfers.length===0?<p>確定した移転Eventを確認できません。保持者変化を正式継承とはみなしません。</p>:
                  <ul>{titleHistory.transfers.map(e=><li key={e.eventId}>{e.year}年：
                    {e.beforeHolderId?personName(e.beforeHolderId):'保持者なし'} → {e.afterHolderId?personName(e.afterHolderId):'未確定'}
                    <button type="button" disabled={p.loading||!seedMatches} onClick={()=>openRecord('event',e.eventId,e.year)}>
                      この移転の記録と判断を開く
                    </button></li>)}</ul>}
              </details>
            </section>}
            <p className="note">この年のTitleへ直接の根拠があるEvent {titleEvents.length}件、相互参照の一致するTrace {titleTraces.length}件。</p>
            {titleEvents.length===0&&<p className="note">この年の記録では直接の変化・関連を確認できません。何も起きなかったとは断定しません。</p>}
            {titleEvents.length>0&&<ul>{titleEvents.map(e=><li key={e.eventId}>
              <button type="button" data-testid="obs-title-event-link" onClick={()=>openRecord('event',e.eventId,v.year)}>
                {e.year}年 {readableEvent(e)}（Event）
              </button>
            </li>)}</ul>}
            {titleTraces.length>0&&<ul>{titleTraces.map(t=><li key={t.traceId}>
              <button type="button" data-testid="obs-title-trace-link" onClick={()=>openRecord('trace',t.traceId,v.year)}>
                {t.ruleId}・{t.status}（DecisionTrace）
              </button>
            </li>)}</ul>}
          </div>}
          {person&&v.year<1350&&persons.find(x=>x.personId===person)?.interactionRole!=='SUPPORTING'&&
            persons.some(x=>x.personId===person)&&
            <button type="button" className="cta" data-testid="obs-to-intervention" disabled={!seedMatches||p.loading} onClick={()=>{pause();p.onIntervene(v.year,person)}}>
              この人物と年から介入を検討する
            </button>}
          <p className="note">介入は既存の人物間信頼調整のみです。対象者の適格性・成立・歴史変化は保証しません。</p>
        </aside>
  )
  return <section className={p.desk ? "panel obs obs-desk" : "panel obs"} aria-labelledby="obs-heading" data-testid="observation-main">
    <header className={p.desk && v ? "obs-head obs-head-with-time" : "obs-head"}>
      <div>
        {!p.desk && <p className="obs-eyebrow">亡国の王冠 — 1250〜1350年</p>}
        <h2 id="obs-heading">原史A0を観測する</h2>
        <p className="obs-question">1350年、ナルヴェン王朝には合法な世襲所領が残るのか？</p>
        {!p.desk && <p className="note">歴史がどう動くかを見て、人物・婚姻・土地称号（Title）と判断の記録を辿ります。調べた人物から介入を試せます。</p>}
        {!v&&!p.loading&&<p className="obs-guidance" data-testid="obs-intro">まだ原史の計算結果は表示していません。下のボタンで1250〜1350年の世界を計算します。</p>}
        <p className="note">試験版です。1350年の判定は参考表示で、正式な勝敗ではありません。</p>
        <details className="dev-details" data-testid="obs-dev-info"><summary>開発・検証情報</summary>
          <p className="note">EXPERIMENTAL / CALIBRATION_ONLY。正式Goalは未設定（goal=null）で、技術判定は正式な勝敗を意味しません。{goal&&' 技術判定コード: '+goal.status}</p>
          {v&&<dl className="compare-metrics" data-testid="obs-source">
            <dt>実行構成ID</dt><dd>{v.configId??v.mode}</dd>
            {v.configDigest&&<><dt>構成digest</dt><dd>{v.configDigest}</dd></>}
            <dt>seed</dt><dd>{v.seed}</dd>
            <dt>計算範囲</dt><dd>{v.counts[0]?.year}〜{v.counts.at(-1)?.year}年</dd>
            <dt>介入</dt><dd>なし（A0）</dd>
            {p.calc&&<><dt>実測時間（Worker / 表示まで）</dt><dd data-testid="obs-times">{p.calc.computeMs.toFixed(0)} ms / {p.calc.wallMs.toFixed(0)} ms</dd></>}
          </dl>}
        </details>
      </div>
      <div className="obs-seed-tools">
        <label htmlFor="obs-seed-input">{p.mode==='MULTI_HOUSE_EXPERIMENTAL'?'原史A0のseed':'統合A0のseed'}
          <input id="obs-seed-input" data-testid="obs-seed-input" type="text" inputMode="numeric"
            value={p.seedText} disabled={p.loading} aria-invalid={!seedValid}
            onChange={e=>p.onSeedText(e.target.value)}/>
        </label>
        <button type="button" className="cta" data-testid="obs-start"
          onClick={()=>{setEventType('ALL');p.onLoad(v?.year??1250)}} disabled={p.loading||blocked||!seedValid}>
          {!v?(p.mode==='MULTI_HOUSE_EXPERIMENTAL'?'原史A0を計算して観測':'統合A0を計算して観測'):seedMatches?'このseedの原史A0を再表示':'このseedで原史A0を計算'}
        </button>
        {v&&!confirmReset&&<button type="button" data-testid="obs-reset" disabled={p.loading} onClick={()=>setConfirmReset(true)}>開発用：旧試験画面へ切り替え</button>}
        {v&&confirmReset&&<span role="alert" data-testid="obs-reset-warning">
          現在の原史A0の観測結果は破棄されます。
          <button type="button" data-testid="obs-reset-confirm" disabled={p.loading} onClick={()=>{setConfirmReset(false);p.onReset()}}>破棄して切り替える</button>
          <button type="button" data-testid="obs-reset-cancel" onClick={()=>setConfirmReset(false)}>キャンセル</button>
        </span>}
        {!seedValid&&<span className="missing" role="alert">seedは0以上の安全な整数で指定してください。</span>}
        {v&&!seedMatches&&<p role="status" data-testid="obs-seed-mismatch">
          表示中の原史はseed {v.seed}です。入力seedが異なるため、再観測するまでこの結果から介入できません。
        </p>}
        {v&&seedMatches&&<p className="note" data-testid="obs-seed-active">観測中の原史seed {v.seed}</p>}
      </div>
      {p.desk && navigation}
    </header>
    {p.loading&&<div role="status" data-testid="obs-loading">
      <p>{p.desk && v && p.pendingYear !== undefined
        ? `${p.pendingYear}年の確定データを取得中です。`
        : '原史A0の確定データを取得中です。計算が完了するまで未来の結果を表示しません。'}</p>
      {p.progress&&<p data-testid="obs-progress">{p.progress.confirmedYear}年初まで計算済み（A0 {p.progress.transitionsDone}/{p.progress.transitionsTotal}年分）。</p>}
      <button type="button" onClick={()=>{setPendingOpen(undefined);p.onCancel()}} data-testid="obs-cancel">観測の取得を中止（キャッシュを破棄）</button>
    </div>}
    {p.error&&<p role="alert" data-testid="obs-error">{p.error.code==='CANCELLED'?'観測を中断しました':p.error.code==='A0_HALTED'?'原史の計算が停止しました（勝敗ではありません）':'観測に失敗しました'}（{p.error.code}）。{p.error.message}</p>}
    {v&&<div className="obs-body">
      {p.desk ? <>
        <div className="obs-desk-content" inert={loading} aria-busy={loading}>
          {contextLine}
          <DeskLayout
            chronicle={<>
              {chronicle}
              {yearIndex}
              <details><summary>シナリオ目標と1350年の参考判定</summary>{goalPanel}</details>
            </>}
            world={<div data-testid="obs-world-explorer" data-year={yearStart?.year}>
              {worldPanel}
              {personPanel}
            </div>}
            onChronicle={()=>jumpTo('obs-desk-chronicle')}
            onWorld={()=>jumpTo('obs-desk-world')}
          />
        </div>
      </> : <>
        {goalPanel}
        {navigation}
        {yearIndex}
      <div role="tablist" aria-label="調査と世界の閲覧" className="tabs obs-tabs" data-testid="obs-main-tabs">
        <button type="button" role="tab" id="obs-tab-investigate" aria-selected={mainTab==='investigate'} aria-controls="obs-panel-investigate"
          data-testid="obs-tab-investigate" onClick={()=>setMainTab('investigate')}>調査（年表・人物・称号）</button>
        <button type="button" role="tab" id="obs-tab-world" aria-selected={mainTab==='world'} aria-controls="obs-panel-world"
          data-testid="obs-tab-world" onClick={()=>setMainTab('world')}>世界の閲覧（地図・人口集団・人物・称号）</button>
      </div>
        {contextLine}
        <div role="tabpanel" id="obs-panel-world" aria-labelledby="obs-tab-world" hidden={mainTab!=='world'} data-testid="obs-world-explorer">
          {mainTab==='world' && worldPanel}
        </div>
        <div className="obs-two-col" role="tabpanel" id="obs-panel-investigate" aria-labelledby="obs-tab-investigate" hidden={mainTab!=='investigate'}>
          {chronicle}
          {personPanel}
        </div>
      </>}
    </div>}
  </section>
}
