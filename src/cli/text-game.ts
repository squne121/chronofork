// Node 22+ のTypeScript実行で動く開発用テキストI/O。
// ゲーム規則や勝敗を再実装せず、GUIと同じ試験A0/A1実行入口を呼ぶ。
import { createInterface } from 'node:readline'
import { TextGameSession, textReport } from '../text/game.ts'
import type { InspectKind, TextResult } from '../text/game.ts'
import type { BranchChoice, PlayMode } from '../ui/branch-play-source.ts'

const HELP=`Project Chronofork — テキスト操作 (EXPERIMENTAL / CALIBRATION_ONLY)
起動: npm run play:text -- [--seed=1] [--mode=FIXED_APPROVAL|ORDINARY_LAW] [--json]
入力コマンド（1行ずつ）:
  observe [year=1250] [A0|A1]         指定年の世界とEventを観測
  inspect <person|region|group|title|event|trace> <id> [year=1250] [A0|A1]
  intervene <year> <personId1> <personId2> <signedDelta> <durationYears>
  compare [year=1350]                A0/A1差分を観測
  debug <year> [A0|A1] [RuleID]       内部Event/Traceと実行診断（明示操作のみ）
  help / exit
注: 現段階はGUIと同じ試験用の人物ペア信頼1操作→A1比較に限定。
    結果イベント・正式Goalを直接操作できません。`

const flags=process.argv.slice(2)
const seedFlag=flags.find(x=>x.startsWith('--seed='))?.slice('--seed='.length)
const modeFlag=flags.find(x=>x.startsWith('--mode='))?.slice('--mode='.length)
const seed=seedFlag===undefined?1:Number(seedFlag)
const mode=(modeFlag??'FIXED_APPROVAL') as PlayMode
const json=flags.includes('--json')
const session=new TextGameSession(seed,mode)
const err=(code:string,message:string):TextResult=>({ok:false,code,message})
const branch=(s?:string):BranchChoice=>s==='A1'?'A1':'A0'
const year=(s:string|undefined,fallback:number)=>s===undefined?fallback:Number(s)

function invoke(parts:string[]):TextResult{
  const [verb,...args]=parts
  if(verb==='observe'){
    return session.observe(year(args[0],1250),branch(args[1]))
  }
  if(verb==='inspect'){
    const [kind,id,at,which]=args
    if(!kind||!id||!['person','region','group','title','event','trace'].includes(kind))
      return err('INVALID_COMMAND','inspectに対象種別とIDを指定してください')
    return session.inspect(kind as InspectKind,id,year(at,1250),branch(which))
  }
  if(verb==='intervene'){
    if(args.length!==5)return err('INVALID_COMMAND','interveneには年・人物ID×2・補正値・年数が必要です')
    return session.intervene({
      year:Number(args[0]),firstPersonId:args[1],secondPersonId:args[2],
      signedDelta:Number(args[3]),durationYears:Number(args[4]),
    })
  }
  if(verb==='compare')return session.compare(year(args[0],1350))
  if(verb==='debug'){
    if(args[0]===undefined)return err('INVALID_COMMAND','debugには年を指定してください')
    return session.debug(Number(args[0]),branch(args[1]),args[2])
  }
  return err('UNKNOWN_COMMAND','helpで利用可能な操作を確認してください')
}

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
  try{output=invoke(input.split(/\s+/))}
  catch(e){output=err('UNEXPECTED_ERROR',e instanceof Error?e.message:String(e))}
  process.stdout.write(json?JSON.stringify(output)+'\n':textReport(output)+'\n')
}
