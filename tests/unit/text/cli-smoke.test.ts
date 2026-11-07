import {spawnSync} from 'node:child_process'
import {describe,expect,it} from 'vitest'

describe('NodeテキストCLIの本当の起動・実世界観測',()=>{
  it('標準入力のobserveを受けてA0の計算済みWorldStateをJSONLで返す',()=>{
    const p=spawnSync(process.execPath,
      ['--experimental-strip-types','scripts/text-game.ts','--json','--seed=1','--mode=FIXED_APPROVAL'],
      {input:'observe 1250 A0\nexit\n',encoding:'utf8',timeout:20000,cwd:process.cwd()})
    expect(p.error).toBeUndefined()
    expect(p.status).toBe(0)
    const lines=p.stdout.trim().split(/\r?\n/)
    expect(lines).toHaveLength(1)
    const out=JSON.parse(lines[0]) as {
      ok:boolean;channel:string;action:string;
      data:{year:number;branch:string;provenance:string;officialGoal:string}
    }
    expect(out.ok).toBe(true)
    expect(out.channel).toBe('PLAYER')
    expect(out.action).toBe('observe')
    expect(out.data.year).toBe(1250)
    expect(out.data.branch).toBe('A0')
    expect(out.data.provenance).toContain('CALIBRATION_ONLY')
    expect(out.data.officialGoal).toBe('NOT_ESTABLISHED')
  },30000)
})
