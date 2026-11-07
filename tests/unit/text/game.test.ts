import {describe,expect,it} from 'vitest'
import {createExperimentalWorld} from '../../../src/scenario/experimental/index.ts'
import {runPlayBaseline,runPlayComparison} from '../../../src/ui/branch-play-source.ts'
import {
  debugObservation,playerObservation,summarizeWorld,TextGameSession,textReport,
} from '../../../src/text/game.ts'

const INTERVENTION={year:1260,firstPersonId:'person-exp-04',secondPersonId:'person-exp-05',
  signedDelta:20,durationYears:5}
const base=runPlayBaseline(1)
const cmp=runPlayComparison({...INTERVENTION,seed:1})
if(!base.ok||!cmp.ok)throw new Error('実A0/A1の準備に失敗')
const a0=base.a0
const {a1}=cmp.comparison
const ids=(xs:ReadonlyArray<{eventId:string}>)=>xs.map(x=>x.eventId)

describe('プレイヤー用テキストI/Oと明示的デバッグの境界（実CLIの世界）',()=>{
  it('WorldStateの実値だけを要約し、未来やGoalを捏造しない',()=>{
    const world=createExperimentalWorld()
    const view=summarizeWorld(world)
    expect(view.year).toBe(world.year)
    expect(view.groups.reduce((s,g)=>s+g.population,0))
      .toBe(world.groups.reduce((s,g)=>s+g.population,0))
    expect(view.titles.map(t=>t.id)).toEqual(world.titles.map(t=>t.titleId))
    for(const k of ['technicalGoal','cohortSlots','random'])expect(JSON.stringify(view)).not.toContain(k)
  })

  it('同じ入力条件のA0は単独実行と介入比較実行で完全一致する',()=>{
    expect(cmp.comparison.a0).toEqual(a0)
    expect(cmp.comparison.a0.inputs).toEqual(a0.inputs)
  })

  it('A0観測: TextGameSessionの実A0のEvent・世界と一致し、DEBUG項目を含まない',()=>{
    const s=new TextGameSession(1,'FIXED_APPROVAL')
    const r=s.observe(1260,'A0')
    expect(r).toMatchObject({ok:true,channel:'PLAYER',action:'observe'})
    if(!r.ok)return
    const d=r.data as {year:number;branch:string;events:Array<{eventId:string}>;world:{year:number}}
    expect(d.branch).toBe('A0')
    expect(d.world.year).toBe(1260)
    expect(ids(d.events)).toEqual(ids(a0.result.eventLog.filter(e=>e.year===1260)))
    expect(d.events.length).toBeGreaterThan(0)
    for(const k of ['technicalGoal','coverage','traces','inputs'])expect(r.data).not.toHaveProperty(k)
    expect(JSON.stringify(r.data)).not.toContain('technicalGoal')
  })

  it('A1作成後の観測はA1の実Eventを返し、A0とA1が混ざらない',()=>{
    const s=new TextGameSession(1,'FIXED_APPROVAL')
    expect(s.intervene(INTERVENTION)).toMatchObject({ok:true,channel:'PLAYER',action:'intervene'})
    const y=1262
    const r1=s.observe(y,'A1'); const r0=s.observe(y,'A0')
    if(!r1.ok||!r0.ok)throw new Error('観測失敗')
    expect(ids((r1.data as {events:Array<{eventId:string}>}).events))
      .toEqual(ids(a1.result.eventLog.filter(e=>e.year===y)))
    expect(ids((r0.data as {events:Array<{eventId:string}>}).events))
      .toEqual(ids(a0.result.eventLog.filter(e=>e.year===y)))
    expect((r1.data as {branch:string}).branch).toBe('A1')
    // 介入前の年はA0とA1の世界が同じ（A1が過去を書き換えない）
    const pre1=s.observe(1255,'A1'); const pre0=s.observe(1255,'A0')
    expect(pre1.ok&&pre0.ok&&JSON.stringify((pre1.data as {world:unknown}).world))
      .toBe(JSON.stringify((pre0.ok?(pre0.data as {world:unknown}).world:null)))
  })

  it('比較: 実際のcompareYearの差分とA0/A1世界を返す',()=>{
    const s=new TextGameSession(1,'FIXED_APPROVAL')
    s.intervene(INTERVENTION)
    const r=s.compare(1300)
    if(!r.ok)throw new Error('比較失敗')
    const d=r.data as {year:number;a0:{year:number};a1:{year:number};events:Array<{kind:string;eventId:string}>}
    expect(d.a0.year).toBe(1300); expect(d.a1.year).toBe(1300)
    const a0Ids=new Set(ids(a0.result.eventLog.filter(e=>e.year===1300)))
    const a1Ids=new Set(ids(a1.result.eventLog.filter(e=>e.year===1300)))
    for(const e of d.events){
      if(e.kind==='A1_ONLY'){expect(a1Ids.has(e.eventId)).toBe(true);expect(a0Ids.has(e.eventId)).toBe(false)}
      if(e.kind==='A0_ONLY'){expect(a0Ids.has(e.eventId)).toBe(true);expect(a1Ids.has(e.eventId)).toBe(false)}
      if(e.kind==='CHANGED'){expect(a0Ids.has(e.eventId)&&a1Ids.has(e.eventId)).toBe(true)}
    }
    expect(JSON.stringify(r.data)).not.toContain('technicalGoal')
  })

  it('inspect: Event/Traceは実履歴を参照し、存在しない対象や年は失敗する',()=>{
    const s=new TextGameSession(1,'FIXED_APPROVAL')
    s.intervene(INTERVENTION)
    const ev=a1.result.eventLog.find(e=>e.year===1262)
    if(!ev)throw new Error('1262年のEventがありません')
    const r=s.inspect('event',ev.eventId,1262,'A1')
    expect(r).toMatchObject({ok:true,channel:'PLAYER'})
    if(r.ok)expect((r.data as {sourceTraceIds:string[]}).sourceTraceIds).toEqual(ev.sourceTraceIds)
    // 存在しないA0側ではA1のEventが見つからない場合がある（枝を混ぜない）
    const only=a1.result.eventLog.find(e=>e.year===1262&&!a0.result.eventLog.some(x=>x.eventId===e.eventId))
    if(only)expect(s.inspect('event',only.eventId,1262,'A0')).toMatchObject({ok:false,code:'ENTITY_NOT_FOUND'})
    expect(s.inspect('person','no-such',1262,'A1')).toMatchObject({ok:false,code:'ENTITY_NOT_FOUND'})
    expect(s.inspect('person','person-exp-04',1351,'A1')).toMatchObject({ok:false,code:'YEAR_UNAVAILABLE'})
    const p=s.inspect('person','person-exp-04',1262,'A1')
    expect(p).toMatchObject({ok:true,channel:'PLAYER'})
    expect(JSON.stringify(p)).not.toContain('technicalGoal')
  })

  it('debug: 明示操作でのみDEBUGを返し、RuleIDと年で実Traceを絞る',()=>{
    const s=new TextGameSession(1,'FIXED_APPROVAL')
    s.intervene(INTERVENTION)
    const rule=a1.result.decisionTraces.find(t=>t.year===1260)?.ruleId
    if(!rule)throw new Error('1260年のTraceがありません')
    const r=s.debug(1260,'A1',rule)
    expect(r).toMatchObject({ok:true,channel:'DEBUG',action:'debug'})
    if(!r.ok)return
    const d=r.data as {traces:Array<{year:number;ruleId:string;traceId:string}>;events:Array<{eventId:string;sourceTraceIds:string[]}>}
    expect(d.traces.length).toBe(a1.result.decisionTraces.filter(t=>t.year===1260&&t.ruleId===rule).length)
    expect(d.traces.every(t=>t.year===1260&&t.ruleId===rule)).toBe(true)
    const tids=new Set(d.traces.map(t=>t.traceId))
    expect(d.events.every(e=>e.sourceTraceIds.some(x=>tids.has(x)))).toBe(true)
    expect(r.data).toHaveProperty('coverage')
    expect(r.data).toHaveProperty('technicalGoal')
    const a0debug=s.debug(1260,'A0')
    expect(a0debug).toMatchObject({ok:true,channel:'DEBUG'})
  })

  it('A1作成前にA1の世界や比較結果を成功扱いしない／未計算年は失敗する',()=>{
    const s=new TextGameSession(1,'FIXED_APPROVAL')
    expect(s.observe(1250,'A1')).toMatchObject({ok:false,code:'NO_BRANCH'})
    expect(s.inspect('person','person-exp-04',1250,'A1')).toMatchObject({ok:false,code:'NO_BRANCH'})
    expect(s.debug(1250,'A1')).toMatchObject({ok:false,code:'NO_BRANCH'})
    expect(s.compare(1350)).toMatchObject({ok:false,code:'NO_BRANCH'})
    const invalid=playerObservation(a0,1351,'A0')
    expect(invalid).toMatchObject({ok:false,code:'YEAR_UNAVAILABLE'})
    expect(debugObservation(a0,1351)).toMatchObject({ok:false,code:'YEAR_UNAVAILABLE'})
    expect(textReport(invalid)).toContain('YEAR_UNAVAILABLE')
  })

  it('型を迂回した不正branchはA0へ落とさず拒否する',()=>{
    const s=new TextGameSession(1,'FIXED_APPROVAL')
    for(const b of ['A2','a1','',' A0'] as unknown as Array<'A0'>){
      expect(s.observe(1250,b)).toMatchObject({ok:false,code:'INVALID_BRANCH'})
      expect(s.debug(1250,b)).toMatchObject({ok:false,code:'INVALID_BRANCH'})
      expect(s.inspect('person','person-exp-04',1250,b)).toMatchObject({ok:false,code:'INVALID_BRANCH'})
    }
  })
})
