// 統合モード(INTEGRATED_EXPERIMENTAL)の100年実計算によるCLI検証。通常のquick-checkには含めないオプトイン:
//   CHRONOFORK_LONG_INTEGRATED_TEXT=1 NODE_OPTIONS=--max-old-space-size=6144 npx vitest run tests/unit/text/integrated-mode-long.test.ts
// 結果を固定せず、実エンジンの出力同士の一致・差異・参照整合だけを確認する（CALIBRATION_ONLY）。
import {spawnSync} from 'node:child_process'
import {describe,expect,it} from 'vitest'
import {
  createExperimentalIntegratedTimelineOptions,
} from '../../../src/scenario/experimental/index.ts'
import {runTimeline} from '../../../src/simulation/engine/index.ts'
import {compareYear,runPlayBaseline,runPlayComparison} from '../../../src/ui/branch-play-source.ts'
import type {PlayInput} from '../../../src/ui/branch-play-source.ts'
import {TextGameSession} from '../../../src/text/game.ts'
import {executeTextCommand} from '../../../src/text/command.ts'

const longTest=process.env.CHRONOFORK_LONG_INTEGRATED_TEXT==='1'?describe:describe.skip
const SEED=20260101
const INPUT:PlayInput={mode:'INTEGRATED_EXPERIMENTAL',seed:SEED,year:1250,
  firstPersonId:'person-exp-02',secondPersonId:'person-exp-05',signedDelta:-20,durationYears:5}
function firstDifference<T>(a:readonly T[],b:readonly T[]):number{
  if(a.length!==b.length)return Math.min(a.length,b.length)
  for(let i=0;i<a.length;i++)if(a[i]!==b[i]&&JSON.stringify(a[i])!==JSON.stringify(b[i]))return i
  return -1
}
const SCRIPT=['observe 1250 A0','observe 1350 A0','intervene 1250 person-exp-02 person-exp-05 -20 5',
  'compare 1255','observe 1255 A1','inspect person person-exp-02 1255 A1','debug 1255 A1','exit'].join('\n')+'\n'

longTest('統合モードのテキストCLI（100年・実計算）',()=>{
  const base=runPlayBaseline(SEED,'INTEGRATED_EXPERIMENTAL')
  const cmp=runPlayComparison(INPUT)
  it('A0単独実行・比較A0・共通ファクトリ直接実行が完全一致する',()=>{
    if(!base.ok||!cmp.ok)throw new Error('実計算に失敗')
    const a0Setup=createExperimentalIntegratedTimelineOptions('A0-play')
    const direct=runTimeline(a0Setup.world,{...a0Setup.options,seed:SEED})
    for(const [label,r] of [['比較A0',cmp.comparison.a0.result],['直接',direct]] as const){
      expect(firstDifference(base.a0.result.snapshots,r.snapshots),label+' snapshots').toBe(-1)
      expect(firstDifference(base.a0.result.eventLog,r.eventLog),label+' eventLog').toBe(-1)
      expect(firstDifference(base.a0.result.decisionTraces,r.decisionTraces),label+' traces').toBe(-1)
      expect(base.a0.result.technicalGoal).toEqual(r.technicalGoal)
    }
    expect(cmp.comparison.a0.inputs).toEqual(base.a0.inputs)
    expect(base.a0.result.goal).toBeNull()
  },900000)

  it('A1は許可された介入だけをエンジンへ渡して再計算され、介入年までは一致する',()=>{
    if(!cmp.ok)throw new Error('実計算に失敗')
    const c=cmp.comparison
    expect(c.branch.ledger).toEqual([c.modifier])
    expect(c.root.ledger).toEqual([])
    expect(c.a1.result.decisionTraces.some(t=>t.modifierIds.includes(c.modifier.modifierId))).toBe(true)
    expect(c.a0.result.decisionTraces.some(t=>t.modifierIds.includes(c.modifier.modifierId))).toBe(false)
    expect(JSON.stringify(c.a1.result.snapshots[0])).toBe(JSON.stringify(c.a0.result.snapshots[0]))
    for(const r of [c.a0,c.a1]){
      const eIds=new Set(r.result.eventLog.map(e=>e.eventId)),tIds=new Set(r.result.decisionTraces.map(t=>t.traceId))
      expect(r.result.eventLog.every(e=>e.sourceTraceIds.every(i=>tIds.has(i)))).toBe(true)
      expect(r.result.decisionTraces.every(t=>t.eventIds.every(i=>eIds.has(i)))).toBe(true)
    }
    const d=compareYear(c,1250)
    expect(d.traceSummary.matched).toBeGreaterThan(0)
  },900000)

  it('実CLIの統合モード操作が成功し、同一seed・同一操作列で出力が完全一致、PLAYER/DEBUGが分離される',()=>{
    const args=['--experimental-strip-types','scripts/text-game.ts','--json','--mode=INTEGRATED_EXPERIMENTAL','--seed='+SEED]
    const go=()=>spawnSync(process.execPath,['--max-old-space-size=6144',...args],
      {input:SCRIPT,encoding:'utf8',timeout:900000,cwd:process.cwd(),maxBuffer:1<<30})
    const a=go(),b=go()
    expect(a.status).toBe(0)
    const lines=a.stdout.trim().split(/\r?\n/)
    expect(lines).toEqual(b.stdout.trim().split(/\r?\n/))
    const out=lines.map(l=>JSON.parse(l) as {ok:boolean;channel:string;data:Record<string,unknown>})
    expect(out.map(o=>o.ok)).toEqual(Array(7).fill(true))
    expect(out.map(o=>o.channel)).toEqual(['PLAYER','PLAYER','PLAYER','PLAYER','PLAYER','PLAYER','DEBUG'])
    for(const o of out.slice(0,6))expect(JSON.stringify(o)).not.toContain('technicalGoal')
    expect(out[6].data).toHaveProperty('technicalGoal')
  },1800000)

  it('セッションAPIでも未計算年・不正branchは成功扱いにならない',()=>{
    const s=new TextGameSession(SEED,'INTEGRATED_EXPERIMENTAL')
    expect(executeTextCommand(s,['observe','1400'])).toMatchObject({ok:false,code:'YEAR_UNAVAILABLE'})
    expect(executeTextCommand(s,['observe','1250','A2'])).toMatchObject({ok:false})
  },900000)
})
