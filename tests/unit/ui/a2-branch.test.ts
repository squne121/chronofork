// 承認済み同年・別ペアの複数介入。A1の年初WorldStateからA2を実forkし、旧枝を保持する。
import {describe,it,expect} from 'vitest'
import {isDeepStrictEqual} from 'node:util'
import {runPlayComparison,compareYear} from '../../../src/ui/branch-play-source.ts'
import type {PlayInput} from '../../../src/ui/branch-play-source.ts'
import {toDisplayView} from '../../../src/ui/play-view.ts'

const first:PlayInput={
  mode:'FIXED_APPROVAL',seed:20260101,year:1260,
  firstPersonId:'person-exp-04',secondPersonId:'person-exp-05',signedDelta:20,durationYears:5,
}
const second={firstPersonId:'person-exp-02',secondPersonId:'person-exp-05',signedDelta:-30,durationYears:8}

describe('A0→A1→A2（同年別ペア）',()=>{
  it('不正な第2介入を重い計算前に拒否する',()=>{
    const code=(x:PlayInput['second'])=>{
      const r=runPlayComparison({...first,second:x})
      return r.ok?'OK':r.code
    }
    expect(code({...second,firstPersonId:'person-exp-05',secondPersonId:'person-exp-04'})).toBe('DUPLICATE_INTERVENTION')
    expect(code({...second,signedDelta:0})).toBe('INVALID_DELTA')
    expect(code({...second,durationYears:91})).toBe('INVALID_DURATION')
    expect(code({...second,firstPersonId:'person-exp-05',secondPersonId:'person-exp-05'})).toBe('INVALID_PERSON_PAIR')
  })

  it('A1が親でA2がforkされ、異なる2件のmodifierが保持される（元の履歴・Goalは改変しない）',()=>{
    const result=runPlayComparison({...first,second})
    expect(result.ok).toBe(true)
    if(!result.ok)return
    const c=result.comparison
    expect(c.root.lineage).toEqual(['A0-play'])
    expect(c.branch.lineage).toEqual(['A0-play','A1-play'])
    const s=c.second
    expect(s).toBeDefined()
    expect(s!.branch.lineage).toEqual(['A0-play','A1-play','A2-play'])
    expect(s!.branch.parentBranchId).toBe('A1-play')
    expect(s!.branch.forkYear).toBe(first.year)
    expect(s!.branch.ledger).toHaveLength(2)
    expect(s!.branch.ledger[0]).toEqual(c.modifier)
    expect(s!.branch.ledger[1]).toEqual(s!.modifier)
    expect(s!.branch.ledger.map(x=>x.targetRef)).toHaveLength(2)
    expect(c.branch.ledger).toHaveLength(1)
    expect(c.root.ledger).toHaveLength(0)
    expect(s!.a0.result).toEqual(c.a1.result)
    expect(s!.second).toBeUndefined() // A3を暗黙作成しない
    expect(s!.a0.result.goal).toBeNull()
    expect(s!.a1.result.goal).toBeNull()
    const cut=first.year-c.root.startYear
    expect(isDeepStrictEqual(s!.branch.snapshots.slice(0,cut+1),c.branch.snapshots.slice(0,cut+1))).toBe(true)
    expect(isDeepStrictEqual(s!.branch.eventLog.filter(x=>x.year<first.year),c.branch.eventLog.filter(x=>x.year<first.year))).toBe(true)
    expect(c.branch.status).toBe('COMPLETED')
    expect(s!.branch.status).toBe('COMPLETED')
    const display=toDisplayView(c)
    expect(display.second).toBeDefined()
    expect(display.second!.a0.result.goal).toBeNull()
    expect(display.second!.a1.result.goal).toBeNull()
    expect(display.second!.a1.inputs.scenarioId).toContain('A2-play')
    expect('root' in display.second!).toBe(false)
    expect('branch' in display.second!).toBe(false)
    const delta=compareYear(display.second!,1260)
    expect(delta.a0World?.year).toBe(1260)
    expect(delta.a1World?.year).toBe(1260)
  },30000)

  it('同じ2件を繰り返してA2のWorldState・EventLog・Trace・Goalが決定的に一致',()=>{
    const a=runPlayComparison({...first,second}),b=runPlayComparison({...first,second})
    expect(a.ok&&b.ok).toBe(true)
    if(!a.ok||!b.ok)return
    expect(a.comparison.second?.a1.result.snapshots).toEqual(b.comparison.second?.a1.result.snapshots)
    expect(a.comparison.second?.a1.result.eventLog).toEqual(b.comparison.second?.a1.result.eventLog)
    expect(a.comparison.second?.a1.result.decisionTraces).toEqual(b.comparison.second?.a1.result.decisionTraces)
    expect(a.comparison.second?.a1.result.technicalGoal).toEqual(b.comparison.second?.a1.result.technicalGoal)
  },30000)
})
