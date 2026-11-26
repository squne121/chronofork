import {spawn,spawnSync} from 'node:child_process'
import {describe,expect,it} from 'vitest'

type Out={ok:boolean;code?:string;channel?:string;action?:string;data?:Record<string,unknown>;help?:string}
function cli(args:string[],input:string){
  const p=spawnSync(process.execPath,['--experimental-strip-types','scripts/text-game.ts',...args],
    {input,encoding:'utf8',timeout:60000,cwd:process.cwd()})
  const lines=p.stdout.trim()?p.stdout.trim().split(/\r?\n/):[]
  return {p,lines,out:lines.map(l=>JSON.parse(l) as Out)}
}

// 実stdoutのwriteを維持したまま、write false回数とwritableNeedDrain中の追加write回数をstderrへ報告する。
const STDOUT_PROBE='data:text/javascript,'+encodeURIComponent(`import {writeSync} from 'node:fs'
const o=process.stdout,w=o.write.bind(o);let calls=0,falses=0,needDrainWrites=0
o.write=(...a)=>{calls++;if(o.writableNeedDrain)needDrainWrites++
  const ok=w(...a);if(!ok&&falses++===0)writeSync(2,'CF_FIRST_FALSE\\n');return ok}
process.on('exit',()=>writeSync(2,'CF_STDOUT calls='+calls+' false='+falses+' needDrainWrites='+needDrainWrites+'\\n'))`)
// 実pipeで親の読取りを最初のwrite false後しばらく遅らせ、出力backpressureを発生させる。
// spawnSyncと同様に期限を設け、超過時は子をSIGKILLしてclose後に失敗させる（Vitestの180s制限より十分短い）。
function cliSlowReader(args:string[],input:string,delayMs:number,timeoutMs=60000){
  return new Promise<{code:number|null;stdout:string;stderr:string}>((resolve,reject)=>{
    const c=spawn(process.execPath,['--experimental-strip-types',`--import=${STDOUT_PROBE}`,'scripts/text-game.ts',...args],
      {cwd:process.cwd()})
    let stdout='',stderr='',reading=false,timedOut=false,delay:NodeJS.Timeout|undefined
    const read=()=>{if(reading)return;reading=true;c.stdout.setEncoding('utf8');c.stdout.on('data',d=>{stdout+=d})}
    const deadline=setTimeout(()=>{timedOut=true;c.kill('SIGKILL')},timeoutMs)
    const cleanup=()=>{clearTimeout(deadline);clearTimeout(delay)}
    c.stderr.setEncoding('utf8')
    c.stderr.on('data',d=>{stderr+=d;if(delay===undefined&&stderr.includes('CF_FIRST_FALSE'))delay=setTimeout(read,delayMs)})
    c.on('exit',read)
    c.on('error',e=>{cleanup();c.kill('SIGKILL');reject(e)})
    c.on('close',(code,signal)=>{cleanup()
      if(timedOut)reject(new Error(`cliSlowReader timed out after ${timeoutMs}ms (signal=${signal})`))
      else resolve({code,stdout,stderr})})
    c.stdin.end(input)
  })
}
const J=['--json','--seed=1','--mode=FIXED_APPROVAL']

describe('NodeテキストCLIの起動・実世界操作',()=>{
  it('observeでA0の計算済みWorldStateをJSONLで返す',()=>{
    const {p,out}=cli(J,'observe 1250 A0\nexit\n')
    expect(p.status).toBe(0)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({ok:true,channel:'PLAYER',action:'observe',
      data:{year:1250,branch:'A0',officialGoal:'NOT_ESTABLISHED'}})
    expect(String(out[0].data?.provenance)).toContain('CALIBRATION_ONLY')
  },90000)

  it('A0観測→介入→A1観測→比較→debugの一連操作が成功し、同一入力で出力が完全一致する',()=>{
    const script=['observe 1260 A0','intervene 1260 person-exp-04 person-exp-05 20 5',
      'observe 1262 A1','compare 1300','debug 1260 A1 B-004','debug 1260 A0','exit'].join('\n')+'\n'
    const a=cli(J,script); const b=cli(J,script)
    expect(a.p.status).toBe(0)
    expect(a.out.map(o=>o.ok)).toEqual([true,true,true,true,true,true])
    expect(a.out.map(o=>o.channel)).toEqual(['PLAYER','PLAYER','PLAYER','PLAYER','DEBUG','DEBUG'])
    expect(a.lines).toEqual(b.lines)
    for(const o of a.out.slice(0,4))expect(JSON.stringify(o)).not.toContain('technicalGoal')
    expect(a.out[4].data).toHaveProperty('technicalGoal')
    const traces=a.out[4].data?.traces as {ruleId:string;year:number}[]
    expect(traces.length).toBeGreaterThan(0)
    expect(traces.every(t=>t.ruleId==='B-004'&&t.year===1260)).toBe(true)
  },180000)

  it('stdoutの読取りが遅い実pipeでもwrite false後はdrainまで追加書込みせず、全応答を順序どおり出力する',async()=>{
    const debugs=Array.from({length:16},()=>'debug 1260 A0')
    const script=['observe 1250 A0',...debugs,'bogus','help','exit'].join('\n')+'\n'
    const {code,stdout,stderr}=await cliSlowReader(J,script,1500)
    expect(code).toBe(0)
    const probe=/CF_STDOUT calls=(\d+) false=(\d+) needDrainWrites=(\d+)/.exec(stderr)
    expect(probe).not.toBeNull()
    const [calls,falses,needDrainWrites]=probe!.slice(1).map(Number)
    expect(calls).toBe(19)
    expect(falses).toBeGreaterThan(0) // backpressureが実際に発生したことを確認（空振り防止）
    expect(needDrainWrites).toBe(0)
    const lines=stdout.trim().split('\n')
    expect(lines).toHaveLength(19)
    const out=lines.map(l=>JSON.parse(l) as Out)
    expect(out[0]).toMatchObject({ok:true,channel:'PLAYER',action:'observe',data:{year:1250,branch:'A0'}})
    for(const o of out.slice(1,17)){
      expect(o).toMatchObject({ok:true,channel:'DEBUG'})
      expect((o.data?.traces as unknown[]).length).toBeGreaterThan(0)
    }
    expect(new Set(lines.slice(1,17)).size).toBe(1)
    expect(out[17]).toMatchObject({ok:false,code:'UNKNOWN_COMMAND'})
    expect(out[18].help).toContain('Project Chronofork')
  },180000)

  it('cliSlowReaderは期限超過時に子プロセスを終了させて失敗し、ハングしない',async()=>{
    const script=['observe 1250 A0',...Array.from({length:16},()=>'debug 1260 A0'),'exit'].join('\n')+'\n'
    const t0=Date.now()
    // 読取りを期限より大きく遅らせ、子がdrain待ちで止まる状態を作る
    await expect(cliSlowReader(J,script,120000,3000)).rejects.toThrow(/timed out after 3000ms \(signal=SIGKILL\)/)
    expect(Date.now()-t0).toBeLessThan(30000)
  },60000)

  it('不正なbranchはobserve・inspect・debugのいずれもA0へ変換せずエラーにする',()=>{
    const {p,out}=cli(J,[
      'observe 1250 A2','observe 1250 a1','observe 1250 typo',
      'inspect person person-exp-04 1250 A2','inspect person person-exp-04 1250 a0',
      'debug 1250 A2','debug 1250 a1','debug 1250 A3 RULE-B-004','exit'].join('\n')+'\n')
    expect(p.status).toBe(0) // 対話中の無効入力でプロセスを落とさない
    expect(out.map(o=>o.code)).toEqual(['BRANCH_NOT_IMPLEMENTED','INVALID_BRANCH','INVALID_BRANCH',
      'BRANCH_NOT_IMPLEMENTED','INVALID_BRANCH','BRANCH_NOT_IMPLEMENTED','INVALID_BRANCH','BRANCH_NOT_IMPLEMENTED'])
    expect(out.every(o=>o.ok===false)).toBe(true)
  },90000)

  it('0x・指数・小数・不正文字列の数値を受理せず、後続コマンドは処理を続ける',()=>{
    const {p,out}=cli(J,[
      'observe 0x4E2','observe 1e3','observe 1250.5','observe 12a','observe -1',
      'intervene 1260 person-exp-04 person-exp-05 2e1 5','intervene 1260 person-exp-04 person-exp-05 20 5.0',
      'compare 1.35e3','debug 0x4E2','bogus','observe 1250','exit'].join('\n')+'\n')
    expect(p.status).toBe(0)
    expect(out.slice(0,9).map(o=>o.code)).toEqual(['INVALID_NUMBER','INVALID_NUMBER','INVALID_NUMBER',
      'INVALID_NUMBER','INVALID_NUMBER','INVALID_NUMBER','INVALID_NUMBER','INVALID_NUMBER','INVALID_NUMBER'])
    expect(out[9]).toMatchObject({ok:false,code:'UNKNOWN_COMMAND'})
    expect(out[10]).toMatchObject({ok:true,action:'observe'})
  },90000)

  it('余分な引数・不足引数は明確なエラー',()=>{
    const {p,out}=cli(J,['observe 1250 A0 extra','compare 1300 x','debug','inspect person','exit'].join('\n')+'\n')
    expect(p.status).toBe(0)
    expect(out.map(o=>o.code)).toEqual(['INVALID_COMMAND','INVALID_COMMAND','INVALID_COMMAND','INVALID_COMMAND'])
  },60000)

  it.each([
    ['--seed=abc'],['--seed=-1'],['--seed=1.5'],['--seed=0x10'],['--seed='],['--mode=BAD'],
    ['--mode=integrated_experimental'],['--mode='],['--unknown'],['--json','--seed=1e3'],
  ])('起動引数 %s は起動時に拒否して非ゼロ終了する',(...args)=>{
    const p=spawnSync(process.execPath,['--experimental-strip-types','scripts/text-game.ts',...args],
      {input:'observe 1250\nexit\n',encoding:'utf8',timeout:60000,cwd:process.cwd()})
    expect(p.status).toBe(2)
    expect(p.stdout).toBe('')
    expect(p.stderr).toContain('INVALID_ARGUMENT')
  })
})
