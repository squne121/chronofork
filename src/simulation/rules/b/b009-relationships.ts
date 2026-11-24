// B-009: 年次WorldStateの生存者から全ペアを導き、B領域のpair.trust基礎値を累積する。
// 新しい人物にもCALIBRATION_ONLYの初期値を与える。StatModifierはここでは加算しない。
// 初期のPairTrustBaseは1250年などの明示済み基礎関係だけで、毎年の結果はWorldStateに保存する。
import type { DecisionTraceDraft, Id, PairTrustBase, Person, PersonPairTrust, PersonPairTrustSetCommand, RuleOutcome, WorldState } from '../../contracts/index.ts'
import { PAIR_TRUST_DEFINITION } from '../../intervention/stat-registry.ts'
import { normalizePersonPair, pairKey, roundHalfAwayFromZero } from '../../intervention/index.ts'
import type { EvaluationContext, RuleEvaluator } from '../../engine/evaluators.ts'
import { EvaluationFailure } from '../../engine/evaluators.ts'
import { GOAL_YEAR, START_YEAR } from '../../contracts/index.ts'
import type { AutonomyCalibration } from '../../autonomy/config.ts'
import type { StatModifierLedger } from '../../intervention/index.ts'
import { registeredMarriageCandidates } from './b004-worldstate.ts'
import { validateYearStartWorldState } from '../../validation/index.ts'

export const B009_RULE_VERSION='b009-worldstate-cumulative-trust-0:CALIBRATION_ONLY'
export const B009_DEMAND_RULE_VERSION='b009-demand-constant-drift-1:CALIBRATION_ONLY'
export type B009Calibration=Readonly<{
  status:'CALIBRATION_ONLY'
  /** 初期関係に明示値がない、子孫ペアも含む信頼基礎値（試験用）。 */
  initialTrust:number
  /** 1年の基礎値増分（試験用）。 */
  annualDelta:number
  /** pair数が超過すると安全停止。黙って先頭だけ更新しない。 */
  maxPairs:number
  /** 当人たちの出身集団による双方の家門支持差を基礎値に反映する試験係数。既定0。 */
  houseSupportWeight?:number
  /** 同家門の人物ペアに対する試験加点。既定0。 */
  sameHouseBonus?:number
  /**
   * 試験用: 明示基礎値のない新規ペアの初期値へ、人物ペアIDの決定的ハッシュ由来の 0〜spread の加算を行う。
   * 同条件の人物(同家門・同集団・同年生まれ等)の全ペアが同点になり、B-005の「同率をID順で解消しない」
   * 相互最優先が成立しなくなる状況を避けるための個体差。婚姻・出生の成否や相手を決めない。既定0(従来動作)。
   */
  initialTrustSpread?:number
}>
export const EXPERIMENTAL_B009_CALIBRATION:B009Calibration=Object.freeze({
  status:'CALIBRATION_ONLY',initialTrust:0,annualDelta:1,maxPairs:500,
  houseSupportWeight:0,sameHouseBonus:0,
})
/** 家門利害による試験用変動を有効化する明示オプトイン。正式ゲーム規則ではない。 */
export const EXPERIMENTAL_B009_HOUSE_INTEREST:B009Calibration=Object.freeze({
  ...EXPERIMENTAL_B009_CALIBRATION,houseSupportWeight:2,sameHouseBonus:2,
})
export type B009ValidationResult=
  | Readonly<{ok:true;config:B009Calibration}>
  | Readonly<{ok:false;issues:readonly string[]}>
export function validateB009Calibration(c:B009Calibration):B009ValidationResult{
  const issues:string[]=[]
  if (!c || c.status!=='CALIBRATION_ONLY')return {ok:false,issues:['STATUS_NOT_CALIBRATION_ONLY']}
  if(!Number.isSafeInteger(c.initialTrust) || c.initialTrust<PAIR_TRUST_DEFINITION.min ||
     c.initialTrust>PAIR_TRUST_DEFINITION.max)issues.push('INITIAL_TRUST_OUT_OF_RANGE')
  if(!Number.isSafeInteger(c.annualDelta) || Math.abs(c.annualDelta)>PAIR_TRUST_DEFINITION.max-PAIR_TRUST_DEFINITION.min)issues.push('ANNUAL_DELTA_OUT_OF_RANGE')
  if(!Number.isSafeInteger(c.maxPairs)||c.maxPairs<1||c.maxPairs>10000)issues.push('PAIR_BUDGET_INVALID')
  if(!Number.isSafeInteger(c.houseSupportWeight??0)||(c.houseSupportWeight??0)<0||(c.houseSupportWeight??0)>10)issues.push('HOUSE_SUPPORT_WEIGHT_INVALID')
  if(!Number.isSafeInteger(c.sameHouseBonus??0)||Math.abs(c.sameHouseBonus??0)>20)issues.push('SAME_HOUSE_BONUS_INVALID')
  if(!Number.isSafeInteger(c.initialTrustSpread??0)||(c.initialTrustSpread??0)<0||(c.initialTrustSpread??0)>40||
     (Number.isSafeInteger(c.initialTrust)&&c.initialTrust+(c.initialTrustSpread??0)>PAIR_TRUST_DEFINITION.max))issues.push('INITIAL_TRUST_SPREAD_INVALID')
  return issues.length===0 ? {ok:true,config:Object.freeze({...c})} : {ok:false,issues}
}
const cmp=(a:string,b:string)=>a<b?-1:a>b?1:0
/** FNV-1a 32bit。pairKey(ID昇順の符号化)だけから決まるため枝・走査順・年に依存しない。 */
const pairSpread=(key:string,spread:number):number=>{
  if(spread===0)return 0
  let h=0x811c9dc5
  for(let i=0;i<key.length;i++)h=Math.imul(h^key.charCodeAt(i),0x01000193)>>>0
  return h%(spread+1)
}

type DemandInput = Readonly<{marriage: AutonomyCalibration['marriage']; ledger: StatModifierLedger}>

function prepareBase(initialBase: readonly PairTrustBase[], calibration: B009Calibration) {
  const checked=validateB009Calibration(calibration)
  if(!checked.ok)throw new RangeError('B009_CALIBRATION_INVALID:'+checked.issues.join(','))
  if(!Array.isArray(initialBase))throw new RangeError('B009_BASE_NOT_ARRAY')
  const initial=new Map<string,number>()
  for(const e of initialBase){
    const ids=e?.personIds
    if(!Array.isArray(ids)||ids.length!==2||typeof ids[0]!=='string'||typeof ids[1]!=='string'||
      !ids[0]||!ids[1]||ids[0]>=ids[1]||!Number.isSafeInteger(e.value)||
      e.value<PAIR_TRUST_DEFINITION.min||e.value>PAIR_TRUST_DEFINITION.max){
      throw new RangeError('B009_INVALID_BASE_PAIR')
    }
    const key=pairKey([ids[0] as string,ids[1] as string])
    if(initial.has(key))throw new RangeError('B009_DUPLICATE_BASE_PAIR')
    initial.set(key,e.value)
  }
  return {initial, c:checked.config}
}

function checkConstantDrift(c: B009Calibration): 0 | 1 {
  if ((c.annualDelta !== 0 && c.annualDelta !== 1) || (c.houseSupportWeight ?? 0) !== 0 || (c.sameHouseBonus ?? 0) !== 0)
    throw new RangeError('B009_DEMAND_REQUIRES_CONSTANT_DRIFT')
  return c.annualDelta
}

function demandKey(initial: ReadonlyMap<string,number>, c: B009Calibration): string {
  return JSON.stringify([B009_DEMAND_RULE_VERSION,c.initialTrust,c.initialTrustSpread??0,c.annualDelta,
    c.maxPairs,[...initial].sort(([a],[b])=>cmp(a,b))])
}

export function b009DemandModelKey(initialBase:readonly PairTrustBase[], calibration:B009Calibration): string {
  const {initial,c}=prepareBase(initialBase,calibration)
  checkConstantDrift(c)
  return demandKey(initial,c)
}

// 実行境界で正規B-009の注入を必須化するための属性。導出に必要な情報はWorldStateと同じ構成に保持する。
const demandEvaluators=new WeakMap<RuleEvaluator,string>()
export const b009DemandEvaluatorKey=(evaluator:RuleEvaluator|undefined) => evaluator && demandEvaluators.get(evaluator)

const clampTrust = (value: number) => Math.min(PAIR_TRUST_DEFINITION.max, Math.max(PAIR_TRUST_DEFINITION.min, value))

export type B009Observation =
  | Readonly<{status:'RECORDED'|'DERIVED'; value:number; throughYear:number;
      firstYear:number; anchorYear:number|null; initialSource:'EXPLICIT'|'CALIBRATION'|null}>
  | Readonly<{status:'UNKNOWN'; reason:'INVALID_PAIR'|'MODEL_MISMATCH'|'INVALID_SNAPSHOT'|'NOT_REGISTERED'|'REGISTRATION_EVIDENCE_MISSING'|
      'SUPPORTING_ONLY_PAIR'|'NO_EVALUATED_COEXISTENCE'|'INVALID_ANCHOR'}>

/** 単調な定数ドリフトでは、途中のclampを省略して最後に一度だけclampしても同値。 */
function resolveThrough(worldYear:number, through:number, ids:readonly [Id,Id], a:Person|undefined, b:Person|undefined,
  old:PersonPairTrust|undefined, initial:ReadonlyMap<string,number>, c:B009Calibration): B009Observation {
  if(!a || !b || a.birthYear>worldYear || b.birthYear>worldYear)return {status:'UNKNOWN',reason:'NOT_REGISTERED'}
  if(a.interactionRole==='SUPPORTING'&&b.interactionRole==='SUPPORTING')return {status:'UNKNOWN',reason:'SUPPORTING_ONLY_PAIR'}
  const validFirst = (p:Person) => p.firstPairTrustYear !== undefined && Number.isSafeInteger(p.firstPairTrustYear) &&
    p.firstPairTrustYear >= Math.max(START_YEAR,p.birthYear) && p.firstPairTrustYear <= worldYear+Number(p.interactionRole==='SUPPORTING')
  if(!validFirst(a) || !validFirst(b))return {status:'UNKNOWN',reason:'REGISTRATION_EVIDENCE_MISSING'}
  const first=Math.max(a.firstPairTrustYear!,b.firstPairTrustYear!)
  // この実験構成の死亡はB-003で、同年のB-009より前に確定する。
  const last=Math.min(through,(a.deathYear??Infinity)-1,(b.deathYear??Infinity)-1)
  if(last<first)return {status:'UNKNOWN',reason:'NO_EVALUATED_COEXISTENCE'}
  if(old && (old.lastUpdatedYear<first || old.lastUpdatedYear>through || old.lastUpdatedYear>last ||
    !Number.isSafeInteger(old.lastUpdatedYear) || !Number.isSafeInteger(old.value) || old.value!==clampTrust(old.value)))
    return {status:'UNKNOWN',reason:'INVALID_ANCHOR'}
  const key=pairKey(ids)
  const from=old?.value??initial.get(key)??c.initialTrust+pairSpread(key,c.initialTrustSpread??0)
  const value=clampTrust(from+(last-(old?.lastUpdatedYear??first-1))*c.annualDelta)
  return {status:old?.lastUpdatedYear===last?'RECORDED':'DERIVED',value,throughYear:last,firstYear:first,
    anchorYear:old?.lastUpdatedYear??null,initialSource:old?null:initial.has(key)?'EXPLICIT':'CALIBRATION'}
}

/** 年初スナップショットの観測。前年度までの基礎値のみ、Event/Traceや介入の効果は生成・確定しない。 */
export function createB009DemandObserver(initialBase:readonly PairTrustBase[], calibration:B009Calibration) {
  const {initial,c}=prepareBase(initialBase,calibration)
  const drift=checkConstantDrift(c), key=demandKey(initial,c)
  return (input:unknown,left:Id,right:Id):B009Observation=>{
    const ids=normalizePersonPair(left,right)
    if(!ids)return {status:'UNKNOWN',reason:'INVALID_PAIR'}
    const validated=validateYearStartWorldState(input)
    if(!validated.ok || !validated.world)return {status:'UNKNOWN',reason:'INVALID_SNAPSHOT'}
    const world=validated.world
    if(world.pairTrustDrift!==drift || world.pairTrustModelKey!==key)return {status:'UNKNOWN',reason:'MODEL_MISMATCH'}
    const [a,b]=ids.map(id=>world.persons.find(p=>p.personId===id))
    const old=world.pairTrust?.find(r=>r.personIds[0]===ids[0]&&r.personIds[1]===ids[1])
    return resolveThrough(world.year,world.year-1,ids,a,b,old,initial,c)
  }
}

function* allPairs(persons:readonly Person[]):Generator<readonly [Id,Id]> {
  for(let i=0;i<persons.length;i++)for(let j=i+1;j<persons.length;j++){
    const a=persons[i]!,b=persons[j]!
    if(a.interactionRole!=='SUPPORTING'||b.interactionRole!=='SUPPORTING')yield [a.personId,b.personId]
  }
}

export function createB009WorldStateEvaluator(
  initialBase:readonly PairTrustBase[], calibration:B009Calibration=EXPERIMENTAL_B009_CALIBRATION, demand?:DemandInput,
):RuleEvaluator {
  const {initial,c}=prepareBase(initialBase,calibration)
  const drift=demand && checkConstantDrift(c)
  const modelKey=demand && demandKey(initial,c)
  const ledger=demand && structuredClone(demand.ledger)
  const evaluator:RuleEvaluator = (world:WorldState,ctx:EvaluationContext):RuleOutcome=>{
    if(ctx.ruleId!=='B-009'||ctx.phase!==3||world.year!==ctx.year){
      throw new EvaluationFailure('B009の年・フェーズ・RuleID不一致',[{code:'RULE_MISMATCH',message:String(ctx.ruleId)}])
    }
    const persons=world.persons.filter(p=>p.alive).sort((a,b)=>cmp(a.personId,b.personId))
    if(world.pairTrustDrift!==drift || world.pairTrustModelKey!==modelKey || (demand && ctx.year>=GOAL_YEAR))throw new EvaluationFailure('B009構成または評価年が不一致',[
      {code:'B009_MODEL_MISMATCH',message:String(world.pairTrustDrift)},
    ])
    const byId=new Map(persons.map(p=>[p.personId,p]))
    let n:number,pairs:Iterable<readonly [Id,Id]>
    if(demand){
      const needed=new Map<string,readonly [Id,Id]>()
      const candidates=registeredMarriageCandidates(world,demand.marriage.minAdultAge)
      // 比較不能なほど候補が多い場合はB-004自身が安全停止する。部分選抜しない。
      if(candidates.count<=demand.marriage.maxCandidatePairs)
        for(const ids of candidates.pairs())needed.set(pairKey(ids),ids)
      for(const m of ledger??[]){
        if(m.startYear>ctx.year || m.endExclusiveYear<=ctx.year || m.targetRef.kind!=='PERSON_PAIR')continue
        const ids=m.targetRef.ids
        if(ids.every(id=>byId.has(id)))needed.set(pairKey(ids),ids)
      }
      n=needed.size
      pairs=[...needed.values()].sort((a,b)=>cmp(a[0],b[0])||cmp(a[1],b[1]))
    } else {
      // DEC-061: SUPPORTING同士を除く、旧構成の全生存ペア。
      const supportingCount=persons.filter(p=>p.interactionRole==='SUPPORTING').length
      n=persons.length*(persons.length-1)/2-supportingCount*(supportingCount-1)/2
      pairs=allPairs(persons)
    }
    if(!Number.isSafeInteger(n)||n>c.maxPairs){
      throw new EvaluationFailure('B009の更新対象ペアが予算を超過',[
        {code:'PAIR_BUDGET_EXCEEDED',message:n+' > '+c.maxPairs},
      ])
    }
    const existing=new Map((world.pairTrust??[]).map(r=>[pairKey(r.personIds),r]))
    const commands:PersonPairTrustSetCommand[]=[]
    const traceDrafts:DecisionTraceDraft[]=[]
    for(const ids of pairs){
      const a=byId.get(ids[0])!,b=byId.get(ids[1])!
      const key=pairKey(ids)
      const old=existing.get(key)
      if(old && old.lastUpdatedYear>=ctx.year){
        throw new EvaluationFailure('関係値が既に当年更新済みであり二重更新を拒否',[
          {code:'RELATION_ALREADY_UPDATED',message:key},
        ])
      }
      let prev=old?.value??initial.get(key)??c.initialTrust+pairSpread(key,c.initialTrustSpread??0)
      let gapEvidence={}
      if(demand){
        const current=resolveThrough(world.year,ctx.year,ids,a,b,old,initial,c)
        if(current.status==='UNKNOWN')throw new EvaluationFailure('必要なB009基礎値を解決できません',[
          {code:current.reason,message:key},
        ])
        if(current.firstYear<ctx.year){
          const before=resolveThrough(world.year,ctx.year-1,ids,a,b,old,initial,c)
          if(before.status==='UNKNOWN')throw new EvaluationFailure('B009の前年度基礎値を解決できません',[
            {code:before.reason,message:key},
          ])
          prev=before.value
        }
        gapEvidence={firstEligibleYear:current.firstYear,previousBaseDerived:current.firstYear<ctx.year && old?.lastUpdatedYear!==ctx.year-1}
      }
      // 相互の出身集団が、相手のHouseを自家門に比べてどれだけ支持するか。
      // 集団支持はbpsで、合計を1000で割った試験ポイントを用いる（最大±20）。
      const groupA=world.groups.find(g=>g.groupId===a.originGroupId)
      const groupB=world.groups.find(g=>g.groupId===b.originGroupId)
      if(!groupA||!groupB)throw new EvaluationFailure('家門利害の参照集団が存在しません',[
        {code:'HOUSE_SUPPORT_GROUP_MISSING',message:key},
      ])
      const aToB=(groupA.support.houseBps[b.houseId]??0)-(groupA.support.houseBps[a.houseId]??0)
      const bToA=(groupB.support.houseBps[a.houseId]??0)-(groupB.support.houseBps[b.houseId]??0)
      const supportSignal=roundHalfAwayFromZero((aToB+bToA)/1000)
      const houseSupportDelta=supportSignal*(c.houseSupportWeight??0)||0 // -0を正規化し決定Traceを安定化
      const houseAffinityDelta=a.houseId===b.houseId?(c.sameHouseBonus??0):0
      const rawDelta=c.annualDelta+houseSupportDelta+houseAffinityDelta
      const next=clampTrust(prev+rawDelta)
      const traceIndex=traceDrafts.length
      const candidateId='b009:'+JSON.stringify([ctx.year,ids])
      traceDrafts.push({
        year:ctx.year,phase:ctx.phase,ruleId:ctx.ruleId,actorRef:{kind:'PERSON_PAIR',ids},
        candidates:[{
          candidateId,eligible:true,
          inputs:{personIds:[...ids],previousBaseTrust:prev,updatedBaseTrust:next,
            annualDelta:c.annualDelta,rawDelta,houseSupportDelta,houseAffinityDelta,
            houseSupportWeight:c.houseSupportWeight??0,sameHouseBonus:c.sameHouseBonus??0,
            houseIds:[a.houseId,b.houseId],originGroupIds:[a.originGroupId,b.originGroupId],
            reciprocalHouseSupportBps:[aToB,bToA],houseSupportSignal:supportSignal,
            baseFrom:old?'PRIOR_WORLDSTATE':initial.has(key)?'INITIAL_EVIDENCE':'NEW_PAIR_CALIBRATION',
            ...gapEvidence,previousUpdateYear:old?.lastUpdatedYear??null,provenance:'CALIBRATION_ONLY'},
          reasonCodes:['CALIBRATION_ONLY',old?'RELATION_CUMULATIVE_UPDATE':'RELATION_CREATED',
            (c.houseSupportWeight??0)!==0?'HOUSE_INTEREST_APPLIED':'HOUSE_INTEREST_DISABLED'],
        }],
        selectedCandidateId:candidateId,status:'ACCEPT',
        reasonCodes:['CALIBRATION_ONLY','B009_BASE_TRUST_ONLY','NO_MODIFIER_COMMIT',
          (c.houseSupportWeight??0)!==0?'HOUSE_INTEREST_APPLIED':'HOUSE_INTEREST_DISABLED'],
        modifierIds:[],ruleVersion:demand?B009_DEMAND_RULE_VERSION:B009_RULE_VERSION,
      })
      commands.push({
        type:'PERSON_PAIR_TRUST_SET',commandId:'cmd:b009:'+JSON.stringify([ctx.year,ids]),
        source:{requestId:'req:b009:'+JSON.stringify([ctx.year,ids]),year:ctx.year,phase:ctx.phase,
          sourceRuleId:'B-009',sourceTraceId:ctx.traceId(traceIndex)},
        relation:{personIds:ids,value:next,lastUpdatedYear:ctx.year},
      })
    }
    return {ruleId:ctx.ruleId,phase:ctx.phase,commands,requests:[],deferred:[],traceDrafts}
  }
  if(modelKey!==undefined)demandEvaluators.set(evaluator,modelKey)
  return evaluator
}
