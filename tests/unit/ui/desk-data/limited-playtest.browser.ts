// #165 の開発者用実計算受入。通常 UI と Vitest からは実行しない。
import { DEFAULT_OBSERVATION_MODE } from '../../../../src/ui/branch-play-source.ts'
import { createLimitedPlaytestSession, limitedComparisonInput, limitedObservationInput } from '../../../../src/ui/desk/data/limited-playtest.ts'
import { historyFromObservation, historyFromPlayView, matchesObservation, matchesPlayRequest } from '../../../../src/ui/desk/data/history.ts'
import { candidateSetMatches, candidatesAtYear } from '../../../../src/ui/play-candidates.ts'
import { createWorkerPlayRunner, workerCandidatesRunner } from '../../../../src/ui/play-runner.ts'
import type { TimelineRun } from '../../../../src/ui/timeline-source.ts'

function check(value: unknown, label: string): asserts value {
  if (!value) throw new Error(label)
}

async function hash(entries: readonly unknown[], canonicalKeys = false) {
  const orderKeys = (_key: string, value: unknown) => value && typeof value === 'object' && !Array.isArray(value)
    ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)) : value
  const body = entries.map(entry => JSON.stringify(entry, canonicalKeys ? orderKeys : undefined) + '\n').join('')
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(body))
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('')
}

type Reference = Readonly<{
  technicalGoal: TimelineRun['result']['technicalGoal']
  hashes: Readonly<{ snapshots: { sha256: string }; events: { count: number; sha256: string }; traces: { count: number } }>
}>

export async function verifyLimitedPlaytest(reference: Readonly<Record<'A0' | 'A1' | 'small', Reference>>) {
  const session = createLimitedPlaytestSession()
  const legacy = createWorkerPlayRunner()
  // 工程2Fの比較入力。製品コードや画面の初期値には含めない。
  const pair = { firstPersonId: 'person-exp-02', secondPersonId: 'person-exp-05', durationYears: 1 }
  const intervention = { ...pair, signedDelta: 20 }
  const control = { ...pair, signedDelta: 1 }
  const timings: Record<string, { workerMs: number; wallMs: number }> = {}
  async function timed<T extends { kind: string }>(name: string, start: () => Promise<T>) {
    const t = performance.now()
    const outcome = await start()
    check(outcome.kind === 'DONE' && 'computeMs' in outcome && typeof outcome.computeMs === 'number', JSON.stringify(outcome))
    timings[name] = { workerMs: outcome.computeMs, wallMs: performance.now() - t }
    return outcome
  }
  const relation = (year: ReturnType<ReturnType<typeof historyFromObservation>['at']>, l = pair.firstPersonId, r = pair.secondPersonId) =>
    year.relationship(l, r)
  async function verifyReference(run: TimelineRun, name: keyof typeof reference, omitted: { events: number; traces: number }) {
    const { result } = run
    const expected = reference[name]
    check(result.status === 'COMPLETED' && result.transitions === 100 && result.snapshots.at(-1)?.year === 1350, `${name}: 完走`)
    check(result.goal === null && JSON.stringify(result.technicalGoal) === JSON.stringify(expected.technicalGoal), `${name}: 2F技術Goalとの完全一致`)
    check(await hash(result.snapshots, true) === expected.hashes.snapshots.sha256, `${name}: 年初 snapshot の2Fハッシュ`)
    check(result.eventLog.length + omitted.events === expected.hashes.events.count, `${name}: 全 Event 件数`)
    if (omitted.events === 0) check(await hash(result.eventLog) === expected.hashes.events.sha256, `${name}: Eventの2Fハッシュ`)
    check(result.decisionTraces.length + omitted.traces === expected.hashes.traces.count, `${name}: 全 Trace 件数`)
  }
  const counts = (source: Readonly<Record<string, number>>) => Object.values(source).reduce((sum, n) => sum + n, 0)
  try {
    check(session.configuration.configId === 'experimental-multi-house-v2-demand-relations-drift-0' && session.configuration.configDigest === '844299b001142fee', '構成の実測 identity')
    const first = await timed('A0', () => session.observe(1250).promise)
    check(first.kind === 'DONE' && first.result.ok, '初回観測')
    const a0 = first.result.observation
    check(a0.a0Source === 'COMPUTED' && a0.technicalGoal?.status === 'NOT_ACHIEVED' && a0.goal === null, 'A0 技術 Goal と正式 Goal')
    const h0 = historyFromObservation(a0)
    const origin = h0.at(1250)
    const initial = relation(origin)
    check(initial.kind === 'YEAR_START_BASE' && initial.observation.status === 'UNKNOWN', '1250年初は基礎値未確定')
    check(relation(h0.at(1251)).kind === 'NOT_LOADED', '未取得年は UNKNOWN ではない')
    check(candidatesAtYear(a0.candidates, 1250).some(c => c.id === pair.firstPersonId), '実A0の介入候補')
    const defer = a0.traces.filter(t => t.ruleId === 'A-LEG-01' && t.status === 'DEFER' && t.reasonCodes.includes('SUPPORTING_REGISTRATION_BUDGET_EXCEEDED'))
    check(defer.length === 4 && defer.every(t => t.eventIds.length === 0 && t.candidates.some(c => c.reasonCodes.includes('SUPPORTING_REGISTRATION_BUDGET_EXCEEDED'))), '4件の候補登録予算 DEFER は実Traceのみ')
    check(origin.trace(defer[0]!.traceId, 'A-LEG-01').kind === 'RECORDED', 'DEFER の実参照')

    const next = await timed('A0-1251-reuse', () => session.observe(1251).promise)
    check(next.kind === 'DONE' && next.result.ok && next.result.observation.a0Source === 'REUSED', '年変更で A0 再利用')
    const year1251 = historyFromObservation(next.result.observation).at(1251)
    const recorded = relation(year1251)
    check(recorded.kind === 'YEAR_START_BASE' && recorded.observation.status === 'RECORDED'
      && recorded.observation.throughYear === 1250 && recorded.observation.value === 27, '確定アンカーと対象年')
    let derived: { pair: string[]; value: number; throughYear: number } | undefined
    const persons = next.result.observation.world.persons
    for (const [index, left] of persons.entries()) {
      for (const right of persons.slice(index + 1)) {
        const r = relation(year1251, left.personId, right.personId)
        if (r.kind === 'YEAR_START_BASE' && r.observation.status === 'DERIVED') {
          derived = { pair: [left.personId, right.personId], value: r.observation.value, throughYear: r.observation.throughYear }
          break
        }
      }
      if (derived) break
    }
    check(derived?.throughYear === 1250, '疎な年初 snapshot で実際に DERIVED')
    const ending = await timed('A0-1350-reuse', () => session.observe(1350).promise)
    check(ending.kind === 'DONE' && ending.result.ok && ending.result.observation.a0Source === 'REUSED', '結末スライス')
    check(historyFromObservation(ending.result.observation).at(1350).records.kind === 'EVALUATION_ONLY', '1350年初は評価のみ')

    const successful = await timed('A1', () => session.compare(1250, intervention).promise)
    check(successful.kind === 'DONE' && successful.result.ok && 'view' in successful.result, 'A1 Worker 応答')
    const view = successful.result.view
    check(view.a0Source === 'REUSED' && view.a1.result.technicalGoal?.status === 'ACHIEVED', 'A1 技術達成と A0 再利用')
    const totals = { events: counts(view.displayOmission!.omittedEventsByType), traces: counts(view.displayOmission!.omittedTracesByRule) }
    const h = historyFromPlayView(view)!
    const a1 = h.at('A1', 1250)!
    check(a1.records.kind === 'COMMITTED' && a1.start.kind === 'CONFIRMED', 'A1年初と年内を別々に参照')
    const trace = a1.records.traces.find(t => t.ruleId === 'B-004' && t.candidates.some(c => c.inputs.effectiveTrust === 47
      && JSON.stringify(c.inputs.modifierIds) === JSON.stringify(view.a1.playModifierIds)))
    check(trace?.status === 'ACCEPT' && a1.trace(trace.traceId, 'B-004').kind === 'RECORDED', '介入後の47は実Traceと実台帳で照合')
    check(JSON.stringify(a1.start) === JSON.stringify(origin.start), '分岐年初の親と子は同一')
    check(JSON.stringify(relation(a1)) === JSON.stringify(initial), '当年の実評価が年初基礎値に混入しない')
    const omittedYear = Object.keys(view.displayOmission!.byYear!).map(Number).find(y => {
      const log = h.at('A0', y)?.records
      return log?.kind === 'COMMITTED' && log.coverage.kind === 'TRANSFER_OMISSION' && (log.coverage.counts.omittedTracesByRule['B-009'] ?? 0) > 0
    })
    // A1との共通記録が少ない場合は、同値となる対照の転送ビューで省略を必ず確認する。
    await verifyReference(view.a0, 'A0', totals)
    await verifyReference(view.a1, 'A1', totals)

    const small = await timed('control', () => session.compare(1250, control).promise)
    check(small.kind === 'DONE' && small.result.ok && 'view' in small.result, '対照 Worker 応答')
    const controlView = small.result.view
    check(controlView.a0Source === 'REUSED' && controlView.a1.result.technicalGoal?.status === 'NOT_ACHIEVED', '対照の技術未達')
    const controlTotals = { events: counts(controlView.displayOmission!.omittedEventsByType), traces: counts(controlView.displayOmission!.omittedTracesByRule) }
    await verifyReference(controlView.a1, 'small', controlTotals)
    const hc = historyFromPlayView(controlView)!
    const transferYear = Object.keys(controlView.displayOmission!.byYear!).map(Number).find(y => {
      const records = hc.at('A0', y)?.records
      return records?.kind === 'COMMITTED' && records.coverage.kind === 'TRANSFER_OMISSION' && (records.coverage.counts.omittedTracesByRule['B-009'] ?? 0) > 0
    })
    check(transferYear !== undefined, '対照との共通 B-009 Trace に実転送省略あり')
    const transferred = hc.at('A0', transferYear)!
    check(transferred.trace('missing', 'B-009').kind === 'POSSIBLY_OMITTED' && transferred.trace('missing', 'A-LEG-01').kind === 'NO_RECORD'
      && relation(transferred).kind === 'YEAR_START_BASE', '転送省略・実記録なし・年初基礎値は別')
    const complete = await timed('A0-transfer-year-reuse', () => session.observe(transferYear).promise)
    check(complete.kind === 'DONE' && complete.result.ok && complete.result.observation.a0Source === 'REUSED', '同年の完全観測')
    const shown = transferred.records
    check(shown.kind === 'COMMITTED' && shown.coverage.kind === 'TRANSFER_OMISSION', '年別転送省略')
    const missing = complete.result.observation.traces.find(t => t.ruleId === 'B-009' && !shown.traces.some(s => s.traceId === t.traceId))
    check(missing && transferred.trace(missing.traceId, 'B-009').kind === 'POSSIBLY_OMITTED', '存在する実Traceが転送省略された')
    check(historyFromObservation(complete.result.observation).at(transferYear).trace(missing.traceId, 'B-009').kind === 'RECORDED', '観測スライスでは省略せず参照')
    check(JSON.stringify(relation(transferred)) === JSON.stringify(relation(historyFromObservation(complete.result.observation).at(transferYear))), '転送省略は関係読取を変えない')

    const after = await timed('A0-after-forks-reuse', () => session.observe(1250).promise)
    check(after.kind === 'DONE' && after.result.ok && after.result.observation.a0Source === 'REUSED', '分岐後も A0 再利用')
    check(JSON.stringify(after.result.observation) === JSON.stringify({ ...a0, a0Source: 'REUSED' }), '親枝・候補・観測資料の非干渉')
    check(await hash(controlView.a0.result.snapshots, true) === reference.A0.hashes.snapshots.sha256, '再利用 A0 の全 snapshot 不変')
    const legacyRequest = { seed: session.seed, mode: DEFAULT_OBSERVATION_MODE, year: 1250 }
    const old = await timed('v0', () => legacy.observe(legacyRequest).promise)
    check(old.kind === 'DONE' && old.result.ok && matchesObservation(legacyRequest, old.result.observation), '通常入口 v0')
    const v0 = old.result.observation
    check(v0.configDigest === '5090c8485f4b8570' && v0.world.pairTrustDrift === undefined, 'v0 の既定構成・digest')
    check(!matchesObservation(limitedObservationInput(1250), v0) && !matchesObservation(legacyRequest, a0), 'v0 / 限定試遊の相互誤結合拒否')
    check(!matchesPlayRequest(limitedComparisonInput(1250, intervention), { ...view, a1: { ...view.a1, inputs: { ...view.a1.inputs, configIdentity: 'other' } } }), '同 digest・別完全identityを拒否')
    const fetched = await timed('candidates-only', () => workerCandidatesRunner(session.seed, DEFAULT_OBSERVATION_MODE, 'LIMITED_PLAYTEST').promise)
    check(fetched.kind === 'DONE' && fetched.result.ok && candidateSetMatches(fetched.result.set, session.seed, DEFAULT_OBSERVATION_MODE, 'LIMITED_PLAYTEST')
      && JSON.stringify(fetched.result.set.candidates) === JSON.stringify(a0.candidates.candidates), '既存の候補専用 Worker も同一の実候補')
    return { timings, configuration: { configId: session.configuration.configId, configDigest: session.configuration.configDigest },
      goals: [a0.technicalGoal?.status, view.a1.result.technicalGoal?.status, controlView.a1.result.technicalGoal?.status],
      v0: v0.configDigest, budgetDefer: defer.map(t => t.traceId), recorded: recorded.observation, derived,
      technicalEvidence: { effectiveTrust: 47, traceId: trace.traceId, technicallyAchievedWithFormalGoal: view.a1.result.goal },
      omission: { a1: { totals, firstOmittedYear: omittedYear }, control: { totals: controlTotals, year: transferYear, traceId: missing.traceId } } }
  } finally {
    session.reset()
    legacy.reset()
  }
}
