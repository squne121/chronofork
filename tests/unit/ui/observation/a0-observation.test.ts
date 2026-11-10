// @vitest-environment jsdom
// 観測ビューは型付きのsynthetic fixtureのみで単位検証する。実100年成功の証拠ではない。
import { describe,expect,it } from 'vitest'
import type { TimelineRun } from '../../../../src/ui/timeline-source.ts'
import { sliceA0Observation } from '../../../../src/ui/branch-play-source.ts'
import { createWorkerPlayRunner } from '../../../../src/ui/play-runner.ts'
import type { WorkerLike } from '../../../../src/ui/play-runner.ts'

const fakeRun={
  inputs:{seed:20260101},
  result:{status:'COMPLETED',goal:null,technicalGoal:null,
    snapshots:[{year:1250,persons:[]},{year:1251,persons:[]}],
    eventLog:[{eventId:'e',year:1250,eventType:'PERSON_BIRTH'}],
    decisionTraces:[{traceId:'t',year:1250,status:'DEFER',ruleId:'B-005',eventIds:[]}],
  },
} as unknown as TimelineRun

describe('統合原史A0の年次観測',()=>{
  it('実記録から選択年だけを転送し、Event未生成DEFERも見える',()=>{
    const v=sliceA0Observation(fakeRun,1250,'INTEGRATED_EXPERIMENTAL','COMPUTED')
    expect(v?.world.year).toBe(1250)
    expect(v?.events.map(e=>e.eventId)).toEqual(['e'])
    expect(v?.traces.map(t=>t.traceId)).toEqual(['t'])
    expect(v?.traces[0]?.eventIds).toEqual([])
    expect(v?.counts[0]).toEqual({year:1250,events:1,traces:1})
    expect(v?.counts[1]).toEqual({year:1251,events:0,traces:0})
    expect(v?.goal).toBeNull()
    expect(sliceA0Observation(fakeRun,1252,'INTEGRATED_EXPERIMENTAL','REUSED')).toBeUndefined()
  })
  it('観測と比較が同じWorkerを共有し、キャンセル時には破棄する',async()=>{
    class FakeWorker implements WorkerLike {
      onmessage:WorkerLike['onmessage']=null
      onerror:WorkerLike['onerror']=null
      onmessageerror:WorkerLike['onmessageerror']=null
      terminated=false
      postMessage(_m:unknown){}
      terminate(){this.terminated=true}
      emit(data:unknown){this.onmessage?.({data} as MessageEvent<never>)}
    }
    const workers:FakeWorker[]=[]
    const run=createWorkerPlayRunner({createWorker:()=>{const w=new FakeWorker();workers.push(w);return w}})
    const req={seed:20260101,mode:'INTEGRATED_EXPERIMENTAL',year:1250} as const
    const h=run.observe!(req)
    workers[0]!.emit({ok:true,observation:{year:1250},computeMs:10})
    expect((await h.promise).kind).toBe('DONE')
    expect(workers[0]!.terminated).toBe(false)
    const compare=run({seed:20260101,mode:'INTEGRATED_EXPERIMENTAL',year:1250,
      firstPersonId:'a',secondPersonId:'b',signedDelta:20,durationYears:5})
    expect(workers).toHaveLength(1)
    compare.cancel()
    expect((await compare.promise).kind).toBe('CANCELLED')
    expect(workers[0]!.terminated).toBe(true)
    run.reset?.()
  })
})
