// 1350 年の勝利判定 evaluateGoal（契約 §5 / mvp-spec §3）。純粋関数。
// 世界は読み取りのみで、相続・承認・委任の補完や自動付替えは行わない（GAME-01/02/03）。
import type { ControllerRef, Id, Person, Region, Title, WorldState, Year } from './contracts/index.ts'
import { GOAL_YEAR } from './contracts/index.ts'
import type { Diagnostic } from './validation/index.ts'
import { validateWorldState } from './validation/index.ts'

export type GoalOptions = Readonly<{
  /** 勝利対象の法的王朝 ID（ナルヴェン）。シナリオ側から注入し、特定の ID を固定しない。 */
  dynastyId: Id
}>

/** 個別の Title が勝利根拠にならない理由。 */
export type GoalFailureCode =
  | 'NOT_TERRITORIAL' // CROWN は勝利にならない
  | 'TITLE_INVALID'
  | 'TITLE_NOT_HEREDITARY'
  | 'TITLE_NOT_RECOGNIZED' // PENDING / REVOKED / 承認根拠不足
  | 'HOLDER_UNDETERMINED'
  | 'HOLDER_NOT_FOUND'
  | 'HOLDER_DEAD'
  | 'DYNASTY_UNDETERMINED'
  | 'DYNASTY_MISMATCH'
  | 'REGION_NOT_FOUND'
  | 'NO_CONTROL' // 直接支配も有効な ControlMandate も無い

export type GoalBasis =
  | Readonly<{ kind: 'DIRECT_CONTROL' }>
  | Readonly<{ kind: 'CONTROL_MANDATE'; mandateId: Id }>

export type TitleAssessment = Readonly<{
  titleId: Id
  holderPersonId: Id | null
  qualifies: boolean
  /** qualifies のとき空。複数該当する場合は全て列挙する。 */
  failures: readonly GoalFailureCode[]
  basis: GoalBasis | null
}>

export type GoalEvaluation =
  /** 入力が WorldState として不正（データ破損）。ゲーム内の敗北ではない。 */
  | Readonly<{ status: 'INVALID_INPUT'; diagnostics: readonly Diagnostic[] }>
  /** 1350 年以外は評価対象外。勝敗を返さない。 */
  | Readonly<{ status: 'NOT_EVALUABLE'; year: Year }>
  | Readonly<{ status: 'ACHIEVED'; assessments: readonly TitleAssessment[] }>
  /** 検証済みの世界で条件を満たさない、通常のゲーム内の敗北。 */
  | Readonly<{ status: 'NOT_ACHIEVED'; assessments: readonly TitleAssessment[] }>

function sameRef(a: ControllerRef, b: ControllerRef): boolean {
  return a.kind === b.kind && a.id === b.id
}

function assessTitle(
  world: WorldState,
  title: Title,
  dynastyId: Id,
  persons: ReadonlyMap<Id, Person>,
  regions: ReadonlyMap<Id, Region>,
): TitleAssessment {
  const failures: GoalFailureCode[] = []
  let basis: GoalBasis | null = null
  let holderPersonId: Id | null = null

  if (title.kind !== 'TERRITORIAL') failures.push('NOT_TERRITORIAL')
  if (!title.valid) failures.push('TITLE_INVALID')
  if (!title.hereditary) failures.push('TITLE_NOT_HEREDITARY')
  const rec = title.recognition
  if (rec.status !== 'ACTIVE' || rec.authority === undefined || rec.sourceDecisionId === undefined) {
    failures.push('TITLE_NOT_RECOGNIZED')
  }

  let holder: Person | undefined
  if (title.holder.status !== 'HELD') {
    failures.push('HOLDER_UNDETERMINED')
  } else {
    holderPersonId = title.holder.personId
    holder = persons.get(holderPersonId)
    if (holder === undefined) failures.push('HOLDER_NOT_FOUND')
  }
  if (holder !== undefined) {
    if (!holder.alive) failures.push('HOLDER_DEAD')
    if (holder.legalDynasty.status !== 'DETERMINED') failures.push('DYNASTY_UNDETERMINED')
    else if (holder.legalDynasty.dynastyId !== dynastyId) failures.push('DYNASTY_MISMATCH')
  }

  const region = regions.get(title.regionId)
  if (region === undefined) {
    failures.push('REGION_NOT_FOUND')
  } else if (holderPersonId !== null) {
    const holderRef: ControllerRef = { kind: 'PERSON', id: holderPersonId }
    if (sameRef(region.deFactoControllerRef, holderRef)) {
      basis = { kind: 'DIRECT_CONTROL' }
    } else {
      // 委任は region・title・実際の支配者・受益者・有効期間をすべて照合する。
      const m = world.legal.controlMandates.find(
        (c) =>
          c.regionId === title.regionId &&
          c.authorizingTitleId === title.titleId &&
          c.beneficiaryPersonId === holderPersonId &&
          sameRef(c.controllerRef, region.deFactoControllerRef) &&
          c.effectiveFromYear <= GOAL_YEAR &&
          GOAL_YEAR < c.endExclusiveYear,
      )
      if (m !== undefined) basis = { kind: 'CONTROL_MANDATE', mandateId: m.mandateId }
    }
    if (basis === null) failures.push('NO_CONTROL')
  }

  return { titleId: title.titleId, holderPersonId, qualifies: failures.length === 0, failures, basis: failures.length === 0 ? basis : null }
}

/**
 * 1350 年の WorldState から勝利条件を判定する。入力は変更しない。
 * 勝利: 存命で法的王朝が `dynastyId` に DETERMINED の人物が、有効・ACTIVE 承認済み・世襲の TERRITORIAL Title を保持し、
 * その Region を直接支配するか、Title と Region に一致する有効な ControlMandate の受益者である。
 * 国名・家門・王号・CROWN・税収・宗主権/主権のみでは勝利にしない。
 */
export function evaluateGoal(input: unknown, options: GoalOptions): GoalEvaluation {
  const v = validateWorldState(input)
  if (!v.ok || v.world === null) return { status: 'INVALID_INPUT', diagnostics: v.diagnostics }
  const world = v.world
  if (world.year !== GOAL_YEAR) return { status: 'NOT_EVALUABLE', year: world.year }

  const persons = new Map(world.persons.map((p) => [p.personId, p]))
  const regions = new Map(world.regions.map((r) => [r.regionId, r]))
  const assessments = world.titles.map((t) => assessTitle(world, t, options.dynastyId, persons, regions))
  return { status: assessments.some((a) => a.qualifies) ? 'ACHIEVED' : 'NOT_ACHIEVED', assessments }
}
