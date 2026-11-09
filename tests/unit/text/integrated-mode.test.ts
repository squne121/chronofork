// 統合モード(INTEGRATED_EXPERIMENTAL)のうち、100年計算を伴わない受理・拒否の高速検証。
// 実計算を伴う検証は integrated-mode-long.test.ts（オプトイン）。
import {spawnSync} from 'node:child_process'
import {describe,expect,it} from 'vitest'
import {runPlayBaseline,runPlayComparison} from '../../../src/ui/branch-play-source.ts'
import {TextGameSession} from '../../../src/text/game.ts'
import {executeTextCommand} from '../../../src/text/command.ts'

const run=(args:string[],input:string)=>spawnSync(process.execPath,
  ['--experimental-strip-types','scripts/text-game.ts',...args],{input,encoding:'utf8',timeout:60000,cwd:process.cwd()})

describe('統合モードの入口（計算前に判定できる範囲）',()=>{
  it('起動引数 --mode=INTEGRATED_EXPERIMENTAL を受理し、計算前のhelp/exitで正常終了する',()=>{
    const p=run(['--json','--seed=20260101','--mode=INTEGRATED_EXPERIMENTAL'],'help\nexit\n')
    expect(p.status).toBe(0)
    expect(p.stdout).toContain('INTEGRATED_EXPERIMENTAL')
  })
  it('不正なモード・seedはA0計算前に拒否する',()=>{
    for(const mode of ['integrated_experimental','BAD',''] as const){
      const r=runPlayBaseline(1,mode as never)
      expect(r).toMatchObject({ok:false,code:'INVALID_MODE'})
    }
    expect(runPlayBaseline(-1,'INTEGRATED_EXPERIMENTAL')).toMatchObject({ok:false,code:'INVALID_SEED'})
    expect(runPlayBaseline(1.5,'INTEGRATED_EXPERIMENTAL')).toMatchObject({ok:false,code:'INVALID_SEED'})
  })
  it('統合モードでも不正な介入入力（年・補正・期間・人物）は計算前に拒否する',()=>{
    const base={mode:'INTEGRATED_EXPERIMENTAL' as const,seed:20260101,year:1250,
      firstPersonId:'person-exp-02',secondPersonId:'person-exp-05',signedDelta:-20,durationYears:5}
    expect(runPlayComparison({...base,year:1350})).toMatchObject({ok:false,code:'INVALID_YEAR'})
    expect(runPlayComparison({...base,signedDelta:0})).toMatchObject({ok:false,code:'INVALID_DELTA'})
    expect(runPlayComparison({...base,durationYears:101})).toMatchObject({ok:false,code:'INVALID_DURATION'})
    expect(runPlayComparison({...base,secondPersonId:'person-exp-02'})).toMatchObject({ok:false,code:'INVALID_PERSON_PAIR'})
  })
  it('不正branch・未作成A1・未計算年は統合モードでも成功扱いにしない（A0計算前に判定）',()=>{
    const s=new TextGameSession(20260101,'INTEGRATED_EXPERIMENTAL')
    expect(executeTextCommand(s,['observe','1250','A2'])).toMatchObject({ok:false})
    expect(executeTextCommand(s,['observe','1250','a1'])).toMatchObject({ok:false,code:'INVALID_BRANCH'})
    expect(executeTextCommand(s,['observe','1250','A1'])).toMatchObject({ok:false,code:'NO_BRANCH'})
    expect(executeTextCommand(s,['compare','1300'])).toMatchObject({ok:false,code:'NO_BRANCH'})
    expect(executeTextCommand(s,['debug','1250','A1'])).toMatchObject({ok:false,code:'NO_BRANCH'})
  })
})
