// Issue #71 / DEC-061: 実C004出生履歴を用いる非操作配偶者の独立した試験出典。
// 家門・人口ラベルだけから血縁、存命、婚姻可能性は判定しない。
import type {WorldState} from '../../../src/simulation/contracts/index.ts'
import type {B001PromotionInput} from '../../../src/simulation/rules/b/index.ts'
import type {SupportingMarriageCohort} from '../../../src/simulation/population/supporting-marriage.ts'
import {supportingCandidateId} from '../../../src/simulation/population/supporting-marriage.ts'
import type {SupportingKinshipClearance} from '../../../src/simulation/rules/a/index.ts'
import {childIdForMarriageYear} from '../../../src/simulation/rules/b/b002-worldstate.ts'
import {pairKey} from '../../../src/simulation/intervention/index.ts'

export const attestedId='person:experimental-census:east-cardon-1249'
export const attested:B001PromotionInput={
  cohorts:[{
    cohortId:'experimental-census:birth-1249-east-commons',
    groupId:'group-east-commons',
    birthYear:1249,memberCount:3,recordedYear:1249,
    censusEvidenceId:'experimental-census:pre1250-age-group-evidence',
    provenance:'CALIBRATION_ONLY',
  }],
  identities:[{
    identityEvidenceId:'experimental-identity:cardon-person-1249',
    cohortId:'experimental-census:birth-1249-east-commons',
    memberOrdinal:0,personId:attestedId,
    personName:'実験用の記名候補（史実・正式設定ではない）',
    sex:'FEMALE',houseId:'house-cardon',recordedYear:1249,
    provenance:'CALIBRATION_ONLY',
  }],
}

// 1260年にC004が本当に確定した匿名出生履歴を1278年の成人証拠と別々に要求。
const cohort:SupportingMarriageCohort={
  cohortId:'trial:issue71:C004:1260:east-female',
  groupId:'group-east-elite',affiliationHouseId:'house-cardon',
  familyPoolId:'trial:issue71:independently-attested-cardon-unrelated-family',
  tier:'REGIONAL_LOWER_NOBILITY',sex:'FEMALE',birthYear:1260,memberCount:1,
  source:'C004_COHORT',sourceEvidenceId:'trial:issue71:C004:1260:east',
  survivorAttestationId:'trial:issue71:separate-survivor-census:1278:east',
  provenance:'CALIBRATION_ONLY',
}
export const supportingCohorts:readonly SupportingMarriageCohort[]=[cohort]
export const supportingPersonId=supportingCandidateId(cohort.cohortId,0)

// 既存の1250年B005/A-LEG01婚姻からB002が実出生した場合の、1252年男子の安定ID。
// これは出典付き禁親証拠の対象IDを固定するだけ。出生や性別をworldへ追加しない。
// 実際の父母・生存・性別・法的帰属は長期計算で独立に照合する。
const familyPair=['person-exp-02','person-exp-05'] as const
const marriageId='marriage:normal:'+JSON.stringify([1250,pairKey(familyPair)])
export const witnessedSonId=childIdForMarriageYear(marriageId,
  'person-exp-02','person-exp-05',1252)
// 下記は人口・家門の推論ではなく、ペア個別に与える合成試験上の別個の血縁確認資料。
export const supportingClearances:readonly SupportingKinshipClearance[]=[{
  clearanceId:'trial:issue71:independent-kinship-check:1278',
  personIds:[witnessedSonId,supportingPersonId],
  countryId:'country-eldia',checkedYear:1278,validUntilYear:1320,
  sourceEvidenceId:'trial:issue71:person-level-lineage-record-distinct-from-C004-and-survivor',
  provenance:'CALIBRATION_ONLY',
}]
export const withC004BirthHistory=(w:WorldState):WorldState=>({
  ...w,demographics:{...w.demographics,anonymousBirthHistory:[]},
})
