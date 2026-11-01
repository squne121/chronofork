// 試験用係数の集約（契約 §1/§3.1、pending-approvals §3）。
// すべて CALIBRATION_ONLY であり、採用済みゲーム法則ではない。
export type TuningOrigin =
  | 'PROPOSED_TECHNICAL' // 契約書にある技術提案
  | 'PLACEHOLDER' // 動作確認用の仮値（根拠なし）

export type TuningParameter = Readonly<{
  value: number
  origin: TuningOrigin
  note: string
}>

export type TuningConfig = Readonly<{
  status: 'CALIBRATION_ONLY'
  rulesetVersion: string
  /** 1BU = 1000 整数内部単位は技術換算の提案（契約 §3.1）。 */
  milliBUPerBU: TuningParameter
  /** 暫定分解式 delta = round(P*(1+g)) − P; B = max(0, round(P*b), delta) の仮係数。 */
  birthRatePermille: TuningParameter
  growthRatePermille: TuningParameter
  /** 支持信号 scale（bps / 信号 1 単位）の仮係数。 */
  supportSignalScaleBps: TuningParameter
  /** 「国庫 45/100」は表示上の初期傾向であり、BU への換算は未承認。 */
  treasuryDisplayConversion: Readonly<{ status: 'UNAPPROVED'; note: string }>
}>

export const EXPERIMENTAL_TUNING: TuningConfig = Object.freeze({
  status: 'CALIBRATION_ONLY',
  rulesetVersion: 'experimental-0',
  milliBUPerBU: Object.freeze({
    value: 1000,
    origin: 'PROPOSED_TECHNICAL',
    note: '契約 §3.1 の技術換算の提案',
  }),
  birthRatePermille: Object.freeze({
    value: 30,
    origin: 'PLACEHOLDER',
    note: '試験値。採用済みゲーム法則ではない',
  }),
  growthRatePermille: Object.freeze({
    value: 2,
    origin: 'PLACEHOLDER',
    note: '試験値。採用済みゲーム法則ではない',
  }),
  supportSignalScaleBps: Object.freeze({
    value: 100,
    origin: 'PLACEHOLDER',
    note: '試験値。採用済みゲーム法則ではない',
  }),
  treasuryDisplayConversion: Object.freeze({
    status: 'UNAPPROVED',
    note: '国庫 45/100 は表示上の初期傾向。45BU とする案は未承認（pending-approvals §5）',
  }),
})
