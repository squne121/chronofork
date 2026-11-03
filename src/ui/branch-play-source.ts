// 実シミュレーションを利用したUI専用のA0/A1分岐実験。
// 未来の出来事や勝敗をハードコードしない。法的承認証拠・係数はsynthetic/CALIBRATION_ONLY。
import { createExperimentalWorld, createExperimentalOrdinaryLegalTrial, prepareExperimentalGoalContext, EXPERIMENTAL_NALVEN_GOAL } from '../scenario/experimental/index.ts'
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
import type { EvaluatorMap, TimelineResult } from '../simulation/engine/index.ts'
import { normalizePersonPair } from '../simulation/intervention/index.ts'
import type { MarriageApprovalEvidence } from '../simulation/rules/a/index.ts'
import { EXPERIMENTAL_TUNING } from '../simulation/tuning.ts'
import type { TimelineRun } from './timeline-source.ts'

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
export type PlayMode='FIXED_APPROVAL'|'ORDINARY_LAW'
export const PLAY_DEFAULT_MODE:PlayMode='FIXED_APPROVAL'
export const playModeLabel=(mode:PlayMode):string=>mode==='ORDINARY_LAW'
  ? '通常法制（experimental）':'旧・1260年の明示承認試験'
export type PlayInput=Readonly<{
  mode?:PlayMode
  seed:number
  year:number
  firstPersonId:Id
  secondPersonId:Id
  signedDelta:number
  durationYears:number
}>
export type BranchChoice='A0'|'A1'
export type PlayComparison=Readonly<{
  mode:PlayMode
  input:PlayInput
  modifier:StatModifier
  root:Branch
  branch:Branch
  a0:TimelineRun
  a1:TimelineRun
}>
export type PlayResult=
  | Readonly<{ok:true;comparison:PlayComparison}>
  | Readonly<{ok:false;code:string;message:string}>

export function playInitialWorld():WorldState{
  // PR #54で人物05はexperimental初期世界に反映済み。UIだけの二重変更は行わない。
  return createExperimentalWorld()
}
export const playPersonOptions=()=>playInitialWorld().persons.map(p=>({
  id:p.personId,label:p.name+(p.sex==='MALE'?'（男）':'（女）'),
}))
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
    rulesetVersion:EXPERIMENTAL_TUNING.rulesetVersion,rngVersion:'chronofork-rng-2',
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
/** 決定的再計算の本物の結果だけ返す。停止時は部分結果を表示用「成功」と扱わない。 */
export function runPlayComparison(input:PlayInput):PlayResult{
  const mode=input.mode??PLAY_DEFAULT_MODE
  if(mode!=='FIXED_APPROVAL'&&mode!=='ORDINARY_LAW')return reject('INVALID_MODE','試験用法制モードが不正です')
  if(!Number.isSafeInteger(input.seed)||input.seed<0)return reject('INVALID_SEED','seedは0以上の安全整数が必要です')
  if(!Number.isSafeInteger(input.year)||input.year<START_YEAR||input.year>=GOAL_YEAR)
    return reject('INVALID_YEAR','介入年は1250〜1349年の整数が必要です')
  if(!Number.isSafeInteger(input.signedDelta)||input.signedDelta===0||Math.abs(input.signedDelta)>200)
    return reject('INVALID_DELTA','信頼補正は0以外・絶対値200以下の整数が必要です（試験値）')
  if(!Number.isSafeInteger(input.durationYears)||input.durationYears<1||input.year+input.durationYears>GOAL_YEAR)
    return reject('INVALID_DURATION','期間は1年以上、1350年を超えない整数が必要です')
  const pair=normalizePersonPair(input.firstPersonId,input.secondPersonId)
  if(pair===null)return reject('INVALID_PERSON_PAIR','異なる2人の人物を選択してください')
  const initial=playInitialWorld()
  const legal=prepareExperimentalGoalContext(initial)
  if(!legal.ok)return reject('INITIAL_LEGAL_EVIDENCE_INVALID',legal.issues.map(i=>i.code+':'+i.path).join(' / '))
  const ordinaryTrial=mode==='ORDINARY_LAW'?createExperimentalOrdinaryLegalTrial():undefined
  if(ordinaryTrial){
    const issues=verifyInitialLegalEvidence(initial,ordinaryTrial.book)
    if(issues.length>0)return reject('INITIAL_ORDINARY_EVIDENCE_INVALID',
      issues.map(i=>i.code+':'+i.path).join(' / '))
  }
  if(pair.some(id=>!initial.persons.some(p=>p.personId===id)))
    return reject('UNKNOWN_PERSON','対象人物が1250年の試験世界に存在しません')
  const modifier:StatModifier={
    modifierId:'ui:modifier:'+JSON.stringify([input.year,pair,input.signedDelta,input.durationYears]),
    interventionId:'ui:intervention:'+JSON.stringify([input.year,pair]),
    targetRef:{kind:'PERSON_PAIR',ids:pair},statKey:PAIR_TRUST_STAT_KEY,
    signedDelta:input.signedDelta,startYear:input.year,
    endExclusiveYear:input.year+input.durationYears,
    decayPolicy:'NONE',ruleVersion:STAT_MODIFIER_RULE_VERSION,
  }
  try{
    const rootEvaluators=createEvaluators(initial,[],legal.book,mode,ordinaryTrial)
    const timeline=runTimeline(initial,{seed:input.seed,branchId:'A0-play',evaluators:rootEvaluators,
      goal:legal.goal,technicalGoalEvaluation:true})
    if(timeline.status!=='COMPLETED')return reject('A0_HALTED',JSON.stringify(timeline.halt))
    const root=createRootBranch(timeline,[],rootEvaluators)
    if(!root.ok)return reject('A0_ROOT_REJECTED',root.code+':'+root.message)
    const rerun=forkHistory({
      parent:root.branch,branchId:'A1-play',forkYear:input.year,
      modifiers:[modifier],
      evaluatorsFor:({ledger})=>{
        const state=root.branch.snapshots[input.year-root.branch.startYear]!
        return createEvaluators(state,ledger,legal.book,mode,ordinaryTrial)
      },
    })
    if(!rerun.ok)return reject('FORK_REJECTED',rerun.code+':'+rerun.message)
    if(rerun.branch.status!=='COMPLETED')return reject('A1_HALTED',JSON.stringify(rerun.branch.halt))
    const a0:TimelineRun={inputs:buildInputs(input.seed,Object.keys(rootEvaluators),'A0-play',mode),
      result:timeline,initialWorld:initial}
    const a1=asTimelineRun(rerun.branch,a0,mode)
    return {ok:true,comparison:{mode,input,modifier,root:root.branch,branch:rerun.branch,a0,a1}}
  }catch(error){
    return reject('CALCULATION_EXCEPTION',error instanceof Error?error.message:String(error))
  }
}
export type EventDelta=Readonly<{kind:'A1_ONLY'|'A0_ONLY'|'CHANGED';event:EventLogEntry;counterpart?:EventLogEntry}>
export type TraceDelta=Readonly<{traceId:Id;ruleId:string;before?:DecisionTrace;after?:DecisionTrace}>
/** 年をまたいだ比較にしない。IDの一致だけでなく内容差分も判定する。 */
export function compareYear(c:PlayComparison,year:number):Readonly<{
  a0World:WorldState|undefined;a1World:WorldState|undefined;
  events:readonly EventDelta[];traces:readonly TraceDelta[]
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
  const t0=new Map(c.a0.result.decisionTraces.filter(t=>t.year===year).map(t=>[t.traceId,t]))
  const t1=new Map(c.a1.result.decisionTraces.filter(t=>t.year===year).map(t=>[t.traceId,t]))
  const traces:TraceDelta[]=[]
  for(const id of new Set([...t0.keys(),...t1.keys()])){
    const before=t0.get(id),after=t1.get(id)
    if(JSON.stringify(before)!==JSON.stringify(after))traces.push({traceId:id,ruleId:(after??before)!.ruleId,before,after})
  }
  return {a0World,a1World,events,traces}
}
/** 相手の家門や子孫等、指定ペアから離れた波及を分離するための「直接関与」のみの判定。 */
export function directlyInvolvesPair(e:EventLogEntry,pair:readonly [Id,Id]):boolean{
  return e.involvedRefs.some(ref=>ref.kind==='PERSON_PAIR'
    ?ref.ids[0]===pair[0]&&ref.ids[1]===pair[1]
    :ref.kind==='PERSON'&&pair.includes(ref.id))
}
