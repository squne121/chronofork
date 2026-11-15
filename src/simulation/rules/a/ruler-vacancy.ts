// DEC-077（MVP限定）: 国家統治者の確定死亡後、後継が未承認なら参照のみ未確定へ。
// 国家存続・王位/領地・実効支配・委任・徴税権は変更しない。B-003の実Eventを必須とする。
import type {
  CountryRulerVacateCommand, DecisionTraceDraft, DomainCommand, WorldState,
} from '../../contracts/index.ts'
import type { RuleEvaluator } from '../../engine/evaluators.ts'

export const RULER_VACANCY_VERSION = 'ruler-death-vacancy-mvp-1'
const cmp=(a:string,b:string)=>a<b?-1:a>b?1:0

/** 王位の承認済み後継への更新を優先し、それ以外で死亡者のまま残る国家だけ未確定化する。 */
export function withCountryRulerVacancy(base: RuleEvaluator): RuleEvaluator {
  return (world,ctx) => {
    const original=base(world,ctx)
    const traceDrafts:DecisionTraceDraft[]=[...original.traceDrafts]
    const commands:DomainCommand[]=[...original.commands]
    const rulerUpdates=new Set(original.commands.filter(c=>c.type==='COUNTRY_RULER_SET')
      .map(c=>c.countryId))
    const deaths=(ctx.priorTraces??[]).filter(t=>
      t.ruleId==='B-003' && t.year===ctx.year && t.status==='ACCEPT' &&
      t.actorRef.kind==='PERSON' && t.eventIds.length===1)
    for(const country of [...world.countries].sort((a,b)=>cmp(a.countryId,b.countryId))){
      const deceasedId=country.rulerPersonId
      if(!deceasedId || rulerUpdates.has(country.countryId))continue
      const person=world.persons.find(p=>p.personId===deceasedId)
      if(!person || person.alive || person.deathYear!==ctx.year)continue
      const witnesses=deaths.filter(t=>t.actorRef.kind==='PERSON' && t.actorRef.id===deceasedId)
      // 証拠が0件または複数件なら、適用を偽装せず保留する（B-003死亡の実証が必要）。
      if(witnesses.length!==1)continue
      const death=witnesses[0]!
      const key=JSON.stringify([ctx.year,country.countryId,deceasedId])
      const candidateId='ruler-vacancy:'+key
      const traceIndex=traceDrafts.length
      traceDrafts.push({
        year:ctx.year,phase:ctx.phase,ruleId:ctx.ruleId,
        actorRef:{kind:'COUNTRY',id:country.countryId},
        candidates:[{candidateId,eligible:true,
          inputs:{countryId:country.countryId,deceasedPersonId:deceasedId,
            sourceB003TraceId:death.traceId,sourceB003EventId:death.eventIds[0]!,
            nextRulerPersonId:null},
          reasonCodes:['CONFIRMED_RULER_DEATH','RULER_REFERENCE_CLEARANCE_ONLY'],
        }],
        selectedCandidateId:candidateId,status:'ACCEPT',
        reasonCodes:['RULER_REFERENCE_CLEARANCE_ONLY','RULER_SUCCESSION_UNDETERMINED',
          'NOT_SUCCESSION_APPROVAL','NO_TERRITORIAL_OR_TAX_TRANSFER'],
        modifierIds:[],ruleVersion:RULER_VACANCY_VERSION,
      })
      const command:CountryRulerVacateCommand={
        type:'COUNTRY_RULER_VACATE',
        commandId:'cmd:ruler-vacancy:'+key,
        source:{requestId:'req:ruler-vacancy:'+key,
          year:ctx.year,phase:ctx.phase,sourceRuleId:'A-TIT-07',
          sourceTraceId:ctx.traceId(traceIndex),sourceIntentId:death.eventIds[0]!},
        countryId:country.countryId,deceasedPersonId:deceasedId,sourceDeathEventId:death.eventIds[0]!,
      }
      commands.push(command)
    }
    return {...original,commands,traceDrafts}
  }
}
