import { describe, expect, it } from 'vitest'
import { describeSpecStatus } from '../../src/ui/status.ts'

describe('describeSpecStatus', () => {
  it('移行待ちでは未実装であることを示す', () => {
    expect(describeSpecStatus('pending-migration')).toContain('未実装')
  })
  it('承認済みでは配置済みを示す', () => {
    expect(describeSpecStatus('approved')).toContain('配置されています')
  })
})
