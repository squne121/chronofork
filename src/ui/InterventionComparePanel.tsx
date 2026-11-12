// A0/A1の試験用介入操作。描画用の差分は実WorldState/EventLog/DecisionTraceからのみ取得する。
// GAME-01〜05と正式勝敗は未成立。CALIBRATION_ONLYの明示法的承認だけを試験で注入する。
import { useMemo, useState } from 'react'
import { compareYear, directlyInvolvesPair, playPersonOptions, playModeLabel, INTEGRATED_PLAY_DEFAULTS, PLAY_DEFAULT_MODE, PLAY_DEMO_DELTA, PLAY_DEMO_DURATION, PLAY_DEMO_PAIR, PLAY_DEMO_YEAR } from './branch-play-source.ts'
import { observeDynastyContinuity } from './dynasty-continuity.ts'
import type { ContinuityObservation } from './dynasty-continuity.ts'
import { NALVEN_DYNASTY_ID } from '../scenario/experimental/index.ts'
import { childIdsOfPair } from './event-summary.ts'
import type { BranchChoice, PlayInput, PlayMode, PlayView } from './branch-play-source.ts'
import { candidateLabel, candidateSetMatches, candidatesAtYear, extractCandidates } from './play-candidates.ts'
import type { PlayCandidateSet } from './play-candidates.ts'
import { IntegratedOverview } from './IntegratedOverview.tsx'
import { FollowupInterventionPanel } from './FollowupInterventionPanel.tsx'
import type { PlayProgress, ProgressState } from './play-progress.ts'
import type { CalcInfo } from './IntegratedOverview.tsx'
import type { GoalEvaluation, GoalFailureCode } from '../simulation/goal.ts'

/** 途中経過が止まった理由。どれも「結果が確定した」ことを意味しない。 */
export type ProgressEnd='CANCELLED'|'HALTED'|'FAILED'
const END_LABEL:Record<ProgressEnd,string>={
  CANCELLED:'キャンセルされました',HALTED:'歴史計算が停止しました（HALTED）',FAILED:'計算に失敗しました',
}
/** 計算済みの年・区間・実際の進み具合のみ。残り時間・未来のEventは出さない。 */
function ProgressLine({label,p,ended,reused}:{label:string;p?:PlayProgress;ended:boolean;reused?:boolean}){
  if(reused)return <li data-testid={`progress-${label}`}>{label}：保存済みの計算結果を再利用しています（A0は再計算していません）</li>
  if(!p)return <li data-testid={`progress-${label}`}>{label}：{ended?'未着手':'開始待ち'}（確定した年はありません）</li>
  return <li data-testid={`progress-${label}`}>
    {label}：{p.startYear}年→{p.goalYear}年の再計算で、{p.confirmedYear}年初まで計算済み
    （{p.transitionsDone}/{p.transitionsTotal}年分、記録されたEvent {p.eventCount}件）
  </li>
}

type Props=Readonly<{
  seedText:string
  year:number
  comparison?:PlayView
  error?:Readonly<{code:string;message:string}>
  /** 統合モードの計算中。他の操作は妨げないが、二重起動はできない。 */
  running?:Readonly<{elapsedSec:number}>
  /** 確定済みの年次進捗（A0/A1別）。途中経過であり結果ではない。 */
  progress?:ProgressState
  /** A0を再計算せず保存済みを使っている。 */
  a0Reused?:boolean
  progressEnd?:ProgressEnd
  notice?:string
  calc?:CalcInfo
  onCancel:()=>void
  onSeedText:(text:string)=>void
  /** 明示操作で取得したA0の人物候補（seed・モード付き）。条件が合わなければ使わない。 */
  candidateSet?:PlayCandidateSet
  fetchingCandidates?:boolean
  observationLoading?:boolean
  candidateError?:Readonly<{code:string;message:string}>
  onFetchCandidates:(seed:number,mode:PlayMode)=>void
  onCancelCandidates:()=>void
  /** 年表調査から選択した年と人物。既存の合法な介入対象判定に委ねる。 */
  observationTarget?:Readonly<{year:number;personId:string;seed:number;token:number}>
  activeBranch:BranchChoice|'A2'
  onRun:(input:PlayInput)=>void
  onViewBranch:(choice:BranchChoice|'A2')=>void
  onInspectEvent:(choice:BranchChoice,id:string)=>void
  onInspectTrace:(choice:BranchChoice,id:string)=>void
}>
const persons=playPersonOptions()
/** 既知のEvent種別だけ平易な見出しを付ける。未知の種別は生の種別名をそのまま出す（用語を創作しない）。 */
const EVENT_LABEL:Readonly<Record<string,string>>={MARRIAGE_REGISTER:'婚姻の成立',PERSON_BIRTH:'人物の出生',LEGAL_DYNASTY_SET:'法的王朝の確定'}
const eventLabel=(t:string)=>EVENT_LABEL[t]?`${EVENT_LABEL[t]}（${t}）`:t
const kindLabel=(k:'A0_ONLY'|'A1_ONLY'|'CHANGED')=>k==='A0_ONLY'?'A0にだけ記録':k==='A1_ONLY'?'A1にだけ記録':'A0/A1で内容が違う'
type PersonOption=Readonly<{id:string;label:string}>
const GOAL_FAILURE_LABEL:Record<GoalFailureCode,string>={
  NOT_TERRITORIAL:'土地領主権ではない',TITLE_INVALID:'Titleが無効',
  TITLE_NOT_HEREDITARY:'世襲権がない',TITLE_NOT_RECOGNIZED:'承認根拠が不足',
  REQUIRES_RECOGNITION:'現在の主権による承認が不足',
  HOLDER_UNDETERMINED:'保持者が未確定',HOLDER_NOT_FOUND:'保持者の参照がない',
  HOLDER_DEAD:'保持者が死亡',DYNASTY_UNDETERMINED:'王朝所属が未確定',
  DYNASTY_MISMATCH:'ナルヴェン王朝の合法な構成員ではない',
  REGION_NOT_FOUND:'対象地域が存在しない',NO_CONTROL:'有効な実効統治・委任がない',
}
/** 表示専用。勝敗は再計算せず、runTimeline/forkWorldの厳格なGoal結果だけを読む。 */
const trialGoalStatus=(g:GoalEvaluation|null):string=>{
  if(g===null)return '未検証'
  if(g.status==='ACHIEVED')return '条件に一致（技術検証）'
  if(g.status==='NOT_ACHIEVED')return '条件に不一致（技術検証）'
  return g.status==='INVALID_INPUT'?'データ不正で評価不能':'対象年ではない'
}
const goalAssessments=(g:GoalEvaluation|null)=>
  g?.status==='ACHIEVED'||g?.status==='NOT_ACHIEVED'?g.assessments:[]
/** 厳格な1350年GoalのTitle別判定をそのまま読む。未確定の権限は補完しない。 */
const titleGoalEvidence=(g:GoalEvaluation|null,titleId:string):string=>{
  if(g===null||g.status==='INVALID_INPUT'||g.status==='NOT_EVALUABLE')return '判定根拠なし'
  const a=g.assessments.find(x=>x.titleId===titleId)
  if(!a)return 'Titleの評価記録なし'
  if(a.qualifies)return '条件に一致'
  return a.failures.map(code=>GOAL_FAILURE_LABEL[code]).join('、')||'不一致の原因未記録'
}
const centralTitleEvidence=(g:GoalEvaluation|null):string=>{
  if(g===null||g.status==='INVALID_INPUT'||g.status==='NOT_EVALUABLE')return '判定根拠なし'
  const a=g.assessments.find(x=>x.titleId==='title-exp-central')
  if(!a)return '中央世襲所領の評価記録なし'
  return a.qualifies?'中央世襲所領は条件に一致':`中央世襲所領: ${a.failures.map(x=>GOAL_FAILURE_LABEL[x]).join('、')}`
}
/** HALTED(計算が規則上継続できず停止)とゲーム内の勝敗は別物。 */
const errorHeading=(code:string)=>code.endsWith('_HALTED')
  ?'計算停止（HALTED。ゲーム内の勝敗ではありません）'
  :code==='CANCELLED'?'計算を中断しました':code.startsWith('WORKER_')?'計算を実行できませんでした（ブラウザ側の失敗。ゲームの結果ではありません）'
  :'計算不成立（ゲーム内の勝敗ではありません）'
const countAlive=(c:readonly {alive:boolean}[])=>c.filter(x=>x.alive).length
const countMarried=(w:{legal:{marriages:readonly {status:string}[]}})=>w.legal.marriages.filter(m=>m.status==='ACTIVE').length
const countHeld=(w:{titles:readonly {holder:{status:string}}[]})=>w.titles.filter(t=>t.holder.status==='HELD').length

export function InterventionComparePanel(p:Props){
  // 観測画面から渡された初期値は、親のkey変更による安全な再マウント時だけ適用する。
  const observed=p.observationTarget
  const [mode,setMode]=useState<PlayMode>(observed?'INTEGRATED_EXPERIMENTAL':PLAY_DEFAULT_MODE)
  const [yearText,setYearText]=useState(String(observed?.year??PLAY_DEMO_YEAR))
  const [firstId,setFirstId]=useState<string>(observed?.personId??PLAY_DEMO_PAIR[0])
  const [secondId,setSecondId]=useState<string>(observed
    ? observed.personId===INTEGRATED_PLAY_DEFAULTS.pair[1]?INTEGRATED_PLAY_DEFAULTS.pair[0]:INTEGRATED_PLAY_DEFAULTS.pair[1]
    : PLAY_DEMO_PAIR[1])
  const [deltaText,setDeltaText]=useState(String(observed?INTEGRATED_PLAY_DEFAULTS.signedDelta:PLAY_DEMO_DELTA))
  const [durationText,setDurationText]=useState(String(observed
    ? Math.min(INTEGRATED_PLAY_DEFAULTS.durationYears,1350-observed.year):PLAY_DEMO_DURATION))
  const seed=Number(p.seedText.trim())
  const year=Number(yearText),delta=Number(deltaText),duration=Number(durationText)
  const valid=/^\d+$/.test(p.seedText.trim())&&Number.isSafeInteger(seed)&&seed>=0 &&
    /^\d+$/.test(yearText)&&Number.isSafeInteger(year)&&year>=1250&&year<1350 &&
    /^-?\d+$/.test(deltaText)&&Number.isSafeInteger(delta)&&delta!==0&&Math.abs(delta)<=200 &&
    /^\d+$/.test(durationText)&&Number.isSafeInteger(duration)&&duration>=1&&year+duration<=1350 &&
    firstId!==secondId
  // 候補: 現在のseed・方式に一致するA0（明示取得、または表示中の比較のA0）だけを使う。介入年の年初に存在するKEY人物のみ。
  const comparisonSet=useMemo(()=>p.comparison?extractCandidates(p.comparison.input.seed,p.comparison.mode,p.comparison.a0.result.snapshots):undefined,
    [p.comparison])
  const activeSet=candidateSetMatches(p.candidateSet,seed,mode)?p.candidateSet
    :candidateSetMatches(comparisonSet,seed,mode)?comparisonSet:undefined
  const yearOk=/^\d+$/.test(yearText)&&Number.isSafeInteger(year)&&year>=1250&&year<1350
  const options:readonly PersonOption[]=activeSet&&yearOk
    ?candidatesAtYear(activeSet,year).map(c=>({id:c.id,label:candidateLabel(c)})):persons
  const inOptions=(id:string)=>options.some(o=>o.id===id)
  const personsOk=inOptions(firstId)&&inOptions(secondId)
  const canRun=valid&&personsOk
  // 表示名: 現在の候補→表示中の比較のA0→初期人物。どれにも無いときだけIDを出す。
  const personName=(id:string)=>{
    const c=activeSet?.candidates.find(x=>x.id===id)??comparisonSet?.candidates.find(x=>x.id===id)
    return c?candidateLabel(c):persons.find(x=>x.id===id)?.label??id
  }
  const personOptions=(selected:string)=>{
    const list=options.map(x=><option key={x.id} value={x.id}>{x.label}</option>)
    // 現在の年に存在しない人物が選択中のままなら、選択が無効であることを選択欄にも出す（黙って別の人物にしない）。
    return inOptions(selected)?list:[<option key="__missing" value={selected} disabled>{personName(selected)}（{yearOk?`${year}年初には存在しません`:'年を確認してください'}）</option>,...list]
  }
  const data=p.comparison?compareYear(p.comparison,p.year):undefined
  const before=data?.a0World,after=data?.a1World
  const input=p.comparison?.input
  const continuityA0=p.comparison?observeDynastyContinuity(
    p.comparison.a0.initialWorld,p.comparison.a0.result,NALVEN_DYNASTY_ID):undefined
  const continuityA1=p.comparison?observeDynastyContinuity(
    p.comparison.a1.initialWorld,p.comparison.a1.result,NALVEN_DYNASTY_ID):undefined
  const continuityPanel=(obs:ContinuityObservation|undefined,branch:'A0'|'A1')=><div
    data-testid={branch==='A0'?'continuity-a0':'continuity-a1'}>
    <h5>{branch} {branch==='A0'?'介入なし':'介入あり'}</h5>
    {!obs||obs.status!=='OBSERVED'?<p>歴史の最後まで計算されていません。世代を評価できません。</p>:(
      <dl className="compare-metrics">
        <dt>計算中に記録された出生</dt><dd>{obs.birthEvents}件</dd>
        <dt>1250年の人物から確認できる子孫</dt><dd>{obs.birthsInInitialFamily}人 /
          {obs.familyDepth>=2?`2世代以上（最深${obs.familyDepth}世代）`:
            obs.familyDepth===1?'子の世代まで（孫以降は未確認）':'次世代の親子関係未確認'}</dd>
        <dt>ナルヴェンの初期人物につながる新しい子孫</dt><dd>{obs.birthsInTargetDynastyFamily}人</dd>
        <dt>うち法的ナルヴェン所属が確定</dt><dd>{obs.legalTargetDescendants}人</dd>
        <dt>新生児の法的王朝が未確定</dt><dd>{obs.birthsWithUndeterminedDynasty}人</dd>
        <dt>1350年に存命する合法なナルヴェン</dt><dd>{obs.livingLegalTargetMembers}人</dd>
        <dt>土地Title移転 / 新しい統治委任</dt><dd>{obs.titleTransferEvents}件 / {obs.controlMandateEvents}件</dd>
        <dt>1350年に継続中の相続審査</dt><dd>{obs.successionCasesPending}件</dd>
      </dl>
    )}
  </div>
  const finalA0=p.comparison?.a0.result.snapshots.at(-1)
  const goalA0=p.comparison?.a0.result.technicalGoal??null
  const goalA1=p.comparison?.a1.result.technicalGoal??null
  const titleIds=[...new Set([...goalAssessments(goalA0),...goalAssessments(goalA1)]
    .filter(a=>!a.failures.includes('NOT_TERRITORIAL')).map(a=>a.titleId))].sort()
  const titleLabel=(titleId:string)=>{
    const regionId=finalA0?.titles.find(t=>t.titleId===titleId)?.regionId
    const region=finalA0?.regions.find(r=>r.regionId===regionId)
    return region?region.name+'（'+titleId+'）':titleId
  }
  const pair=input?[input.firstPersonId,input.secondPersonId].sort() as [string,string]:PLAY_DEMO_PAIR
  const b4=(choice:BranchChoice)=>p.comparison?.[choice.toLowerCase() as 'a0'|'a1'].result.decisionTraces.find(t=>
    t.year===p.year&&t.ruleId==='B-004'&&t.actorRef.kind==='PERSON_PAIR'&&
    t.actorRef.ids[0]===pair[0]&&t.actorRef.ids[1]===pair[1])
  const traceA0=b4('A0'),traceA1=b4('A1')
  const score=(t:typeof traceA0)=>t?.candidates[0]?.score===undefined?'—':String(t.candidates[0].score)
  const children=p.comparison?childIdsOfPair([...p.comparison.a0.result.eventLog,...p.comparison.a1.result.eventLog],pair):new Set<string>()
  const eventRows=(data?.events??[]).map(x=>({
    ...x,focus:directlyInvolvesPair(x.event,pair)||x.event.involvedRefs.some(r=>r.kind==='PERSON'&&children.has(r.id)),
  }))
  const focused=eventRows.filter(x=>x.focus),other=eventRows.filter(x=>!x.focus)
  const summarize=(w:typeof before)=>w?(
    <dl className="compare-metrics">
      <dt>生存人物</dt><dd>{countAlive(w.persons)}人</dd>
      <dt>有効婚姻</dt><dd>{countMarried(w)}件</dd>
      <dt>Title保有者確定</dt><dd>{countHeld(w)}件</dd>
      <dt>相続案件</dt><dd>{w.legal.cases.length}件</dd>
    </dl>
  ):<p className="missing">未計算の年です</p>
  const tally=(rows:typeof eventRows)=>{
    const n=(k:string)=>rows.filter(x=>x.kind===k).length
    return `A1にだけ記録 ${n('A1_ONLY')}件 / A0にだけ記録 ${n('A0_ONLY')}件 / 内容が違う ${n('CHANGED')}件`
  }
  const byType=(rows:typeof eventRows)=>[...new Set(rows.map(x=>x.event.eventType))].map(t=>
    `${eventLabel(t)}: ${tally(rows.filter(x=>x.event.eventType===t))}`)
  const decisionChanged=traceA0?.status!==traceA1?.status
  const eventButton=(x:typeof eventRows[number])=><li key={x.event.eventId+x.kind}>
    <button type="button" onClick={()=>p.onInspectEvent(x.kind==='A0_ONLY'?'A0':'A1',x.event.eventId)}>
      {kindLabel(x.kind)} / {x.event.year}年 {eventLabel(x.event.eventType)}
    </button>
  </li>
  return <section className="panel intervention-panel" aria-labelledby="branch-heading" data-testid="branch-compare-panel">
    <h2 id="branch-heading">介入して歴史を比べる（試験版）</h2>
    <p className="note">対象の2人の信頼を一時的に変え、1250〜1350年の実WorldStateを再計算します。法令や出生・死亡の具体値はCALIBRATION_ONLYで、どちらの方式も正式な勝敗・全自律歴史ではありません。</p>
    <h3 className="step-title"><span className="step-no">1</span>試験方式と介入を選ぶ</h3>
    <label>法制を試す方式
      <select data-testid="play-law-mode" value={mode} disabled={!!p.running} onChange={e=>{
        const next=e.target.value as PlayMode
        setMode(next)
        if(next==='INTEGRATED_EXPERIMENTAL'){
          // PR #78 の実測条件を「初期入力例」として入れるだけ。以降は入力欄の値で再計算する。
          p.onSeedText(String(INTEGRATED_PLAY_DEFAULTS.seed))
          setFirstId(INTEGRATED_PLAY_DEFAULTS.pair[0]);setSecondId(INTEGRATED_PLAY_DEFAULTS.pair[1])
          setYearText(String(INTEGRATED_PLAY_DEFAULTS.year));setDeltaText(String(INTEGRATED_PLAY_DEFAULTS.signedDelta))
          setDurationText(String(INTEGRATED_PLAY_DEFAULTS.durationYears))
          return
        }
        // 統合モードの初期例から戻したときは、従来の試験用の初期例へ戻す。
        setFirstId(PLAY_DEMO_PAIR[0]);setSecondId(PLAY_DEMO_PAIR[1])
        setDeltaText(String(PLAY_DEMO_DELTA));setDurationText(String(PLAY_DEMO_DURATION))
        // 1250年からの介入が国内法制の差分を観測しやすい初期例。実際のイベント年は固定しない。
        if(next==='ORDINARY_LAW')setYearText('1250')
        else setYearText(String(PLAY_DEMO_YEAR))
      }}>
        <option value="FIXED_APPROVAL">旧・1260年の明示承認試験</option>
        <option value="ORDINARY_LAW">通常法制（experimental）</option>
        <option value="INTEGRATED_EXPERIMENTAL">統合法制・世代継続（experimental）</option>
      </select>
    </label>
    <p className="note" data-testid="play-mode-description">
      {mode==='INTEGRATED_EXPERIMENTAL'
        ?'SUPPORTING登録・婚姻・出生・死亡・婚姻終了・法的王朝・相続・統治委任を一つの構成で通し、1250〜1350年を再計算します（100年分のため端末により1〜数分かかります。計算中も画面は操作できます）。入力欄の初期値はPR #78で実測したCALIBRATION_ONLYの例で、歴史の固定イベントではありません。'
        :mode==='ORDINARY_LAW'
        ?'同一国内の背景法令・当事者の試験適格性と、その年のB-005交渉意思から婚姻・相続・新委任を審査します。特定年の婚姻承認は予約しません。'
        :'従来の1260年限定の明示承認証拠による婚姻試験です。通常法制の自律承認ではありません。'}
    </p>
    {p.comparison&&p.comparison.mode!==mode&&<p className="note" role="status">
      表示中の比較は{playModeLabel(p.comparison.mode)}です。変更した方式を反映するには再計算してください。
    </p>}
    <form className="compare-form" onSubmit={e=>{
      e.preventDefault()
      if(canRun&&!p.running&&!p.fetchingCandidates&&!p.observationLoading)p.onRun({seed,year,firstPersonId:firstId,secondPersonId:secondId,
        signedDelta:delta,durationYears:duration,mode})
    }}>
      <div className="candidate-source" data-testid="candidate-source">
        <button type="button" data-testid="candidates-fetch" disabled={!/^\d+$/.test(p.seedText.trim())||!Number.isSafeInteger(seed)||!!p.running||!!p.fetchingCandidates||!!p.observationLoading}
          onClick={()=>p.onFetchCandidates(seed,mode)}>この条件のA0から人物候補を取得（後から生まれた人物を選ぶ場合）</button>
        {p.fetchingCandidates&&<button type="button" data-testid="candidates-cancel" onClick={p.onCancelCandidates}>取得をキャンセル</button>}
        <span className="note" role="status" data-testid="candidate-status"> {p.fetchingCandidates
          ?'A0を計算して人物候補を取得中です（介入の再計算はしません。この間も他の操作ができます）。'
          :activeSet?`候補はseed ${activeSet.seed}・${playModeLabel(activeSet.mode)}のA0の${yearOk?`${year}年初`:'年初'}の実際のWorldStateから取得しています（KEY人物${yearOk?candidatesAtYear(activeSet,year).length:activeSet.candidates.length}人）。`
          :'現在は初期人物のみ表示しています。1251年以降に生まれた人物を選ぶには、上のボタンでA0の候補を取得してください。'}</span>
        {p.candidateError&&<p role="alert" className="halt" data-testid="candidate-error">人物候補を取得できませんでした: {p.candidateError.code} / {p.candidateError.message}</p>}
      </div>
      <div className="form-grid">
        <label>対象の人物1
          <select value={firstId} onChange={e=>setFirstId(e.target.value)} data-testid="branch-person-one">
            {personOptions(firstId)}
          </select>
        </label>
        <label>対象の人物2
          <select value={secondId} onChange={e=>setSecondId(e.target.value)} data-testid="branch-person-two">
            {personOptions(secondId)}
          </select>
        </label>
        <label>2人の信頼の補正（試験値）
          <input type="number" min={-200} max={200} step={1} value={deltaText} onChange={e=>setDeltaText(e.target.value)} data-testid="branch-trust-delta"/>
        </label>
        <label>介入する年
          <input type="number" min={1250} max={1349} step={1} value={yearText} onChange={e=>setYearText(e.target.value)} data-testid="branch-fork-year"/>
        </label>
        <label>続ける年数
          <input type="number" min={1} max={100} step={1} value={durationText} onChange={e=>setDurationText(e.target.value)} data-testid="branch-duration"/>
        </label>
      </div>
      <h3 className="step-title"><span className="step-no">2</span>再計算する</h3>
      <button type="submit" disabled={!canRun||!!p.running||!!p.fetchingCandidates||!!p.observationLoading} data-testid="branch-run" className="cta">介入して再計算</button>
      {p.running&&<button type="button" onClick={p.onCancel} data-testid="branch-cancel">計算をキャンセル</button>}
      <span className="note"> {mode==='INTEGRATED_EXPERIMENTAL'
        ?`初期入力例：${personName(INTEGRATED_PLAY_DEFAULTS.pair[0])}と${personName(INTEGRATED_PLAY_DEFAULTS.pair[1])}、${INTEGRATED_PLAY_DEFAULTS.year}年、${INTEGRATED_PLAY_DEFAULTS.signedDelta}、${INTEGRATED_PLAY_DEFAULTS.durationYears}年間（seed ${INTEGRATED_PLAY_DEFAULTS.seed}）。`
        :`例：${personName(PLAY_DEMO_PAIR[0])}と${personName(PLAY_DEMO_PAIR[1])}、${mode==='ORDINARY_LAW'?'1250':'1260'}年、+20、5年。`}出生・相続・委任は実計算の結果次第です。</span>
    </form>
    {activeSet&&yearOk&&!personsOk&&<p role="status" className="missing" data-testid="branch-person-invalid">選択中の人物は{year}年初のA0に存在しない（または直接介入できない）ため、再計算できません。表示された候補から選び直してください。</p>}
    {!valid&&<p role="status" className="missing" data-testid="branch-invalid">seed、介入年、相異なる2人、0以外の補正値、1350年を超えない期間を指定してください。</p>}
    {p.running&&<p role="status" className="note" data-testid="branch-running">
      計算中です（経過 {p.running.elapsedSec}秒）。完了までの目安は測れないため表示しません。この間も年表・地図の閲覧など他の操作ができます。
    </p>}
    {(p.running||p.progressEnd)&&<div className="note" data-testid="branch-progress">
      <p><strong>{p.progressEnd?`途中経過（未確定）：${END_LABEL[p.progressEnd]}`:'途中経過（未確定）'}</strong>
        ：下の数値は確定済みの年までです。最終結果・勝敗ではありません。</p>
      <ul>
        <ProgressLine label="A0" p={p.progress?.a0} ended={!!p.progressEnd} reused={p.a0Reused}/>
        <ProgressLine label="A1" p={p.progress?.a1} ended={!!p.progressEnd}/>
        {(p.progress?.a2||p.comparison?.second)&&<ProgressLine label="A2" p={p.progress?.a2} ended={!!p.progressEnd}/>}
      </ul>
    </div>}
    {p.notice&&<p role="status" className="note" data-testid="branch-notice">{p.notice}</p>}
    {p.error&&<p role="alert" className="halt" data-testid="branch-error">{errorHeading(p.error.code)}: {p.error.code} / {p.error.message}</p>}
    {!p.comparison&&<p className="note" data-testid="branch-empty">まだ比較結果はありません。上の「介入して再計算」を押すと、ここにA0/A1の違いが表示されます。</p>}
    {p.comparison&&p.comparison.mode==='INTEGRATED_EXPERIMENTAL'&&mode===p.comparison.mode&&
      Number(p.seedText.trim())===p.comparison.input.seed&&
      <FollowupInterventionPanel
        key={JSON.stringify([p.comparison.input.seed,p.comparison.input.year,p.comparison.input.firstPersonId,
          p.comparison.input.secondPersonId,p.comparison.input.signedDelta,p.comparison.input.durationYears])}
        comparison={p.comparison} year={p.year} activeBranch={p.activeBranch} busy={!!p.running||!!p.fetchingCandidates}
        onRun={p.onRun} onViewA2={()=>p.onViewBranch('A2')}/>
    }
    {p.comparison&&input&&before&&after&&<div data-testid="branch-results" className="compare-results">
      <section className="effect-summary" id="effect-summary" data-testid="effect-summary" aria-labelledby="effect-summary-heading">
        <h3 id="effect-summary-heading">この介入で、実際に何が変わった？</h3>
        <p>選んだ2人：<strong>{personName(pair[0])} と {personName(pair[1])}</strong></p>
        <p data-testid="effect-input">介入条件：{input.year}年から{input.durationYears}年間、2人の信頼を
          <strong>{input.signedDelta>0?'+':''}{input.signedDelta}</strong>補正。これは入力値であり、歴史の結果とは別です。</p>
        <div className="effect-cards">
          <div className="effect-card" data-testid="effect-judgement">
            <h4>対象の判断（{p.year}年）</h4>
            <p>A0 {traceA0?.status??'記録なし'}（スコア {score(traceA0)}） → A1 {traceA1?.status??'記録なし'}（スコア {score(traceA1)}）</p>
            <p className="note">{!traceA0&&!traceA1?'この年の対象B-004判断は記録されていません。':
              traceA0?.status===traceA1?.status?'判断の採否は変わっていません。':'判断の採否に違いが確認されました。'}</p>
          </div>
          <div className="effect-card" data-testid="effect-year-events">
            <h4>確定した出来事（{p.year}年）</h4>
            <p>A0/A1の差分：<strong>{eventRows.length}件</strong>（選んだ2人・子 {focused.length}件 / その他 {other.length}件）</p>
            <p className="note">{eventRows.length===0
              ?'この年の確定Eventに差はありません。後年の出来事や判断まで同一とは限りません。'
              :'この年に実Eventの追加・消失・内容差が記録されています。下の一覧から出典を確認できます。'}</p>
          </div>
          <div className="effect-card" data-testid="effect-technical-goal">
            <h4>1350年の王朝存続条件（技術判定）</h4>
            <p>A0 {trialGoalStatus(goalA0)} → A1 {trialGoalStatus(goalA1)}</p>
            <p className="note">{goalA0?.status===goalA1?.status
              ?'技術判定の達成状態は変わっていません。Title別の不足理由には違いがある可能性があります。'
              :'技術判定の状態に違いがあります。詳細は土地Title別の評価で確認できます。'}</p>
            {p.comparison.second&&<p data-testid="effect-a2-goal">A2（第2介入後）：{trialGoalStatus(p.comparison.second.a1.result.technicalGoal)}</p>}
          </div>
        </div>
        <p className="note">A0/A1は同じseed・実行構成で再計算しています。確認した差を表示しており、この介入だけが原因と断定しません。正式な勝敗は未成立です。</p>
      </section>
      <h3 className="step-title"><span className="step-no">3</span>同じ年のA0/A1を詳しく比べる</h3>
      <div className="headline" data-testid="branch-headline">
        <p><strong>{personName(pair[0])}と{personName(pair[1])}</strong>（{p.year}年）</p>
        <ul>
          <li>対象の判断（B-004）: A0 {traceA0?.status??'判定なし'} → A1 {traceA1?.status??'判定なし'}{decisionChanged?'（変化あり）':'（変化なし）'}</li>
          <li data-testid="headline-focused">選んだ2人とその子のEvent差分（{p.year}年・{focused.length}件）: {focused.length===0?'なし':byType(focused).join(' ／ ')}</li>
          <li data-testid="headline-other">その他の人物・集団のEvent差分（{p.year}年・{other.length}件）: {other.length===0?'なし':tally(other)}</li>
        </ul>
        <p className="note">「A1にだけ記録」は、介入ありの歴史にだけ確定したEventです（A0にだけ記録はその逆）。</p>
        <p className="note">正式勝敗: 未成立。これは試験版の差分であり、単独原因の断定ではありません。</p>
      </div>
      {p.comparison.mode==='INTEGRATED_EXPERIMENTAL'&&<IntegratedOverview view={p.comparison} calc={p.calc}
        personLabel={personName} onInspectEvent={p.onInspectEvent} onInspectTrace={p.onInspectTrace}/>}
      <div className="headline" data-testid="trial-goal-summary">
        <h4>1350年のナルヴェン王朝存続条件（試験判定）</h4>
        <p data-testid="trial-goal-mode">試験方式：{playModeLabel(p.comparison.mode)}</p>
        <p data-testid="trial-goal-a0">A0（介入なし）: {trialGoalStatus(p.comparison.a0.result.technicalGoal)}</p>
        <p data-testid="trial-goal-a1">A1（介入あり）: {trialGoalStatus(p.comparison.a1.result.technicalGoal)}</p>
        <details>
          <summary>中央世襲所領について、判定根拠を見る</summary>
          <p data-testid="trial-goal-reasons-a0">A0: {centralTitleEvidence(p.comparison.a0.result.technicalGoal)}</p>
          <p data-testid="trial-goal-reasons-a1">A1: {centralTitleEvidence(p.comparison.a1.result.technicalGoal)}</p>
        </details>
        <details data-testid="trial-goal-all-titles">
          <summary>すべての土地Titleの条件不足をA0/A1で比べる</summary>
          {titleIds.length===0?<p>土地Titleの評価記録はありません。</p>:(
            <table aria-label="1350年の土地Title別技術判定">
              <thead><tr><th scope="col">土地Title</th><th scope="col">A0 介入なし</th><th scope="col">A1 介入あり</th></tr></thead>
              <tbody>{titleIds.map(id=><tr key={id} data-testid={'trial-goal-title-'+id}>
                <th scope="row">{titleLabel(id)}</th>
                <td>{titleGoalEvidence(goalA0,id)}</td>
                <td>{titleGoalEvidence(goalA1,id)}</td>
              </tr>)}</tbody>
            </table>
          )}
          <p className="note">各行は1350年の実Titleと既存のevaluateGoal判定に基づきます。未確定の保持者・承認・統治権限を補完せず、正式勝敗ではありません。</p>
        </details>
        <p className="note">実計算した1350年のWorldStateを既存の厳格Goalで照合した非権威の検証値です。発行者に関する通常法制のDEC-057は採用されていますが、現在の法令・契約・適格性の具体値は試験用で、全37ルールも未完成のため、正式勝敗を表しません。</p>
      </div>
      <details className="panel" data-testid="trial-continuity">
        <summary>1250〜1350年の出生・家系・Title・委任の記録を見る</summary>
        <p className="note">現実に記録された親子関係のみを追跡します。1250年初期の人物から子が生まれれば1世代、そこから孫が生まれて初めて2世代と数えます。法的王朝所属は推定しません。</p>
        <div className="comparison-columns">
          {continuityPanel(continuityA0,'A0')}
          {continuityPanel(continuityA1,'A1')}
        </div>
        {p.comparison.mode==='ORDINARY_LAW'&&<p className="note">
          国内通常法制の試験セットでは、カルドン家の人物05とヴァルガス家の人物04の婚姻は無条項契約の想定です。子の王朝は明示契約がない限り未確定です。ナルヴェン家の人物02・05には契約候補が複数あり、法制試験では恣意的に選びません。
        </p>}
      </details>
      <div className="filters" aria-label="観測する歴史">
        <button type="button" aria-pressed={p.activeBranch==='A0'} onClick={()=>p.onViewBranch('A0')} data-testid="view-a0">A0 原史を観測</button>
        <button type="button" aria-pressed={p.activeBranch==='A1'} onClick={()=>p.onViewBranch('A1')} data-testid="view-a1">A1 改変史を観測</button>
        <span data-testid="active-branch">地図・年表で表示中: {p.activeBranch}</span>
      </div>
      <p className="note" data-testid="branch-comparison-year">
        比較年: {p.year}年（年初WorldState）。年を変えるには右の「④ 理由を確認する」の年スライダーを使います。1350年は評価専用です。
      </p>
      <div className="comparison-columns">
        <div data-testid="branch-snapshot-a0"><h4>A0 介入なし</h4>{summarize(before)}
          <p data-testid="branch-b004-a0">対象の判断: {traceA0?.status??'判定なし'}（試験スコア {score(traceA0)}）</p>
        </div>
        <div data-testid="branch-snapshot-a1"><h4>A1 介入あり</h4>{summarize(after)}
          <p data-testid="branch-b004-a1">対象の判断: {traceA1?.status??'判定なし'}（試験スコア {score(traceA1)}）</p>
        </div>
      </div>
      <h4>この年に変わったEvent</h4>
      <p className="note" data-testid="branch-event-count">
        選んだ2人とその子: {focused.length}件 / その他の人物・集団: {other.length}件（いずれも{p.year}年のEvent差分）。押すと右の「④ 理由を確認する」に詳細を開きます。
      </p>
      {eventRows.length===0?<p data-testid="branch-no-diff">この年に異なるEventはありません。</p>:(
        <div data-testid="branch-event-diffs">
          {([['選んだ2人とその子の変化',focused],['その他の人物・集団の変化',other]] as const).map(([label,rows])=><div key={label}>
            <h5>{label}（{rows.length}件）</h5>
            <ul className="compare-event-list">{rows.slice(0,12).map(eventButton)}</ul>
            {rows.length>12&&<details><summary>その他{rows.length-12}件を開く</summary>
              <ul className="compare-event-list">{rows.slice(12).map(eventButton)}</ul></details>}
          </div>)}
        </div>
      )}
      <details className="dev-details" data-testid="branch-dev-details">
        <summary>開発・検証情報（Trace差分・seed・状態）</summary>
        <p data-testid="branch-status" className="note">
          A0 {p.comparison.a0.result.status} / A1 {p.comparison.a1.result.status} /
          seed {input.seed} / 介入 {input.year}年〜{input.year+input.durationYears-1}年 / 補正 {input.signedDelta>0?'+':''}{input.signedDelta} /
          正式勝敗: 未成立（goal=null）/ CALIBRATION_ONLY
        </p>
        <p className="note" data-testid="branch-trace-ids">対象のTrace: A0 {traceA0?.traceId??'—'} / A1 {traceA1?.traceId??'—'}</p>
        <h5>DecisionTraceの差分（{data?.traces.length??0}件）</h5>
        {data&&<p className="note" data-testid="branch-trace-summary">
          判断の意味（年・段階・規則・対象者）で一対一に対応: {data.traceSummary.matched}件
          （同一 {data.traceSummary.unchanged} / 変化 {data.traceSummary.changed}）/
          A1で新規 {data.traceSummary.a1Only}件 / A1で消滅 {data.traceSummary.a0Only}件 /
          対応不明 {data.traceSummary.ambiguousTraces}件（比較しません）
        </p>}
        {data?.traces.length===0?<p>この年の判断Traceに差分はありません。</p>:
          <ul data-testid="branch-trace-diffs" className="compare-trace-list">
            {data?.traces.map(tr=><li key={tr.kind+tr.traceId+(tr.before?.traceId??'')}>{tr.ruleId} / {
              tr.kind==='AMBIGUOUS'?`対応不明（A0 ${tr.ambiguousBefore?.length}件 / A1 ${tr.ambiguousAfter?.length}件。同じ判断か決められないため比較しません）`
              :tr.kind==='A1_ONLY'?`A1で新規 ${tr.after?.traceId}`
              :tr.kind==='A0_ONLY'?`A1で消滅 ${tr.before?.traceId}`
              :`A0 ${tr.before?.traceId} → A1 ${tr.after?.traceId}（A0 ${tr.before?.status} → A1 ${tr.after?.status}）`}
            </li>)}
          </ul>}
        <p className="note">未承認の法制判断はDEFER/PENDINGを維持します。</p>
      </details>
    </div>}
  </section>
}
