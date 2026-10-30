// 型付き WorldState の整合性検証。入力を変更せず、診断だけを返す。
// 検証中に相続・承認・税権移管・人口補正を自動実行しない（PENDING/UNDETERMINED は正当な状態として許容する）。
import type { Id, WorldState } from '../contracts/index.ts'
import { GOAL_YEAR, START_YEAR } from '../contracts/index.ts'
import type { Diagnostic, DiagnosticCode, DiagnosticSeverity } from './diagnostics.ts'

type RefKind =
  | 'COUNTRY' | 'REGION' | 'GROUP' | 'HOUSE' | 'PERSON' | 'TITLE'
  | 'DYNASTY' | 'LEGAL_CASE' | 'ACCOUNT' | 'MARRIAGE'

/** ID が互いに衝突してはならないエンティティ種別（ControllerRef 等の種別違いを一意に判定するため）。 */
const ENTITY_KINDS: readonly RefKind[] = ['COUNTRY', 'REGION', 'GROUP', 'HOUSE', 'PERSON', 'TITLE']

const isCount = (v: number) => Number.isSafeInteger(v) && v >= 0

export function checkWorldIntegrity(world: WorldState): Diagnostic[] {
  const out: Diagnostic[] = []
  const add = (
    code: DiagnosticCode,
    path: string,
    message: string,
    target: { kind: string; id: Id } | null = null,
    related: readonly Id[] = [],
    severity: DiagnosticSeverity = 'ERROR',
  ) => {
    out.push({ code, severity, path, target, message, related })
  }

  // --- ID 索引と重複 ---
  const ids = new Map<RefKind, Set<Id>>()
  const collect = (kind: RefKind, list: readonly { id: Id; path: string }[]) => {
    const set = new Set<Id>()
    for (const { id, path } of list) {
      if (set.has(id)) add('DUPLICATE_ID', path, `${kind} の ID が重複しています: ${id}`, { kind, id })
      set.add(id)
    }
    ids.set(kind, set)
  }
  const at = (key: string) => <T>(items: readonly T[], pick: (t: T) => Id) =>
    items.map((t, i) => ({ id: pick(t), path: `$.${key}[${i}]` }))
  collect('COUNTRY', at('countries')(world.countries, (c) => c.countryId))
  collect('REGION', at('regions')(world.regions, (r) => r.regionId))
  collect('GROUP', at('groups')(world.groups, (g) => g.groupId))
  collect('HOUSE', at('houses')(world.houses, (h) => h.houseId))
  collect('PERSON', at('persons')(world.persons, (p) => p.personId))
  collect('TITLE', at('titles')(world.titles, (t) => t.titleId))
  collect('DYNASTY', at('legal.dynasties')(world.legal.dynasties, (x) => x.dynastyId))
  collect('LEGAL_CASE', at('legal.cases')(world.legal.cases, (x) => x.caseId))
  collect('ACCOUNT', at('resources')(world.resources, (x) => x.accountId))
  collect('MARRIAGE', at('legal.marriages')(world.legal.marriages, (x) => x.marriageId))

  const seenEntity = new Map<Id, RefKind>()
  for (const kind of ENTITY_KINDS) {
    for (const id of ids.get(kind) ?? []) {
      const prev = seenEntity.get(id)
      if (prev !== undefined && prev !== kind) {
        add('DUPLICATE_ID', '$', `ID ${id} が ${prev} と ${kind} で衝突しています`, { kind, id }, [id])
      }
      seenEntity.set(id, kind)
    }
  }
  const dupScoped = (scope: string, keys: readonly { key: string; path: string }[]) => {
    const seen = new Set<string>()
    for (const { key, path } of keys) {
      if (seen.has(key)) add('DUPLICATE_ID', path, `${scope} の ID が重複しています: ${key}`, { kind: scope, id: key })
      seen.add(key)
    }
  }
  dupScoped('ControlMandate', world.legal.controlMandates.map((m, i) => ({ key: m.mandateId, path: `$.legal.controlMandates[${i}]` })))
  dupScoped('TaxCollectionMandate', world.legal.taxMandates.map((m, i) => ({ key: m.mandateId, path: `$.legal.taxMandates[${i}]` })))
  dupScoped('DeferredEffect', world.deferred.map((m, i) => ({ key: m.deferredId, path: `$.deferred[${i}]` })))
  dupScoped('CohortSlot', world.demographics.cohortSlots.map((m, i) => ({ key: `${m.groupId}@${m.year}`, path: `$.demographics.cohortSlots[${i}]` })))

  /** 存在しない → DANGLING_REF、別種別として存在 → WRONG_REF_KIND。 */
  const ref = (kind: RefKind, id: Id, path: string, owner: { kind: string; id: Id }) => {
    if (ids.get(kind)?.has(id)) return true
    const actual = [...ids.entries()].filter(([, set]) => set.has(id)).map(([k]) => k)
    if (actual.length > 0) {
      add('WRONG_REF_KIND', path, `${id} は ${kind} ではなく ${actual.join('/')} です`, owner, [id])
    } else {
      add('DANGLING_REF', path, `${kind} ${id} が存在しません`, owner, [id])
    }
    return false
  }
  const controllerKind = (k: 'PERSON' | 'HOUSE' | 'COUNTRY' | 'GROUP'): RefKind => k
  const intYear = (v: number, path: string, owner: { kind: string; id: Id }) => {
    if (!Number.isSafeInteger(v)) add('OUT_OF_RANGE', path, `整数の年が必要です: ${v}`, owner)
  }

  // --- 年 ---
  if (!Number.isSafeInteger(world.year) || world.year < START_YEAR || world.year > GOAL_YEAR) {
    add('OUT_OF_RANGE', '$.year', `年初状態の年は ${START_YEAR}..${GOAL_YEAR} です: ${world.year}`)
  }

  // --- 国家・地域 ---
  world.countries.forEach((c, i) => {
    const p = `$.countries[${i}]`
    const o = { kind: 'COUNTRY', id: c.countryId }
    if (c.rulerPersonId !== undefined) ref('PERSON', c.rulerPersonId, `${p}.rulerPersonId`, o)
    if (c.suzerainCountryId !== undefined) {
      if (c.suzerainCountryId === c.countryId) add('SELF_REFERENCE', `${p}.suzerainCountryId`, '自国を宗主にできません', o)
      else ref('COUNTRY', c.suzerainCountryId, `${p}.suzerainCountryId`, o)
    }
  })
  const adjacency = new Map(world.regions.map((r) => [r.regionId, new Set(r.adjacentRegionIds)]))
  world.regions.forEach((r, i) => {
    const p = `$.regions[${i}]`
    const o = { kind: 'REGION', id: r.regionId }
    ref('COUNTRY', r.sovereignCountryId, `${p}.sovereignCountryId`, o)
    ref(controllerKind(r.deFactoControllerRef.kind), r.deFactoControllerRef.id, `${p}.deFactoControllerRef`, o)
    r.adjacentRegionIds.forEach((adj, j) => {
      const ap = `${p}.adjacentRegionIds[${j}]`
      if (adj === r.regionId) add('SELF_REFERENCE', ap, '自地域は隣接にできません', o)
      else if (ref('REGION', adj, ap, o) && !adjacency.get(adj)?.has(r.regionId)) {
        add('ADJACENCY_ASYMMETRIC', ap, `${adj} 側に ${r.regionId} への隣接がありません`, o, [adj])
      }
    })
  })

  // --- 人口集団・支持 ---
  const aliveByGroup = new Map<Id, number>()
  for (const p of world.persons) if (p.alive) aliveByGroup.set(p.originGroupId, (aliveByGroup.get(p.originGroupId) ?? 0) + 1)
  world.groups.forEach((g, i) => {
    const p = `$.groups[${i}]`
    const o = { kind: 'GROUP', id: g.groupId }
    ref('REGION', g.regionId, `${p}.regionId`, o)
    if (!isCount(g.population)) add('NOT_NON_NEGATIVE_INTEGER', `${p}.population`, `人口は非負整数です: ${g.population}`, o)
    else if ((aliveByGroup.get(g.groupId) ?? 0) > g.population) {
      add('COHORT_CAPACITY_CONFLICT', `${p}.population`, `生存記名人物 ${aliveByGroup.get(g.groupId)} 人が人口 ${g.population} を超えています`, o)
    }
    for (const k of ['prosperity', 'unrest'] as const) {
      if (g[k] < 0 || g[k] > 100) add('OUT_OF_RANGE', `${p}.${k}`, `${k} は 0..100 です: ${g[k]}`, o)
    }
    let sum = g.support.undecidedBps
    if (!isCount(g.support.undecidedBps)) add('NOT_NON_NEGATIVE_INTEGER', `${p}.support.undecidedBps`, '無党派 bps は非負整数です', o)
    for (const [houseId, bps] of Object.entries(g.support.houseBps)) {
      ref('HOUSE', houseId, `${p}.support.houseBps.${houseId}`, o)
      if (!isCount(bps)) add('NOT_NON_NEGATIVE_INTEGER', `${p}.support.houseBps.${houseId}`, `支持 bps は非負整数です: ${bps}`, o)
      sum += bps
    }
    if (sum !== 10000) add('SUPPORT_BPS_SUM_MISMATCH', `${p}.support`, `支持 bps（無党派込み）の総和が 10000 ではありません: ${sum}`, o)
  })

  world.houses.forEach((h, i) => {
    const p = `$.houses[${i}]`
    const o = { kind: 'HOUSE', id: h.houseId }
    if (h.countryId !== undefined) ref('COUNTRY', h.countryId, `${p}.countryId`, o)
    if (h.headPersonId !== undefined) ref('PERSON', h.headPersonId, `${p}.headPersonId`, o)
  })

  // --- 人物 ---
  const personById = new Map(world.persons.map((x) => [x.personId, x]))
  world.persons.forEach((x, i) => {
    const p = `$.persons[${i}]`
    const o = { kind: 'PERSON', id: x.personId }
    ref('GROUP', x.originGroupId, `${p}.originGroupId`, o)
    ref('HOUSE', x.houseId, `${p}.houseId`, o)
    if (x.bloodlineDynastyId !== undefined) ref('DYNASTY', x.bloodlineDynastyId, `${p}.bloodlineDynastyId`, o)
    if (x.legalDynasty.status === 'DETERMINED') ref('DYNASTY', x.legalDynasty.dynastyId, `${p}.legalDynasty.dynastyId`, o)
    intYear(x.birthYear, `${p}.birthYear`, o)
    if (x.deathYear !== undefined) intYear(x.deathYear, `${p}.deathYear`, o)
    if (x.alive && x.deathYear !== undefined) add('ALIVE_STATE_CONTRADICTION', `${p}.deathYear`, '生存者に deathYear があります', o)
    if (!x.alive && x.deathYear === undefined) add('ALIVE_STATE_CONTRADICTION', `${p}.deathYear`, '死亡者に deathYear がありません', o)
    if (x.deathYear !== undefined && x.deathYear < x.birthYear) add('DEATH_BEFORE_BIRTH', `${p}.deathYear`, `死亡年 ${x.deathYear} が出生年 ${x.birthYear} より前です`, o)
    if (x.birthYear > world.year || (x.deathYear ?? 0) > world.year) add('BIRTH_OR_DEATH_IN_FUTURE', p, '年初状態の年より後の出生/死亡年です', o)
    for (const [field, parentId] of [['fatherId', x.fatherId], ['motherId', x.motherId]] as const) {
      if (parentId === undefined) continue
      if (!ref('PERSON', parentId, `${p}.${field}`, o)) continue
      const parent = personById.get(parentId)
      if (parent && parent.birthYear >= x.birthYear) {
        add('PARENT_BIRTH_YEAR_CONTRADICTION', `${p}.${field}`, `親 ${parentId} の出生年 ${parent.birthYear} が子の出生年 ${x.birthYear} 以降です`, o, [parentId])
      }
    }
  })
  // 親子循環（自己親を含む）。ID の重複があっても先勝ちで走査し、必ず終了する。
  const state = new Map<Id, 1 | 2>()
  const walk = (id: Id, stack: Id[]) => {
    state.set(id, 1)
    stack.push(id)
    const x = personById.get(id)
    for (const parentId of [x?.fatherId, x?.motherId]) {
      if (parentId === undefined || !personById.has(parentId)) continue
      const s = state.get(parentId)
      if (s === 1) {
        add('PARENT_CYCLE', '$.persons', `親子関係が循環しています: ${[...stack.slice(stack.indexOf(parentId)), parentId].join(' -> ')}`, { kind: 'PERSON', id: parentId }, stack.slice(stack.indexOf(parentId)))
      } else if (s === undefined) walk(parentId, stack)
    }
    stack.pop()
    state.set(id, 2)
  }
  for (const id of personById.keys()) if (!state.has(id)) walk(id, [])

  // --- 称号・法制 ---
  const titleById = new Map(world.titles.map((t) => [t.titleId, t]))
  const exclusive = new Map<string, Id>()
  world.titles.forEach((t, i) => {
    const p = `$.titles[${i}]`
    const o = { kind: 'TITLE', id: t.titleId }
    ref('REGION', t.regionId, `${p}.regionId`, o)
    if (t.holder.status === 'HELD') ref('PERSON', t.holder.personId, `${p}.holder.personId`, o)
    else if (t.holder.legalCaseId !== undefined) ref('LEGAL_CASE', t.holder.legalCaseId, `${p}.holder.legalCaseId`, o)
    const rec = t.recognition
    if (rec.authority !== undefined) ref(controllerKind(rec.authority.kind), rec.authority.id, `${p}.recognition.authority`, o)
    if (rec.sovereignCountryId !== undefined) ref('COUNTRY', rec.sovereignCountryId, `${p}.recognition.sovereignCountryId`, o)
    if (rec.status === 'ACTIVE' && (rec.authority === undefined || rec.sourceDecisionId === undefined)) {
      add('RECOGNITION_EVIDENCE_MISSING', `${p}.recognition`, 'ACTIVE の承認には authority と sourceDecisionId が必要です', o)
    }
    if (t.valid && rec.status === 'ACTIVE') {
      const key = `${t.kind}:${t.regionId}`
      const first = exclusive.get(key)
      if (first !== undefined) add('DUPLICATE_EXCLUSIVE_TITLE', p, `${t.regionId} の有効な ${t.kind} Title が複数あります`, o, [first])
      else exclusive.set(key, t.titleId)
    }
  })
  world.legal.marriages.forEach((m, i) => {
    const p = `$.legal.marriages[${i}]`
    const o = { kind: 'MARRIAGE', id: m.marriageId }
    const [a, b] = m.personIds
    if (a === b) add('SELF_REFERENCE', `${p}.personIds`, '同一人物同士の婚姻はできません', o)
    else if (a > b) add('PERSON_PAIR_NOT_NORMALIZED', `${p}.personIds`, 'personIds は ID 昇順に正規化します', o)
    ref('PERSON', a, `${p}.personIds[0]`, o)
    ref('PERSON', b, `${p}.personIds[1]`, o)
    intYear(m.registeredYear, `${p}.registeredYear`, o)
  })
  world.legal.cases.forEach((c, i) => {
    const p = `$.legal.cases[${i}]`
    const o = { kind: 'LEGAL_CASE', id: c.caseId }
    ref('TITLE', c.titleId, `${p}.titleId`, o)
    c.candidatePersonIds.forEach((id, j) => ref('PERSON', id, `${p}.candidatePersonIds[${j}]`, o))
  })
  world.legal.controlMandates.forEach((m, i) => {
    const p = `$.legal.controlMandates[${i}]`
    const o = { kind: 'ControlMandate', id: m.mandateId }
    const regionOk = ref('REGION', m.regionId, `${p}.regionId`, o)
    ref(controllerKind(m.controllerRef.kind), m.controllerRef.id, `${p}.controllerRef`, o)
    ref('PERSON', m.beneficiaryPersonId, `${p}.beneficiaryPersonId`, o)
    const titleOk = ref('TITLE', m.authorizingTitleId, `${p}.authorizingTitleId`, o)
    if (!(m.effectiveFromYear < m.endExclusiveYear)) add('INVALID_PERIOD', p, '有効期間は effectiveFromYear < endExclusiveYear です', o)
    if (regionOk && titleOk && titleById.get(m.authorizingTitleId)?.regionId !== m.regionId) {
      add('MANDATE_TITLE_REGION_MISMATCH', p, '委任の地域が根拠 Title の地域と一致しません', o, [m.authorizingTitleId])
    }
  })

  // --- 徴税権: 地域×年度で高々 1 件。暗黙の補完はしない ---
  const taxByRegion = new Map<Id, { id: Id; from: number; end: number }[]>()
  world.legal.taxMandates.forEach((m, i) => {
    const p = `$.legal.taxMandates[${i}]`
    const o = { kind: 'TaxCollectionMandate', id: m.mandateId }
    ref('REGION', m.regionId, `${p}.regionId`, o)
    ref('COUNTRY', m.collectorCountryId, `${p}.collectorCountryId`, o)
    if (!(m.effectiveFromYear < m.endExclusiveYear)) {
      add('INVALID_PERIOD', p, '有効期間は effectiveFromYear < endExclusiveYear です', o)
      return
    }
    const list = taxByRegion.get(m.regionId) ?? []
    for (const prev of list) {
      if (m.effectiveFromYear < prev.end && prev.from < m.endExclusiveYear) {
        add('TAX_AUTHORITY_CONFLICT', p, `地域 ${m.regionId} の徴税先が期間重複しています`, o, [prev.id])
      }
    }
    list.push({ id: m.mandateId, from: m.effectiveFromYear, end: m.endExclusiveYear })
    taxByRegion.set(m.regionId, list)
  })
  world.regions.forEach((r, i) => {
    const covered = (taxByRegion.get(r.regionId) ?? []).some((m) => m.from <= world.year && world.year < m.end)
    if (!covered) {
      add('UNRESOLVED_TAX_AUTHORITY', `$.regions[${i}]`, `${world.year} 年の有効な徴税先がありません（診断のみ・補完しません）`, { kind: 'REGION', id: r.regionId }, [], 'WARNING')
    }
  })

  // --- 資源台帳 ---
  world.resources.forEach((a, i) => {
    const p = `$.resources[${i}]`
    const o = { kind: 'ACCOUNT', id: a.accountId }
    ref(controllerKind(a.ownerRef.kind), a.ownerRef.id, `${p}.ownerRef`, o)
    if (a.sourceGroupId !== undefined) ref('GROUP', a.sourceGroupId, `${p}.sourceGroupId`, o)
    if (a.sourceRegionId !== undefined) ref('REGION', a.sourceRegionId, `${p}.sourceRegionId`, o)
    const qOk = isCount(a.quantity)
    const cOk = isCount(a.committed)
    if (!qOk) add('RESOURCE_INVALID_QUANTITY', `${p}.quantity`, `quantity は非負整数です: ${a.quantity}`, o)
    if (!cOk) add('RESOURCE_INVALID_QUANTITY', `${p}.committed`, `committed は非負整数です: ${a.committed}`, o)
    if (qOk && cOk && a.committed > a.quantity) {
      add('RESOURCE_OVER_COMMITTED', p, `committed ${a.committed} が quantity ${a.quantity} を超えています`, o)
    }
  })

  // --- 人口枠・繰延 ---
  world.demographics.cohortSlots.forEach((s, i) => {
    const p = `$.demographics.cohortSlots[${i}]`
    const o = { kind: 'GROUP', id: s.groupId }
    ref('GROUP', s.groupId, `${p}.groupId`, o)
    intYear(s.year, `${p}.year`, o)
    for (const k of ['birthSlots', 'deathSlots', 'claimedBirths', 'claimedDeaths'] as const) {
      if (!isCount(s[k])) add('NOT_NON_NEGATIVE_INTEGER', `${p}.${k}`, `${k} は非負整数です: ${s[k]}`, o)
    }
    if (s.claimedBirths > s.birthSlots || s.claimedDeaths > s.deathSlots) {
      add('COHORT_SLOT_EXCEEDED', p, '請求済みの出生/死亡数が枠を超えています', o)
    }
  })
  world.deferred.forEach((e, i) => {
    const p = `$.deferred[${i}]`
    const o = { kind: 'DeferredEffect', id: e.deferredId }
    if (!(e.effectiveFromYear > e.source.year)) add('INVALID_PERIOD', `${p}.effectiveFromYear`, '繰延効果は発生年の翌年以降に施行します', o)
    ref('GROUP', e.payload.groupId, `${p}.payload.groupId`, o)
    ref('HOUSE', e.payload.houseId, `${p}.payload.houseId`, o)
  })

  return out
}
