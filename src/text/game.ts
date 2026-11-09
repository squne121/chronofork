// 人間のGUIとAI向けCLIが、同じ実シミュレーションを閲覧・操作するためのテキスト境界。
// 試験専用の勝敗や歴史を作らず、現行GUIのA0/A1試験実行入口を共有する。
import type { WorldState } from '../simulation/contracts/index.ts'
import type { TimelineRun } from '../ui/timeline-source.ts'
import {
  compareYear, runPlayBaseline, runPlayComparison, PLAY_DEFAULT_MODE,
} from '../ui/branch-play-source.ts'
import type { BranchChoice, PlayComparison, PlayInput, PlayMode } from '../ui/branch-play-source.ts'

export type TextResult =
  | Readonly<{ok:true;channel:'PLAYER'|'DEBUG';action:string;data:unknown}>
  | Readonly<{ok:false;code:string;message:string}>
export type InspectKind = 'person' | 'region' | 'group' | 'title' | 'event' | 'trace'

const success=(channel:'PLAYER'|'DEBUG',action:string,data:unknown):TextResult=>({ok:true,channel,action,data})
const fail=(code:string,message:string):TextResult=>({ok:false,code,message})

/** UI閲覧と同じWorldStateを読み取る。帳簿・試験係数・乱数値はPLAYER出力に含めない。 */
export function summarizeWorld(w:WorldState){
  return {
    year:w.year,
    countries:w.countries.map(c=>({
      id:c.countryId,name:c.name,rulerPersonId:c.rulerPersonId??null,
      suzerainCountryId:c.suzerainCountryId??null,
    })),
    regions:w.regions.map(r=>({
      id:r.regionId,name:r.name,sovereignCountryId:r.sovereignCountryId,
      deFactoController:r.deFactoControllerRef,
    })),
    groups:w.groups.map(g=>({
      id:g.groupId,name:g.name,regionId:g.regionId,
      population:g.population,prosperity:g.prosperity,unrest:g.unrest,
    })),
    persons:w.persons.map(p=>({
      id:p.personId,name:p.name,alive:p.alive,houseId:p.houseId,
      legalDynasty:p.legalDynasty,
    })),
    titles:w.titles.map(t=>({
      id:t.titleId,kind:t.kind,regionId:t.regionId,
      holder:t.holder,hereditary:t.hereditary,valid:t.valid,
      recognition:t.recognition.status,
    })),
  }
}

export function playerObservation(run:TimelineRun,year:number,branch:BranchChoice):TextResult{
  const world=run.result.snapshots.find(w=>w.year===year)
  if(!world)return fail('YEAR_UNAVAILABLE','この歴史に指定年の計算済み状態はありません')
  const events=run.result.eventLog.filter(e=>e.year===year).map(e=>({
    eventId:e.eventId,eventType:e.eventType,year:e.year,
    involvedRefs:e.involvedRefs,sourceTraceIds:e.sourceTraceIds,
  }))
  return success('PLAYER','observe',{
    provenance:'EXPERIMENTAL / CALIBRATION_ONLY',
    branch,year,status:run.result.status,
    officialGoal:run.result.goal?.status??'NOT_ESTABLISHED',
    world:summarizeWorld(world),events,
    note:'年初の世界状態です。Eventはその年の計算で確定した出来事です。正式な勝敗を保証しません。',
  })
}

/** デバッグ情報をプレイヤー出力から分離する。必ず明示的なdebug操作を要求。 */
export function debugObservation(run:TimelineRun,year:number,ruleId?:string):TextResult{
  const world=run.result.snapshots.find(w=>w.year===year)
  if(!world)return fail('YEAR_UNAVAILABLE','指定年の状態を参照できません')
  const traces=run.result.decisionTraces.filter(t=>t.year===year&&(!ruleId||t.ruleId===ruleId))
  const traceIds=new Set(traces.map(t=>t.traceId))
  const events=run.result.eventLog.filter(e=>e.year===year&&
    (!ruleId||e.sourceTraceIds.some(id=>traceIds.has(id))))
  return success('DEBUG','debug',{
    provenance:'EXPERIMENTAL / CALIBRATION_ONLY',year,ruleId:ruleId??null,
    inputs:run.inputs,coverage:run.result.coverage,halt:run.result.halt,
    technicalGoal:run.result.technicalGoal,
    events,traces,
  })
}

export class TextGameSession {
  private baseline?:TimelineRun
  private comparison?:PlayComparison
  readonly seed:number
  readonly mode:PlayMode

  constructor(seed:number,mode:PlayMode=PLAY_DEFAULT_MODE){
    this.seed=seed
    this.mode=mode
  }

  private select(branch:BranchChoice):{ok:true;run:TimelineRun}|{ok:false;code:string;message:string}{
    // 型を迂回した呼び出しでもA0へ黙って落とさない。
    if(branch!=='A0'&&branch!=='A1')return {ok:false,code:'INVALID_BRANCH',message:'branchはA0またはA1のみです'}
    if(branch==='A1'){
      return this.comparison?{ok:true,run:this.comparison.a1}:
        {ok:false,code:'NO_BRANCH',message:'先にinterveneでA1を作成してください'}
    }
    if(this.comparison)return {ok:true,run:this.comparison.a0}
    if(this.baseline)return {ok:true,run:this.baseline}
    const base=runPlayBaseline(this.seed,this.mode)
    if(!base.ok)return base
    this.baseline=base.a0
    return {ok:true,run:base.a0}
  }

  observe(year:number,branch:BranchChoice='A0'):TextResult{
    const selected=this.select(branch)
    return selected.ok?playerObservation(selected.run,year,branch):selected
  }

  inspect(kind:InspectKind,id:string,year:number,branch:BranchChoice='A0'):TextResult{
    const selected=this.select(branch)
    if(!selected.ok)return selected
    const run=selected.run
    const w=run.result.snapshots.find(s=>s.year===year)
    if(!w)return fail('YEAR_UNAVAILABLE','この歴史に指定年の計算済み状態はありません')
    const item=kind==='person'?w.persons.find(p=>p.personId===id)
      :kind==='region'?w.regions.find(r=>r.regionId===id)
      :kind==='group'?w.groups.find(g=>g.groupId===id)
      :kind==='title'?w.titles.find(t=>t.titleId===id)
      :kind==='event'?run.result.eventLog.find(e=>e.eventId===id&&e.year===year)
      :run.result.decisionTraces.find(t=>t.traceId===id&&t.year===year)
    if(!item)return fail('ENTITY_NOT_FOUND','指定された対象は選択年の情報に存在しません')
    if(kind==='event'){
      const e=item as (typeof run.result.eventLog)[number]
      return success('PLAYER','inspect',{branch,year,kind,id,eventType:e.eventType,
        involvedRefs:e.involvedRefs,sourceTraceIds:e.sourceTraceIds})
    }
    if(kind==='trace'){
      const t=item as (typeof run.result.decisionTraces)[number]
      return success('PLAYER','inspect',{branch,year,kind,id,ruleId:t.ruleId,
        actorRef:t.actorRef,status:t.status,reasonCodes:t.reasonCodes,
        selectedCandidateId:t.selectedCandidateId??null,eventIds:t.eventIds})
    }
    // GUI上の閲覧項目だけを明示投影。WorldStateの生オブジェクトはPLAYERへ返さない。
    if(kind==='person'){
      const p=item as WorldState['persons'][number]
      return success('PLAYER','inspect',{branch,year,kind,id,entity:{
        name:p.name,sex:p.sex,birthYear:p.birthYear,alive:p.alive,
        deathYear:p.deathYear??null,houseId:p.houseId,
        legalDynasty:p.legalDynasty,bloodlineDynastyId:p.bloodlineDynastyId??null,
        fatherId:p.fatherId??null,motherId:p.motherId??null,originGroupId:p.originGroupId,
      }})
    }
    if(kind==='region'){
      const r=item as WorldState['regions'][number]
      return success('PLAYER','inspect',{branch,year,kind,id,entity:{
        name:r.name,sovereignCountryId:r.sovereignCountryId,
        deFactoController:r.deFactoControllerRef,adjacentRegionIds:r.adjacentRegionIds,
        groupIds:w.groups.filter(g=>g.regionId===id).map(g=>g.groupId),
        titleIds:w.titles.filter(t=>t.regionId===id).map(t=>t.titleId),
      }})
    }
    if(kind==='group'){
      const g=item as WorldState['groups'][number]
      return success('PLAYER','inspect',{branch,year,kind,id,entity:{
        name:g.name,regionId:g.regionId,population:g.population,
        prosperity:g.prosperity,unrest:g.unrest,support:g.support,
      }})
    }
    const t=item as WorldState['titles'][number]
    return success('PLAYER','inspect',{branch,year,kind,id,entity:{
      kind:t.kind,regionId:t.regionId,holder:t.holder,
      hereditary:t.hereditary,valid:t.valid,recognition:t.recognition.status,
    }})
  }

  intervene(input:Omit<PlayInput,'mode'|'seed'>):TextResult{
    // 統合100年実行はメモリが大きいため、比較結果で置き換わる単独A0を先に解放する（必要なら決定的に再計算される）。
    this.baseline=undefined
    const result=runPlayComparison({...input,mode:this.mode,seed:this.seed})
    if(!result.ok)return fail(result.code,result.message)
    this.comparison=result.comparison
    this.baseline=result.comparison.a0
    const {a0,a1}=result.comparison
    return success('PLAYER','intervene',{
      provenance:'EXPERIMENTAL / CALIBRATION_ONLY',
      input:result.comparison.input,branch:'A1',
      a0:{status:a0.result.status,officialGoal:a0.result.goal?.status??'NOT_ESTABLISHED'},
      a1:{status:a1.result.status,officialGoal:a1.result.goal?.status??'NOT_ESTABLISHED'},
      note:'A1は実WorldStateから再計算。正式Goalは未成立です。compareで差分を調査できます。',
    })
  }

  compare(year:number):TextResult{
    if(!this.comparison)return fail('NO_BRANCH','先にinterveneでA1を作成してください')
    const diff=compareYear(this.comparison,year)
    if(!diff.a0World||!diff.a1World)return fail('YEAR_UNAVAILABLE','比較対象年が計算済みではありません')
    return success('PLAYER','compare',{
      provenance:'EXPERIMENTAL / CALIBRATION_ONLY',year,
      events:diff.events.map(x=>({kind:x.kind,eventId:x.event.eventId,eventType:x.event.eventType,
        involvedRefs:x.event.involvedRefs})),
      traceSummary:diff.traceSummary,
      a0:summarizeWorld(diff.a0World),a1:summarizeWorld(diff.a1World),
      note:'差分は因果関係の証明ではありません。必要ならinspectでEvent/Traceを調べてください。',
    })
  }

  debug(year:number,branch:BranchChoice='A0',ruleId?:string):TextResult{
    const selected=this.select(branch)
    return selected.ok?debugObservation(selected.run,year,ruleId):selected
  }
}

export function textReport(result:TextResult):string{
  if(!result.ok)return `ERROR ${result.code}: ${result.message}`
  return `[${result.channel}] ${result.action}\n${JSON.stringify(result.data,null,2)}`
}
