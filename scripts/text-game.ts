// Node 22+ のTypeScript実行で動く開発用テキストI/O。
// ゲーム規則や勝敗を再実装せず、GUIと同じ試験A0/A1実行入口を呼ぶ。
import { createInterface } from 'node:readline'
import { TextGameSession, textReport } from '../src/text/game.ts'
import { executeTextCommand, parseInteger } from '../src/text/command.ts'
import type { TextResult } from '../src/text/game.ts'
import type { PlayMode } from '../src/ui/branch-play-source.ts'

const HELP=`Project Chronofork — テキスト操作 (EXPERIMENTAL / CALIBRATION_ONLY)
起動: npm run play:text -- [--seed=0以上の整数] [--mode=FIXED_APPROVAL|ORDINARY_LAW|INTEGRATED_EXPERIMENTAL] [--json]
入力コマンド（1行ずつ）:
  observe [year=1250] [A0|A1]         指定年の世界とEventを観測
  inspect <person|region|group|title|event|trace> <id> [year=1250] [A0|A1]
  intervene <year> <personId1> <personId2> <signedDelta> <durationYears>
  compare [year=1350]                A0/A1差分を観測
  debug <year> [A0|A1] [RuleID]       内部Event/Traceと実行診断（明示操作のみ）
  help / exit
注: 現段階はGUIと同じ試験用の人物ペア信頼1操作→A1比較に限定。
    結果イベント・正式Goalを直接操作できません。`

const MODES=['FIXED_APPROVAL','ORDINARY_LAW','INTEGRATED_EXPERIMENTAL'] as const
function parseStartup(flags:readonly string[]):{seed:number;mode:PlayMode;json:boolean}|string{
  let seed=1,mode:PlayMode='FIXED_APPROVAL',json=false
  for(const f of flags){
    if(f==='--json'){json=true;continue}
    if(f.startsWith('--seed=')){
      const n=parseInteger(f.slice(7))
      if(n===null)return `--seedは0以上の10進整数で指定してください: ${f}`
      seed=n;continue
    }
    if(f.startsWith('--mode=')){
      const m=f.slice(7)
      if(!(MODES as readonly string[]).includes(m))return `--modeは${MODES.join('|')}のいずれかです: ${f}`
      mode=m as PlayMode;continue
    }
    return `不明な起動引数です: ${f}`
  }
  return {seed,mode,json}
}
const startup=parseStartup(process.argv.slice(2))
if(typeof startup==='string'){
  process.stderr.write(`ERROR INVALID_ARGUMENT: ${startup}\n`)
  process.exit(2)
}
const {seed,mode,json}=startup
const session=new TextGameSession(seed,mode)

const rl=createInterface({input:process.stdin,crlfDelay:Infinity,terminal:!!process.stdin.isTTY})
if(!json)process.stdout.write(HELP+'\n')
for await(const line of rl){
  const input=line.trim()
  if(!input)continue
  if(input==='exit'||input==='quit')break
  if(input==='help'){
    process.stdout.write(json?JSON.stringify({help:HELP})+'\n':HELP+'\n')
    continue
  }
  let output:TextResult
  try{output=executeTextCommand(session,input.split(/\s+/))}
  catch(e){output={ok:false,code:'UNEXPECTED_ERROR',message:e instanceof Error?e.message:String(e)}}
  process.stdout.write(json?JSON.stringify(output)+'\n':textReport(output)+'\n')
}
