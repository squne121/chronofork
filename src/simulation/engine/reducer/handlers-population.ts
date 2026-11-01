// 共通人口 reducer。PopulationGroup.population の唯一の書込者（契約 §2.1/§4）。
import type {
  PopulationCasualtyCommand,
  PopulationCohortCommand,
  SupportSetCommand,
} from '../../contracts/index.ts'
import type { Handler } from './draft.ts'
import { fail, findPerson } from './draft.ts'

const isCount = (v: number) => Number.isSafeInteger(v) && v >= 0

/** C① の粗出生/自然死枠を一度だけ確定し、人口を delta = births − deaths で更新する。 */
export const populationCohort: Handler<PopulationCohortCommand> = (d, c) => {
  const w = d.world
  if (c.year !== w.year) return fail('YEAR_MISMATCH', `year ${c.year} が当年 ${w.year} ではありません`)
  if (!isCount(c.birthSlots) || !isCount(c.deathSlots)) return fail('INVALID_COMMAND', '出生枠・自然死枠は非負整数です')
  const group = w.groups.find((g) => g.groupId === c.groupId)
  if (!group) return fail('NOT_FOUND', `集団 ${c.groupId} が存在しません`, [c.groupId])
  if (w.demographics.cohortSlots.some((s) => s.groupId === c.groupId && s.year === c.year)) {
    return fail('COHORT_ALREADY_SET', `集団 ${c.groupId} の ${c.year} 年の枠は確定済みです`, [c.groupId])
  }
  const population = group.population + c.birthSlots - c.deathSlots
  if (!isCount(population)) return fail('COHORT_CAPACITY_CONFLICT', `人口が負になります: ${population}`, [c.groupId])
  d.world = {
    ...w,
    groups: w.groups.map((g) => (g.groupId === c.groupId ? { ...g, population } : g)),
    demographics: {
      ...w.demographics,
      cohortSlots: [
        ...w.demographics.cohortSlots,
        { groupId: c.groupId, year: c.year, birthSlots: c.birthSlots, deathSlots: c.deathSlots, claimedBirths: 0, claimedDeaths: 0 },
      ],
    },
  }
  return null
}

/** D の損耗通知。台帳 CASUALTY（同 casualtyId・同数）に裏付けられた場合のみ、人口を一度だけ減らす。 */
export const populationCasualty: Handler<PopulationCasualtyCommand> = (d, c) => {
  const w = d.world
  if (!Number.isSafeInteger(c.count) || c.count <= 0) return fail('INVALID_AMOUNT', `戦死者数は正の整数です: ${c.count}`)
  const rec = d.casualties.get(c.casualtyId)
  if (!rec) return fail('CASUALTY_NOT_BACKED', `casualty ${c.casualtyId} の台帳 CASUALTY が確認できません`, [c.casualtyId])
  if (rec.populationCount !== undefined) return fail('CASUALTY_ALREADY_APPLIED', `casualty ${c.casualtyId} の人口通知は適用済みです`, [c.casualtyId])
  if (rec.groupId !== c.groupId || rec.amount !== c.count) {
    return fail('CASUALTY_NOT_BACKED', `casualty ${c.casualtyId} は台帳上 集団 ${rec.groupId}・${rec.amount} 人です`, [c.casualtyId])
  }
  const group = w.groups.find((g) => g.groupId === c.groupId)
  if (!group) return fail('NOT_FOUND', `集団 ${c.groupId} が存在しません`, [c.groupId])
  if (c.count > group.population) return fail('COHORT_CAPACITY_CONFLICT', `戦死者数 ${c.count} が人口 ${group.population} を超えます`, [c.groupId])
  if (new Set(c.namedPersonIds).size !== c.namedPersonIds.length) return fail('INVALID_COMMAND', 'namedPersonIds が重複しています')
  if (c.namedPersonIds.length > c.count) return fail('CASUALTY_NAMED_EXCEEDS_COUNT', `記名戦死者 ${c.namedPersonIds.length} 人が集団戦死数 ${c.count} を超えます`)
  for (const id of c.namedPersonIds) {
    const p = findPerson(w, id)
    if (!p) return fail('NOT_FOUND', `人物 ${id} が存在しません`, [id])
    if (!p.alive) return fail('ALREADY_DEAD', `人物 ${id} は既に死亡しています（自然死済みへの戦死要求は拒否）`, [id])
    if (p.originGroupId !== c.groupId) return fail('INVALID_COMMAND', `人物 ${id} の出自集団が ${c.groupId} ではありません`, [id])
  }
  d.casualties.set(c.casualtyId, { ...rec, populationCount: c.count, namedPersonIds: [...c.namedPersonIds] })
  d.touchedCasualties.add(c.casualtyId)
  d.world = { ...w, groups: w.groups.map((g) => (g.groupId === c.groupId ? { ...g, population: g.population - c.count } : g)) }
  return null
}

/** C② が算出した支持分布の適用。原因（sourceEventId 相当）の無い更新は拒否する。 */
export const supportSet: Handler<SupportSetCommand> = (d, c) => {
  const w = d.world
  if (c.causeEventIds.length === 0 || c.causeEventIds.some((id) => typeof id !== 'string' || id.length === 0)) {
    return fail('SUPPORT_CAUSE_MISSING', '支持の更新には原因 ID（causeEventIds）が必要です')
  }
  if (!w.groups.some((g) => g.groupId === c.groupId)) return fail('NOT_FOUND', `集団 ${c.groupId} が存在しません`, [c.groupId])
  d.world = { ...w, groups: w.groups.map((g) => (g.groupId === c.groupId ? { ...g, support: c.support } : g)) }
  return null
}
