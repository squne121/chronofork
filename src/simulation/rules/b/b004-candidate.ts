// B-004 縁談候補評価の CALIBRATION_ONLY 技術版。pair.trust（PairTrustView）→ 候補スコア → 試験判定を DecisionTrace に残す。
// - 実装済みなのは「明示された PERSON_PAIR の読み取り評価」のみ。候補の探索・自動生成・結婚可能年齢/相性/身分差/婚姻法は未承認のため扱わない。
// - ACCEPT は「試験候補が採択された」という Trace のみ。MARRIAGE_REGISTER・EventLog・法的判断・出生・勝敗は作らない（commands は常に空）。
// - しきい値と重みは外部設定で、採用済みゲーム法則ではない。RuleRegistry は TODO のまま。呼出側が RunOptions.evaluators に明示注入した時だけ動く。
import type { DecisionTraceDraft, Id, JsonValue, RuleOutcome, WorldState } from '../../contracts/index.ts'
import { EvaluationFailure } from '../../engine/evaluators.ts'
import type { EvaluationContext, EvaluatorMap, RuleEvaluator } from '../../engine/evaluators.ts'
import type { PairTrustView } from '../../intervention/index.ts'
import { PAIR_TRUST_DEFINITION, normalizePersonPair, pairKey } from '../../intervention/index.ts'

export const B004_RULE_ID = 'B-004' as const
export const B004_CALIBRATION_REASON = 'CALIBRATION_ONLY'
export const B004_TECHNICAL_ONLY_REASON = 'B004_TECHNICAL_ONLY'
export const B004_NO_MARRIAGE_REASON = 'NO_MARRIAGE_REGISTERED'
/** 婚姻適格性・合法性は未審査。ACCEPT は信頼スコアの技術的採否のみで、婚姻の可否を意味しない。 */
export const B004_ELIGIBILITY_UNREVIEWED_REASON = 'MARRIAGE_ELIGIBILITY_UNREVIEWED'
export const B004_KINSHIP_UNREVIEWED_REASON = 'KINSHIP_UNREVIEWED'
export const B004_RULE_VERSION = 'b004-calibration-0:B-004:pair-trust-candidate:CALIBRATION_ONLY'

/** 試験用の外部設定。値は仮値で、実値はテストが記録する。 */
export type B004Calibration = Readonly<{
  status: 'CALIBRATION_ONLY'
  /** score = effectiveTrust * trustWeight。 */
  trustWeight: number
  /** score >= acceptThreshold で「試験候補採択」。 */
  acceptThreshold: number
}>

export const EXPERIMENTAL_B004_CALIBRATION: B004Calibration = Object.freeze({
  status: 'CALIBRATION_ONLY',
  trustWeight: 1,
  acceptThreshold: 30,
})

export type B004Input = Readonly<{
  /** 評価対象の人物ペア（任意順）。ここに無い人物の組は探索しない。 */
  pairs: readonly (readonly [Id, Id])[]
  view: PairTrustView
  calibration?: B004Calibration
}>

export type B004Issue = Readonly<{ code: 'INVALID_PAIR' | 'INVALID_CALIBRATION'; path: string; message: string }>

const isSafeInt = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v)

/** 区切り文字を含む ID でも衝突しない JSON 符号化（pairKey）。 */
const candidateIdOf = (ids: readonly [Id, Id]) => `b004:${pairKey(ids)}`

/** pair.trust の絶対値上限（校正値域）に対し score が安全整数に収まる trustWeight の上限。 */
export const B004_MAX_TRUST_WEIGHT = Math.floor(Number.MAX_SAFE_INTEGER / Math.max(Math.abs(PAIR_TRUST_DEFINITION.min), Math.abs(PAIR_TRUST_DEFINITION.max)))

/** WorldState に明示された親子・同親の兄弟姉妹。明示データのみで推測しない（他の血縁度は未審査のまま）。 */
function knownKinship(a: { personId: Id; fatherId?: Id; motherId?: Id }, b: { personId: Id; fatherId?: Id; motherId?: Id }): 'PARENT_CHILD' | 'SIBLING' | null {
  if ([a.fatherId, a.motherId].includes(b.personId) || [b.fatherId, b.motherId].includes(a.personId)) return 'PARENT_CHILD'
  const shared = (x?: Id, y?: Id) => x !== undefined && x === y
  if (shared(a.fatherId, b.fatherId) || shared(a.motherId, b.motherId)) return 'SIBLING'
  return null
}

/**
 * 設定を検証して評価器を作る。不正なペア（自己ペア・空 ID）や設定は fail-closed（評価器を作らない）。
 * 重複ペア（(A,B) と (B,A) を含む）は 1 件へ畳み、入力配列の順序は結果に影響しない（pairKey 昇順で評価）。
 */
export function createB004CalibrationEvaluator(
  input: B004Input,
): Readonly<{ ok: true; evaluator: RuleEvaluator }> | Readonly<{ ok: false; issues: readonly B004Issue[] }> {
  const cal = input.calibration ?? EXPERIMENTAL_B004_CALIBRATION
  const issues: B004Issue[] = []
  if (cal.status !== 'CALIBRATION_ONLY') issues.push({ code: 'INVALID_CALIBRATION', path: 'status', message: 'CALIBRATION_ONLY の設定のみ受け付けます' })
  if (!isSafeInt(cal.trustWeight) || cal.trustWeight < 0 || cal.trustWeight > B004_MAX_TRUST_WEIGHT) issues.push({ code: 'INVALID_CALIBRATION', path: 'trustWeight', message: `trustWeight は 0 以上 ${B004_MAX_TRUST_WEIGHT} 以下の整数が必要です（score を安全整数に収めるため）` })
  if (!isSafeInt(cal.acceptThreshold)) issues.push({ code: 'INVALID_CALIBRATION', path: 'acceptThreshold', message: 'acceptThreshold は安全な整数が必要です' })
  if (!Array.isArray(input.pairs)) issues.push({ code: 'INVALID_PAIR', path: 'pairs', message: 'pairs は配列が必要です' })

  const byKey = new Map<string, readonly [Id, Id]>()
  if (Array.isArray(input.pairs)) {
    input.pairs.forEach((p, i) => {
      const ids = Array.isArray(p) && p.length === 2 ? normalizePersonPair(p[0], p[1]) : null
      if (ids === null) issues.push({ code: 'INVALID_PAIR', path: `pairs[${i}]`, message: '空でない相異な人物 ID 2 件が必要です' })
      else byKey.set(pairKey(ids), ids)
    })
  }
  if (issues.length > 0) return { ok: false, issues }

  const pairs = [...byKey.entries()].sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, ids]) => ids)
  const view = input.view
  const frozenCal: B004Calibration = Object.freeze({ ...cal })

  const evaluator: RuleEvaluator = (world: WorldState, ctx: EvaluationContext): RuleOutcome => {
    if (ctx.ruleId !== B004_RULE_ID || ctx.phase !== 3) {
      throw new EvaluationFailure('B-004 評価器は B-004（フェーズ 3）以外では実行できません', [{ code: 'RULE_MISMATCH', message: `${String(ctx.ruleId)} / phase ${String(ctx.phase)}` }])
    }
    if (world.year !== ctx.year) {
      throw new EvaluationFailure('WorldState の年と評価年が一致しません', [{ code: 'YEAR_MISMATCH', message: `${world.year} != ${ctx.year}` }])
    }
    const traceDrafts = pairs.map((ids) => draftOf(world, ctx, view, frozenCal, ids))
    return { ruleId: ctx.ruleId, phase: ctx.phase, commands: [], requests: [], deferred: [], traceDrafts }
  }
  return { ok: true, evaluator }
}

function draftOf(world: WorldState, ctx: EvaluationContext, view: PairTrustView, cal: B004Calibration, ids: readonly [Id, Id]): DecisionTraceDraft {
  const candidateId = candidateIdOf(ids)
  const base = { year: ctx.year, phase: ctx.phase, ruleId: ctx.ruleId, actorRef: { kind: 'PERSON_PAIR', ids } as const, ruleVersion: B004_RULE_VERSION }
  const tag = [B004_CALIBRATION_REASON, B004_TECHNICAL_ONLY_REASON, B004_NO_MARRIAGE_REASON, B004_ELIGIBILITY_UNREVIEWED_REASON]
  const persons = ids.map((id) => world.persons.find((p) => p.personId === id))
  const baseInputs: Record<string, JsonValue> = {
    personIds: [ids[0], ids[1]],
    trustWeight: cal.trustWeight,
    acceptThreshold: cal.acceptThreshold,
  }
  const deferOrReject = (status: 'DEFER' | 'REJECT', eligible: boolean, reason: string, extra: Record<string, JsonValue> = {}, modifierIds: readonly Id[] = []): DecisionTraceDraft => ({
    ...base,
    candidates: [{ candidateId, eligible, inputs: { ...baseInputs, ...extra }, reasonCodes: [B004_CALIBRATION_REASON, reason] }],
    status,
    reasonCodes: [...tag, reason],
    modifierIds,
  })

  if (persons.some((p) => p === undefined)) {
    return deferOrReject('DEFER', false, 'PERSON_NOT_FOUND', { missingPersonIds: ids.filter((_, i) => persons[i] === undefined) })
  }
  const dead = ids.filter((_, i) => persons[i]!.alive !== true)
  if (dead.length > 0) return deferOrReject('REJECT', false, 'PERSON_DECEASED', { deceasedPersonIds: dead })

  const kin = knownKinship(persons[0]!, persons[1]!)
  if (kin !== null) return deferOrReject('DEFER', false, B004_KINSHIP_UNREVIEWED_REASON, { knownKinship: kin })

  const r = view.resolve(ids[0], ids[1], ctx.year)
  if (r === null) return deferOrReject('DEFER', false, 'TRUST_UNRESOLVED')
  if (r.status === 'NO_BASE') return deferOrReject('DEFER', false, 'NO_BASE_TRUST', {}, r.modifierIds)

  const score = r.effective * cal.trustWeight
  const accepted = score >= cal.acceptThreshold
  const reason = accepted ? 'SCORE_AT_OR_ABOVE_THRESHOLD' : 'SCORE_BELOW_THRESHOLD'
  return {
    ...base,
    candidates: [{
      candidateId,
      eligible: true,
      inputs: { ...baseInputs, baseTrust: r.base, rawModifierSum: r.rawModifierSum, effectiveTrust: r.effective, modifierIds: [...r.modifierIds] },
      score,
      threshold: cal.acceptThreshold,
      reasonCodes: [B004_CALIBRATION_REASON, reason],
    }],
    ...(accepted ? { selectedCandidateId: candidateId } : {}),
    status: accepted ? 'ACCEPT' : 'REJECT',
    reasonCodes: [...tag, reason],
    modifierIds: [...r.modifierIds],
  }
}

/** RunOptions.evaluators に渡す CALIBRATION_ONLY の注入表。Registry の状態は変えない。他ルールの評価器と呼出側で合成する。 */
export const createB004EvaluatorMap = (evaluator: RuleEvaluator): EvaluatorMap => ({ [B004_RULE_ID]: evaluator })
