// forkHistory: 親の年初 snapshots[t] から runTimeline で t〜1349 年を実再計算し、前史を保持した Branch を返す。
// 純粋・決定的。親は変更しない。拒否は例外ではなく code 付きの結果で返す（安全側）。
import type { DecisionTrace, EventLogEntry, Id, StatModifierIssue, WorldState } from '../contracts/index.ts'
import { GOAL_YEAR } from '../contracts/index.ts'
import type { TimelineResult } from '../engine/index.ts'
import { runTimeline } from '../engine/index.ts'
import { addStatModifier, validateStatModifierLedger } from '../intervention/index.ts'
import type { StatModifierLedger } from '../intervention/index.ts'
import { rngVersion } from '../random.ts'
import type { Branch, ForkInput, ForkRejectCode, ForkResult } from './types.ts'

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value)
    for (const v of Object.values(value)) deepFreeze(v)
  }
  return value
}
const copy = <T>(v: T): T => structuredClone(v)

const reject = (code: ForkRejectCode, message: string, issues: readonly StatModifierIssue[] = []): ForkResult => ({ ok: false, code, message, issues })
const isId = (v: unknown): v is Id => typeof v === 'string' && v !== ''

/** 完走した runTimeline 結果を ROOT の Branch にする。HALTED/不整合は拒否。台帳は明示入力（既定は空）。 */
export function createRootBranch(
  result: TimelineResult,
  ledger: StatModifierLedger = [],
): ForkResult {
  const branch: Branch = {
    branchId: result.branchId,
    parentBranchId: null,
    lineage: [result.branchId],
    forkYear: null,
    seed: result.seed,
    rngVersion: result.rngVersion,
    startYear: result.startYear,
    ledger: copy(ledger),
    status: result.status,
    halt: copy(result.halt),
    snapshots: copy(result.snapshots),
    eventLog: copy(result.eventLog),
    decisionTraces: copy(result.decisionTraces),
    goal: null,
    recompute: null,
  }
  const bad = checkBranchShape(branch)
  if (bad !== null) return reject('INVALID_PARENT', bad)
  if (!isId(branch.branchId)) return reject('INVALID_BRANCH_ID', 'branchId が不正です')
  const known = new Set<Id>(branch.snapshots[0]?.persons.map((p) => p.personId) ?? [])
  const v = validateStatModifierLedger(branch.ledger, { knownPersonIds: known })
  if (!v.ok) return reject('INVALID_PARENT_LEDGER', '台帳が不正です', v.issues)
  return { ok: true, branch: deepFreeze(branch) }
}

/** snapshot 列が startYear から連続し、HALTED 以外は 1350 年初まで揃っていること。 */
function checkBranchShape(b: Branch): string | null {
  if (!Number.isSafeInteger(b.seed) || b.seed < 0) return 'seed が不正です'
  if (b.snapshots.length === 0) return 'snapshot がありません'
  if (!b.snapshots.every((s, i) => s.year === b.startYear + i)) return 'snapshot の年が startYear から連続していません'
  if (b.status === 'COMPLETED' && b.snapshots[b.snapshots.length - 1]?.year !== GOAL_YEAR) return `COMPLETED なのに ${GOAL_YEAR} 年初まで揃っていません`
  return null
}

export function forkHistory(input: ForkInput): ForkResult {
  const { parent, forkYear, branchId } = input
  if (typeof parent !== 'object' || parent === null || !Array.isArray(parent.snapshots)) return reject('INVALID_PARENT', '親 branch が不正です')
  const shape = checkBranchShape(parent)
  if (shape !== null) return reject('INVALID_PARENT', shape)
  if (parent.status !== 'COMPLETED') return reject('PARENT_HALTED', '停止した親からは分岐しません（未計算年を推測しない）')
  if (parent.rngVersion !== rngVersion) return reject('RNG_VERSION_MISMATCH', `rngVersion が不一致です: ${parent.rngVersion} != ${rngVersion}`)
  if (input.seed !== undefined && input.seed !== parent.seed) return reject('SEED_MISMATCH', 'seed が親と矛盾します')
  if (!isId(branchId) || parent.lineage.includes(branchId)) return reject('INVALID_BRANCH_ID', 'branchId は空でなく、祖先と重複できません')

  if (!Number.isSafeInteger(forkYear) || forkYear < parent.startYear) return reject('INVALID_FORK_YEAR', `forkYear は ${parent.startYear} 以上の整数が必要です`)
  if (forkYear >= GOAL_YEAR) return reject('FORK_YEAR_AT_GOAL', `${GOAL_YEAR} 年は評価専用で、介入や再計算を置けません`)
  if (forkYear < (parent.forkYear ?? parent.startYear)) return reject('FORK_BEFORE_PARENT_FORK', '親の分岐年より前（祖先の確定履歴）では分岐できません')
  const at = parent.snapshots[forkYear - parent.startYear]
  if (at === undefined || at.year !== forkYear) return reject('UNCOMPUTED_YEAR', `${forkYear} 年初の snapshot が未計算です`)

  const known = new Set<Id>((at as WorldState).persons.map((p) => p.personId))
  const ctx = { knownPersonIds: known }
  const pv = validateStatModifierLedger(parent.ledger, ctx)
  if (!pv.ok) return reject('INVALID_PARENT_LEDGER', '親の台帳が不正です', pv.issues)

  if (!Array.isArray(input.modifiers) || input.modifiers.length === 0) return reject('NO_MODIFIERS', '追加する modifier が必要です（空の分岐を作りません）')
  // 引継ぎ: 開始年 < t を保持、= t は保持（同 slot は追加時に拒否）、> t は破棄。
  let ledger: StatModifierLedger = parent.ledger.filter((m) => m.startYear <= forkYear)
  for (const m of input.modifiers) {
    if (m?.startYear !== forkYear) return reject('MODIFIER_START_MISMATCH', `追加 modifier の startYear は forkYear(${forkYear}) と一致が必要です`)
    const r = addStatModifier(ledger, m, ctx)
    if (!r.ok) return reject('MODIFIER_REJECTED', 'modifier を台帳へ追加できません', r.issues)
    if (r.outcome === 'DUPLICATE') return reject('DUPLICATE_INTERVENTION', '同一 modifier は既に台帳にあります（新しい介入ではない）')
    ledger = r.ledger
  }

  let suffix: TimelineResult
  try {
    const evaluators = input.evaluatorsFor?.({ branchId, parentBranchId: parent.branchId, forkYear, seed: parent.seed, ledger, knownPersonIds: known }) ?? {}
    suffix = runTimeline(copy(at as WorldState), { seed: parent.seed, branchId, evaluators })
  } catch (e) {
    return reject(input.evaluatorsFor ? 'EVALUATOR_FACTORY_FAILED' : 'RECOMPUTE_FAILED', `再計算を開始できません: ${e instanceof Error ? e.message : String(e)}`)
  }
  if (suffix.snapshots[0]?.year !== forkYear) return reject('RECOMPUTE_FAILED', suffix.halt?.message ?? '再計算の起点が確定しません')

  const keepEvents: EventLogEntry[] = parent.eventLog.filter((e) => e.year < forkYear)
  const keepTraces: DecisionTrace[] = parent.decisionTraces.filter((d) => d.year < forkYear)
  const branch: Branch = {
    branchId,
    parentBranchId: parent.branchId,
    lineage: [...parent.lineage, branchId],
    forkYear,
    seed: parent.seed,
    rngVersion,
    startYear: parent.startYear,
    ledger,
    status: suffix.status,
    halt: suffix.halt,
    snapshots: [...parent.snapshots.slice(0, forkYear - parent.startYear), ...suffix.snapshots],
    eventLog: [...keepEvents, ...suffix.eventLog],
    decisionTraces: [...keepTraces, ...suffix.decisionTraces],
    goal: null,
    recompute: { fromYear: forkYear, status: suffix.status, transitions: suffix.transitions, suffixCoverage: suffix.coverage },
  }
  return { ok: true, branch: deepFreeze(copy(branch)) }
}
