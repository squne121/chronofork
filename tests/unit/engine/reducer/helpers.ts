import { createExperimentalWorld } from '../../../../src/scenario/experimental/index.ts'
import type {
  DomainCommand,
  Person,
  Phase,
  RuleId,
  RuleOutcome,
  Source,
  WorldState,
} from '../../../../src/simulation/contracts/index.ts'
import { applyOutcome, createTransaction } from '../../../../src/simulation/engine/reducer/index.ts'
import type { ApplyResult, CommandTransaction } from '../../../../src/simulation/engine/reducer/index.ts'

export const YEAR = 1250

export const newWorld = (): WorldState => createExperimentalWorld()
export const newTx = (branchId = 'main', year = YEAR): CommandTransaction => createTransaction({ branchId, year })

export const source = (ruleId: RuleId, phase: Phase, tag = 'x', year = YEAR): Source => ({
  requestId: `req-${tag}`,
  year,
  phase,
  sourceRuleId: ruleId,
  sourceTraceId: `trace-${tag}`,
})

export const outcome = (
  ruleId: RuleId,
  phase: Phase,
  commands: readonly DomainCommand[],
  extra: Partial<RuleOutcome> = {},
): RuleOutcome => ({ ruleId, phase, commands, requests: [], deferred: [], traceDrafts: [], ...extra })

/** 1 回適用して、次に渡す world / transaction を返す。 */
export function run(world: WorldState, o: RuleOutcome, tx: CommandTransaction = newTx()): ApplyResult {
  return applyOutcome(world, o, { transaction: tx })
}

/** 連鎖適用。途中で APPLIED 以外なら失敗させる。 */
export function chain(
  steps: readonly RuleOutcome[],
  start: WorldState = newWorld(),
  tx: CommandTransaction = newTx(),
): { world: WorldState; tx: CommandTransaction; results: ApplyResult[] } {
  let world = start
  let t = tx
  const results: ApplyResult[] = []
  for (const s of steps) {
    const r = run(world, s, t)
    if (r.status !== 'APPLIED') throw new Error(`chain step failed: ${JSON.stringify(r.units.map((u) => u.rejections))} ${JSON.stringify(r.rejections)}`)
    world = r.world
    t = r.transaction
    results.push(r)
  }
  return { world, tx: t, results }
}

export const cohort = (groupId: string, births: number, deaths: number, id = `cohort-${groupId}`): DomainCommand => ({
  type: 'POPULATION_COHORT', commandId: id, source: source('RULE-C-004', 1, id), groupId, year: YEAR, birthSlots: births, deathSlots: deaths,
})

export const cohortOutcome = (groupId: string, births: number, deaths: number): RuleOutcome =>
  outcome('RULE-C-004', 1, [cohort(groupId, births, deaths)])

export const baby = (personId: string, groupId = 'group-central-elite', overrides: Partial<Person> = {}): Person => ({
  personId,
  name: `試験児 ${personId}`,
  sex: 'FEMALE',
  birthYear: YEAR,
  alive: true,
  originGroupId: groupId,
  houseId: 'house-nalven',
  fatherId: 'person-exp-02',
  motherId: 'person-exp-03',
  legalDynasty: { status: 'UNDETERMINED', reasonCodes: ['AWAITING_A'] },
  ...overrides,
})

export const birth = (person: Person, id = `birth-${person.personId}`): DomainCommand => ({
  type: 'PERSON_BIRTH', commandId: id, source: source('B-002', 3, id), person, cohortGroupId: person.originGroupId, cohortYear: YEAR,
})

export const natural = (personId: string, id = `death-${personId}`): DomainCommand => ({
  type: 'PERSON_DEATH', commandId: id, source: source('B-003', 3, id), personId, deathYear: YEAR, cause: 'NATURAL',
})

export const ledger = (
  accountId: string,
  operation: 'CREDIT' | 'DEBIT' | 'COMMIT' | 'RELEASE' | 'CASUALTY',
  amount: number,
  id: string,
  extra: { casualtyId?: string; batchId?: string; ruleId?: RuleId; phase?: Phase } = {},
): DomainCommand => {
  const cash = operation === 'CREDIT' || operation === 'DEBIT'
  const ruleId = extra.ruleId ?? (cash ? 'RULE-C-005' : 'D-REB-001')
  const phase = extra.phase ?? (cash ? 1 : 5)
  return {
    type: 'RESOURCE_TRANSACTION', commandId: id, source: source(ruleId, phase, id), accountId, operation, amount,
    ...(extra.casualtyId !== undefined ? { casualtyId: extra.casualtyId } : {}),
    ...(extra.batchId !== undefined ? { batchId: extra.batchId } : {}),
  }
}

export const CASH = 'acct-cash-eldia'
export const FORCE = 'acct-force-group-west-commons'
export const FORCE_GROUP = 'group-west-commons'

export const rejectionCodes = (r: ApplyResult): string[] => [
  ...r.rejections.map((x) => x.code),
  ...r.units.flatMap((u) => u.rejections.map((x) => x.code)),
]
