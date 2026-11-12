// 年初のWorldStateに記録された各Title保持者の推移。正式な相続や在位の成立を推測しない。
// イベントで確定した移転記録は別に紐づけ、年初保持者の変化と区別する。
import type { EventLogEntry, Id, Title, WorldState } from '../../simulation/contracts/index.ts'

export type TitleHoldingInterval = Readonly<{
  fromYear:number
  throughYear:number
  holder:
    |Readonly<{status:'HELD';personId:Id;personName:string}>
    |Readonly<{status:'UNDETERMINED'}>
    |Readonly<{status:'NOT_RECORDED'}>
}>
export type TitleTransferEvidence=Readonly<{year:number;eventId:Id}>
export type TitleHoldingHistory=Readonly<{
  titleId:Id
  kind:Title['kind']
  label:string
  intervals:readonly TitleHoldingInterval[]
  transfers:readonly TitleTransferEvidence[]
}>

export function titleLabel(title:Title,world:WorldState):string{
  const region=world.regions.find(r=>r.regionId===title.regionId)
  if(title.kind==='CROWN'){
    const country=world.countries.find(c=>c.countryId===region?.sovereignCountryId)
    return (country?.name??region?.name??'名称未確認')+'王位（王冠称号）'
  }
  return (region?.name??title.regionId)+'の領主権（領地称号）'
}

/** 年初の保持者だけで期間をまとめる。保持変更を正式な世襲・移転Eventとみなさない。 */
export function buildTitleHoldingHistories(
  snapshots:readonly WorldState[],eventLog:readonly EventLogEntry[],
):readonly TitleHoldingHistory[]{
  const worlds=[...snapshots].sort((a,b)=>a.year-b.year)
  const titleMeta=new Map<Id,{title:Title;world:WorldState}>()
  for(const world of worlds)for(const title of world.titles)
    if(!titleMeta.has(title.titleId))titleMeta.set(title.titleId,{title,world})
  return [...titleMeta.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([titleId,meta])=>{
    const intervals:TitleHoldingInterval[]=[]
    for(const world of worlds){
      const t=world.titles.find(x=>x.titleId===titleId)
      const currentHolder=t?.holder
      const holder:TitleHoldingInterval['holder']=currentHolder?.status==='HELD'
        ?{status:'HELD',personId:currentHolder.personId,
          personName:world.persons.find(p=>p.personId===currentHolder.personId)?.name??'参照先の人物名を確認できない'}
        :{status:t?'UNDETERMINED':'NOT_RECORDED'}
      const last=intervals.at(-1)
      const same=last?.holder.status===holder.status &&
        (holder.status!=='HELD'||last?.holder.status==='HELD'&&last.holder.personId===holder.personId)
      if(last&&same&&last.throughYear+1===world.year)
        intervals[intervals.length-1]={...last,throughYear:world.year}
      else intervals.push({fromYear:world.year,throughYear:world.year,holder})
    }
    const pathPrefix='$.titles['+titleId+'].holder'
    const transfers=eventLog.filter(e=>e.eventType.split('+').includes('LEGAL_TITLE_TRANSFER')&&
      e.stateChanges.some(c=>c.path===pathPrefix||c.path.startsWith(pathPrefix+'.')))
      .map(e=>({year:e.year,eventId:e.eventId}))
      .sort((a,b)=>a.year-b.year||a.eventId.localeCompare(b.eventId))
    return {titleId,kind:meta.title.kind,label:titleLabel(meta.title,meta.world),intervals,transfers}
  })
}
