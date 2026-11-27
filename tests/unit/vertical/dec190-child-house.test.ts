// DEC-190 / Issue #206: 出生時の家門所属（父方原則・明示的な母方例外）を法的王朝・出身人口集団と分離して検証する。
// 実runYearのB-004→B-005→A-LEG-01→B-002→A-DYN-02経路を使い、婚姻・出生の手動注入だけで完了扱いしない。
import { describe, expect, it } from 'vitest'
import { createExperimentalWorld, createExperimentalOrdinaryLegalTrial, NALVEN_DYNASTY_ID } from '../../../src/scenario/experimental/index.ts'
import * as experimental from '../../../src/scenario/experimental/index.ts'
import { createAutonomousCalibrationEvaluators } from '../../../src/simulation/autonomy/index.ts'
import type { AutonomyCalibration } from '../../../src/simulation/autonomy/index.ts'
import type {
  ChildHouseAffiliationClause, ChildHouseAgreementRecord, DecisionTrace, Marriage, MarriageContract, NextgenContractChildHouse,
  NextgenContractIdentity, NextgenContractSelection, WorldState,
} from '../../../src/simulation/contracts/index.ts'
import { NEXTGEN_CONTRACT_SELECTION_VERSION } from '../../../src/simulation/contracts/index.ts'
import { runYear } from '../../../src/simulation/engine/index.ts'
import type { EvaluatorMap } from '../../../src/simulation/engine/index.ts'
import { childHouseAgreementIssue, childHouseClauseIssue, childHouseGovernedByContract, childHouseRegistrationIssue, resolveChildHouseAffiliation }
  from '../../../src/simulation/legal/child-house.ts'
import {
  nextgenContractIdentityKey, nextgenContractKey, nextgenMarriageContract, nextgenSelectionContract, nextgenSelectionRecordKey,
  parseNextgenContractIdentityKey, sameNextgenContractIdentity,
} from '../../../src/simulation/legal/nextgen-contract-ids.ts'
import type { ChildHouseContractCalibration, NextgenContractCalibration } from '../../../src/simulation/legal/nextgen-contract.ts'
import { EXPERIMENTAL_NEXTGEN_CONTRACT, validateNextgenContractCalibration } from '../../../src/simulation/legal/nextgen-contract.ts'
import { reviewDomesticMarriageEligibility } from '../../../src/simulation/legal/nextgen-marriage.ts'
import { reviewAncestralHeir } from '../../../src/simulation/rules/a/legal-heirs.ts'
import { ANCESTRAL_HEIR_SEARCH_VERSION } from '../../../src/simulation/rules/a/legal-heirs.ts'
import { B002_AUTONOMOUS_VERSION, B002_PATERNAL_HOUSE_VERSION, B005_CHILD_HOUSE_VERSION } from '../../../src/simulation/rules/b/index.ts'
import { validateWorldState } from '../../../src/simulation/validation/index.ts'
import { baby, birth, newWorld, outcome, rejectionCodes, run } from '../engine/reducer/helpers.ts'

const P1 = 'person-exp-01', P2 = 'person-exp-02', P3 = 'person-exp-03', P4 = 'person-exp-04', P5 = 'person-exp-05'
const NALVEN = 'house-nalven', CARDON = 'house-cardon', VARGAS = 'house-vargas'
const PAT = (houseId = NALVEN): NextgenContractChildHouse => ({ basis: 'PATERNAL_DEFAULT', houseId })
const MAT = (houseId = CARDON, sourcePersonId = P5): NextgenContractChildHouse => ({ basis: 'MATERNAL_CONTRACT_CLAUSE', houseId, sourcePersonId })
/** v4契約案の正規キー（構造化同一性の符号化）。 */
const K = (dynastyId: string | null, childHouse: NextgenContractChildHouse) => nextgenContractIdentityKey({ dynastyId, childHouse })
const trial = createExperimentalOrdinaryLegalTrial()
// 王朝条項の係数は既存DEC-058試験と同じ。家門係数は別オブジェクトで明示する（いずれもCALIBRATION_ONLY）。
const DYNASTY: NextgenContractCalibration = {
  ...EXPERIMENTAL_NEXTGEN_CONTRACT, ownDynastyBonus: 2, otherDynastyCost: 0, titleWeight: 4, noClauseCost: 5, supportWeight: 0,
}
const house = (x: Partial<ChildHouseContractCalibration>): ChildHouseContractCalibration => ({
  status: 'CALIBRATION_ONLY', version: 'test-child-house-calibration',
  ownHouseBonus: 0, otherHouseCost: 0, exceptionCost: 0, titleWeight: 0, supportWeight: 0, ...x,
})
/** 多家門v4構成と同じ家門係数。 */
const V4_HOUSE = experimental.MULTI_HOUSE_CHILD_HOUSE_CONTRACT
// 母方例外が成立し得る最小の試験値: 母が自家門をやや重視し、王朝条項の対価として家門を譲る構図（固定成功ではない）。
const TRADE_DYNASTY: NextgenContractCalibration = { ...DYNASTY, otherDynastyCost: 4 }
const TRADE_HOUSE = house({ ownHouseBonus: 3 })
const AUTO: AutonomyCalibration = {
  status: 'CALIBRATION_ONLY',
  birth: { minMotherAge: 18, maxMotherAge: 32, minFatherAge: 18, chancePermille: 1000 },
  death: { minAge: 60, riskStartAge: 59, basePermille: 0, increasePerYearPermille: 1000, maxPermille: 1000 },
  marriage: { minAdultAge: 18, maxCandidatePairs: 500 },
}

const evaluatorsFor = (world: WorldState, pairs: readonly (readonly [string, string])[], cal: NextgenContractCalibration,
  book = trial.book): EvaluatorMap => {
  const r = createAutonomousCalibrationEvaluators({
    branchStartWorld: world, ledger: [], trustBase: pairs.map(ids => ({ personIds: ids, value: 40 })),
    nextgenMarriage: { book, laws: trial.laws, calibration: cal }, autonomy: AUTO,
    ...(cal.childHouse ? { childHouseAffiliation: 'DEC190_PATERNAL_PRINCIPLE' as const } : {}),
  })
  if (!r.ok) throw new Error(r.issues.join('; '))
  return r.evaluators
}
type YearResult = ReturnType<typeof runYear>
const step = (world: WorldState, pairs: readonly (readonly [string, string])[], cal: NextgenContractCalibration,
  evaluators = evaluatorsFor(world, pairs, cal)): YearResult => runYear(world, { seed: 20260101, branchId: 'A0', evaluators })
const done = (r: YearResult) => {
  if (r.status !== 'COMPLETED') throw new Error(JSON.stringify(r.halt))
  return r
}
const childOf = (w: WorldState, f: string, m: string) => w.persons.filter(p => p.fatherId === f && p.motherId === m)
/** 出生Eventの実状態差分から、出生枠を請求した集団を数える（年末世界は当年枠を保持しない）。 */
const claimedSlotGroups = (r: YearResult) => done(r).events.filter(e => e.eventType === 'PERSON_BIRTH')
  .flatMap(e => e.stateChanges.map(c => /^\$\.demographics\.cohortSlots\[(.+)@\d+\]\.claimedBirths$/.exec(c.path)?.[1]).filter(Boolean))
const b005 = (r: YearResult, pair: readonly [string, string] = [P2, P5]) => done(r).traces.find(t => t.ruleId === 'B-005' &&
  t.actorRef.kind === 'PERSON_PAIR' && t.actorRef.ids.join() === [...pair].sort().join())!
const b002 = (r: YearResult) => done(r).traces.filter(t => t.ruleId === 'B-002')
/** 1250婚姻→1251出生を通常の年次経路で計算。 */
function marryThenBirth(cal: NextgenContractCalibration, pair: readonly [string, string] = [P2, P5], start = createExperimentalWorld()) {
  const marriageYear = done(step(start, [pair], cal))
  const birthYear = done(step(marriageYear.world, [pair], cal))
  return { marriageYear, birthYear }
}

describe('DEC-190 出生時の家門: 実年次経路（B004→B005→A-LEG-01→B002→A-DYN-02）', () => {
  it('家門条項なし: 父方家門・母側出身集団の出生枠・王朝条項は独立に適用される', () => {
    const { marriageYear, birthYear } = marryThenBirth({ ...DYNASTY, childHouse: V4_HOUSE })
    const marriage = marriageYear.world.legal.marriages[0]!
    expect(marriage.contract?.clauses.map(c => c.kind)).toEqual(['CHILD_LEGAL_DYNASTY'])
    // v4の父方案にも、条項から独立した版付き選択記録を保存する。
    expect(marriage.contract?.selection).toMatchObject({ version: NEXTGEN_CONTRACT_SELECTION_VERSION,
      identity: { dynastyId: NALVEN_DYNASTY_ID, childHouse: PAT() }, agreement: { registeredYear: 1250, personIds: [P2, P5] } })
    const trace = b005(marriageYear)
    expect(trace.ruleVersion).toBe(B005_CHILD_HOUSE_VERSION)
    expect(trace.candidates[0]!.inputs.selectedContractKey).toBe(K(NALVEN_DYNASTY_ID, PAT()))
    expect(trace.candidates[0]!.inputs.selectedChildHouse).toEqual(PAT())
    expect(trace.candidates[0]!.inputs.selectedContractIdentity).toEqual({ dynastyId: NALVEN_DYNASTY_ID, childHouse: PAT() })
    // 母方案も評価されたが、双方の利害から一意の最大相互利益にならなかったことを記録する。
    const options = trace.candidates[0]!.inputs.contractOptions as { key: string; childHouse: { basis: string } }[]
    expect(options.filter(o => o.childHouse.basis === 'MATERNAL_CONTRACT_CLAUSE').map(o => o.key))
      .toContain(K(NALVEN_DYNASTY_ID, MAT()))
    const [child] = childOf(birthYear.world, P2, P5)
    expect(child).toMatchObject({ houseId: NALVEN, originGroupId: 'group-east-elite', birthYear: 1251,
      legalDynasty: { status: 'DETERMINED', dynastyId: NALVEN_DYNASTY_ID } })
    // 出生枠は母の出身集団だけで1件消費。父の集団・人口の二重計上はない。
    expect(claimedSlotGroups(birthYear)).toEqual(['group-east-elite'])
    const birthTrace = b002(birthYear).find(t => t.status === 'ACCEPT')!
    expect(birthTrace.ruleVersion).toBe(B002_PATERNAL_HOUSE_VERSION)
    expect(birthTrace.candidates[0]!.inputs).toMatchObject({ houseId: NALVEN, paternalHouseId: NALVEN, maternalHouseId: CARDON,
      childHouseBasis: 'PATERNAL_DEFAULT', childHouseClauseId: null, originGroupId: 'group-east-elite' })
    // 既存の父母の家門・出自は婚姻・出生で変わらない。
    for (const id of [P2, P5]) {
      const before = createExperimentalWorld().persons.find(p => p.personId === id)!
      expect(birthYear.world.persons.find(p => p.personId === id)).toMatchObject({ houseId: before.houseId, originGroupId: before.originGroupId })
    }
    expect(validateWorldState(birthYear.world).ok).toBe(true)
  })

  it('旧版（母の家門）は同じ入力で従来どおり。乱数・子ID・出生枠は新版と同一', () => {
    const legacy = marryThenBirth(DYNASTY).birthYear
    const paternal = marryThenBirth({ ...DYNASTY, childHouse: V4_HOUSE }).birthYear
    const [a] = childOf(legacy.world, P2, P5), [b] = childOf(paternal.world, P2, P5)
    expect(a!.houseId).toBe(CARDON)
    expect(b!.houseId).toBe(NALVEN)
    const { houseId: _a, ...restA } = a!, { houseId: _b, ...restB } = b!
    void [_a, _b]
    expect(restA).toEqual(restB)
    const [la] = b002(legacy), [pa] = b002(paternal)
    expect(la!.ruleVersion).toBe(B002_AUTONOMOUS_VERSION)
    expect(la!.random).toEqual(pa!.random)
    expect(la!.candidates[0]!.inputs).not.toHaveProperty('childHouseBasis')
  })

  it('双方合意の母方例外（王朝条項あり）: 子は母の家門、法的王朝は王朝条項、出生枠は母の集団', () => {
    const { marriageYear, birthYear } = marryThenBirth({ ...TRADE_DYNASTY, childHouse: TRADE_HOUSE })
    const marriage = marriageYear.world.legal.marriages[0]!
    const trace = b005(marriageYear)
    expect(trace.candidates[0]!.inputs.selectedContractKey).toBe(K(NALVEN_DYNASTY_ID, MAT()))
    expect(trace.candidates[0]!.inputs.selectedChildHouse).toEqual(MAT())
    expect(trace.candidates[0]!.inputs.selectedContractIdentity).toEqual({ dynastyId: NALVEN_DYNASTY_ID, childHouse: MAT() })
    expect(marriage.contract?.clauses).toMatchObject([
      { kind: 'CHILD_LEGAL_DYNASTY', dynastyId: NALVEN_DYNASTY_ID },
      { kind: 'CHILD_HOUSE_AFFILIATION', houseId: CARDON, sourcePersonId: P5 },
    ])
    const aLeg = marriageYear.traces.find(t => t.ruleId === 'A-LEG-01' && t.status === 'ACCEPT')!
    expect(aLeg.candidates[0]!.inputs.contractId).toBe(marriage.contract!.contractId)
    const [child] = childOf(birthYear.world, P2, P5)
    expect(child).toMatchObject({ houseId: CARDON, originGroupId: 'group-east-elite',
      legalDynasty: { status: 'DETERMINED', dynastyId: NALVEN_DYNASTY_ID } })
    const accepted = b002(birthYear).find(t => t.status === 'ACCEPT')!
    expect(accepted.candidates[0]!.inputs).toMatchObject({ childHouseBasis: 'MATERNAL_CONTRACT_CLAUSE',
      childHouseClauseId: marriage.contract!.clauses[1]!.clauseId, contractId: marriage.contract!.contractId })
    expect(claimedSlotGroups(birthYear)).toEqual(['group-east-elite'])
    // 同一婚姻の後続出生も同じ根拠を使う。
    const third = done(step(birthYear.world, [[P2, P5]], { ...TRADE_DYNASTY, childHouse: TRADE_HOUSE }))
    expect(childOf(third.world, P2, P5).map(p => p.houseId)).toEqual([CARDON, CARDON])
  })

  it('王朝条項なし・家門条項なし: 父方家門、法的王朝はUNDETERMINED（父系王朝を既定にしない）', () => {
    const cal = { ...DYNASTY, noClauseCost: -20, childHouse: V4_HOUSE }
    const { marriageYear, birthYear } = marryThenBirth(cal)
    expect(marriageYear.world.legal.marriages[0]!.contract?.clauses).toEqual([])
    const [child] = childOf(birthYear.world, P2, P5)
    expect(child!.houseId).toBe(NALVEN)
    expect(child!.legalDynasty.status).toBe('UNDETERMINED')
    const dyn = birthYear.traces.find(t => t.ruleId === 'A-DYN-02')!
    expect(dyn.reasonCodes).toContain('GAME_01_DYNASTY_CLAUSE_MISSING')
  })

  it('王朝条項なし・家門条項あり: 母方家門でも法的王朝は確定しない（家門条項から王朝を導かない）', () => {
    // 母P3の家門（ナルヴェン）は記録上の世襲Titleを多く持つ。家門の称号利害だけで双方が母方を選ぶ試験値。
    const cal = { ...DYNASTY, noClauseCost: -20, childHouse: house({ titleWeight: 4 }) }
    const w1251 = done(step(createExperimentalWorld(), [[P3, P4]], cal)).world
    expect(w1251.legal.marriages).toHaveLength(0) // P3は1250年に未成年
    const { marriageYear, birthYear } = marryThenBirth(cal, [P3, P4], w1251)
    expect(marriageYear.world.legal.marriages[0]!.contract?.clauses).toMatchObject([
      { kind: 'CHILD_HOUSE_AFFILIATION', houseId: NALVEN, sourcePersonId: P3 }])
    const [child] = childOf(birthYear.world, P4, P3)
    expect(child).toMatchObject({ houseId: NALVEN, originGroupId: 'group-central-elite', legalDynasty: { status: 'UNDETERMINED' } })
    expect(birthYear.traces.find(t => t.ruleId === 'A-DYN-02')!.reasonCodes).toContain('GAME_01_DYNASTY_CLAUSE_MISSING')
  })

  it('翌世代: 国内管轄照会は子の新しいhouseIdを使い、傍系継承の実評価器は家門と無関係に親子記録で探索する', () => {
    const w = marryThenBirth({ ...TRADE_DYNASTY, childHouse: TRADE_HOUSE }).birthYear.world
    const child = childOf(w, P2, P5)[0]!
    expect(child.houseId).toBe(CARDON)
    // 子と血縁記録の無い異性の成人（ヴァルガス家門）。管轄国は子の家門から決まり、出身集団で代用しない。
    const partner = { ...w.persons.find(p => p.personId === P4)!, personId: 'synthetic-partner', name: '試験相手',
      sex: child.sex === 'MALE' ? 'FEMALE' as const : 'MALE' as const, birthYear: child.birthYear }
    const adult: WorldState = { ...w, year: child.birthYear + 18, persons: [...w.persons, partner] }
    const pair = [child.personId, partner.personId].sort() as [string, string]
    expect(reviewDomesticMarriageEligibility(adult, pair)).toMatchObject({ status: 'ELIGIBLE', countryId: 'country-eldia' })
    const foreign: WorldState = { ...adult, houses: adult.houses.map(h => h.houseId === CARDON ? { ...h, countryId: 'country-margald' } : h) }
    expect(reviewDomesticMarriageEligibility(foreign, pair).status).not.toBe('ELIGIBLE')
    // 父P2の死亡時、子は家門（カルドン）に関係なく直系の記録から審査される。
    const dead: WorldState = { ...w, persons: w.persons.map(p => p.personId === P2 ? { ...p, alive: false, deathYear: w.year } : p) }
    const heir = reviewAncestralHeir(dead, P2)
    expect(heir.rankedCandidateIds[0]).toBe(child.personId)
  })
})

describe('DEC-190 不成立・不正な例外', () => {
  type Tamper = (c: ChildHouseAffiliationClause) => ChildHouseAffiliationClause
  const TRADE = { ...TRADE_DYNASTY, childHouse: TRADE_HOUSE }
  /** 父方案で正規に登録された婚姻（家門条項なし、v4の父方選択記録あり）。 */
  const married = () => done(step(createExperimentalWorld(), [[P2, P5]], { ...DYNASTY, childHouse: V4_HOUSE })).world
  /** 旧nextgen構成（家門方式なし）で登録された婚姻（選択記録なし）。 */
  const legacyMarried = () => done(step(createExperimentalWorld(), [[P2, P5]], DYNASTY)).world
  /** 実年次経路の双方合意で正規に成立した母方例外の婚姻と、その年のTrace。 */
  const maternalYear = () => done(step(createExperimentalWorld(), [[P2, P5]], TRADE))
  const withContract = (w: WorldState, f: (c: MarriageContract) => MarriageContract, m = (x: Marriage) => x): WorldState =>
    ({ ...w, legal: { ...w.legal, marriages: w.legal.marriages.map((x): Marriage => m({ ...x, contract: f(x.contract!) })) } })
  const houseClause = (w: WorldState) => w.legal.marriages[0]!.contract!.clauses.find(c => c.kind === 'CHILD_HOUSE_AFFILIATION')!
  const selectionOf = (w: WorldState) => w.legal.marriages[0]!.contract!.selection!
  const tamper = (w: WorldState, f: Tamper): WorldState => withContract(w, c => ({ ...c,
    clauses: c.clauses.map(x => x.kind === 'CHILD_HOUSE_AFFILIATION' ? f(x) : x) }))
  /**
   * 契約の選択記録を改変し、正規記録キーも改変後の記録から作り直す（条項・ID・証拠IDはそのまま）。
   * 両独立記録の同時改変でも、記録キーより後段の照合（同意・当事者・条項・契約全体の結合）が落とすことを確認する。
   */
  const tamperSelection = (w: WorldState, f: (s: NextgenContractSelection) => NextgenContractSelection): WorldState =>
    withContract(w, c => { const selection = f(c.selection!); return { ...c, selection, selectionRecordKey: nextgenSelectionRecordKey(selection) } })
  /** 選択記録だけを改変（正規記録キー・条項・ID・証拠IDはそのまま）。 */
  const tamperSelectionOnly = (w: WorldState, f: (s: NextgenContractSelection) => NextgenContractSelection): WorldState =>
    withContract(w, c => ({ ...c, selection: f(c.selection!) }))
  const tamperAgreement = (w: WorldState, f: (a: ChildHouseAgreementRecord) => ChildHouseAgreementRecord): WorldState =>
    tamperSelection(w, s => ({ ...s, agreement: f(s.agreement) }))
  /** 登録済み契約へ、元の契約ID・証拠ID・記録のまま母方条項を後付けする。 */
  const appended = (w: WorldState, clause: unknown): WorldState => withContract(w, c => ({ ...c,
    clauses: [...c.clauses, clause as ChildHouseAffiliationClause] }))
  const withoutHouseClause = (w: WorldState): WorldState => withContract(w, c => ({ ...c,
    clauses: c.clauses.filter(x => x.kind !== 'CHILD_HOUSE_AFFILIATION') }))
  const parties = (w: WorldState) => [P2, P5].map(id => w.persons.find(p => p.personId === id)!) as [never, never]
  /** 出生年の実評価: 子・出生Event・出生枠請求がなく、DEFERで理由を記録し、母の家門も変わらない。 */
  const expectBirthDeferred = (w: WorldState, code: string) => {
    expect(validateWorldState(w).ok).toBe(true)
    const r = done(step(w, [[P2, P5]], TRADE))
    expect(childOf(r.world, P2, P5)).toHaveLength(0)
    expect(claimedSlotGroups(r)).toEqual([])
    expect(r.events.filter(e => e.eventType === 'PERSON_BIRTH')).toHaveLength(0)
    const t = b002(r)[0]!
    expect(t.status).toBe('DEFER')
    expect(t.reasonCodes).toContain(code)
    expect(t.candidates[0]!.inputs).toMatchObject({ claimedBirths: 0, houseId: null, childHouseBasis: null })
    expect(r.world.persons.find(p => p.personId === P5)!.houseId).toBe(CARDON)
  }

  it('正規の母方例外: 契約の選択記録はB-005の当年Traceと一致し、Aの登録審査・出生時の結合照合を通る', () => {
    const y = maternalYear(), w = y.world
    const m = w.legal.marriages[0]!, sel = selectionOf(w)
    const trace = b005(y)
    expect(houseClause(w)).toEqual({ clauseId: expect.any(String), kind: 'CHILD_HOUSE_AFFILIATION', houseId: CARDON, sourcePersonId: P5 })
    expect(sel).toEqual({ version: NEXTGEN_CONTRACT_SELECTION_VERSION, identity: { dynastyId: NALVEN_DYNASTY_ID, childHouse: MAT() },
      agreement: { registeredYear: 1250, personIds: [P2, P5], sourceTraceId: trace.traceId,
        firstConsentScore: sel.agreement.firstConsentScore, secondConsentScore: sel.agreement.secondConsentScore,
        consentThreshold: TRADE.consentThreshold } })
    const option = (trace.candidates[0]!.inputs.contractOptions as Record<string, unknown>[])
      .filter(o => sameNextgenContractIdentity({ dynastyId: o.dynastyId, childHouse: o.childHouse }, sel.identity))
    expect(option).toEqual([expect.objectContaining({ key: K(NALVEN_DYNASTY_ID, MAT()), mutuallyAccepted: true,
      firstConsentScore: sel.agreement.firstConsentScore, secondConsentScore: sel.agreement.secondConsentScore })])
    expect(m.contract!.evidenceId).toBe('evidence:nextgen-agreement:' + trace.traceId)
    expect(m.contract).toEqual(nextgenSelectionContract(sel))
    expect(childHouseAgreementIssue(m, m.contract)).toBeNull()
    expect(childHouseRegistrationIssue(w, 1250, [P2, P5], parties(w), m.contract, y.traces)).toBeNull()
    expect(resolveChildHouseAffiliation(w, ...parties(w), m)).toMatchObject({ status: 'RESOLVED', houseId: CARDON, basis: 'MATERNAL_CONTRACT_CLAUSE' })
  })

  it('Aの登録審査: 当年のB-005合意Traceが無い・一致しない手動のv4契約は登録しない', () => {
    const y = maternalYear(), w = y.world
    const m = w.legal.marriages[0]!
    const review = (contract: MarriageContract | undefined, traces: readonly DecisionTrace[] = y.traces, year = 1250) =>
      childHouseRegistrationIssue(w, year, [P2, P5], parties(w), contract, traces)
    // 合意記録と契約の形は自己整合でも、Traceが無い手動候補・承認記録は証明にならない。
    expect(review(m.contract, [])).toBe('CHILD_HOUSE_AGREEMENT_TRACE_MISSING')
    expect(review(m.contract, y.traces.filter(t => t.ruleId !== 'B-005'))).toBe('CHILD_HOUSE_AGREEMENT_TRACE_MISSING')
    const trace = b005(y)
    const deferred = { ...trace, status: 'DEFER' as const }
    expect(review(m.contract, [deferred])).toBe('CHILD_HOUSE_AGREEMENT_TRACE_MISSING')
    expect(review(m.contract, [{ ...trace, year: 1251 }])).toBe('CHILD_HOUSE_AGREEMENT_TRACE_MISSING')
    expect(review(m.contract, [{ ...trace, actorRef: { kind: 'PERSON_PAIR', ids: [P4, P5] } }])).toBe('CHILD_HOUSE_AGREEMENT_TRACE_MISSING')
    expect(review(m.contract, [trace], 1251)).toBe('CHILD_HOUSE_AGREEMENT_MARRIAGE_MISMATCH')
    // 得点の単独書換えは選択記録と独立した正規記録キーとの比較で検出する。
    const scoreOnly = tamperSelectionOnly(w, s => ({ ...s, agreement: { ...s.agreement, firstConsentScore: s.agreement.firstConsentScore + 1 } }))
    expect(childHouseAgreementIssue(scoreOnly.legal.marriages[0]!, scoreOnly.legal.marriages[0]!.contract)).toBe('CHILD_HOUSE_SELECTION_RECORD_KEY_MISMATCH')
    expect(review(scoreOnly.legal.marriages[0]!.contract, [trace])).toBe('CHILD_HOUSE_SELECTION_RECORD_KEY_MISMATCH')
    // 記録キーも同時に作り直した得点の書換えは記録間の比較の範囲外のため、登録時にTraceの選択案と照合する。
    const scores = tamperAgreement(w, a => ({ ...a, firstConsentScore: a.firstConsentScore + 1 }))
    expect(childHouseAgreementIssue(scores.legal.marriages[0]!, scores.legal.marriages[0]!.contract)).toBeNull()
    expect(review(scores.legal.marriages[0]!.contract, [trace])).toBe('CHILD_HOUSE_AGREEMENT_TRACE_MISMATCH')
    const inputs = trace.candidates[0]!.inputs
    const withInputs = (x: Record<string, unknown>) => ({ ...trace, candidates: [{ ...trace.candidates[0]!, inputs: { ...inputs, ...x } }] }) as DecisionTrace
    // 選択案のキー・家門・同一性のどれか1つでも異なれば不一致。
    expect(review(m.contract, [withInputs({ selectedContractKey: K(NALVEN_DYNASTY_ID, PAT()) })])).toBe('CHILD_HOUSE_AGREEMENT_TRACE_MISMATCH')
    expect(review(m.contract, [withInputs({ selectedChildHouse: PAT() })])).toBe('CHILD_HOUSE_AGREEMENT_TRACE_MISMATCH')
    expect(review(m.contract, [withInputs({ selectedContractIdentity: { dynastyId: null, childHouse: MAT() } })])).toBe('CHILD_HOUSE_AGREEMENT_TRACE_MISMATCH')
    expect(review(m.contract, [withInputs({ selectedContractIdentity: undefined })])).toBe('CHILD_HOUSE_AGREEMENT_TRACE_MISMATCH')
    const options = inputs.contractOptions as Record<string, unknown>[]
    const at = options.findIndex(o => o.key === K(NALVEN_DYNASTY_ID, MAT()))
    expect(at).toBeGreaterThanOrEqual(0)
    const chosen = options[at]!
    const edit = (f: (o: Record<string, unknown>[]) => Record<string, unknown>[]) => review(m.contract, [withInputs({ contractOptions: f([...options]) })])
    // 選択肢の重複・同じ正規キーで異なる案・キーと構造の不整合・同率の別案・同意記録の改変・得点の改変。
    expect(edit(o => [...o, chosen])).toBe('CHILD_HOUSE_AGREEMENT_TRACE_MISMATCH')
    expect(edit(o => o.map((x, i) => i === at ? { ...x, dynastyId: null } : x))).toBe('CHILD_HOUSE_AGREEMENT_TRACE_MISMATCH')
    expect(edit(o => [...o, { ...chosen, dynastyId: 'dynasty-cardon' }])).toBe('CHILD_HOUSE_AGREEMENT_TRACE_MISMATCH')
    expect(edit(o => [...o, { ...chosen, dynastyId: 'dynasty-other', key: K('dynasty-other', MAT()) }])).toBe('CHILD_HOUSE_AGREEMENT_TRACE_MISMATCH')
    expect(edit(o => o.map((x, i) => i === at ? { ...x, mutuallyAccepted: false } : x))).toBe('CHILD_HOUSE_AGREEMENT_TRACE_MISMATCH')
    expect(edit(o => o.map((x, i) => i === at ? { ...x, secondConsentScore: (x.secondConsentScore as number) + 1 } : x)))
      .toBe('CHILD_HOUSE_AGREEMENT_TRACE_MISMATCH')
    expect(edit(o => o.map((x, i) => i === at ? { ...x, key: nextgenContractKey(NALVEN_DYNASTY_ID) } : x))).toBe('CHILD_HOUSE_AGREEMENT_TRACE_MISMATCH')
    expect(edit(o => o.filter((_, i) => i !== at))).toBe('CHILD_HOUSE_AGREEMENT_TRACE_MISMATCH')
    // 対照: 同じTraceをそのまま使えば通る（上の負例が検査対象の改変だけで落ちていることの確認）。
    expect(edit(o => o)).toBeNull()
    expect(review(appended(married(), { ...houseClause(w) }).legal.marriages[0]!.contract, [trace]))
      .toBe('CHILD_HOUSE_CLAUSE_NOT_SELECTED')
  })

  it('選択記録の無い家門条項（旧契約・父方案への後付け）は解決せず、年次計算も出生しない（父方fallbackなし）', () => {
    const clause = { clauseId: 'tampered-house', kind: 'CHILD_HOUSE_AFFILIATION', houseId: CARDON, sourcePersonId: P5 }
    for (const [w, code] of [[appended(legacyMarried(), clause), 'CHILD_HOUSE_SELECTION_MISSING'],
      [appended(married(), clause), 'CHILD_HOUSE_CLAUSE_NOT_SELECTED'],
      // 正規の母方契約から選択記録だけを削除（条項は残る）: 旧契約とみなして父方へ読み替えない。
      [withContract(maternalYear().world, ({ selection: _s, ...c }) => { void _s; return c }), 'CHILD_HOUSE_SELECTION_MISSING'],
    ] as const) {
      const m = w.legal.marriages[0]!
      expect(childHouseGovernedByContract(m.contract)).toBe(true)
      expect(resolveChildHouseAffiliation(w, ...parties(w), m)).toEqual({ status: 'UNRESOLVED', reasonCode: code })
      expectBirthDeferred(w, code)
    }
  })

  it.each([
    // 正規の母方婚姻の条項を他婚姻へ流用（元の契約ID・証拠ID・記録のまま）。
    ['正規の母方条項を父方案の契約へ後付け', (w: WorldState) => appended(married(), houseClause(w)), 'CHILD_HOUSE_CLAUSE_NOT_SELECTED'],
    // 父方案の契約ID・証拠IDのまま、選択記録を母方案へ書き換えて条項を後付けしても、Aの発行する母方案の契約とは一致しない。
    ['父方案の契約の選択記録を母方案へ書換えて条項を後付け', () => {
      const p = married()
      return appended(tamperSelection(p, s => ({ ...s, identity: { ...s.identity, childHouse: MAT() } })),
        { clauseId: 'tampered-house', kind: 'CHILD_HOUSE_AFFILIATION', houseId: CARDON, sourcePersonId: P5 })
    }, 'CHILD_HOUSE_AGREEMENT_CONTRACT_MISMATCH'],
    ['条項IDの改変', (w: WorldState) => tamper(w, c => ({ ...c, clauseId: 'tampered-house' })), 'CHILD_HOUSE_AGREEMENT_CONTRACT_MISMATCH'],
    ['同じ契約の王朝条項の削除', (w: WorldState) => withContract(w, c => ({ ...c, clauses: c.clauses.filter(x => x.kind !== 'CHILD_LEGAL_DYNASTY') })),
      'CHILD_HOUSE_AGREEMENT_CONTRACT_MISMATCH'],
    ['王朝条項の王朝IDの改変', (w: WorldState) => withContract(w, c => ({ ...c, clauses: c.clauses.map(x => x.kind === 'CHILD_LEGAL_DYNASTY'
      ? { ...x, dynastyId: 'dynasty-cardon' } : x) })), 'CHILD_HOUSE_AGREEMENT_CONTRACT_MISMATCH'],
    ['選択記録の王朝案の改変', (w: WorldState) => tamperSelection(w, s => ({ ...s, identity: { ...s.identity, dynastyId: null } })),
      'CHILD_HOUSE_AGREEMENT_CONTRACT_MISMATCH'],
    ['選択記録を父方案へ改変（条項は残す）', (w: WorldState) => tamperSelection(w, s => ({ ...s, identity: { ...s.identity, childHouse: PAT() } })),
      'CHILD_HOUSE_CLAUSE_NOT_SELECTED'],
    ['契約IDの改変', (w: WorldState) => withContract(w, c => ({ ...c, contractId: 'contract:other' })), 'CHILD_HOUSE_AGREEMENT_CONTRACT_MISMATCH'],
    ['別Traceの証拠へ差替え', (w: WorldState) => tamperAgreement(w, a => ({ ...a, sourceTraceId: 'trace:other' })),
      'CHILD_HOUSE_AGREEMENT_CONTRACT_MISMATCH'],
    ['片方の得点が閾値未満', (w: WorldState) => tamperAgreement(w, a => ({ ...a, secondConsentScore: a.consentThreshold - 1 })),
      'CHILD_HOUSE_AGREEMENT_CONSENT_MISSING'],
    ['別年の記録', (w: WorldState) => tamperAgreement(w, a => ({ ...a, registeredYear: 1249 })), 'CHILD_HOUSE_AGREEMENT_MARRIAGE_MISMATCH'],
    ['別ペアの記録', (w: WorldState) => tamperAgreement(w, a => ({ ...a, personIds: [P4, P5] })), 'CHILD_HOUSE_AGREEMENT_MARRIAGE_MISMATCH'],
    ['婚姻の登録年を別年へ', (w: WorldState) => withContract(w, c => c, m => ({ ...m, registeredYear: 1249 })),
      'CHILD_HOUSE_AGREEMENT_MARRIAGE_MISMATCH'],
    ['第三者家門', (w: WorldState) => tamper(w, c => ({ ...c, houseId: VARGAS })), 'CHILD_HOUSE_NOT_MATERNAL_HOUSE'],
    ['父方と同じ重複案', (w: WorldState) => tamper(w, c => ({ ...c, houseId: NALVEN })), 'CHILD_HOUSE_NOT_MATERNAL_HOUSE'],
    ['出典が父', (w: WorldState) => tamper(w, c => ({ ...c, sourcePersonId: P2, houseId: NALVEN })), 'CHILD_HOUSE_SOURCE_NOT_MOTHER'],
    // 母方案の契約ID・証拠ID・王朝条項・選択記録を残したまま家門条項だけを削除（父方原則へ読み替えない）。
    ['家門条項だけの削除', (w: WorldState) => withoutHouseClause(w), 'CHILD_HOUSE_CLAUSE_MISSING'],
    ['家門条項の削除と証拠IDの差替え', (w: WorldState) => withContract(withoutHouseClause(w), c => ({ ...c, evidenceId: 'evidence:other' })),
      'CHILD_HOUSE_CLAUSE_MISSING'],
    // 契約ID・王朝条項IDを父方案の正規形へ書き換えても、条項から独立した選択記録が母方案を示す。
    ['家門条項の削除と契約ID・王朝条項の父方案への書換え', (w: WorldState) => withContract(withoutHouseClause(w), c => {
      const pat = nextgenSelectionContract({ ...c.selection!, identity: { ...c.selection!.identity, childHouse: PAT() } })
      return { ...pat, selection: c.selection, selectionRecordKey: c.selectionRecordKey }
    }), 'CHILD_HOUSE_CLAUSE_MISSING'],
  ] as const)('%sは出生を保留し、父方fallback・人物・出生枠消費をしない', (_n, make, code) => {
    expectBirthDeferred(make(maternalYear().world), code)
  })

  it('選択記録の版の改変は旧版の証跡を同一版とせず、保存形式・登録・出生のいずれでも拒否/保留する', () => {
    const y = maternalYear()
    const w = tamperSelection(y.world, s => ({ ...s, version: 'dec190-old' as never })), m = w.legal.marriages[0]!
    expect(validateWorldState(JSON.parse(JSON.stringify(w))).ok).toBe(false)
    expect(childHouseAgreementIssue(m, m.contract)).toBe('CHILD_HOUSE_SELECTION_VERSION_MISMATCH')
    expect(childHouseRegistrationIssue(w, 1250, [P2, P5], parties(w), m.contract, y.traces)).toBe('CHILD_HOUSE_SELECTION_VERSION_MISMATCH')
    expect(resolveChildHouseAffiliation(w, ...parties(w), m)).toEqual({ status: 'UNRESOLVED', reasonCode: 'CHILD_HOUSE_SELECTION_VERSION_MISMATCH' })
  })

  it('家門条項の単独削除: 王朝条項なしの母方案でも、登録・出生の両評価器が同じ欠落として扱う', () => {
    // 王朝条項あり（実B005→A-LEG-01で1250成立）: 登録審査・合意結合・解決のすべてが同じ理由で保留する。
    const y = maternalYear(), w = withoutHouseClause(y.world), m = w.legal.marriages[0]!
    expect(m.contract!.clauses.map(c => c.kind)).toEqual(['CHILD_LEGAL_DYNASTY'])
    expect(childHouseRegistrationIssue(w, 1250, [P2, P5], parties(w), m.contract, y.traces)).toBe('CHILD_HOUSE_CLAUSE_MISSING')
    expect(childHouseAgreementIssue(m, m.contract)).toBe('CHILD_HOUSE_CLAUSE_MISSING')
    expect(resolveChildHouseAffiliation(w, ...parties(w), m)).toEqual({ status: 'UNRESOLVED', reasonCode: 'CHILD_HOUSE_CLAUSE_MISSING' })
    // 王朝条項なし（母P3のナルヴェン家門の正規契約）: 条項が全く残らなくても選択記録が母方案を示す。
    const cal = { ...DYNASTY, noClauseCost: -20, childHouse: house({ titleWeight: 4 }) }
    const w1251 = done(step(createExperimentalWorld(), [[P3, P4]], cal)).world
    const married1251 = done(step(w1251, [[P3, P4]], cal)).world
    const legit = married1251.legal.marriages[0]!
    expect(legit.contract!.selection!.identity).toEqual({ dynastyId: null, childHouse: MAT(NALVEN, P3) })
    expect(legit.contract).toEqual(nextgenSelectionContract(legit.contract!.selection!))
    const stripped = withContract(married1251, c => ({ ...c, clauses: [] }))
    expect(validateWorldState(stripped).ok).toBe(true)
    const r = done(step(stripped, [[P3, P4]], cal))
    expect(childOf(r.world, P4, P3)).toHaveLength(0)
    expect(claimedSlotGroups(r)).toEqual([])
    const t = b002(r).find(x => x.candidates[0]!.inputs.marriageId === legit.marriageId)!
    expect(t.status).toBe('DEFER')
    expect(t.reasonCodes).toContain('CHILD_HOUSE_CLAUSE_MISSING')
    // 対照: 同じ年次で正規の契約は母方家門で出生する。
    expect(childOf(done(step(married1251, [[P3, P4]], cal)).world, P4, P3).map(p => p.houseId)).toEqual([NALVEN])
  })

  it('構造化同一性: 区切り・引用符・JSON風・空白・Unicode・複数区切りを含む有効IDの組合せで、正規キーは単射・往復可能・旧キーと非交差', () => {
    const tricky = ['dynasty-nalven', 'dynasty-nalven+CHILD_HOUSE:house-cardon', 'a+CHILD_HOUSE:b+CHILD_HOUSE:c', '+CHILD_HOUSE:x',
      'x+CHILD_HOUSE:', '"quoted"', '\\"esc', '["json",null]', '{"a":1}', ',', ' ', ' space ', '\t\n', 'ナルヴェン家', '😀',
      '\u0000', 'NO_CLAUSE', 'CHILD_DYNASTY:', 'CHILD_DYNASTY:dynasty-nalven', 'DEC190_CONTRACT_IDENTITY_1:', 'DEC190_CONTRACT_IDENTITY_1:[null]',
      'PATERNAL_DEFAULT', 'MATERNAL_CONTRACT_CLAUSE', 'null']
    const sources = ['person-exp-05', 'null', '"', tricky[1]!]
    const identities: NextgenContractIdentity[] = []
    for (const dynastyId of [null, ...tricky]) {
      for (const h of tricky) {
        identities.push({ dynastyId, childHouse: PAT(h) })
        for (const src of sources) identities.push({ dynastyId, childHouse: MAT(h, src) })
      }
    }
    const keys = identities.map(nextgenContractIdentityKey)
    expect(new Set(keys).size).toBe(identities.length)
    identities.forEach((x, i) => {
      expect(parseNextgenContractIdentityKey(keys[i]!)).toEqual(x)
      expect(sameNextgenContractIdentity(parseNextgenContractIdentityKey(keys[i]!), x)).toBe(true)
    })
    // 隣接する案（1成分だけ異なる）は同一視しない。
    for (let i = 1; i < identities.length; i++) expect(sameNextgenContractIdentity(identities[i - 1], identities[i])).toBe(false)
    // 旧キー（旧王朝IDを含む）・旧契約IDとv4のキー・契約IDは交差しない。
    const legacyKeys = [null, ...tricky].map(nextgenContractKey)
    expect(legacyKeys.filter(k => keys.includes(k))).toEqual([])
    expect(legacyKeys.map(k => parseNextgenContractIdentityKey(k))).toEqual(legacyKeys.map(() => null))
    const agreement = { registeredYear: 1250, personIds: [P2, P5] as const, sourceTraceId: 't', firstConsentScore: 20, secondConsentScore: 20, consentThreshold: 15 }
    const ids = identities.map(identity => nextgenSelectionContract({ version: NEXTGEN_CONTRACT_SELECTION_VERSION, identity, agreement }).contractId)
    const legacyIds = [null, ...tricky].map(d => nextgenMarriageContract(1250, [P2, P5], nextgenContractKey(d), d, 't').contractId)
    expect(new Set([...ids, ...legacyIds]).size).toBe(ids.length + legacyIds.length)
    // 非正規の表記・未知のbasis・空ID・余分な成分は逆変換しない。
    const k0 = keys[0]!
    for (const bad of [k0.replace('[', '[ '), k0 + ' ', k0.replace('PATERNAL_DEFAULT', 'OTHER'), 'DEC190_CONTRACT_IDENTITY_1:[null,"PATERNAL_DEFAULT","",null]',
      'DEC190_CONTRACT_IDENTITY_1:["","PATERNAL_DEFAULT","h",null]', 'DEC190_CONTRACT_IDENTITY_1:[null,"PATERNAL_DEFAULT","h","p"]',
      'DEC190_CONTRACT_IDENTITY_1:[null,"MATERNAL_CONTRACT_CLAUSE","h",null]', 'DEC190_CONTRACT_IDENTITY_1:[null,"PATERNAL_DEFAULT","h",null,1]',
      'DEC190_CONTRACT_IDENTITY_2:[null,"PATERNAL_DEFAULT","h",null]', 'not-json']) {
      expect(parseNextgenContractIdentityKey(bad)).toBeNull()
    }
    expect(sameNextgenContractIdentity({ dynastyId: null, childHouse: PAT(), extra: 1 }, { dynastyId: null, childHouse: PAT() })).toBe(false)
    expect(sameNextgenContractIdentity({ childHouse: PAT(), dynastyId: null }, { dynastyId: null, childHouse: PAT() })).toBe(true)
  })

  it('旧契約・任意IDは解析しない: 選択記録も家門条項も無い契約は、IDの内容にかかわらず父方原則のまま', () => {
    const w = married()
    const m = w.legal.marriages[0]!
    const v4Paternal = m.contract!
    const legacyIds = ['c-25', 'contract:legacy+CHILD_HOUSE:' + CARDON, 'contract:nextgen:[1250,["a","b"],"NO_CLAUSE+CHILD_HOUSE:x"]',
      nextgenMarriageContract(1250, [P2, P5], 'CHILD_DYNASTY:' + NALVEN_DYNASTY_ID + '+CHILD_HOUSE:' + CARDON, NALVEN_DYNASTY_ID, 't').contractId,
      // v4の母方案の正規ID文字列を持つ旧任意IDも、IDだけでv4契約と誤認しない。
      nextgenSelectionContract({ ...v4Paternal.selection!, identity: { dynastyId: NALVEN_DYNASTY_ID, childHouse: MAT() } }).contractId]
    for (const contractId of legacyIds) {
      const loose: Marriage = { ...m, contract: { contractId, evidenceId: 'e', clauses: v4Paternal.clauses } }
      expect(childHouseGovernedByContract(loose.contract)).toBe(false)
      expect(childHouseAgreementIssue(loose, loose.contract)).toBeNull()
      expect(resolveChildHouseAffiliation(w, ...parties(w), loose)).toMatchObject({ status: 'RESOLVED', houseId: NALVEN, basis: 'PATERNAL_DEFAULT' })
    }
    expect(resolveChildHouseAffiliation(w, ...parties(w), m)).toMatchObject({ status: 'RESOLVED', houseId: NALVEN, basis: 'PATERNAL_DEFAULT' })
    expect(childHouseAgreementIssue(m, m.contract)).toBeNull()
    // 旧nextgen構成の契約は従来のID・条項・JSONのまま（選択記録を付けない）。
    const legacy = legacyMarried().legal.marriages[0]!.contract!
    expect(legacy).toEqual(nextgenMarriageContract(1250, [P2, P5], 'CHILD_DYNASTY:' + NALVEN_DYNASTY_ID, NALVEN_DYNASTY_ID,
      legacy.evidenceId.replace('evidence:nextgen-agreement:', '')))
    expect(legacy).not.toHaveProperty('selection')
  })

  describe('王朝ID自体が +CHILD_HOUSE: を含む世界（既存契約は任意の非空ID）', () => {
    const MARKED = NALVEN_DYNASTY_ID + '+CHILD_HOUSE:' + CARDON
    const renamer = (from: string, to: string) => {
      const f = <T,>(v: T): T => (typeof v === 'string' ? (v === from ? to : v)
        : Array.isArray(v) ? v.map(f) : v !== null && typeof v === 'object'
          ? Object.fromEntries(Object.entries(v).map(([k, a]) => [f(k), f(a)])) : v) as T
      return f
    }
    const rename = renamer(NALVEN_DYNASTY_ID, MARKED)
    const markedWorld = () => rename(createExperimentalWorld())
    const evaluatorsWith = (w: WorldState, cal: NextgenContractCalibration, r: <T>(v: T) => T, pair: readonly [string, string] = [P2, P5]) => {
      const e = createAutonomousCalibrationEvaluators({
        branchStartWorld: w, ledger: [], trustBase: [{ personIds: pair, value: 40 }],
        nextgenMarriage: { book: r(trial.book), laws: r(trial.laws), calibration: cal }, autonomy: AUTO,
        ...(cal.childHouse ? { childHouseAffiliation: 'DEC190_PATERNAL_PRINCIPLE' as const } : {}),
      })
      if (!e.ok) throw new Error(e.issues.join('; '))
      return e.evaluators
    }
    const markedStep = (w: WorldState, cal: NextgenContractCalibration) => done(step(w, [[P2, P5]], cal, evaluatorsWith(w, cal, rename)))
    const aLeg = (r: ReturnType<typeof done>) => r.traces.filter(t => t.ruleId === 'A-LEG-01')

    it.each([
      ['旧nextgen（家門条項方式なし）', DYNASTY, CARDON],
      ['v4家門方式の父方案', { ...DYNASTY, childHouse: V4_HOUSE }, NALVEN],
    ] as const)('%s: 王朝条項のある正規の契約を母方案と誤認せず、実年次で登録・出生する', (_n, cal, childHouseId) => {
      const start = markedWorld()
      expect(validateWorldState(start).ok).toBe(true)
      const y = markedStep(start, cal)
      expect(b005(y).status).toBe('ACCEPT')
      const v4 = cal.childHouse !== undefined
      expect(b005(y).candidates[0]!.inputs.selectedContractKey).toBe(v4 ? K(MARKED, PAT()) : 'CHILD_DYNASTY:' + MARKED)
      expect(aLeg(y).map(t => t.status)).toEqual(['ACCEPT'])
      const [m] = y.world.legal.marriages
      expect(m!.contract!.clauses).toEqual([expect.objectContaining({ kind: 'CHILD_LEGAL_DYNASTY', dynastyId: MARKED })])
      expect(m!.contract).toEqual(v4 ? nextgenSelectionContract(m!.contract!.selection!)
        : nextgenMarriageContract(1250, [P2, P5], 'CHILD_DYNASTY:' + MARKED, MARKED, m!.contract!.evidenceId.replace('evidence:nextgen-agreement:', '')))
      expect(childHouseAgreementIssue(m!, m!.contract)).toBeNull()
      const b = markedStep(y.world, cal)
      expect(childOf(b.world, P2, P5)).toEqual([expect.objectContaining({ houseId: childHouseId,
        legalDynasty: { status: 'DETERMINED', dynastyId: MARKED } })])
      expect(claimedSlotGroups(b)).toEqual(['group-east-elite'])
      expect(validateWorldState(b.world).ok).toBe(true)
    })

    it('同じ王朝IDの母方案は実年次で成立し、家門条項の単独削除は保留して出生・枠消費をしない', () => {
      const y = markedStep(markedWorld(), TRADE)
      const m = y.world.legal.marriages[0]!
      expect(b005(y).candidates[0]!.inputs.selectedContractKey).toBe(K(MARKED, MAT()))
      expect(m.contract!.clauses.map(c => c.kind)).toEqual(['CHILD_LEGAL_DYNASTY', 'CHILD_HOUSE_AFFILIATION'])
      // 対照: 正規の母方案は母方家門で出生。
      expect(childOf(markedStep(y.world, TRADE).world, P2, P5).map(p => p.houseId)).toEqual([CARDON])
      const stripped = withoutHouseClause(y.world)
      expect(validateWorldState(stripped).ok).toBe(true)
      const sm = stripped.legal.marriages[0]!
      expect(childHouseRegistrationIssue(stripped, 1250, [P2, P5], parties(stripped), sm.contract, y.traces)).toBe('CHILD_HOUSE_CLAUSE_MISSING')
      expect(childHouseAgreementIssue(sm, sm.contract)).toBe('CHILD_HOUSE_CLAUSE_MISSING')
      const r = markedStep(stripped, TRADE)
      expect(childOf(r.world, P2, P5)).toHaveLength(0)
      expect(claimedSlotGroups(r)).toEqual([])
      const t = b002(r)[0]!
      expect(t.status).toBe('DEFER')
      expect(t.reasonCodes).toContain('CHILD_HOUSE_CLAUSE_MISSING')
    })

    it('旧v4の連結キー衝突: 母の王朝が「父の王朝+CHILD_HOUSE:母の家門」でも、双方合意の母方案をAが登録し母方家門で出生する', () => {
      // 母の王朝 dynasty-cardon を参照ごと置換。旧キーでは（ナルヴェン王朝, 母方カルドン）と（置換王朝, 父方）が同じ文字列になった。
      const COLLIDE = NALVEN_DYNASTY_ID + '+CHILD_HOUSE:' + CARDON
      const r2 = renamer('dynasty-cardon', COLLIDE)
      const start = r2(createExperimentalWorld())
      expect(start.legal.dynasties.map(d => d.dynastyId)).toContain(COLLIDE)
      expect(validateWorldState(start).ok).toBe(true)
      const collideStep = (w: WorldState) => done(step(w, [[P2, P5]], TRADE, evaluatorsWith(w, TRADE, r2)))
      const control = done(step(createExperimentalWorld(), [[P2, P5]], TRADE))
      const y = collideStep(start)
      for (const r of [control, y]) {
        const t = b005(r)
        expect(t.status).toBe('ACCEPT')
        expect(t.candidates[0]!.inputs.selectedContractIdentity).toEqual({ dynastyId: NALVEN_DYNASTY_ID, childHouse: MAT() })
        const options = t.candidates[0]!.inputs.contractOptions as Record<string, unknown>[]
        expect(new Set(options.map(o => o.key)).size).toBe(options.length)
        expect(aLeg(r).map(x => x.status)).toEqual(['ACCEPT'])
        expect(r.world.legal.marriages).toHaveLength(1)
      }
      // 双方合意・得点は対照と同じ（王朝IDの文字列以外に差がない入力）。衝突し得た父方案は別キーの別案として記録される。
      const pick = (r: YearResult) => (b005(r).candidates[0]!.inputs.contractOptions as Record<string, unknown>[])
        .map(o => JSON.stringify([o.dynastyId === COLLIDE ? 'dynasty-cardon' : o.dynastyId, o.childHouse, o.firstConsentScore, o.secondConsentScore,
          o.mutuallyAccepted, o.minimumUtility])).sort() // 王朝IDの置換で王朝案の並び順だけが変わる
      expect(pick(y)).toEqual(pick(control))
      expect(b005(y).candidates[0]!.inputs.selectedContractKey).toBe(K(NALVEN_DYNASTY_ID, MAT()))
      const opts = b005(y).candidates[0]!.inputs.contractOptions as Record<string, unknown>[]
      const paternalCollide = opts.find(o => o.dynastyId === COLLIDE && (o.childHouse as NextgenContractChildHouse).basis === 'PATERNAL_DEFAULT')!
      expect(paternalCollide.key).not.toBe(b005(y).candidates[0]!.inputs.selectedContractKey)
      expect(nextgenContractKey(COLLIDE)).toBe(nextgenContractKey(NALVEN_DYNASTY_ID) + '+CHILD_HOUSE:' + CARDON) // 旧連結形式では衝突する入力
      const m = y.world.legal.marriages[0]!
      expect(m.contract!.selection!.identity).toEqual({ dynastyId: NALVEN_DYNASTY_ID, childHouse: MAT() })
      const b = collideStep(y.world)
      expect(childOf(b.world, P2, P5)).toEqual([expect.objectContaining({ houseId: CARDON, originGroupId: 'group-east-elite',
        legalDynasty: { status: 'DETERMINED', dynastyId: NALVEN_DYNASTY_ID } })])
      expect(claimedSlotGroups(b)).toEqual(['group-east-elite'])
      expect(validateWorldState(b.world).ok).toBe(true)
    })
  })

  it('別ペアの婚姻への合意記録の流用は解決しない', () => {
    const w = maternalYear().world
    const m = w.legal.marriages[0]!
    const other: Marriage = { ...m, marriageId: 'm-other', personIds: [P4, P5] }
    expect(childHouseAgreementIssue(other, m.contract)).toBe('CHILD_HOUSE_AGREEMENT_MARRIAGE_MISMATCH')
  })

  it('管轄外の母方家門・複数条項・契約証拠欠落は解決しない', () => {
    const w = maternalYear().world
    const m = w.legal.marriages[0]!
    const [f, mo] = [P2, P5].map(id => w.persons.find(p => p.personId === id)!) as [never, never]
    expect(resolveChildHouseAffiliation(w, f, mo, m)).toMatchObject({ status: 'RESOLVED', houseId: CARDON, basis: 'MATERNAL_CONTRACT_CLAUSE' })
    const foreign = { ...w, houses: w.houses.map(h => h.houseId === CARDON ? { ...h, countryId: 'country-margald' } : h) }
    expect(resolveChildHouseAffiliation(foreign, f, mo, m)).toEqual({ status: 'UNRESOLVED', reasonCode: 'CHILD_HOUSE_JURISDICTION_MISMATCH' })
    const twice = appended(w, { ...houseClause(w), clauseId: 'second' })
    expect(resolveChildHouseAffiliation(twice, f, mo, twice.legal.marriages[0]!)).toEqual({ status: 'UNRESOLVED', reasonCode: 'AMBIGUOUS_CHILD_HOUSE_CLAUSES' })
    expect(validateWorldState(twice).diagnostics.map(i => i.code)).toContain('MARRIAGE_CLAUSE_CONFLICT')
    const noEvidence = { ...m, contract: { ...m.contract!, evidenceId: '' } }
    expect(resolveChildHouseAffiliation(w, f, mo, noEvidence)).toEqual({ status: 'UNRESOLVED', reasonCode: 'MARRIAGE_CONTRACT_EVIDENCE_MISSING' })
    const unknown = { ...w, houses: w.houses.filter(h => h.houseId !== CARDON) }
    expect(childHouseClauseIssue(unknown, [f, mo], houseClause(w))).toBe('CHILD_HOUSE_UNKNOWN')
  })

  it('保存・復元後の後続出生も、復元した合意記録で同じ母方家門を用いる', () => {
    const restore = (w: WorldState) => {
      const parsed = validateWorldState(JSON.parse(JSON.stringify(w)))
      expect(parsed.diagnostics).toEqual([])
      return parsed.world!
    }
    const born = done(step(restore(maternalYear().world), [[P2, P5]], TRADE))
    expect(childOf(born.world, P2, P5).map(p => p.houseId)).toEqual([CARDON])
    const later = done(step(restore(born.world), [[P2, P5]], TRADE))
    expect(childOf(later.world, P2, P5).map(p => p.houseId)).toEqual([CARDON, CARDON])
    expect(claimedSlotGroups(later)).toEqual(['group-east-elite'])
  })

  it('v4父方案も保存・復元後に同じ選択記録で父方家門を用い、母方家門の出生は登録しない', () => {
    const cal = { ...DYNASTY, childHouse: V4_HOUSE }
    const parsed = validateWorldState(JSON.parse(JSON.stringify(married())))
    expect(parsed.diagnostics).toEqual([])
    const restored = parsed.world!
    expect(restored.legal.marriages[0]!.contract!.selection!.identity).toEqual({ dynastyId: NALVEN_DYNASTY_ID, childHouse: PAT() })
    const born = done(step(restored, [[P2, P5]], cal))
    expect(childOf(born.world, P2, P5).map(p => p.houseId)).toEqual([NALVEN])
    expect(claimedSlotGroups(born)).toEqual(['group-east-elite'])
  })

  it('片方の同意なし: 例外費用が大きいと母方案は双方同意にならず、父方の既定で成立する', () => {
    const r = done(step(createExperimentalWorld(), [[P2, P5]], { ...TRADE_DYNASTY, childHouse: house({ ownHouseBonus: 3, exceptionCost: 100 }) }))
    const options = b005(r).candidates[0]!.inputs.contractOptions as { childHouse: { basis: string }; mutuallyAccepted: boolean }[]
    expect(options.filter(o => o.childHouse.basis === 'MATERNAL_CONTRACT_CLAUSE').every(o => !o.mutuallyAccepted)).toBe(true)
    expect(r.world.legal.marriages[0]!.contract?.clauses.map(c => c.kind)).toEqual(['CHILD_LEGAL_DYNASTY'])
  })

  it('得点同率（家門利害なし）なら母方/父方をID順で決めず、婚姻を保留する', () => {
    const r = done(step(createExperimentalWorld(), [[P2, P5]], { ...DYNASTY, childHouse: house({}) }))
    expect(r.world.legal.marriages).toHaveLength(0)
    expect(b005(r).reasonCodes).toContain('CONTRACT_CHOICE_TIE')
  })

  it('無授権ではB-005の母方合意だけで婚姻・条項を作らない', () => {
    const cal = { ...TRADE_DYNASTY, childHouse: TRADE_HOUSE }
    const world = createExperimentalWorld()
    const book = { ...trial.book, approvalAuthorities: [] }
    const r = done(step(world, [[P2, P5]], cal, evaluatorsFor(world, [[P2, P5]], cal, book)))
    expect(b005(r).status).toBe('ACCEPT')
    expect(r.world.legal.marriages).toHaveLength(0)
    expect(r.events.filter(e => e.eventType === 'MARRIAGE_REGISTER')).toHaveLength(0)
  })

  it('Aの同一入力再評価が家門条項の選択と一致しなければ登録しない', () => {
    const world = createExperimentalWorld()
    const b = evaluatorsFor(world, [[P2, P5]], { ...TRADE_DYNASTY, childHouse: TRADE_HOUSE })
    const a = evaluatorsFor(world, [[P2, P5]], { ...TRADE_DYNASTY, childHouse: { ...TRADE_HOUSE, ownHouseBonus: 2 } })
    const r = done(step(world, [[P2, P5]], DYNASTY, { ...a, 'B-005': b['B-005']! }))
    expect(b005(r).status).toBe('ACCEPT')
    expect(r.world.legal.marriages).toHaveLength(0)
  })

  it('B-002の家門方式と契約の家門係数は一体で選ぶ（片方だけの構成を拒否）', () => {
    const base = { branchStartWorld: createExperimentalWorld(), ledger: [], trustBase: [], autonomy: AUTO }
    // 出生方式のみ（交渉設定そのものが無い）も拒否する。
    expect(createAutonomousCalibrationEvaluators({ ...base, childHouseAffiliation: 'DEC190_PATERNAL_PRINCIPLE' }))
      .toEqual({ ok: false, issues: ['CHILD_HOUSE_MODE_MISMATCH'] })
    expect(createAutonomousCalibrationEvaluators({ ...base, nextgenMarriage: { book: trial.book, laws: trial.laws,
      calibration: { ...DYNASTY, childHouse: V4_HOUSE } }, childHouseAffiliation: 'DEC190_PATERNAL_PRINCIPLE' }).ok).toBe(true)
    // 旧構成（どちらも無し・交渉設定のみ旧版）は従来どおり作れる。
    expect(createAutonomousCalibrationEvaluators(base).ok).toBe(true)
    expect(createAutonomousCalibrationEvaluators({ ...base, nextgenMarriage: { book: trial.book, laws: trial.laws, calibration: DYNASTY } }).ok).toBe(true)
    expect(createAutonomousCalibrationEvaluators({ ...base, nextgenMarriage: { book: trial.book, laws: trial.laws,
      calibration: { ...DYNASTY, childHouse: V4_HOUSE } } })).toEqual({ ok: false, issues: ['CHILD_HOUSE_MODE_MISMATCH'] })
    expect(createAutonomousCalibrationEvaluators({ ...base, nextgenMarriage: { book: trial.book, laws: trial.laws, calibration: DYNASTY },
      childHouseAffiliation: 'DEC190_PATERNAL_PRINCIPLE' })).toEqual({ ok: false, issues: ['CHILD_HOUSE_MODE_MISMATCH'] })
    expect(validateNextgenContractCalibration({ ...DYNASTY, childHouse: { ...V4_HOUSE, status: 'FORMAL' as never } }))
      .toEqual(['CHILD_HOUSE_CALIBRATION_NOT_EXPERIMENTAL'])
    expect(validateNextgenContractCalibration({ ...DYNASTY, childHouse: { ...V4_HOUSE, exceptionCost: 0.5 } }))
      .toEqual(['CHILD_HOUSE_CALIBRATION_OUT_OF_RANGE'])
  })

  it('reducer: 家門条項のある婚姻の出生は条項の解決結果と一致する家門でのみ登録する', () => {
    // reducer境界の単体検査。成功の証明ではなく、記録と結合した契約か否かで出生の可否が分かれることだけを見る。
    const agreement: ChildHouseAgreementRecord = { registeredYear: 1250, personIds: [P2, P5], sourceTraceId: 't-25',
      firstConsentScore: 20, secondConsentScore: 20, consentThreshold: 15 }
    const contract = nextgenSelectionContract({ version: NEXTGEN_CONTRACT_SELECTION_VERSION,
      identity: { dynastyId: null, childHouse: MAT() }, agreement })
    const marriage: Marriage = { marriageId: 'm-25', personIds: [P2, P5], registeredYear: 1250, status: 'ACTIVE', contract }
    const base = newWorld()
    const w: WorldState = { ...base, legal: { ...base.legal, marriages: [marriage] },
      demographics: { cohortSlots: [{ groupId: 'group-east-elite', year: 1250, birthSlots: 1, deathSlots: 0, claimedBirths: 0, claimedDeaths: 0 }] } }
    const child = (houseId: string) => baby('child-25', 'group-east-elite', { houseId, motherId: P5 })
    const bad = run(w, outcome('B-002', 3, [birth(child(NALVEN))]))
    expect(rejectionCodes(bad)).toContain('LEGAL_BASIS_MISSING')
    expect(bad.world.persons.some(p => p.personId === 'child-25')).toBe(false)
    const good = run(w, outcome('B-002', 3, [birth(child(CARDON))]))
    expect(good.world.persons.find(p => p.personId === 'child-25')?.houseId).toBe(CARDON)
    expect(rejectionCodes(run(w, outcome('B-002', 3, [birth(child('house-ghost'))])))).toContain('NOT_FOUND')
    const forged: WorldState = { ...w, legal: { ...w.legal, marriages: [{ ...marriage,
      contract: { ...contract, contractId: 'c-25' } }] } }
    expect(rejectionCodes(run(forged, outcome('B-002', 3, [birth(child(CARDON))])))).toContain('LEGAL_BASIS_MISSING')
    // 母方案の選択記録・正規契約IDのまま家門条項だけを削除した婚姻: 父方・母方いずれの家門でも出生・枠請求をしない。
    const stripped: WorldState = { ...w, legal: { ...w.legal, marriages: [{ ...marriage, contract: { ...contract, clauses: [] } }] } }
    for (const h of [NALVEN, CARDON]) {
      const r = run(stripped, outcome('B-002', 3, [birth(child(h))]))
      expect(rejectionCodes(r)).toContain('LEGAL_BASIS_MISSING')
      expect(r.world.persons.some(p => p.personId === 'child-25')).toBe(false)
      expect(r.world.demographics.cohortSlots[0]!.claimedBirths).toBe(0)
    }
    // 真の無条項（旧構成の正規契約、v4の父方案）は従来どおり父方家門で登録でき、v4父方案は母方家門を拒否する。
    const plain = nextgenMarriageContract(1250, [P2, P5], 'NO_CLAUSE', null, 't-25')
    const paternal: WorldState = { ...w, legal: { ...w.legal, marriages: [{ ...marriage, contract: plain }] } }
    expect(run(paternal, outcome('B-002', 3, [birth(child(NALVEN))])).world.persons.find(p => p.personId === 'child-25')?.houseId).toBe(NALVEN)
    const v4pat = nextgenSelectionContract({ version: NEXTGEN_CONTRACT_SELECTION_VERSION, identity: { dynastyId: null, childHouse: PAT() }, agreement })
    const v4paternal: WorldState = { ...w, legal: { ...w.legal, marriages: [{ ...marriage, contract: v4pat }] } }
    expect(run(v4paternal, outcome('B-002', 3, [birth(child(NALVEN))])).world.persons.find(p => p.personId === 'child-25')?.houseId).toBe(NALVEN)
    expect(rejectionCodes(run(v4paternal, outcome('B-002', 3, [birth(child(CARDON))])))).toContain('LEGAL_BASIS_MISSING')
    // 父方案の記録に母方条項を後付けした婚姻も出生を登録しない。
    const retro: WorldState = { ...w, legal: { ...w.legal, marriages: [{ ...marriage, contract: { ...v4pat, clauses: contract.clauses } }] } }
    for (const h of [NALVEN, CARDON]) expect(rejectionCodes(run(retro, outcome('B-002', 3, [birth(child(h))])))).toContain('LEGAL_BASIS_MISSING')
  })

  it('reducer: 登録時の合意記録と結合しない家門条項の婚姻は登録しない', () => {
    const y = done(step(createExperimentalWorld(), [[P2, P5]], { ...TRADE_DYNASTY, childHouse: TRADE_HOUSE }))
    const legit = y.world.legal.marriages[0]!
    const base = newWorld()
    const register = (m: Marriage) => run(base, outcome('A-LEG-01', 3, [{ type: 'MARRIAGE_REGISTER', commandId: 'cmd-reg',
      source: { requestId: 'req-reg', year: 1250, phase: 3, sourceRuleId: 'A-LEG-01', sourceTraceId: 'trace-reg', sourceIntentId: 'intent-reg' },
      marriage: m }]))
    expect(register(legit).world.legal.marriages).toHaveLength(1)
    const clauses = legit.contract!.clauses.map(c => c.kind === 'CHILD_HOUSE_AFFILIATION' ? { ...c, clauseId: 'tampered' } : c)
    const bad = register({ ...legit, contract: { ...legit.contract!, clauses } })
    expect(rejectionCodes(bad)).toContain('LEGAL_BASIS_MISSING')
    expect(bad.world.legal.marriages).toHaveLength(0)
    const stripped = register({ ...legit, contract: { ...legit.contract!, clauses: legit.contract!.clauses.filter(c => c.kind !== 'CHILD_HOUSE_AFFILIATION') } })
    expect(rejectionCodes(stripped)).toContain('LEGAL_BASIS_MISSING')
    expect(stripped.world.legal.marriages).toHaveLength(0)
    const { selection: _s, ...noSelection } = legit.contract!
    void _s
    const unrecorded = register({ ...legit, contract: noSelection })
    expect(rejectionCodes(unrecorded)).toContain('LEGAL_BASIS_MISSING')
    expect(unrecorded.world.legal.marriages).toHaveLength(0)
    // v4父方案の登録記録・旧構成の契約は従来どおり登録できる。
    const pat = done(step(createExperimentalWorld(), [[P2, P5]], { ...DYNASTY, childHouse: V4_HOUSE })).world.legal.marriages[0]!
    expect(register(pat).world.legal.marriages).toHaveLength(1)
    const old = done(step(createExperimentalWorld(), [[P2, P5]], DYNASTY)).world.legal.marriages[0]!
    expect(register(old).world.legal.marriages).toHaveLength(1)
  })

  describe('選択記録と独立した正規記録キー（selectionRecordKey）', () => {
    const V4 = { ...DYNASTY, childHouse: V4_HOUSE }
    const registerIn = (m: Marriage) => run(newWorld(), outcome('A-LEG-01', 3, [{ type: 'MARRIAGE_REGISTER', commandId: 'cmd-reg',
      source: { requestId: 'req-reg', year: 1250, phase: 3, sourceRuleId: 'A-LEG-01', sourceTraceId: 'trace-reg', sourceIntentId: 'intent-reg' },
      marriage: m }]))
    /** 婚姻の登録年（1250）のまま、母の出身集団に出生枠1を置いた世界で出生commandを直接適用する。 */
    const birthIn = (w: WorldState, houseId: string) => {
      const slotted: WorldState = { ...w, year: 1250,
        demographics: { cohortSlots: [{ groupId: 'group-east-elite', year: 1250, birthSlots: 1, deathSlots: 0, claimedBirths: 0, claimedDeaths: 0 }] } }
      return run(slotted, outcome('B-002', 3, [birth(baby('child-rk', 'group-east-elite', { houseId, fatherId: P2, motherId: P5 }))]))
    }
    const expectBirthRejected = (w: WorldState, houseId: string) => {
      const r = birthIn(w, houseId)
      expect(rejectionCodes(r)).toContain('LEGAL_BASIS_MISSING')
      expect(r.world.persons.some(p => p.personId === 'child-rk')).toBe(false)
      expect(r.world.demographics.cohortSlots[0]!.claimedBirths).toBe(0)
    }
    const expectRegisterRejected = (w: WorldState) => {
      const r = registerIn(w.legal.marriages[0]!)
      expect(rejectionCodes(r)).toContain('LEGAL_BASIS_MISSING')
      expect(r.world.legal.marriages).toHaveLength(0)
    }
    const dropSelection = (w: WorldState) => withContract(w, ({ selection: _s, ...c }) => { void _s; return c })
    const dropRecordKey = (w: WorldState) => withContract(w, ({ selectionRecordKey: _k, ...c }) => { void _k; return c })

    it('A-LEG-01が発行する父方案・母方案の契約は、選択記録の正規形と一致する記録キーを持つ（旧構成は持たない）', () => {
      for (const w of [married(), maternalYear().world]) {
        const c = w.legal.marriages[0]!.contract!
        expect(c.selectionRecordKey).toBe(nextgenSelectionRecordKey(c.selection!))
        expect(c.selectionRecordKey!.startsWith('DEC190_SELECTION_RECORD_1:')).toBe(true)
        expect(c).toEqual(nextgenSelectionContract(c.selection!))
      }
      expect(legacyMarried().legal.marriages[0]!.contract).not.toHaveProperty('selectionRecordKey')
    })

    it('正常な父方出生（実年次）と、正規v4父方案への母方出生commandの拒否', () => {
      const w = married()
      const r = done(step(w, [[P2, P5]], V4))
      expect(childOf(r.world, P2, P5).map(p => p.houseId)).toEqual([NALVEN])
      expect(claimedSlotGroups(r)).toEqual(['group-east-elite'])
      expectBirthRejected(w, CARDON)
      expect(birthIn(w, NALVEN).world.persons.find(p => p.personId === 'child-rk')?.houseId).toBe(NALVEN)
    })

    it('v4父方案から選択記録だけを削除: 旧契約とみなさず、登録・出生（実年次・reducer）とも拒否/保留し枠を消費しない', () => {
      const w = dropSelection(married()), m = w.legal.marriages[0]!
      expect(m.contract!.clauses.map(c => c.kind)).toEqual(['CHILD_LEGAL_DYNASTY'])
      expect(validateWorldState(JSON.parse(JSON.stringify(w))).ok).toBe(true)
      expect(childHouseGovernedByContract(m.contract)).toBe(true)
      expect(childHouseAgreementIssue(m, m.contract)).toBe('CHILD_HOUSE_SELECTION_MISSING')
      expect(resolveChildHouseAffiliation(w, ...parties(w), m)).toEqual({ status: 'UNRESOLVED', reasonCode: 'CHILD_HOUSE_SELECTION_MISSING' })
      expectRegisterRejected(w)
      for (const h of [CARDON, NALVEN]) expectBirthRejected(w, h)
      const r = done(step(w, [[P2, P5]], V4))
      expect(childOf(r.world, P2, P5)).toHaveLength(0)
      expect(claimedSlotGroups(r)).toEqual([])
      expect(b002(r)[0]!.reasonCodes).toContain('CHILD_HOUSE_SELECTION_MISSING')
    })

    it('母方案の正常出生と保存・復元: 記録キーは往復し、復元後も同じ母方家門で出生する', () => {
      const w = maternalYear().world
      const parsed = validateWorldState(JSON.parse(JSON.stringify(w)))
      expect(parsed.diagnostics).toEqual([])
      expect(parsed.world!.legal.marriages[0]!.contract!.selectionRecordKey).toBe(w.legal.marriages[0]!.contract!.selectionRecordKey)
      const r = done(step(parsed.world!, [[P2, P5]], TRADE))
      expect(childOf(r.world, P2, P5).map(p => p.houseId)).toEqual([CARDON])
      expect(claimedSlotGroups(r)).toEqual(['group-east-elite'])
      expect(birthIn(w, CARDON).world.persons.find(p => p.personId === 'child-rk')?.houseId).toBe(CARDON)
    })

    const KEY_MISMATCH = 'CHILD_HOUSE_SELECTION_RECORD_KEY_MISMATCH'
    it.each([
      // 閾値以上を保つ合意得点の単独改変（出生結果の差ではなく記録整合性の検出）。
      ['合意得点（第1当事者, 閾値以上を維持）', (w: WorldState) => tamperSelectionOnly(w, s => ({ ...s,
        agreement: { ...s.agreement, firstConsentScore: s.agreement.firstConsentScore + 1 } })), KEY_MISMATCH],
      ['合意得点（第2当事者, 閾値以上を維持）', (w: WorldState) => tamperSelectionOnly(w, s => ({ ...s,
        agreement: { ...s.agreement, secondConsentScore: s.agreement.secondConsentScore + 1 } })), KEY_MISMATCH],
      ['閾値', (w: WorldState) => tamperSelectionOnly(w, s => ({ ...s, agreement: { ...s.agreement, consentThreshold: s.agreement.consentThreshold - 1 } })), KEY_MISMATCH],
      ['登録年', (w: WorldState) => tamperSelectionOnly(w, s => ({ ...s, agreement: { ...s.agreement, registeredYear: 1249 } })), KEY_MISMATCH],
      ['当事者', (w: WorldState) => tamperSelectionOnly(w, s => ({ ...s, agreement: { ...s.agreement, personIds: [P4, P5] } })), KEY_MISMATCH],
      ['同一性（王朝案）', (w: WorldState) => tamperSelectionOnly(w, s => ({ ...s, identity: { ...s.identity, dynastyId: null } })), KEY_MISMATCH],
      ['出典Trace', (w: WorldState) => tamperSelectionOnly(w, s => ({ ...s, agreement: { ...s.agreement, sourceTraceId: 'trace:other' } })), KEY_MISMATCH],
      ['記録キーの単独欠落', dropRecordKey, 'CHILD_HOUSE_SELECTION_RECORD_KEY_MISSING'],
      ['記録キーの単独改変', (w: WorldState) => withContract(w, c => ({ ...c, selectionRecordKey: c.selectionRecordKey + 'x' })), KEY_MISMATCH],
      ['記録キーを別婚姻（父方案）の記録キーへ差替え', (w: WorldState) => withContract(w, c => ({ ...c,
        selectionRecordKey: married().legal.marriages[0]!.contract!.selectionRecordKey })), KEY_MISMATCH],
    ] as const)('登録済み母方案の%s: parseは形だけ受理し、登録・出生（実年次・reducer）は保留/拒否して出生0・枠0', (_n, make, code) => {
      const y = maternalYear(), w = make(y.world), m = w.legal.marriages[0]!
      expect(childHouseGovernedByContract(m.contract)).toBe(true)
      expect(childHouseAgreementIssue(m, m.contract)).toBe(code)
      expect(childHouseRegistrationIssue(w, 1250, [P2, P5], parties(w), m.contract, y.traces)).toBe(code)
      expectRegisterRejected(w)
      for (const h of [CARDON, NALVEN]) expectBirthRejected(w, h)
      expectBirthDeferred(w, code)
    })

    it('閾値以上の得点改変は対照（無改変）では通り、改変後の記録からの自己再構成では通らない', () => {
      const w = maternalYear().world, a = selectionOf(w).agreement
      expect(a.firstConsentScore + 1).toBeGreaterThanOrEqual(a.consentThreshold)
      const t = tamperSelectionOnly(w, s => ({ ...s, agreement: { ...s.agreement, firstConsentScore: a.firstConsentScore + 1 } }))
      // 改変後の記録から契約全体を再構成しても、保存済みの独立記録キーとは一致しない。
      expect(nextgenSelectionContract(selectionOf(t)).selectionRecordKey).not.toBe(t.legal.marriages[0]!.contract!.selectionRecordKey)
      expect(childHouseAgreementIssue(w.legal.marriages[0]!, w.legal.marriages[0]!.contract)).toBeNull()
    })

    it('記録キーのみの契約（選択記録なし・家門条項なし）も旧契約とみなさない。旧構成の契約（両方なし）は従来どおり', () => {
      const w = dropSelection(maternalYear().world)
      const keyOnly = withContract(w, c => ({ ...c, clauses: c.clauses.filter(x => x.kind !== 'CHILD_HOUSE_AFFILIATION') }))
      const m = keyOnly.legal.marriages[0]!
      expect(childHouseGovernedByContract(m.contract)).toBe(true)
      expect(childHouseAgreementIssue(m, m.contract)).toBe('CHILD_HOUSE_SELECTION_MISSING')
      expectRegisterRejected(keyOnly)
      for (const h of [CARDON, NALVEN]) expectBirthRejected(keyOnly, h)
      const old = legacyMarried()
      expect(childHouseGovernedByContract(old.legal.marriages[0]!.contract)).toBe(false)
      expect(registerIn(old.legal.marriages[0]!).world.legal.marriages).toHaveLength(1)
    })

    it('parse: 記録キーは空でない文字列のみ。記録キーを持たない選択記録版1の旧v4契約は版不一致として拒否する', () => {
      const w = maternalYear().world
      for (const v of ['', 1, null]) {
        const bad = JSON.parse(JSON.stringify(w))
        bad.legal.marriages[0].contract.selectionRecordKey = v
        expect(validateWorldState(bad).ok).toBe(false)
      }
      const oldV4 = JSON.parse(JSON.stringify(w))
      oldV4.legal.marriages[0].contract.selection.version = 'dec190-nextgen-contract-selection-1'
      delete oldV4.legal.marriages[0].contract.selectionRecordKey
      expect(validateWorldState(oldV4).ok).toBe(false)
    })
  })
})

describe('DEC-190 保存・parse・版付き構成', () => {
  it('家門条項・選択記録はparseで往復し、旧JSONの王朝条項は不変。未知フィールド・王朝IDの混入・旧v4形式は拒否', () => {
    const w = done(step(createExperimentalWorld(), [[P2, P5]], { ...TRADE_DYNASTY, childHouse: TRADE_HOUSE })).world
    const parsed = validateWorldState(JSON.parse(JSON.stringify(w)))
    expect(parsed.diagnostics).toEqual([])
    expect(parsed.world).toEqual(w)
    const bad = JSON.parse(JSON.stringify(w))
    bad.legal.marriages[0].contract.clauses[1].dynastyId = NALVEN_DYNASTY_ID
    expect(validateWorldState(bad).diagnostics.map(i => i.code)).toContain('UNKNOWN_FIELD')
    const missing = JSON.parse(JSON.stringify(w))
    delete missing.legal.marriages[0].contract.clauses[1].sourcePersonId
    expect(validateWorldState(missing).diagnostics.map(i => i.code)).toContain('MISSING_FIELD')
    const noAgreement = JSON.parse(JSON.stringify(w))
    delete noAgreement.legal.marriages[0].contract.selection.agreement
    expect(validateWorldState(noAgreement).diagnostics.map(i => i.code)).toContain('MISSING_FIELD')
    const extra = JSON.parse(JSON.stringify(w))
    extra.legal.marriages[0].contract.selection.agreement.signedBy = P5
    expect(validateWorldState(extra).diagnostics.map(i => i.code)).toContain('UNKNOWN_FIELD')
    const extraIdentity = JSON.parse(JSON.stringify(w))
    extraIdentity.legal.marriages[0].contract.selection.identity.childHouse.note = 'x'
    expect(validateWorldState(extraIdentity).diagnostics.map(i => i.code)).toContain('UNKNOWN_FIELD')
    const noDynastyKey = JSON.parse(JSON.stringify(w))
    delete noDynastyKey.legal.marriages[0].contract.selection.identity.dynastyId
    expect(validateWorldState(noDynastyKey).diagnostics.map(i => i.code)).toContain('MISSING_FIELD')
    const otherVersion = JSON.parse(JSON.stringify(w))
    otherVersion.legal.marriages[0].contract.selection.version = 'dec190-nextgen-contract-selection-0'
    expect(validateWorldState(otherVersion).ok).toBe(false)
    // 旧v4（家門条項内の合意記録・連結キー）の保存形式は新版と同一視せず拒否する。
    const oldV4 = JSON.parse(JSON.stringify(w))
    oldV4.legal.marriages[0].contract.clauses[1].agreement = { ...oldV4.legal.marriages[0].contract.selection.agreement,
      contractKey: 'CHILD_DYNASTY:' + NALVEN_DYNASTY_ID + '+CHILD_HOUSE:' + CARDON, dynastyId: NALVEN_DYNASTY_ID }
    delete oldV4.legal.marriages[0].contract.selection
    expect(validateWorldState(oldV4).diagnostics.map(i => i.code)).toContain('UNKNOWN_FIELD')
    const dangling = JSON.parse(JSON.stringify(w))
    dangling.legal.marriages[0].contract.selection.identity.childHouse.sourcePersonId = P1
    expect(validateWorldState(dangling).diagnostics.map(i => i.code)).toContain('MARRIAGE_CLAUSE_CONFLICT')
    // 王朝条項なしの母方案・v4父方案・旧構成の契約も往復する。
    for (const cal of [{ ...DYNASTY, childHouse: V4_HOUSE }, DYNASTY, { ...DYNASTY, noClauseCost: -20, childHouse: V4_HOUSE }]) {
      const x = done(step(createExperimentalWorld(), [[P2, P5]], cal)).world
      const back = validateWorldState(JSON.parse(JSON.stringify(x)))
      expect(back.diagnostics).toEqual([])
      expect(back.world).toEqual(x)
    }
    const outsider = JSON.parse(JSON.stringify(w))
    outsider.legal.marriages[0].contract.clauses[1].sourcePersonId = P1
    expect(validateWorldState(outsider).diagnostics.map(i => i.code)).toContain('MARRIAGE_CLAUSE_CONFLICT')
  })

  it('v0〜v3と限定試遊のdigestを変えず、v4は家門所属・契約係数・版だけが異なる', () => {
    const x = experimental
    expect(x.multiHouseDemandRunConfigDigest(0)).toBe('844299b001142fee')
    expect(x.multiHouseDemandRunConfigDigest(1)).toBe('d8260d46ed460630')
    expect(x.multiHouseAncestralRunConfigDigest(0)).toBe('1eb440a45a2680e0')
    expect(x.multiHouseAncestralRunConfigDigest(1)).toBe('fbadbdda8861ae7a')
    const v3 = x.multiHouseAncestralRunConfigIdentity(0) as Record<string, unknown>
    const v4 = x.multiHouseChildHouseRunConfigIdentity(0) as Record<string, unknown>
    expect(v4.configId).toBe('experimental-multi-house-v4-dec190-paternal-house-drift-0')
    const changed = [...new Set([...Object.keys(v3), ...Object.keys(v4)])].filter(k => JSON.stringify(v4[k]) !== JSON.stringify(v3[k])).sort()
    expect(changed).toEqual(['childHouseAffiliation', 'configId', 'nextgenContract', 'ruleVersions'])
    expect(v4.nextgenContract).toEqual({ ...v3.nextgenContract as object, childHouse: x.MULTI_HOUSE_CHILD_HOUSE_CONTRACT })
    expect((v4.ruleVersions as Record<string, unknown>).heirSearch).toBe(ANCESTRAL_HEIR_SEARCH_VERSION)
    expect(v4.world).toEqual(x.createMultiHouseDemandWorld(0))
    expect(new Set([x.multiHouseChildHouseRunConfigDigest(0), x.multiHouseChildHouseRunConfigDigest(1), x.multiHouseAncestralRunConfigDigest(0)]).size).toBe(3)
  })
})
