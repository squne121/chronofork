// 1250 年 experimental 世界の法的証拠記録。正式な世界設定・歴史ではない（pending-approvals §2、GAME-01〜03）。
// 1200〜1249 の背景史は計算せず、授与・承認は「背景史に由来する記録」として参照可能にするだけで、
// 1250 年以降の EventLog は偽造しない。婚姻の成立年・結果・子・相続・勝敗は固定しない。
import type { LegalEvidenceBook, MarriageContractCandidate } from '../../simulation/legal/evidence.ts'
import type { ProvenanceEntry } from './provenance.ts'
import { NALVEN_DYNASTY_ID } from './world-1250.ts'

const GAP = 'docs/spec/pending-approvals.md §2（データ不足）'
const country = (c: string) => ({ kind: 'COUNTRY' as const, id: `country-${c}` })

/** [titleId 接尾, 地域, 初期保有者, 主権国]。world-1250 の Title 配置と同一の試験配置。 */
const TITLES = [
  ['crown-eldia', 'eldia-central', 'person-exp-01', 'eldia'],
  ['central', 'eldia-central', 'person-exp-01', 'eldia'],
  ['west', 'eldia-west', 'person-exp-04', 'eldia'],
  ['east', 'eldia-east', 'person-exp-05', 'eldia'],
  ['south', 'eldia-south', 'person-exp-06', 'eldia'],
  ['margald-home', 'margald-home', 'person-exp-08', 'margald'],
  ['versa-coast', 'versa-coast', 'person-exp-07', 'versa'],
] as const

const REGIONS = [
  ['eldia-central', 'eldia'], ['eldia-west', 'eldia'], ['eldia-east', 'eldia'], ['eldia-south', 'eldia'],
  ['margald-home', 'margald'], ['versa-coast', 'versa'],
] as const

/** 人物02/05の婚姻契約候補。未登録で、成立年・結果を持たない。条項の有無で GAME-01 の分岐を試験できる。 */
export const EXPERIMENTAL_MARRIAGE_CANDIDATES: readonly MarriageContractCandidate[] = Object.freeze([
  {
    candidateId: 'cand-exp-02-05-no-clause',
    personIds: ['person-exp-02', 'person-exp-05'],
    contract: { contractId: 'contract-exp-02-05-a', evidenceId: 'evidence-exp-02-05-a', clauses: [] },
    registration: 'NOT_REGISTERED', provenance: 'CALIBRATION_ONLY',
  },
  {
    candidateId: 'cand-exp-02-05-nalven-clause',
    personIds: ['person-exp-02', 'person-exp-05'],
    contract: {
      contractId: 'contract-exp-02-05-b', evidenceId: 'evidence-exp-02-05-b',
      clauses: [{ clauseId: 'clause-exp-02-05-b1', kind: 'CHILD_LEGAL_DYNASTY', dynastyId: NALVEN_DYNASTY_ID }],
    },
    registration: 'NOT_REGISTERED', provenance: 'CALIBRATION_ONLY',
  },
] satisfies MarriageContractCandidate[])

export function createExperimentalLegalEvidence(): LegalEvidenceBook {
  return structuredClone({
    titleGrants: TITLES.map(([id, , holder, c]) => ({
      grantBasisId: `exp-basis-${id}`, titleId: `title-exp-${id}`, initialGranteePersonId: holder,
      grantorRef: country(c), sovereignCountryId: `country-${c}`, hereditary: true as const,
      origin: 'BACKGROUND_PRE_1250' as const, provenance: 'CALIBRATION_ONLY' as const,
    })),
    titleRecognitions: TITLES.map(([id, , , c]) => ({
      decisionId: `exp-decision-${id}`, titleId: `title-exp-${id}`, authority: country(c),
      sovereignCountryId: `country-${c}`, provenance: 'CALIBRATION_ONLY' as const,
    })),
    administrations: REGIONS.map(([r, c]) => ({
      basisId: `exp-admin-${r}`, regionId: `region-${r}`, controllerRef: country(c), provenance: 'CALIBRATION_ONLY' as const,
    })),
    taxBases: [{
      sourceTreatyOrLawId: 'exp-law-initial-tax',
      collectors: REGIONS.map(([r, c]) => ({ regionId: `region-${r}`, collectorCountryId: `country-${c}` })),
      provenance: 'CALIBRATION_ONLY' as const,
    }],
    // 婚姻・通常土地相続を承認する権限者の根拠は未承認（GAME-02）。創作せず空にする。
    approvalAuthorities: [],
    marriageCandidates: EXPERIMENTAL_MARRIAGE_CANDIDATES,
  })
}

export const EXPERIMENTAL_LEGAL_PROVENANCE: readonly ProvenanceEntry[] = Object.freeze([
  { subject: 'Title の授与根拠・承認記録・初期行政支配・初期徴税根拠の記録', origin: 'PLACEHOLDER', source: GAP, note: '背景史（〜1249）由来の試験記録。1250 以降の EventLog は作らない。正式化には承認が必要' },
  { subject: '人物02/05の婚姻契約候補 2 件（条項なし／ナルヴェン帰属条項）', origin: 'PLACEHOLDER', source: 'docs/spec/pending-approvals.md GAME-01', note: '未登録の候補。成立年・成立結果・子・相続・勝敗を固定しない。条項は試験用で正式設定ではない' },
  { subject: '婚姻・通常土地相続を承認する権限者', origin: 'PLACEHOLDER', source: 'docs/spec/pending-approvals.md GAME-02', note: '根拠が未承認のため記録なし（承認審査は PENDING）' },
] satisfies ProvenanceEntry[])
