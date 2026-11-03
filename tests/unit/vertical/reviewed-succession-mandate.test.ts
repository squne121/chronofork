import { describe, expect, it } from 'vitest'
import { createExperimentalWorld, createExperimentalLegalEvidence, NALVEN_DYNASTY_ID } from '../../../src/scenario/experimental/index.ts'
import type { LegalEvidenceBook } from '../../../src/simulation/legal/evidence.ts'
import type { WorldState } from '../../../src/simulation/contracts/index.ts'
import { runYear } from '../../../src/simulation/engine/index.ts'
import { evaluateGoal } from '../../../src/simulation/goal.ts'
import { createReviewedLegalEvaluators, reviewLandHeir } from '../../../src/simulation/rules/a/index.ts'
import type { ReviewedLegalInput, SuccessionReviewEvidence, DelegationAuthorityEvidence, DelegationDecisionEvidence } from '../../../src/simulation/rules/a/index.ts'

const TITLE_ID = 'title-exp-central'
const P1 = 'person-exp-01'
const P2 = 'person-exp-02'
const P3 = 'person-exp-03'
const controller = { kind: 'COUNTRY' as const, id: 'country-eldia' }
const CASE_ID = 'case:asuc04:auto:' + JSON.stringify([1285, TITLE_ID])
const AUTH = 'synthetic-eldia-normal-succession-right'
const DECISION: SuccessionReviewEvidence = {
  decisionId: 'synthetic-succession-p2', titleId: TITLE_ID,
  predecessorPersonId: P1, successorPersonId: P2,
  grantBasisId: 'exp-basis-central', issuerRef: controller, authorityBasisId: AUTH,
  availableFromYear: 1287, provenance: 'CALIBRATION_ONLY',
}
const DELEGATION_RIGHT: DelegationAuthorityEvidence = {
  authorizationId: 'synthetic-eldia-new-control-right', titleId: TITLE_ID,
  regionId: 'region-eldia-central', grantBasisId: 'exp-basis-central',
  issuerRef: controller, sovereignCountryId: 'country-eldia',
  sourceLawOrGrantId: 'exp-basis-central', provenance: 'CALIBRATION_ONLY',
}
const DELEGATION: DelegationDecisionEvidence = {
  decisionId: 'synthetic-new-control-to-p2', authorizationId: DELEGATION_RIGHT.authorizationId,
  titleId: TITLE_ID, regionId: 'region-eldia-central', beneficiaryPersonId: P2,
  issuerRef: controller, availableFromYear: 1287, endExclusiveYear: 1351,
  provenance: 'CALIBRATION_ONLY',
}
const TEST_BOOK = (): LegalEvidenceBook => ({
  ...createExperimentalLegalEvidence(),
  approvalAuthorities: [{
    authorityBasisId: AUTH, action: 'NORMAL_LAND_SUCCESSION', holderRef: controller,
    sovereignCountryId: 'country-eldia', provenance: 'CALIBRATION_ONLY',
  }],
})

const pendingWorld = (): WorldState => {
  const w = createExperimentalWorld()
  return {
    ...w, year: 1286,
    persons: w.persons.map(p => p.personId === P1
      ? { ...p, alive: false, deathYear: 1285 } : p),
    titles: w.titles.map(t => t.titleId === TITLE_ID
      ? { ...t, holder: { status: 'UNDETERMINED' as const } } : t),
    legal: {
      ...w.legal,
      cases: [{
        caseId: CASE_ID, kind: 'SUCCESSION' as const, titleId: TITLE_ID,
        status: 'PENDING' as const, candidatePersonIds: [P2, P3],
        reasonCodes: ['CALIBRATION_ONLY','PREDECESSOR_ID:' + P1,
          'SOURCE_B003_EVENT:synthetic-death-1285'],
      }],
    },
  }
}

function year(w: WorldState, opt: Partial<ReviewedLegalInput> = {}) {
  const reviewed = createReviewedLegalEvaluators({
    book: opt.book ?? TEST_BOOK(),
    successionDecisions: opt.successionDecisions ?? [DECISION],
    delegationAuthorities: opt.delegationAuthorities ?? [DELEGATION_RIGHT],
    delegationDecisions: opt.delegationDecisions ?? [DELEGATION],
  })
  if (!reviewed.ok) throw new Error(reviewed.issues.join(','))
  return runYear(w, { seed: 1, branchId: 'A0', evaluators: reviewed.evaluators })
}
const nextWorld = (r: ReturnType<typeof runYear>): WorldState => {
  if (r.status !== 'COMPLETED') throw new Error('HALTED ' + JSON.stringify(r.halt))
  return r.world
}

describe('DEC-055 / G-03/04: 明示権限に限る通常相続・後年再審査・新委任', () => {
  it('直接子の男子長子を優先し、合法王朝未確定なら機械確定しない', () => {
    const w = pendingWorld()
    expect(reviewLandHeir(w, P1)).toMatchObject({ status: 'READY', personId: P2, relation: 'DESCENDANT' })
    const noLegal: WorldState = {
      ...w, persons: w.persons.map(p => p.personId === P2
        ? { ...p, legalDynasty: { status: 'UNDETERMINED' as const, reasonCodes: ['TEST'] } } : p),
    }
    expect(reviewLandHeir(noLegal, P1)).toMatchObject({
      status: 'PENDING', reasonCodes: ['LEGAL_DYNASTY_UNDETERMINED'],
    })
  })

  it('年長男子枝の代襲を次位より先に調べ、娘・傍系も除外しない', () => {
    const w = pendingWorld()
    const p2 = w.persons.find(p => p.personId === P2)!
    const grandchild = {
      ...p2, personId: 'synthetic-grandson', fatherId: P2, motherId: undefined,
      birthYear: 1260, alive: true,
    }
    const withGrand: WorldState = {
      ...w, persons: [...w.persons.map(p => p.personId === P2
        ? { ...p, alive: false, deathYear: 1270 } : p), grandchild],
    }
    expect(reviewLandHeir(withGrand, P1)).toMatchObject({
      status: 'READY', personId: grandchild.personId, relation: 'DESCENDANT',
    })
    const noSon: WorldState = { ...w, persons: w.persons.map(p => p.personId === P2
      ? { ...p, alive: false, deathYear: 1270 } : p) }
    expect(reviewLandHeir(noSon, P1)).toMatchObject({ status: 'READY', personId: P3 })
    expect(reviewLandHeir(noSon, P2)).toMatchObject({
      status: 'READY', personId: P3, relation: 'COLLATERAL',
    })
  })

  it('同じ順位の生年不明（同年）の候補はID順で勝者を捏造しない', () => {
    const w = pendingWorld()
    const d = w.persons.find(p => p.personId === P3)!
    const twin = { ...d, personId: 'synthetic-second-daughter', name: '試験用同年娘' }
    const contested: WorldState = {
      ...w, persons: [...w.persons.map(p => p.personId === P2
        ? { ...p, alive: false, deathYear: 1270 } : p), twin],
    }
    expect(reviewLandHeir(contested, P1)).toMatchObject({
      status: 'PENDING', reasonCodes: ['SAME_PRIORITY_BIRTH_YEAR'],
    })
  })

  it('権限のない死亡後のPENDINGは翌年以降も保留、Titleと委任を改変しない', () => {
    const w = pendingWorld()
    const r = year(w, { book: createExperimentalLegalEvidence() })
    const after = nextWorld(r)
    expect(after.legal.cases[0]?.status).toBe('PENDING')
    expect(after.titles.find(t => t.titleId === TITLE_ID)?.holder.status).toBe('UNDETERMINED')
    expect(after.legal.controlMandates).toEqual(w.legal.controlMandates)
    expect(r.status).toBe('COMPLETED')
    if (r.status === 'COMPLETED') {
      expect(r.events.filter(e => e.eventType.includes('LEGAL_TITLE_TRANSFER'))).toHaveLength(0)
      expect(r.traces.some(t => t.ruleId === 'A-SUC-04' && t.status === 'DEFER')).toBe(true)
    }
  })

  it('1286年は保留、1287年に明示承認と明示新委任を確認してTitleとControlMandateを確定する', () => {
    const initial = pendingWorld()
    const first = year(initial)
    const intermediate = nextWorld(first)
    expect(intermediate.legal.cases[0]?.status).toBe('PENDING')
    const second = year(intermediate)
    const after = nextWorld(second)
    const title = after.titles.find(t => t.titleId === TITLE_ID)!
    expect(title.holder).toEqual({ status: 'HELD', personId: P2 })
    expect(after.legal.cases[0]).toMatchObject({
      caseId: CASE_ID, status: 'APPROVED', candidatePersonIds: [P2],
    })
    const mandates = after.legal.controlMandates.filter(m => m.authorizingTitleId === TITLE_ID)
    expect(mandates).toHaveLength(1)
    expect(mandates[0]).toMatchObject({
      beneficiaryPersonId: P2, controllerRef: controller,
      effectiveFromYear: 1287, endExclusiveYear: 1351,
    })
    expect(after.regions).toEqual(initial.regions)
    expect(after.legal.taxMandates).toEqual(initial.legal.taxMandates)
    expect(initial.legal.cases[0]?.status).toBe('PENDING')
    expect(initial.titles.find(t=>t.titleId===TITLE_ID)?.holder.status).toBe('UNDETERMINED')
    if (second.status === 'COMPLETED') {
      const transfer = second.events.find(e => e.eventType === 'LEGAL_TITLE_TRANSFER')!
      const mandateEvent = second.events.find(e => e.eventType === 'CONTROL_MANDATE_SET')!
      expect(transfer).toBeDefined()
      expect(mandateEvent).toBeDefined()
      expect(mandates[0]?.sourceEventId).toBe(transfer.eventId)
      expect(second.traces.some(t => t.ruleId === 'A-TIT-07' && t.eventIds.includes(transfer.eventId))).toBe(true)
      expect(second.traces.some(t => t.ruleId === 'A-TIT-07' && t.eventIds.includes(mandateEvent.eventId))).toBe(true)
    }
    expect(year(intermediate)).toEqual(second) // 同条件の再計算完全一致
    const at1350: WorldState = { ...after, year: 1350 }
    const goal = evaluateGoal(at1350, { dynastyId: NALVEN_DYNASTY_ID })
    expect(goal.status).toBe('ACHIEVED') // 技術試験であり正式なgoal公開ではない
  })

  it('新委任の権限記録がない場合は、Titleのみ移転しControlMandateを自動発行しない', () => {
    const w1287: WorldState = { ...pendingWorld(), year: 1287 }
    const r = year(w1287, { delegationAuthorities: [], delegationDecisions: [] })
    const after = nextWorld(r)
    expect(after.titles.find(t => t.titleId === TITLE_ID)?.holder).toEqual({ status: 'HELD', personId: P2 })
    expect(after.legal.controlMandates).toHaveLength(0)
    expect(after.regions).toEqual(w1287.regions)
  })

  it('相続の明示決定が順位と食い違う場合はPENDINGのまま', () => {
    const w: WorldState = { ...pendingWorld(), year: 1287 }
    const bad: SuccessionReviewEvidence = { ...DECISION, successorPersonId: P3 }
    const after = nextWorld(year(w, { successionDecisions: [bad] }))
    expect(after.legal.cases[0]?.status).toBe('PENDING')
    expect(after.titles.find(t => t.titleId === TITLE_ID)?.holder.status).toBe('UNDETERMINED')
  })

  it('同一決定IDの重複証拠を入口で拒否', () => {
    const res = createReviewedLegalEvaluators({
      book: TEST_BOOK(), successionDecisions: [DECISION, DECISION],
    })
    expect(res.ok).toBe(false)
  })
})
