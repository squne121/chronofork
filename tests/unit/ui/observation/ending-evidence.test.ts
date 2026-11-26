import { expect, it } from 'vitest'
import { endingHolderEvidence } from '../../../../src/ui/observation/ending-evidence.ts'
import type { TitleHoldingHistory, TitleHoldingInterval } from '../../../../src/ui/observation/title-history.ts'
import type { TitleLossRecord } from '../../../../src/ui/observation/person-record.ts'

const held = { status: 'HELD', personId: 'holder', personName: '保持者', life: 'ALIVE' } as const
const unknown = { status: 'NOT_RECORDED' } as const
const empty = { status: 'UNDETERMINED' } as const
const range = (fromYear: number, throughYear: number, holder: TitleHoldingInterval['holder']) => ({ fromYear, throughYear, holder })
const history = (...intervals: TitleHoldingInterval[]): TitleHoldingHistory => ({ titleId: 'land', label: '領地', kind: 'TERRITORIAL', intervals, transfers: [] })
const loss: TitleLossRecord = { titleId: 'land', label: '領地', lostFromYear: 1325, heldFromYear: 1300, lastHolderId: 'holder', lastHolderLife: 'ALIVE' }
const evidence = (h?: TitleHoldingHistory, l = loss) => endingHolderEvidence(h, l, 1250, 1350)

it('年内の移転記録がなくても連続する実年初の保持喪失を示す', () => {
  expect(evidence(history(range(1250, 1324, held), range(1325, 1350, empty)))).toEqual({ kind: 'LOST', loss })
})

it('最初から未確定・未取得・評価年未計算・間の不明年を区別する', () => {
  expect(evidence(history(range(1250, 1350, empty)))).toEqual({ kind: 'NEVER_HELD' })
  expect(evidence(history(range(1251, 1350, empty)))).toEqual({ kind: 'UNKNOWN' })
  expect(evidence(history(range(1250, 1324, held), range(1325, 1350, unknown)))).toEqual({ kind: 'UNKNOWN' })
  expect(evidence(history(range(1250, 1324, held), range(1325, 1349, empty)))).toEqual({ kind: 'UNKNOWN' })
  expect(evidence(history(range(1250, 1323, held), range(1324, 1324, unknown), range(1325, 1350, empty)))).toEqual({ kind: 'UNKNOWN' })
  expect(evidence()).toEqual({ kind: 'UNKNOWN' })
})

it('再取得された称号や別の称号の喪失を結末の喪失とはしない', () => {
  expect(evidence(history(range(1250, 1324, held), range(1325, 1325, empty), range(1326, 1350, held)))).toEqual({ kind: 'HELD' })
  expect(evidence(history(range(1250, 1324, held), range(1325, 1350, empty)), { ...loss, titleId: 'other' })).toEqual({ kind: 'UNKNOWN' })
})
