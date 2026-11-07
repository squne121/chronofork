// B の出生（Person 登録）と共通死亡 reducer。人口の増減は C① の枠確定と POPULATION_* のみが行い、
// ここでは個別 Person の登録・死亡確定と枠の請求済み数の更新だけを行う（人口へ再加算しない: 契約 §4）。
import type { PersonBirthCommand, PersonDeathCommand, PersonPromotionCommand, PersonSupportingRecordCommand, WorldState } from '../../contracts/index.ts'
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

/** B-001: 匿名人口の一人を実際に記録された候補として特定する。人口や既存の出生枠は加減しない。
 * 個人の出自・生年は評価器が照合済みの別証拠が必要。単なる人口数からは作らない。
 */
export const personPromote: Handler<PersonPromotionCommand> = (d, c) => {
  const w = d.world, p = c.person
  const validId = (s:unknown):s is string => typeof s==='string'&&s.length>0
  if(!validId(c.cohortId)||!validId(c.identityEvidenceId))return fail('INVALID_COMMAND','出典と人物の独立した記録IDが必要です')
  if(!Number.isSafeInteger(c.cohortBirthYear)||p.birthYear!==c.cohortBirthYear||
      c.cohortBirthYear>w.year-18)return fail('INVALID_COMMAND','生年・18歳以上の出典が一致しません')
  if(!Number.isSafeInteger(c.cohortSize)||c.cohortSize<1||
      !Number.isSafeInteger(c.memberOrdinal)||c.memberOrdinal<0||
      c.memberOrdinal>=c.cohortSize)
    return fail('INVALID_COMMAND','記録にないコホート構成員の昇格はできません')
  if(!p.alive||p.deathYear!==undefined||p.legalDynasty.status!=='UNDETERMINED'||
      p.fatherId!==undefined||p.motherId!==undefined||p.bloodlineDynastyId!==undefined)
    return fail('INVALID_COMMAND','血統・親子・法的王朝を証拠なしに追加できません')
  if(findPerson(w,p.personId))return fail('ID_EXISTS','すでに記名Personとして存在します',[p.personId])
  const g=w.groups.find(g=>g.groupId===p.originGroupId)
  const h=w.houses.find(h=>h.houseId===p.houseId)
  const region=g&&w.regions.find(r=>r.regionId===g.regionId)
  if(!g||!h||!region||!h.countryId||h.countryId!==region.sovereignCountryId||
      g.support.houseBps[h.houseId]===undefined)
    return fail('LEGAL_BASIS_MISSING','既存集団と家門/管轄の対応が証明できません')
  const alive=w.persons.filter(x=>x.alive&&x.originGroupId===g.groupId).length
  if(c.cohortSize>g.population||alive>=g.population)
    return fail('COHORT_CAPACITY_CONFLICT','集団の人口には未記名者の空きがありません')
  d.world={...w,persons:[...w.persons,p]}
  return null
}


/**
 * DEC-061: B-001専用の非操作補助人物記録。既存の重要人物昇格とは異なるSourceとCommandを使う。
 * 候補が法的婚姻可能であるとの証明ではなく、人口集団に含まれる匿名者を少数だけ追跡可能にする。
 */
export const personSupportingRecord: Handler<PersonSupportingRecordCommand> = (d, c) => {
  const w = d.world
  const p = c.person
  if (p.interactionRole !== 'SUPPORTING' || !p.alive || p.deathYear !== undefined ||
      p.fatherId !== undefined || p.motherId !== undefined ||
      p.bloodlineDynastyId !== undefined || p.legalDynasty.status !== 'UNDETERMINED') {
    return fail('INVALID_COMMAND', '補助人物は非操作・生存・血縁/王朝未確定のまま記録してください')
  }
  if (!c.sourceEvidenceId || !c.cohortId || !c.familyPoolId ||
      !Number.isSafeInteger(c.cohortSize) || c.cohortSize < 1 ||
      !Number.isSafeInteger(c.memberOrdinal) || c.memberOrdinal < 0 ||
      c.memberOrdinal >= c.cohortSize ||
      p.personId !== 'support:population:' + JSON.stringify([c.cohortId, c.memberOrdinal]) ||
      !Number.isSafeInteger(p.birthYear) || w.year - p.birthYear < 18) {
    return fail('INVALID_COMMAND', '補助候補のコホート・構成員番号・成人条件が不正です')
  }
  // 初期人口と過去年C004匿名出生枠を区別する。出生数のみで成人生存や血縁を推定しない。
  if(c.birthBacking==='INITIAL_POPULATION'){
    if(p.birthYear>=1250)
      return fail('LEGAL_BASIS_MISSING','初期人口コホートの出生年が不正です')
  }else if(c.birthBacking==='C004_COHORT'){
    if(!c.survivorAttestationId||c.survivorAttestationId===c.sourceEvidenceId)
      return fail('LEGAL_BASIS_MISSING','過去年出生集団の成人生存に独立した試験用出典がありません')
    const record=w.demographics.anonymousBirthHistory?.find(
      s=>s.groupId===p.originGroupId&&s.year===p.birthYear)
    if(p.birthYear<1250||!record||c.cohortSize>record.anonymousBirths)
      return fail('LEGAL_BASIS_MISSING','過去C004匿名出生枠の記録がありません')
    // 別コホートが同じ集団・出生年の匿名出生枠を共有するため、記録済みの補助人物数も数える。
    const recorded=w.persons.filter(x=>x.originGroupId===p.originGroupId&&
      x.birthYear===p.birthYear&&x.personId.startsWith('support:population:')).length
    if(recorded>=record.anonymousBirths)
      return fail('COHORT_CAPACITY_CONFLICT','同じ集団・出生年の匿名出生枠を使い切っています')
  }else return fail('INVALID_COMMAND','人口出生出典の種類が不正です')
  if (findPerson(w, p.personId)) return fail('ID_EXISTS', '補助人物IDを再利用できません', [p.personId])
  const group = w.groups.find(g => g.groupId === p.originGroupId)
  const region = group && w.regions.find(r => r.regionId === group.regionId)
  const house = w.houses.find(h => h.houseId === p.houseId)
  if (!group || !region || !house?.countryId ||
      region.sovereignCountryId !== house.countryId ||
      group.support.houseBps[house.houseId] === undefined) {
    return fail('LEGAL_BASIS_MISSING', '補助人物の人口集団・家門・管轄が確認できません')
  }
  const living = w.persons.filter(x => x.alive && x.originGroupId === group.groupId).length
  if (c.cohortSize > group.population || living >= group.population) {
    return fail('COHORT_CAPACITY_CONFLICT', '人口集団の未記名者の空きがありません')
  }
  d.world = { ...w, persons: [...w.persons, p] } // 人口の一次値は変更しない
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
