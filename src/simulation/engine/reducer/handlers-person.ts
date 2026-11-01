// B の出生（Person 登録）と共通死亡 reducer。人口の増減は C① の枠確定と POPULATION_* のみが行い、
// ここでは個別 Person の登録・死亡確定と枠の請求済み数の更新だけを行う（人口へ再加算しない: 契約 §4）。
import type { PersonBirthCommand, PersonDeathCommand, WorldState } from '../../contracts/index.ts'
import type { Draft, Handler } from './draft.ts'
import { fail, findPerson } from './draft.ts'
import type { Rejection } from './types.ts'

const slotIndex = (w: WorldState, groupId: string, year: number) =>
  w.demographics.cohortSlots.findIndex((s) => s.groupId === groupId && s.year === year)

/** 枠の請求済み数を 1 増やす。枠が無い・不足なら NO_COHORT_SLOT。 */
function claimSlot(d: Draft, groupId: string, kind: 'birth' | 'death'): Rejection | null {
  const w = d.world
  const i = slotIndex(w, groupId, w.year)
  const slot = w.demographics.cohortSlots[i]
  if (!slot) return fail('NO_COHORT_SLOT', `集団 ${groupId} の ${w.year} 年の出生/自然死枠が確定していません`, [groupId])
  const claimed = kind === 'birth' ? slot.claimedBirths : slot.claimedDeaths
  const cap = kind === 'birth' ? slot.birthSlots : slot.deathSlots
  if (claimed + 1 > cap) return fail('NO_COHORT_SLOT', `集団 ${groupId} の${kind === 'birth' ? '出生' : '自然死'}枠 ${cap} を超えます`, [groupId])
  const next = { ...slot, ...(kind === 'birth' ? { claimedBirths: claimed + 1 } : { claimedDeaths: claimed + 1 }) }
  d.world = {
    ...w,
    demographics: { ...w.demographics, cohortSlots: w.demographics.cohortSlots.map((s, j) => (j === i ? next : s)) },
  }
  return null
}

export const personBirth: Handler<PersonBirthCommand> = (d, c) => {
  const w = d.world
  const p = c.person
  if (c.cohortYear !== w.year) return fail('YEAR_MISMATCH', `cohortYear ${c.cohortYear} が当年 ${w.year} ではありません`)
  if (p.birthYear !== w.year) return fail('INVALID_COMMAND', `出生年 ${p.birthYear} が当年 ${w.year} ではありません`)
  if (p.originGroupId !== c.cohortGroupId) return fail('INVALID_COMMAND', 'originGroupId が出生枠の集団と一致しません', [c.cohortGroupId])
  if (!p.alive || p.deathYear !== undefined) return fail('INVALID_COMMAND', '出生時の Person は生存状態でなければなりません')
  if (findPerson(w, p.personId)) return fail('ID_EXISTS', `人物 ${p.personId} は既に存在します`, [p.personId])
  // 法的王朝所属は A のみが決定する（GAME-01）。B は UNDETERMINED でしか登録できない。
  if (p.legalDynasty.status !== 'UNDETERMINED') {
    return fail('LEGAL_DYNASTY_NOT_OWNED_BY_B', '出生者の法的王朝所属は A のみが決定します。UNDETERMINED で登録してください', [p.personId])
  }
  if (p.fatherId === undefined && p.motherId === undefined) return fail('INVALID_COMMAND', '出生には親（fatherId / motherId）の少なくとも一方が必要です')
  for (const parentId of [p.fatherId, p.motherId]) {
    if (parentId !== undefined && !findPerson(w, parentId)) return fail('NOT_FOUND', `親 ${parentId} が存在しません`, [parentId])
  }
  if (!w.groups.some((g) => g.groupId === c.cohortGroupId)) return fail('NOT_FOUND', `集団 ${c.cohortGroupId} が存在しません`, [c.cohortGroupId])
  const slot = claimSlot(d, c.cohortGroupId, 'birth')
  if (slot) return slot
  d.world = { ...d.world, persons: [...d.world.persons, p] }
  return null
}

export const personDeath: Handler<PersonDeathCommand> = (d, c) => {
  const w = d.world
  const person = findPerson(w, c.personId)
  if (!person) return fail('NOT_FOUND', `人物 ${c.personId} が存在しません`, [c.personId])
  if (!person.alive) return fail('ALREADY_DEAD', `人物 ${c.personId} は既に死亡しています`, [c.personId])
  if (c.deathYear !== w.year) return fail('YEAR_MISMATCH', `deathYear ${c.deathYear} が当年 ${w.year} ではありません`)
  if (c.cause === 'NATURAL') {
    if (c.casualtyId !== undefined) return fail('INVALID_COMMAND', '自然死に casualtyId は使えません')
    const r = claimSlot(d, person.originGroupId, 'death')
    if (r) return r
  } else {
    // 戦死は損耗の確定（台帳 CASUALTY → 人口通知）に含まれる記名者に限る。人口は POPULATION_CASUALTY が一度だけ減らす。
    if (c.casualtyId === undefined) return fail('CASUALTY_NOT_BACKED', '戦死には casualtyId が必要です')
    const rec = d.casualties.get(c.casualtyId)
    if (!rec || rec.populationCount === undefined) return fail('CASUALTY_NOT_BACKED', `casualty ${c.casualtyId} の台帳・人口通知が確認できません`, [c.casualtyId])
    if (!rec.namedPersonIds.includes(c.personId)) return fail('CASUALTY_NOT_BACKED', `人物 ${c.personId} は casualty ${c.casualtyId} の記名者ではありません`, [c.personId])
    if (rec.deadNamedPersonIds.includes(c.personId)) return fail('ALREADY_DEAD', `人物 ${c.personId} の戦死は確定済みです`, [c.personId])
    d.casualties.set(c.casualtyId, { ...rec, deadNamedPersonIds: [...rec.deadNamedPersonIds, c.personId] })
    d.touchedCasualties.add(c.casualtyId)
  }
  d.world = {
    ...d.world,
    persons: d.world.persons.map((x) => (x.personId === c.personId ? { ...x, alive: false, deathYear: c.deathYear } : x)),
  }
  return null
}
