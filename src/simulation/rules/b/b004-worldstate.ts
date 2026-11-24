// B-004: 明示ペア一覧ではなく、当年WorldStateの生存・未婚・試験成人から縁談候補を再探索。
// pair.trustがない人物組はNO_BASE/DEFERを維持。ここで婚姻適格性・法的権限は制定しない。
import type { Id, PairTrustBase, RuleOutcome, WorldState } from '../../contracts/index.ts'
import { supportingAnnualMarriageEvidence } from '../../autonomy/supporting-candidate-view.ts'
import type { SupportingCandidateResolver } from '../../autonomy/supporting-candidate-view.ts'
import type { EvaluationContext, RuleEvaluator } from '../../engine/evaluators.ts'
import { EvaluationFailure } from '../../engine/evaluators.ts'
import { createPairTrustView, normalizePersonPair, pairKey } from '../../intervention/index.ts'
import type { PairTrustView, StatModifierLedger } from '../../intervention/index.ts'
import type { AutonomyCalibration } from '../../autonomy/config.ts'
import { checkAutonomyCalibration } from '../../autonomy/config.ts'
import type { B004Calibration } from './b004-candidate.ts'
import { createB004CalibrationEvaluator } from './b004-candidate.ts'

const cmp=(a:string,b:string)=>a<b?-1:a>b?1:0
const worldStateEvaluators = new WeakMap<RuleEvaluator, Readonly<{resolve:SupportingCandidateResolver|undefined; minAdultAge:number}>>()
export const b004WorldStateEvidence = (evaluator: RuleEvaluator | undefined) =>
  evaluator && worldStateEvaluators.get(evaluator)

/** 人物の存在・年齢・婚姻状態から毎年候補を導出。超過は黙って捨てず停止する。 */
export function createB004WorldStateEvaluator(
  view:PairTrustView, input:AutonomyCalibration, calibration?:B004Calibration,
  ledger:StatModifierLedger=[],
  supporting?:Readonly<{resolve:SupportingCandidateResolver; trustBase:readonly PairTrustBase[]}>,
):RuleEvaluator {
  const match=checkAutonomyCalibration(input).marriage
  const resolveSupporting = supporting?.resolve
  const fixedCandidateTrust = structuredClone(supporting?.trustBase ?? [])
  const evaluator: RuleEvaluator = (world:WorldState,ctx:EvaluationContext):RuleOutcome=>{
    if(ctx.ruleId!=='B-004'||ctx.phase!==3||ctx.year!==world.year){
      throw new EvaluationFailure('B-004は当年フェーズ3でのみ評価可能',[{code:'RULE_MISMATCH',message:String(ctx.ruleId)}])
    }
    const married=new Set<Id>(world.legal.marriages.filter(m=>m.status==='ACTIVE').flatMap(m=>[...m.personIds]))
    const adults=world.persons.filter(p=>p.alive&&!married.has(p.personId)&&ctx.year-p.birthYear>=match.minAdultAge)
      .sort((a,b)=>cmp(a.personId,b.personId))
    const men=adults.filter(p=>p.sex==='MALE'),women=adults.filter(p=>p.sex==='FEMALE')
    const n=men.length*women.length-
      men.filter(p=>p.interactionRole==='SUPPORTING').length*
      women.filter(p=>p.interactionRole==='SUPPORTING').length
    if(!Number.isSafeInteger(n)||n>match.maxCandidatePairs){
      throw new EvaluationFailure('WorldState由来の縁談候補が校正予算を超過しました',[
        {code:'PAIR_BUDGET_EXCEEDED',message:n+' > '+match.maxCandidatePairs},
      ])
    }
    const supplied=resolveSupporting?.(world,ctx)??[]
    const eligible=supplied.filter(s=>{
      const seeker=adults.find(p=>p.personId===s.seekerId)
      return seeker!==undefined&&seeker.interactionRole!=='SUPPORTING'&&seeker.sex!==s.person.sex&&
        s.person.alive&&ctx.year-s.person.birthYear>=match.minAdultAge&&!married.has(s.person.personId)
    })
    if(n+eligible.length>match.maxCandidatePairs)throw new EvaluationFailure('縁談候補が校正予算を超過しました',[
      {code:'PAIR_BUDGET_EXCEEDED',message:String(n+eligible.length)},
    ])
    const pairs: [Id,Id][]=[]
    for(const a of men)for(const b of women){
      if(a.interactionRole==='SUPPORTING'&&b.interactionRole==='SUPPORTING')continue
      pairs.push(cmp(a.personId,b.personId)<0?[a.personId,b.personId]:[b.personId,a.personId])
    }
    // B-009実行後の年次WorldStateに信頼が存在すれば、動的基礎値＋当年介入を一度だけ解決する。
    // B-009を注入しない従来の試験では、元の静的PairTrustViewをそのまま利用する。
    let activeView=view
    if(world.pairTrust!==undefined){
      const known=new Set(world.persons.map(p=>p.personId))
      const resolved=createPairTrustView({
        base:world.pairTrust.map(r=>({personIds:r.personIds,value:r.value})),
        ledger,
        knownPersonIds:known,
      })
      if(!resolved.ok)throw new EvaluationFailure('B009の年次信頼と介入台帳を解決できません',
        resolved.issues.map(e=>({code:e.code,message:e.message})))
      activeView=resolved.view
    }
    const ev=createB004CalibrationEvaluator({pairs,view:activeView,calibration})
    if(!ev.ok)throw new EvaluationFailure('B004候補評価器を生成できません',ev.issues.map(i=>({code:i.code,message:i.message})))
    const out=ev.evaluator(world,ctx)
    const candidatePairs=eligible.map(s=>normalizePersonPair(s.seekerId,s.person.personId)).filter(p=>p!==null)
    const keys=new Set(candidatePairs.map(pairKey))
    const known=new Set([...world.persons.map(p=>p.personId),...eligible.map(s=>s.person.personId)])
    const candidateTrust=supportingAnnualMarriageEvidence(resolveSupporting,ctx)?.trustBase??fixedCandidateTrust
    const candidateView=createPairTrustView({base:candidateTrust.filter(b=>keys.has(pairKey(b.personIds))),ledger:[],knownPersonIds:known})
    if(!candidateView.ok)throw new EvaluationFailure('補助候補の明示信頼が不正',candidateView.issues.map(i=>({code:i.code,message:i.message})))
    const candidateEvaluator=createB004CalibrationEvaluator({pairs:candidatePairs,view:candidateView.view,calibration})
    if(!candidateEvaluator.ok)throw new EvaluationFailure('補助候補の評価器が不正',candidateEvaluator.issues.map(i=>({code:i.code,message:i.message})))
    const candidatePersons=[...new Map(eligible.map(s=>[s.person.personId,s.person])).values()]
    const candidateWorld={...world,persons:[...world.persons,...candidatePersons]}
    const candidateOut=candidateEvaluator.evaluator(candidateWorld,ctx)
    return {
      ...out,
      traceDrafts:[
        ...out.traceDrafts.map(d=>({d,trustSource:world.pairTrust===undefined?'STATIC_VIEW':'B009_WORLDSTATE'})),
        ...candidateOut.traceDrafts.map(d=>({d,trustSource:'CALIBRATION_ONLY_CANDIDATE_BASE'})),
      ].map(({d,trustSource})=>({
        ...d,
        reasonCodes:[...d.reasonCodes,'DISCOVERED_FROM_WORLDSTATE','ELIGIBILITY_STILL_UNREVIEWED'],
        candidates:d.candidates.map(c=>({
          ...c,
          inputs:{...c.inputs,discoveredFromWorldState:true,trustSource},
        })),
      })),
    }
  }
  worldStateEvaluators.set(evaluator, {resolve:resolveSupporting,minAdultAge:match.minAdultAge})
  return evaluator
}
