import { describe, expect, it } from 'vitest'
import { createExperimentalOrdinaryLegalTrial, createExperimentalWorld } from '../../../src/scenario/experimental/index.ts'
import { createAutonomousCalibrationEvaluators } from '../../../src/simulation/autonomy/index.ts'
import type { DecisionTrace } from '../../../src/simulation/contracts/index.ts'
import { runYear } from '../../../src/simulation/engine/index.ts'
import type { EvaluationContext } from '../../../src/simulation/engine/evaluators.ts'
import { EXPERIMENTAL_NEXTGEN_CONTRACT } from '../../../src/simulation/legal/nextgen-contract.ts'
import { createB005NextgenEvaluator } from '../../../src/simulation/rules/b/b005-nextgen.ts'

const world=createExperimentalWorld()
const trial=createExperimentalOrdinaryLegalTrial()
const calibration={...EXPERIMENTAL_NEXTGEN_CONTRACT,ownDynastyBonus:2,otherDynastyCost:0,
  titleWeight:4,noClauseCost:5,supportWeight:0}
const evaluators=createAutonomousCalibrationEvaluators({
  branchStartWorld:world,ledger:[],trustBase:[{personIds:['person-exp-02','person-exp-05'],value:40}],
  nextgenMarriage:{book:trial.book,laws:trial.laws,calibration},
})
if(!evaluators.ok)throw new Error(evaluators.issues.join(','))
const result=runYear(world,{seed:20260101,branchId:'A0',evaluators:evaluators.evaluators})
if(result.status!=='COMPLETED')throw new Error(JSON.stringify(result.halt))
const source=result.traces.find(t=>t.ruleId==='B-004'&&t.actorRef.kind==='PERSON_PAIR'&&
  t.actorRef.ids.includes('person-exp-02')&&t.actorRef.ids.includes('person-exp-05'))!
const evaluate=(traces:readonly DecisionTrace[])=>createB005NextgenEvaluator(calibration)(world,{
  year:world.year,phase:3,ruleId:'B-005',seed:20260101,branchId:'A0',priorTraces:traces,
  traceId:i=>'test:'+i,random:()=>0,
} satisfies EvaluationContext)

describe('B005 B004 evidence boundary',()=>{
  it('accepts a real selected candidate but ignores another year or phase',()=>{
    expect(evaluate([source]).requests).toHaveLength(1)
    expect(evaluate([{...source,year:world.year-1}]).requests).toHaveLength(0)
    expect(evaluate([{...source,phase:2}]).requests).toHaveLength(0)
  })
  it('does not infer selection from an unselected, ineligible, or ambiguous candidate',()=>{
    const candidate=source.candidates[0]!
    for(const trace of [
      {...source,selectedCandidateId:'other'},
      {...source,candidates:[{...candidate,eligible:false}]},
      {...source,candidates:[candidate,candidate]},
    ]){
      const outcome=evaluate([trace])
      expect(outcome.requests).toHaveLength(0)
      expect(outcome.traceDrafts[0]?.reasonCodes).toContain('B004_SCORE_MISSING')
    }
  })
})
