// A0/A1の試験用介入操作。描画用の差分は実WorldState/EventLog/DecisionTraceからのみ取得する。
// GAME-01〜05と正式勝敗は未成立。CALIBRATION_ONLYの明示法的承認だけを試験で注入する。
import { useState } from 'react'
import { compareYear, directlyInvolvesPair, playPersonOptions, PLAY_DEMO_DELTA, PLAY_DEMO_DURATION, PLAY_DEMO_PAIR, PLAY_DEMO_YEAR } from './branch-play-source.ts'
import type { BranchChoice, PlayComparison, PlayInput } from './branch-play-source.ts'

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
const countAlive=(c:readonly {alive:boolean}[])=>c.filter(x=>x.alive).length
const countMarried=(w:{legal:{marriages:readonly {status:string}[]}})=>w.legal.marriages.filter(m=>m.status==='ACTIVE').length
const countHeld=(w:{titles:readonly {holder:{status:string}}[]})=>w.titles.filter(t=>t.holder.status==='HELD').length

export function InterventionComparePanel(p:Props){
  const [yearText,setYearText]=useState(String(PLAY_DEMO_YEAR))
  const [firstId,setFirstId]=useState(PLAY_DEMO_PAIR[0])
  const [secondId,setSecondId]=useState(PLAY_DEMO_PAIR[1])
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
  const pair=input?[input.firstPersonId,input.secondPersonId].sort() as [string,string]:PLAY_DEMO_PAIR
  const b4=(choice:BranchChoice)=>p.comparison?.[choice.toLowerCase() as 'a0'|'a1'].result.decisionTraces.find(t=>
    t.year===p.year&&t.ruleId==='B-004'&&t.actorRef.kind==='PERSON_PAIR'&&
    t.actorRef.ids[0]===pair[0]&&t.actorRef.ids[1]===pair[1])
  const traceA0=b4('A0'),traceA1=b4('A1')
  const score=(t:typeof traceA0)=>t?.candidates[0]?.score===undefined?'—':String(t.candidates[0].score)
  const eventRows=(data?.events??[]).map(x=>({
    ...x,focus:directlyInvolvesPair(x.event,pair),
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
  return <section className="panel intervention-panel" aria-labelledby="branch-heading" data-testid="branch-compare-panel">
    <h2 id="branch-heading">歴史に介入する・A0/A1比較（試験版）</h2>
    <p className="note">1250〜1350年の実WorldStateを再計算します。婚姻の法的承認は1260年の試験用P4/P5証拠だけで、正式な勝敗や全自律歴史ではありません。</p>
    <form className="filters compare-form" onSubmit={e=>{
      e.preventDefault()
      if(valid)p.onRun({seed,year,firstPersonId:firstId,secondPersonId:secondId,
        signedDelta:delta,durationYears:duration})
    }}>
      <label>介入年
        <input type="number" min={1250} max={1349} step={1} value={yearText} onChange={e=>setYearText(e.target.value)} data-testid="branch-fork-year"/>
      </label>
      <label>人物1
        <select value={firstId} onChange={e=>setFirstId(e.target.value)} data-testid="branch-person-one">
          {persons.map(x=><option key={x.id} value={x.id}>{x.label}</option>)}
        </select>
      </label>
      <label>人物2
        <select value={secondId} onChange={e=>setSecondId(e.target.value)} data-testid="branch-person-two">
          {persons.map(x=><option key={x.id} value={x.id}>{x.label}</option>)}
        </select>
      </label>
      <label>pair.trust補正（試験値）
        <input type="number" min={-200} max={200} step={1} value={deltaText} onChange={e=>setDeltaText(e.target.value)} data-testid="branch-trust-delta"/>
      </label>
      <label>持続年数
        <input type="number" min={1} max={100} step={1} value={durationText} onChange={e=>setDurationText(e.target.value)} data-testid="branch-duration"/>
      </label>
      <button type="submit" disabled={!valid} data-testid="branch-run">介入して再計算</button>
    </form>
    {!valid&&<p role="status" className="missing" data-testid="branch-invalid">seed、介入年、相異なる2人、0以外の補正値、1350年を超えない期間を指定してください。</p>}
    {p.error&&<p role="alert" className="halt" data-testid="branch-error">計算不成立（敗北ではありません）: {p.error.code} / {p.error.message}</p>}
    {p.comparison&&input&&before&&after&&<div data-testid="branch-results" className="compare-results">
      <p data-testid="branch-status" className="note">
        A0 {p.comparison.a0.result.status} / A1 {p.comparison.a1.result.status} /
        seed {input.seed} / 介入 {input.year}年〜{input.year+input.durationYears-1}年 / 補正 {input.signedDelta>0?'+':''}{input.signedDelta} /
        正式勝敗: 未成立（goal=null）
      </p>
      <div className="filters" aria-label="観測する歴史">
        <button type="button" aria-pressed={p.activeBranch==='A0'} onClick={()=>p.onViewBranch('A0')} data-testid="view-a0">A0 原史を観測</button>
        <button type="button" aria-pressed={p.activeBranch==='A1'} onClick={()=>p.onViewBranch('A1')} data-testid="view-a1">A1 改変史を観測</button>
        <span data-testid="active-branch">既存の地図・年表を表示中: {p.activeBranch}</span>
      </div>
      <p className="note" data-testid="branch-comparison-year">
        比較年: {p.year}年（年初WorldState）。年内Event/Traceは右の年スライダーに同期。1350年は評価専用です。
      </p>
      <div className="comparison-columns">
        <div data-testid="branch-snapshot-a0"><h3>A0 介入なし</h3>{summarize(before)}
          <p data-testid="branch-b004-a0">B-004対象判断: {traceA0?.status??'判定なし'} / 試験スコア {score(traceA0)} / {traceA0?.traceId??'—'}</p>
        </div>
        <div data-testid="branch-snapshot-a1"><h3>A1 介入あり</h3>{summarize(after)}
          <p data-testid="branch-b004-a1">B-004対象判断: {traceA1?.status??'判定なし'} / 試験スコア {score(traceA1)} / {traceA1?.traceId??'—'}</p>
        </div>
      </div>
      <h3>確定Eventの差分（{p.year}年）</h3>
      <p className="note" data-testid="branch-event-count">
        選んだ人物に直接関与: {focused.length}件 / その他の世界変化: {other.length}件。Event差分は変更の証拠であり、単独原因の断定ではありません。
      </p>
      {eventRows.length===0?<p data-testid="branch-no-diff">この年に異なるEventはありません。</p>:(
        <div data-testid="branch-event-diffs">
          {([['注目人物への変化',focused],['それ以外の変化',other]] as const).map(([label,rows])=><div key={label}>
            <h4>{label}（{rows.length}件）</h4>
            <ul className="compare-event-list">
              {rows.slice(0,12).map(({kind,event},i)=><li key={event.eventId+kind+i}>
                <button type="button" onClick={()=>p.onInspectEvent(kind==='A0_ONLY'?'A0':'A1',event.eventId)}>
                  {kind==='A0_ONLY'?'A0のみ':kind==='A1_ONLY'?'A1のみ':'同IDで内容変化'} /
                  {event.year}年 {event.eventType} / 根拠Trace {event.sourceTraceIds.join('、')}
                </button>
              </li>)}
            </ul>
            {rows.length>12&&<details><summary>その他{rows.length-12}件を開く</summary><ul className="compare-event-list">
              {rows.slice(12).map(({kind,event},i)=><li key={event.eventId+kind+i}>
                <button type="button" onClick={()=>p.onInspectEvent(kind==='A0_ONLY'?'A0':'A1',event.eventId)}>
                  {kind} / {event.year}年 {event.eventType} / {event.eventId}
                </button>
              </li>)}
            </ul></details>}
          </div>)}
        </div>
      )}
      <h3>DecisionTraceの差分（{data?.traces.length??0}件）</h3>
      {data?.traces.length===0?<p>この年の判断Traceに差分はありません。</p>:
        <ul data-testid="branch-trace-diffs" className="compare-trace-list">
          {data?.traces.slice(0,12).map(tr=><li key={tr.traceId}>{tr.ruleId} / {tr.traceId} /
            A0 {tr.before?.status??'なし'} → A1 {tr.after?.status??'なし'}
          </li>)}
          {(data?.traces.length??0)>12&&<li><details><summary>残り{data!.traces.length-12}件</summary>
            <ul>{data!.traces.slice(12).map(tr=><li key={tr.traceId}>{tr.ruleId} / {tr.traceId} / A0 {tr.before?.status??'なし'} → A1 {tr.after?.status??'なし'}</li>)}</ul>
          </details></li>}
        </ul>}
      <p className="note">Eventを選ぶと、選択した枝の既存年表で状態差分と判断Traceの参照を開きます。未承認の法制判断はDEFER/PENDINGを維持します。</p>
    </div>}
  </section>
}
