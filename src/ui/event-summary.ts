// 既知Eventを「誰に何が起きたか」へ読み替える表示専用の関数。
// Event.stateChanges の確定値だけを使い、形が想定と違えば undefined を返して生データ表示へ戻す（事実を創作しない）。
import type { EventLogEntry, Id } from '../simulation/contracts/index.ts'
import { baseDisplayName, personIdTag } from './observation/person-display.ts'

export type EventNames = Readonly<{
  person: (id: Id) => string | undefined
  group: (id: Id) => string | undefined
  dynasty: (id: Id) => string | undefined
  /** 既存呼出しに互換。未記録の国名は生成しない。 */
  country?: (id: Id) => string | undefined
  /** 称号名・地域名。未指定または未解決なら生IDを出さず「名前未確認」と表示する。 */
  title?: (id: Id) => string | undefined
  region?: (id: Id) => string | undefined
}>
export type EventSummary = Readonly<{ headline: string; lines: readonly string[] }>

type Obj = Readonly<Record<string, unknown>>
const isObj = (v: unknown): v is Obj => typeof v === 'object' && v !== null && !Array.isArray(v)
const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
/** 名前を裏付ける記録が無い参照の通常表示用ラベル。生IDは出さず、同じ参照には同じ識別、別の参照には別の識別（32bit FNV-1a）を付ける。
 * 名前は創作しない。元のIDはEvent/Trace/技術詳細にそのまま残る。 */
export type UnresolvedKind = 'person' | 'group' | 'dynasty' | 'country' | 'region' | 'other'
const UNRESOLVED_NOUN: Readonly<Record<UnresolvedKind, string>> = {
  person: '人物', group: '集団', dynasty: '王朝', country: '国', region: '地域', other: '対象',
}
export const unresolvedLabel = (kind: UnresolvedKind, id: Id): string => {
  let h = 0x811c9dc5
  for (let i = 0; i < id.length; i++) { h ^= id.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  return `名前未確認の${UNRESOLVED_NOUN[kind]}（識別${h.toString(36).toUpperCase().padStart(7, '0')}）`
}

/** 合成名の末尾に付く内部キー「 (marriage:…)」を除いた表示名。元の名前は開発・検証情報に残る。 */
export const shortPersonName = (name: string) => name.replace(/\s*\(.*$/, '')

export function describeEvent(e: EventLogEntry, names: EventNames): EventSummary | undefined {
  const person = (id: Id) => names.person(id) ?? unresolvedLabel('person', id)
  const group = (id: Id) => names.group(id) ?? unresolvedLabel('group', id)
  const dynasty = (id: Id) => names.dynasty(id) ?? unresolvedLabel('dynasty', id)
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
      const id=str(after.personId)!, raw=str(after.name)!, resolved=names.person(id)
      const experimental=/^(試験用自律児|試験用補助人物|実験用の記名候補)/.test(resolved??raw)
      const fallback=experimental && (after.sex==='MALE'||after.sex==='FEMALE')
        ? `${baseDisplayName({personId:id,name:resolved??raw,sex:after.sex,birthYear:typeof after.birthYear==='number'?after.birthYear:e.year})}・識別${personIdTag(id)}`
        : shortPersonName(resolved??raw)
      return { headline: `${fallback}が生まれた（${e.year}年）`, lines }
    }
    case 'LEGAL_DYNASTY_SET': {
      const id = e.involvedRefs.find((r) => r.kind === 'PERSON')
      const d = e.stateChanges.find((c) => c.path.endsWith('.legalDynasty.dynastyId'))
      const s = e.stateChanges.find((c) => c.path.endsWith('.legalDynasty.status'))
      if (!id || id.kind !== 'PERSON' || !d || !str(d.after) || !s || s.after !== 'DETERMINED') return undefined
      const lines = [s.before === 'UNDETERMINED' ? '変更前: 法的王朝は未確定' : `変更前の状態: ${String(s.before)}`]
      return { headline: `${person(id.id)}の法的王朝が「${dynasty(str(d.after)!)}」に確定（${e.year}年）`, lines }
    }
    case 'COUNTRY_RULER_SET':
    case 'COUNTRY_RULER_VACATE': {
      // 確定した更新と死亡後の参照解除を区別し、EventのstateChangeだけから表示する。
      const ref = e.involvedRefs.find(r => r.kind === 'COUNTRY')
      if (!ref || ref.kind !== 'COUNTRY') return undefined
      const change = e.stateChanges.find(c => c.path === '$.countries[' + ref.id + '].rulerPersonId')
      if (!change) return undefined
      const before = str(change.before), after = str(change.after)
      if (!after && change.after !== null) return undefined
      if (e.eventType === 'COUNTRY_RULER_VACATE' && after) return undefined
      const country = names.country?.(ref.id) ?? unresolvedLabel('country', ref.id)
      return {
        headline: after
          ? country + 'の統治者記録が' + person(after) + 'に更新（' + e.year + '年）'
          : country + 'の統治者記録が未確定になった（' + e.year + '年）',
        lines: [
          '変更前の統治者: ' + (before ? person(before) : '記録なし'),
          '変更後: ' + (after ? person(after) : '未確定（後継者を推定しません）'),
        ],
      }
    }
    case 'LEGAL_TITLE_TRANSFER': {
      // 実stateChangeの保持者の前後だけを読む。移転の理由・正式な継承の成立は推定しない（理由は紐づくDecisionTraceで確認）。
      const m = e.stateChanges.map(c => ({ c, id: /^\$\.titles\[(.+)\]\.holder\.personId$/.exec(c.path)?.[1] })).find(x => x.id !== undefined)
      if (!m || m.id === undefined) return undefined
      const before = str(m.c.before), after = str(m.c.after)
      if (!before && m.c.before !== null) return undefined
      if (!after && m.c.after !== null) return undefined
      const title = names.title?.(m.id) ?? unresolvedLabel('other', m.id)
      const hasCase = e.stateChanges.some(c => c.path === '$.titles[' + m.id + '].holder.legalCaseId' && c.after !== null)
      return {
        headline: `${title}の保持者が${before ? person(before) : '保持者なし'}から${after ? person(after) : '未確定'}に変更（${e.year}年）`,
        lines: [
          '対象称号: ' + title,
          '変更前の保持者: ' + (before ? person(before) : '記録なし（未確定）'),
          '変更後の保持者: ' + (after ? person(after) : '未確定（後継者を推定しません）'),
          ...(hasCase ? ['未確定の保持者について相続審査の案件が紐づけられた'] : []),
          '変更の理由は、下の「判断の記録」に実際に残っているものだけが根拠です。',
        ],
      }
    }
    case 'LEGAL_CASE_SET': {
      const created = e.stateChanges.find(c => c.path.startsWith('$.legal.cases[') && !c.path.includes('].') && c.before === null)?.after
      const regionRef = e.involvedRefs.find(r => r.kind === 'REGION')
      const regionName = regionRef && regionRef.kind === 'REGION' ? (names.region?.(regionRef.id) ?? unresolvedLabel('region', regionRef.id)) : undefined
      const caseStatus = (v: unknown) => v === 'PENDING' ? '保留中（承認も却下もされていない）' : v === 'APPROVED' ? '承認' : v === 'REJECTED' ? '却下' : '状態を確認できない'
      const list = (v: unknown) => Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : undefined
      const candText = (ids: readonly string[] | undefined) => ids === undefined ? '記録なし' : ids.length === 0 ? '候補者なし' : ids.map(person).join('、') + '（' + ids.length + '人）'
      if (isObj(created) && str(created.titleId)) {
        const title = names.title?.(str(created.titleId)!) ?? unresolvedLabel('other', str(created.titleId)!)
        const kind = created.kind === 'SUCCESSION' ? '相続審査' : created.kind === 'RECOGNITION' ? '承認審査' : created.kind === 'REVOCATION' ? '取消審査' : '審査'
        return {
          headline: `${title}の${kind}が記録された（${e.year}年）`,
          lines: ['対象称号: ' + title, '審査の状態: ' + caseStatus(created.status), '候補者: ' + candText(list(created.candidatePersonIds)),
            '審査の状態は記録であり、保持者の変更が成立したことを意味しません。'],
        }
      }
      const cand = e.stateChanges.find(c => c.path.endsWith('].candidatePersonIds'))
      const stat = e.stateChanges.find(c => c.path.endsWith('].status'))
      if (!cand && !stat) return undefined
      const lines: string[] = []
      if (regionName) lines.push('対象地域: ' + regionName)
      if (cand) lines.push('候補者（変更前）: ' + candText(list(cand.before)), '候補者（変更後）: ' + candText(list(cand.after)))
      if (stat) lines.push('審査の状態: ' + caseStatus(stat.before) + ' → ' + caseStatus(stat.after))
      return { headline: `審査案件の記録が更新（${e.year}年）`, lines }
    }
    case 'PERSON_DEATH': {
      const ref = e.involvedRefs.find(r => r.kind === 'PERSON')
      const d = e.stateChanges.find(c => c.path.endsWith('].deathYear'))
      if (!ref || ref.kind !== 'PERSON' || !d || typeof d.after !== 'number') return undefined
      return { headline: `${person(ref.id)}が死亡（${d.after}年）`, lines: ['この年の記録で、人物の生死が「死亡」に変わった'] }
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
