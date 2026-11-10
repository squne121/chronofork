import { describe, expect, it } from 'vitest'
import { acceptProgress, reduceProgress } from '../../../src/ui/play-progress.ts'
import type { PlayProgress } from '../../../src/ui/play-progress.ts'

const p = (branch: 'A0' | 'A1', startYear: number, done: number, events = 0): PlayProgress => ({
  branch, startYear, goalYear: 1350, confirmedYear: startYear + done, transitionsDone: done, transitionsTotal: 1350 - startYear, eventCount: events,
})

describe('進捗DTOの検査', () => {
  it('範囲内・単調増加のみ受理し、逆行・重複・範囲外・不整合を拒否する', () => {
    expect(acceptProgress(undefined, p('A0', 1250, 1))).toBe(true)
    expect(acceptProgress(p('A0', 1250, 5), p('A0', 1250, 6))).toBe(true)
    expect(acceptProgress(p('A0', 1250, 5), p('A0', 1250, 5))).toBe(false)
    expect(acceptProgress(p('A0', 1250, 5), p('A0', 1250, 4))).toBe(false)
    expect(acceptProgress(undefined, { ...p('A0', 1250, 1), transitionsDone: 101, confirmedYear: 1351 })).toBe(false)
    expect(acceptProgress(undefined, { ...p('A1', 1290, 1), confirmedYear: 1295 })).toBe(false)
    expect(acceptProgress(undefined, { ...p('A1', 1290, 1), transitionsTotal: 100 })).toBe(false)
  })
  it('A0とA1を別々に保持し、A1開始年で総対象年数が異なる', () => {
    let s = reduceProgress({}, p('A0', 1250, 100, 30))
    s = reduceProgress(s, p('A1', 1290, 3, 2))
    s = reduceProgress(s, p('A1', 1290, 2)) // 逆行は無視
    expect(s.a0?.transitionsTotal).toBe(100)
    expect(s.a1?.transitionsTotal).toBe(60)
    expect(s.a1?.transitionsDone).toBe(3)
  })
})
