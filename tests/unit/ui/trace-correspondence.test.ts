import { describe, expect, it } from 'vitest'
import type { DecisionTrace, EventLogEntry, TargetRef, TraceCandidate } from '../../../src/simulation/contracts/index.ts'
import { actorKey, compareTraces, correspondTraces } from '../../../src/ui/trace-correspondence.ts'
import { PLAY_DEMO_PAIR, compareYear, runPlayComparison } from '../../../src/ui/branch-play-source.ts'

const cand=(id:string,score=1):TraceCandidate=>({candidateId:id,eligible:true,inputs:{},score,reasonCodes:[]})
const tr=(traceId:string,actor:TargetRef,cands:string[],o:Partial<DecisionTrace>={}):DecisionTrace=>({
  traceId,year:1260,phase:3,ruleId:'B-004',actorRef:actor,candidates:cands.map(c=>cand(c)),
  status:'REJECT',reasonCodes:[],modifierIds:[],eventIds:[],ruleVersion:'v',...o,
})
const P=(id:string):TargetRef=>({kind:'PERSON',id})
const pair=(a:string,b:string):TargetRef=>({kind:'PERSON_PAIR',ids:[a,b]})

describe('correspondTraces: 判断の意味での対応付け',()=>{
  it('同じtraceIdでもactorが違えば結合しない（旧方式の誤対応）',()=>{
    const c=correspondTraces([tr('trace:1',P('p1'),['c'])],[tr('trace:1',P('p2'),['c'])])
    expect(c.pairs).toEqual([])
    expect(c.a0Only).toHaveLength(1)
    expect(c.a1Only).toHaveLength(1)
  })
  it('traceIdが違っても同じactor・ruleなら同じ判断として対応する（ID差だけで変更扱いにしない）',()=>{
    const r=compareTraces([tr('trace:0',P('p1'),['c'])],[tr('trace:7',P('p1'),['c'])],[],[])
    expect(r.correspondence.pairs).toHaveLength(1)
    expect(r.deltas).toEqual([])
    expect(r.summary).toMatchObject({matched:1,unchanged:1,changed:0})
  })
  it('結果が違えば変更として残し、各枝の実traceIdを保持する',()=>{
    const r=compareTraces([tr('trace:0',P('p1'),['c'])],[tr('trace:7',P('p1'),['c'],{status:'ACCEPT',modifierIds:['m']})],[],[])
    expect(r.deltas).toHaveLength(1)
    expect(r.deltas[0]).toMatchObject({kind:'CHANGED'})
    expect(r.deltas[0]!.before!.traceId).toBe('trace:0')
    expect(r.deltas[0]!.after!.traceId).toBe('trace:7')
  })
  it('PERSON_PAIRは順序に依存せず正規化される',()=>{
    expect(actorKey(pair('a','b'))).toBe(actorKey({kind:'PERSON_PAIR',ids:['b','a']}))
  })
  it('候補の新規追加: 1対1のactorは対応し、候補差は変更として見える',()=>{
    const r=compareTraces([tr('t0',P('p'),['c1'])],[tr('t0',P('p'),['c1','c2'])],[],[])
    expect(r.summary.matched).toBe(1)
    expect(r.deltas[0]).toMatchObject({kind:'CHANGED'})
  })
  it('判断の新規/消滅を区別する',()=>{
    const r=correspondTraces([tr('t0',P('gone'),['c'])],[tr('t0',P('new'),['c'])])
    expect(r.a0Only.map(t=>actorKey(t.actorRef))).toEqual(['PERSON:gone'])
    expect(r.a1Only.map(t=>actorKey(t.actorRef))).toEqual(['PERSON:new'])
  })
  it('同actor・同ruleで複数あり、候補ID集合が一意なら順序が違っても対応する（順序変更）',()=>{
    const a0=[tr('t0',P('p'),['x']),tr('t1',P('p'),['y'])]
    const a1=[tr('t0',P('p'),['y']),tr('t1',P('p'),['x'])]
    const c=correspondTraces(a0,a1)
    expect(c.ambiguous).toEqual([])
    expect(c.pairs.map(p=>[p.before.candidates[0]!.candidateId,p.after.candidates[0]!.candidateId])
      .sort()).toEqual([['x','x'],['y','y']])
  })
  it('重複（同一候補集合が複数）は曖昧とし、配列順で結ばない',()=>{
    const a0=[tr('t0',P('p'),['x']),tr('t1',P('p'),['x'])]
    const a1=[tr('t0',P('p'),['x']),tr('t1',P('p'),['x'])]
    const c=correspondTraces(a0,a1)
    expect(c.pairs).toEqual([])
    expect(c.ambiguous).toHaveLength(1)
    expect(c.ambiguous[0]!.before).toHaveLength(2)
    expect(compareTraces(a0,a1,[],[]).deltas[0]).toMatchObject({kind:'AMBIGUOUS'})
  })
  it('複数あり候補集合も変わって決められない場合は曖昧（恣意的に対応付けない）',()=>{
    const c=correspondTraces([tr('t0',P('p'),['x']),tr('t1',P('p'),['y'])],[tr('t0',P('p'),['x','z']),tr('t1',P('p'),['y','w'])])
    expect(c.pairs).toEqual([])
    expect(c.ambiguous).toHaveLength(1)
  })
  it('片側だけに複数ある場合は残りを新規/消滅として扱う',()=>{
    const c=correspondTraces([tr('t0',P('p'),['x'])],[tr('t0',P('p'),['x']),tr('t1',P('p'),['y'])])
    expect(c.pairs).toHaveLength(1)
    expect(c.a1Only).toHaveLength(1)
    expect(c.ambiguous).toEqual([])
  })
  it('Event→Traceの因果差はeventIdの採番ではなくsemanticEventKeyで比較する',()=>{
    const ev=(id:string,key:string):EventLogEntry=>({eventId:id,semanticEventKey:key,year:1260,phase:3,eventType:'X',
      involvedRefs:[],stateChanges:[],sourceTraceIds:[]})
    const same=compareTraces([tr('a',P('p'),['c'],{eventIds:['e0']})],[tr('b',P('p'),['c'],{eventIds:['e9']})],
      [ev('e0','K')],[ev('e9','K')])
    expect(same.deltas).toEqual([])
    const diff=compareTraces([tr('a',P('p'),['c'],{eventIds:['e0']})],[tr('b',P('p'),['c'],{eventIds:['e9']})],
      [ev('e0','K')],[ev('e9','OTHER')])
    expect(diff.deltas).toHaveLength(1)
  })
})

describe('実計算: seed 20260101 / 1260年 / 人物04×05 / +20 / 5年',()=>{
  const r=runPlayComparison({mode:'FIXED_APPROVAL',seed:20260101,year:1260,firstPersonId:PLAY_DEMO_PAIR[0],
    secondPersonId:PLAY_DEMO_PAIR[1],signedDelta:20,durationYears:5})
  it('全年で、対応付けたTraceに異なるactorRefの結合が0件・一対一',()=>{
    expect(r.ok).toBe(true)
    if(!r.ok)return
    const c=r.comparison
    let matched=0
    for(let y=1250;y<1350;y++){
      const k=correspondTraces(c.a0.result.decisionTraces.filter(t=>t.year===y),c.a1.result.decisionTraces.filter(t=>t.year===y))
      expect(k.pairs.filter(p=>actorKey(p.before.actorRef)!==actorKey(p.after.actorRef))).toHaveLength(0)
      expect(new Set(k.pairs.map(p=>p.before.traceId)).size).toBe(k.pairs.length)
      expect(new Set(k.pairs.map(p=>p.after.traceId)).size).toBe(k.pairs.length)
      matched+=k.pairs.length
    }
    expect(matched).toBeGreaterThan(0)
  })
  it('各枝の実traceIdとEvent→Traceリンクが保持され、対象B-004の変化は隠れない',()=>{
    if(!r.ok)return
    const c=r.comparison
    for(const run of [c.a0,c.a1]){
      const ids=new Set(run.result.decisionTraces.map(t=>t.traceId))
      expect(run.result.eventLog.every(e=>e.sourceTraceIds.every(id=>ids.has(id)))).toBe(true)
    }
    const d=compareYear(c,1260)
    const b4=d.traces.find(t=>t.kind==='CHANGED'&&t.ruleId==='B-004'&&t.after?.actorRef.kind==='PERSON_PAIR'&&
      actorKey(t.after.actorRef)===actorKey({kind:'PERSON_PAIR',ids:PLAY_DEMO_PAIR}))
    expect(b4?.before?.status).toBe('REJECT')
    expect(b4?.after?.status).toBe('ACCEPT')
    expect(d.traceSummary.matched).toBe(d.traceSummary.unchanged+d.traceSummary.changed)
  })
})
