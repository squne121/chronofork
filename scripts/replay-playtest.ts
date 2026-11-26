import { execFileSync } from 'node:child_process'
import { closeSync, constants, fstatSync, openSync, readSync, realpathSync } from 'node:fs'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { isDeepStrictEqual } from 'node:util'
import { SingleA0Cache } from '../src/ui/a0-cache.ts'
import { runPlayComparison, runPlayObservation } from '../src/ui/branch-play-source.ts'
import { historyFromObservation, historyFromPlayView } from '../src/ui/desk/data/history.ts'
import { toDisplayView } from '../src/ui/play-view.ts'
import { checkedModifier, evidenceBuild, EVIDENCE_MAX_BYTES, EvidenceError, exportPlaytestEvidence,
  limitedEvidenceConfiguration, limitedReplayInput, parseEvidence } from '../src/ui/playtest-evidence.ts'
import type { Evidence, EvidenceBuild } from '../src/ui/playtest-evidence.ts'

const checkout = realpathSync(fileURLToPath(new URL('..', import.meta.url)))
// 呼び出し側の GIT_DIR / GIT_WORK_TREE / GIT_INDEX_FILE で別のソースと照合しない。
const gitEnv = Object.fromEntries(Object.entries(process.env).filter(([name]) => !name.toUpperCase().startsWith('GIT_')))
const git = (...args: string[]) => execFileSync('git', ['-c', 'core.fsmonitor=false', ...args], {
  cwd: checkout, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'],
  env: { ...gitEnv, GIT_NO_LAZY_FETCH: '1', GIT_NO_REPLACE_OBJECTS: '1', GIT_OPTIONAL_LOCKS: '0' },
}).trim()

export function readCheckoutBuild(): EvidenceBuild {
  try {
    if (realpathSync(git('rev-parse', '--show-toplevel')) !== checkout) return evidenceBuild(undefined)
    const sha = git('rev-parse', '--verify', 'HEAD')
    // assume-unchanged / skip-worktree のパスは status に現れない。正確な checkout として採用しない。
    const hidden = git('ls-files', '-v', '-z').split('\0').some(path => /^[a-zS] /.test(path))
    return evidenceBuild(sha, hidden || git('status', '--porcelain', '--untracked-files=normal', '--ignore-submodules=none') !== '')
  } catch { return evidenceBuild(undefined) }
}

export function verifyBuild(expected: EvidenceBuild, actual: EvidenceBuild, hasCommit: (sha: string) => boolean): void {
  if (expected.kind !== 'COMMIT') throw new EvidenceError('UNVERIFIABLE_BUILD', `保存時に照合可能な build SHA がありません: ${expected.reason}`)
  if (actual.kind !== 'COMMIT') throw new EvidenceError('UNVERIFIABLE_BUILD', `再実行側の checkout を特定できません: ${actual.reason}`)
  if (actual.sha === expected.sha) return
  if (!hasCommit(expected.sha)) throw new EvidenceError('BUILD_UNAVAILABLE', `対象 build はローカルにありません: ${expected.sha}`)
  throw new EvidenceError('BUILD_MISMATCH', `対象 build ${expected.sha} と checkout ${actual.sha} が異なります`)
}

function readEvidence(path: string): Evidence {
  let fd: number | undefined
  try {
    fd = openSync(path, constants.O_RDONLY | constants.O_NONBLOCK)
    const stat = fstatSync(fd)
    if (!stat.isFile()) throw new EvidenceError('READ_ERROR', '証跡にはローカルの通常ファイルを指定してください')
    if (stat.size > EVIDENCE_MAX_BYTES) throw new EvidenceError('INPUT_TOO_LARGE', '証跡のサイズ上限は64 KiBです')
    // stat の後にファイルが伸びても、上限より1バイト多いところまでしか読まない。
    const bytes = Buffer.alloc(EVIDENCE_MAX_BYTES + 1)
    let used = 0
    while (used < bytes.length) {
      const n = readSync(fd, bytes, used, bytes.length - used, null)
      if (n === 0) break
      used += n
    }
    if (used > EVIDENCE_MAX_BYTES) throw new EvidenceError('INPUT_TOO_LARGE', '証跡のサイズ上限は64 KiBです')
    let text: string
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(0, used)) }
    catch { throw new EvidenceError('INVALID_JSON', '証跡は UTF-8 で保存してください') }
    return parseEvidence(text)
  } catch (error) {
    if (error instanceof EvidenceError) throw error
    throw new EvidenceError('READ_ERROR', '証跡ファイルを読み取れません')
  } finally { if (fd !== undefined) closeSync(fd) }
}

async function recalculate(evidence: Evidence) {
  const { build, year, branch, intervention } = evidence
  const requestId = 1
  const selection = { personId: evidence.selection.personId ?? undefined, event: evidence.selection.event ?? undefined }
  const debug = evidence.debug ? { branch: evidence.debug.branch, traceId: evidence.debug.traceId } : undefined
  if (!intervention) {
    const input = { ...limitedReplayInput, year }
    const cache = new SingleA0Cache()
    const calculated = runPlayObservation(input, cache)
    cache.clear()
    if (!calculated.ok) throw new EvidenceError('RECALCULATION_FAILED', calculated.code)
    const result = calculated.observation
    return exportPlaytestEvidence({ kind: 'OBSERVATION', input, build, requestId, selection, debug,
      selected: historyFromObservation(result).at(year).ref, outcome: { kind: 'DONE', requestId, result } })
  }
  const { firstPersonId, secondPersonId, signedDelta, durationYears } = intervention
  const modifier = checkedModifier(intervention.year, firstPersonId, secondPersonId, signedDelta, durationYears)
  if (modifier.modifierId !== intervention.modifierId || modifier.ruleVersion !== intervention.ruleVersion)
    throw new EvidenceError('INVALID_INPUT', '介入入力と台帳の ID または版が一致しません')
  const input = { ...limitedReplayInput, year: intervention.year, firstPersonId, secondPersonId, signedDelta, durationYears }
  const calculated = runPlayComparison(input)
  if (!calculated.ok) throw new EvidenceError('RECALCULATION_FAILED', calculated.code)
  let result = evidence.transfer === 'FULL' ? calculated.comparison : toDisplayView(calculated.comparison)
  if (evidence.transfer === 'DISPLAY_RUN' && result.displayOmission) {
    // 旧 DTO と同様に年別省略件数を持たない形で、同じ projection を照合する。
    result = { ...result, displayOmission: { ...result.displayOmission, byYear: undefined } }
  }
  const selected = historyFromPlayView(result)?.at(branch, year)?.ref
  if (!selected) throw new EvidenceError('RECALCULATION_FAILED', '比較履歴が取得できません')
  return exportPlaytestEvidence({ kind: 'COMPARISON', input, build, requestId, selected, selection, debug,
    outcome: { kind: 'DONE', requestId, result } })
}

export async function replayEvidence(evidence: Evidence): Promise<void> {
  verifyBuild(evidence.build, readCheckoutBuild(), sha => {
    try { return git('cat-file', '-t', sha) === 'commit' } catch { return false }
  })
  if (!isDeepStrictEqual(evidence.config, await limitedEvidenceConfiguration()))
    throw new EvidenceError('CONFIGURATION_MISMATCH', '同じ構成 ID・digest・完全 identity の SHA-256 が必要です')
  let replayed: Evidence
  try { replayed = await recalculate(evidence) }
  catch (error) {
    if (error instanceof EvidenceError && (error.code === 'EVENT_UNAVAILABLE' || error.code === 'TRACE_UNAVAILABLE'))
      throw new EvidenceError('RESULT_MISMATCH', error.message)
    throw error
  }
  for (const key of Object.keys(replayed) as (keyof Evidence)[]) {
    if (!isDeepStrictEqual(evidence[key], replayed[key])) throw new EvidenceError('RESULT_MISMATCH', `再計算結果と一致しない項目: ${key}`)
  }
}

async function main(args: string[]) {
  try {
    if (args.length !== 1 || args[0]!.startsWith('-'))
      throw new EvidenceError('USAGE', '使い方: node --experimental-strip-types scripts/replay-playtest.ts <evidence.json>')
    const evidence = readEvidence(args[0]!)
    await replayEvidence(evidence)
    console.log(JSON.stringify({ ok: true, build: evidence.build, kind: evidence.kind, year: evidence.year,
      branches: evidence.player.branches.map(b => b.branch), officialGoal: evidence.player.officialGoal }))
  } catch (error) {
    const { code, message } = error instanceof EvidenceError ? error : { code: 'RECALCULATION_FAILED', message: '再計算または照合が完了しませんでした' }
    console.error(JSON.stringify({ ok: false, code, message }))
    process.exitCode = 1
  }
}

if (process.argv[1] && pathToFileURL(realpathSync(process.argv[1])).href === import.meta.url) await main(process.argv.slice(2))
