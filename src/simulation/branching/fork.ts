// forkHistory: 親の年初 snapshots[t] から runTimeline で t〜1349 年を実再計算し、前史を保持した Branch を返す。
// 純粋・決定的。親は変更しない。拒否は例外ではなく code 付きの結果で返す（安全側）。
// 未検証: scenario / legal / schema / ruleset の版は現 API に保持が無く、ここでは確認しない（rngVersion のみ照合）。
import type { DecisionTrace, EventLogEntry, Id, StatModifierIssue, WorldState } from '../contracts/index.ts'
import { GOAL_YEAR, START_YEAR } from '../contracts/index.ts'
import type { EvaluatorMap, TimelineResult } from '../engine/index.ts'
import { runTimeline } from '../engine/index.ts'
import { addStatModifier, validateStatModifierLedger } from '../intervention/index.ts'
import type { StatModifierLedger } from '../intervention/index.ts'
import { rngVersion } from '../random.ts'
import type { Branch, EvaluatorProfile, ForkInput, ForkRejectCode, ForkResult } from './types.ts'

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
const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null
const isYear = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v)

const profileOf = (ruleIds: readonly string[]): EvaluatorProfile => {
  const ids = [...new Set(ruleIds)].sort()
  return { mode: ids.length === 0 ? 'NONE' : 'RULES', ruleIds: ids }
}
const sameIds = (a: readonly string[], b: readonly string[]) => a.length === b.length && a.every((x, i) => x === b[i])
const personIdsOf = (snapshots: readonly WorldState[]): Set<Id> => new Set(snapshots.flatMap((s) => s.persons.map((p) => p.personId)))

/**
 * 構造検証。型が崩れた入力でも例外を出さず、不備の説明（無ければ null）を返す。
 * 年が連続し、全 snapshot が人物配列を持ち、親子メタデータが整合していることを確認する。
 */
function checkBranchShape(b: unknown): string | null {
  if (!isObj(b)) return 'branch がオブジェクトではありません'
  const { branchId, lineage, parentBranchId, forkYear, startYear, seed, snapshots, status, halt, ledger, eventLog, decisionTraces, evaluatorProfile } = b as Record<string, unknown>
  if (!isId(branchId)) return 'branchId が不正です'
  if (!Array.isArray(lineage) || lineage.length === 0 || !lineage.every(isId) || new Set(lineage).size !== lineage.length) return 'lineage が不正です'
  if (lineage[lineage.length - 1] !== branchId) return 'lineage の末尾が branchId と一致しません'
  if (lineage.length === 1 ? parentBranchId !== null || forkYear !== null : parentBranchId !== lineage[lineage.length - 2] || !isYear(forkYear)) {
    return 'parentBranchId / forkYear が lineage と整合しません'
  }
  if (!isYear(startYear) || startYear < START_YEAR || startYear > GOAL_YEAR) return 'startYear が不正です'
  if (!isYear(seed) || seed < 0) return 'seed が不正です'
  if (typeof b.rngVersion !== 'string') return 'rngVersion が不正です'
  if (status !== 'COMPLETED' && status !== 'HALTED') return 'status が不正です'
  if ((status === 'COMPLETED') !== (halt === null)) return 'status と halt が整合しません'
  if (!Array.isArray(snapshots) || snapshots.length === 0) return 'snapshot がありません'
  for (const [i, s] of snapshots.entries()) {
    if (!isObj(s) || !Array.isArray(s.persons) || !s.persons.every((p) => isObj(p) && isId(p.personId))) return `snapshots[${i}] が不正です`
    if (s.year !== startYear + i) return 'snapshot の年が startYear から連続していません'
  }
  const lastYear = startYear + snapshots.length - 1
  if (lastYear > GOAL_YEAR) return 'snapshot が範囲を超えています'
  if (status === 'COMPLETED' && lastYear !== GOAL_YEAR) return `COMPLETED なのに ${GOAL_YEAR} 年初まで揃っていません`
  if (forkYear !== null && (!isYear(forkYear) || forkYear < startYear || forkYear > lastYear)) return 'forkYear が snapshot の範囲外です'
  if (!Array.isArray(ledger)) return 'ledger が不正です'
  for (const [name, xs] of [['eventLog', eventLog], ['decisionTraces', decisionTraces]] as const) {
    if (!Array.isArray(xs) || !xs.every((x) => isObj(x) && isYear(x.year))) return `${name} が不正です`
  }
  const ep = evaluatorProfile as Record<string, unknown> | undefined
  if (!isObj(ep) || !Array.isArray(ep.ruleIds) || !ep.ruleIds.every(isId) || (ep.mode !== 'NONE' && ep.mode !== 'RULES') || (ep.mode === 'NONE') !== (ep.ruleIds.length === 0)) {
    return 'evaluatorProfile が不正です'
  }
  return null
}

/** 完走した runTimeline 結果を ROOT の Branch にする。台帳・評価器構成は明示入力（既定は空 / coverage の実行済み RuleID）。 */
export function createRootBranch(result: TimelineResult, ledger: StatModifierLedger = [], evaluators?: EvaluatorMap): ForkResult {
  try {
    const ids = evaluators ? Object.keys(evaluators).filter((k) => evaluators[k as keyof EvaluatorMap] !== undefined) : result.coverage.executedRuleIds
    // 完走した履歴では、明示された評価器の RuleID 集合が実際に実行された集合と厳密一致しなければ拒否する
    // （誤った構成を親の出典として登録させない）。HALTED は一部のみ実行されうるため従来どおり検証しない。
    if (evaluators && result.status === 'COMPLETED' && !sameIds([...new Set(ids)].sort(), [...result.coverage.executedRuleIds].sort())) {
      return reject('EVALUATOR_MISMATCH', `指定した評価器 [${[...ids].sort().join(',')}] が実行済み RuleID [${result.coverage.executedRuleIds.join(',')}] と一致しません`)
    }
    const branch: Branch = {
      branchId: result.branchId,
      parentBranchId: null,
      lineage: [result.branchId],
      forkYear: null,
      seed: result.seed,
      rngVersion: result.rngVersion,
      startYear: result.startYear,
      ledger: copy(ledger),
      evaluatorProfile: profileOf(ids),
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
    const v = validateStatModifierLedger(branch.ledger, { knownPersonIds: personIdsOf(branch.snapshots) })
    if (!v.ok) return reject('INVALID_PARENT_LEDGER', '台帳が不正です', v.issues)
    return { ok: true, branch: deepFreeze(branch) }
  } catch (e) {
    return reject('INVALID_PARENT', `root branch を作れません: ${e instanceof Error ? e.message : String(e)}`)
  }
}

export function forkHistory(input: ForkInput): ForkResult {
  try {
    return forkUnchecked(input)
  } catch (e) {
    return reject('INVALID_PARENT', `入力の検証中に例外が発生しました: ${e instanceof Error ? e.message : String(e)}`)
  }
}

function forkUnchecked(input: ForkInput): ForkResult {
  const { parent, forkYear, branchId } = input
  const shape = checkBranchShape(parent)
  if (shape !== null) return reject('INVALID_PARENT', shape)
  if (parent.status !== 'COMPLETED') return reject('PARENT_HALTED', '停止した親からは分岐しません（未計算年を推測しない）')
  if (parent.rngVersion !== rngVersion) return reject('RNG_VERSION_MISMATCH', `rngVersion が不一致です: ${parent.rngVersion} != ${rngVersion}`)
  if (input.seed !== undefined && input.seed !== parent.seed) return reject('SEED_MISMATCH', 'seed が親と矛盾します')
  if (!isId(branchId) || parent.lineage.includes(branchId)) return reject('INVALID_BRANCH_ID', 'branchId は空でなく、祖先と重複できません')

  if (!isYear(forkYear) || forkYear < parent.startYear) return reject('INVALID_FORK_YEAR', `forkYear は ${parent.startYear} 以上の整数が必要です`)
  if (forkYear >= GOAL_YEAR) return reject('FORK_YEAR_AT_GOAL', `${GOAL_YEAR} 年は評価専用で、介入や再計算を置けません`)
  if (forkYear < (parent.forkYear ?? parent.startYear)) return reject('FORK_BEFORE_PARENT_FORK', '親の分岐年より前（祖先の確定履歴）では分岐できません')
  const at = parent.snapshots[forkYear - parent.startYear]
  if (at === undefined || at.year !== forkYear) return reject('UNCOMPUTED_YEAR', `${forkYear} 年初の snapshot が未計算です`)

  // 台帳: 全体は親の全 snapshot の人物（将来登場する人物を含む）で検証し、継承対象だけを fork 年の人物で検証する。
  const everKnown = personIdsOf(parent.snapshots)
  const full = validateStatModifierLedger(parent.ledger, { knownPersonIds: everKnown })
  if (!full.ok) return reject('INVALID_PARENT_LEDGER', '親の台帳が不正です', full.issues)
  const known = new Set<Id>(at.persons.map((p) => p.personId))
  const ctx = { knownPersonIds: known }
  // 引継ぎ: 開始年 < t を保持、= t は保持（同 slot は追加時に拒否）、> t は破棄。
  const retained: StatModifierLedger = parent.ledger.filter((m) => m.startYear <= forkYear)
  const rv = validateStatModifierLedger(retained, ctx)
  if (!rv.ok) return reject('INVALID_PARENT_LEDGER', '継承する台帳が fork 年の世界と整合しません', rv.issues)

  if (!Array.isArray(input.modifiers) || input.modifiers.length === 0) return reject('NO_MODIFIERS', '追加する modifier が必要です（空の分岐を作りません）')
  let ledger = retained
  for (const m of input.modifiers) {
    if (m?.startYear !== forkYear) return reject('MODIFIER_START_MISMATCH', `追加 modifier の startYear は forkYear(${forkYear}) と一致が必要です`)
    const r = addStatModifier(ledger, m, ctx)
    if (!r.ok) return reject('MODIFIER_REJECTED', 'modifier を台帳へ追加できません', r.issues)
    if (r.outcome === 'DUPLICATE') return reject('DUPLICATE_INTERVENTION', '同一 modifier は既に台帳にあります（新しい介入ではない）')
    ledger = r.ledger
  }

  // 評価器: 親と同じ RuleID 構成でなければ拒否（忘れ・不一致を介入効果と誤認させない）。
  let evaluators: EvaluatorMap
  try {
    evaluators = input.evaluatorsFor?.({ branchId, parentBranchId: parent.branchId, forkYear, seed: parent.seed, ledger, knownPersonIds: known }) ?? {}
  } catch (e) {
    return reject('EVALUATOR_FACTORY_FAILED', `評価器の生成に失敗しました: ${e instanceof Error ? e.message : String(e)}`)
  }
  const profile = profileOf(Object.keys(evaluators).filter((k) => evaluators[k as keyof EvaluatorMap] !== undefined))
  if (profile.mode !== parent.evaluatorProfile.mode || !sameIds(profile.ruleIds, parent.evaluatorProfile.ruleIds)) {
    return reject('EVALUATOR_MISMATCH', `評価器構成が親と一致しません（親: ${parent.evaluatorProfile.mode}[${parent.evaluatorProfile.ruleIds.join(',')}] / 指定: ${profile.mode}[${profile.ruleIds.join(',')}]）`)
  }

  let suffix: TimelineResult
  try {
    suffix = runTimeline(copy(at as WorldState), { seed: parent.seed, branchId, evaluators })
  } catch (e) {
    return reject('RECOMPUTE_FAILED', `再計算を開始できません: ${e instanceof Error ? e.message : String(e)}`)
  }
  if (suffix.snapshots[0]?.year !== forkYear) return reject('RECOMPUTE_FAILED', suffix.halt?.message ?? '再計算の起点が確定しません')
  // 実行された RuleID は評価器構成に含まれ、完走したなら全て実行されている（実行側の照合）。
  const executed = suffix.coverage.executedRuleIds
  if (!executed.every((id) => profile.ruleIds.includes(id)) || (suffix.status === 'COMPLETED' && !sameIds([...executed].sort(), profile.ruleIds))) {
    return reject('EVALUATOR_MISMATCH', '再計算で実行された RuleID が評価器構成と一致しません')
  }

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
    evaluatorProfile: profile,
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
