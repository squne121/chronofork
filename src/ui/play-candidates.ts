// 介入対象の候補（GUI専用の軽量ビュー）。A0の実WorldStateから、人物選択に必要な最小情報だけを取り出す。
// 候補の適格性は branch-play-source の interventionTargetIssue（CLIと共通）を唯一の判定とし、ここで別規則を作らない。
import type { Id, WorldState } from '../simulation/contracts/index.ts'
import { interventionTargetIssue, playConfigDigest, playConfigId, runPlayBaseline } from './branch-play-source.ts'
import { denseArray, hasDemandTrust, isCompleteLimitedA0, LIMITED_PLAYTEST_SEED, limitedPlayConfig } from './desk/data/limited-config.ts'
import type { PlayConfiguration } from './desk/data/limited-config.ts'
import type { TimelineRun } from './timeline-source.ts'
import type { PlayMode } from './branch-play-source.ts'
import { baseDisplayName, personIdTag } from './observation/person-display.ts'
export { personIdTag } from './observation/person-display.ts'

/** 1人分。ranges は A0 のどの年初WorldStateに（直接介入できる人物として）存在したかの [開始年, 終了年] 閉区間。 */
export type PlayCandidate = Readonly<{
  id: Id; name: string; sex: 'MALE' | 'FEMALE'; birthYear: number
  ranges: readonly (readonly [number, number])[]
}>
/** どの seed・モードのA0から得たかを必ず持つ。条件が変わったら使わない。 */
export type PlayCandidateSet = Readonly<{ seed: number; mode: PlayMode; configDigest?: string; configIdentity?: string; configId?: string; configuration?: PlayConfiguration; candidates: readonly PlayCandidate[] }>

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
  return { seed, mode, configDigest: playConfigDigest(mode), candidates: [...acc.values()].map(e => ({ ...e.c, ranges: e.ranges })) }
}

/** 限定試遊の来歴は snapshot に後付けせず、検証した実 A0 の封筒から取得する。 */
export function extractCandidatesFromA0(a0: TimelineRun, mode: PlayMode, configuration?: PlayConfiguration): PlayCandidateSet | undefined {
  if (configuration === 'LIMITED_PLAYTEST') {
    if (mode !== 'MULTI_HOUSE_EXPERIMENTAL' || !isCompleteLimitedA0(a0)) return undefined
    return { ...extractCandidates(a0.inputs.seed, mode, a0.result.snapshots), configuration, ...limitedPlayConfig() }
  }
  if (a0.inputs.configIdentity !== undefined || a0.result.snapshots.some(hasDemandTrust)) return undefined
  return extractCandidates(a0.inputs.seed, mode, a0.result.snapshots)
}

export const isPresentIn = (c: PlayCandidate, year: number): boolean =>
  c.ranges.some(([from, to]) => year >= from && year <= to)

/** 選択中の介入年の年初に存在するKEY人物だけ。 */
export const candidatesAtYear = (set: PlayCandidateSet, year: number): readonly PlayCandidate[] =>
  set.candidates.filter(c => isPresentIn(c, year))

/** 候補が現在の入力条件のものか。違えば表示にも適用にも使わない。 */
export const candidateSetMatches = (set: PlayCandidateSet | undefined, seed: number, mode: PlayMode, configuration?: PlayConfiguration): set is PlayCandidateSet =>
  set !== undefined && set.seed === seed && set.mode === mode && set.configuration === configuration
  && set.configDigest === playConfigDigest(mode, configuration)
  && set.configIdentity === (configuration === 'LIMITED_PLAYTEST' ? limitedPlayConfig().configIdentity : undefined)
  && (configuration !== 'LIMITED_PLAYTEST' || (mode === 'MULTI_HOUSE_EXPERIMENTAL' && seed === LIMITED_PLAYTEST_SEED
    && set.configId === playConfigId(mode, configuration)
    && denseArray(set.candidates, c => typeof c.id === 'string' && denseArray(c.ranges, range =>
      Number.isInteger(range[0]) && Number.isInteger(range[1]) && range[0] <= range[1]))))

/** 候補には識別子を添え、同年生まれの別人も選択できるようにする。 */
export const candidateLabel = (c: Pick<PlayCandidate, 'id' | 'name' | 'sex' | 'birthYear'>): string =>
  `${baseDisplayName({personId:c.id,name:c.name,sex:c.sex,birthYear:c.birthYear})}・識別${personIdTag(c.id)}（${c.sex === 'MALE' ? '男' : '女'}・${c.birthYear}年生）`

/** 人物選択用の軽量候補の取得入口（GUIの明示的な取得操作・Worker・同期テスト共通）。A0は runPlayBaseline の共通入口で計算する。 */
export type PlayCandidatesResult =
  | Readonly<{ ok: true; set: PlayCandidateSet }>
  | Readonly<{ ok: false; code: string; message: string }>
export function runPlayCandidates(seed: number, mode: PlayMode, configuration?: PlayConfiguration): PlayCandidatesResult {
  const b = runPlayBaseline(seed, mode, configuration)
  if (!b.ok) return b
  const set = extractCandidatesFromA0(b.a0, mode, configuration)
  return set ? { ok: true, set } : { ok: false, code: 'HISTORY_MISMATCH', message: '候補の原史の来歴が一致しません' }
}
