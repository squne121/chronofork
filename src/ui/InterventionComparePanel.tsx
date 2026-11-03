// A0/A1の試験用介入操作。描画用の差分は実WorldState/EventLog/DecisionTraceからのみ取得する。
// GAME-01〜05と正式勝敗は未成立。CALIBRATION_ONLYの明示法的承認だけを試験で注入する。
import { useState } from 'react'
import { compareYear, directlyInvolvesPair, playPersonOptions, playModeLabel, PLAY_DEFAULT_MODE, PLAY_DEMO_DELTA, PLAY_DEMO_DURATION, PLAY_DEMO_PAIR, PLAY_DEMO_YEAR } from './branch-play-source.ts'
import { observeDynastyContinuity } from './dynasty-continuity.ts'
import type { ContinuityObservation } from './dynasty-continuity.ts'
import { NALVEN_DYNASTY_ID } from '../scenario/experimental/index.ts'
import { childIdsOfPair } from './event-summary.ts'
import type { BranchChoice, PlayComparison, PlayInput, PlayMode } from './branch-play-source.ts'
import type { GoalEvaluation, GoalFailureCode } from '../simulation/goal.ts'

type Props=Readonly<{
  seedText:string
  year:number
  comparison?:PlayComparison
  error?:Readonly<{code:string;message:string}>
  activeBranch:BranchChoice
  onRun:(input:PlayInput)=>void
  onViewBranch:(choice:BranchChoice)=>void
  onInspectEvent:(choice:BranchChoice,id:string)=>void
}>
const persons=playPersonOptions()
/** 既知のEvent種別だけ平易な見出しを付ける。未知の種別は生の種別名をそのまま出す（用語を創作しない）。 */
const EVENT_LABEL:Readonly<Record<string,string>>={MARRIAGE_REGISTER:'婚姻の成立',PERSON_BIRTH:'人物の出生',LEGAL_DYNASTY_SET:'法的王朝の確定'}
const eventLabel=(t:string)=>EVENT_LABEL[t]?`${EVENT_LABEL[t]}（${t}）`:t
const kindLabel=(k:'A0_ONLY'|'A1_ONLY'|'CHANGED')=>k==='A0_ONLY'?'A0にだけ記録':k==='A1_ONLY'?'A1にだけ記録':'A0/A1で内容が違う'
const personName=(id:string)=>persons.find(x=>x.id===id)?.label??id
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
const centralTitleEvidence=(g:GoalEvaluation|null):string=>{
  if(g===null||g.status==='INVALID_INPUT'||g.status==='NOT_EVALUABLE')return '判定根拠なし'
  const a=g.assessments.find(x=>x.titleId==='title-exp-central')
  if(!a)return '中央世襲所領の評価記録なし'
  return a.qualifies?'中央世襲所領は条件に一致':`中央世襲所領: ${a.failures.map(x=>GOAL_FAILURE_LABEL[x]).join('、')}`
}
const countAlive=(c:readonly {alive:boolean}[])=>c.filter(x=>x.alive).length
const countMarried=(w:{legal:{marriages:readonly {status:string}[]}})=>w.legal.marriages.filter(m=>m.status==='ACTIVE').length
const countHeld=(w:{titles:readonly {holder:{status:string}}[]})=>w.titles.filter(t=>t.holder.status==='HELD').length

export function InterventionComparePanel(p:Props){
  const [mode,setMode]=useState<PlayMode>(PLAY_DEFAULT_MODE)
  const [yearText,setYearText]=useState(String(PLAY_DEMO_YEAR))
  const [firstId,setFirstId]=useState<string>(PLAY_DEMO_PAIR[0])
  const [secondId,setSecondId]=useState<string>(PLAY_DEMO_PAIR[1])
  const [deltaText,setDeltaText]=useState(String(PLAY_DEMO_DELTA))
  const [durationText,setDurationText]=useState(String(PLAY_DEMO_DURATION))
  const seed=Number(p.seedText.trim())
  const year=Number(yearText),delta=Number(deltaText),duration=Number(durationText)
  const valid=/^\d+$/.test(p.seedText.trim())&&Number.isSafeInteger(seed)&&seed>=0 &&
    /^\d+$/.test(yearText)&&Number.isSafeInteger(year)&&year>=1250&&year<1350 &&
    /^-?\d+$/.test(deltaText)&&Number.isSafeInteger(delta)&&delta!==0&&Math.abs(delta)<=200 &&
    /^\d+$/.test(durationText)&&Number.isSafeInteger(duration)&&duration>=1&&year+duration<=1350 &&
    firstId!==secondId
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
      <select data-testid="play-law-mode" value={mode} onChange={e=>{
        const next=e.target.value as PlayMode
        setMode(next)
        // 1250年からの介入が国内法制の差分を観測しやすい初期例。実際のイベント年は固定しない。
        if(next==='ORDINARY_LAW')setYearText('1250')
        else setYearText(String(PLAY_DEMO_YEAR))
      }}>
        <option value="FIXED_APPROVAL">旧・1260年の明示承認試験</option>
        <option value="ORDINARY_LAW">通常法制（experimental）</option>
      </select>
    </label>
    <p className="note" data-testid="play-mode-description">
      {mode==='ORDINARY_LAW'
        ?'同一国内の背景法令・当事者の試験適格性と、その年のB-005交渉意思から婚姻・相続・新委任を審査します。特定年の婚姻承認は予約しません。'
        :'従来の1260年限定の明示承認証拠による婚姻試験です。通常法制の自律承認ではありません。'}
    </p>
    {p.comparison&&p.comparison.mode!==mode&&<p className="note" role="status">
      表示中の比較は{playModeLabel(p.comparison.mode)}です。変更した方式を反映するには再計算してください。
    </p>}
    <form className="compare-form" onSubmit={e=>{
      e.preventDefault()
      if(valid)p.onRun({seed,year,firstPersonId:firstId,secondPersonId:secondId,
        signedDelta:delta,durationYears:duration,mode})
    }}>
      <div className="form-grid">
        <label>対象の人物1
          <select value={firstId} onChange={e=>setFirstId(e.target.value)} data-testid="branch-person-one">
            {persons.map(x=><option key={x.id} value={x.id}>{x.label}</option>)}
          </select>
        </label>
        <label>対象の人物2
          <select value={secondId} onChange={e=>setSecondId(e.target.value)} data-testid="branch-person-two">
            {persons.map(x=><option key={x.id} value={x.id}>{x.label}</option>)}
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
      <button type="submit" disabled={!valid} data-testid="branch-run" className="cta">介入して再計算</button>
      <span className="note"> 例：{personName(PLAY_DEMO_PAIR[0])}と{personName(PLAY_DEMO_PAIR[1])}、{mode==='ORDINARY_LAW'?'1250':'1260'}年、+20、5年。出生・相続・委任は実計算の結果次第です。</span>
    </form>
    {!valid&&<p role="status" className="missing" data-testid="branch-invalid">seed、介入年、相異なる2人、0以外の補正値、1350年を超えない期間を指定してください。</p>}
    {p.error&&<p role="alert" className="halt" data-testid="branch-error">計算不成立（敗北ではありません）: {p.error.code} / {p.error.message}</p>}
    {!p.comparison&&<p className="note" data-testid="branch-empty">まだ比較結果はありません。上の「介入して再計算」を押すと、ここにA0/A1の違いが表示されます。</p>}
    {p.comparison&&input&&before&&after&&<div data-testid="branch-results" className="compare-results">
      <h3 className="step-title"><span className="step-no">3</span>同じ年のA0/A1を比べる</h3>
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
        {data?.traces.length===0?<p>この年の判断Traceに差分はありません。</p>:
          <ul data-testid="branch-trace-diffs" className="compare-trace-list">
            {data?.traces.map(tr=><li key={tr.traceId}>{tr.ruleId} / {tr.traceId} /
              A0 {tr.before?.status??'なし'} → A1 {tr.after?.status??'なし'}
            </li>)}
          </ul>}
        <p className="note">未承認の法制判断はDEFER/PENDINGを維持します。</p>
      </details>
    </div>}
  </section>
}
