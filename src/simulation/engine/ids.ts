// 決定的 ID（traceId / eventId / semanticEventKey）。
// 入力は年・フェーズ・RuleID・評価器が与える安定キー（draft 順・commandId・requestId）のみ。
// branchId・乱数・時刻・走査順の副作用・表示順は混ぜない。別枝でも同じ意味の判断は同じ ID になる。
import type { Id, Phase, RuleId, Year } from '../contracts/index.ts'

/** RuleOutcome.traceDrafts[draftIndex] に対応する traceId。評価器は Command.source.sourceTraceId にこれを使う。 */
export function traceIdOf(year: Year, phase: Phase, ruleId: RuleId, draftIndex: number): Id {
  return `trace:${year}:p${phase}:${ruleId}:${draftIndex}`
}

/** 確定した 1 単位（batch または単独 command）の eventId。先頭 commandId は年内で一意（Transaction が保証）。 */
export function eventIdOf(year: Year, phase: Phase, ruleId: RuleId, firstCommandId: Id): Id {
  return `event:${year}:p${phase}:${ruleId}:${firstCommandId}`
}

/** 意味的な同一性キー。commandId に依存せず、requestId（意味的原因）と command 種別で決まる。 */
export function semanticEventKeyOf(
  year: Year,
  phase: Phase,
  ruleId: RuleId,
  requestIds: readonly Id[],
  commandTypes: readonly string[],
): string {
  const uniqSorted = (xs: readonly string[]) => [...new Set(xs)].sort()
  return `${year}:p${phase}:${ruleId}:${uniqSorted(requestIds).join(',')}:${uniqSorted(commandTypes).join('+')}`
}
