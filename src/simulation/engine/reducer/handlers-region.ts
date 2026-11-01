// D の実効支配事実。主権（sovereignCountryId）の変更は条約の適法性審査（A）を要するため適用しない。
import type { RegionControlSetCommand } from '../../contracts/index.ts'
import type { Handler } from './draft.ts'
import { fail } from './draft.ts'

export const regionControlSet: Handler<RegionControlSetCommand> = (d, c) => {
  const w = d.world
  const region = w.regions.find((r) => r.regionId === c.regionId)
  if (!region) return fail('NOT_FOUND', `地域 ${c.regionId} が存在しません`, [c.regionId])
  if (c.sovereignCountryId !== undefined && c.sovereignCountryId !== region.sovereignCountryId) {
    return fail('UNIMPLEMENTED_SOVEREIGNTY_CHANGE', '主権の変更は条約の A 適法性審査が必要で、本 reducer では未実装です')
  }
  d.world = { ...w, regions: w.regions.map((r) => (r.regionId === c.regionId ? { ...r, deFactoControllerRef: c.deFactoControllerRef } : r)) }
  return null
}
