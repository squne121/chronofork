// 既知Eventを「誰に何が起きたか」へ読み替える表示専用の関数。
// Event.stateChanges の確定値だけを使い、形が想定と違えば undefined を返して生データ表示へ戻す（事実を創作しない）。
import type { EventLogEntry, Id } from '../simulation/contracts/index.ts'

export type EventNames = Readonly<{
  person: (id: Id) => string | undefined
  group: (id: Id) => string | undefined
  dynasty: (id: Id) => string | undefined
}>
export type EventSummary = Readonly<{ headline: string; lines: readonly string[] }>

type Obj = Readonly<Record<string, unknown>>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
const unknownRef = (id: Id) => `参照不明（${id}）`

/** 合成名の末尾に付く内部キー「 (marriage:…)」を除いた表示名。元の名前は開発・検証情報に残る。 */
export const shortPersonName = (name: string) => name.replace(/\s*\(.*$/, '')

export function describeEvent(e: EventLogEntry, names: EventNames): EventSummary | undefined {
  const person = (id: Id) => names.person(id) ?? unknownRef(id)
  const group = (id: Id) => names.group(id) ?? unknownRef(id)
  const dynasty = (id: Id) => names.dynasty(id) ?? unknownRef(id)
  switch (e.eventType) {
    case 'MARRIAGE_REGISTER': {
      const after = e.stateChanges.find((c) => c.path.startsWith('$.legal.marriages[') && c.before === null)?.after
      if (!isObj(after) || !Array.isArray(after.personIds) || after.personIds.length !== 2) return undefined
      const [a, b] = after.personIds.map(str)
      if (!a || !b) return undefined
      const lines = [after.status === 'ACTIVE' ? '婚姻の状態: 有効' : `婚姻の状態: ${String(after.status)}`]
      const clauses = isObj(after.contract) && Array.isArray(after.contract.clauses) ? after.contract.clauses : []
      for (const c of clauses) {
        if (isObj(c) && c.kind === 'CHILD_LEGAL_DYNASTY' && str(c.dynastyId)) {
          lines.push(`婚姻契約: 生まれる子の法的王朝は「${dynasty(str(c.dynastyId)!)}」`)
        }
      }
      return { headline: `${person(a)}と${person(b)}の婚姻が成立（${e.year}年）`, lines }
    }
    case 'PERSON_BIRTH': {
      const after = e.stateChanges.find((c) => c.path.startsWith('$.persons[') && c.before === null)?.after
      if (!isObj(after) || !str(after.personId) || !str(after.name)) return undefined
      const lines: string[] = []
      if (after.sex === 'FEMALE' || after.sex === 'MALE') lines.push(`性別: ${after.sex === 'FEMALE' ? '女' : '男'}`)
      const f = str(after.fatherId), m = str(after.motherId)
      if (f && m) lines.push(`両親: ${person(f)}（父）・${person(m)}（母）`)
      if (str(after.originGroupId)) lines.push(`出身集団: ${group(str(after.originGroupId)!)}`)
      const ld = after.legalDynasty
      if (isObj(ld)) {
        lines.push(ld.status === 'UNDETERMINED' ? '法的王朝: 未確定' : `法的王朝: ${str(ld.dynastyId) ? dynasty(str(ld.dynastyId)!) : String(ld.status)}`)
      }
      return { headline: `${shortPersonName(str(after.name)!)}が生まれた（${e.year}年）`, lines }
    }
    case 'LEGAL_DYNASTY_SET': {
      const id = e.involvedRefs.find((r) => r.kind === 'PERSON')
      const d = e.stateChanges.find((c) => c.path.endsWith('.legalDynasty.dynastyId'))
      const s = e.stateChanges.find((c) => c.path.endsWith('.legalDynasty.status'))
      if (!id || id.kind !== 'PERSON' || !d || !str(d.after) || !s || s.after !== 'DETERMINED') return undefined
      const lines = [s.before === 'UNDETERMINED' ? '変更前: 法的王朝は未確定' : `変更前の状態: ${String(s.before)}`]
      return { headline: `${person(id.id)}の法的王朝が「${dynasty(str(d.after)!)}」に確定（${e.year}年）`, lines }
    }
    default:
      return undefined
  }
}

/** 確定した出生Eventの両親IDが指定2人である子の人物ID。 */
export function childIdsOfPair(events: readonly EventLogEntry[], pair: readonly [Id, Id]): ReadonlySet<Id> {
  const ids = new Set<Id>()
  for (const e of events) {
    if (e.eventType !== 'PERSON_BIRTH') continue
    const after = e.stateChanges.find((c) => c.path.startsWith('$.persons[') && c.before === null)?.after
    if (isObj(after) && str(after.personId) && pair.includes(after.fatherId as Id) && pair.includes(after.motherId as Id) && after.fatherId !== after.motherId) {
      ids.add(after.personId as Id)
    }
  }
  return ids
}
