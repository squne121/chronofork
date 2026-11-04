// DEC-061: A/B共通の補助婚姻候補向け禁親確認証拠（試験用技術契約）。
// 人口コホートや家門ラベルは血縁の無関係さを証明しない。
import type {Id, WorldState, Year} from '../contracts/index.ts'

export type SupportingKinshipClearance=Readonly<{
  clearanceId:Id
  personIds:readonly [Id,Id]
  countryId:Id
  checkedYear:Year
  validUntilYear:Year
  sourceEvidenceId:Id
  provenance:'CALIBRATION_ONLY'
}>
export type SupportingKinshipStatus=
  | Readonly<{status:'CLEARED';reasonCode:'SUPPORTING_KINSHIP_REVIEW_MATCHED';clearanceId:Id|null}>
  | Readonly<{status:'DEFER';reasonCode:'SUPPORTING_KINSHIP_CLEARANCE_MISSING'|'SUPPORTING_KINSHIP_CLEARANCE_AMBIGUOUS'}>

export function validateSupportingKinshipClearances(
  clearances:readonly SupportingKinshipClearance[],
):readonly string[]{
  if(!Array.isArray(clearances))return ['SUPPORTING_CLEARANCE_LIST_INVALID']
  const issues:string[]=[]
  const seen=new Set<Id>()
  for(const [i,c] of clearances.entries()){
    if(!c||typeof c.clearanceId!=='string'||!c.clearanceId||
      typeof c.sourceEvidenceId!=='string'||!c.sourceEvidenceId||
      !Array.isArray(c.personIds)||c.personIds.length!==2||
      typeof c.personIds[0]!=='string'||!c.personIds[0]||
      typeof c.personIds[1]!=='string'||!c.personIds[1]||
      c.personIds[0]>=c.personIds[1]||!c.countryId||
      !Number.isSafeInteger(c.checkedYear)||!Number.isSafeInteger(c.validUntilYear)||
      c.validUntilYear<=c.checkedYear||c.provenance!=='CALIBRATION_ONLY'||
      seen.has(c.clearanceId))issues.push('SUPPORTING_CLEARANCE_INVALID:'+i)
    if(c?.clearanceId)seen.add(c.clearanceId)
  }
  return issues
}

/** 記録済み近親照合とは別の証拠境界。Bで相互順位構築前、Aで法的登録前に同じ条件を検査する。 */
export function reviewSupportingKinshipClearance(
  world:WorldState,pair:readonly [Id,Id],countryId:Id,year:Year,
  clearances:readonly SupportingKinshipClearance[],
):SupportingKinshipStatus{
  if(!pair.some(id=>world.persons.find(p=>p.personId===id)?.interactionRole==='SUPPORTING'))
    return {status:'CLEARED',reasonCode:'SUPPORTING_KINSHIP_REVIEW_MATCHED',clearanceId:null}
  const matching=clearances.filter(c=>
    c.personIds[0]===pair[0]&&c.personIds[1]===pair[1]&&
    c.countryId===countryId&&c.checkedYear<=year&&year<c.validUntilYear)
  if(matching.length===0)
    return {status:'DEFER',reasonCode:'SUPPORTING_KINSHIP_CLEARANCE_MISSING'}
  if(matching.length>1)
    return {status:'DEFER',reasonCode:'SUPPORTING_KINSHIP_CLEARANCE_AMBIGUOUS'}
  return {status:'CLEARED',reasonCode:'SUPPORTING_KINSHIP_REVIEW_MATCHED',
    clearanceId:matching[0]!.clearanceId}
}
