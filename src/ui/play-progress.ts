// 再計算の確定済み年次進捗。Workerから送る小さなDTOだけを定義する（WorldState・全ログは含めない）。
// 未確定の未来・推測した残り時間・架空のEventは持たない。

export type ProgressBranch = 'A0' | 'A1' | 'A2'

/** 確定済みの年次進捗。A0とA1は branch で区別する。 */
export type PlayProgress = Readonly<{
  branch: ProgressBranch
  /** この区間の開始年（A0: 1250 / A1: 介入年）と終了年（1350）。 */
  startYear: number
  goalYear: number
  /** 年初まで確定した年（ここより先は未確定）。 */
  confirmedYear: number
  transitionsDone: number
  transitionsTotal: number
  /** この区間で実際に記録されたEvent件数の累計。 */
  eventCount: number
}>

export type ProgressObserver = (p: PlayProgress) => void

/** 受け取ったDTOが範囲内で、同じ枝の直前値より単調に増えているかを検査する（不正な通知は表示に使わない）。 */
export function acceptProgress(prev: PlayProgress | undefined, next: PlayProgress): boolean {
  const valid = Number.isSafeInteger(next.confirmedYear) && Number.isSafeInteger(next.transitionsDone)
    && next.transitionsTotal > 0 && next.transitionsDone > 0 && next.transitionsDone <= next.transitionsTotal
    && next.goalYear - next.startYear === next.transitionsTotal
    && next.confirmedYear === next.startYear + next.transitionsDone && next.confirmedYear <= next.goalYear
    && next.eventCount >= 0
  if (!valid) return false
  return prev === undefined || (prev.startYear === next.startYear && next.transitionsDone > prev.transitionsDone)
}

/** A0→A1 の順に実行される。最新の通知を枝ごとに保持する。 */
export type ProgressState = Readonly<{ a0?: PlayProgress; a1?: PlayProgress; a2?: PlayProgress }>
export function reduceProgress(s: ProgressState, p: PlayProgress): ProgressState {
  const prev = p.branch === 'A0' ? s.a0 : p.branch === 'A1' ? s.a1 : s.a2
  if (!acceptProgress(prev, p)) return s
  return p.branch === 'A0' ? { ...s, a0: p } : p.branch === 'A1' ? { ...s, a1: p } : { ...s, a2: p }
}
