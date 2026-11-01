// 契約 §2 の最小型。名前は改善してよいが意味と書込 owner は変えない。
import type { RuleId } from './rule-ids.ts'

export type Id = string
export type Year = number // 年初 1250..1350
export type Phase = 1 | 2 | 3 | 4 | 5 | 6 | 7 // 7 は確定検証のみ
export type Domain = 'A' | 'B' | 'C' | 'D' // A=法制 B=人物 C=民生 D=軍事外交
export type DecisionStatus = 'ACCEPT' | 'REJECT' | 'DEFER'

export type ControllerRef = Readonly<{ kind: 'PERSON' | 'HOUSE' | 'COUNTRY'; id: Id }>
export type ResourceOwnerRef = ControllerRef | Readonly<{ kind: 'GROUP'; id: Id }>
export type TargetRef =
  | Readonly<{ kind: 'PERSON' | 'HOUSE' | 'GROUP' | 'COUNTRY' | 'REGION'; id: Id }>
  | Readonly<{ kind: 'PERSON_PAIR'; ids: readonly [Id, Id] }> // ID 昇順に正規化

/** 命令・要求・Trace の発生源。sourceRuleId は登録済み 37 件のみ。 */
export type Source = Readonly<{
  requestId: Id
  year: Year
  phase: Phase
  sourceRuleId: RuleId
  sourceTraceId: Id
  sourceIntentId?: Id
}>

/** ログ用の値。実行命令としては解釈しない。 */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | readonly JsonValue[]
  | { readonly [key: string]: JsonValue }

/** 1250 年開始、1350 年判定。 */
export const START_YEAR = 1250
export const GOAL_YEAR = 1350
