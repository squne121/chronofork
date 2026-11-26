// Issue #71: 年次診断は実年初WorldStateと当年のEvent/Traceに一致し、勝利を補完しない。
import {describe,expect,it} from 'vitest'
import {createExperimentalWorld,NALVEN_DYNASTY_ID} from '../../../src/scenario/experimental/index.ts'
import {runTimeline} from '../../../src/simulation/engine/index.ts'
import {createCalibrationEvaluators} from '../../../src/simulation/rules/c/index.ts'
import {EXPERIMENTAL_TUNING} from '../../../src/simulation/tuning.ts'
import {auditYearlyHistory} from './issue71-yearly-diagnostics.ts'

describe('Issue #71: 年初101点と年内Event/Traceの突合（CALIBRATION_ONLY）',()=>{
  it('人口のみの最小実再計算で、存在しない婚姻・出生・Goalを記録しない',()=>{
    const w=createExperimentalWorld()
    const r=runTimeline(w,{seed:1,evaluators:createCalibrationEvaluators(EXPERIMENTAL_TUNING)})
    expect(r.status).toBe('COMPLETED')
    const a=auditYearlyHistory(r,NALVEN_DYNASTY_ID)
    expect(a.rows).toHaveLength(101)
    expect(a.rows[0]?.year).toBe(1250)
    expect(a.rows.at(-1)?.year).toBe(1350)
    expect(a.rows.at(-1)?.eventCount).toBe(0)
    expect(a.rows.at(-1)?.traceCount).toBe(0)
    expect(a.summary.marriages).toBe(0)
    expect(a.summary.births).toBe(0)
    expect(a.summary.finalTitleUndetermined).toBe(
      r.snapshots.at(-1)!.titles.filter(t=>t.kind==='TERRITORIAL'&&t.holder.status==='UNDETERMINED').length)
    expect(a.goal?.status).toBe('NOT_ACHIEVED')
    expect(r.goal).toBeNull()
    expect(a.summary.technicalGoal).toBe('NOT_ACHIEVED')
    expect(a.rows.every(row=>row.eventCount===
      r.eventLog.filter(e=>e.year===row.year).length)).toBe(true)
  },30000)
})
