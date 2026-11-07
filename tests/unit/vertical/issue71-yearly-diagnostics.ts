// Issue #71: 年次の既存WorldState・EventLog・DecisionTraceを読むだけのボトルネック観測。
// ゲーム規則・法的承認・勝利を補完せず、すべてCALIBRATION_ONLYの試験データとして扱う。
import type {DecisionTrace,EventLogEntry,Id,WorldState} from '../../../src/simulation/contracts/index.ts'
import type {TimelineResult} from '../../../src/simulation/engine/index.ts'
import {evaluateGoal} from '../../../src/simulation/goal.ts'

type History=Readonly<Pick<TimelineResult,'status'|'snapshots'|'eventLog'|'decisionTraces'>>
const countType=(ev:readonly EventLogEntry[],type:string)=>ev.filter(e=>
  e.eventType.split('+').includes(type)).length
const countRule=(ts:readonly DecisionTrace[],rule:string,status?:DecisionTrace['status'])=>
  ts.filter(t=>t.ruleId===rule&&(status===undefined||t.status===status)).length
const reasons=(ts:readonly DecisionTrace[],rule:string):Readonly<Record<string,number>>=>{
  const m=new Map<string,number>()
  for(const t of ts.filter(t=>t.ruleId===rule&&t.status==='DEFER'))
    for(const code of t.reasonCodes.filter(c=>c!=='CALIBRATION_ONLY')){
      m.set(code,(m.get(code)??0)+1)
    }
  return Object.fromEntries([...m.entries()].sort(([a],[b])=>a.localeCompare(b)))
}
/** 1350年以外にGoal判定を生成しない。年末の情報を年初状態へ逆流させない。 */
export function auditYearlyHistory(history:History,dynastyId:Id){
  const rows=history.snapshots.map((w:WorldState)=>{
    const year=w.year
    const ev=history.eventLog.filter(e=>e.year===year)
    const ts=history.decisionTraces.filter(t=>t.year===year)
    const legalAlive=w.persons.filter(p=>p.alive&&
      p.legalDynasty.status==='DETERMINED'&&p.legalDynasty.dynastyId===dynastyId)
    const married=new Set(w.legal.marriages.filter(m=>m.status==='ACTIVE').flatMap(m=>m.personIds))
    const available=w.persons.filter(p=>p.alive&&year-p.birthYear>=18&&!married.has(p.personId))
    const landTitles=w.titles.filter(t=>t.kind==='TERRITORIAL')
    const held=landTitles.filter(t=>t.holder.status==='HELD')
    const pending=w.legal.cases.filter(c=>c.kind==='SUCCESSION'&&c.status==='PENDING')
    const approved=w.legal.cases.filter(c=>c.kind==='SUCCESSION'&&c.status==='APPROVED')
    // 時間窓の合致のみ。権限・受益者・Title・支配者の審査済み委任を意味しない。
    const mandateWindows=w.legal.controlMandates.filter(m=>m.effectiveFromYear<=year&&year<m.endExclusiveYear)
    return {
      year,eventCount:ev.length,traceCount:ts.length,
      livingPeople:w.persons.filter(p=>p.alive).length,
      legalNalvenAlive:legalAlive.length,
      legalNalvenAdults:legalAlive.filter(p=>year-p.birthYear>=18).length,
      adultUnmarriedMale:available.filter(p=>p.sex==='MALE').length,
      adultUnmarriedFemale:available.filter(p=>p.sex==='FEMALE').length,
      adultUnmarriedSupporting:available.filter(p=>p.interactionRole==='SUPPORTING').length,
      births:countType(ev,'PERSON_BIRTH'),deaths:countType(ev,'PERSON_DEATH'),
      marriages:countType(ev,'MARRIAGE_REGISTER'),dissolutions:countType(ev,'MARRIAGE_DISSOLVE'),
      promotions:countType(ev,'PERSON_PROMOTE')+countType(ev,'PERSON_SUPPORTING_RECORD'),
      dynastyDeterminations:countType(ev,'LEGAL_DYNASTY_SET'),
      titleTransferEvents:countType(ev,'LEGAL_TITLE_TRANSFER'),
      legalCaseSetEvents:countType(ev,'LEGAL_CASE_SET'),
      b004Accepted:countRule(ts,'B-004','ACCEPT'),
      b005Accepted:countRule(ts,'B-005','ACCEPT'),
      b005Deferred:countRule(ts,'B-005','DEFER'),
      b001Deferred:countRule(ts,'B-001','DEFER'),
      b005DeferReasons:reasons(ts,'B-005'),
      successionDeferReasons:reasons(ts,'A-SUC-04'),
      titleDeferReasons:reasons(ts,'A-TIT-07'),
      successionPending:pending.length,
      successionApproved:approved.length,
      pendingSuccessionTitleIds:[...new Set(pending.map(c=>c.titleId))].sort(),
      landTitleCount:landTitles.length,
      titlesHeld:held.length,
      titlesHeldByLivingNalven:held.filter(t=>{
        if(t.holder.status!=='HELD')return false
        return legalAlive.some(p=>p.personId===t.holder.personId)
      }).length,
      titleUndetermined:landTitles.filter(t=>t.holder.status==='UNDETERMINED').length,
      mandatesRecorded:w.legal.controlMandates.length,
      mandateWindowsActive:mandateWindows.length,
    }
  })
  const final=history.snapshots.at(-1)
  const goal=history.status==='COMPLETED'&&final?.year===1350
    ?evaluateGoal(final,{dynastyId}):null
  const summary={
    status:history.status,years:rows.length,firstYear:rows[0]?.year??null,
    finalYear:final?.year??null,
    births:rows.reduce((v,r)=>v+r.births,0),
    deaths:rows.reduce((v,r)=>v+r.deaths,0),
    marriages:rows.reduce((v,r)=>v+r.marriages,0),
    b005Accepted:rows.reduce((v,r)=>v+r.b005Accepted,0),
    b005Deferred:rows.reduce((v,r)=>v+r.b005Deferred,0),
    firstYearNoLivingLegalNalven:rows.find(r=>r.legalNalvenAlive===0)?.year??null,
    lastYearWithLivingLegalNalven:[...rows].reverse().find(r=>r.legalNalvenAlive>0)?.year??null,
    firstYearAnyTitleUndetermined:rows.find(r=>r.titleUndetermined>0)?.year??null,
    finalLivingLegalNalven:rows.at(-1)?.legalNalvenAlive??null,
    finalTitleUndetermined:rows.at(-1)?.titleUndetermined??null,
    finalPendingSuccessions:rows.at(-1)?.successionPending??null,
    finalMandateWindowsActive:rows.at(-1)?.mandateWindowsActive??null,
    technicalGoal:goal?.status??'NOT_EVALUATED',
  }
  return {provenance:'CALIBRATION_ONLY' as const,rows,summary,goal}
}
