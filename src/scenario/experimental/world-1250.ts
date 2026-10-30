// 1250 年の experimental 初期世界。出典と仮値を provenance に明記する。
// これは正式な世界設定ではなく、型・検証・テスト用の試験フィクスチャである。
// 勝利経路・固定年イベントは含めない。正式化にはユーザー承認が必要（pending-approvals §2）。
import type { VersionInfo, WorldState } from '../../simulation/contracts/index.ts'
import { EXPERIMENTAL_TUNING } from '../../simulation/tuning.ts'
import type { TuningConfig } from '../../simulation/tuning.ts'
import type { ProvenanceEntry } from './provenance.ts'

export const NALVEN_DYNASTY_ID = 'dynasty-nalven'

const SPEC = 'docs/spec/mvp-spec.md §2'
const GAP = 'docs/spec/pending-approvals.md §2（データ不足）'

const COUNTRIES = ['eldia', 'margald', 'versa'] as const

/** 家門名（接頭辞なし）→ houseId に変換した支持 bps（無党派込み 10000）。仮値。 */
function support(weights: Readonly<Record<string, number>>, undecidedBps: number) {
  return {
    houseBps: Object.fromEntries(Object.entries(weights).map(([k, v]) => [`house-${k}`, v])),
    undecidedBps,
  }
}

function build(): WorldState {
  const g = (
    groupId: string,
    regionId: string,
    name: string,
    population: number,
    unrest: number,
    houseBps: Readonly<Record<string, number>>,
    undecidedBps: number,
  ) => ({
    groupId,
    regionId,
    name,
    population,
    prosperity: 50,
    unrest,
    support: support(houseBps, undecidedBps),
  })
  const person = (
    n: number,
    name: string,
    sex: 'MALE' | 'FEMALE',
    birthYear: number,
    originGroupId: string,
    houseId: string,
    dynastyId: string,
    parents: { fatherId?: string } = {},
  ) => ({
    personId: `person-exp-${String(n).padStart(2, '0')}`,
    name,
    sex,
    birthYear,
    alive: true,
    originGroupId,
    houseId,
    bloodlineDynastyId: dynastyId,
    legalDynasty: { status: 'DETERMINED' as const, dynastyId },
    ...parents,
  })
  const title = (
    id: string,
    kind: 'TERRITORIAL' | 'CROWN',
    regionId: string,
    personId: string,
    countryId: string,
  ) => ({
    titleId: `title-exp-${id}`,
    kind,
    regionId,
    holder: { status: 'HELD' as const, personId },
    hereditary: true,
    valid: true,
    grantBasisId: `exp-basis-${id}`,
    recognition: {
      status: 'ACTIVE' as const,
      authority: { kind: 'COUNTRY' as const, id: `country-${countryId}` },
      sovereignCountryId: `country-${countryId}`,
      sourceDecisionId: `exp-decision-${id}`,
    },
  })
  const taxMandate = (regionId: string, countryId: string) => ({
    mandateId: `tax-exp-${regionId}`,
    regionId: `region-${regionId}`,
    collectorCountryId: `country-${countryId}`,
    effectiveFromYear: 1250,
    endExclusiveYear: 1351,
    sourceTreatyOrLawId: 'exp-law-initial-tax',
  })

  return {
    year: 1250,
    countries: [
      { countryId: 'country-eldia', name: 'エルディア', rulerPersonId: 'person-exp-01' },
      { countryId: 'country-margald', name: 'マルガルド', rulerPersonId: 'person-exp-08' },
      { countryId: 'country-versa', name: 'ヴェルサ' },
    ],
    regions: [
      { regionId: 'region-eldia-central', name: 'エルディア中央', sovereignCountryId: 'country-eldia', deFactoControllerRef: { kind: 'COUNTRY', id: 'country-eldia' }, adjacentRegionIds: ['region-eldia-west', 'region-eldia-east', 'region-eldia-south'] },
      { regionId: 'region-eldia-west', name: 'エルディア西部', sovereignCountryId: 'country-eldia', deFactoControllerRef: { kind: 'COUNTRY', id: 'country-eldia' }, adjacentRegionIds: ['region-eldia-central', 'region-margald-home'] },
      { regionId: 'region-eldia-east', name: 'エルディア東部', sovereignCountryId: 'country-eldia', deFactoControllerRef: { kind: 'COUNTRY', id: 'country-eldia' }, adjacentRegionIds: ['region-eldia-central', 'region-versa-coast'] },
      { regionId: 'region-eldia-south', name: 'エルディア南部', sovereignCountryId: 'country-eldia', deFactoControllerRef: { kind: 'COUNTRY', id: 'country-eldia' }, adjacentRegionIds: ['region-eldia-central', 'region-versa-coast'] },
      { regionId: 'region-margald-home', name: 'マルガルド本領', sovereignCountryId: 'country-margald', deFactoControllerRef: { kind: 'COUNTRY', id: 'country-margald' }, adjacentRegionIds: ['region-eldia-west'] },
      { regionId: 'region-versa-coast', name: 'ヴェルサ沿岸', sovereignCountryId: 'country-versa', deFactoControllerRef: { kind: 'COUNTRY', id: 'country-versa' }, adjacentRegionIds: ['region-eldia-east', 'region-eldia-south'] },
    ],
    groups: [
      g('group-central-elite', 'region-eldia-central', '中央・地域有力層', 2000, 40, { nalven: 5000, vargas: 1500, cardon: 1000, rowen: 500, berd: 500 }, 1500),
      g('group-central-commons', 'region-eldia-central', '中央・一般住民', 40000, 40, { nalven: 3000, vargas: 1000, cardon: 1000, rowen: 1000, berd: 500 }, 3500),
      g('group-west-elite', 'region-eldia-west', '西部・地域有力層', 1500, 70, { nalven: 2000, vargas: 4000, cardon: 500, rowen: 500, berd: 500 }, 2500),
      g('group-west-commons', 'region-eldia-west', '西部・一般住民', 30000, 70, { nalven: 2000, vargas: 3000, cardon: 500, rowen: 500, berd: 500 }, 3500),
      g('group-east-elite', 'region-eldia-east', '東部・地域有力層', 1500, 55, { nalven: 2000, vargas: 500, cardon: 4000, rowen: 500, berd: 500 }, 2500),
      g('group-east-commons', 'region-eldia-east', '東部・一般住民', 30000, 55, { nalven: 2000, vargas: 500, cardon: 3000, rowen: 500, berd: 500 }, 3500),
      g('group-south-elite', 'region-eldia-south', '南部・地域有力層', 1500, 35, { nalven: 2000, vargas: 500, cardon: 500, rowen: 4000, berd: 500 }, 2500),
      g('group-south-commons', 'region-eldia-south', '南部・一般住民', 30000, 35, { nalven: 2000, vargas: 500, cardon: 500, rowen: 3000, berd: 500 }, 3500),
      g('group-margald', 'region-margald-home', 'マルガルド本領住民', 50000, 40, { 'margald-royal': 6000 }, 4000),
      g('group-versa', 'region-versa-coast', 'ヴェルサ沿岸住民', 20000, 40, { berd: 3000 }, 7000),
    ],
    houses: [
      { houseId: 'house-nalven', name: 'ナルヴェン', countryId: 'country-eldia', headPersonId: 'person-exp-01' },
      { houseId: 'house-vargas', name: 'ヴァルガス', countryId: 'country-eldia', headPersonId: 'person-exp-04' },
      { houseId: 'house-cardon', name: 'カルドン', countryId: 'country-eldia', headPersonId: 'person-exp-05' },
      { houseId: 'house-rowen', name: 'ロウエン', countryId: 'country-eldia', headPersonId: 'person-exp-06' },
      { houseId: 'house-berd', name: 'ベルド', headPersonId: 'person-exp-07' },
      { houseId: 'house-margald-royal', name: 'マルガルド王家', countryId: 'country-margald', headPersonId: 'person-exp-08' },
    ],
    persons: [
      person(1, '試験人物01（ナルヴェン当主）', 'MALE', 1208, 'group-central-elite', 'house-nalven', NALVEN_DYNASTY_ID),
      person(2, '試験人物02（ナルヴェン嫡男）', 'MALE', 1230, 'group-central-elite', 'house-nalven', NALVEN_DYNASTY_ID, { fatherId: 'person-exp-01' }),
      person(3, '試験人物03（ナルヴェン娘）', 'FEMALE', 1233, 'group-central-elite', 'house-nalven', NALVEN_DYNASTY_ID, { fatherId: 'person-exp-01' }),
      person(4, '試験人物04（ヴァルガス当主）', 'MALE', 1215, 'group-west-elite', 'house-vargas', 'dynasty-vargas'),
      person(5, '試験人物05（カルドン当主）', 'MALE', 1210, 'group-east-elite', 'house-cardon', 'dynasty-cardon'),
      person(6, '試験人物06（ロウエン当主）', 'MALE', 1220, 'group-south-elite', 'house-rowen', 'dynasty-rowen'),
      person(7, '試験人物07（ベルド当主）', 'MALE', 1218, 'group-versa', 'house-berd', 'dynasty-berd'),
      person(8, '試験人物08（マルガルド王）', 'MALE', 1212, 'group-margald', 'house-margald-royal', 'dynasty-margald-royal'),
    ],
    titles: [
      title('crown-eldia', 'CROWN', 'region-eldia-central', 'person-exp-01', 'eldia'),
      title('central', 'TERRITORIAL', 'region-eldia-central', 'person-exp-01', 'eldia'),
      title('west', 'TERRITORIAL', 'region-eldia-west', 'person-exp-04', 'eldia'),
      title('east', 'TERRITORIAL', 'region-eldia-east', 'person-exp-05', 'eldia'),
      title('south', 'TERRITORIAL', 'region-eldia-south', 'person-exp-06', 'eldia'),
      title('margald-home', 'TERRITORIAL', 'region-margald-home', 'person-exp-08', 'margald'),
      title('versa-coast', 'TERRITORIAL', 'region-versa-coast', 'person-exp-07', 'versa'),
    ],
    legal: {
      dynasties: [
        { dynastyId: NALVEN_DYNASTY_ID, name: 'ナルヴェン' },
        { dynastyId: 'dynasty-vargas', name: 'ヴァルガス' },
        { dynastyId: 'dynasty-cardon', name: 'カルドン' },
        { dynastyId: 'dynasty-rowen', name: 'ロウエン' },
        { dynastyId: 'dynasty-berd', name: 'ベルド' },
        { dynastyId: 'dynasty-margald-royal', name: 'マルガルド王家' },
      ],
      marriages: [],
      cases: [],
      controlMandates: [],
      taxMandates: [
        taxMandate('eldia-central', 'eldia'),
        taxMandate('eldia-west', 'eldia'),
        taxMandate('eldia-east', 'eldia'),
        taxMandate('eldia-south', 'eldia'),
        taxMandate('margald-home', 'margald'),
        taxMandate('versa-coast', 'versa'),
      ],
    },
    resources: [
      ...COUNTRIES.flatMap((c, i) => [
        { accountId: `acct-cash-${c}`, kind: 'CASH_MILLI_BU' as const, ownerRef: { kind: 'COUNTRY' as const, id: `country-${c}` }, quantity: [52000, 60000, 30000][i] ?? 0, committed: 0 },
        { accountId: `acct-force-${c}`, kind: 'FORCE_HEADCOUNT' as const, ownerRef: { kind: 'COUNTRY' as const, id: `country-${c}` }, quantity: [800, 1000, 300][i] ?? 0, committed: 0 },
      ]),
    ],
    demographics: { cohortSlots: [] },
    deferred: [],
  }
}

export const EXPERIMENTAL_VERSIONS: VersionInfo = Object.freeze({
  schemaVersion: 1,
  scenarioVersion: 'experimental-1250-v0',
  rulesetVersion: EXPERIMENTAL_TUNING.rulesetVersion,
  legalSystemVersion: 'experimental-legal-0',
  rngVersion: null,
})

/** 仕様に値がある初期傾向。WorldState の一次値ではなく、BU への換算も行わない。 */
export const EXPERIMENTAL_INITIAL_TENDENCIES = Object.freeze({
  eldiaTreasuryOutOf100: 45,
  eldiaLegitimacyOutOf100: 50,
  unrestOutOf100: Object.freeze({ west: 70, east: 55, south: 35 }),
})

export const EXPERIMENTAL_PROVENANCE: readonly ProvenanceEntry[] = Object.freeze([
  { subject: '国家 3・地域 6・人口集団 10・家門 6・重要人物 8 の件数', origin: 'SPEC_KNOWN', source: SPEC },
  { subject: '地域の所属（エルディア 4・マルガルド本領・ヴェルサ沿岸）と集団の配置', origin: 'SPEC_KNOWN', source: SPEC },
  { subject: '家門 6 の名称', origin: 'SPEC_KNOWN', source: SPEC },
  { subject: '国庫 45/100・正統性 50/100', origin: 'SPEC_KNOWN', source: SPEC, note: '表示上の初期傾向。45BU とは断定せず、台帳の現金残高とは未対応' },
  { subject: '不満 西部 70・東部 55・南部 35', origin: 'SPEC_KNOWN', source: SPEC, note: '地域値のため、当該地域の 2 集団へ同値を仮置き' },
  { subject: '人物の氏名・生年・続柄・家門・所属集団', origin: 'PLACEHOLDER', source: GAP, note: '試験データ。実在人物設定ではない' },
  { subject: '人口・繁栄度・上記以外の不満・家門支持 bps', origin: 'PLACEHOLDER', source: GAP },
  { subject: '地域の隣接関係', origin: 'PLACEHOLDER', source: GAP },
  { subject: 'Title の配置・授与根拠・承認 authority', origin: 'PLACEHOLDER', source: GAP, note: '法的根拠は試験データ。勝利条件の判定対象として正式化されていない' },
  { subject: '初期 TaxCollectionMandate（徴税先＝主権国）', origin: 'PLACEHOLDER', source: GAP, note: 'GAME-04: 初期値の明示のみ。占領・宗主への暗黙移転は行わない' },
  { subject: '台帳の現金・兵員残高', origin: 'PLACEHOLDER', source: GAP, note: 'CALIBRATION_ONLY' },
] satisfies ProvenanceEntry[])

export type ExperimentalScenario = Readonly<{
  id: 'experimental-1250'
  status: 'EXPERIMENTAL'
  versions: VersionInfo
  tuning: TuningConfig
  world: WorldState
  tendencies: typeof EXPERIMENTAL_INITIAL_TENDENCIES
  provenance: readonly ProvenanceEntry[]
}>

/** 呼び出しごとに新しい複製を返す（テストでの改変が他へ波及しない）。 */
export function createExperimentalWorld(): WorldState {
  return build()
}

export function createExperimentalScenario(): ExperimentalScenario {
  return {
    id: 'experimental-1250',
    status: 'EXPERIMENTAL',
    versions: EXPERIMENTAL_VERSIONS,
    tuning: EXPERIMENTAL_TUNING,
    world: build(),
    tendencies: EXPERIMENTAL_INITIAL_TENDENCIES,
    provenance: EXPERIMENTAL_PROVENANCE,
  }
}
