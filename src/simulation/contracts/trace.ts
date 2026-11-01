// DecisionTrace / EventLog / StatModifier（契約 §7）。
import type { Id, JsonValue, Phase, TargetRef, Year } from './primitives.ts'
import type { RuleId } from './rule-ids.ts'

export type StatModifier = Readonly<{
  modifierId: Id
  interventionId: Id
  targetRef: TargetRef
  statKey: string
  signedDelta: number
  startYear: Year
  endExclusiveYear: Year // 期間は [startYear, endExclusiveYear)
  decayPolicy: 'NONE' | 'LINEAR'
  ruleVersion: string
}>

export type TraceCandidate = Readonly<{
  candidateId: Id
  eligible: boolean
  inputs: Readonly<Record<string, JsonValue>>
  score?: number
  threshold?: number
  reasonCodes: readonly string[]
}>

export type DecisionTrace = Readonly<{
  traceId: Id
  year: Year
  phase: Phase
  ruleId: RuleId
  actorRef: TargetRef
  candidates: readonly TraceCandidate[]
  selectedCandidateId?: Id
  status: 'ACCEPT' | 'REJECT' | 'DEFER' | 'NOT_IMPLEMENTED'
  reasonCodes: readonly string[]
  modifierIds: readonly Id[]
  random?: Readonly<{ stream: 'EXOGENOUS' | 'ENDOGENOUS'; key: string; value: number }>
  eventIds: readonly Id[]
  ruleVersion: string
}>

/** 評価時に作る下書き。traceId と eventIds はエンジンが付与する。 */
export type DecisionTraceDraft = Omit<DecisionTrace, 'traceId' | 'eventIds'>

export type StateChange = Readonly<{ path: string; before: JsonValue; after: JsonValue }>

/** 確定した状態差分のみ。stateChanges はログ用で、実行命令として解釈しない。 */
export type EventLogEntry = Readonly<{
  eventId: Id
  semanticEventKey: string
  year: Year
  phase: Phase
  eventType: string
  involvedRefs: readonly TargetRef[]
  stateChanges: readonly StateChange[]
  sourceTraceIds: readonly Id[]
}>
