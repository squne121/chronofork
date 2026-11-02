// B-003: 明示した自然死亡候補をC004死亡枠と照合し、共通死亡reducerを呼ぶ技術評価器。
// CALIBRATION_ONLY。死亡年はテスト用の候補証拠であり、自律寿命規則や固定史実イベントではない。
import type { DecisionTraceDraft, Id, PersonDeathCommand, RuleOutcome, WorldState, Year } from '../../contracts/index.ts'
import { GOAL_YEAR, START_YEAR } from '../../contracts/index.ts'
import type { EvaluationContext, RuleEvaluator } from '../../engine/evaluators.ts'
import { EvaluationFailure } from '../../engine/evaluators.ts'

export const B003_RULE_VERSION = 'b003-explicit-mortality-evidence-0:CALIBRATION_ONLY'

export type NaturalDeathEvidence = Readonly<{
  evidenceId: Id
  personId: Id
  deathYear: Year
  provenance: 'CALIBRATION_ONLY'
}>
export type NaturalDeathIssue = Readonly<{ code: string; path: string }>
const validId = (s: unknown): s is string => typeof s === 'string' && s.length > 0
const keyOf = (e: NaturalDeathEvidence): string => JSON.stringify([e.deathYear, e.personId, e.evidenceId])

/** 証拠の再送や候補の並び順によって重複死亡を発生させない。 */
export function createB003CalibrationEvaluator(
  evidence: readonly NaturalDeathEvidence[],
): Readonly<{ ok: true; evaluator: RuleEvaluator }> | Readonly<{ ok: false; issues: readonly NaturalDeathIssue[] }> {
  if (!Array.isArray(evidence)) return { ok: false, issues: [{ code: 'INVALID_EVIDENCE', path: 'evidence' }] }
  const issues: NaturalDeathIssue[] = []
  const seenId = new Set<Id>()
  const seenSlot = new Set<string>()
  evidence.forEach((e, i) => {
    const path = `evidence[${i}]`
    if (!e || !validId(e.evidenceId) || !validId(e.personId) || e.provenance !== 'CALIBRATION_ONLY' ||
        !Number.isSafeInteger(e.deathYear) || e.deathYear < START_YEAR || e.deathYear >= GOAL_YEAR) {
      issues.push({ code: 'INVALID_EVIDENCE', path })
      return
    }
    if (seenId.has(e.evidenceId)) issues.push({ code: 'DUPLICATE_EVIDENCE_ID', path })
    seenId.add(e.evidenceId)
    const slot = JSON.stringify([e.deathYear, e.personId])
    if (seenSlot.has(slot)) issues.push({ code: 'DUPLICATE_PERSON_YEAR', path })
    seenSlot.add(slot)
  })
  if (issues.length > 0) return { ok: false, issues }
  const candidates = (structuredClone(evidence) as NaturalDeathEvidence[])
    .sort((a, b) => keyOf(a) < keyOf(b) ? -1 : keyOf(a) > keyOf(b) ? 1 : 0)

  const evaluator: RuleEvaluator = (world: WorldState, ctx: EvaluationContext): RuleOutcome => {
    if (ctx.ruleId !== 'B-003' || ctx.phase !== 3 || ctx.year !== world.year) {
      throw new EvaluationFailure('B-003のRuleID・フェーズ・年が一致しません', [{ code: 'RULE_MISMATCH', message: 'B-003はフェーズ3で実行' }])
    }
    const traceDrafts: DecisionTraceDraft[] = []
    const commands: PersonDeathCommand[] = []
    const claimed = new Map<Id, number>()
    for (const e of candidates.filter((x) => x.deathYear === ctx.year)) {
      const person = world.persons.find((p) => p.personId === e.personId)
      const groupId = person?.originGroupId
      const slot = world.demographics.cohortSlots.find((s) => s.groupId === groupId && s.year === ctx.year)
      let reason = 'EXPLICIT_MORTALITY_CANDIDATE'
      if (!person) reason = 'PERSON_NOT_FOUND'
      else if (!person.alive) reason = 'PERSON_ALREADY_DEAD'
      else if (person.birthYear > ctx.year) reason = 'PERSON_NOT_YET_BORN'
      else if (!slot) reason = 'NATURAL_DEATH_SLOT_MISSING'
      else if (slot.claimedDeaths + (claimed.get(person.originGroupId) ?? 0) >= slot.deathSlots) reason = 'NATURAL_DEATH_SLOT_EXHAUSTED'
      const eligible = reason === 'EXPLICIT_MORTALITY_CANDIDATE'
      const index = traceDrafts.length
      traceDrafts.push({
        year: ctx.year, phase: ctx.phase, ruleId: ctx.ruleId,
        actorRef: { kind: 'PERSON', id: e.personId },
        candidates: [{
          candidateId: 'b003:' + keyOf(e), eligible,
          inputs: { personId: e.personId, evidenceId: e.evidenceId, deathYear: e.deathYear,
            cause: 'NATURAL', groupId: groupId ?? null, provenance: 'CALIBRATION_ONLY' },
          reasonCodes: ['CALIBRATION_ONLY', reason],
        }],
        ...(eligible ? { selectedCandidateId: 'b003:' + keyOf(e) } : {}),
        status: eligible ? 'ACCEPT' : 'DEFER',
        reasonCodes: ['CALIBRATION_ONLY', reason],
        modifierIds: [],
        ruleVersion: B003_RULE_VERSION,
      })
      if (!eligible || !person) continue
      claimed.set(person.originGroupId, (claimed.get(person.originGroupId) ?? 0) + 1)
      commands.push({
        type: 'PERSON_DEATH', commandId: 'cmd:b003:' + keyOf(e),
        source: { requestId: 'req:b003:' + keyOf(e), year: ctx.year, phase: ctx.phase,
          sourceRuleId: 'B-003', sourceTraceId: ctx.traceId(index), sourceIntentId: e.evidenceId },
        personId: e.personId, deathYear: ctx.year, cause: 'NATURAL',
      })
    }
    return { ruleId: ctx.ruleId, phase: ctx.phase, commands, requests: [], deferred: [], traceDrafts }
  }
  return { ok: true, evaluator }
}
