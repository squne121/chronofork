// 任意の100年実計算。Vitest の通常対象外。呼び出し方は README を参照。
import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { readCheckoutBuild } from '../../scripts/replay-playtest.ts'
import { SingleA0Cache } from '../../src/ui/a0-cache.ts'
import { runPlayComparison, runPlayObservation } from '../../src/ui/branch-play-source.ts'
import { historyFromObservation, historyFromPlayView } from '../../src/ui/desk/data/history.ts'
import type { HistoryYear } from '../../src/ui/desk/data/history.ts'
import { isObservationFocusEvent } from '../../src/ui/integrated-overview.ts'
import { toDisplayView } from '../../src/ui/play-view.ts'
import { checkedModifier, exportPlaytestEvidence, limitedReplayInput, parseEvidence, serializePlaytestEvidence } from '../../src/ui/playtest-evidence.ts'
import type { Evidence } from '../../src/ui/playtest-evidence.ts'

const [action, directory, mainSha] = process.argv.slice(2)
assert(directory && (action === 'observation' || action === 'comparison' || action === 'negative'))
const requestId = 1
const build = readCheckoutBuild()
assert.equal(build.kind, 'COMMIT', 'clean checkout の実 HEAD が必要です')
const captureInput = { ...limitedReplayInput, year: 1253 }
const comparisonYear = 1251
const comparisonInput = { ...limitedReplayInput, year: 1250, firstPersonId: 'person-exp-02', secondPersonId: 'person-exp-05', signedDelta: 20, durationYears: 1 }

function refs(history: HistoryYear, branch: 'A0' | 'A1') {
  assert.equal(history.records.kind, 'COMMITTED')
  const event = history.records.events.find(item => isObservationFocusEvent(item) && item.sourceTraceIds.length > 0)
  assert(event, '参照可能な実 Event が必要です')
  assert.equal(history.trace(event.sourceTraceIds[0]!).kind, 'RECORDED')
  return { selection: { event: { branch, id: event.eventId } }, debug: { branch, traceId: event.sourceTraceIds[0]! } }
}

function save(name: string, evidence: Evidence) {
  const path = join(directory!, `${name}.json`)
  writeFileSync(path, serializePlaytestEvidence(evidence), { flag: 'wx' })
  const restored = readFileSync(path, 'utf8')
  assert.deepEqual(parseEvidence(restored), evidence)
  console.log(JSON.stringify({ file: `${name}.json`, bytes: Buffer.byteLength(restored), build: evidence.build,
    kind: evidence.kind, year: evidence.year, branch: evidence.branch, transfer: evidence.transfer,
    event: evidence.selection.event, trace: evidence.debug?.traceId }))
}

if (action === 'observation') {
  const cache = new SingleA0Cache()
  const calculated = runPlayObservation(captureInput, cache)
  cache.clear()
  assert(calculated.ok, calculated.ok ? undefined : calculated.code)
  const result = calculated.observation
  const entry = historyFromObservation(result).at(captureInput.year)
  const { selection } = refs(entry, 'A0')
  save('a0', await exportPlaytestEvidence({ kind: 'OBSERVATION', input: captureInput, build, requestId,
    selected: entry.ref, selection, outcome: { kind: 'DONE', requestId, result } }))
} else if (action === 'comparison') {
  const calculated = runPlayComparison(comparisonInput)
  assert(calculated.ok, calculated.ok ? undefined : calculated.code)
  const result = toDisplayView(calculated.comparison)
  const entry = historyFromPlayView(result)?.at('A1', comparisonYear)
  assert(entry)
  const evidence = await exportPlaytestEvidence({ kind: 'COMPARISON', input: comparisonInput, build, requestId,
    selected: entry.ref, ...refs(entry, 'A1'), outcome: { kind: 'DONE', requestId, result } })
  const [before, after] = evidence.player.branches
  assert.equal(after?.modifierIds[0], calculated.comparison.branch.ledger[0]?.modifierId)
  assert.equal(after?.coverage.kind, 'TRANSFER_OMISSION')
  assert.notEqual(before?.events.sha256, after?.events.sha256)
  save('a0-a1', evidence)
} else {
  assert(mainSha && /^[0-9a-f]{40}$/.test(mainSha) && mainSha !== build.sha, '別 checkout の既知の SHA が必要です')
  const a0 = parseEvidence(readFileSync(join(directory, 'a0.json'), 'utf8'))
  const a1 = parseEvidence(readFileSync(join(directory, 'a0-a1.json'), 'utf8'))
  save('invalid-result', { ...a0, player: { ...a0.player, branches: a0.player.branches.map(branch => ({ ...branch,
    yearStart: { ...branch.yearStart, alivePersons: branch.yearStart.alivePersons + 1 } })) } })
  save('invalid-config', { ...a0, config: { ...a0.config, identitySha256: '0'.repeat(64) } })
  save('other-build', { ...a0, build: { kind: 'COMMIT', sha: mainSha } })
  save('unavailable-build', { ...a0, build: { kind: 'COMMIT', sha: '1'.repeat(40) } })
  save('local-build', { ...a0, build: { kind: 'LOCAL', reason: 'UNKNOWN' } })
  const { year, secondPersonId, signedDelta, durationYears } = a1.intervention!
  const firstPersonId = 'person-does-not-exist'
  const { modifierId, ruleVersion } = checkedModifier(year, firstPersonId, secondPersonId, signedDelta, durationYears)
  save('invalid-person', { ...a1,
    intervention: { year, firstPersonId, secondPersonId, signedDelta, durationYears, modifierId, ruleVersion },
    player: { ...a1.player, branches: a1.player.branches.map(branch => ({ ...branch,
      modifierIds: branch.branch === 'A1' ? [modifierId] : [], yearStart: { ...branch.yearStart,
        persons: [firstPersonId, secondPersonId].map(id => ({ id, presence: 'ABSENT' })) } })) } })
  writeFileSync(join(directory, 'invalid-json.json'), '{', { flag: 'wx' })
}
