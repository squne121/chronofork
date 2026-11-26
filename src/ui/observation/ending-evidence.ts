import type { TitleLossRecord } from './person-record.ts'
import type { TitleHoldingHistory } from './title-history.ts'

/** 判定とは別に、確定済みの連続する年初の記録だけを読む。 */
export function endingHolderEvidence(history: TitleHoldingHistory | undefined, loss: TitleLossRecord | undefined,
  firstYear: number | undefined, evaluationYear: number) {
  const intervals = history?.intervals ?? []
  const final = intervals.at(-1)
  if (final?.throughYear !== evaluationYear || final.holder.status === 'NOT_RECORDED') return { kind: 'UNKNOWN' } as const
  if (final.holder.status === 'HELD') return { kind: 'HELD' } as const
  if (loss && loss.titleId === history?.titleId && final.fromYear === loss.lostFromYear &&
    intervals.some(i => i.throughYear === final.fromYear - 1 && i.holder.status === 'HELD' && i.holder.personId === loss.lastHolderId)) {
    return { kind: 'LOST', loss } as const
  }
  if (intervals.length === 1 && final.fromYear === firstYear) return { kind: 'NEVER_HELD' } as const
  return { kind: 'UNKNOWN' } as const
}
