// 実シミュレーションを利用したUI専用のA0/A1分岐実験。
// 未来の出来事や勝敗をハードコードしない。法的承認証拠・係数はsynthetic/CALIBRATION_ONLY。
import {
  createExperimentalWorld, createExperimentalOrdinaryLegalTrial, prepareExperimentalGoalContext, EXPERIMENTAL_NALVEN_GOAL,
  createExperimentalIntegratedEvaluators, createExperimentalIntegratedTimelineOptions, integratedRunConfigIdentity,
  INTEGRATED_PAIR, INTEGRATED_SEED, INTEGRATED_START_YEAR, INTEGRATED_TRUST_REDUCTION,
} from '../scenario/experimental/index.ts'
import { rngVersion } from '../simulation/random.ts'
import { verifyInitialLegalEvidence } from '../simulation/legal/evidence.ts'
import type { OrdinaryLaw } from '../simulation/legal/ordinary-authority.ts'
import type { OrdinaryMarriageReview } from '../simulation/rules/a/index.ts'
import type { LegalEvidenceBook } from '../simulation/legal/evidence.ts'
import { evaluateGoal } from '../simulation/goal.ts'
import { createAutonomousCalibrationEvaluators } from '../simulation/autonomy/index.ts'
import type { AutonomyCalibration } from '../simulation/autonomy/index.ts'
import { createRootBranch, forkHistory } from '../simulation/branching/index.ts'
import type { Branch } from '../simulation/branching/index.ts'
import type { DecisionTrace, EventLogEntry, Id, StatModifier, WorldState } from '../simulation/contracts/index.ts'
import { GOAL_YEAR, PAIR_TRUST_STAT_KEY, START_YEAR, STAT_MODIFIER_RULE_VERSION } from '../simulation/contracts/index.ts'
import { runTimeline } from '../simulation/engine/index.ts'
import type { EvaluatorMap, TimelineResult, YearProgress } from '../simulation/engine/index.ts'
import { normalizePersonPair } from '../simulation/intervention/index.ts'
import type { MarriageApprovalEvidence } from '../simulation/rules/a/index.ts'
import { EXPERIMENTAL_TUNING } from '../simulation/tuning.ts'
import type { TimelineRun } from './timeline-source.ts'
import { extractCandidates } from './play-candidates.ts'
import type { PlayCandidateSet } from './play-candidates.ts'
import { buildA0CacheKey, countsOf } from './a0-cache.ts'
import type { A0Source, SingleA0Cache } from './a0-cache.ts'
export type { A0Source } from './a0-cache.ts'
import type { ProgressBranch, ProgressObserver } from './play-progress.ts'
export type { PlayProgress, ProgressObserver } from './play-progress.ts'
import { compareTraces } from './trace-correspondence.ts'
import type { TraceDelta, TraceSummary } from './trace-correspondence.ts'
export type { TraceDelta, TraceSummary } from './trace-correspondence.ts'

/** 原史の正式な人物設定ではなく、既存の縦断テストと同じ婚姻試験用人物ペア。 */
const P4='person-exp-04',P5='person-exp-05'
export const PLAY_DEMO_YEAR=1260
export const PLAY_DEMO_PAIR=[P4,P5] as const
export const PLAY_DEMO_DELTA=20
export const PLAY_DEMO_DURATION=5
const BIRTH_MORTALITY_CALIBRATION:AutonomyCalibration={
  status:'CALIBRATION_ONLY',
  birth:{minMotherAge:18,maxMotherAge:32,minFatherAge:18,chancePermille:1000},
  death:{minAge:60,riskStartAge:59,basePermille:0,increasePerYearPermille:1000,maxPermille:1000},
  marriage:{minAdultAge:18,maxCandidatePairs:500},
}
const TRUST_BASE=[{personIds:PLAY_DEMO_PAIR,value:10}] as const
const TEST_MARRIAGE_APPROVAL:MarriageApprovalEvidence={
  approvalId:'ui-synthetic-marriage-1260',personIds:PLAY_DEMO_PAIR,authorizedYear:PLAY_DEMO_YEAR,
  status:'APPROVED',issuerRef:{kind:'COUNTRY',id:'country-eldia'},evidenceId:'ui-synthetic-approval-document',
  provenance:'CALIBRATION_ONLY',
  contract:{
    contractId:'ui-synthetic-marriage-contract',evidenceId:'ui-synthetic-approval-document',
    clauses:[{clauseId:'ui-synthetic-child-clause',kind:'CHILD_LEGAL_DYNASTY',dynastyId:'dynasty-vargas'}],
  },
}
/** 試験用法制の切替。変更できるのは試験用シナリオ構成で、ゲーム内の法的状態ではない。 */
export type PlayMode='FIXED_APPROVAL'|'ORDINARY_LAW'|'INTEGRATED_EXPERIMENTAL'
export const PLAY_DEFAULT_MODE:PlayMode='FIXED_APPROVAL'
export const playModeLabel=(mode:PlayMode):string=>mode==='INTEGRATED_EXPERIMENTAL'
  ? '統合法制・世代継続（experimental）'
  : mode==='ORDINARY_LAW'?'通常法制（experimental）':'旧・1260年の明示承認試験'
/**
 * 統合モードの初期入力例。PR #78 で実測した CALIBRATION_ONLY の条件であり、強制的な歴史イベントではない。
 * 利用者が変更した値で必ず再計算する（ここは入力欄の初期値にだけ使う）。
 */
export const INTEGRATED_PLAY_DEFAULTS=Object.freeze({
  seed:INTEGRATED_SEED,year:INTEGRATED_START_YEAR,pair:INTEGRATED_PAIR,
  signedDelta:INTEGRATED_TRUST_REDUCTION.signedDelta,durationYears:5,
})
export type PlayInput=Readonly<{
  mode?:PlayMode
  seed:number
  year:number
  firstPersonId:Id
  secondPersonId:Id
  signedDelta:number
  durationYears:number
  /** 2回目は第1介入と同じ年に限る（別のペア）。A2をforkHistoryで作る。 */
  second?:SecondPlayInput
}>
export type BranchChoice='A0'|'A1'
/** A1の同年・別ペアへ追加する第2介入。既存MVPのpair.trustだけを対象とする。 */
export type SecondPlayInput=Readonly<{
  firstPersonId:Id
  secondPersonId:Id
  signedDelta:number
  durationYears:number
}>
/**
 * ブラウザへ転送する表示用ビューが、完全な結果から省略した件数。
 * 省略はA0/A1で完全に同一かつ相互参照が閉じている高頻度の信頼更新(PERSON_PAIR_TRUST_SET / B-009)に限る。
 */
export type DisplayOmission=Readonly<{
  fullEventCount:Readonly<{a0:number;a1:number}>
  fullTraceCount:Readonly<{a0:number;a1:number}>
  omittedEventsByType:Readonly<Record<string,number>>
  omittedTracesByRule:Readonly<Record<string,number>>
}>
/** UIが読む範囲。Worker経由では完全版のroot/branchを持ち込まず、このビューだけを受け取る。 */
export type PlayView=Readonly<{
  mode:PlayMode
  input:PlayInput
  modifier:StatModifier
  a0:TimelineRun
  a1:TimelineRun
  /** 転送用ビューのときだけ付く。無ければ完全な結果。 */
  displayOmission?:DisplayOmission
  /** 存在時はa0=A1、a1=A2の差分ビュー。UI上の出典を混同しない。 */
  second?:PlayView
  /** A0を今回計算したか、保存済みを再利用したか。 */
  a0Source?:A0Source
}>
export type PlayComparison=PlayView&Readonly<{root:Branch;branch:Branch;second?:PlayComparison}>
export type PlayResult=
  | Readonly<{ok:true;comparison:PlayComparison}>
  | Readonly<{ok:false;code:string;message:string}>

export function playInitialWorld():WorldState{
  // PR #54で人物05はexperimental初期世界に反映済み。UIだけの二重変更は行わない。
  return createExperimentalWorld()
}
export const playPersonOptions=()=>playInitialWorld().persons
  .filter(p=>p.interactionRole!=='SUPPORTING').map(p=>({
  id:p.personId,label:p.name+(p.sex==='MALE'?'（男）':'（女）'),
}))
/**
 * 人物ペア信頼介入の対象適格性（GUI/CLI共通）。fork年初のWorldStateだけを見る（生存・年齢の新規則は設けない）。
 * 未出生・未登録・存在しないIDはUNKNOWN_PERSON、SUPPORTINGは直接介入不可。interactionRole省略はKEY。
 */
export function interventionTargetIssue(world:WorldState,pair:readonly [Id,Id]):Readonly<{code:string;message:string}>|null{
  for(const id of pair){
    const p=world.persons.find(x=>x.personId===id)
    if(!p)return {code:'UNKNOWN_PERSON',message:`対象人物が${world.year}年初のWorldStateに存在しません: ${id}`}
    if(p.interactionRole==='SUPPORTING')
      return {code:'SUPPORTING_PERSON_NOT_DIRECTLY_INTERACTABLE',message:`SUPPORTING人物は直接介入できません: ${id}`}
  }
  return null
}
const reject=(code:string,message:string):PlayResult=>({ok:false,code,message})
type OrdinaryTrial=Readonly<{book:LegalEvidenceBook;laws:readonly OrdinaryLaw[];marriageReviews:readonly OrdinaryMarriageReview[]}>
function createEvaluators(w:WorldState,ledger:readonly StatModifier[],book:LegalEvidenceBook,mode:PlayMode,
  ordinaryTrial?:OrdinaryTrial):EvaluatorMap{
  const r=createAutonomousCalibrationEvaluators({
    branchStartWorld:w,ledger,trustBase:TRUST_BASE,
    ...(mode==='ORDINARY_LAW'&&ordinaryTrial?{
      // 初期の法律・人物適格性と、その年の実際のB-005照会を照合する（固定年婚姻は作らない）。
      ordinaryMarriage:{book:ordinaryTrial.book,laws:ordinaryTrial.laws,reviews:ordinaryTrial.marriageReviews},
      reviewedLegal:{book:ordinaryTrial.book,ordinaryLaws:ordinaryTrial.laws},
    }:{
      marriageEvidence:[TEST_MARRIAGE_APPROVAL],
      reviewedLegal:{book},
    }),
    autonomy:BIRTH_MORTALITY_CALIBRATION,
  })
  if(!r.ok)throw new Error('EVALUATOR_FACTORY_FAILED:'+r.issues.join(','))
  return r.evaluators
}
function buildInputs(seed:number,ids:readonly string[],branchId:string,mode:PlayMode):TimelineRun['inputs']{
  return {
    seed,scenarioId:'experimental / 亡国の王冠 / '+playModeLabel(mode)+' / '+branchId,
    rulesetVersion:EXPERIMENTAL_TUNING.rulesetVersion,rngVersion,
    evaluatedRuleIds:ids,
  }
}
/** Branchは正式な勝敗・coverage全域を持たないので、試験表示専用の読取TimelineResultに明示変換する。 */
function asTimelineRun(branch:Branch,parent:TimelineRun,mode:PlayMode):TimelineRun{
  const coverage=branch.recompute?.suffixCoverage??parent.result.coverage
  const finalWorld=branch.snapshots[branch.snapshots.length-1]
  const technicalGoal=branch.status==='COMPLETED'&&finalWorld?.year===GOAL_YEAR
    ? evaluateGoal(finalWorld,EXPERIMENTAL_NALVEN_GOAL):null
  const result:TimelineResult={
    status:branch.status,seed:branch.seed,branchId:branch.branchId,
    rngVersion:branch.rngVersion,startYear:branch.startYear,
    snapshots:branch.snapshots,transitions:Math.max(0,branch.snapshots.length-1),
    eventLog:branch.eventLog,decisionTraces:branch.decisionTraces,
    halt:branch.halt,coverage,goal:null,technicalGoal,
    autonomousHistory:{
      status:'NOT_ESTABLISHED',
      blockers:[...parent.result.autonomousHistory.blockers,'FORK_CALIBRATION_ONLY'],
    },
  }
  return {
    inputs:buildInputs(branch.seed,branch.evaluatorProfile.ruleIds,branch.branchId,mode),
    initialWorld:parent.initialWorld,result,
  }
}
/** エンジンの確定済み年次通知を、枝を明示した小さなDTOへ変換する（観測専用）。 */
const progressHook=(branch:ProgressBranch,observer:ProgressObserver|undefined)=>observer
  ?{onYearCommitted:(p:YearProgress)=>observer({
    branch,startYear:p.startYear,goalYear:p.goalYear,confirmedYear:p.confirmedYear,
    transitionsDone:p.transitionsDone,transitionsTotal:p.transitionsTotal,eventCount:p.eventCount,
  })}:{}
type IntegratedSetup=ReturnType<typeof createExperimentalIntegratedTimelineOptions>
type RootContext=Readonly<{
  seed:number;mode:PlayMode;initial:WorldState
  /** FIXED_APPROVAL / ORDINARY_LAW のみ。統合モードは自前の法令・Goal構成を持つ。 */
  legal?:Extract<ReturnType<typeof prepareExperimentalGoalContext>,{ok:true}>
  ordinaryTrial?:OrdinaryTrial
  /** INTEGRATED_EXPERIMENTAL のみ。mainの共通ファクトリが返す世界とA0の実行オプション。 */
  integrated?:IntegratedSetup
}>
type Failure=Readonly<{ok:false;code:string;message:string}>
/** A0単独実行とA0/A1比較が共有する検証・法的証拠・初期世界の準備（別のゲーム計算を作らない）。 */
function prepareRoot(seed:number,mode:PlayMode):Readonly<{ok:true;context:RootContext}>|Failure{
  if(mode!=='FIXED_APPROVAL'&&mode!=='ORDINARY_LAW'&&mode!=='INTEGRATED_EXPERIMENTAL')
    return {ok:false,code:'INVALID_MODE',message:'試験用法制モードが不正です'}
  if(!Number.isSafeInteger(seed)||seed<0)
    return {ok:false,code:'INVALID_SEED',message:'seedは0以上の安全整数が必要です'}
  if(mode==='INTEGRATED_EXPERIMENTAL'){
    const integrated=createExperimentalIntegratedTimelineOptions('A0-play')
    return {ok:true,context:{seed,mode,initial:integrated.world,integrated}}
  }
  const initial=playInitialWorld()
  const legal=prepareExperimentalGoalContext(initial)
  if(!legal.ok)return {ok:false,code:'INITIAL_LEGAL_EVIDENCE_INVALID',
    message:legal.issues.map(i=>i.code+':'+i.path).join(' / ')}
  const ordinaryTrial=mode==='ORDINARY_LAW'?createExperimentalOrdinaryLegalTrial():undefined
  if(ordinaryTrial){
    const issues=verifyInitialLegalEvidence(initial,ordinaryTrial.book)
    if(issues.length>0)return {ok:false,code:'INITIAL_ORDINARY_EVIDENCE_INVALID',
      message:issues.map(i=>i.code+':'+i.path).join(' / ')}
  }
  return {ok:true,context:{seed,mode,initial,legal,ordinaryTrial}}
}
/** A0の評価器生成と年次実行。例外は呼び出し側のtry/catchで扱う。 */
function runRootTimeline(c:RootContext,observer?:ProgressObserver):
  Readonly<{ok:true;timeline:TimelineResult;evaluators:EvaluatorMap;a0:TimelineRun}>|Failure{
  const evaluators=c.integrated?c.integrated.options.evaluators
    :createEvaluators(c.initial,[],c.legal!.book,c.mode,c.ordinaryTrial)
  const timeline=c.integrated
    ? runTimeline(c.initial,{...c.integrated.options,seed:c.seed,...progressHook('A0',observer)})
    : runTimeline(c.initial,{seed:c.seed,branchId:'A0-play',evaluators,
      goal:c.legal!.goal,technicalGoalEvaluation:true,...progressHook('A0',observer)})
  if(timeline.status!=='COMPLETED')
    return {ok:false,code:'A0_HALTED',message:JSON.stringify(timeline.halt)}
  return {ok:true,timeline,evaluators,a0:{
    inputs:buildInputs(c.seed,Object.keys(evaluators),'A0-play',c.mode),
    result:timeline,initialWorld:c.initial,
  }}
}
/** A1の評価器: fork年初のWorldStateと新ledgerから、A0と同じ構成で再生成する。 */
function forkEvaluators(c:RootContext,state:WorldState,ledger:readonly StatModifier[]):EvaluatorMap{
  return c.integrated?createExperimentalIntegratedEvaluators(state,ledger)
    :createEvaluators(state,ledger,c.legal!.book,c.mode,c.ordinaryTrial)
}
/** A0を一意に決める入力すべて。介入(年・人物・補正・期間)は含めない。 */
function a0CacheKeyOf(c:RootContext):string{
  return buildA0CacheKey({
    mode:c.mode,seed:c.seed,rngVersion,rulesetVersion:EXPERIMENTAL_TUNING.rulesetVersion,
    tuning:EXPERIMENTAL_TUNING,initialWorld:c.initial,
    ...(c.integrated
      ?{integrated:{goal:c.integrated.options.goal,ruleIds:Object.keys(c.integrated.options.evaluators).sort(),config:integratedRunConfigIdentity()}}
      :{legal:{goal:c.legal?.goal,book:c.legal?.book,ordinary:c.ordinaryTrial,
        calibration:BIRTH_MORTALITY_CALIBRATION,trustBase:TRUST_BASE,approval:TEST_MARRIAGE_APPROVAL}}),
  })
}
export type PlayRunOptions=Readonly<{
  /** 指定したときだけA0を保持/再利用する。省略時は従来どおり毎回計算する。 */
  cache?:SingleA0Cache
  /** A0を再計算せず保存済みを使うと決まった時点で一度だけ呼ぶ(A0の年次進捗は出さない)。 */
  onA0Reused?:()=>void
}>
/** 決定的再計算の本物の結果だけ返す。停止時は部分結果を表示用「成功」と扱わない。 */
export function runPlayComparison(input:PlayInput,observer?:ProgressObserver,options:PlayRunOptions={}):PlayResult{
  const mode=input.mode??PLAY_DEFAULT_MODE
  if(mode!=='FIXED_APPROVAL'&&mode!=='ORDINARY_LAW'&&mode!=='INTEGRATED_EXPERIMENTAL')return reject('INVALID_MODE','試験用法制モードが不正です')
  if(!Number.isSafeInteger(input.seed)||input.seed<0)return reject('INVALID_SEED','seedは0以上の安全整数が必要です')
  if(!Number.isSafeInteger(input.year)||input.year<START_YEAR||input.year>=GOAL_YEAR)
    return reject('INVALID_YEAR','介入年は1250〜1349年の整数が必要です')
  if(!Number.isSafeInteger(input.signedDelta)||input.signedDelta===0||Math.abs(input.signedDelta)>200)
    return reject('INVALID_DELTA','信頼補正は0以外・絶対値200以下の整数が必要です（試験値）')
  if(!Number.isSafeInteger(input.durationYears)||input.durationYears<1||input.year+input.durationYears>GOAL_YEAR)
    return reject('INVALID_DURATION','期間は1年以上、1350年を超えない整数が必要です')
  const pair=normalizePersonPair(input.firstPersonId,input.secondPersonId)
  if(pair===null)return reject('INVALID_PERSON_PAIR','異なる2人の人物を選択してください')
  const followup=input.second
  const secondPair=followup?normalizePersonPair(followup.firstPersonId,followup.secondPersonId):null
  if(followup&&secondPair===null)return reject('INVALID_PERSON_PAIR','第2介入も異なる2人の人物を選択してください')
  if(followup&&(
    !Number.isSafeInteger(followup.signedDelta)||followup.signedDelta===0||Math.abs(followup.signedDelta)>200))
    return reject('INVALID_DELTA','第2介入の信頼補正は0以外・絶対値200以下の整数が必要です')
  if(followup&&(
    !Number.isSafeInteger(followup.durationYears)||followup.durationYears<1||
    input.year+followup.durationYears>GOAL_YEAR))
    return reject('INVALID_DURATION','第2介入の期間は1年以上、1350年を超えない整数が必要です')
  if(secondPair&&pair[0]===secondPair[0]&&pair[1]===secondPair[1])
    return reject('DUPLICATE_INTERVENTION','同年・同対象・同一statKeyへの重複介入は禁止されています')
  const prep=prepareRoot(input.seed,mode)
  if(!prep.ok)return reject(prep.code,prep.message)
  const modifier:StatModifier={
    modifierId:'ui:modifier:'+JSON.stringify([input.year,pair,input.signedDelta,input.durationYears]),
    interventionId:'ui:intervention:'+JSON.stringify([input.year,pair]),
    targetRef:{kind:'PERSON_PAIR',ids:pair},statKey:PAIR_TRUST_STAT_KEY,
    signedDelta:input.signedDelta,startYear:input.year,
    endExclusiveYear:input.year+input.durationYears,
    decayPolicy:'NONE',ruleVersion:STAT_MODIFIER_RULE_VERSION,
  }
  try{
    const key=options.cache?a0CacheKeyOf(prep.context):''
    const cached=options.cache?.get(key)
    let root:Branch,a0:TimelineRun,a0Source:A0Source
    if(cached){
      root=cached.root;a0=cached.a0;a0Source='REUSED'
      options.onA0Reused?.()
    }else{
      const rootRun=runRootTimeline(prep.context,observer)
      if(!rootRun.ok)return reject(rootRun.code,rootRun.message)
      const {timeline,evaluators:rootEvaluators}=rootRun
      const made=createRootBranch(timeline,[],rootEvaluators)
      if(!made.ok)return reject('A0_ROOT_REJECTED',made.code+':'+made.message)
      root=made.branch;a0Source='COMPUTED'
      // 表示用A0はrootの凍結済み配列を共有する(同内容の複製を二重に保持しない)。
      a0={...rootRun.a0,result:{...timeline,snapshots:root.snapshots,eventLog:root.eventLog,decisionTraces:root.decisionTraces}}
      options.cache?.put({key,root,a0,counts:countsOf(root)})
    }
    // 対象はfork年初の実WorldState（A0の同一snapshot）で検査する。1250年に未登場の後世KEY人物も対象にできる。
    const forkState=root.snapshots[input.year-root.startYear]
    if(!forkState)return reject('INVALID_YEAR','介入年のWorldStateが計算されていません')
    const issue=interventionTargetIssue(forkState,pair)
    if(issue)return reject(issue.code,issue.message)
    const rerun=forkHistory({
      parent:root,branchId:'A1-play',forkYear:input.year,
      modifiers:[modifier],
      ...progressHook('A1',observer),
      evaluatorsFor:({ledger})=>forkEvaluators(prep.context,forkState,ledger),
    })
    if(!rerun.ok)return reject('FORK_REJECTED',rerun.code+':'+rerun.message)
    if(rerun.branch.status!=='COMPLETED')return reject('A1_HALTED',JSON.stringify(rerun.branch.halt))
    const a1=asTimelineRun(rerun.branch,a0,mode)
    if(!followup||!secondPair)
      return {ok:true,comparison:{mode,input,modifier,root,branch:rerun.branch,a0,a1,a0Source}}
    const secondForkWorld=rerun.branch.snapshots[input.year-rerun.branch.startYear]
    if(!secondForkWorld)return reject('INVALID_YEAR','A1の再介入年WorldStateが計算されていません')
    const secondIssue=interventionTargetIssue(secondForkWorld,secondPair)
    if(secondIssue)return reject(secondIssue.code,secondIssue.message)
    const secondModifier:StatModifier={
      modifierId:'ui:modifier:'+JSON.stringify([input.year,secondPair,followup.signedDelta,followup.durationYears]),
      interventionId:'ui:intervention:'+JSON.stringify([input.year,secondPair]),
      targetRef:{kind:'PERSON_PAIR',ids:secondPair},statKey:PAIR_TRUST_STAT_KEY,
      signedDelta:followup.signedDelta,startYear:input.year,
      endExclusiveYear:input.year+followup.durationYears,
      decayPolicy:'NONE',ruleVersion:STAT_MODIFIER_RULE_VERSION,
    }
    // 2回目の介入は必ずA1を親にし、同年の別対象modifierを保持する。
    const secondFork=forkHistory({
      parent:rerun.branch,branchId:'A2-play',forkYear:input.year,
      modifiers:[secondModifier],
      ...progressHook('A2',observer),
      evaluatorsFor:({ledger})=>forkEvaluators(prep.context,secondForkWorld,ledger),
    })
    if(!secondFork.ok)return reject('A2_FORK_REJECTED',secondFork.code+':'+secondFork.message)
    if(secondFork.branch.status!=='COMPLETED')return reject('A2_HALTED',JSON.stringify(secondFork.branch.halt))
    const a2=asTimelineRun(secondFork.branch,a1,mode)
    const secondInput:PlayInput={
      seed:input.seed,mode,year:input.year,firstPersonId:followup.firstPersonId,
      secondPersonId:followup.secondPersonId,signedDelta:followup.signedDelta,
      durationYears:followup.durationYears,
    }
    const second:PlayComparison={
      mode,input:secondInput,modifier:secondModifier,root:rerun.branch,branch:secondFork.branch,
      a0:a1,a1:a2,
    }
    return {ok:true,comparison:{mode,input,modifier,root,branch:rerun.branch,a0,a1,a0Source,second}}
  }catch(error){
    return reject('CALCULATION_EXCEPTION',error instanceof Error?error.message:String(error))
  }
}
/** プレイヤー向けCLIとGUIが同じ試験世界・年次エンジンを使うためのA0読取入口。
 * 技術Goalは正式勝敗ではなく、校正用のデータを正式シナリオに昇格させない。
 */
export type PlayBaselineResult =
  | Readonly<{ok:true;a0:TimelineRun}>
  | Readonly<{ok:false;code:string;message:string}>

export function runPlayBaseline(seed:number,mode:PlayMode=PLAY_DEFAULT_MODE):PlayBaselineResult{
  const prep=prepareRoot(seed,mode)
  if(!prep.ok)return prep
  try{
    const run=runRootTimeline(prep.context)
    return run.ok?{ok:true,a0:run.a0}:run
  }catch(error){
    return {ok:false,code:'CALCULATION_EXCEPTION',message:error instanceof Error?error.message:String(error)}
  }
}

export type EventDelta=Readonly<{kind:'A1_ONLY'|'A0_ONLY'|'CHANGED';event:EventLogEntry;counterpart?:EventLogEntry}>
/** 年をまたいだ比較にしない。IDの一致だけでなく内容差分も判定する。 */
export function compareYear(c:PlayView,year:number):Readonly<{
  a0World:WorldState|undefined;a1World:WorldState|undefined;
  events:readonly EventDelta[];traces:readonly TraceDelta[];traceSummary:TraceSummary
}>{
  const a0World=c.a0.result.snapshots.find(w=>w.year===year)
  const a1World=c.a1.result.snapshots.find(w=>w.year===year)
  const a0Events=new Map(c.a0.result.eventLog.filter(e=>e.year===year).map(e=>[e.eventId,e]))
  const a1Events=new Map(c.a1.result.eventLog.filter(e=>e.year===year).map(e=>[e.eventId,e]))
  const events:EventDelta[]=[]
  for(const [key,e] of a1Events){
    const before=a0Events.get(key)
    if(!before)events.push({kind:'A1_ONLY',event:e})
    else if(JSON.stringify(before)!==JSON.stringify(e))events.push({kind:'CHANGED',event:e,counterpart:before})
  }
  for(const [key,e] of a0Events)if(!a1Events.has(key))events.push({kind:'A0_ONLY',event:e})
  // traceIdは枝間の同一性に使わない。意味（年・phase・RuleID・actor）で一意に対応付けた場合だけ比較する。
  const cmp=compareTraces(
    c.a0.result.decisionTraces.filter(t=>t.year===year),c.a1.result.decisionTraces.filter(t=>t.year===year),
    c.a0.result.eventLog,c.a1.result.eventLog)
  return {a0World,a1World,events,traces:cmp.deltas,traceSummary:cmp.summary}
}
/** 相手の家門や子孫等、指定ペアから離れた波及を分離するための「直接関与」のみの判定。 */
export function directlyInvolvesPair(e:EventLogEntry,pair:readonly [Id,Id]):boolean{
  return e.involvedRefs.some(ref=>ref.kind==='PERSON_PAIR'
    ?ref.ids[0]===pair[0]&&ref.ids[1]===pair[1]
    :ref.kind==='PERSON'&&pair.includes(ref.id))
}

/**
 * 観測専用の年次スライス。完全A0はWorkerのSingleA0Cacheに保持し、
 * UIには選択年の年初WorldState・その年の確定Event/Traceだけ転送する。
 * 途中年の結果やA0の全履歴を転送済みと見せない。全記録の件数は実データから集計。
 */
export type ObservationYearCounts = Readonly<{year:number;events:number;traces:number}>
export type ObservationSlice = Readonly<{
  seed:number
  mode:'INTEGRATED_EXPERIMENTAL'
  year:number
  world:WorldState
  events:readonly EventLogEntry[]
  traces:readonly DecisionTrace[]
  counts:readonly ObservationYearCounts[]
  /** 1250〜1350の実A0全snapshotから作成した軽量KEY人物候補。1年だけの候補ではない。 */
  candidates:PlayCandidateSet
  technicalGoal:TimelineResult['technicalGoal']
  goal:TimelineResult['goal']
  status:TimelineResult['status']
  a0Source:A0Source
}>
export type ObservationInput = Readonly<{seed:number;mode:PlayMode;year:number}>
export type ObservationResult =
  | Readonly<{ok:true;observation:ObservationSlice}>
  | Readonly<{ok:false;code:string;message:string}>

// 保持中の同じA0に対して軽量KEY人物候補を再集計しない。Worker破棄でGC可能。
const observationCandidateCache=new WeakMap<TimelineRun,PlayCandidateSet>()
/** 実A0の確定結果だけを読む。UIが計算規則や架空の歴史を生成しないための純粋関数。 */
export function sliceA0Observation(
  a0:TimelineRun,year:number,mode:'INTEGRATED_EXPERIMENTAL',a0Source:A0Source,
):ObservationSlice|undefined{
  const world=a0.result.snapshots.find(w=>w.year===year)
  if(!world||a0.result.status!=='COMPLETED')return undefined
  const counts=Array.from({length:GOAL_YEAR-START_YEAR+1},(_,i)=>({year:START_YEAR+i,events:0,traces:0}))
  const events:EventLogEntry[]=[],traces:DecisionTrace[]=[]
  for(const e of a0.result.eventLog){
    const ix=e.year-START_YEAR
    if(ix>=0&&ix<counts.length)counts[ix]!.events++
    if(e.year===year)events.push(e)
  }
  for(const t of a0.result.decisionTraces){
    const ix=t.year-START_YEAR
    if(ix>=0&&ix<counts.length)counts[ix]!.traces++
    if(t.year===year)traces.push(t)
  }
  let candidates=observationCandidateCache.get(a0)
  if(!candidates){
    // 通常の候補APIと同じ適格性判定を使い、101年初の存在区間を保持する。
    candidates=extractCandidates(a0.inputs.seed,mode,a0.result.snapshots)
    observationCandidateCache.set(a0,candidates)
  }
  return {
    seed:a0.inputs.seed,mode,year,world,events,traces,counts,candidates,
    goal:a0.result.goal,technicalGoal:a0.result.technicalGoal,status:a0.result.status,a0Source,
  }
}

/** PR #109と同じWorker内の完全A0を使う観測専用入口。A1を作らない。 */
export function runPlayObservation(
  input:ObservationInput,cache:SingleA0Cache,observer?:ProgressObserver,
):ObservationResult{
  if(input.mode!=='INTEGRATED_EXPERIMENTAL')return {ok:false,code:'INVALID_MODE',message:'統合試験モードだけを観測できます'}
  if(!Number.isSafeInteger(input.year)||input.year<START_YEAR||input.year>GOAL_YEAR)
    return {ok:false,code:'INVALID_YEAR',message:'観測年は1250〜1350年の整数が必要です'}
  const prep=prepareRoot(input.seed,input.mode)
  if(!prep.ok)return prep
  try{
    const key=a0CacheKeyOf(prep.context)
    const cached=cache.get(key)
    let a0:TimelineRun
    let source:A0Source
    if(cached){a0=cached.a0;source='REUSED'}
    else{
      const r=runRootTimeline(prep.context,observer)
      if(!r.ok)return r
      const root=createRootBranch(r.timeline,[],r.evaluators)
      if(!root.ok)return {ok:false,code:'A0_ROOT_REJECTED',message:root.code+':'+root.message}
      a0={...r.a0,result:{...r.timeline,snapshots:root.branch.snapshots,
        eventLog:root.branch.eventLog,decisionTraces:root.branch.decisionTraces}}
      cache.put({key,root:root.branch,a0,counts:countsOf(root.branch)})
      source='COMPUTED'
    }
    const observation=sliceA0Observation(a0,input.year,input.mode,source)
    return observation?{ok:true,observation}
      :{ok:false,code:'UNCOMPUTED_YEAR',message:'この年の年初WorldStateは確定していません'}
  }catch(error){
    cache.clear()
    return {ok:false,code:'OBSERVATION_EXCEPTION',message:error instanceof Error?error.message:String(error)}
  }
}
