// @vitest-environment jsdom
// 統合法制・世代継続(experimental)モードの軽量回帰。100年の実計算は integrated-mode-long.test.ts(オプトイン)で行う。
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import App from '../../../src/ui/App.tsx'
import { INTEGRATED_PLAY_DEFAULTS, playModeLabel, runPlayComparison } from '../../../src/ui/branch-play-source.ts'
import type { PlayComparison, PlayInput, PlayView } from '../../../src/ui/branch-play-source.ts'
import { buildOverview, titleRows } from '../../../src/ui/integrated-overview.ts'
import type { PlayOutcome, PlayRunner } from '../../../src/ui/play-runner.ts'
import { IntegratedOverview } from '../../../src/ui/IntegratedOverview.tsx'
import { toDisplayView } from '../../../src/ui/play-view.ts'
import { INTEGRATED_PAIR, INTEGRATED_SEED, INTEGRATED_TRUST_REDUCTION } from '../../../src/scenario/experimental/index.ts'
import type { DecisionTrace, EventLogEntry } from '../../../src/simulation/contracts/index.ts'

afterEach(cleanup)

describe('統合モードの初期入力例(CALIBRATION_ONLY)', () => {
  it('PR #78 の実測条件と一致し、強制イベントではなく入力欄の初期値としてだけ扱う', () => {
    expect(INTEGRATED_PLAY_DEFAULTS).toMatchObject({
      seed: 20260101, year: 1250, pair: ['person-exp-02', 'person-exp-05'], signedDelta: -20, durationYears: 5,
    })
    expect(INTEGRATED_PLAY_DEFAULTS.seed).toBe(INTEGRATED_SEED)
    expect(INTEGRATED_PLAY_DEFAULTS.pair).toEqual(INTEGRATED_PAIR)
    expect(INTEGRATED_PLAY_DEFAULTS.signedDelta).toBe(INTEGRATED_TRUST_REDUCTION.signedDelta)
    expect(playModeLabel('INTEGRATED_EXPERIMENTAL')).toBe('統合法制・世代継続（experimental）')
  })
  it('不正入力は計算を始める前に拒否する(統合モードでも検証は共通)', () => {
    const base: PlayInput = { mode: 'INTEGRATED_EXPERIMENTAL', seed: 1, year: 1250, firstPersonId: 'person-exp-02', secondPersonId: 'person-exp-05', signedDelta: -20, durationYears: 5 }
    const code = (x: Partial<PlayInput>) => { const r = runPlayComparison({ ...base, ...x }); return r.ok ? 'OK' : r.code }
    expect(code({ seed: -1 })).toBe('INVALID_SEED')
    expect(code({ year: 1350 })).toBe('INVALID_YEAR')
    expect(code({ signedDelta: 0 })).toBe('INVALID_DELTA')
    expect(code({ durationYears: 101 })).toBe('INVALID_DURATION')
    expect(code({ secondPersonId: 'person-exp-02' })).toBe('INVALID_PERSON_PAIR')
    expect(code({ firstPersonId: 'person-none' })).toBe('UNKNOWN_PERSON')
  })
})

// ---- 転送ビュー(toDisplayView)の無損失条件: 合成データで境界を確認 ----
const ev = (id: string, type: string, traces: string[], extra = ''): EventLogEntry => ({
  eventId: id, eventType: type, year: 1250, semanticEventKey: id, involvedRefs: [], sourceTraceIds: traces,
  stateChanges: [{ path: '$.x' + extra, before: 1, after: 2 }],
} as unknown as EventLogEntry)
const tr = (id: string, rule: string, events: string[], mods: string[] = []): DecisionTrace => ({
  traceId: id, year: 1250, phase: 'B', ruleId: rule, actorRef: { kind: 'PERSON', id: 'p' }, status: 'ACCEPT',
  candidates: [], eventIds: events, modifierIds: mods, reasonCodes: [],
} as unknown as DecisionTrace)
const run = (events: EventLogEntry[], traces: DecisionTrace[]) => ({
  inputs: {}, initialWorld: { year: 1250 },
  result: { status: 'COMPLETED', eventLog: events, decisionTraces: traces, snapshots: [{ year: 1250 }, { year: 1350 }], coverage: { todoRuleIds: [] }, technicalGoal: null },
}) as unknown as PlayComparison['a0']
const synthetic = (a0: [EventLogEntry[], DecisionTrace[]], a1: [EventLogEntry[], DecisionTrace[]]) =>
  ({ mode: 'INTEGRATED_EXPERIMENTAL', input: {}, modifier: { modifierId: 'm' }, root: {}, branch: {}, a0: run(...a0), a1: run(...a1) }) as unknown as PlayComparison

describe('toDisplayView: 完全に同一で相互参照が閉じた信頼更新だけを省略する', () => {
  const same = (): [EventLogEntry[], DecisionTrace[]] => [
    [ev('e-trust', 'PERSON_PAIR_TRUST_SET', ['t-b009']), ev('e-birth', 'PERSON_BIRTH', ['t-b002'])],
    [tr('t-b009', 'B-009', ['e-trust']), tr('t-b002', 'B-002', ['e-birth']), tr('t-b004', 'B-004', [])],
  ]
  it('同一なら省略し、件数を保持し、他の種別は残す', () => {
    const view = toDisplayView(synthetic(same(), same()))
    expect(view.a0.result.eventLog.map(e => e.eventId)).toEqual(['e-birth'])
    expect(view.a0.result.decisionTraces.map(t => t.traceId)).toEqual(['t-b002', 't-b004'])
    expect(view.displayOmission).toMatchObject({
      fullEventCount: { a0: 2, a1: 2 }, fullTraceCount: { a0: 3, a1: 3 },
      omittedEventsByType: { PERSON_PAIR_TRUST_SET: 1 }, omittedTracesByRule: { 'B-009': 1 },
    })
    // A1の同一内容はA0と同じオブジェクトとして共有される(転送時に一度だけ複製)。
    expect(view.a1.result.eventLog[0]).toBe(view.a0.result.eventLog[0])
  })
  it('A1で内容が違う信頼更新は省略しない(介入の効果を隠さない)', () => {
    const a1 = same(); a1[0][0] = ev('e-trust', 'PERSON_PAIR_TRUST_SET', ['t-b009'], 'changed')
    const view = toDisplayView(synthetic(same(), a1))
    expect(view.a0.result.eventLog.map(e => e.eventId)).toContain('e-trust')
    expect(view.a1.result.eventLog.map(e => e.eventId)).toContain('e-trust')
    expect(view.a0.result.decisionTraces.map(t => t.traceId)).toContain('t-b009')
    expect(view.displayOmission?.omittedEventsByType).toEqual({})
  })
  it('Traceが介入で変わるなら、そのTraceと参照Eventを残して相互参照を保つ', () => {
    const a1 = same(); a1[1][0] = tr('t-b009', 'B-009', ['e-trust'], ['m'])
    const view = toDisplayView(synthetic(same(), a1))
    for (const side of [view.a0, view.a1]) {
      const eIds = new Set(side.result.eventLog.map(e => e.eventId)), tIds = new Set(side.result.decisionTraces.map(t => t.traceId))
      expect(side.result.decisionTraces.every(t => t.eventIds.every(i => eIds.has(i)))).toBe(true)
      expect(side.result.eventLog.every(e => e.sourceTraceIds.every(i => tIds.has(i)))).toBe(true)
    }
    expect(view.a1.result.decisionTraces.find(t => t.traceId === 't-b009')?.modifierIds).toEqual(['m'])
  })
  it('A1にだけ存在するEventが省略対象Traceを参照するなら、そのTraceは残す(参照を切らない)', () => {
    const a1 = same(); a1[0].push(ev('e-new', 'MARRIAGE_REGISTER', ['t-b009']))
    const view = toDisplayView(synthetic(same(), a1))
    const tIds = new Set(view.a1.result.decisionTraces.map(t => t.traceId))
    expect(view.a1.result.eventLog.every(e => e.sourceTraceIds.every(i => tIds.has(i)))).toBe(true)
  })
  it('構造化複製でき、完全版のroot/branchを含まない', () => {
    const view = toDisplayView(synthetic(same(), same()))
    expect(Object.keys(view)).not.toContain('root')
    expect(() => structuredClone(view)).not.toThrow()
  })
})

describe('buildOverview: 差が無いときは差が確認されないと判定できる', () => {
  it('A0とA1のEventが同一で最終WorldStateも同一なら差分0', () => {
    const e: [EventLogEntry[], DecisionTrace[]] = [[ev('e1', 'PERSON_BIRTH', [])], []]
    const o = buildOverview(synthetic(e, [[...e[0]], []]))
    expect(o.totalDifferences).toBe(0)
    expect(o.finalWorldIdentical).toBe(true)
  })
  it('最終WorldStateを比較できないときは差ありと断定しない', () => {
    const v = synthetic([[], []], [[], []]) as unknown as { a1: { result: { snapshots: unknown[] } } }
    v.a1.result.snapshots = []
    expect(buildOverview(v as unknown as PlayView).finalWorldIdentical).toBeNull()
  })
  it('A1にだけあるEventは差分として数える', () => {
    const o = buildOverview(synthetic([[], []], [[ev('e9', 'MARRIAGE_REGISTER', [])], []]))
    expect(o.totalDifferences).toBe(1)
    expect(o.rows.find(r => r.category.key === 'marriage')?.a1Only).toHaveLength(1)
  })
})

describe('表示文言: 保持者未確定・統治委任・省略の説明', () => {
  const world = (holder: unknown, cases: unknown[], mandates: unknown[]) => ({
    year: 1350, persons: [], groups: [], regions: [{ regionId: 'r1', name: '北部' }],
    titles: [{ titleId: 't1', kind: 'TERRITORIAL', regionId: 'r1', holder }],
    legal: { dynasties: [], cases, controlMandates: mandates },
  }) as never
  it('保持者未確定は相続PENDINGと書かず、PENDING件数は記録から別に数える', () => {
    const [none] = titleRows(world({ status: 'UNDETERMINED' }, [], []))
    expect(none.holder).toBe('保持者未確定')
    expect(none.holderUndetermined).toBe(true)
    expect(none.pendingCases).toBe(0)
    const [pend] = titleRows(world({ status: 'UNDETERMINED' }, [{ titleId: 't1', kind: 'SUCCESSION', status: 'PENDING' }], []))
    expect(pend.pendingCases).toBe(1)
    expect(pend.holder).not.toContain('相続PENDING')
  })
  it('統治委任は期間条件の件数で、法的有効性とは別と明示する', () => {
    const [r] = titleRows(world({ status: 'UNDETERMINED' }, [], [
      { regionId: 'r1', effectiveFromYear: 1300, endExclusiveYear: 1400 },
      { regionId: 'r1', effectiveFromYear: 1200, endExclusiveYear: 1300 },
    ]))
    expect(r.mandatesInPeriod).toBe(1)
  })
  it('画面に省略の全件数・対象・復元不可・限定処置を表示する', () => {
    const base = synthetic([[], []], [[], []])
    const fw = { year: 1350, persons: [], groups: [], regions: [], titles: [], legal: { dynasties: [], cases: [], controlMandates: [] } }
    const side = (r: PlayComparison['a0']) => ({ ...r, initialWorld: { year: 1250, persons: [] }, result: { ...r.result, snapshots: [fw] } })
    const v = {
      ...base, a0: side(base.a0), a1: side(base.a1),
      displayOmission: { fullEventCount: { a0: 50, a1: 51 }, fullTraceCount: { a0: 40, a1: 41 },
        omittedEventsByType: { PERSON_PAIR_TRUST_SET: 30 }, omittedTracesByRule: { 'B-009': 30 } },
    } as unknown as PlayView
    render(<IntegratedOverview view={v} personLabel={id => id} onInspectEvent={() => {}} onInspectTrace={() => {}} />)
    const t = screen.getByTestId('integrated-omission').textContent ?? ''
    for (const w of ['Event A0 50件', 'A1 41件', 'PERSON_PAIR_TRUST_SET 30件', 'B-009のTrace 30件', '完全に同一', '差のある記録は全て残', '後から閲覧できません', 'experimental試遊限定']) expect(t).toContain(w)
    expect(screen.getByTestId('integrated-final-titles').textContent).toContain('法的有効性とは別')
    expect(document.body.textContent).toContain('保持者未確定」は保持者が決まっていない状態そのもの')
    expect(document.body.textContent).not.toContain('無損失')
  })
})

// ---- App: 実行状態の管理(Workerの代わりに制御可能なrunnerを注入) ----
type Call = { input: PlayInput; resolve: (o: PlayOutcome) => void }
function controlledRunner() {
  const calls: Call[] = []
  const runner: PlayRunner = input => {
    let resolve: (o: PlayOutcome) => void = () => {}
    const promise = new Promise<PlayOutcome>(r => { resolve = r })
    calls.push({ input, resolve })
    return { promise, cancel: () => resolve({ kind: 'CANCELLED' }) }
  }
  return { runner, calls }
}
const selectIntegrated = () => fireEvent.change(screen.getByTestId('play-law-mode'), { target: { value: 'INTEGRATED_EXPERIMENTAL' } })
const field = (id: string) => (screen.getByTestId(id) as HTMLInputElement | HTMLSelectElement).value

describe('App: 統合モードの選択・実行・キャンセル', () => {
  it('モード選択で実測条件が初期入力例として入り、旧2モードは残る', () => {
    render(<App playRunner={controlledRunner().runner} />)
    const options = [...(screen.getByTestId('play-law-mode') as HTMLSelectElement).options].map(o => o.value)
    expect(options).toEqual(['FIXED_APPROVAL', 'ORDINARY_LAW', 'INTEGRATED_EXPERIMENTAL'])
    selectIntegrated()
    expect(field('branch-fork-year')).toBe('1250')
    expect(field('branch-trust-delta')).toBe('-20')
    expect(field('branch-duration')).toBe('5')
    expect(field('branch-person-one')).toBe('person-exp-02')
    expect(field('branch-person-two')).toBe('person-exp-05')
    expect((screen.getByLabelText(/seed/) as HTMLInputElement).value).toBe('20260101')
    // 入力は変更できる(初期例は強制ではない)。
    fireEvent.change(screen.getByTestId('branch-trust-delta'), { target: { value: '-35' } })
    expect(field('branch-trust-delta')).toBe('-35')
  })
  it('変更した入力値がそのままrunnerへ渡る', () => {
    const { runner, calls } = controlledRunner()
    render(<App playRunner={runner} />)
    selectIntegrated()
    fireEvent.change(screen.getByTestId('branch-trust-delta'), { target: { value: '-35' } })
    fireEvent.change(screen.getByTestId('branch-fork-year'), { target: { value: '1260' } })
    fireEvent.change(screen.getByTestId('branch-duration'), { target: { value: '7' } })
    fireEvent.click(screen.getByTestId('branch-run'))
    expect(calls).toHaveLength(1)
    expect(calls[0]!.input).toMatchObject({ mode: 'INTEGRATED_EXPERIMENTAL', seed: 20260101, year: 1260, signedDelta: -35, durationYears: 7,
      firstPersonId: 'person-exp-02', secondPersonId: 'person-exp-05' })
  })
  it('計算中は明示表示し、二重起動できず、進捗率・残り時間は出さない', () => {
    const { runner, calls } = controlledRunner()
    render(<App playRunner={runner} />)
    selectIntegrated()
    fireEvent.click(screen.getByTestId('branch-run'))
    expect(screen.getByTestId('branch-running').textContent).toContain('計算中')
    expect(screen.getByTestId('branch-running').textContent).not.toMatch(/\d+%|残り\d/)
    expect((screen.getByTestId('branch-run') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByTestId('branch-run'))
    expect(calls).toHaveLength(1)
    // 計算中も他の操作(年スライダー)は可能。
    expect((screen.getByRole('slider') as HTMLInputElement).disabled).toBe(false)
  })
  it('キャンセルで復旧し、後から届いた古い結果は表示を上書きしない', async () => {
    const { runner, calls } = controlledRunner()
    render(<App playRunner={runner} />)
    selectIntegrated()
    fireEvent.click(screen.getByTestId('branch-run'))
    await act(async () => { fireEvent.click(screen.getByTestId('branch-cancel')) })
    expect(screen.queryByTestId('branch-running')).toBeNull()
    expect(screen.getByTestId('branch-notice').textContent).toContain('キャンセル')
    expect((screen.getByTestId('branch-run') as HTMLButtonElement).disabled).toBe(false)
    // 古い実行が(想定外に)成功結果を返しても無視する。
    await act(async () => { calls[0]!.resolve({ kind: 'DONE', computeMs: 1, result: { ok: false, code: 'A0_HALTED', message: 'stale' } }) })
    expect(screen.queryByTestId('branch-error')).toBeNull()
    // 再実行できる。
    fireEvent.click(screen.getByTestId('branch-run'))
    expect(calls).toHaveLength(2)
  })
  it('HALTEDとWorker失敗は、ゲーム内の勝敗と区別して表示する', async () => {
    const { runner, calls } = controlledRunner()
    render(<App playRunner={runner} />)
    selectIntegrated()
    fireEvent.click(screen.getByTestId('branch-run'))
    await act(async () => { calls[0]!.resolve({ kind: 'DONE', computeMs: 1, result: { ok: false, code: 'A1_HALTED', message: '{"reason":"x"}' } }) })
    expect(screen.getByTestId('branch-error').textContent).toContain('HALTED')
    expect(screen.getByTestId('branch-error').textContent).toContain('ゲーム内の勝敗ではありません')
    fireEvent.click(screen.getByTestId('branch-run'))
    await act(async () => { calls[1]!.resolve({ kind: 'FAILED', code: 'WORKER_ERROR', message: 'oom' }) })
    expect(screen.getByTestId('branch-error').textContent).toContain('ブラウザ側の失敗')
    expect(screen.queryByTestId('integrated-overview')).toBeNull()
  })
})

describe('App: 統合モードの結果表示(実WorldState/EventLogを統合モードの表示に通す)', () => {
  // 描画経路の確認用に、実際に計算できる短い旧モードの結果をモード名だけ統合に付け替える。
  // 100年の統合実計算そのものはオプトインの long テストで検証する。
  const real = runPlayComparison({ seed: 20260101, year: 1260, firstPersonId: 'person-exp-04', secondPersonId: 'person-exp-05', signedDelta: 20, durationYears: 5 })
  it('出典・差分判定・経過表・親子・Titleを表示し、正式勝敗を作らない', async () => {
    if (!real.ok) throw new Error(real.code)
    const view: PlayView = { ...real.comparison, mode: 'INTEGRATED_EXPERIMENTAL' }
    const { runner, calls } = controlledRunner()
    render(<App playRunner={runner} />)
    selectIntegrated()
    fireEvent.click(screen.getByTestId('branch-run'))
    await act(async () => { calls[0]!.resolve({ kind: 'DONE', computeMs: 12345, result: { ok: true, view } }) })
    expect(screen.getByTestId('integrated-source').textContent).toContain('createExperimentalIntegratedWorld')
    expect(screen.getByTestId('integrated-compute-time').textContent).toBe('12.3秒')
    expect(screen.getByTestId('integrated-defaults-note').textContent).toContain('強制イベントではありません')
    expect(screen.getByTestId('integrated-verdict').textContent).toContain('差が確認されました')
    expect(screen.getByTestId('integrated-row-marriage').textContent).toContain('A1のみ 1')
    expect(screen.getByTestId('integrated-final-titles')).toBeTruthy()
    expect(screen.getByTestId('branch-status').textContent).toContain('goal=null')
    expect(screen.getByTestId('goal-status').textContent).toContain('未成立')
    expect(screen.getByTestId('todo-rules').textContent).toContain('TODO 37件')
    // 経過の一覧から実EventをA1の年表へ開ける。
    fireEvent.click(screen.getByText('婚姻の成立を年表で開く（A0 0件）'))
    const button = screen.getAllByRole('button').find(b => (b.textContent ?? '').includes('婚姻が成立'))
    expect(button).toBeTruthy()
    fireEvent.click(button!)
    expect(screen.getByTestId('active-branch').textContent).toContain('A1')
  }, 60000)

  it('Event差がなくても介入を参照した実Traceへ直接移動できる（表示のみの同枝複写fixture）', async () => {
    if (!real.ok) throw new Error(real.code)
    // 表示用に同じ実計算枝をA0/A1へ割当て、「Event差なし」の閲覧経路だけを検証する。
    const view: PlayView = { ...real.comparison, mode: 'INTEGRATED_EXPERIMENTAL', a0: real.comparison.a1 }
    const recorded = view.a1.result.decisionTraces.find(t => t.modifierIds.includes(view.modifier.modifierId))
    expect(recorded).toBeDefined()
    if (!recorded) return
    const { runner, calls } = controlledRunner()
    render(<App playRunner={runner} />)
    selectIntegrated()
    fireEvent.click(screen.getByTestId('branch-run'))
    await act(async () => { calls[0]!.resolve({ kind: 'DONE', computeMs: 1, result: { ok: true, view } }) })
    expect(screen.getByTestId('integrated-verdict').textContent).toContain('差は確認されませんでした')
    expect(screen.getByTestId('integrated-evidence-count').textContent).toContain('介入を参照した判断Trace:')
    const buttons = [...screen.getByTestId('integrated-evidence-links').querySelectorAll('button')]
    const link = buttons.find(b => (b.textContent ?? '').includes(`${recorded.year}年・${recorded.ruleId}`))
    expect(link).toBeDefined()
    fireEvent.click(link!)
    expect(screen.getByTestId('trace-id').textContent).toBe(recorded.traceId)
    expect(screen.getByTestId('event-detail').textContent).toContain('事件を選ぶと')
    expect(screen.getByTestId('active-branch').textContent).toContain('A1')
    expect(screen.getByTestId('current-year').textContent).toContain(`${recorded.year}年`)
  }, 60000)

  it('A0だけに記録されたEventのリンクはA0の実Event IDを渡す（表示fixture）', () => {
    if (!real.ok) throw new Error(real.code)
    const event = real.comparison.a1.result.eventLog.find(e => e.eventType === 'MARRIAGE_REGISTER')
    expect(event).toBeDefined()
    if (!event) return
    // イベントを表示用の枝間で移すだけ。ゲーム計算・EventLog生成規則は変更しない。
    const a0 = { ...real.comparison.a0, result: { ...real.comparison.a0.result,
      eventLog: [...real.comparison.a0.result.eventLog.filter(e => e.eventId !== event.eventId), event] } }
    const a1 = { ...real.comparison.a1, result: { ...real.comparison.a1.result,
      eventLog: real.comparison.a1.result.eventLog.filter(e => e.eventId !== event.eventId) } }
    const view: PlayView = { ...real.comparison, mode: 'INTEGRATED_EXPERIMENTAL', a0, a1 }
    const selected: Array<[string, string]> = []
    render(<IntegratedOverview view={view} personLabel={id => id}
      onInspectEvent={(side,id) => selected.push([side,id])} onInspectTrace={() => {}} />)
    fireEvent.click(screen.getByTestId('integrated-list-marriage').querySelector('summary')!)
    const lost = screen.getByTestId('integrated-a0-only-marriage')
    expect(lost.querySelectorAll('button').length).toBeGreaterThan(0)
    fireEvent.click(lost.querySelector('button')!)
    expect(selected).toEqual([['A0',event.eventId]])
  }, 60000)
})
