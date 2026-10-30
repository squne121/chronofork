// 外部入力（unknown）を構造検証しつつ WorldState の複製へ変換する。型アサーションは使わない。
// 数値の値域・参照の整合は integrity.ts で検証する（ここでは有限な number であることまで）。
import type {
  CohortSlot,
  ControlMandate,
  ControllerRef,
  Country,
  DeferredEffect,
  Dynasty,
  House,
  Id,
  LegalCase,
  LegalDynastyState,
  Marriage,
  Person,
  PopulationGroup,
  Region,
  ResourceAccount,
  ResourceOwnerRef,
  RuleId,
  Source,
  SupportDistribution,
  TaxCollectionMandate,
  Title,
  TitleHolder,
  TitleRecognition,
  WorldState,
} from '../contracts/index.ts'
import { RULE_IDS } from '../contracts/index.ts'
import type { Diagnostic, DiagnosticCode } from './diagnostics.ts'

const PHASES = [1, 2, 3, 4, 5, 6, 7] as const

type Raw = Readonly<Record<string, unknown>>
type Sink = Diagnostic[]

/** 派生値は別の一次値として保存させない（契約 §2.1）。 */
const DERIVED_FIELD_NAMES: ReadonlySet<string> = new Set([
  'treasury',
  'militaryStrength',
  'mobilizationPower',
  'population', // Region.population のみ。PopulationGroup では許可キーに含まれる
  'hasTerritorialControl',
])

function isPlainObject(v: unknown): v is Raw {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  const proto: unknown = Object.getPrototypeOf(v)
  return proto === Object.prototype || proto === null
}

function push(d: Sink, code: DiagnosticCode, path: string, message: string) {
  d.push({ code, severity: 'ERROR', path, target: null, message, related: [] })
}

function obj(d: Sink, v: unknown, path: string, keys: readonly string[]): Raw {
  if (!isPlainObject(v)) {
    push(d, 'INVALID_TYPE', path, 'オブジェクトが必要です')
    return {}
  }
  for (const k of Object.keys(v)) {
    if (keys.includes(k)) continue
    if (DERIVED_FIELD_NAMES.has(k)) {
      push(d, 'DERIVED_FIELD_STORED', `${path}.${k}`, `派生値 ${k} を一次値として保存できません`)
    } else {
      push(d, 'UNKNOWN_FIELD', `${path}.${k}`, `未知のフィールド ${k} です`)
    }
  }
  return v
}

function str(d: Sink, o: Raw, k: string, path: string): string {
  const v = o[k]
  if (v === undefined) push(d, 'MISSING_FIELD', `${path}.${k}`, `${k} が必要です`)
  else if (typeof v !== 'string' || v === '') push(d, 'INVALID_TYPE', `${path}.${k}`, '空でない文字列が必要です')
  else return v
  return ''
}

function optStr(d: Sink, o: Raw, k: string, path: string): string | undefined {
  return o[k] === undefined ? undefined : str(d, o, k, path)
}

function num(d: Sink, o: Raw, k: string, path: string): number {
  const v = o[k]
  if (v === undefined) push(d, 'MISSING_FIELD', `${path}.${k}`, `${k} が必要です`)
  else if (typeof v !== 'number' || !Number.isFinite(v)) push(d, 'INVALID_TYPE', `${path}.${k}`, '有限な数値が必要です')
  else return v
  return 0
}

function optNum(d: Sink, o: Raw, k: string, path: string): number | undefined {
  return o[k] === undefined ? undefined : num(d, o, k, path)
}

function bool(d: Sink, o: Raw, k: string, path: string): boolean {
  const v = o[k]
  if (v === undefined) push(d, 'MISSING_FIELD', `${path}.${k}`, `${k} が必要です`)
  else if (typeof v !== 'boolean') push(d, 'INVALID_TYPE', `${path}.${k}`, '真偽値が必要です')
  else return v
  return false
}

function oneOf<T extends string>(d: Sink, o: Raw, k: string, path: string, allowed: readonly T[], fallback: T): T {
  const v = o[k]
  if (v === undefined) push(d, 'MISSING_FIELD', `${path}.${k}`, `${k} が必要です`)
  else {
    const hit = allowed.find((a) => a === v)
    if (hit !== undefined) return hit
    push(d, 'INVALID_ENUM', `${path}.${k}`, `${allowed.join(' | ')} のいずれかが必要です`)
  }
  return fallback
}

function arr<T>(d: Sink, o: Raw, k: string, path: string, item: (v: unknown, p: string) => T): T[] {
  const v = o[k]
  if (v === undefined) {
    push(d, 'MISSING_FIELD', `${path}.${k}`, `${k} が必要です`)
    return []
  }
  if (!Array.isArray(v)) {
    push(d, 'INVALID_TYPE', `${path}.${k}`, '配列が必要です')
    return []
  }
  return v.map((x: unknown, i) => item(x, `${path}.${k}[${i}]`))
}

function strArr(d: Sink, o: Raw, k: string, path: string): string[] {
  return arr(d, o, k, path, (v, p) => {
    if (typeof v === 'string' && v !== '') return v
    push(d, 'INVALID_TYPE', p, '空でない文字列が必要です')
    return ''
  })
}

function pair(d: Sink, o: Raw, k: string, path: string): readonly [Id, Id] {
  const ids = strArr(d, o, k, path)
  if (ids.length !== 2) {
    push(d, 'INVALID_TYPE', `${path}.${k}`, '要素 2 件の配列が必要です')
    return ['', '']
  }
  return [ids[0] ?? '', ids[1] ?? '']
}

function controllerRef(d: Sink, v: unknown, path: string): ControllerRef {
  const o = obj(d, v, path, ['kind', 'id'])
  return { kind: oneOf(d, o, 'kind', path, ['PERSON', 'HOUSE', 'COUNTRY'], 'COUNTRY'), id: str(d, o, 'id', path) }
}

function ownerRef(d: Sink, v: unknown, path: string): ResourceOwnerRef {
  const o = obj(d, v, path, ['kind', 'id'])
  return {
    kind: oneOf(d, o, 'kind', path, ['PERSON', 'HOUSE', 'COUNTRY', 'GROUP'], 'COUNTRY'),
    id: str(d, o, 'id', path),
  }
}

function source(d: Sink, v: unknown, path: string): Source {
  const o = obj(d, v, path, ['requestId', 'year', 'phase', 'sourceRuleId', 'sourceTraceId', 'sourceIntentId'])
  const phase = PHASES.find((x) => x === o['phase'])
  if (phase === undefined) push(d, 'INVALID_ENUM', `${path}.phase`, 'フェーズは 1..7 の整数です')
  const rawRule = str(d, o, 'sourceRuleId', path)
  const ruleId: RuleId | undefined = RULE_IDS.find((r) => r === rawRule)
  if (ruleId === undefined && rawRule !== '') {
    push(d, 'UNKNOWN_RULE_ID', `${path}.sourceRuleId`, `未登録の RuleID: ${rawRule}`)
  }
  const sourceIntentId = optStr(d, o, 'sourceIntentId', path)
  return {
    requestId: str(d, o, 'requestId', path),
    year: num(d, o, 'year', path),
    phase: phase ?? 1,
    sourceRuleId: ruleId ?? 'A-LEG-01',
    sourceTraceId: str(d, o, 'sourceTraceId', path),
    ...(sourceIntentId === undefined ? {} : { sourceIntentId }),
  }
}

function country(d: Sink, v: unknown, p: string): Country {
  const o = obj(d, v, p, ['countryId', 'name', 'rulerPersonId', 'suzerainCountryId'])
  const rulerPersonId = optStr(d, o, 'rulerPersonId', p)
  const suzerainCountryId = optStr(d, o, 'suzerainCountryId', p)
  return {
    countryId: str(d, o, 'countryId', p),
    name: str(d, o, 'name', p),
    ...(rulerPersonId === undefined ? {} : { rulerPersonId }),
    ...(suzerainCountryId === undefined ? {} : { suzerainCountryId }),
  }
}

function region(d: Sink, v: unknown, p: string): Region {
  const o = obj(d, v, p, ['regionId', 'name', 'sovereignCountryId', 'deFactoControllerRef', 'adjacentRegionIds'])
  return {
    regionId: str(d, o, 'regionId', p),
    name: str(d, o, 'name', p),
    sovereignCountryId: str(d, o, 'sovereignCountryId', p),
    deFactoControllerRef: controllerRef(d, o['deFactoControllerRef'], `${p}.deFactoControllerRef`),
    adjacentRegionIds: strArr(d, o, 'adjacentRegionIds', p),
  }
}

function support(d: Sink, v: unknown, path: string): SupportDistribution {
  const o = obj(d, v, path, ['houseBps', 'undecidedBps'])
  const raw = o['houseBps']
  const entries: [string, number][] = []
  if (!isPlainObject(raw)) push(d, 'INVALID_TYPE', `${path}.houseBps`, 'オブジェクトが必要です')
  else {
    for (const [k, val] of Object.entries(raw)) {
      if (typeof val === 'number' && Number.isFinite(val)) entries.push([k, val])
      else push(d, 'INVALID_TYPE', `${path}.houseBps.${k}`, '有限な数値が必要です')
    }
  }
  return { houseBps: Object.fromEntries(entries), undecidedBps: num(d, o, 'undecidedBps', path) }
}

function group(d: Sink, v: unknown, p: string): PopulationGroup {
  const o = obj(d, v, p, ['groupId', 'regionId', 'name', 'population', 'prosperity', 'unrest', 'support'])
  return {
    groupId: str(d, o, 'groupId', p),
    regionId: str(d, o, 'regionId', p),
    name: str(d, o, 'name', p),
    population: num(d, o, 'population', p),
    prosperity: num(d, o, 'prosperity', p),
    unrest: num(d, o, 'unrest', p),
    support: support(d, o['support'], `${p}.support`),
  }
}

function house(d: Sink, v: unknown, p: string): House {
  const o = obj(d, v, p, ['houseId', 'name', 'countryId', 'headPersonId'])
  const countryId = optStr(d, o, 'countryId', p)
  const headPersonId = optStr(d, o, 'headPersonId', p)
  return {
    houseId: str(d, o, 'houseId', p),
    name: str(d, o, 'name', p),
    ...(countryId === undefined ? {} : { countryId }),
    ...(headPersonId === undefined ? {} : { headPersonId }),
  }
}

function legalDynasty(d: Sink, v: unknown, p: string): LegalDynastyState {
  const status = isPlainObject(v) ? v['status'] : undefined
  if (status === 'UNDETERMINED') {
    const o = obj(d, v, p, ['status', 'reasonCodes'])
    return { status: 'UNDETERMINED', reasonCodes: strArr(d, o, 'reasonCodes', p) }
  }
  const o = obj(d, v, p, ['status', 'dynastyId'])
  if (status !== 'DETERMINED') push(d, 'INVALID_ENUM', `${p}.status`, 'DETERMINED | UNDETERMINED のいずれかが必要です')
  return { status: 'DETERMINED', dynastyId: str(d, o, 'dynastyId', p) }
}

function person(d: Sink, v: unknown, p: string): Person {
  const o = obj(d, v, p, [
    'personId', 'name', 'sex', 'birthYear', 'alive', 'deathYear', 'originGroupId', 'houseId',
    'fatherId', 'motherId', 'bloodlineDynastyId', 'legalDynasty',
  ])
  const deathYear = optNum(d, o, 'deathYear', p)
  const fatherId = optStr(d, o, 'fatherId', p)
  const motherId = optStr(d, o, 'motherId', p)
  const bloodlineDynastyId = optStr(d, o, 'bloodlineDynastyId', p)
  return {
    personId: str(d, o, 'personId', p),
    name: str(d, o, 'name', p),
    sex: oneOf(d, o, 'sex', p, ['MALE', 'FEMALE'], 'MALE'),
    birthYear: num(d, o, 'birthYear', p),
    alive: bool(d, o, 'alive', p),
    originGroupId: str(d, o, 'originGroupId', p),
    houseId: str(d, o, 'houseId', p),
    legalDynasty: legalDynasty(d, o['legalDynasty'], `${p}.legalDynasty`),
    ...(deathYear === undefined ? {} : { deathYear }),
    ...(fatherId === undefined ? {} : { fatherId }),
    ...(motherId === undefined ? {} : { motherId }),
    ...(bloodlineDynastyId === undefined ? {} : { bloodlineDynastyId }),
  }
}

function holder(d: Sink, v: unknown, p: string): TitleHolder {
  const status = isPlainObject(v) ? v['status'] : undefined
  if (status === 'UNDETERMINED') {
    const o = obj(d, v, p, ['status', 'legalCaseId'])
    const legalCaseId = optStr(d, o, 'legalCaseId', p)
    return { status: 'UNDETERMINED', ...(legalCaseId === undefined ? {} : { legalCaseId }) }
  }
  const o = obj(d, v, p, ['status', 'personId'])
  if (status !== 'HELD') push(d, 'INVALID_ENUM', `${p}.status`, 'HELD | UNDETERMINED のいずれかが必要です')
  return { status: 'HELD', personId: str(d, o, 'personId', p) }
}

function recognition(d: Sink, v: unknown, p: string): TitleRecognition {
  const o = obj(d, v, p, ['status', 'authority', 'sovereignCountryId', 'sourceDecisionId'])
  const sovereignCountryId = optStr(d, o, 'sovereignCountryId', p)
  const sourceDecisionId = optStr(d, o, 'sourceDecisionId', p)
  return {
    status: oneOf(d, o, 'status', p, ['ACTIVE', 'PENDING', 'REVOKED'], 'PENDING'),
    ...(o['authority'] === undefined ? {} : { authority: controllerRef(d, o['authority'], `${p}.authority`) }),
    ...(sovereignCountryId === undefined ? {} : { sovereignCountryId }),
    ...(sourceDecisionId === undefined ? {} : { sourceDecisionId }),
  }
}

function title(d: Sink, v: unknown, p: string): Title {
  const o = obj(d, v, p, ['titleId', 'kind', 'regionId', 'holder', 'hereditary', 'valid', 'grantBasisId', 'recognition'])
  return {
    titleId: str(d, o, 'titleId', p),
    kind: oneOf(d, o, 'kind', p, ['TERRITORIAL', 'CROWN'], 'TERRITORIAL'),
    regionId: str(d, o, 'regionId', p),
    holder: holder(d, o['holder'], `${p}.holder`),
    hereditary: bool(d, o, 'hereditary', p),
    valid: bool(d, o, 'valid', p),
    grantBasisId: str(d, o, 'grantBasisId', p),
    recognition: recognition(d, o['recognition'], `${p}.recognition`),
  }
}

function dynasty(d: Sink, v: unknown, p: string): Dynasty {
  const o = obj(d, v, p, ['dynastyId', 'name'])
  return { dynastyId: str(d, o, 'dynastyId', p), name: str(d, o, 'name', p) }
}

function marriage(d: Sink, v: unknown, p: string): Marriage {
  const o = obj(d, v, p, ['marriageId', 'personIds', 'registeredYear', 'status'])
  return {
    marriageId: str(d, o, 'marriageId', p),
    personIds: pair(d, o, 'personIds', p),
    registeredYear: num(d, o, 'registeredYear', p),
    status: oneOf(d, o, 'status', p, ['ACTIVE', 'DISSOLVED'], 'ACTIVE'),
  }
}

function legalCase(d: Sink, v: unknown, p: string): LegalCase {
  const o = obj(d, v, p, ['caseId', 'titleId', 'kind', 'status', 'candidatePersonIds', 'reasonCodes'])
  return {
    caseId: str(d, o, 'caseId', p),
    titleId: str(d, o, 'titleId', p),
    kind: oneOf(d, o, 'kind', p, ['SUCCESSION', 'RECOGNITION', 'REVOCATION'], 'SUCCESSION'),
    status: oneOf(d, o, 'status', p, ['PENDING', 'APPROVED', 'REJECTED'], 'PENDING'),
    candidatePersonIds: strArr(d, o, 'candidatePersonIds', p),
    reasonCodes: strArr(d, o, 'reasonCodes', p),
  }
}

function controlMandate(d: Sink, v: unknown, p: string): ControlMandate {
  const o = obj(d, v, p, [
    'mandateId', 'regionId', 'controllerRef', 'beneficiaryPersonId', 'authorizingTitleId',
    'sourceEventId', 'effectiveFromYear', 'endExclusiveYear',
  ])
  return {
    mandateId: str(d, o, 'mandateId', p),
    regionId: str(d, o, 'regionId', p),
    controllerRef: controllerRef(d, o['controllerRef'], `${p}.controllerRef`),
    beneficiaryPersonId: str(d, o, 'beneficiaryPersonId', p),
    authorizingTitleId: str(d, o, 'authorizingTitleId', p),
    sourceEventId: str(d, o, 'sourceEventId', p),
    effectiveFromYear: num(d, o, 'effectiveFromYear', p),
    endExclusiveYear: num(d, o, 'endExclusiveYear', p),
  }
}

function taxMandate(d: Sink, v: unknown, p: string): TaxCollectionMandate {
  const o = obj(d, v, p, ['mandateId', 'regionId', 'collectorCountryId', 'effectiveFromYear', 'endExclusiveYear', 'sourceTreatyOrLawId'])
  return {
    mandateId: str(d, o, 'mandateId', p),
    regionId: str(d, o, 'regionId', p),
    collectorCountryId: str(d, o, 'collectorCountryId', p),
    effectiveFromYear: num(d, o, 'effectiveFromYear', p),
    endExclusiveYear: num(d, o, 'endExclusiveYear', p),
    sourceTreatyOrLawId: str(d, o, 'sourceTreatyOrLawId', p),
  }
}

function account(d: Sink, v: unknown, p: string): ResourceAccount {
  const o = obj(d, v, p, ['accountId', 'kind', 'ownerRef', 'quantity', 'committed', 'sourceGroupId', 'sourceRegionId'])
  const sourceGroupId = optStr(d, o, 'sourceGroupId', p)
  const sourceRegionId = optStr(d, o, 'sourceRegionId', p)
  return {
    accountId: str(d, o, 'accountId', p),
    kind: oneOf(d, o, 'kind', p, ['CASH_MILLI_BU', 'FORCE_HEADCOUNT'], 'CASH_MILLI_BU'),
    ownerRef: ownerRef(d, o['ownerRef'], `${p}.ownerRef`),
    quantity: num(d, o, 'quantity', p),
    committed: num(d, o, 'committed', p),
    ...(sourceGroupId === undefined ? {} : { sourceGroupId }),
    ...(sourceRegionId === undefined ? {} : { sourceRegionId }),
  }
}

function cohortSlot(d: Sink, v: unknown, p: string): CohortSlot {
  const o = obj(d, v, p, ['groupId', 'year', 'birthSlots', 'deathSlots', 'claimedBirths', 'claimedDeaths'])
  return {
    groupId: str(d, o, 'groupId', p),
    year: num(d, o, 'year', p),
    birthSlots: num(d, o, 'birthSlots', p),
    deathSlots: num(d, o, 'deathSlots', p),
    claimedBirths: num(d, o, 'claimedBirths', p),
    claimedDeaths: num(d, o, 'claimedDeaths', p),
  }
}

function deferred(d: Sink, v: unknown, p: string): DeferredEffect {
  const o = obj(d, v, p, ['deferredId', 'source', 'effectiveFromYear', 'payload'])
  const pp = `${p}.payload`
  const po = obj(d, o['payload'], pp, ['kind', 'groupId', 'houseId', 'signal', 'causeEventId'])
  if (po['kind'] !== 'SUPPORT_SIGNAL') push(d, 'INVALID_ENUM', `${pp}.kind`, 'SUPPORT_SIGNAL が必要です')
  return {
    deferredId: str(d, o, 'deferredId', p),
    source: source(d, o['source'], `${p}.source`),
    effectiveFromYear: num(d, o, 'effectiveFromYear', p),
    payload: {
      kind: 'SUPPORT_SIGNAL',
      groupId: str(d, po, 'groupId', pp),
      houseId: str(d, po, 'houseId', pp),
      signal: num(d, po, 'signal', pp),
      causeEventId: str(d, po, 'causeEventId', pp),
    },
  }
}

/** 構造検証。診断を `d` へ追加し、複製した WorldState を返す（エラー時の戻り値は使わないこと）。 */
export function parseWorldState(input: unknown, d: Sink): WorldState {
  const p = '$'
  const o = obj(d, input, p, [
    'year', 'countries', 'regions', 'groups', 'houses', 'persons', 'titles', 'legal',
    'resources', 'demographics', 'deferred',
  ])
  const lo = obj(d, o['legal'], '$.legal', ['dynasties', 'marriages', 'cases', 'controlMandates', 'taxMandates'])
  const dem = obj(d, o['demographics'], '$.demographics', ['cohortSlots'])
  return {
    year: num(d, o, 'year', p),
    countries: arr(d, o, 'countries', p, (v, q) => country(d, v, q)),
    regions: arr(d, o, 'regions', p, (v, q) => region(d, v, q)),
    groups: arr(d, o, 'groups', p, (v, q) => group(d, v, q)),
    houses: arr(d, o, 'houses', p, (v, q) => house(d, v, q)),
    persons: arr(d, o, 'persons', p, (v, q) => person(d, v, q)),
    titles: arr(d, o, 'titles', p, (v, q) => title(d, v, q)),
    legal: {
      dynasties: arr(d, lo, 'dynasties', '$.legal', (v, q) => dynasty(d, v, q)),
      marriages: arr(d, lo, 'marriages', '$.legal', (v, q) => marriage(d, v, q)),
      cases: arr(d, lo, 'cases', '$.legal', (v, q) => legalCase(d, v, q)),
      controlMandates: arr(d, lo, 'controlMandates', '$.legal', (v, q) => controlMandate(d, v, q)),
      taxMandates: arr(d, lo, 'taxMandates', '$.legal', (v, q) => taxMandate(d, v, q)),
    },
    resources: arr(d, o, 'resources', p, (v, q) => account(d, v, q)),
    demographics: { cohortSlots: arr(d, dem, 'cohortSlots', '$.demographics', (v, q) => cohortSlot(d, v, q)) },
    deferred: arr(d, o, 'deferred', p, (v, q) => deferred(d, v, q)),
  }
}
