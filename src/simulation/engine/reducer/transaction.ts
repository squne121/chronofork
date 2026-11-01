import type { Id, Year } from '../../contracts/index.ts'
import type { CommandTransaction } from './types.ts'

/** 枝・年度ごとの冪等性トランザクションを新規作成する。別枝・別年度は独立。 */
export function createTransaction(scope: Readonly<{ branchId: Id; year: Year }>): CommandTransaction {
  return {
    branchId: scope.branchId,
    year: scope.year,
    commands: new Map(),
    requests: new Map(),
    batches: new Map(),
    casualties: new Map(),
  }
}
