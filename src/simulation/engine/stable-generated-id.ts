// Issue #120: 世代を跨ぐ識別子のJSON再帰内包を避ける同期・決定的ID。
// 入力は名前や枝/時刻/RNGに依存せず、ドメインと値・型を区別するJSON配列で符号化。
// SHA-256実装は既存random.tsを共有（Web Worker / Nodeとも同期実行）。
import type { Id } from '../contracts/index.ts'
import { sha256 } from '../random.ts'

export const GENERATED_ID_VERSION='chronofork-generated-id-1'

export const GENERATED_ID_DOMAINS={
  B002_PERSON:'person:b002:auto',
  B002_UNRESOLVED:'person:b002:unresolved',
  B002_CANDIDATE:'b002:auto',
  B002_COMMAND:'cmd:b002:auto',
  B002_REQUEST:'req:b002:auto',
  ALEG01_MARRIAGE:'marriage:normal',
  ALEG01_CANDIDATE:'aleg01:normal',
  ALEG01_COMMAND:'cmd:aleg01:normal',
} as const
export type GeneratedIdDomain=typeof GENERATED_ID_DOMAINS[keyof typeof GENERATED_ID_DOMAINS]
type IdPart=string|number

const allowedDomains:ReadonlySet<string>=new Set(Object.values(GENERATED_ID_DOMAINS))
const invalidSurrogate=/[\uD800-\uDBFF](?![\uDC00-\uDFFF])|(?<![\uD800-\uDBFF])[\uDC00-\uDFFF]/
const encoder=new TextEncoder()

/** すべてのドメインで64桁hexのダイジェストを使う。衝突時は再採番せず停止する。 */
export function stableGeneratedId(domain:GeneratedIdDomain,tuple:readonly IdPart[]):Id{
  if(!allowedDomains.has(domain))throw new RangeError('UNKNOWN_GENERATED_ID_DOMAIN')
  if(!Array.isArray(tuple)||tuple.length===0)throw new RangeError('EMPTY_GENERATED_ID_TUPLE')
  for(const part of tuple){
    if(typeof part==='number'){
      if(!Number.isSafeInteger(part))throw new RangeError('INVALID_GENERATED_ID_INTEGER')
    }else if(typeof part!=='string'||part.length===0||invalidSurrogate.test(part)){
      throw new RangeError('INVALID_GENERATED_ID_STRING')
    }
  }
  const data=encoder.encode(JSON.stringify([GENERATED_ID_VERSION,domain,tuple]))
  const digest=sha256(data)
  return domain+':'+Array.from(digest,b=>b.toString(16).padStart(2,'0')).join('')
}

/** 同一年の異なる入力が同じIDに割り当てられた場合はfail-closed。異なる年の重複はWorldState検証が拒否する。 */
export function recordGeneratedIdSource(seen:Map<Id,string>,id:Id,tuple:readonly IdPart[]):void{
  const fingerprint=JSON.stringify(tuple)
  const existing=seen.get(id)
  if(existing!==undefined&&existing!==fingerprint)throw new RangeError('GENERATED_ID_COLLISION:'+id)
  seen.set(id,fingerprint)
}
