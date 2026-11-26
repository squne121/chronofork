// 実DecisionTraceに記録された理由コードの日本語表示。コードの意味づけだけで、規則・原因は新設しない。
// 辞書にないコードは「未分類」とし、元のコードは技術詳細に残す（推測で説明を作らない）。
import type { GoalFailureCode } from '../../simulation/goal.ts'

const GOAL_REASON: Readonly<Record<GoalFailureCode, string>> = {
  NOT_TERRITORIAL: '土地の称号ではない', TITLE_INVALID: '称号が無効', TITLE_NOT_HEREDITARY: '世襲できない称号',
  TITLE_NOT_RECOGNIZED: '称号の承認が不足', REQUIRES_RECOGNITION: '現在の主権による承認が必要',
  HOLDER_UNDETERMINED: '保持者が未確定', HOLDER_NOT_FOUND: '保持者の人物記録がない',
  HOLDER_DEAD: '保持者が死亡している', DYNASTY_UNDETERMINED: '法的王朝所属が未確定',
  DYNASTY_MISMATCH: '保持者の法的王朝が対象と異なる', REGION_NOT_FOUND: '対象の地域記録がない',
  NO_CONTROL: '直接支配または有効な統治委任がない',
}

export const goalFailureText = (codes: readonly GoalFailureCode[]) =>
  codes.map(code => GOAL_REASON[code] ?? '未分類の不足条件').join('、') || '理由の記録なし'

/** 通常表示には出さない技術区分コード。 */
const TECHNICAL_ONLY: ReadonlySet<string> = new Set([
  'CALIBRATION_ONLY', 'B004_TECHNICAL_ONLY', 'DISCOVERED_FROM_WORLDSTATE', 'ELIGIBILITY_STILL_UNREVIEWED',
  'DEC_058_CONTRACT_NEGOTIATION', 'DEC_055_PENDING_REVIEW', 'DEC_057_NORMAL_MARRIAGE',
])

const LABELS: Readonly<Record<string, string>> = Object.freeze({
  // B-004 婚姻候補
  NO_MARRIAGE_REGISTERED: '婚姻はまだ成立していない',
  MARRIAGE_ELIGIBILITY_UNREVIEWED: '婚姻の適格性は審査されていない',
  KINSHIP_UNREVIEWED: '血縁関係が記録されており、婚姻適格性の審査は行われていない',
  SCORE_AT_OR_ABOVE_THRESHOLD: '信頼を反映した得点が採用の閾値以上',
  SCORE_BELOW_THRESHOLD: '信頼を反映した得点が採用の閾値未満',
  NO_BASE_TRUST: '2人の信頼基礎値が記録されていないため、候補の判断を保留',
  // B-005 契約交渉
  B004_NOT_ACCEPTED: '婚姻候補として採用されなかったため、契約交渉に進まない',
  B004_CANDIDATE_NOT_ACCEPTED: '婚姻候補として採用されなかったため、契約交渉に進まない',
  B004_SCORE_MISSING: '婚姻候補の審査で使った得点を確認できない',
  MUTUAL_UNIQUE_PARTNER_NOT_ESTABLISHED: '双方にとって単独の最上位候補となる組が確定せず、交渉を保留',
  CONTRACT_AGREEMENT_UNVERIFIED: '双方の同意が確認できないため、交渉を保留',
  NO_BILATERAL_CONSENT: '双方が同意する契約案がなかった',
  CONTRACT_CHOICE_TIE: '同順位の契約案があり、案を一つに確定できなかった',
  COMMON_ANCESTOR_WITHIN_TWO_GENERATIONS: '共通の祖先が2世代以内にいると記録され、契約交渉は成立しない',
  BOTH_PARTIES_ACCEPT_UNIQUE_CONTRACT: '双方が唯一の契約案に同意した',
  // B-002 出生
  AGE_OUTSIDE_CALIBRATION_WINDOW: '親の年齢が出生判定の対象範囲外',
  PARENTS_UNAVAILABLE: '親が不在（死亡等）のため出生は成立しない',
  BIRTH_RNG_NOT_SELECTED: '出生枠・抽選で出生が選ばれなかった',
  WORLDSTATE_RNG_BIRTH_SELECTED: '出生枠と抽選により出生が選ばれた',
  // B-003 死亡
  AGE_RNG_DEATH_SELECTED: '年齢に基づく抽選で死亡が選ばれた',
  BELOW_MIN_MORTALITY_AGE: '死亡判定の対象年齢に達していない',
  // B-001 補助人物
  NO_COHORT_CANDIDATE_AVAILABLE: '婚姻相手として供給できる人口の候補が、記録上いない',
  SUPPORTING_RECORD_BUDGET_EXCEEDED: '補助人物の登録枠を超えるため、供給されない',
  SEEKER_JURISDICTION_UNVERIFIED: '相手を探す人物の管轄が確認できないため、供給されない',
  SUPPORTING_SUPPLY_DEFERRED: '補助人物の供給は見送られた',
  SUPPORTING_CANDIDATE_ONLY: '補助人物の候補を提示したのみ',
  NOT_MARRIAGE_APPROVAL: '婚姻の承認ではない',
  OPEN_EVIDENCE_BACKED_CANDIDATES_AT_LIMIT: '確認記録のある未婚の補助人物候補が上限に達している',
  SUPPORTING_CANDIDATE_BUDGET_EXCEEDED: '補助人物の候補数が上限を超えたため、候補の判断を保留',
  SUPPORTING_REGISTRATION_BUDGET_EXCEEDED: '補助人物の登録枠を超えるため、婚姻登録を保留',
  SUPPORTING_KINSHIP_CLEARANCE_MISMATCH: '補助人物の禁親確認が候補時と婚姻審査時で一致せず、婚姻登録を保留',
  // A-SUC-04 / A-TIT-07 相続・称号
  NO_ESTABLISHED_HEIR: '確立した後継者がいない',
  GAME_02_SUCCESSION_AUTHORITY_UNDETERMINED: '相続の権限を定める規則が未承認のため、後継者は確定しない',
  GAME_02_UNAPPROVED: '相続の承認規則が未承認のため、案件は保留のまま',
  GAME_02_APPROVAL_REQUIRED: '相続の承認が必要',
  GAME_03_NEW_DELEGATION_EVIDENCE_MISSING: '新たな統治委任の証拠がない',
  EXPLICIT_AUTHORITY_AND_HEIR_VERIFIED: '明示された権限と後継者を確認できた',
  EXPLICIT_CROWN_AUTHORITY_AND_HEIR_VERIFIED: '王位について明示された権限と後継者を確認できた',
  CROWN_SUCCESSION_REVIEW: '王位の継承審査',
  LEGAL_CASE_RECORDING_ONLY: '審査案件の記録のみ',
  NOT_SUCCESSION_APPROVAL: '継承の承認ではない',
  AUTONOMOUS_CANDIDATE_DISCOVERY_ONLY: '自動生成された人物の候補発見のみ',
  SUCCESSION_CASE_PENDING: '相続案件が保留中',
  REVIEWED_SUCCESSION_TITLE_TRANSFER: '審査済みの継承に基づく称号の移転',
  CROWN_TITLE_APPROVED_TRANSFER: '承認済みの王位移転',
  EXPLICIT_NEW_MANDATE_EVIDENCE: '新たな統治委任の証拠あり',
  EXPLICIT_CROWN_RULER_LINK: '王位と国家統治者の関連記録',
  TITLE_HOLDER_UNDETERMINED_RECORDING_ONLY: '保持者未確定の記録のみ（継承の承認ではない）',
  CROWN_HOLDER_UNDETERMINED_RECORDING_ONLY: '王位の保持者未確定の記録のみ（継承の承認ではない）',
  RULER_REFERENCE_CLEARANCE_ONLY: '統治者の参照を整理しただけ（継承の承認ではない）',
  RULER_SUCCESSION_UNDETERMINED: '統治者の継承は未確定',
  NO_TERRITORIAL_OR_TAX_TRANSFER: '領地・課税権の移転は伴わない',
  COLLATERAL_PARENTAGE_UNDETERMINED: '傍系の親子関係が未確定',
  SUPPORTING_KINSHIP_CLEARANCE_MISSING: '補助人物の血縁についての確認記録がない',
  CROWN_CASE_RECORDING_ONLY: '王位の案件を記録するのみ（継承の承認ではない）',
  // A-LEG-01 婚姻登録
  DOMESTIC_MARRIAGE_AUTHORITY_AND_CONSENT_VERIFIED: '婚姻の権限と同意を確認できた',
  AUTHORITY_RECORD_MISSING: '承認に必要な権限の記録がないため、判断を保留',
  CONFIRMED_SPOUSE_DEATH: '配偶者の死亡を確認できた',
  DEC_058_SPOUSE_DEATH: '配偶者の死亡による婚姻の終了',
})

export type ReasonView = Readonly<{
  /** 通常表示に出す日本語の理由。 */
  labels: readonly string[]
  /** 辞書にないコード。通常表示では「未分類」とだけ示し、コードは技術詳細へ。 */
  unclassified: readonly string[]
}>

/** 理由コード列を表示用に分ける。技術区分コードは通常表示から除く。 */
export function reasonView(codes: readonly string[]): ReasonView {
  const labels: string[] = []
  const unclassified: string[] = []
  for (const code of codes) {
    if (TECHNICAL_ONLY.has(code)) continue
    // PREDECESSOR_ID:… / SOURCE_B003_EVENT:… など、ID付きの参照コードは理由ではなく出典。
    if (/^[A-Z0-9_]+:/.test(code)) continue
    const label = LABELS[code]
    if (label) labels.push(label)
    else unclassified.push(code)
  }
  return { labels, unclassified }
}

export const reasonSentence = (codes: readonly string[]): string => {
  const v = reasonView(codes)
  const parts = [...v.labels]
  if (v.unclassified.length > 0) parts.push('未分類の理由が' + v.unclassified.length + '件（技術詳細に記録）')
  return parts.length > 0 ? parts.join('。') : '通常表示できる理由の記録なし'
}
