// 共通 reducer: evaluateRule が返した型付き DomainCommand を、安全かつ原子的に WorldState へ適用する。
// 純粋関数: 入力の WorldState / Transaction を変更せず、新しい値を返す。EventLog は生成しない。
import type { DomainCommand, Id, RuleOutcome, WorldState } from '../../contracts/index.ts'
import { checkWorldIntegrity, hasErrors } from '../../validation/index.ts'
import type { Diagnostic } from '../../validation/index.ts'
import { checkCommandAuthority, checkOutcomeHeader } from './authority.ts'
import { canonicalize } from './canonical.ts'
import { diffWorld } from './diff.ts'
import type { Draft, Handler } from './draft.ts'
import { fail } from './draft.ts'
import {
  controlMandateSet,
  legalCaseSet,
  legalDynastySet,
  legalTitleTransfer,
  marriageRegister,
  taxMandateSet,
  titleRecognitionSet,
} from './handlers-legal.ts'
import { resourceTransaction } from './handlers-ledger.ts'
import { personBirth, personDeath } from './handlers-person.ts'
import { populationCasualty, populationCohort, supportSet } from './handlers-population.ts'
import { regionControlSet } from './handlers-region.ts'
import type {
  AppliedCommand,
  ApplyContext,
  ApplyResult,
  ApplyStatus,
  CommandTransaction,
  Rejection,
  UnitResult,
} from './types.ts'

/** 実装済みの command 種別。ここに無い種別は UNIMPLEMENTED_COMMAND として拒否する（成功扱いで無視しない）。 */
type Implemented = Exclude<DomainCommand['type'], 'TREATY_COMMIT'>
type HandlerMap = { [K in Implemented]: Handler<Extract<DomainCommand, { type: K }>> }

const HANDLERS: HandlerMap = {
  MARRIAGE_REGISTER: marriageRegister,
  LEGAL_DYNASTY_SET: legalDynastySet,
  LEGAL_TITLE_TRANSFER: legalTitleTransfer,
  TITLE_RECOGNITION_SET: titleRecognitionSet,
  LEGAL_CASE_SET: legalCaseSet,
  CONTROL_MANDATE_SET: controlMandateSet,
  TAX_MANDATE_SET: taxMandateSet,
  PERSON_BIRTH: personBirth,
  PERSON_DEATH: personDeath,
  POPULATION_COHORT: populationCohort,
  POPULATION_CASUALTY: populationCasualty,
  SUPPORT_SET: supportSet,
  RESOURCE_TRANSACTION: resourceTransaction,
  REGION_CONTROL_SET: regionControlSet,
}

/** 実装済みの command 種別一覧（テスト・報告用）。 */
export const IMPLEMENTED_COMMAND_TYPES: readonly Implemented[] = Object.keys(HANDLERS) as Implemented[]
export const UNIMPLEMENTED_COMMAND_TYPES: readonly DomainCommand['type'][] = ['TREATY_COMMIT']

const diagKey = (d: Diagnostic) => `${d.code}|${d.path}|${d.message}`
const errorKeys = (w: WorldState) => new Set(checkWorldIntegrity(w).filter((d) => d.severity === 'ERROR').map(diagKey))

type Unit = { batchId?: Id; commands: DomainCommand[] }

/** batchId ごとに初出位置でまとめる。batchId の無い command は単独の単位。 */
function groupUnits(commands: readonly DomainCommand[]): Unit[] {
  const units: Unit[] = []
  const byBatch = new Map<Id, Unit>()
  for (const c of commands) {
    if (c.batchId === undefined) {
      units.push({ commands: [c] })
      continue
    }
    let u = byBatch.get(c.batchId)
    if (!u) {
      u = { batchId: c.batchId, commands: [] }
      byBatch.set(c.batchId, u)
      units.push(u)
    }
    u.commands.push(c)
  }
  return units
}

const batchFingerprint = (cmds: readonly DomainCommand[]) => canonicalize(cmds.map((c) => c.commandId))

type Committed = Readonly<{ world: WorldState; tx: CommandTransaction; applied: AppliedCommand[] }>
type UnitOutcome =
  | Readonly<{ status: 'APPLIED'; committed: Committed }>
  | Readonly<{ status: 'REJECTED' | 'DUPLICATE' | 'CONFLICT'; rejections: readonly Rejection[] }>

function processUnit(world: WorldState, tx: CommandTransaction, outcome: RuleOutcome, unit: Unit): UnitOutcome {
  const cmds = unit.commands
  const withId = (r: Rejection, c: DomainCommand): Rejection => ({ ...r, commandId: c.commandId })

  // 1) 冪等性: 同 ID・同内容 → DUPLICATE、同 ID・異内容 → CONFLICT。判定状態は枝・年度の Transaction 内。
  const seen = new Set<Id>()
  for (const c of cmds) {
    if (seen.has(c.commandId)) {
      return { status: 'REJECTED', rejections: [withId(fail('DUPLICATE_COMMAND_ID_IN_OUTCOME', `commandId ${c.commandId} が同一バッチ内で重複しています`), c)] }
    }
    seen.add(c.commandId)
  }
  const prints = cmds.map((c) => canonicalize(c))
  const known = cmds.map((c, i) => {
    const prev = tx.commands.get(c.commandId)
    return prev === undefined ? 'NEW' : prev === prints[i] ? 'SAME' : 'DIFFERENT'
  })
  const conflicts = cmds.filter((_, i) => known[i] === 'DIFFERENT')
  if (conflicts.length > 0) {
    return { status: 'CONFLICT', rejections: conflicts.map((c) => withId(fail('COMMAND_ID_CONFLICT', `commandId ${c.commandId} は異なる内容で適用済みです`), c)) }
  }
  if (unit.batchId !== undefined) {
    const prev = tx.batches.get(unit.batchId)
    if (prev !== undefined && prev !== batchFingerprint(cmds)) {
      return { status: 'CONFLICT', rejections: [fail('BATCH_CONFLICT', `batchId ${unit.batchId} は異なる command 構成で適用済みです`)] }
    }
  }
  const sameCount = known.filter((k) => k === 'SAME').length
  if (sameCount === cmds.length) return { status: 'DUPLICATE', rejections: [] }

  // 2) 全件の静的な事前検証（Source / owner / RuleID / Phase / 実装有無）。1 件でも不正なら全件拒否。
  const pre: Rejection[] = []
  for (const c of cmds) {
    const r = checkCommandAuthority(world, outcome, c)
    if (r) pre.push(r)
    else if (!Object.hasOwn(HANDLERS, c.type)) {
      pre.push(withId(fail('UNIMPLEMENTED_COMMAND', `${c.type} は契約だけでは安全に適用できないため未実装です`), c))
    }
  }
  if (pre.length > 0) return { status: 'REJECTED', rejections: pre }

  // 3) 作業コピー上で順に適用（状態依存の検証）。コミットまで入力は不変。
  const draft: Draft = { world, casualties: new Map(tx.casualties), touchedCasualties: new Set() }
  const applied: AppliedCommand[] = []
  for (const c of cmds) {
    const before = draft.world
    const handler = HANDLERS[c.type as Implemented] as Handler<DomainCommand>
    const r = handler(draft, c)
    if (r) return { status: 'REJECTED', rejections: [withId(r, c)] }
    const stateChanges = diffWorld(before, draft.world)
    if (stateChanges.length === 0) {
      return { status: 'REJECTED', rejections: [withId(fail('NO_STATE_CHANGE', `${c.type} は状態を変更しません`), c)] }
    }
    applied.push({ commandId: c.commandId, type: c.type, stateChanges })
  }

  // 4) 損耗の完結性: 台帳 → 人口 → 記名者の死亡が同一バッチで揃うこと。
  for (const id of draft.touchedCasualties) {
    const rec = draft.casualties.get(id)
    if (!rec || rec.populationCount === undefined || rec.deadNamedPersonIds.length !== rec.namedPersonIds.length) {
      return { status: 'REJECTED', rejections: [fail('CASUALTY_INCOMPLETE', `casualty ${id} が台帳・人口・記名者死亡まで同一バッチで完結していません`, [id])] }
    }
  }

  // 5) 既存の WorldState バリデータ（整合性）。バッチが新たに作った ERROR は拒否する。
  const baseline = errorKeys(world)
  const introduced = checkWorldIntegrity(draft.world).filter((d) => d.severity === 'ERROR' && !baseline.has(diagKey(d)))
  if (hasErrors(introduced)) {
    return {
      status: 'REJECTED',
      rejections: [{ ...fail('INTEGRITY_VIOLATION', `適用すると WorldState の整合性が壊れます: ${introduced.map((d) => d.code).join(', ')}`), diagnostics: introduced }],
    }
  }

  // 6) コミット。
  const commands = new Map(tx.commands)
  cmds.forEach((c, i) => commands.set(c.commandId, prints[i] as string))
  const batches = new Map(tx.batches)
  if (unit.batchId !== undefined) batches.set(unit.batchId, batchFingerprint(cmds))
  return {
    status: 'APPLIED',
    committed: { world: draft.world, tx: { ...tx, commands, batches, casualties: draft.casualties }, applied },
  }
}

/**
 * RuleOutcome の commands を WorldState へ適用する。
 * - batchId ごと（無ければ command 単独）に全件事前検証 → 全件コミット。1 件でも不正なら当該バッチは部分適用しない。
 * - requests / traceDrafts は扱わない（件数を `unhandled` で明示）。deferred は未実装として Outcome ごと拒否する。
 */
export function applyOutcome(world: WorldState, outcome: RuleOutcome, context: ApplyContext): ApplyResult {
  const unhandled = { requests: outcome.requests.length, traceDrafts: outcome.traceDrafts.length }
  const rejectAll = (rejections: Rejection[]): ApplyResult => ({
    status: 'REJECTED', world, transaction: context.transaction, units: [], rejections, applied: [], unhandled,
  })

  const tx0 = context.transaction
  if (tx0.year !== world.year) {
    return rejectAll([fail('TRANSACTION_SCOPE_MISMATCH', `Transaction の年 ${tx0.year} が WorldState の年 ${world.year} と異なります`)])
  }
  const header = checkOutcomeHeader(outcome)
  if (header) return rejectAll([header])
  if (outcome.deferred.length > 0) {
    return rejectAll([fail('UNIMPLEMENTED_DEFERRED_EFFECT', 'DeferredEffect の適用は未実装です。Outcome 全体を拒否します')])
  }

  let current = world
  let tx = tx0
  const units: UnitResult[] = []
  const applied: AppliedCommand[] = []
  for (const unit of groupUnits(outcome.commands)) {
    const commandIds = unit.commands.map((c) => c.commandId)
    const base = unit.batchId !== undefined ? { batchId: unit.batchId, commandIds } : { commandIds }
    const r = processUnit(current, tx, outcome, unit)
    if (r.status === 'APPLIED') {
      current = r.committed.world
      tx = r.committed.tx
      applied.push(...r.committed.applied)
      units.push({ ...base, status: 'APPLIED', rejections: [] })
    } else {
      units.push({ ...base, status: r.status, rejections: r.rejections })
    }
  }

  const count = (s: UnitResult['status']) => units.filter((u) => u.status === s).length
  let status: ApplyStatus
  if (units.length === 0) status = 'NO_OP'
  else if (count('APPLIED') === units.length) status = 'APPLIED'
  else if (count('APPLIED') > 0) status = 'PARTIAL'
  else if (count('CONFLICT') > 0) status = 'CONFLICT'
  else if (count('REJECTED') > 0) status = 'REJECTED'
  else status = 'DUPLICATE'

  return { status, world: current, transaction: tx, units, rejections: [], applied, unhandled }
}
