import type { Id } from '../../simulation/contracts/index.ts'
import type { BranchChoice, ObservationInput, ObservationSlice, PlayInput, PlayView } from '../branch-play-source.ts'

export type EvidenceBuild = Readonly<{ kind: 'COMMIT'; sha: string }> |
  Readonly<{ kind: 'LOCAL'; reason: 'LOCAL' | 'UNKNOWN' | 'DIRTY' }>
export type Transfer = 'FULL' | 'DISPLAY_YEAR' | 'DISPLAY_RUN'
export type EventEvidence = Readonly<{ id: Id; type: string; headline: string | null; traceIds: readonly Id[] }>
export type PublicSelection = Readonly<{ personId?: Id; event?: Readonly<{ branch: BranchChoice; id: Id }> }>
export type DebugSelection = Readonly<{ branch: BranchChoice; traceId: Id }>
export type BranchEvidence = Readonly<{
  branch: BranchChoice
  scenarioId: string | null
  modifierIds: readonly Id[]
  yearStart: Readonly<{ population: number; alivePersons: number;
    persons: readonly Readonly<{ id: Id; presence: 'ALIVE' | 'DEAD' | 'ABSENT' }>[] }>
  coverage: Readonly<{ kind: 'EVALUATION_ONLY' } | {
    kind: 'COMPLETE' | 'TRANSFER_OMISSION'; eventCount: number; traceCount: number
    omission: null | Readonly<{ scope: 'YEAR' | 'RUN'; events: number; traces: number }>
  }>
  events: Readonly<{ count: number; refs: readonly EventEvidence[]; sha256: string }>
}>
export type Evidence = Readonly<{
  schemaVersion: 1
  build: EvidenceBuild
  config: Readonly<{ mode: 'MULTI_HOUSE_EXPERIMENTAL'; configuration: 'LIMITED_PLAYTEST'; configId: string;
    configDigest: string; identitySha256: string }>
  seed: number
  kind: 'OBSERVATION' | 'COMPARISON'
  year: number
  branch: BranchChoice
  intervention: null | Readonly<{ year: number; firstPersonId: Id; secondPersonId: Id; signedDelta: number;
    durationYears: number; modifierId: Id; ruleVersion: string }>
  transfer: Transfer
  /** 限定構成全体の独立した scenario / legal 版はない。土台と実際の法制ルール版を別記する。 */
  versions: Readonly<{ ruleset: string; rng: string; scenario: null; legal: null; baseScenario: string;
    legalRules: Readonly<{ ordinaryMarriage: string; reviewedSuccession: string }> }>
  selection: Readonly<{ personId: Id | null; event: NonNullable<PublicSelection['event']> | null }>
  player: Readonly<{ channel: 'PLAYER'; status: 'COMPLETED'; officialGoal: 'NOT_ESTABLISHED'; branches: readonly BranchEvidence[] }>
  debug: null | Readonly<DebugSelection & { channel: 'DEBUG'; ruleId: string; ruleVersion: string;
    status: 'ACCEPT' | 'REJECT' | 'DEFER' | 'NOT_IMPLEMENTED'; eventIds: readonly Id[] }>
}>

type Outcome<T> = Readonly<{ kind: 'DONE'; requestId: number; result: T } | { kind: 'PENDING' | 'NOT_LOADED' | 'FAILED' | 'CANCELLED' }>
export type RunSelection = Readonly<
  { kind: 'OBSERVATION'; input: ObservationInput; outcome: Outcome<ObservationSlice> } |
  { kind: 'COMPARISON'; input: PlayInput; outcome: Outcome<PlayView> }
>
