// 『亡国の王冠』1250年 experimental 世界と1350年の厳格Goalを結ぶ試験専用境界。
// 授与・承認・初期行政・税権は個別に照合する。ここから新たな法的権限・婚姻・成功イベントを生成しない。
// GAME-02/03の具体的権限者が未決なので正式勝敗は公開せず、technicalGoalだけで実測する。
import type { WorldState } from '../../simulation/contracts/index.ts'
import type { GoalOptions } from '../../simulation/goal.ts'
import type { LegalEvidenceBook, LegalEvidenceIssue } from '../../simulation/legal/evidence.ts'
import { verifyInitialLegalEvidence } from '../../simulation/legal/evidence.ts'
import { createExperimentalLegalEvidence } from './legal-evidence.ts'
import { NALVEN_DYNASTY_ID } from './world-1250.ts'

export const EXPERIMENTAL_NALVEN_GOAL: GoalOptions = Object.freeze({ dynastyId: NALVEN_DYNASTY_ID })

export type ExperimentalGoalContext =
  | Readonly<{ ok: true; book: LegalEvidenceBook; goal: GoalOptions }>
  | Readonly<{ ok: false; issues: readonly LegalEvidenceIssue[] }>

/** 1250年初期世界と、別記録の法的証拠が整合する場合に限り実行構成へ渡す。 */
export function prepareExperimentalGoalContext(initialWorld: WorldState): ExperimentalGoalContext {
  const book = createExperimentalLegalEvidence()
  const issues = verifyInitialLegalEvidence(initialWorld, book)
  if (issues.length > 0) return { ok: false, issues }
  // 承認権限はこのbookでは未設定（PENDING維持）。技術検証で恣意的に補完しない。
  return { ok: true, book, goal: EXPERIMENTAL_NALVEN_GOAL }
}
