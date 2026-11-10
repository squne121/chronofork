// 介入対象の候補（GUI専用の軽量ビュー）。A0の実WorldStateから、人物選択に必要な最小情報だけを取り出す。
// 候補の適格性は branch-play-source の interventionTargetIssue（CLIと共通）を唯一の判定とし、ここで別規則を作らない。
import type { Id, WorldState } from '../simulation/contracts/index.ts'
import { interventionTargetIssue, runPlayBaseline } from './branch-play-source.ts'
import type { PlayMode } from './branch-play-source.ts'

/** 1人分。ranges は A0 のどの年初WorldStateに（直接介入できる人物として）存在したかの [開始年, 終了年] 閉区間。 */
export type PlayCandidate = Readonly<{
  id: Id; name: string; sex: 'MALE' | 'FEMALE'; birthYear: number
  ranges: readonly (readonly [number, number])[]
}>
/** どの seed・モードのA0から得たかを必ず持つ。条件が変わったら使わない。 */
export type PlayCandidateSet = Readonly<{ seed: number; mode: PlayMode; candidates: readonly PlayCandidate[] }>

/** A0の年初snapshot列から候補を作る。SUPPORTINGは interventionTargetIssue で除外される。完全なEventLog等は触らない。 */
export function extractCandidates(seed: number, mode: PlayMode, snapshots: readonly WorldState[]): PlayCandidateSet {
  const acc = new Map<Id, { c: Omit<PlayCandidate, 'ranges'>; ranges: [number, number][] }>()
  for (const w of snapshots) {
    for (const p of w.persons) {
      if (interventionTargetIssue(w, [p.personId, p.personId]) !== null) continue
      let e = acc.get(p.personId)
      if (!e) { e = { c: { id: p.personId, name: p.name, sex: p.sex, birthYear: p.birthYear }, ranges: [] }; acc.set(p.personId, e) }
      const last = e.ranges[e.ranges.length - 1]
      if (last && last[1] === w.year - 1) last[1] = w.year
      else e.ranges.push([w.year, w.year])
    }
  }
  return { seed, mode, candidates: [...acc.values()].map(e => ({ ...e.c, ranges: e.ranges })) }
}

export const isPresentIn = (c: PlayCandidate, year: number): boolean =>
  c.ranges.some(([from, to]) => year >= from && year <= to)

/** 選択中の介入年の年初に存在するKEY人物だけ。 */
export const candidatesAtYear = (set: PlayCandidateSet, year: number): readonly PlayCandidate[] =>
  set.candidates.filter(c => isPresentIn(c, year))

/** 候補が現在の入力条件のものか。違えば表示にも適用にも使わない。 */
export const candidateSetMatches = (set: PlayCandidateSet | undefined, seed: number, mode: PlayMode): set is PlayCandidateSet =>
  set !== undefined && set.seed === seed && set.mode === mode

/** 長いIDでも読めるよう、名前・性別・出生年を見せ、IDは末尾だけを補助表示にする。 */
export const candidateLabel = (c: Pick<PlayCandidate, 'id' | 'name' | 'sex' | 'birthYear'>): string =>
  `${c.name}（${c.sex === 'MALE' ? '男' : '女'}・${c.birthYear}年生・${c.id.length > 12 ? '…' + c.id.slice(-8) : c.id}）`

/** 人物選択用の軽量候補の取得入口（GUIの明示的な取得操作・Worker・同期テスト共通）。A0は runPlayBaseline の共通入口で計算する。 */
export type PlayCandidatesResult =
  | Readonly<{ ok: true; set: PlayCandidateSet }>
  | Readonly<{ ok: false; code: string; message: string }>
export function runPlayCandidates(seed: number, mode: PlayMode): PlayCandidatesResult {
  const b = runPlayBaseline(seed, mode)
  return b.ok ? { ok: true, set: extractCandidates(seed, mode, b.a0.result.snapshots) } : b
}
