// テキスト入力境界。branch・整数・コマンド構文を厳密に検証し、不正値を勝手に補正しない。
import { TextGameSession } from './game.ts'
import type { InspectKind, TextResult } from './game.ts'
import type { BranchChoice } from '../ui/branch-play-source.ts'

const err=(code:string,message:string):TextResult=>({ok:false,code,message})
export const INSPECT_KINDS:readonly InspectKind[]=['person','region','group','title','event','trace']

/** `A0`/`A1`のみ受理。A2以降は未実装として明示拒否し、A0へ変換しない。 */
export function parseBranch(s:string|undefined):{ok:true;branch:BranchChoice}|Extract<TextResult,{ok:false}>{
  if(s===undefined||s==='A0')return {ok:true,branch:'A0'}
  if(s==='A1')return {ok:true,branch:'A1'}
  if(/^A[0-9]+$/.test(s))return err('BRANCH_NOT_IMPLEMENTED',`${s}は未実装です。現在はA0とA1のみ利用できます`) as Extract<TextResult,{ok:false}>
  return err('INVALID_BRANCH','branchはA0またはA1（大文字）で指定してください') as Extract<TextResult,{ok:false}>
}
/** 10進の整数のみ。0x・指数・小数・空白・符号付き以外の文字を受理しない。 */
export function parseInteger(s:string,opts:{signed?:boolean}={}):number|null{
  if(!(opts.signed?/^[+-]?[0-9]+$/:/^[0-9]+$/).test(s))return null
  const n=Number(s)
  return Number.isSafeInteger(n)?n:null
}
const intArg=(name:string,s:string|undefined,fallback?:number,signed=false):
  {ok:true;value:number}|Extract<TextResult,{ok:false}>=>{
  if(s===undefined){
    return fallback===undefined?err('INVALID_COMMAND',`${name}を指定してください`) as Extract<TextResult,{ok:false}>
      :{ok:true,value:fallback}
  }
  const n=parseInteger(s,{signed})
  return n===null?err('INVALID_NUMBER',`${name}は10進の整数で指定してください`) as Extract<TextResult,{ok:false}>
    :{ok:true,value:n}
}

/** 1行分のコマンドを実行する。無効入力は例外ではなくエラー結果として返す。 */
export function executeTextCommand(session:TextGameSession,parts:readonly string[]):TextResult{
  const [verb,...args]=parts
  if(verb==='observe'){
    if(args.length>2)return err('INVALID_COMMAND','observe [年] [A0|A1]')
    const y=intArg('年',args[0],1250); if(!y.ok)return y
    const b=parseBranch(args[1]); if(!b.ok)return b
    return session.observe(y.value,b.branch)
  }
  if(verb==='inspect'){
    const [kind,id,at,which,...rest]=args
    if(!kind||!id||rest.length>0||!INSPECT_KINDS.includes(kind as InspectKind))
      return err('INVALID_COMMAND','inspect <person|region|group|title|event|trace> <id> [年] [A0|A1]')
    const y=intArg('年',at,1250); if(!y.ok)return y
    const b=parseBranch(which); if(!b.ok)return b
    return session.inspect(kind as InspectKind,id,y.value,b.branch)
  }
  if(verb==='intervene'){
    if(args.length!==5)return err('INVALID_COMMAND','interveneには年・人物ID×2・補正値・年数が必要です')
    const y=intArg('年',args[0]); if(!y.ok)return y
    const d=intArg('補正値',args[3],undefined,true); if(!d.ok)return d
    const n=intArg('年数',args[4]); if(!n.ok)return n
    return session.intervene({year:y.value,firstPersonId:args[1],secondPersonId:args[2],
      signedDelta:d.value,durationYears:n.value})
  }
  if(verb==='compare'){
    if(args.length>1)return err('INVALID_COMMAND','compare [年]')
    const y=intArg('年',args[0],1350); if(!y.ok)return y
    return session.compare(y.value)
  }
  if(verb==='debug'){
    if(args.length<1||args.length>3)return err('INVALID_COMMAND','debug <年> [A0|A1] [RuleID]')
    const y=intArg('年',args[0]); if(!y.ok)return y
    const b=parseBranch(args[1]); if(!b.ok)return b
    return session.debug(y.value,b.branch,args[2])
  }
  return err('UNKNOWN_COMMAND','helpで利用可能な操作を確認してください')
}
