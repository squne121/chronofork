// 統合モードの経過一覧。実WorldState/EventLog/DecisionTraceを読み取って集計するだけで、規則・勝敗は持たない。
import type { EventLogEntry, Id, Person, WorldState } from '../simulation/contracts/index.ts'
import type { PlayView } from './branch-play-source.ts'
import { descendantDepths } from './dynasty-continuity.ts'
import { describeEvent, shortPersonName } from './event-summary.ts'
import type { EventNames } from './event-summary.ts'

export type EventCategory=Readonly<{key:string;label:string;types:readonly string[]}>
export const EVENT_CATEGORIES:readonly EventCategory[]=Object.freeze([
  {key:'supporting',label:'SUPPORTING人物の登録',types:['PERSON_SUPPORTING_RECORD']},
  {key:'marriage',label:'婚姻の成立',types:['MARRIAGE_REGISTER']},
  {key:'birth',label:'出生',types:['PERSON_BIRTH']},
  {key:'death',label:'死亡',types:['PERSON_DEATH']},
  {key:'dissolve',label:'婚姻の終了（配偶者の死亡）',types:['MARRIAGE_DISSOLVE']},
  {key:'dynasty',label:'法的王朝の確定',types:['LEGAL_DYNASTY_SET']},
  {key:'case',label:'相続審査の記録',types:['LEGAL_CASE_SET']},
  {key:'title',label:'土地Titleの移転',types:['LEGAL_TITLE_TRANSFER']},
  {key:'mandate',label:'統治委任の設定',types:['CONTROL_MANDATE_SET']},
])
const typesOf=(e:EventLogEntry)=>e.eventType.split('+')
export const inCategory=(e:EventLogEntry,c:EventCategory)=>typesOf(e).some(t=>c.types.includes(t))

export type CategoryRow=Readonly<{
  category:EventCategory
  a0:readonly EventLogEntry[]
  a1:readonly EventLogEntry[]
  /** A1にだけ / A0にだけ / 同じeventIdで内容が違う */
  a1Only:readonly EventLogEntry[]
  a0Only:readonly EventLogEntry[]
  changed:readonly EventLogEntry[]
}>
export type IntegratedOverview=Readonly<{
  rows:readonly CategoryRow[]
  totalDifferences:number
  /** 1350年末のWorldStateが完全一致か(両枝とも最後まで計算されている場合のみ意味を持つ)。 */
  finalWorldIdentical:boolean|null
  interventionTraces:Readonly<{a0:number;a1:number}>
}>

export function buildOverview(v:PlayView):IntegratedOverview{
  const e0=v.a0.result.eventLog,e1=v.a1.result.eventLog
  const m0=new Map(e0.map(e=>[e.eventId,e])),m1=new Map(e1.map(e=>[e.eventId,e]))
  const rows=EVENT_CATEGORIES.map((category):CategoryRow=>{
    const a0=e0.filter(e=>inCategory(e,category)),a1=e1.filter(e=>inCategory(e,category))
    const a1Only=a1.filter(e=>!m0.has(e.eventId))
    const a0Only=a0.filter(e=>!m1.has(e.eventId))
    const changed=a1.filter(e=>{const o=m0.get(e.eventId);return o!==undefined&&o!==e&&JSON.stringify(o)!==JSON.stringify(e)})
    return {category,a0,a1,a1Only,a0Only,changed}
  })
  // 分類外のEventも差分の有無には含める(全期間のEvent差分。省略された同一Eventは差分ではない)。
  const outsideDiff=[...e1.filter(e=>!m0.has(e.eventId)),...e0.filter(e=>!m1.has(e.eventId))]
    .filter(e=>!EVENT_CATEGORIES.some(c=>inCategory(e,c))).length+
    e1.filter(e=>{const o=m0.get(e.eventId);return o!==undefined&&o!==e&&!EVENT_CATEGORIES.some(c=>inCategory(e,c))&&JSON.stringify(o)!==JSON.stringify(e)}).length
  const diffIds=new Set<string>()
  for(const r of rows)for(const e of [...r.a1Only,...r.a0Only,...r.changed])diffIds.add(e.eventId)
  const totalDifferences=outsideDiff+diffIds.size
  const f0=v.a0.result.snapshots.at(-1),f1=v.a1.result.snapshots.at(-1)
  const finalWorldIdentical=f0&&f1&&f0.year===f1.year?JSON.stringify(f0)===JSON.stringify(f1):null
  const mid=v.modifier.modifierId
  const used=(r:PlayView['a0'])=>r.result.decisionTraces.filter(t=>t.modifierIds.includes(mid)).length
  return {rows,totalDifferences,finalWorldIdentical,interventionTraces:{a0:used(v.a0),a1:used(v.a1)}}
}

/** 最終snapshotから引いた表示名。無い参照は「参照不明」とせずIDをそのまま返す。 */
export function namesOf(w:WorldState|undefined):EventNames{
  return {
    person:id=>{const p=w?.persons.find(x=>x.personId===id);return p?shortPersonName(p.name):undefined},
    group:id=>w?.groups.find(g=>g.groupId===id)?.name,
    dynasty:id=>w?.legal.dynasties.find(d=>d.dynastyId===id)?.name,
  }
}
export function eventHeadline(e:EventLogEntry,names:EventNames,typeLabel:string):string{
  const d=describeEvent(e,names)
  if(d)return d.headline
  const people=e.involvedRefs.flatMap(r=>r.kind==='PERSON'?[names.person(r.id)??r.id]:r.kind==='PERSON_PAIR'?r.ids.map(i=>names.person(i)??i):[])
  return `${typeLabel}（${e.year}年）${people.length>0?' '+people.join('・'):''}`
}

export type LineageRow=Readonly<{
  personId:Id;name:string;birthYear:number;generation:number;
  father:string;mother:string;dynasty:string;alive:boolean
}>
/** 1250年に存在しなかった人物の実親子関係と法的王朝帰属。世代は実在する親子辺だけから数える。 */
export function lineageRows(initial:WorldState,final:WorldState|undefined):readonly LineageRow[]{
  if(!final)return []
  const initialIds=new Set(initial.persons.map(p=>p.personId))
  const depths=descendantDepths(initial,final.persons)
  const names=namesOf(final)
  const parent=(id:Id|undefined)=>id===undefined?'記録なし':names.person(id)??id
  const dyn=(p:Person)=>p.legalDynasty.status==='DETERMINED'?names.dynasty(p.legalDynasty.dynastyId)??p.legalDynasty.dynastyId:'未確定'
  return final.persons.filter(p=>!initialIds.has(p.personId)&&p.birthYear>=initial.year)
    .map(p=>({personId:p.personId,name:shortPersonName(p.name),birthYear:p.birthYear,generation:depths.get(p.personId)??-1,
      father:parent(p.fatherId),mother:parent(p.motherId),dynasty:dyn(p),alive:p.alive}))
    .sort((a,b)=>a.birthYear-b.birthYear||a.personId.localeCompare(b.personId))
}

export type TitleRow=Readonly<{
  titleId:Id;region:string;holder:string;pendingCases:number;activeMandates:number
}>
/** 1350年(最終snapshot)の土地Title保持者・相続PENDING・統治委任。補完せず記録だけを読む。 */
export function titleRows(final:WorldState|undefined):readonly TitleRow[]{
  if(!final)return []
  const names=namesOf(final)
  return final.titles.filter(t=>t.kind==='TERRITORIAL').map(t=>({
    titleId:t.titleId,
    region:final.regions.find(r=>r.regionId===t.regionId)?.name??t.regionId,
    holder:t.holder.status==='HELD'?(names.person(t.holder.personId)??t.holder.personId):'未確定（相続PENDING）',
    pendingCases:final.legal.cases.filter(c=>c.titleId===t.titleId&&c.kind==='SUCCESSION'&&c.status==='PENDING').length,
    activeMandates:final.legal.controlMandates.filter(m=>m.regionId===t.regionId&&m.effectiveFromYear<=final.year&&final.year<m.endExclusiveYear).length,
  })).sort((a,b)=>a.titleId.localeCompare(b.titleId))
}
