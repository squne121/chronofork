// DEC-057 / Issue #67: 1250年のexperimental世界に対する国内通常法制の校正用背景記録。
// GAME-02/03の発行主体は採用済み。ただし、この法令ID・適格性審査・有効期間の具体値は仮値。
// 正式シナリオでも、成立する婚姻・相続・勝利でもない。初期世界そのものは変更しない。
import type { LegalEvidenceBook } from '../../simulation/legal/evidence.ts'
import type { OrdinaryLaw } from '../../simulation/legal/ordinary-authority.ts'
import type { OrdinaryMarriageReview } from '../../simulation/rules/a/aleg01-ordinary.ts'
import { createExperimentalLegalEvidence } from './legal-evidence.ts'
import type { ProvenanceEntry } from './provenance.ts'

const eldia={kind:'COUNTRY' as const,id:'country-eldia'}
const basic=(id:string,action:OrdinaryLaw['action']):OrdinaryLaw=>({
  lawId:id,action,issuerRef:eldia,sovereignCountryId:eldia.id,
  effectiveFromYear:1250,endExclusiveYear:1351,
  origin:'BACKGROUND_PRE_1250',provenance:'CALIBRATION_ONLY',
})

/** 固定年の未来イベントではなく、各年の実WorldStateで適用可能性を審査する法令。 */
export const EXPERIMENTAL_ORDINARY_LAWS:readonly OrdinaryLaw[]=Object.freeze([
  basic('exp-law-domestic-marriage','NORMAL_MARRIAGE'),
  basic('exp-law-land-succession','NORMAL_LAND_SUCCESSION'),
  basic('exp-law-crown-succession','CROWN_SUCCESSION'),
  {...basic('exp-law-central-new-mandate','NEW_CONTROL_MANDATE'),
    regionId:'region-eldia-central',titleId:'title-exp-central',grantBasisId:'exp-basis-central'},
])

/** P4/P5の婚姻適格性は人間が検証したという技術仮定。B-004/B-005が不成立なら婚姻は起こらない。
 * P2/P5には複数の契約草案があり、誰も選択していないのでここでは選択・成立させない。
 */
export const EXPERIMENTAL_ORDINARY_MARRIAGE_REVIEWS:readonly OrdinaryMarriageReview[]=Object.freeze([
  {reviewId:'exp-review-p4p5-no-special-clauses',personIds:['person-exp-04','person-exp-05'],
    countryId:eldia.id,lawId:'exp-law-domestic-marriage',reviewedBy:eldia,
    availableFromYear:1250,endExclusiveYear:1350,contractCandidateId:null,
    status:'ELIGIBLE',provenance:'CALIBRATION_ONLY'},
])

export function createExperimentalOrdinaryLegalTrial():Readonly<{
  book:LegalEvidenceBook
  laws:readonly OrdinaryLaw[]
  marriageReviews:readonly OrdinaryMarriageReview[]
}> {
  const book=createExperimentalLegalEvidence()
  return {
    book:{...book,approvalAuthorities:[
      {authorityBasisId:'exp-law-domestic-marriage',action:'NORMAL_MARRIAGE',
        holderRef:eldia,sovereignCountryId:eldia.id,provenance:'CALIBRATION_ONLY'},
      {authorityBasisId:'exp-law-land-succession',action:'NORMAL_LAND_SUCCESSION',
        holderRef:eldia,sovereignCountryId:eldia.id,provenance:'CALIBRATION_ONLY'},
      {authorityBasisId:'exp-law-crown-succession',action:'CROWN_SUCCESSION',
        holderRef:eldia,sovereignCountryId:eldia.id,provenance:'CALIBRATION_ONLY'},
    ]},
    laws:structuredClone(EXPERIMENTAL_ORDINARY_LAWS),
    marriageReviews:structuredClone(EXPERIMENTAL_ORDINARY_MARRIAGE_REVIEWS),
  }
}
export const EXPERIMENTAL_ORDINARY_LEGAL_PROVENANCE:readonly ProvenanceEntry[]=Object.freeze([
  {subject:'国内通常婚姻・世襲土地相続・中央新委任の仮の授権法令',
    origin:'PLACEHOLDER',source:'docs/spec/mvp-spec.md §8 (DEC-057)',
    note:'CALIBRATION_ONLY。権限者の方針のみ正式。法令ID・年月・発行可否は試験値で、未来の成立イベントを予約しない。'},
  {subject:'エルディア王位の独立した通常継承法令・授権（試験設定）',
    origin:'PLACEHOLDER',source:'https://github.com/squne121/chronofork/issues/119#issuecomment-6843021884',
    note:'CALIBRATION_ONLY。特定の相続結果・判定年・後継者は設定せず、各年の実際の証拠と存命順位で審査する。'},
  {subject:'P4/P5の通常婚姻適格性・無特約の試験認定',
    origin:'PLACEHOLDER',source:'docs/spec/pending-approvals.md GAME-02',
    note:'P2/P5の複数婚姻契約を勝手に選ばない。生まれる子の法的王朝は無条項ならUNDETERMINED。'},
])
