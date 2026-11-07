import {describe,expect,it} from 'vitest'
import {createExperimentalWorld} from '../../../src/scenario/experimental/index.ts'
import {runExperimentalTimeline} from '../../../src/ui/timeline-source.ts'
import {
  debugObservation,playerObservation,summarizeWorld,TextGameSession,textReport,
} from '../../../src/text/game.ts'

describe('プレイヤー用テキストI/Oと明示的デバッグの境界',()=>{
  it('WorldStateの実値だけを要約し、未来やGoalを捏造しない',()=>{
    const world=createExperimentalWorld()
    const view=summarizeWorld(world)
    expect(view.year).toBe(world.year)
    expect(view.groups).toHaveLength(world.groups.length)
    expect(view.groups.reduce((s,g)=>s+g.population,0))
      .toBe(world.groups.reduce((s,g)=>s+g.population,0))
    expect(view.titles.map(t=>t.id)).toEqual(world.titles.map(t=>t.titleId))
    expect(JSON.stringify(view)).not.toContain('technicalGoal')
    expect(JSON.stringify(view)).not.toContain('cohortSlots')
    expect(JSON.stringify(view)).not.toContain('random')
  })

  it('PLAYER出力は実Eventに参照し、DecisionTraceの内部入力を混入しない',()=>{
    const run=runExperimentalTimeline(1)
    const row=playerObservation(run,1250,'A0')
    expect(row.ok).toBe(true)
    if(!row.ok)return
    expect(row.channel).toBe('PLAYER')
    const data=row.data as Record<string,unknown>
    expect(data.officialGoal).toBe('NOT_ESTABLISHED')
    expect(data.provenance).toBe('EXPERIMENTAL / CALIBRATION_ONLY')
    expect(data).not.toHaveProperty('technicalGoal')
    expect(data).not.toHaveProperty('traces')
    expect(data).not.toHaveProperty('coverage')
    const events=data.events as Array<{eventId:string}>
    expect(events).toEqual(run.result.eventLog.filter(e=>e.year===1250).map(e=>({
      eventId:e.eventId,eventType:e.eventType,year:e.year,
      involvedRefs:e.involvedRefs,sourceTraceIds:e.sourceTraceIds,
    })))
  })

  it('DEBUGは明示呼び出し時だけ年度とRuleIDで抽出する',()=>{
    const run=runExperimentalTimeline(1)
    const row=debugObservation(run,1250,'RULE-C-004')
    expect(row.ok).toBe(true)
    if(!row.ok)return
    expect(row.channel).toBe('DEBUG')
    const data=row.data as Record<string,unknown>
    expect(data).toHaveProperty('coverage')
    expect(data).toHaveProperty('technicalGoal')
    expect((data.traces as Array<{year:number;ruleId:string}>)
      .every(t=>t.year===1250&&t.ruleId==='RULE-C-004')).toBe(true)
    const invalid=playerObservation(run,1351,'A0')
    expect(invalid).toMatchObject({ok:false,code:'YEAR_UNAVAILABLE'})
    expect(textReport(invalid)).toContain('YEAR_UNAVAILABLE')
  })

  it('A1を作る前にA1の世界や比較結果を成功扱いしない',()=>{
    const session=new TextGameSession(1,'FIXED_APPROVAL')
    expect(session.observe(1250,'A1')).toMatchObject({ok:false,code:'NO_BRANCH'})
    expect(session.compare(1350)).toMatchObject({ok:false,code:'NO_BRANCH'})
  })
})
