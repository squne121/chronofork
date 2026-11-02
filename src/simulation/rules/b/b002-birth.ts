// B-002: 明示した出生候補を、既存婚姻とC-004出生枠が揃う場合だけ実Personへ登録する。
// CALIBRATION_ONLYの技術縦断。人物の出生率・妊娠・親子関係を自律生成する正式ルールではない。
// Person.birth は人口に加算しない。出生時の法的王朝は常にUNDETERMINED（GAME-01）。
import type { DecisionTraceDraft, Id, PersonBirthCommand, RuleOutcome, WorldState, Year } from '../../contracts/index.ts'
import { GOAL_YEAR, START_YEAR } from '../../contracts/index.ts'
import type { EvaluationContext, RuleEvaluator } from '../../engine/evaluators.ts'
import { EvaluationFailure } from '../../engine/evaluators.ts'
import { normalizePersonPair } from '../../intervention/index.ts'

export const B002_RULE_VERSION = 'b002-explicit-birth-candidate-0:CALIBRATION_ONLY'

/** 出生候補の試験用明示証拠。証拠が無い年は出生させない。法的王朝・血統を暗黙に決めない。 */
export type BirthCandidateEvidence = Readonly<{
  evidenceId: Id
  candidateId: Id
  birthYear: Year
  fatherId: Id
  motherId: Id
  childName: string
  childSex: 'MALE' | 'FEMALE'
  cohortGroupId: Id
  houseId: Id
  provenance: 'CALIBRATION_ONLY'
}>
export type BirthCandidateIssue = Readonly<{ code: string; path: string }>

const nonempty = (x: unknown): x is string => typeof x === 'string' && x.length > 0
const childIdOf = (r: BirthCandidateEvidence): Id =>
  'person:b002:' + JSON.stringify([r.birthYear, r.fatherId, r.motherId, r.candidateId, r.evidenceId])
const sortKey = (r: BirthCandidateEvidence) => JSON.stringify([r.birthYear, r.candidateId, r.evidenceId])
const birthTraceCandidateId = (r: BirthCandidateEvidence) => 'b002:' + sortKey(r)

/** 不正・重複した候補を評価器生成前に拒否し、順序による選択差を防ぐ。 */
export function createB002CalibrationEvaluator(
  input: readonly BirthCandidateEvidence[],
): Readonly<{ ok: true; evaluator: RuleEvaluator }> | Readonly<{ ok: false; issues: readonly BirthCandidateIssue[] }> {
  if (!Array.isArray(input)) return { ok: false, issues: [{ code: 'INVALID_CANDIDATES', path: 'input' }] }
  const issues: BirthCandidateIssue[] = []
  const ids = new Set<Id>()
  const candidateSlots = new Set<string>()
  const childIds = new Set<Id>()
  input.forEach((r, i) => {
    const path = `input[${i}]`
    if (!r || !nonempty(r.evidenceId) || !nonempty(r.candidateId) || !nonempty(r.childName) ||
        !nonempty(r.fatherId) || !nonempty(r.motherId) || !nonempty(r.cohortGroupId) || !nonempty(r.houseId)) {
      issues.push({ code: 'INVALID_CANDIDATE', path })
      return
    }
    if (r.fatherId === r.motherId) issues.push({ code: 'SAME_PARENT', path })
    if (!Number.isSafeInteger(r.birthYear) || r.birthYear < START_YEAR || r.birthYear >= GOAL_YEAR) issues.push({ code: 'INVALID_BIRTH_YEAR', path })
    if (r.provenance !== 'CALIBRATION_ONLY' || (r.childSex !== 'MALE' && r.childSex !== 'FEMALE')) issues.push({ code: 'INVALID_EVIDENCE', path })
    if (ids.has(r.evidenceId)) issues.push({ code: 'DUPLICATE_EVIDENCE', path })
    ids.add(r.evidenceId)
    const slot = JSON.stringify([r.birthYear, r.candidateId])
    if (candidateSlots.has(slot)) issues.push({ code: 'DUPLICATE_CANDIDATE', path })
    candidateSlots.add(slot)
    const child = childIdOf(r)
    if (childIds.has(child)) issues.push({ code: 'DUPLICATE_CHILD_ID', path })
    childIds.add(child)
  })
  if (issues.length > 0) return { ok: false, issues }
  const candidates = (structuredClone(input) as BirthCandidateEvidence[])
    .sort((a, b) => sortKey(a) < sortKey(b) ? -1 : sortKey(a) > sortKey(b) ? 1 : 0)

  const evaluator: RuleEvaluator = (world: WorldState, ctx: EvaluationContext): RuleOutcome => {
    if (ctx.ruleId !== 'B-002' || ctx.phase !== 3 || ctx.year !== world.year) {
      throw new EvaluationFailure('B-002のRuleID・フェーズ・年が不一致です', [{ code: 'RULE_MISMATCH', message: 'B-002はフェーズ3で実行' }])
    }
    const traceDrafts: DecisionTraceDraft[] = []
    const commands: PersonBirthCommand[] = []
    const claimed = new Map<Id, number>()
    for (const r of candidates.filter((x) => x.birthYear === ctx.year)) {
      const pair = normalizePersonPair(r.fatherId, r.motherId)
      const father = world.persons.find((p) => p.personId === r.fatherId)
      const mother = world.persons.find((p) => p.personId === r.motherId)
      const childId = childIdOf(r)
      const marriage = world.legal.marriages.find((m) =>
        m.status === 'ACTIVE' && pair !== null && m.personIds[0] === pair[0] && m.personIds[1] === pair[1] &&
        m.registeredYear <= ctx.year)
      const cohort = world.demographics.cohortSlots.find((s) => s.groupId === r.cohortGroupId && s.year === ctx.year)
      let reason = 'EXPLICIT_BIRTH_CANDIDATE_CONFIRMED'
      if (!father || !mother || !father.alive || !mother.alive) reason = 'PARENTS_UNAVAILABLE'
      else if (father.sex !== 'MALE' || mother.sex !== 'FEMALE') reason = 'PARENT_ROLE_MISMATCH'
      else if (father.birthYear >= ctx.year || mother.birthYear >= ctx.year) reason = 'PARENT_YEAR_INVALID'
      else if (!marriage) reason = 'ACTIVE_MARRIAGE_REQUIRED'
      else if (!world.houses.some((h) => h.houseId === r.houseId) || (r.houseId !== father.houseId && r.houseId !== mother.houseId)) reason = 'HOUSE_EVIDENCE_MISSING'
      else if (r.cohortGroupId !== mother.originGroupId) reason = 'ORIGIN_GROUP_EVIDENCE_MISSING'
      else if (!cohort) reason = 'COHORT_SLOT_UNAVAILABLE'
      else if (cohort.claimedBirths + (claimed.get(r.cohortGroupId) ?? 0) >= cohort.birthSlots) reason = 'COHORT_SLOT_EXHAUSTED'
      else if (world.persons.some((p) => p.personId === childId)) reason = 'CHILD_ID_EXISTS'

      const accepted = reason === 'EXPLICIT_BIRTH_CANDIDATE_CONFIRMED'
      const index = traceDrafts.length
      traceDrafts.push({
        year: ctx.year, phase: ctx.phase, ruleId: ctx.ruleId,
        actorRef: { kind: 'PERSON', id: childId },
        candidates: [{
          candidateId: birthTraceCandidateId(r), eligible: accepted,
          inputs: { evidenceId: r.evidenceId, childPersonId: childId, fatherId: r.fatherId, motherId: r.motherId,
            cohortGroupId: r.cohortGroupId, houseId: r.houseId, marriageId: marriage?.marriageId ?? null,
            birthYear: r.birthYear, provenance: 'CALIBRATION_ONLY' },
          reasonCodes: ['CALIBRATION_ONLY', reason],
        }],
        ...(accepted ? { selectedCandidateId: birthTraceCandidateId(r) } : {}),
        status: accepted ? 'ACCEPT' : 'DEFER',
        reasonCodes: ['CALIBRATION_ONLY', reason],
        modifierIds: [], ruleVersion: B002_RULE_VERSION,
      })
      if (!accepted) continue
      claimed.set(r.cohortGroupId, (claimed.get(r.cohortGroupId) ?? 0) + 1)
      commands.push({
        type: 'PERSON_BIRTH',
        commandId: 'cmd:b002:' + sortKey(r),
        source: {
          requestId: 'req:b002:' + sortKey(r), year: ctx.year, phase: ctx.phase,
          sourceRuleId: 'B-002', sourceTraceId: ctx.traceId(index), sourceIntentId: r.evidenceId,
        },
        cohortGroupId: r.cohortGroupId, cohortYear: ctx.year,
        person: {
          personId: childId, name: r.childName, sex: r.childSex, birthYear: ctx.year,
          alive: true, originGroupId: r.cohortGroupId, houseId: r.houseId,
          fatherId: r.fatherId, motherId: r.motherId,
          legalDynasty: { status: 'UNDETERMINED', reasonCodes: ['GAME_01_NO_DEFAULT_DYNASTY', 'A_DYN_02_PENDING'] },
        },
      })
    }
    return { ruleId: ctx.ruleId, phase: ctx.phase, commands, requests: [], deferred: [], traceDrafts }
  }
  return { ok: true, evaluator }
}
