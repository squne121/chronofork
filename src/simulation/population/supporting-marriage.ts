// DEC-061: 非操作対象の婚姻相手候補をPopulationGroupの内訳から抽象的に提示する。
// 候補はPerson/婚姻/出生/Eventではない。B-005の双方意思・A-LEG-01の承認と禁親審査が別途必要。
// 個別氏名・王朝所属は生成しない。出自階層・数・年齢分布はCALIBRATION_ONLYで正式史実ではない。
import type { Id, WorldState, Year } from '../contracts/index.ts'
import { START_YEAR } from '../contracts/index.ts'
import { drawRandom } from '../random.ts'

/** 階層区分は試験用の供給源分類。正式な身分法・Title・家門の追加ではない。 */
export type SupportingSocialTier='REGIONAL_UPPER_NOBILITY'|'REGIONAL_LOWER_NOBILITY'

export type SupportingMarriageCohort=Readonly<{
  cohortId:Id
  groupId:Id
  affiliationHouseId:Id
  /** 親族審査のための供給源ラベル。親子関係や無血縁を証明するものではない。 */
  familyPoolId:Id
  tier:SupportingSocialTier
  sex:'MALE'|'FEMALE'
  birthYear:Year
  /** 当該人口集団内の未個別化者の一部。PopulationGroup.populationに加算しない。 */
  memberCount:number
  source:'INITIAL_POPULATION'|'C004_COHORT'
  /** 初期集団の年齢構成を想定する試験台帳の識別子。C004の場合は出生枠の参照ラベル。 */
  sourceEvidenceId:Id
  /** C004出生枠とは独立した、成人までの存命者の試験用確認出典。 */
  survivorAttestationId?:Id
  provenance:'CALIBRATION_ONLY'
}>
export type SupportingMarriageCandidate=Readonly<{
  candidateId:Id
  cohortId:Id
  ordinal:number
  groupId:Id
  affiliationHouseId:Id
  familyPoolId:Id
  tier:SupportingSocialTier
  sex:'MALE'|'FEMALE'
  birthYear:Year
  /** 人口集団にすでに含まれる未個別化者。交渉に進むまでPersonではない。 */
  interactionRole:'SUPPORTING'
  individualPersonRegistered:false
  kinshipStatus:'UNVERIFIED'
  provenance:'CALIBRATION_ONLY'
}>
export type SupportingMarriageSupplyOptions=Readonly<{
  seed:number
  /** 試験用候補短縮。婚姻は確定しない。 */
  maxCandidates:number
  perCohortSamples:number
  maximumPreviewAge:number
  /** 既に個別化された候補または他の婚姻へ使用済みの候補ID。 */
  usedCandidateIds?:ReadonlySet<Id>
}>
export type SupportingMarriageSupplyResult=
 | Readonly<{status:'PROPOSED';candidates:readonly SupportingMarriageCandidate[];reasonCodes:readonly string[]}>
 | Readonly<{status:'DEFER';candidates:readonly [];reasonCodes:readonly string[]}>

const present=(v:unknown):v is string=>typeof v==='string'&&v.length>0
const integer=(v:unknown):v is number=>typeof v==='number'&&Number.isSafeInteger(v)
const cmp=(a:string,b:string)=>a<b?-1:a>b?1:0

export const supportingCandidateId=(cohortId:Id,ordinal:number):Id=>
  'support:population:'+JSON.stringify([cohortId,ordinal])

/** 外部入力は事前に検証。集団人数だけで性別/年齢/身分を補完しない。 */
export function validateSupportingMarriageCohorts(
  world:WorldState,cohorts:readonly SupportingMarriageCohort[],
):readonly string[]{
  if(!Array.isArray(cohorts))return ['COHORT_LIST_INVALID']
  const issues:string[]=[]
  const ids=new Set<Id>(),familySlots=new Set<string>()
  const allocatedByGroup=new Map<Id,number>()
  const allocatedBirths=new Map<string,number>()
  const realizedByCohort=(cohortId:Id)=>world.persons.filter(p=>{
    if(!p.personId.startsWith('support:population:'))return false
    try{
      const v:unknown=JSON.parse(p.personId.slice('support:population:'.length))
      return Array.isArray(v)&&v[0]===cohortId&&Number.isSafeInteger(v[1])
    }catch{return false}
  })
  for(const [i,c] of cohorts.entries()){
    if(!c||!present(c.cohortId)||!present(c.groupId)||!present(c.affiliationHouseId)||
      !present(c.familyPoolId)||!present(c.sourceEvidenceId)||
      !['REGIONAL_UPPER_NOBILITY','REGIONAL_LOWER_NOBILITY'].includes(c.tier)||
      !['MALE','FEMALE'].includes(c.sex)||
      !integer(c.birthYear)||!integer(c.memberCount)||c.memberCount<1||
      !['INITIAL_POPULATION','C004_COHORT'].includes(c.source)||
      c.provenance!=='CALIBRATION_ONLY'){
      issues.push('COHORT_RECORD_INVALID:'+i)
      continue
    }
    if(ids.has(c.cohortId))issues.push('COHORT_ID_DUPLICATE:'+c.cohortId)
    ids.add(c.cohortId)
    const overlapKey=JSON.stringify([c.groupId,c.birthYear,c.sex,c.familyPoolId])
    if(familySlots.has(overlapKey))issues.push('COHORT_FAMILY_SLOT_OVERLAP:'+i)
    familySlots.add(overlapKey)
    const group=world.groups.find(g=>g.groupId===c.groupId)
    const region=group&&world.regions.find(r=>r.regionId===group.regionId)
    const house=world.houses.find(h=>h.houseId===c.affiliationHouseId)
    if(!group||!region||!house?.countryId||house.countryId!==region.sovereignCountryId||
       !world.countries.some(x=>x.countryId===house.countryId)||
       group.support.houseBps[house.houseId]===undefined){
      issues.push('COHORT_GROUP_OR_JURISDICTION_UNVERIFIED:'+i)
      continue
    }
    if(c.source==='INITIAL_POPULATION'){
      if(c.birthYear>=START_YEAR)issues.push('INITIAL_COHORT_NOT_PRE_START:'+i)
    }else{
      if(c.birthYear<START_YEAR||c.birthYear>=world.year)
        issues.push('C004_COHORT_YEAR_INVALID:'+i)
      if(!present(c.survivorAttestationId)||c.survivorAttestationId===c.sourceEvidenceId)
        issues.push('C004_SURVIVOR_ATTESTATION_MISSING:'+i)
      const record=world.demographics.anonymousBirthHistory?.find(
        s=>s.groupId===c.groupId&&s.year===c.birthYear)
      if(!record||record.anonymousBirths<c.memberCount)
        issues.push('C004_BIRTH_BACKING_INSUFFICIENT:'+i)
      const key=JSON.stringify([c.groupId,c.birthYear])
      allocatedBirths.set(key,(allocatedBirths.get(key)??0)+c.memberCount)
    }
    const represented=realizedByCohort(c.cohortId)
    if(represented.some(p=>p.originGroupId!==c.groupId||p.birthYear!==c.birthYear)||
      represented.length>c.memberCount)issues.push('COHORT_MEMBER_RECORD_CONFLICT:'+i)
    const aliveRealized=represented.filter(p=>p.alive).length
    allocatedByGroup.set(c.groupId,(allocatedByGroup.get(c.groupId)??0)+c.memberCount-aliveRealized)
  }
  for(const [key,count] of allocatedBirths){
    const [groupId,year]=JSON.parse(key) as [Id,number]
    const backed=world.demographics.anonymousBirthHistory?.find(
      s=>s.groupId===groupId&&s.year===year)
    if(!backed||count>backed.anonymousBirths)
      issues.push('C004_SHARED_BIRTH_CAPACITY_EXCEEDED:'+key)
  }
  for(const [groupId,count] of allocatedByGroup){
    const group=world.groups.find(g=>g.groupId===groupId)
    const living=world.persons.filter(p=>p.originGroupId===groupId&&p.alive).length
    if(group&&count+living>group.population)issues.push('GROUP_POPULATION_CAPACITY_EXCEEDED:'+groupId)
  }
  return issues
}

/** 既存の重要人物と異なる「集団内の抽象的候補」を必要な数だけ列挙。
 * 戻り値の候補はまだ婚姻・個別Personではなく、血縁の無関係さも未証明。
 */
export function proposeSupportingMarriageCandidates(
  world:WorldState,seekerId:Id,cohorts:readonly SupportingMarriageCohort[],
  options:SupportingMarriageSupplyOptions,
):SupportingMarriageSupplyResult{
  if(!options||!integer(options.seed)||options.seed<0||
    !integer(options.maxCandidates)||options.maxCandidates<1||options.maxCandidates>32||
    !integer(options.perCohortSamples)||options.perCohortSamples<1||options.perCohortSamples>16||
    !integer(options.maximumPreviewAge)||options.maximumPreviewAge<18||options.maximumPreviewAge>100)
    return {status:'DEFER',candidates:[],reasonCodes:['SUPPLY_CALIBRATION_INVALID']}
  const errors=validateSupportingMarriageCohorts(world,cohorts)
  if(errors.length>0)return{status:'DEFER',candidates:[],reasonCodes:errors}
  const seeker=world.persons.find(p=>p.personId===seekerId)
  if(!seeker||!seeker.alive||world.year-seeker.birthYear<18)
    return{status:'DEFER',candidates:[],reasonCodes:['SEEKER_NOT_ADULT_OR_AVAILABLE']}
  if(world.legal.marriages.some(m=>m.status==='ACTIVE'&&m.personIds.includes(seekerId)))
    return{status:'DEFER',candidates:[],reasonCodes:['SEEKER_ALREADY_MARRIED']}
  const house=world.houses.find(h=>h.houseId===seeker.houseId)
  if(!house?.countryId)return{status:'DEFER',candidates:[],reasonCodes:['SEEKER_JURISDICTION_UNVERIFIED']}
  const possible:{candidate:SupportingMarriageCandidate;rank:number}[]=[]
  for(const pool of cohorts){
    const h=world.houses.find(x=>x.houseId===pool.affiliationHouseId)
    if(!h||h.countryId!==house.countryId||pool.sex===seeker.sex)continue
    const age=world.year-pool.birthYear
    if(age<18||age>options.maximumPreviewAge)continue
    // サンプルは候補探査であり、婚姻の判断スコアではない。偏ったID順の最終選択を行わない。
    // 使用済みのslotを引いたとしても未使用者が残る限り探索を続ける。
    // シードで開始位置を決め、全slotを最大1回だけ巡回するため空候補の偽判定を防ぐ。
    const samples=Math.min(pool.memberCount,options.perCohortSamples)
    const start=Math.floor(drawRandom(options.seed,{
      stream:'ENDOGENOUS',year:world.year,phase:3,ruleId:'B-001',
      actorId:seekerId,targetId:pool.cohortId,eventKey:'SUPPORTING_CANDIDATE_START',
    })*pool.memberCount)
    let selected=0
    for(let i=0;i<pool.memberCount&&selected<samples;i++){
      const slot=(start+i)%pool.memberCount
      const id=supportingCandidateId(pool.cohortId,slot)
      if(options.usedCandidateIds?.has(id)||world.persons.some(p=>p.personId===id))continue
      selected++
      const candidate:SupportingMarriageCandidate={
        candidateId:id,cohortId:pool.cohortId,ordinal:slot,
        groupId:pool.groupId,affiliationHouseId:pool.affiliationHouseId,
        familyPoolId:pool.familyPoolId,tier:pool.tier,
        sex:pool.sex,birthYear:pool.birthYear,
        interactionRole:'SUPPORTING',individualPersonRegistered:false,
        kinshipStatus:'UNVERIFIED',provenance:'CALIBRATION_ONLY',
      }
      const rank=drawRandom(options.seed,{
        stream:'ENDOGENOUS',year:world.year,phase:3,ruleId:'B-001',
        actorId:seekerId,targetId:id,eventKey:'SUPPORTING_OFFER_RANK',
      })
      possible.push({candidate,rank})
    }
  }
  possible.sort((a,b)=>a.rank-b.rank||cmp(a.candidate.candidateId,b.candidate.candidateId))
  if(possible.length===0)return {status:'DEFER',candidates:[],reasonCodes:['NO_COHORT_CANDIDATE_AVAILABLE']}
  return{status:'PROPOSED',candidates:possible.slice(0,options.maxCandidates).map(x=>x.candidate),
    reasonCodes:['POPULATION_COHORT_OFFERS_ONLY','LEGAL_KINSHIP_REVIEW_REQUIRED']}
}
