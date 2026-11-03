// UI操作の結果が真のrunTimeline/forkHistory/WorldState/EventLog/DecisionTrace由来であることを確認する。
import { describe,expect,it } from 'vitest'
import { compareYear, directlyInvolvesPair, PLAY_DEMO_PAIR, runPlayComparison } from '../../../src/ui/branch-play-source.ts'
import type { PlayInput } from '../../../src/ui/branch-play-source.ts'
const REQUEST:PlayInput={seed:20260101,year:1260,firstPersonId:PLAY_DEMO_PAIR[0],
  secondPersonId:PLAY_DEMO_PAIR[1],signedDelta:20,durationYears:5}
const result=runPlayComparison(REQUEST)
const data=result.ok?result.comparison:null

describe('UI向け実歴史比較アダプタ（CALIBRATION_ONLY）',()=>{
  it('本物の1250〜1350年のA0と1260年分岐A1を完成させ、元のA0には介入を入れない',()=>{
    expect(result.ok).toBe(true)
    expect(data).not.toBeNull()
    if(!data)return
    expect(data.root.status).toBe('COMPLETED')
    expect(data.branch.status).toBe('COMPLETED')
    expect(data.root.ledger).toEqual([])
    expect(data.branch.ledger).toHaveLength(1)
    expect(data.branch.ledger[0]).toEqual(data.modifier)
    expect(data.branch.recompute).toMatchObject({fromYear:1260,status:'COMPLETED',transitions:90})
    expect(data.a0.result.snapshots).toHaveLength(101)
    expect(data.a1.result.snapshots).toHaveLength(101)
    expect(data.a0.result.snapshots.slice(0,11)).toEqual(data.a1.result.snapshots.slice(0,11))
    expect(data.a0.result.goal).toBeNull()
    expect(data.a1.result.goal).toBeNull()
    expect(data.a1.result.autonomousHistory.status).toBe('NOT_ESTABLISHED')
    expect(data.a1.result.coverage.todoRuleIds).toHaveLength(37)
    expect(data.a1.result.eventLog).toEqual(data.branch.eventLog)
  })

  it('同年の実B-004判断とEvent差分が、介入対象と注目外の変化を区別できる',()=>{
    if(!data)return
    const diff=compareYear(data,1260)
    const pair=(run:'a0'|'a1')=>data[run].result.decisionTraces.find(t=>t.year===1260&&
      t.ruleId==='B-004'&&t.actorRef.kind==='PERSON_PAIR'&&
      t.actorRef.ids[0]===PLAY_DEMO_PAIR[0]&&t.actorRef.ids[1]===PLAY_DEMO_PAIR[1])
    const a0=pair('a0')!,a1=pair('a1')!
    expect([a0.status,a1.status]).toEqual(['REJECT','ACCEPT'])
    expect([a0.candidates[0]?.score,a1.candidates[0]?.score]).toEqual([21,41])
    expect(a1.modifierIds).toEqual([data.modifier.modifierId])
    const marriage=diff.events.find(d=>d.event.eventType==='MARRIAGE_REGISTER')
    expect(marriage).toBeDefined()
    expect(marriage?.kind).toBe('A1_ONLY')
    expect(marriage&&directlyInvolvesPair(marriage.event,PLAY_DEMO_PAIR)).toBe(true)
    expect(diff.traces.some(t=>t.ruleId==='B-004'&&t.before?.status!==t.after?.status)).toBe(true)
    expect(compareYear(data,1259).events).toEqual([])
    expect(compareYear(data,1350).events).toEqual([])
  })

  it('介入後の出生・死亡・法的王朝/相続は実Eventと年初状態を参照する',()=>{
    if(!data)return
    const marriage=data.a1.result.eventLog.filter(e=>e.eventType==='MARRIAGE_REGISTER')
    const birth=data.a1.result.eventLog.filter(e=>e.eventType==='PERSON_BIRTH')
    const death=data.a1.result.eventLog.filter(e=>e.eventType==='PERSON_DEATH')
    expect(marriage).toHaveLength(1)
    expect(birth.length).toBeGreaterThan(0)
    expect(death.length).toBeGreaterThan(0)
    expect(birth.every(e=>e.sourceTraceIds.every(t=>data.a1.result.decisionTraces.some(x=>x.traceId===t)))).toBe(true)
    const y=marriage[0]!.year
    expect(data.a1.result.snapshots.find(w=>w.year===y)?.legal.marriages).toHaveLength(0)
    expect(data.a1.result.snapshots.find(w=>w.year===y+1)?.legal.marriages).toHaveLength(1)
    expect(data.a0.result.snapshots.find(w=>w.year===y+1)?.legal.marriages).toHaveLength(0)
    expect(compareYear(data,1261).events.some(e=>e.event.eventType==='PERSON_BIRTH')).toBe(true)
  })

  it.each([
    ['負のseed',{...REQUEST,seed:-1},'INVALID_SEED'],
    ['年が1350',{...REQUEST,year:1350},'INVALID_YEAR'],
    ['同じ人物',{...REQUEST,secondPersonId:REQUEST.firstPersonId},'INVALID_PERSON_PAIR'],
    ['存在しない人物',{...REQUEST,secondPersonId:'no-person'},'UNKNOWN_PERSON'],
    ['0補正',{...REQUEST,signedDelta:0},'INVALID_DELTA'],
    ['1350年を越える',{...REQUEST,durationYears:95},'INVALID_DURATION'],
  ] as const)('不正な入力% sを完走と偽らず拒否',(_label,bad,code)=>{
    expect(runPlayComparison(bad)).toMatchObject({ok:false,code})
  })
})
