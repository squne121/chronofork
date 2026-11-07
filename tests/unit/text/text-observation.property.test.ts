import {describe,expect,it} from 'vitest'
import fc from 'fast-check'
import {runExperimentalTimeline} from '../../../src/ui/timeline-source.ts'
import {debugObservation,playerObservation} from '../../../src/text/game.ts'

describe('テキスト入出力の決定論的プロパティ (fast-check)',()=>{
  it('任意の計算済み年でPLAYERは実Eventの参照を保持し、DEBUGは明示アクセスでのみ提供する',()=>{
    const run=runExperimentalTimeline(1)
    fc.assert(fc.property(fc.integer({min:1250,max:1350}),year=>{
      const player=playerObservation(run,year,'A0')
      const debug=debugObservation(run,year)
      expect(player.ok).toBe(true)
      expect(debug.ok).toBe(true)
      if(!player.ok||!debug.ok)return
      expect(player.channel).toBe('PLAYER')
      expect(debug.channel).toBe('DEBUG')
      const p=player.data as {
        year:number;world:{year:number};
        events:Array<{eventId:string}>;officialGoal:string
      }
      const d=debug.data as {year:number;traces:Array<{year:number}>}
      const ground=run.result.eventLog.filter(e=>e.year===year)
      expect(p.year).toBe(year)
      expect(p.world.year).toBe(year)
      expect(p.events.map(e=>e.eventId)).toEqual(ground.map(e=>e.eventId))
      expect(p.officialGoal).toBe('NOT_ESTABLISHED')
      expect(d.year).toBe(year)
      expect(d.traces.every(t=>t.year===year)).toBe(true)
      expect(player.data).not.toHaveProperty('technicalGoal')
      expect(player.data).not.toHaveProperty('coverage')
    }),{seed:20261107,numRuns:40})
  })
})
