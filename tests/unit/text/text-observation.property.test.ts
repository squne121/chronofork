import {describe,expect,it} from 'vitest'
import fc from 'fast-check'
import {runPlayBaseline,runPlayComparison} from '../../../src/ui/branch-play-source.ts'
import {TextGameSession} from '../../../src/text/game.ts'
import {parseBranch,parseInteger} from '../../../src/text/command.ts'

const INTERVENTION={year:1260,firstPersonId:'person-exp-04',secondPersonId:'person-exp-05',
  signedDelta:20,durationYears:5}
const baseline=runPlayBaseline(1)
const cmp=runPlayComparison({...INTERVENTION,seed:1})
if(!baseline.ok||!cmp.ok)throw new Error('準備失敗')
const session=new TextGameSession(1,'FIXED_APPROVAL')
session.intervene(INTERVENTION)
const traceIdsAt=(run:typeof baseline.a0,y:number)=>new Set(run.result.decisionTraces.filter(t=>t.year===y).map(t=>t.traceId))
type Obs={year:number;branch:string;world:{year:number};events:Array<{eventId:string;year:number;sourceTraceIds:string[]}>}
const opts={seed:20261107,numRuns:40}

describe('テキスト入出力の性質 (fast-check, 実CLIの世界)',()=>{
  it('observe: 任意の年・枝でEventは同年に属し、sourceTraceIdsは同じ枝のその年のTraceを指す',()=>{
    fc.assert(fc.property(fc.integer({min:1250,max:1350}),fc.constantFrom('A0' as const,'A1' as const),(year,b)=>{
      const r=session.observe(year,b)
      if(!r.ok)return expect(r.code).toBe('YEAR_UNAVAILABLE') // 1350年は年初状態のみ等、失敗は理由付き
      expect(r.channel).toBe('PLAYER')
      const d=r.data as Obs
      expect(d.year).toBe(year); expect(d.world.year).toBe(year); expect(d.branch).toBe(b)
      const run=b==='A0'?cmp.comparison.a0:cmp.comparison.a1
      const valid=traceIdsAt(run,year)
      for(const e of d.events){
        expect(e.year).toBe(year)
        for(const id of e.sourceTraceIds)expect(valid.has(id)).toBe(true)
      }
      expect(new Set(d.events.map(e=>e.eventId)).size).toBe(d.events.length)
      expect(JSON.stringify(r.data)).not.toMatch(/technicalGoal|coverage|decisionTraces/)
    }),opts)
  })

  it('介入年より前ではA0とA1のPLAYER観測が一致する（因果の逆流がない）',()=>{
    fc.assert(fc.property(fc.integer({min:1250,max:INTERVENTION.year-1}),year=>{
      expect(session.observe(year,'A1')).toEqual({...session.observe(year,'A0'),
        data:{...(session.observe(year,'A0') as {data:object}).data,branch:'A1'}})
    }),opts)
  })

  it('debug: DEBUG専用で、指定RuleIDの全Traceが同年・同RuleID',()=>{
    const rules=[...new Set(cmp.comparison.a1.result.decisionTraces.map(t=>t.ruleId))]
    fc.assert(fc.property(fc.integer({min:1250,max:1349}),fc.constantFrom(...rules),fc.constantFrom('A0' as const,'A1' as const),
      (year,rule,b)=>{
        const r=session.debug(year,b,rule)
        if(!r.ok)return
        expect(r.channel).toBe('DEBUG')
        const d=r.data as {traces:Array<{year:number;ruleId:string}>}
        for(const t of d.traces){expect(t.year).toBe(year);expect(t.ruleId).toBe(rule)}
      }),opts)
  })

  it('入力境界: A0/A1以外のbranch、10進整数以外の数値は決して受理されない',()=>{
    fc.assert(fc.property(fc.string(),s=>{
      expect(parseBranch(s).ok).toBe(s==='A0'||s==='A1')
    }),{...opts,numRuns:200})
    fc.assert(fc.property(fc.integer({min:0,max:99999}),n=>{
      expect(parseInteger(String(n))).toBe(n)
      expect(parseInteger('0x'+n.toString(16))).toBeNull()
      expect(parseInteger(n+'.5')).toBeNull()
      expect(parseInteger(n+'e3')).toBeNull()
      expect(parseInteger(' '+n)).toBeNull()
    }),opts)
  })
})
