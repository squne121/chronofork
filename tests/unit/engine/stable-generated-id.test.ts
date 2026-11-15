// Issue #120: 同期・決定的なドメイン分離IDと衝突時のfail-closed。
import { describe, expect, it } from 'vitest'
import {
  GENERATED_ID_DOMAINS, GENERATED_ID_VERSION, recordGeneratedIdSource, stableGeneratedId,
} from '../../../src/simulation/engine/stable-generated-id.ts'

describe('生成IDの長さ・入力正規化・衝突検出 (#120)',()=>{
  const person=GENERATED_ID_DOMAINS.B002_PERSON

  it('同じタプルなら不変、入力・順番・ドメインが違えば区別する',()=>{
    const tuple=[1250,'marriage:x','father:x','mother:x'] as const
    const id=stableGeneratedId(person,tuple)
    expect(GENERATED_ID_VERSION).toBe('chronofork-generated-id-1')
    expect(id).toBe(stableGeneratedId(person,tuple))
    expect(id).toMatch(/^person:b002:auto:[0-9a-f]{64}$/)
    expect(id.length).toBe(person.length+1+64)
    expect(id).not.toBe(stableGeneratedId(person,[1251,...tuple.slice(1)]))
    expect(id).not.toBe(stableGeneratedId(person,[1250,'marriage:x','mother:x','father:x']))
    expect(id).not.toBe(stableGeneratedId(GENERATED_ID_DOMAINS.B002_UNRESOLVED,tuple))
    expect(stableGeneratedId(person,['ab','c']))
      .not.toBe(stableGeneratedId(person,['a','bc']))
    expect(stableGeneratedId(person,['1']))
      .not.toBe(stableGeneratedId(person,[1]))
  })

  it('同じ入力の再観測は許し、異なる入力が同じIDへ衝突すれば停止する',()=>{
    const registry=new Map<string,string>()
    const id=stableGeneratedId(person,[1250,'m','f','mother'])
    recordGeneratedIdSource(registry,id,[1250,'m','f','mother'])
    recordGeneratedIdSource(registry,id,[1250,'m','f','mother'])
    expect(registry.size).toBe(1)
    expect(()=>recordGeneratedIdSource(registry,id,[1251,'m','f','mother']))
      .toThrow('GENERATED_ID_COLLISION')
    expect(registry.size).toBe(1)
  })

  it('曖昧な非整数・壊れたUTF-16・空入力を拒否する',()=>{
    expect(()=>stableGeneratedId(person,[NaN])).toThrow('INVALID_GENERATED_ID_INTEGER')
    expect(()=>stableGeneratedId(person,[1.5])).toThrow('INVALID_GENERATED_ID_INTEGER')
    expect(()=>stableGeneratedId(person,[''])).toThrow('INVALID_GENERATED_ID_STRING')
    expect(()=>stableGeneratedId(person,['\uD800'])).toThrow('INVALID_GENERATED_ID_STRING')
    expect(()=>stableGeneratedId(person,[])).toThrow('EMPTY_GENERATED_ID_TUPLE')
  })
})
