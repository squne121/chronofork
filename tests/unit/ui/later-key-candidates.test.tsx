// @vitest-environment jsdom
// Issue #104: GUIの後出生KEY人物の選択。高速な軽量fixtureで、候補の年別変化・A0との一致・入力の受け渡し・無効化を検証する。
// 100年の実計算は later-key-intervention-long.test.ts（オプトイン）と tests/e2e/integrated-mode.spec.ts（オプトイン）で行う。
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import App from '../../../src/ui/App.tsx'
import { interventionTargetIssue } from '../../../src/ui/branch-play-source.ts'
import type { PlayInput } from '../../../src/ui/branch-play-source.ts'
import { candidateLabel, candidateSetMatches, candidatesAtYear, extractCandidates } from '../../../src/ui/play-candidates.ts'
import type { PlayCandidateSet } from '../../../src/ui/play-candidates.ts'
import type { CandidatesOutcome, CandidatesRunner, PlayOutcome, PlayRunner } from '../../../src/ui/play-runner.ts'
import { createExperimentalWorld } from '../../../src/scenario/experimental/index.ts'
import type { Person, WorldState } from '../../../src/simulation/contracts/index.ts'

afterEach(cleanup)

const base = createExperimentalWorld()
const proto = base.persons[0]!
const LATER = 'person-later-with-a-very-long-identifier-0000000000000042'
const mk = (id: string, extra: Partial<Person> = {}): Person => ({ ...proto, personId: id, name: id.slice(0, 6), ...extra })
const later = mk(LATER, { name: 'セラ', birthYear: 1252, sex: 'FEMALE' })
const a1Only = mk('person-a1-only', { name: 'A1だけ', birthYear: 1260 })
const sup = mk('person-sup', { name: '補助', interactionRole: 'SUPPORTING', birthYear: 1255 })
/** 年別のWorldState。後出生KEYは1252年から、SUPPORTINGは1255年から存在する。 */
const worldAt = (year: number, extra: readonly Person[] = []): WorldState => ({
  ...base, year,
  persons: [...base.persons, ...(year >= 1252 ? [later] : []), ...(year >= 1255 ? [sup] : []), ...extra],
})
const a0Snapshots = Array.from({ length: 100 }, (_, i) => worldAt(1250 + i))

describe('候補の抽出と年別の変化（A0の実WorldStateのみ）', () => {
  const set = extractCandidates(20260101, 'INTEGRATED_EXPERIMENTAL', a0Snapshots)
  const ids = (y: number) => candidatesAtYear(set, y).map(c => c.id)
  it('1252年出生の人物は1251年には出ず、1252・1278年には出る', () => {
    expect(ids(1251)).not.toContain(LATER)
    expect(ids(1252)).toContain(LATER)
    expect(ids(1278)).toContain(LATER)
  })
  it('初期人物は全年で出る／SUPPORTINGは候補に出ない／role省略はKEY', () => {
    for (const y of [1250, 1278, 1349]) for (const p of base.persons.filter(x => x.interactionRole !== 'SUPPORTING')) expect(ids(y)).toContain(p.personId)
    expect(set.candidates.some(c => c.id === 'person-sup')).toBe(false)
    expect(proto.interactionRole).toBeUndefined()
    expect(ids(1278)).toContain(proto.personId)
  })
  it('候補は共通判定 interventionTargetIssue と全年で一致する（GUI/CLI同一の入口）', () => {
    for (const w of a0Snapshots) {
      const eligible = new Set(w.persons.filter(p => interventionTargetIssue(w, [p.personId, p.personId]) === null).map(p => p.personId))
      expect(new Set(ids(w.year))).toEqual(eligible)
    }
  })
  it('A1でだけ誕生する人物はA0の候補に混ざらない', () => {
    const a1 = [...a0Snapshots.slice(0, 10), ...a0Snapshots.slice(10).map(w => worldAt(w.year, [a1Only]))]
    expect(extractCandidates(1, 'INTEGRATED_EXPERIMENTAL', a0Snapshots).candidates.some(c => c.id === a1Only.personId)).toBe(false)
    expect(extractCandidates(1, 'INTEGRATED_EXPERIMENTAL', a1).candidates.some(c => c.id === a1Only.personId)).toBe(true) // 取り違えたら混入する
  })
  it('途中で居なくなる年があっても存在区間を取り違えない', () => {
    const gap = [worldAt(1250), { ...worldAt(1251), persons: [...base.persons, later] }, worldAt(1252), worldAt(1253)]
    const s = extractCandidates(1, 'INTEGRATED_EXPERIMENTAL', gap)
    expect(candidatesAtYear(s, 1251).map(c => c.id)).toContain(LATER)
    expect(s.candidates.find(c => c.id === LATER)!.ranges).toEqual([[1251, 1253]])
  })
  it('seed・モードが違う候補は一致扱いにしない', () => {
    expect(candidateSetMatches(set, 20260101, 'INTEGRATED_EXPERIMENTAL')).toBe(true)
    expect(candidateSetMatches(set, 20260102, 'INTEGRATED_EXPERIMENTAL')).toBe(false)
    expect(candidateSetMatches(set, 20260101, 'ORDINARY_LAW')).toBe(false)
    expect(candidateSetMatches(undefined, 1, 'ORDINARY_LAW')).toBe(false)
  })
  it('長いIDでも名前・出生年で読め、IDは末尾だけを補助表示する', () => {
    const l = candidateLabel(set.candidates.find(c => c.id === LATER)!)
    expect(l).toContain('セラ'); expect(l).toContain('1252年生'); expect(l).toContain('女')
    expect(l).not.toContain(LATER); expect(l).toContain(LATER.slice(-8))
  })
})

describe('共通の対象判定の回帰（KEY/SUPPORTING/未登録/未出生）', () => {
  it('同じWorldStateに対してGUI候補と共通判定が同じ結論を出す', () => {
    const w1251 = worldAt(1251), w1278 = worldAt(1278)
    const key = base.persons[0]!.personId
    expect(interventionTargetIssue(w1251, [key, LATER])?.code).toBe('UNKNOWN_PERSON')
    expect(interventionTargetIssue(w1278, [key, LATER])).toBeNull()
    expect(interventionTargetIssue(w1278, [key, 'person-sup'])?.code).toBe('SUPPORTING_PERSON_NOT_DIRECTLY_INTERACTABLE')
    expect(interventionTargetIssue(w1278, [key, 'person-none'])?.code).toBe('UNKNOWN_PERSON')
  })
})

// ---- App: 候補の取得・年別表示・入力の受け渡し・無効化 ----
const SEED = 20260101
const candidateSet = (seed = SEED, mode: PlayCandidateSet['mode'] = 'INTEGRATED_EXPERIMENTAL') => extractCandidates(seed, mode, a0Snapshots)
type CandCall = { seed: number; mode: string; resolve: (o: CandidatesOutcome) => void; cancelled: boolean }
function candRunner() {
  const calls: CandCall[] = []
  const runner: CandidatesRunner = (seed, mode) => {
    let resolve: (o: CandidatesOutcome) => void = () => {}
    const promise = new Promise<CandidatesOutcome>(r => { resolve = r })
    const call: CandCall = { seed, mode, resolve, cancelled: false }
    calls.push(call)
    return { promise, cancel: () => { call.cancelled = true; resolve({ kind: 'CANCELLED' }) } }
  }
  return { runner, calls }
}
function playRunnerSpy() {
  const inputs: PlayInput[] = []
  const runner: PlayRunner = input => { inputs.push(input); return { promise: new Promise<PlayOutcome>(() => {}), cancel: () => {} } }
  return { runner, inputs }
}
const done = (set: PlayCandidateSet): CandidatesOutcome => ({ kind: 'DONE', computeMs: 1, result: { ok: true, set } })
// 選択可能な（disabledでない）候補のみ。無効になった選択中の人物を示すプレースホルダは数えない。
const optionIds = (testId: string) => [...(screen.getByTestId(testId) as HTMLSelectElement).options].filter(o => !o.disabled).map(o => o.value)
const setField = (id: string, v: string) => fireEvent.change(screen.getByTestId(id), { target: { value: v } })
const fetchAndResolve = async (c: ReturnType<typeof candRunner>, set = candidateSet()) => {
  fireEvent.click(screen.getByTestId('candidates-fetch'))
  await act(async () => { c.calls.at(-1)!.resolve(done(set)) })
}
const setup = () => {
  const c = candRunner(), p = playRunnerSpy()
  render(<App playRunner={p.runner} candidatesRunner={c.runner} />)
  setField('play-law-mode', 'INTEGRATED_EXPERIMENTAL')
  return { c, p }
}

describe('App: 後出生人物のGUI選択', () => {
  it('取得前は初期人物のみ。取得操作ではWorkerの候補取得だけが呼ばれ、比較の再計算は始まらない', () => {
    const { c, p } = setup()
    expect(optionIds('branch-person-two')).not.toContain(LATER)
    fireEvent.click(screen.getByTestId('candidates-fetch'))
    expect(c.calls).toHaveLength(1)
    expect(c.calls[0]).toMatchObject({ seed: SEED, mode: 'INTEGRATED_EXPERIMENTAL' })
    expect(p.inputs).toHaveLength(0)
    expect((screen.getByTestId('branch-run') as HTMLButtonElement).disabled).toBe(true) // 取得中は再計算を始められない
  })
  it('年や人物の操作では候補を再取得しない（A0の再計算は明示操作のみ）', async () => {
    const { c } = setup()
    await fetchAndResolve(c)
    setField('branch-fork-year', '1251'); setField('branch-fork-year', '1278'); setField('branch-person-two', LATER)
    expect(c.calls).toHaveLength(1)
  })
  it('1251年には後出生人物が出ず、1278年には選べる。表示は読める名前・出生年', async () => {
    const { c } = setup()
    await fetchAndResolve(c)
    setField('branch-fork-year', '1251')
    expect(optionIds('branch-person-one')).not.toContain(LATER)
    expect(optionIds('branch-person-two')).not.toContain(LATER)
    setField('branch-fork-year', '1278')
    expect(optionIds('branch-person-two')).toContain(LATER)
    const opt = [...(screen.getByTestId('branch-person-two') as HTMLSelectElement).options].find(o => o.value === LATER)!
    expect(opt.textContent).toContain('セラ'); expect(opt.textContent).toContain('1252年生'); expect(opt.textContent).not.toContain(LATER)
    expect(optionIds('branch-person-two')).not.toContain('person-sup')
    expect(optionIds('branch-person-two')).not.toContain('person-a1-only')
  })
  it('GUIで選んだ人物IDが実際の介入入力としてrunnerへ渡る（初期人物×後出生人物）', async () => {
    const { c, p } = setup()
    await fetchAndResolve(c)
    setField('branch-fork-year', '1278'); setField('branch-person-one', 'person-exp-05'); setField('branch-person-two', LATER)
    fireEvent.click(screen.getByTestId('branch-run'))
    expect(p.inputs).toHaveLength(1)
    expect(p.inputs[0]).toMatchObject({ mode: 'INTEGRATED_EXPERIMENTAL', seed: SEED, year: 1278, firstPersonId: 'person-exp-05', secondPersonId: LATER })
  })
  it('選択中の人物が介入年に存在しなくなったら黙って別人にせず、再計算を拒否する', async () => {
    const { c, p } = setup()
    await fetchAndResolve(c)
    setField('branch-fork-year', '1278'); setField('branch-person-two', LATER)
    setField('branch-fork-year', '1251')
    expect(screen.getByTestId('branch-person-invalid')).toBeTruthy()
    expect(optionIds('branch-person-two')).not.toContain(LATER)
    const stale = [...(screen.getByTestId('branch-person-two') as HTMLSelectElement).options].find(o => o.value === LATER)!
    expect(stale.disabled).toBe(true); expect(stale.textContent).toContain('存在しません')
    expect((screen.getByTestId('branch-run') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.submit(screen.getByTestId('branch-run').closest('form')!)
    expect(p.inputs).toHaveLength(0)
  })
  it('同一人物ペアは拒否される', async () => {
    const { c, p } = setup()
    await fetchAndResolve(c)
    setField('branch-fork-year', '1278'); setField('branch-person-one', LATER); setField('branch-person-two', LATER)
    expect((screen.getByTestId('branch-run') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.submit(screen.getByTestId('branch-run').closest('form')!)
    expect(p.inputs).toHaveLength(0)
  })
  it('seedが変わったら古い候補を表示も適用もしない', async () => {
    const { c, p } = setup()
    await fetchAndResolve(c)
    setField('branch-fork-year', '1278'); setField('branch-person-two', LATER)
    fireEvent.change(screen.getByLabelText(/seed/), { target: { value: '7' } })
    expect(optionIds('branch-person-two')).not.toContain(LATER)
    expect(screen.getByTestId('candidate-status').textContent).toContain('初期人物のみ')
    expect((screen.getByTestId('branch-run') as HTMLButtonElement).disabled).toBe(true)
    expect(p.inputs).toHaveLength(0)
  })
  it('モードが変わったら古い候補を表示も適用もしない', async () => {
    const { c } = setup()
    await fetchAndResolve(c)
    setField('branch-fork-year', '1278')
    expect(optionIds('branch-person-two')).toContain(LATER)
    setField('play-law-mode', 'ORDINARY_LAW')
    setField('branch-fork-year', '1278')
    expect(optionIds('branch-person-two')).not.toContain(LATER)
  })
  it('取得キャンセル後に古い結果が届いても反映されない／取得失敗は候補を作らず表示される', async () => {
    const { c } = setup()
    fireEvent.click(screen.getByTestId('candidates-fetch'))
    const first = c.calls[0]!
    fireEvent.click(screen.getByTestId('candidates-cancel'))
    expect(first.cancelled).toBe(true)
    await act(async () => { first.resolve(done(candidateSet())) }) // 取り消し後に遅れて届いた結果
    setField('branch-fork-year', '1278')
    expect(optionIds('branch-person-two')).not.toContain(LATER)
    fireEvent.click(screen.getByTestId('candidates-fetch'))
    await act(async () => { c.calls[1]!.resolve({ kind: 'DONE', computeMs: 1, result: { ok: false, code: 'A0_HALTED', message: 'x' } }) })
    expect(screen.getByTestId('candidate-error').textContent).toContain('A0_HALTED')
    expect(optionIds('branch-person-two')).not.toContain(LATER)
  })
  it('Worker起動失敗は候補取得エラーとして表示され、成功扱いにならない', async () => {
    const { c } = setup()
    fireEvent.click(screen.getByTestId('candidates-fetch'))
    await act(async () => { c.calls[0]!.resolve({ kind: 'FAILED', code: 'WORKER_UNAVAILABLE', message: 'no worker' }) })
    expect(screen.getByTestId('candidate-error').textContent).toContain('WORKER_UNAVAILABLE')
  })
})

describe('旧2モードの回帰', () => {
  it('取得前の旧モードは従来どおり初期人物の選択肢と既定ペアを持つ', () => {
    render(<App playRunner={playRunnerSpy().runner} candidatesRunner={candRunner().runner} />)
    expect(optionIds('branch-person-one')).toEqual(base.persons.filter(p => p.interactionRole !== 'SUPPORTING').map(p => p.personId))
    expect((screen.getByTestId('branch-person-one') as HTMLSelectElement).value).toBe('person-exp-04')
    expect((screen.getByTestId('branch-person-two') as HTMLSelectElement).value).toBe('person-exp-05')
  })
})
