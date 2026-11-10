// Issue #104 実データ検証（100年・実計算）。通常のquick-checkには入れないオプトイン:
//   CHRONOFORK_LONG_LATER_KEY=1 NODE_OPTIONS=--max-old-space-size=6144 npx vitest run tests/unit/ui/later-key-intervention-long.test.ts
// 婚姻・出生・勝利を強制しない。差分が無ければ無い結果をそのまま記録する（CALIBRATION_ONLY）。
import {isDeepStrictEqual} from 'node:util'
import {describe,expect,it} from 'vitest'
import {runPlayBaseline,runPlayComparison,compareYear} from '../../../src/ui/branch-play-source.ts'
import type {PlayInput} from '../../../src/ui/branch-play-source.ts'
import {candidatesAtYear,runPlayCandidates} from '../../../src/ui/play-candidates.ts'
import {toDisplayView} from '../../../src/ui/play-view.ts'
import {interventionTargetIssue} from '../../../src/ui/branch-play-source.ts'

const longTest=process.env.CHRONOFORK_LONG_LATER_KEY==='1'?describe:describe.skip
const SEED=20260101,YEAR=1278
// fork年初のsnapshotは再計算の起点として複製されJSONキー順だけ変わり得るため、キー順に依存しない深い等価で比較する。
const eq=<T>(a:readonly T[],b:readonly T[])=>a.length===b.length&&a.every((x,i)=>x===b[i]||isDeepStrictEqual(x,b[i]))

longTest('後出生KEY人物への介入（seed 20260101・INTEGRATED_EXPERIMENTAL）',()=>{
  const base=runPlayBaseline(SEED,'INTEGRATED_EXPERIMENTAL')
  if(!base.ok)throw new Error(base.code)
  const a0=base.a0.result
  const initialIds=new Set(a0.snapshots[0]!.persons.map(p=>p.personId))
  const birth=a0.eventLog.find(e=>e.year===1252&&e.eventType==='PERSON_BIRTH')
  const childId=(birth?.involvedRefs.find(r=>r.kind==='PERSON') as {id:string}|undefined)?.id as string
  const mk=(x:Partial<PlayInput>):PlayInput=>({mode:'INTEGRATED_EXPERIMENTAL',seed:SEED,year:YEAR,
    firstPersonId:'person-exp-05',secondPersonId:childId,signedDelta:20,durationYears:5,...x})
  const run=runPlayComparison(mk({}))

  it('1252年B-002出生の人物は初期人物でなく、1278年の実WorldStateに存在し、role省略=KEY',()=>{
    expect(childId).toBeTruthy()
    expect(initialIds.has(childId)).toBe(false)
    const p=a0.snapshots.find(w=>w.year===YEAR)!.persons.find(x=>x.personId===childId)
    expect(p).toBeDefined()
    expect(p!.interactionRole??'KEY').toBe('KEY')
  })
  it('適格な介入が受理され、A0は介入前に不変、A1だけに台帳が入り、決定的に再現できる',()=>{
    expect(run.ok).toBe(true)
    if(!run.ok)return
    const c=run.comparison
    expect(c.root.ledger).toEqual([]);expect(c.branch.ledger).toEqual([c.modifier])
    expect(c.modifier.startYear).toBe(YEAR)
    const cut=YEAR-a0.startYear
    expect(eq(c.a0.result.snapshots.slice(0,cut+1),c.a1.result.snapshots.slice(0,cut+1))).toBe(true)
    expect(eq(c.a0.result.eventLog.filter(e=>e.year<YEAR),c.a1.result.eventLog.filter(e=>e.year<YEAR))).toBe(true)
    expect(eq(c.a0.result.snapshots,a0.snapshots)).toBe(true)
    expect(eq(c.a0.result.eventLog,a0.eventLog)).toBe(true)
    expect(c.a0.result.decisionTraces.some(t=>t.modifierIds.includes(c.modifier.modifierId))).toBe(false)
    const d=compareYear(c,YEAR)
    console.info('LATER_KEY childId='+childId+' events@'+YEAR+'='+d.events.length+' traceSummary='+JSON.stringify(d.traceSummary))
    const again=runPlayComparison(mk({}))
    if(!again.ok)throw new Error(again.code)
    expect(eq(c.a1.result.snapshots,again.comparison.a1.result.snapshots)).toBe(true)
    expect(eq(c.a1.result.eventLog,again.comparison.a1.result.eventLog)).toBe(true)
    expect(eq(c.a1.result.decisionTraces,again.comparison.a1.result.decisionTraces)).toBe(true)
  },1800000)
  it('GUI候補は実A0のfork年初WorldStateと一致し、1252年出生の人物は1251年に出ず1278年に出る',()=>{
    const c=runPlayCandidates(SEED,'INTEGRATED_EXPERIMENTAL')
    if(!c.ok)throw new Error(c.code)
    expect(candidatesAtYear(c.set,1251).some(x=>x.id===childId)).toBe(false)
    expect(candidatesAtYear(c.set,YEAR).some(x=>x.id===childId)).toBe(true)
    for(const y of [1250,1251,1252,YEAR,1349]){
      const w=a0.snapshots.find(x=>x.year===y)!
      const eligible=w.persons.filter(p=>interventionTargetIssue(w,[p.personId,p.personId])===null).map(p=>p.personId).sort()
      expect(candidatesAtYear(c.set,y).map(x=>x.id).sort()).toEqual(eligible)
    }
    expect(c.set.candidates.some(x=>a0.snapshots.every(w=>!w.persons.some(p=>p.personId===x.id)))).toBe(false)
    console.info('LATER_KEY candidates='+c.set.candidates.length+' at'+YEAR+'='+candidatesAtYear(c.set,YEAR).length)
  },1800000)
  it('GUIが受け取る転送ビューは、CLIと同じ入口の結果と入力・介入・A1の状態が一致する',()=>{
    if(!run.ok)throw new Error('run failed')
    const v=toDisplayView(run.comparison)
    expect(v.input).toEqual(run.comparison.input);expect(v.modifier).toEqual(run.comparison.modifier)
    expect(eq(v.a1.result.snapshots,run.comparison.a1.result.snapshots)).toBe(true)
    expect(eq(v.a0.result.snapshots,run.comparison.a0.result.snapshots)).toBe(true)
    expect(v.a1.result.technicalGoal).toEqual(run.comparison.a1.result.technicalGoal)
    expect(v.a1.result.goal).toBeNull()
  })
  it('Event↔Trace参照が閉じている',()=>{
    if(!run.ok)throw new Error('run failed')
    const r=run.comparison.a1.result
    const e=new Set(r.eventLog.map(x=>x.eventId)),t=new Set(r.decisionTraces.map(x=>x.traceId))
    expect(r.eventLog.every(x=>x.sourceTraceIds.every(i=>t.has(i)))).toBe(true)
    expect(r.decisionTraces.every(x=>x.eventIds.every(i=>e.has(i)))).toBe(true)
  })
  it('未出生年・存在しない人物は拒否される',()=>{
    expect(runPlayComparison(mk({year:1251}))).toMatchObject({ok:false,code:'UNKNOWN_PERSON'})
    expect(runPlayComparison(mk({secondPersonId:'person-none'}))).toMatchObject({ok:false,code:'UNKNOWN_PERSON'})
  },1800000)
  it('SUPPORTING人物は拒否される（実在する最初の年のWorldStateで）',()=>{
    const w=a0.snapshots.find(x=>x.year>=1251&&x.year<1350&&x.persons.some(p=>p.interactionRole==='SUPPORTING'))
    expect(w,'A0に実SUPPORTING人物が存在すること').toBeDefined()
    const sup=w!.persons.find(p=>p.interactionRole==='SUPPORTING')!
    console.info('LATER_KEY supporting='+sup.personId+' year='+w!.year)
    expect(runPlayComparison(mk({year:w!.year,firstPersonId:'person-exp-05',secondPersonId:sup.personId})))
      .toMatchObject({ok:false,code:'SUPPORTING_PERSON_NOT_DIRECTLY_INTERACTABLE'})
  },1800000)
},1800000)
