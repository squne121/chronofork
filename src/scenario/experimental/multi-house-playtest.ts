// Issue #114 担当B: 複数家門が世代を重ねる experimental 試遊構成（1250〜1350）。
// すべて CALIBRATION_ONLY。史実・正式世界設定・Goal・婚姻/出生/死亡/相続の成立を固定しない。
// 婚姻・出生・死亡・王朝所属・相続は既存B-001/002/003/004/005/009・A-LEG-01・A-DYN-02・A-SUC/A-TITの
// 毎年のWorldState評価に任せ、特定の年・人物へ予約しない。既存 integrated-run.ts は変更しない。
import type { EventLogEntry, Id, PairTrustBase, StatModifier, SupportingPersonRegistration, WorldState } from '../../simulation/contracts/index.ts'
import { createAutonomousCalibrationEvaluators } from '../../simulation/autonomy/index.ts'
import type { AutonomyCalibration } from '../../simulation/autonomy/index.ts'
import type { EvaluatorMap } from '../../simulation/engine/index.ts'
import { EXPERIMENTAL_NEXTGEN_CONTRACT } from '../../simulation/legal/nextgen-contract.ts'
import type { NextgenContractCalibration } from '../../simulation/legal/nextgen-contract.ts'
import type { SupportingKinshipClearance } from '../../simulation/legal/supporting-kinship-clearance.ts'
import {
  B001_SUPPORTING_VERSION, B002_AUTONOMOUS_VERSION, B003_AUTONOMOUS_VERSION, B004_RULE_VERSION,
  B005_NEXTGEN_VERSION, B009_RULE_VERSION, EXPERIMENTAL_B009_CALIBRATION,
} from '../../simulation/rules/b/index.ts'
import type { B001SupportingInput } from '../../simulation/rules/b/index.ts'
import { ADYN02_RULE_VERSION, ORDINARY_MARRIAGE_VERSION, SPOUSE_DEATH_DISSOLUTION_VERSION, REVIEWED_LEGAL_VERSION }
  from '../../simulation/rules/a/index.ts'
import { EXPERIMENTAL_TUNING } from '../../simulation/tuning.ts'
import { supportingCandidateId } from '../../simulation/population/supporting-marriage.ts'
import type { SupportingMarriageCohort } from '../../simulation/population/supporting-marriage.ts'
import { createExperimentalWorld, NALVEN_DYNASTY_ID } from './world-1250.ts'
import { createExperimentalOrdinaryLegalTrial } from './ordinary-legal-trial.ts'
import type { ProvenanceEntry } from './provenance.ts'

export const MULTI_HOUSE_CONFIG_ID = 'experimental-multi-house-v0'
export const MULTI_HOUSE_START_YEAR = 1250
export const MULTI_HOUSE_END_YEAR = 1350
/** 既存統合構成(INTEGRATED_SEED)と比較しやすい主試遊seed。 */
export const MULTI_HOUSE_SEED = 20260101
/** 主seed以外の少数固定seed（成功例の選別をしない。全seedで同じ構成・同じ報告形式）。 */
export const MULTI_HOUSE_EXTRA_SEEDS = Object.freeze([20260202, 20260303]) as readonly number[]
export const MULTI_HOUSE_GOAL = Object.freeze({ dynastyId: NALVEN_DYNASTY_ID })

/** エルディア4地方の有力層集団 → 供給源となる所属家門（各集団の支持が最大の家門）。CALIBRATION_ONLY。 */
export const MULTI_HOUSE_SUPPLY_GROUPS = Object.freeze([
  { groupId: 'group-central-elite', houseId: 'house-nalven', key: 'central' },
  { groupId: 'group-west-elite', houseId: 'house-vargas', key: 'west' },
  { groupId: 'group-east-elite', houseId: 'house-cardon', key: 'east' },
  { groupId: 'group-south-elite', houseId: 'house-rowen', key: 'south' },
] as const)

/** 候補供給の校正値。値を変える場合はこの表だけを変更し、identityにも自動的に反映される。 */
export const MULTI_HOUSE_SUPPLY = Object.freeze({
  /** 初期人口(1250年以前出生)の未個別化の成人。各集団・性別ごと。 */
  initialBirthYears: Object.freeze([1224, 1228, 1232, 1236]) as readonly number[],
  initialMembersPerCohort: 2,
  /** C004匿名出生履歴(1250〜)から毎年各集団へ置く後年コホート。性別は年の偶奇で交互。 */
  laterFirstBirthYear: 1250,
  laterLastBirthYear: 1300,
  laterMembersPerCohort: 1,
  limits: Object.freeze({ maxRecordsPerYear: 2, maxAliveSupporting: 24, perCohortSamples: 1, maximumPreviewAge: 60 }),
})

const sexForYear = (y: number): 'MALE' | 'FEMALE' => (y % 2 === 0 ? 'FEMALE' : 'MALE')

// 成人時の独立した試験名簿で、該当コホートの唯一の構成員（ordinal 0）を確認したという前提。
// C004の実出生数から成人生存を推定せず、この名簿から禁親や信頼も導かない。
const TEST_LATER_SURVIVOR_RECORDS: ReadonlyMap<Id, Id> = new Map([
  ['multi-house:c004:east:1250:female', 'fixture:eldia-east:1268:adult-roll:1250-female-0'],
  ['multi-house:c004:west:1253:male', 'fixture:eldia-west:1271:adult-roll:1253-male-0'],
])

function buildCohorts(): SupportingMarriageCohort[] {
  const out: SupportingMarriageCohort[] = []
  for (const g of MULTI_HOUSE_SUPPLY_GROUPS) {
    for (const birthYear of MULTI_HOUSE_SUPPLY.initialBirthYears) {
      for (const sex of ['MALE', 'FEMALE'] as const) {
        const id = `multi-house:initial:${g.key}:${birthYear}:${sex.toLowerCase()}`
        out.push({
          cohortId: id, groupId: g.groupId, affiliationHouseId: g.houseId,
          familyPoolId: `multi-house:family-pool:${id}`, // 供給源ラベル。無血縁の証明ではない。
          tier: 'REGIONAL_LOWER_NOBILITY', sex, birthYear,
          memberCount: MULTI_HOUSE_SUPPLY.initialMembersPerCohort,
          source: 'INITIAL_POPULATION', sourceEvidenceId: `multi-house:initial-census:${g.key}:${birthYear}`,
          provenance: 'CALIBRATION_ONLY',
        })
      }
    }
    for (let birthYear = MULTI_HOUSE_SUPPLY.laterFirstBirthYear; birthYear <= MULTI_HOUSE_SUPPLY.laterLastBirthYear; birthYear++) {
      const sex = sexForYear(birthYear)
      const id = `multi-house:c004:${g.key}:${birthYear}:${sex.toLowerCase()}`
      out.push({
        cohortId: id, groupId: g.groupId, affiliationHouseId: g.houseId,
        familyPoolId: `multi-house:family-pool:${id}`,
        tier: 'REGIONAL_LOWER_NOBILITY', sex, birthYear,
        memberCount: MULTI_HOUSE_SUPPLY.laterMembersPerCohort,
        source: 'C004_COHORT', sourceEvidenceId: `multi-house:c004-birth:${g.key}:${birthYear}`,
        survivorAttestationId: TEST_LATER_SURVIVOR_RECORDS.get(id) ?? `multi-house:survivor-census:${g.key}:${birthYear}`,
        provenance: 'CALIBRATION_ONLY',
      })
    }
  }
  return out
}
export const MULTI_HOUSE_SUPPORTING_COHORTS: readonly SupportingMarriageCohort[] = Object.freeze(buildCohorts())
export const MULTI_HOUSE_SUPPORTING_LIMITS = MULTI_HOUSE_SUPPLY.limits

/** 個別化された場合の候補ID（cohort×ordinalで決定的）。 */
export function multiHouseSupportingIds(): readonly string[] {
  return MULTI_HOUSE_SUPPORTING_COHORTS.flatMap(c =>
    Array.from({ length: c.memberCount }, (_, i) => supportingCandidateId(c.cohortId, i)))
}

export const MULTI_HOUSE_AUTONOMY: AutonomyCalibration = Object.freeze({
  status: 'CALIBRATION_ONLY',
  birth: { minMotherAge: 18, maxMotherAge: 40, minFatherAge: 18, chancePermille: 150 },
  death: { minAge: 1, riskStartAge: 45, basePermille: 4, increasePerYearPermille: 14, maxPermille: 900 },
  marriage: { minAdultAge: 18, maxCandidatePairs: 2400 },
}) as AutonomyCalibration

export const MULTI_HOUSE_NEXTGEN_CONTRACT: NextgenContractCalibration = Object.freeze({
  ...EXPERIMENTAL_NEXTGEN_CONTRACT,
  ownDynastyBonus: 2, otherDynastyCost: 0, titleWeight: 4, noClauseCost: 5, supportWeight: 0,
})

export const MULTI_HOUSE_B009_CALIBRATION = Object.freeze({
  ...EXPERIMENTAL_B009_CALIBRATION,
  initialTrust: 24, initialTrustSpread: 16, annualDelta: 1, houseSupportWeight: 0, sameHouseBonus: 0, maxPairs: 2400,
})

/** 個別の架空試験台帳。各行は当該ペアについて別々の系譜調査を行い、
 * 禁親範囲に共通祖先が見つからなかったという試験前提である。実在資料でも世界設定でもない。
 * 家門差・人口出典・性別を証拠として導出しない。掲載のないペアや期限切れの調査は未確認のまま扱う。
 */
const TEST_INITIAL_KINSHIP_RECORDS = [
  { personId: 'person-exp-02', cohortId: 'multi-house:initial:west:1232:female', ordinal: 0, record: 'fixture:west-1232-0:pedigree-review-02' },
  { personId: 'person-exp-02', cohortId: 'multi-house:initial:east:1228:female', ordinal: 0, record: 'fixture:east-1228-0:pedigree-review-02' },
  { personId: 'person-exp-03', cohortId: 'multi-house:initial:west:1228:male', ordinal: 0, record: 'fixture:west-1228-0:pedigree-review-03' },
  { personId: 'person-exp-03', cohortId: 'multi-house:initial:east:1232:male', ordinal: 0, record: 'fixture:east-1232-0:pedigree-review-03' },
] as const
const TEST_LATER_KINSHIP_RECORDS = [
  { personId: 'person-exp-06', cohortId: 'multi-house:c004:east:1250:female', ordinal: 0,
    record: 'fixture:eldia-east:1268:pedigree-review:06-1250-female-0',
    countryId: 'country-eldia', checkedYear: 1268, validUntilYear: 1288 },
  { personId: 'person-exp-03', cohortId: 'multi-house:c004:west:1253:male', ordinal: 0,
    record: 'fixture:eldia-west:1271:pedigree-review:03-1253-male-0',
    countryId: 'country-eldia', checkedYear: 1271, validUntilYear: 1291 },
] as const

function buildClearances(): SupportingKinshipClearance[] {
  const records = [
    ...TEST_INITIAL_KINSHIP_RECORDS.map(r => ({ ...r, countryId: 'country-eldia', checkedYear: 1250, validUntilYear: 1280 })),
    ...TEST_LATER_KINSHIP_RECORDS,
  ]
  return records.map(r => {
    const ids = [r.personId, supportingCandidateId(r.cohortId, r.ordinal)].sort() as [string, string]
    return { clearanceId: `multi-house:kinship-check:${JSON.stringify(ids)}`, personIds: ids,
      countryId: r.countryId, checkedYear: r.checkedYear, validUntilYear: r.validUntilYear,
      sourceEvidenceId: r.record, provenance: 'CALIBRATION_ONLY' }
  })
}
/** 探索対象の試験設定。証拠とは独立した入力であり、選択自体は禁親の承認ではない。 */
const MULTI_HOUSE_CANDIDATE_PAIRS: readonly (readonly [Id, Id])[] = Object.freeze([
  ['person-exp-02', supportingCandidateId('multi-house:initial:west:1232:female', 0)],
  ['person-exp-02', supportingCandidateId('multi-house:initial:east:1228:female', 0)],
  ['person-exp-03', supportingCandidateId('multi-house:initial:west:1228:male', 0)],
  ['person-exp-03', supportingCandidateId('multi-house:initial:east:1232:male', 0)],
  ['person-exp-06', supportingCandidateId('multi-house:c004:east:1250:female', 0)],
  ['person-exp-03', supportingCandidateId('multi-house:c004:west:1253:male', 0)],
])
/** 明示した初期関係値は無し。新規ペアの初期値はB-009の校正値(initialTrust+決定的な個体差)で与える。 */
export const MULTI_HOUSE_TRUST_BASE: readonly PairTrustBase[] = Object.freeze([]) as readonly PairTrustBase[]

/** 未登録ペアに限るCALIBRATION_ONLYの関係値。探索対象・禁親台帳の有無から信頼を導出しない。 */
const MULTI_HOUSE_CANDIDATE_TRUST_BASE: readonly PairTrustBase[] = [
  { personIds: MULTI_HOUSE_CANDIDATE_PAIRS[0]!, value: 40 },
  { personIds: MULTI_HOUSE_CANDIDATE_PAIRS[1]!, value: 35 },
  { personIds: MULTI_HOUSE_CANDIDATE_PAIRS[2]!, value: 35 },
  { personIds: MULTI_HOUSE_CANDIDATE_PAIRS[3]!, value: 40 },
  // 後年候補の試験基準値。既存候補の35と同じ値で、年・乱数seed・証拠の有無に連動しない。
  { personIds: ['person-exp-06', supportingCandidateId('multi-house:c004:east:1250:female', 0)], value: 35 },
  { personIds: ['person-exp-03', supportingCandidateId('multi-house:c004:west:1253:male', 0)], value: 35 },
]

export const MULTI_HOUSE_SUPPORTING_CLEARANCES: readonly SupportingKinshipClearance[] = Object.freeze(buildClearances())

/** C004匿名出生履歴を空から蓄積させる初期世界。重要人物は初期8人のまま増やさない。 */
export function createMultiHouseWorld(): WorldState {
  const w = createExperimentalWorld()
  return { ...w, demographics: { ...w.demographics, anonymousBirthHistory: [] } }
}

export function createMultiHouseEvaluators(startWorld: WorldState, ledger: readonly StatModifier[] = []): EvaluatorMap {
  const trial = createExperimentalOrdinaryLegalTrial()
  const cfg = createAutonomousCalibrationEvaluators({
    branchStartWorld: startWorld, ledger, trustBase: MULTI_HOUSE_TRUST_BASE,
    nextgenMarriage: {
      book: trial.book, laws: trial.laws, calibration: MULTI_HOUSE_NEXTGEN_CONTRACT,
      supportingKinshipClearances: MULTI_HOUSE_SUPPORTING_CLEARANCES,
    },
    reviewedLegal: { book: trial.book, ordinaryLaws: trial.laws },
    spouseDeathDissolution: true,
    supportingMarriage: supportingInput(),
    supportingCandidateTrustBase: MULTI_HOUSE_CANDIDATE_TRUST_BASE,
    autonomy: MULTI_HOUSE_AUTONOMY,
    b009Calibration: MULTI_HOUSE_B009_CALIBRATION,
  })
  if (!cfg.ok) throw new Error('INVALID_MULTI_HOUSE_EVALUATORS:' + cfg.issues.join('; '))
  return cfg.evaluators
}

/** 供給の絞り込みは法的証拠に依存しない。記録は禁親審査の承認を意味しない。 */
function supportingInput(): B001SupportingInput {
  return { cohorts: MULTI_HOUSE_SUPPORTING_COHORTS, ...MULTI_HOUSE_SUPPORTING_LIMITS, candidatePairs: MULTI_HOUSE_CANDIDATE_PAIRS }
}

/** 主試遊の実行条件。seedと介入ledgerは構成identityには含めない(A側の別キーで識別する)。 */
export const MULTI_HOUSE_RUN_CONDITIONS = Object.freeze({
  configId: MULTI_HOUSE_CONFIG_ID,
  startYear: MULTI_HOUSE_START_YEAR, endYear: MULTI_HOUSE_END_YEAR,
  primarySeed: MULTI_HOUSE_SEED, extraSeeds: MULTI_HOUSE_EXTRA_SEEDS,
  goal: MULTI_HOUSE_GOAL, technicalGoalEvaluation: true,
})

/**
 * 実行構成identity(読み取り専用, JSON.stringify可能)。createMultiHouseEvaluators が評価器へ渡す法令・証拠・校正・
 * 供給コホート・禁親証拠・信頼基準と、createMultiHouseWorld の初期世界・各ルール版を、同じ定数/関数から都度導出する。
 * 手書きの固定値を持たないため、いずれかが変われば自動的に値が変わる(A0キャッシュの誤再利用を防ぐ)。
 * seed・介入ledger・開始年のWorldStateは含めない。値の変更や計算には関与しない。
 */
export function multiHouseRunConfigIdentity(): Readonly<Record<string, unknown>> {
  const trial = createExperimentalOrdinaryLegalTrial()
  return {
    configId: MULTI_HOUSE_CONFIG_ID,
    world: createMultiHouseWorld(),
    tuning: EXPERIMENTAL_TUNING,
    book: trial.book, laws: trial.laws,
    nextgenContract: MULTI_HOUSE_NEXTGEN_CONTRACT,
    supporting: supportingInput(), supportingKinshipClearances: MULTI_HOUSE_SUPPORTING_CLEARANCES,
    trustBase: MULTI_HOUSE_TRUST_BASE, supportingCandidateTrustBase: structuredClone(MULTI_HOUSE_CANDIDATE_TRUST_BASE),
    autonomy: MULTI_HOUSE_AUTONOMY, b009: MULTI_HOUSE_B009_CALIBRATION,
    spouseDeathDissolution: true,
    ruleVersions: {
      b001Supporting: B001_SUPPORTING_VERSION, b002: B002_AUTONOMOUS_VERSION, b003: B003_AUTONOMOUS_VERSION,
      b004: B004_RULE_VERSION, b005: B005_NEXTGEN_VERSION, b009: B009_RULE_VERSION,
      aDyn02: ADYN02_RULE_VERSION, aLeg01: ORDINARY_MARRIAGE_VERSION,
      spouseDeath: SPOUSE_DEATH_DISSOLUTION_VERSION, reviewedLegal: REVIEWED_LEGAL_VERSION,
    },
    runConditions: { startYear: MULTI_HOUSE_START_YEAR, endYear: MULTI_HOUSE_END_YEAR, goal: MULTI_HOUSE_GOAL },
  }
}

/** identityの短い比較用ダイジェスト(FNV-1a 2系統の連結, 暗号用途ではない)。キー順に依存しない正規化JSONから算出。 */
export function multiHouseRunConfigDigest(): string {
  return digestMultiHouseIdentity(multiHouseRunConfigIdentity())
}

export function digestMultiHouseIdentity(identity: Readonly<Record<string, unknown>>): string {
  const canon = (v: unknown): unknown =>
    Array.isArray(v) ? v.map(canon)
      : v && typeof v === 'object' ? Object.fromEntries(Object.entries(v as Record<string, unknown>)
        .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([k, x]) => [k, canon(x)]))
        : v
  const text = JSON.stringify(canon(identity))
  let h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0xdeadbeef
  for (let i = 0; i < text.length; i++) {
    const c = text.charCodeAt(i)
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0
    h2 = Math.imul(h2 + c + i, 0x85ebca6b) >>> 0
  }
  return h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')
}

/** 人物の出所。重要人物(初期8人)・人口由来SUPPORTING・実出生を区別する(全人口はPersonに変換しない)。 */
export type MultiHousePersonOrigin = 'INITIAL_KEY' | 'POPULATION_SUPPORTING' | 'AUTONOMOUS_BIRTH' | 'OTHER'
export type MultiHousePersonRecord = Readonly<{
  personId: Id
  origin: MultiHousePersonOrigin
  sex: 'MALE' | 'FEMALE'
  birthYear: number
  alive: boolean
  houseId: Id
  originGroupId: Id
  legalDynasty: WorldState['persons'][number]['legalDynasty']
  fatherId: Id | null
  motherId: Id | null
  /** 確定婚姻Eventに記録された人口出典。構成上のコホート定義で補完しない。 */
  population: Readonly<{ cohortId: Id; memberOrdinal: number; birthBacking: 'INITIAL_POPULATION' | 'C004_COHORT'
    sourceEvidenceId: Id; survivorAttestationId: Id | null; familyPoolId: Id }> | null
}>

const INITIAL_KEY_IDS: ReadonlySet<Id> = new Set(createExperimentalWorld().persons.map(p => p.personId))

/** 同じ履歴の確定EventLogがある場合だけ、実登録された人口出典を表示する。 */
export function multiHousePersonRecords(world: WorldState, events: readonly EventLogEntry[] = []): readonly MultiHousePersonRecord[] {
  const marriages = new Map(world.legal.marriages.map(m => [m.marriageId, m]))
  const registered = new Map<Id, SupportingPersonRegistration | null>()
  for (const event of events) {
    if (event.eventType !== 'MARRIAGE_REGISTER' || event.year > world.year) continue
    for (const row of event.supportingMarriageRegistrations ?? []) {
      const r = row.registration
      const id = r.person.personId
      const marriage = marriages.get(row.marriageId)
      if (marriage?.registeredYear !== event.year || !marriage.personIds.includes(id) ||
        !event.sourceTraceIds.includes(row.sourceTraceId) ||
        id !== supportingCandidateId(r.cohortId, r.memberOrdinal)) continue
      registered.set(id, registered.has(id) ? null : r)
    }
  }
  return world.persons.map((p): MultiHousePersonRecord => {
    const r = registered.get(p.personId)
    const registration = r && p.interactionRole === 'SUPPORTING' && r.person.sex === p.sex &&
      r.person.birthYear === p.birthYear && r.person.originGroupId === p.originGroupId ? r : null
    const origin: MultiHousePersonOrigin = INITIAL_KEY_IDS.has(p.personId) ? 'INITIAL_KEY'
      : registration ? 'POPULATION_SUPPORTING'
        : p.interactionRole !== 'SUPPORTING' && (p.fatherId !== undefined || p.motherId !== undefined) ? 'AUTONOMOUS_BIRTH' : 'OTHER'
    return {
      personId: p.personId, origin, sex: p.sex, birthYear: p.birthYear, alive: p.alive,
      houseId: p.houseId, originGroupId: p.originGroupId, legalDynasty: p.legalDynasty,
      fatherId: p.fatherId ?? null, motherId: p.motherId ?? null,
      population: origin === 'POPULATION_SUPPORTING' && registration ? {
        cohortId: registration.cohortId, memberOrdinal: registration.memberOrdinal,
        birthBacking: registration.birthBacking, sourceEvidenceId: registration.sourceEvidenceId,
        survivorAttestationId: registration.survivorAttestationId ?? null, familyPoolId: registration.familyPoolId,
      } : null,
    }
  })
}

export const MULTI_HOUSE_PROVENANCE: readonly ProvenanceEntry[] = Object.freeze([
  { subject: '複数家門試遊構成(初期8人+人口由来SUPPORTING+自律出生)', origin: 'PLACEHOLDER',
    source: 'docs/decisions DEC-057/058/061, Issue #114',
    note: 'CALIBRATION_ONLY。供給コホート・禁親証拠台帳・校正係数は試験値。婚姻/出生/死亡/王朝所属/相続の成立を予約せず、正式世界設定・Goal達成を示さない。' },
  { subject: '子の家門(母のhouseId継承)', origin: 'PLACEHOLDER', source: 'src/simulation/rules/b/b002-worldstate.ts',
    note: 'B-002のCALIBRATION_ONLY実装であり、一般的な家門継承法として採用していない。' },
])
