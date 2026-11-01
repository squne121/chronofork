// ResourceLedger reducer。現金・兵員の唯一の書込者（契約 §3.1）。
// 負残高・過剰予約・二重消費を拒否する。FORCE_HEADCOUNT は人口由来の Pool であり、直接の増減は禁止
// （翌年の Pool は最新人口から導出し直す）。損耗は予約兵から casualtyId ごとに一度だけ確定する。
import type { ResourceTransactionCommand } from '../../contracts/index.ts'
import type { Handler } from './draft.ts'
import { fail } from './draft.ts'

export const resourceTransaction: Handler<ResourceTransactionCommand> = (d, c) => {
  const { accountId, operation, amount } = c
  if (!Number.isSafeInteger(amount) || amount <= 0) return fail('INVALID_AMOUNT', `amount は正の整数です: ${amount}`)
  const w = d.world
  const acct = w.resources.find((a) => a.accountId === accountId)
  if (!acct) return fail('NOT_FOUND', `口座 ${accountId} が存在しません`, [accountId])
  if (operation !== 'CASUALTY' && c.casualtyId !== undefined) return fail('INVALID_COMMAND', 'casualtyId は CASUALTY のみに使えます')

  const available = acct.quantity - acct.committed
  let quantity = acct.quantity
  let committed = acct.committed
  switch (operation) {
    case 'CREDIT':
    case 'DEBIT': {
      if (acct.kind === 'FORCE_HEADCOUNT') return fail('FORCE_POOL_DIRECT_EDIT', `兵員 Pool ${accountId} は直接増減できません（人口から導出。損耗は CASUALTY）`, [accountId])
      if (operation === 'CREDIT') {
        quantity += amount
        if (!Number.isSafeInteger(quantity)) return fail('RESOURCE_OVERFLOW', '残高が安全な整数範囲を超えます')
      } else if (amount > acct.quantity) {
        return fail('NEGATIVE_BALANCE', `支出 ${amount} が残高 ${acct.quantity} を超えます`, [accountId])
      } else if (amount > available) {
        return fail('COMMITTED_FUNDS_DEBIT', `支出 ${amount} が予約済みを除く利用可能額 ${available} を超えます（予約分は先に RELEASE）`, [accountId])
      } else {
        quantity -= amount
      }
      break
    }
    case 'COMMIT':
      if (amount > available) return fail('OVER_COMMIT', `予約 ${amount} が利用可能 ${available} を超えます`, [accountId])
      committed += amount
      break
    case 'RELEASE':
      if (amount > acct.committed) return fail('OVER_RELEASE', `解放 ${amount} が予約済み ${acct.committed} を超えます`, [accountId])
      committed -= amount
      break
    case 'CASUALTY': {
      if (acct.kind !== 'FORCE_HEADCOUNT') return fail('CASUALTY_ON_CASH', `CASUALTY は兵員口座のみです: ${accountId}`, [accountId])
      if (c.casualtyId === undefined || c.casualtyId.length === 0) return fail('CASUALTY_ID_MISSING', 'CASUALTY には casualtyId が必要です')
      if (d.casualties.has(c.casualtyId)) return fail('CASUALTY_ALREADY_APPLIED', `casualty ${c.casualtyId} は確定済みです（二重消費）`, [c.casualtyId])
      if (acct.sourceGroupId === undefined) return fail('INVALID_COMMAND', `兵員口座 ${accountId} に sourceGroupId がありません`)
      if (amount > acct.committed) return fail('CASUALTY_EXCEEDS_COMMITTED', `損耗 ${amount} が予約兵 ${acct.committed} を超えます`, [accountId])
      quantity -= amount
      committed -= amount
      d.casualties.set(c.casualtyId, {
        casualtyId: c.casualtyId,
        groupId: acct.sourceGroupId,
        ledgerAccountId: accountId,
        amount,
        namedPersonIds: [],
        deadNamedPersonIds: [],
      })
      d.touchedCasualties.add(c.casualtyId)
      break
    }
  }
  d.world = { ...w, resources: w.resources.map((a) => (a.accountId === accountId ? { ...a, quantity, committed } : a)) }
  return null
}
