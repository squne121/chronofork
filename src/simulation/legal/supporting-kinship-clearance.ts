// DEC-061: A/B共通の補助婚姻候補向け禁親確認証拠（試験用技術契約）。
// 人口コホートや家門ラベルは血縁の無関係さを証明しない。
import type {Id, Person, WorldState, Year} from '../contracts/index.ts'
import { marriageCandidatePersons } from './nextgen-marriage.ts'
import { canonicalize } from '../engine/reducer/canonical.ts'

export type SupportingKinshipClearance=Readonly<{
  clearanceId:Id
  personIds:readonly [Id,Id]
  countryId:Id
  checkedYear:Year
  validUntilYear:Year
  sourceEvidenceId:Id
  provenance:'CALIBRATION_ONLY'
/** 既存の票は確認済み。工程2Bの抽象調査では否定結果も保持する。 */
abstractFinding?:'PROHIBITED'|'UNVERIFIED'
}>
export type SupportingKinshipStatus=
  | Readonly<{status:'CLEARED';reasonCode:'SUPPORTING_KINSHIP_REVIEW_MATCHED';clearanceId:Id|null;clearanceRecordKey:string|null}>
  | Readonly<{status:'DEFER';reasonCode:'SUPPORTING_KINSHIP_CLEARANCE_MISSING'|'SUPPORTING_KINSHIP_CLEARANCE_AMBIGUOUS'|'ABSTRACT_KINSHIP_PROHIBITED'|'ABSTRACT_KINSHIP_INVESTIGATION_INCOMPLETE'|'CANDIDATE_VIEW_INVALID'|'PERSON_UNKNOWN'}>

const present=(value:unknown):value is Id=>typeof value==='string'&&value.trim().length>0
export const isIndependentKinshipSource=(id:unknown,populationEvidenceIds:readonly Id[]):boolean=>
  present(id)&&!populationEvidenceIds.some(source=>present(source)&&source.trim()===id.trim())

export function validateSupportingKinshipClearances(
  clearances:readonly SupportingKinshipClearance[],
):readonly string[]{
  if(!Array.isArray(clearances))return ['SUPPORTING_CLEARANCE_LIST_INVALID']
  const issues:string[]=[]
  const seen=new Set<Id>()
  for(const [i,c] of clearances.entries()){
    if(!c||!present(c.clearanceId)||!present(c.sourceEvidenceId)||
      !Array.isArray(c.personIds)||c.personIds.length!==2||
      !present(c.personIds[0])||!present(c.personIds[1])||
      c.personIds[0]>=c.personIds[1]||!present(c.countryId)||
      !Number.isSafeInteger(c.checkedYear)||!Number.isSafeInteger(c.validUntilYear)||
      c.validUntilYear<=c.checkedYear||c.provenance!=='CALIBRATION_ONLY'||
      (c.abstractFinding!==undefined&&c.abstractFinding!=='PROHIBITED'&&c.abstractFinding!=='UNVERIFIED')||
      seen.has(c.clearanceId))issues.push('SUPPORTING_CLEARANCE_INVALID:'+i)
    if(c?.clearanceId)seen.add(c.clearanceId)
  }
  return issues
}

// 相互順位の母集団と法的再審査で同じ証拠を使う。台帳の並び順は評価に影響しない。
export const supportingClearanceKey = (records: readonly SupportingKinshipClearance[], year:Year,
  pairs:ReadonlyMap<string,string>): string => JSON.stringify(records.filter(c=>
    c.checkedYear<=year&&year<c.validUntilYear&&pairs.get(JSON.stringify(c.personIds))===c.countryId).map(canonicalize).sort())

/** 記録済み近親照合とは別の証拠境界。Bで相互順位構築前、Aで法的登録前に同じ条件を検査する。 */
export function reviewSupportingKinshipClearance(
  world:WorldState,pair:readonly [Id,Id],countryId:Id,year:Year,
  clearances:readonly SupportingKinshipClearance[],candidates:readonly Person[]=[],
  populationEvidenceIds:readonly Id[]=[],
):SupportingKinshipStatus{
  const persons=marriageCandidatePersons(world,pair,candidates)
  if(!persons)return {status:'DEFER',reasonCode:'CANDIDATE_VIEW_INVALID'}
  if(pair.some(id=>!persons.some(p=>p.personId===id)))
    return {status:'DEFER',reasonCode:'PERSON_UNKNOWN'}
  if(!pair.some(id=>persons.find(p=>p.personId===id)?.interactionRole==='SUPPORTING'))
    return {status:'CLEARED',reasonCode:'SUPPORTING_KINSHIP_REVIEW_MATCHED',clearanceId:null,clearanceRecordKey:null}
  const [a,b]=pair[0]<pair[1]?pair:[pair[1],pair[0]]
  const matching=clearances.filter(c=>
    (c?.personIds?.[0]===a&&c.personIds[1]===b || c?.personIds?.[0]===b&&c.personIds[1]===a)&&
    c.countryId===countryId&&c.checkedYear<=year&&year<c.validUntilYear)
  if(matching.length>1)
    return {status:'DEFER',reasonCode:'SUPPORTING_KINSHIP_CLEARANCE_AMBIGUOUS'}
  const record=matching[0]
  if(!record||validateSupportingKinshipClearances([record]).length>0||
    !isIndependentKinshipSource(record.sourceEvidenceId,[...populationEvidenceIds,
      ...world.legal.marriages.flatMap(m=>m.supportingPopulationEvidenceIds??[])]))
    return {status:'DEFER',reasonCode:'SUPPORTING_KINSHIP_CLEARANCE_MISSING'}
  if(record.abstractFinding!==undefined)return {status:'DEFER',reasonCode:record.abstractFinding==='PROHIBITED'
    ?'ABSTRACT_KINSHIP_PROHIBITED':'ABSTRACT_KINSHIP_INVESTIGATION_INCOMPLETE'}
  return {status:'CLEARED',reasonCode:'SUPPORTING_KINSHIP_REVIEW_MATCHED',
    clearanceId:record.clearanceId,clearanceRecordKey:canonicalize(record)}
}
