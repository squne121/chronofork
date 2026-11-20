// seed 20260101 の実A0（INTEGRATED_EXPERIMENTAL）から人物履歴・判断記録・喪失記録を作り、
// 「1281年生の未婚・後継者不在」を調べるための記録が実データに存在することを確認する。
// 実100年計算は1回だけ。ゲーム規則・勝敗の保証ではなく、この試験データの記録の確認。
import { describe, expect, it } from 'vitest'
import { runPlayBaseline } from '../../../../src/ui/branch-play-source.ts'
import { buildPersonRecords, buildTitleLossRecords } from '../../../../src/ui/observation/person-record.ts'
import { buildTitleHoldingHistories } from '../../../../src/ui/observation/title-history.ts'
import { personDisplayNames } from '../../../../src/ui/observation/person-display.ts'
import { reasonView } from '../../../../src/ui/observation/reason-labels.ts'

const r = runPlayBaseline(20260101, 'INTEGRATED_EXPERIMENTAL')
if (!r.ok) throw new Error(r.message)
const res = r.a0.result
const histories = buildTitleHoldingHistories(res.snapshots, res.eventLog)
const records = buildPersonRecords(res.snapshots, res.eventLog, res.decisionTraces, histories)
const losses = buildTitleLossRecords(histories, records)
const byId = new Map(records.map(x => [x.personId, x]))
const p1281 = records.find(x => x.birthYear === 1281 && x.fatherId !== undefined && !x.supporting)!
const father = byId.get(p1281.fatherId!)!

describe('seed 20260101 の実A0：1281年生人物の記録', () => {
  it('出生・親子関係から人物を特定でき、婚姻・子の記録はない', () => {
    expect(p1281).toBeDefined()
    expect(father.birthYear).toBe(1251)
    expect(p1281.marriages).toEqual([])
    expect(p1281.childIds).toEqual([])
    expect(p1281.deathYear).toBe(1341)
    expect(p1281.deathEventId).toBeDefined()
  })
  it('婚姻候補は記録されているが、候補は血縁記録または共通祖先条件で採用・交渉されない（信頼不足とは記録されていない）', () => {
    const b4 = p1281.judgments.filter(s => s.ruleId === 'B-004')
    const b5 = p1281.judgments.filter(s => s.ruleId === 'B-005')
    expect(b4.length).toBeGreaterThan(0)
    expect(b4.some(s => s.status === 'DEFER' && s.reasonCodes.includes('KINSHIP_UNREVIEWED') && s.knownKinship === 'SIBLING')).toBe(true)
    expect(b4.some(s => s.status === 'REJECT' || s.reasonCodes.includes('SCORE_BELOW_THRESHOLD'))).toBe(false)
    expect(b5.some(s => s.reasonCodes.includes('COMMON_ANCESTOR_WITHIN_TWO_GENERATIONS'))).toBe(true)
    expect(b5.every(s => s.status === 'DEFER')).toBe(true)
    // 候補の供給（B-001）も試みられたが、供給できる人口候補がないと記録されている（候補なし）。
    expect(p1281.judgments.some(s => s.ruleId === 'B-001' && s.status === 'DEFER' && s.reasonCodes.includes('NO_COHORT_CANDIDATE_AVAILABLE'))).toBe(true)
    // 出生の判断（B-002）は有効婚姻単位のため、この人物を親とする記録はない。
    expect(p1281.judgments.some(s => s.ruleId === 'B-002')).toBe(false)
  })
  it('親（1251年生）は婚姻・出生の記録があり、出生の不成立は親の年齢の範囲外として記録されている', () => {
    expect(father.marriages.length).toBeGreaterThanOrEqual(1)
    expect(father.childIds).toContain(p1281.personId)
    const b2 = father.judgments.filter(s => s.ruleId === 'B-002')
    expect(b2.some(s => s.status === 'ACCEPT')).toBe(true)
    expect(b2.some(s => s.status === 'DEFER' && s.reasonCodes.includes('AGE_OUTSIDE_CALIBRATION_WINDOW'))).toBe(true)
  })
  it('1341年の死亡と称号の喪失は、実履歴から喪失記録として引ける（年・人物は固定しない導出）', () => {
    const mine = losses.filter(l => l.lastHolderId === p1281.personId)
    expect(mine.length).toBeGreaterThan(0)
    for (const l of mine) {
      expect(l.lostFromYear).toBe(1342)
      expect(l.transferYear).toBe(1341)
      expect(l.transferEventId).toBeDefined() // 就任ではなく喪失側の移転（変更前の保持者が本人）
      expect(l.lastHolderDeathYear).toBe(1341)
    }
  })
  it('表示名は「試験人物」に統一され、固定の役割文字列を含まず、全員が区別できる', () => {
    const nameOf = personDisplayNames(records)
    const names = records.map(x => nameOf(x.personId)!)
    expect(names.every(n => n.startsWith('試験人物'))).toBe(true)
    expect(names.some(n => /当主|嫡男|娘|王\b/.test(n))).toBe(false)
    expect(new Set(names).size).toBe(names.length)
  })
  it('実A0に現れる理由コードは辞書化され、未分類は通常表示に出ない', () => {
    const codes = new Set(res.decisionTraces.filter(t => ['B-004', 'B-005', 'B-002', 'A-SUC-04', 'A-TIT-07'].includes(t.ruleId)).flatMap(t => t.reasonCodes))
    const unclassified = [...codes].filter(c => reasonView([c]).unclassified.length > 0)
    expect(unclassified).toEqual([])
  })
})
