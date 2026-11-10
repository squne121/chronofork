// 承認済みの同年・別対象pair.trust介入をA1へ追加し、A2をforkHistoryで再計算するための最小UI。
import {useMemo,useState} from 'react'
import type {PlayInput,PlayView} from './branch-play-source.ts'
import {compareYear} from './branch-play-source.ts'
import {extractCandidates,candidatesAtYear,candidateLabel} from './play-candidates.ts'

type Props=Readonly<{
  comparison:PlayView
  year:number
  activeBranch:'A0'|'A1'|'A2'
  busy:boolean
  onRun:(input:PlayInput)=>void
  onViewA2:()=>void
}>

const trialGoal=(view:PlayView['a0']):string=>{
  const status=view.result.technicalGoal?.status
  return status==='ACHIEVED'?'ACHIEVED（技術検証）':status==='NOT_ACHIEVED'?'NOT_ACHIEVED（技術検証）':status??'NOT_EVALUATED'
}

export function FollowupInterventionPanel({comparison,year,activeBranch,busy,onRun,onViewA2}:Props){
  const initial=comparison.input
  const [firstId,setFirstId]=useState('')
  const [secondId,setSecondId]=useState('')
  const [deltaText,setDeltaText]=useState('-200')
  const [durationText,setDurationText]=useState('60')
  // A1の実年初snapshotから対象を選ぶ。A0の未来・A2でだけ生まれた人物は混ぜない。
  const candidates=useMemo(()=>candidatesAtYear(
    extractCandidates(initial.seed,comparison.mode,comparison.a1.result.snapshots),initial.year
  ),[comparison.a1.result.snapshots,comparison.mode,initial.seed,initial.year])
  const optionIds=new Set(candidates.map(c=>c.id))
  const normalized=(a:string,b:string)=>[a,b].sort().join('\u0000')
  const oldPair=normalized(initial.firstPersonId,initial.secondPersonId)
  const anotherPair=firstId!==secondId&&normalized(firstId,secondId)!==oldPair
  const delta=Number(deltaText),duration=Number(durationText)
  const valid=optionIds.has(firstId)&&optionIds.has(secondId)&&anotherPair&&
    /^-?\d+$/.test(deltaText)&&Number.isSafeInteger(delta)&&delta!==0&&Math.abs(delta)<=200&&
    /^\d+$/.test(durationText)&&Number.isSafeInteger(duration)&&duration>0&&initial.year+duration<=1350
  const result=comparison.second
  const diff=result?compareYear(result,year):undefined
  const central=result?.a1.result.technicalGoal?.status==='ACHIEVED'
    ?result.a1.result.technicalGoal.assessments.find(x=>x.titleId==='title-exp-central')
    :result?.a1.result.technicalGoal?.status==='NOT_ACHIEVED'
    ?result.a1.result.technicalGoal.assessments.find(x=>x.titleId==='title-exp-central'):undefined

  return <section className="panel" data-testid="a2-panel" aria-labelledby="a2-heading">
    <h3 id="a2-heading">第2介入：A1からA2を作る（試験版）</h3>
    <p className="note" data-testid="a2-parent">
      第1介入は{initial.year}年の{initial.firstPersonId.length>22?'人物ID長文':initial.firstPersonId}と
      {initial.secondPersonId.length>22?'人物ID長文':initial.secondPersonId}の信頼{initial.signedDelta>0?'+':''}{initial.signedDelta}・
      {initial.durationYears}年間。この介入を保持し、同年の別の2人に追加します。
      1250年以前の出来事や法的権利を直接変更しません。
    </p>
    <form onSubmit={e=>{
      e.preventDefault()
      if(!valid||busy)return
      onRun({...initial,second:{firstPersonId:firstId,secondPersonId:secondId,signedDelta:delta,durationYears:duration}})
    }}>
      <div className="form-grid">
        <label>第2介入の人物1
          <select data-testid="a2-person-one" value={firstId} disabled={busy} onChange={e=>setFirstId(e.target.value)}>
            <option value="">人物を選択</option>
            {candidates.map(c=><option key={c.id} value={c.id}>{candidateLabel(c)}</option>)}
          </select>
        </label>
        <label>第2介入の人物2
          <select data-testid="a2-person-two" value={secondId} disabled={busy} onChange={e=>setSecondId(e.target.value)}>
            <option value="">人物を選択</option>
            {candidates.map(c=><option key={c.id} value={c.id}>{candidateLabel(c)}</option>)}
          </select>
        </label>
        <label>追加の信頼補正
          <input data-testid="a2-delta" type="number" min={-200} max={200} step={1} value={deltaText}
            disabled={busy} onChange={e=>setDeltaText(e.target.value)}/>
        </label>
        <label>追加の期間（{initial.year}年から）
          <input data-testid="a2-duration" type="number" min={1} max={1350-initial.year} step={1}
            disabled={busy} value={durationText} onChange={e=>setDurationText(e.target.value)}/>
        </label>
      </div>
      <button type="submit" className="cta" data-testid="a2-run" disabled={!valid||busy}>第2介入を追加してA2を再計算</button>
      {firstId&&secondId&&!anotherPair&&<p className="missing" data-testid="a2-duplicate">同年・同じ人物ペアへの重複介入はできません。</p>}
      <p className="note">同じ{initial.year}年のA1実WorldStateが対象です。別の年への再介入・A3以降はこの試験UIではまだ扱いません。</p>
    </form>
    {result&&diff&&<div data-testid="a2-results">
      <h4>A1とA2の実差分（{year}年）</h4>
      <p data-testid="a2-goal-summary">
        1350年の厳格技術Goal: A0 {trialGoal(comparison.a0)} ／ A1 {trialGoal(comparison.a1)}
        ／ A2 <strong>{trialGoal(result.a1)}</strong>。正式勝敗は未成立（goal=null）。
      </p>
      <p data-testid="a2-difference-count">
        Event差分 {diff.events.length}件 ／ DecisionTrace差分 {diff.traces.length}件（同一 {diff.traceSummary.unchanged}件）。
      </p>
      <p data-testid="a2-title-basis">
        中央世襲Title: {central?.qualifies?'条件成立':central?.failures.join('、')||'評価記録なし'}
        {central?.basis?.kind==='CONTROL_MANDATE'?'（実効統治: 新規ControlMandate）':''}
      </p>
      <button type="button" data-testid="view-a2" aria-pressed={activeBranch==='A2'} onClick={onViewA2}>A2を地図・年代記で観測する</button>
      <p className="note">A0/A1の記録はそのまま残ります。右の年代記でA2の実EventとDecisionTraceを確認できます。</p>
    </div>}
  </section>
}
