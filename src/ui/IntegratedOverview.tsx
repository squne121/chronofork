// 統合法制・世代継続(experimental)の結果一覧。出典・差分判定・経過・親子・Title。
// 実WorldState/EventLog/DecisionTraceの読み取りだけを表示し、正式勝敗・史実として扱わない。
import { useMemo } from 'react'
import { HistoricalChangesExplorer } from './HistoricalChangesExplorer.tsx'
import type { DecisionTrace } from '../simulation/contracts/index.ts'
import { INTEGRATED_PLAY_DEFAULTS, playModeLabel } from './branch-play-source.ts'
import type { BranchChoice, PlayView } from './branch-play-source.ts'
import { buildOverview, eventHeadline, lineageRows, namesOf, titleRows } from './integrated-overview.ts'
import type { LineageRow } from './integrated-overview.ts'

export type CalcInfo=Readonly<{computeMs:number;wallMs:number}>
type Props=Readonly<{
  view:PlayView
  calc?:CalcInfo
  personLabel:(id:string)=>string
  onInspectEvent:(choice:BranchChoice,id:string)=>void
  onInspectTrace:(choice:BranchChoice,id:string)=>void
}>
const sec=(ms:number)=>(ms/1000).toFixed(1)+'秒'
const MAX_LIST=40
const MAX_EVIDENCE_LINKS=8

function LineageTable({rows,label}:Readonly<{rows:readonly LineageRow[];label:string}>){
  return <details data-testid={'integrated-lineage-'+label.toLowerCase()}>
    <summary>{label}: 新しく生まれた人物 {rows.length}人（子 {rows.filter(r=>r.generation===1).length} / 孫以降 {rows.filter(r=>r.generation>=2).length}）</summary>
    {rows.length===0?<p>1250年以降に生まれた人物の記録はありません。</p>:(
      <table aria-label={label+'の親子関係と法的王朝'}>
        <thead><tr><th scope="col">人物</th><th scope="col">生年</th><th scope="col">世代</th><th scope="col">父</th><th scope="col">母</th><th scope="col">法的王朝</th><th scope="col">1350年</th></tr></thead>
        <tbody>{rows.map(r=><tr key={r.personId}>
          <th scope="row">{r.name}</th><td>{r.birthYear}</td>
          <td>{r.generation===1?'子':r.generation>=2?`${r.generation===2?'孫':r.generation+'世代目'}`:'不明'}</td>
          <td>{r.father}</td><td>{r.mother}</td><td>{r.dynasty}</td><td>{r.alive?'存命':'死亡'}</td>
        </tr>)}</tbody>
      </table>
    )}
  </details>
}

export function IntegratedOverview({view,calc,personLabel,onInspectEvent,onInspectTrace}:Props){
  const overview=useMemo(()=>buildOverview(view),[view])
  const final0=view.a0.result.snapshots.at(-1),final1=view.a1.result.snapshots.at(-1)
  const names0=useMemo(()=>namesOf(final0),[final0]),names1=useMemo(()=>namesOf(final1),[final1])
  const lin0=useMemo(()=>lineageRows(view.a0.initialWorld,final0),[view.a0.initialWorld,final0])
  const lin1=useMemo(()=>lineageRows(view.a1.initialWorld,final1),[view.a1.initialWorld,final1])
  const titles0=useMemo(()=>titleRows(final0),[final0]),titles1=useMemo(()=>titleRows(final1),[final1])
  const titleIds=[...new Set([...titles0,...titles1].map(t=>t.titleId))].sort()
  const input=view.input,om=view.displayOmission
  const noDiff=overview.totalDifferences===0&&overview.finalWorldIdentical===true
  const interventionTraces=useMemo(()=>
    view.a1.result.decisionTraces.filter(t=>t.modifierIds.includes(view.modifier.modifierId)),[view])
  const traceLink=(t:DecisionTrace)=><li key={t.traceId}>
    <button type="button" onClick={()=>onInspectTrace('A1',t.traceId)}>
      {t.year}年・{t.ruleId}・{t.status}（対応Event {t.eventIds.length}件）の判断根拠を開く
    </button>
  </li>
  const f=<T,>(rows:readonly T[],id:string)=>rows.find(r=>(r as {titleId:string}).titleId===id)
  return <div className="panel integrated-overview" data-testid="integrated-overview">
    <h3 className="step-title"><span className="step-no">3</span>統合モードの結果（{playModeLabel(view.mode)}）</h3>

    <details open data-testid="integrated-source">
      <summary>入力条件と計算結果の出典</summary>
      <dl className="compare-metrics">
        <dt>実行構成</dt><dd>createExperimentalIntegratedWorld / Evaluators（実装側の共通ファクトリ）</dd>
        <dt>seed</dt><dd>{input.seed}</dd>
        <dt>対象の2人</dt><dd>{personLabel(input.firstPersonId)}・{personLabel(input.secondPersonId)}</dd>
        <dt>介入</dt><dd>{input.year}年から{input.durationYears}年間、信頼 {input.signedDelta>0?'+':''}{input.signedDelta}</dd>
        <dt>計算範囲</dt><dd>1250年〜1350年（A0とA1で同じ初期世界・法令・評価器、A1だけ介入台帳を追加）</dd>
        {calc&&<><dt>実測時間（Worker内の計算）</dt><dd data-testid="integrated-compute-time">{sec(calc.computeMs)}</dd>
          <dt>実測時間（操作から表示まで）</dt><dd data-testid="integrated-wall-time">{sec(calc.wallMs)}</dd></>}
        <dt>正式勝敗 / 自律歴史</dt><dd>goal=null（未成立）/ NOT_ESTABLISHED</dd>
        <dt>未実装ルール</dt><dd>TODO {view.a1.result.coverage.todoRuleIds.length}件</dd>
      </dl>
      <p className="note" data-testid="integrated-defaults-note">
        初期入力例（seed {INTEGRATED_PLAY_DEFAULTS.seed}・{INTEGRATED_PLAY_DEFAULTS.year}年・{INTEGRATED_PLAY_DEFAULTS.signedDelta}・{INTEGRATED_PLAY_DEFAULTS.durationYears}年間）はPR #78で実測した CALIBRATION_ONLY の条件です。入力欄を変えた場合は、その値で再計算しています。史実・強制イベントではありません。
      </p>
      {om&&<p className="note" data-testid="integrated-omission">
        表示の省略（experimental試遊限定の技術的処置）: 計算した全件数は Event A0 {om.fullEventCount.a0}件 / A1 {om.fullEventCount.a1}件、Trace A0 {om.fullTraceCount.a0}件 / A1 {om.fullTraceCount.a1}件です。
        メモリ保護のため、A0/A1で内容が完全に同一の高頻度記録（{Object.entries(om.omittedEventsByType).map(([k,n])=>`${k} ${n}件`).join('、')||'なし'}、
        {Object.entries(om.omittedTracesByRule).map(([k,n])=>`${k}のTrace ${n}件`).join('、')||'なし'}）だけを、画面への転送と一覧表示から省略しています（省略件数は両枝共通の件数）。
        両枝で差のある記録は全て残しています。省略した個別の詳細は、現在のUIでは後から閲覧できません。
      </p>}
    </details>

    <div className="headline" data-testid="integrated-verdict">
      {noDiff
        ?<p><strong>A0とA1で、全期間のEventと1350年のWorldStateに差は確認されませんでした。</strong>比較したのはEventと1350年のWorldStateです（途中年の状態や判断Traceの違いは別に確認できます）。</p>
        :overview.totalDifferences===0&&overview.finalWorldIdentical===null
        ?<p><strong>Eventに差はありませんが、1350年のWorldStateを比較できませんでした（判定不能）。</strong></p>
        :<p><strong>A0とA1で差が確認されました:</strong> 全期間のEvent差分 {overview.totalDifferences}件
          {overview.finalWorldIdentical===false?' / 1350年のWorldStateも異なります':overview.finalWorldIdentical===true?' / 1350年のWorldStateは同一です':''}。</p>}
      <p data-testid="integrated-trace-use">介入が判断Traceに記録された件数: A0 {overview.interventionTraces.a0}件 / A1 {overview.interventionTraces.a1}件
        （A1側の判断の理由には介入が残ります。結果の差とは別です）。</p>
      {om&&<p className="note" data-testid="integrated-count-note">この画面のEvent/Trace件数は、同一記録を省略した後の表示分です（省略した個別詳細は閲覧できません）。全件数と省略件数は上の「入力条件と計算結果の出典」を参照してください。</p>}
      <p className="note">単独原因の断定ではなく、正式勝敗でもありません。差の理由は下のEventから「④ 理由を確認する」のDecisionTraceで辿れます。</p>
    </div>

    <HistoricalChangesExplorer rows={overview.rows} totalDifferences={overview.totalDifferences} worldA0={final0} worldA1={final1} onInspectEvent={onInspectEvent}/>

    <section aria-labelledby="integrated-evidence-heading" data-testid="integrated-evidence">
      <h4 id="integrated-evidence-heading">介入が参照された判断を調べる（A1）</h4>
      <p className="note">A1のDecisionTraceに今回の介入IDが記録された判断です。Eventが変わらなくても根拠を開けます。参照されたことは、判断結果や歴史が変化した証明ではありません。</p>
      {interventionTraces.length===0
        ?<p data-testid="integrated-no-evidence">表示可能なDecisionTraceには、この介入を参照した記録がありません。</p>
        :<>
          <p data-testid="integrated-evidence-count">介入を参照した判断Trace: {interventionTraces.length}件</p>
          <ul className="compare-trace-list" data-testid="integrated-evidence-links">
            {interventionTraces.slice(0,MAX_EVIDENCE_LINKS).map(traceLink)}
          </ul>
          {interventionTraces.length>MAX_EVIDENCE_LINKS&&<details>
            <summary>さらに{interventionTraces.length-MAX_EVIDENCE_LINKS}件の判断根拠を開く</summary>
            <ul className="compare-trace-list">{interventionTraces.slice(MAX_EVIDENCE_LINKS).map(traceLink)}</ul>
          </details>}
        </>}
    </section>

    <h4>1250〜1350年の経過（Event種別ごと）</h4>
    <table aria-label="Event種別ごとのA0/A1件数" data-testid="integrated-timeline-table">
      <thead><tr><th scope="col">種別</th><th scope="col">A0 介入なし</th><th scope="col">A1 介入あり</th><th scope="col">差分</th></tr></thead>
      <tbody>{overview.rows.map(r=><tr key={r.category.key} data-testid={'integrated-row-'+r.category.key}>
        <th scope="row">{r.category.label}</th><td>{r.a0.length}件</td><td>{r.a1.length}件</td>
        <td>{r.a1Only.length+r.a0Only.length+r.changed.length===0?'なし':`A1のみ ${r.a1Only.length} / A0のみ ${r.a0Only.length} / 内容差 ${r.changed.length}`}</td>
      </tr>)}</tbody>
    </table>
    {overview.rows.filter(r=>r.a0.length+r.a1.length>0).map(r=><details key={r.category.key} data-testid={'integrated-list-'+r.category.key}>
      <summary>{r.category.label}を年表で開く（A0 {r.a0.length}件）</summary>
      <ul className="compare-event-list">{r.a0.slice(0,MAX_LIST).map(e=><li key={e.eventId}>
        <button type="button" onClick={()=>onInspectEvent('A0',e.eventId)}>{eventHeadline(e,names0,r.category.label)}</button>
      </li>)}</ul>
      {r.a0.length>MAX_LIST&&<p className="note">ほか{r.a0.length-MAX_LIST}件は「④ 理由を確認する」の年表で表示できます。</p>}
      {[...r.a1Only,...r.changed].length>0&&<>
        <p>A1で追加・内容が違うEvent</p>
        <ul className="compare-event-list">{[...r.a1Only,...r.changed].slice(0,MAX_LIST).map(e=><li key={e.eventId}>
          <button type="button" onClick={()=>onInspectEvent('A1',e.eventId)}>{eventHeadline(e,names1,r.category.label)}</button>
        </li>)}</ul>
        {[...r.a1Only,...r.changed].length>MAX_LIST&&<p className="note">ほか{[...r.a1Only,...r.changed].length-MAX_LIST}件は「④ 理由を確認する」の年表で表示できます。</p>}</>}
      {r.a0Only.length>0&&<>
        <p>A0にだけ記録されたEvent（A1では記録なし）</p>
        <ul className="compare-event-list" data-testid={'integrated-a0-only-'+r.category.key}>
          {r.a0Only.slice(0,MAX_LIST).map(e=><li key={e.eventId}>
            <button type="button" onClick={()=>onInspectEvent('A0',e.eventId)}>{eventHeadline(e,names0,r.category.label)}</button>
          </li>)}
        </ul>
        {r.a0Only.length>MAX_LIST&&<p className="note">ほか{r.a0Only.length-MAX_LIST}件はA0の年表で確認できます。</p>}
      </>}
    </details>)}

    <h4>子・孫の実親子関係と法的王朝</h4>
    <p className="note">実際に記録された出生だけを数えます。法的王朝は婚姻契約などの根拠がある場合に確定し、無い場合は「未確定」のままです。</p>
    <LineageTable rows={lin0} label="A0"/>
    {lin1.length!==lin0.length||JSON.stringify(lin1)!==JSON.stringify(lin0)?<LineageTable rows={lin1} label="A1"/>
      :<p className="note" data-testid="integrated-lineage-same">A1の親子関係・法的王朝はA0と同一です。</p>}

    <h4>1350年の土地Title・相続・統治委任</h4>
    <table aria-label="1350年の土地Titleの保持者と相続・統治委任" data-testid="integrated-final-titles">
      <thead><tr><th scope="col">土地Title</th><th scope="col">保持者 A0</th><th scope="col">保持者 A1</th><th scope="col">相続PENDING件数 A0/A1</th><th scope="col">期間内の統治委任件数 A0/A1（法的有効性とは別）</th></tr></thead>
      <tbody>{titleIds.map(id=>{
        const a=f(titles0,id) as typeof titles0[number]|undefined,b=f(titles1,id) as typeof titles1[number]|undefined
        return <tr key={id}><th scope="row">{a?.region??b?.region}（{id}）</th><td>{a?.holder??'—'}</td><td>{b?.holder??'—'}</td>
          <td>{a?.pendingCases??'—'} / {b?.pendingCases??'—'}</td><td>{a?.mandatesInPeriod??'—'} / {b?.mandatesInPeriod??'—'}</td></tr>
      })}</tbody>
    </table>
    <p className="note">「保持者未確定」は保持者が決まっていない状態そのもので、相続PENDING件数は実際に記録された審査の件数です（未確定でも件数が0のことがあります）。「期間内の統治委任」は年の期間条件に合う記録の件数で、厳格Goalでの法的適格性を示しません。Titleごとの厳格な技術判定の阻害理由は、下の「1350年のナルヴェン王朝存続条件（試験判定）」で確認できます。</p>
  </div>
}
