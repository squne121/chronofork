// A 法制の確定（婚姻・法的王朝・Title・LegalCase・委任・徴税権）。
// reducer は A が検証済みの command を機械的に適用するのみ。相続順位・適法性の判断はしない。
// 根拠（approved case / 契約条項 / 承認証拠）が command と現状態から確認できない場合は拒否する。
import type {
  ControlMandateSetCommand,
  CountryRulerSetCommand,
  LegalCaseSetCommand,
  LegalDynastySetCommand,
  LegalTitleTransferCommand,
  MarriageRegisterCommand,
  MarriageDissolveCommand,
  TaxMandateSetCommand,
  TitleRecognitionSetCommand,
} from '../../contracts/index.ts'
import type { Handler } from './draft.ts'
import { fail, findPerson, findTitle, requireAlivePerson } from './draft.ts'

const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v.length > 0

export const marriageRegister: Handler<MarriageRegisterCommand> = (d, c) => {
  const w = d.world
  const m = c.marriage
  if (m.status !== 'ACTIVE') return fail('INVALID_COMMAND', '登録する婚姻の status は ACTIVE のみです')
  if (m.registeredYear !== w.year) return fail('YEAR_MISMATCH', `registeredYear ${m.registeredYear} が当年 ${w.year} ではありません`)
  const [a, b] = m.personIds
  if (a === b || a > b) return fail('INVALID_COMMAND', 'personIds は異なる 2 人を ID 昇順で指定します')
  if (w.legal.marriages.some((x) => x.marriageId === m.marriageId)) return fail('ID_EXISTS', `婚姻 ${m.marriageId} は既に存在します`, [m.marriageId])
  for (const id of m.personIds) {
    const r = requireAlivePerson(w, id)
    if (r) return r
    // 法的配偶者は 1 人（契約 §2/§4「法的配偶者の相互整合」）。重婚の可否は未承認のため、安全側で拒否する。
    const active = w.legal.marriages.find((x) => x.status === 'ACTIVE' && x.personIds.includes(id))
    if (active) return fail('PERSON_ALREADY_MARRIED', `人物 ${id} は有効な婚姻 ${active.marriageId} があります`, [id, active.marriageId])
  }
  d.world = { ...w, legal: { ...w.legal, marriages: [...w.legal.marriages, m] } }
  return null
}

/** A-LEG-01がB-003で確定済みの配偶者死亡だけを根拠に行う。翌年までは新婚姻候補へ戻さない。 */
export const marriageDissolve: Handler<MarriageDissolveCommand> = (d, c) => {
  const w = d.world
  const m = w.legal.marriages.find(x => x.marriageId === c.marriageId)
  if (!m) return fail('NOT_FOUND', `婚姻 ${c.marriageId} が見つかりません`, [c.marriageId])
  if (m.status !== 'ACTIVE') return fail('INVALID_COMMAND', '既に終了した婚姻は再度終了できません', [m.marriageId])
  if (c.cause !== 'SPOUSE_DEATH' || c.dissolvedYear !== w.year) return fail('INVALID_COMMAND', '当年の配偶者死亡のみで終了できます')
  if (!m.personIds.includes(c.deceasedPersonId)) return fail('INVALID_COMMAND', '死亡者が婚姻の当事者ではありません')
  const p = findPerson(w, c.deceasedPersonId)
  if (!p || p.alive || p.deathYear !== w.year) return fail('LEGAL_BASIS_MISSING', '当年の確定死亡記録がありません')
  if (!c.source.sourceIntentId) return fail('LEGAL_BASIS_MISSING', 'B-003の死亡判断根拠が必要です')
  d.world = { ...w, legal: { ...w.legal, marriages: w.legal.marriages.map(x =>
    x.marriageId === m.marriageId ? { ...x, status: 'DISSOLVED' as const, dissolvedYear: w.year } : x) } }
  return null
}

export const legalDynastySet: Handler<LegalDynastySetCommand> = (d, c) => {
  const w = d.world
  const person = findPerson(w, c.personId)
  if (!person) return fail('NOT_FOUND', `人物 ${c.personId} が存在しません`, [c.personId])
  if (!person.alive) return fail('PERSON_DEAD', `死亡済みの人物 ${c.personId} の所属は確定しません`, [c.personId])
  if (person.legalDynasty.status === 'DETERMINED') {
    return fail('LEGAL_DYNASTY_ALREADY_DETERMINED', `人物 ${c.personId} の法的王朝は確定済みで、上書きしません`, [c.personId])
  }
  const next = c.legalDynasty
  if (next.status === 'DETERMINED') {
    // GAME-01: 父系などの既定規則は無い。有効な婚姻契約の明示条項が証拠として存在する場合のみ確定する。
    const { fatherId, motherId } = person
    const pair = fatherId !== undefined && motherId !== undefined ? ([fatherId, motherId].sort() as [string, string]) : null
    const marriage = pair
      ? w.legal.marriages.find((m) => m.status === 'ACTIVE' && m.personIds[0] === pair[0] && m.personIds[1] === pair[1])
      : undefined
    const clause = marriage?.contract?.clauses.find((cl) => cl.kind === 'CHILD_LEGAL_DYNASTY' && cl.dynastyId === next.dynastyId)
    if (!clause) {
      return fail('LEGAL_DYNASTY_EVIDENCE_MISSING', `人物 ${c.personId} を王朝 ${next.dynastyId} へ確定する婚姻契約の明示条項が確認できません（GAME-01）`, [c.personId])
    }
    if (!w.legal.dynasties.some((x) => x.dynastyId === next.dynastyId)) return fail('NOT_FOUND', `王朝 ${next.dynastyId} が存在しません`, [next.dynastyId])
  }
  d.world = { ...w, persons: w.persons.map((p) => (p.personId === c.personId ? { ...p, legalDynasty: next } : p)) }
  return null
}

export const legalTitleTransfer: Handler<LegalTitleTransferCommand> = (d, c) => {
  const w = d.world
  const title = findTitle(w, c.titleId)
  if (!title) return fail('NOT_FOUND', `Title ${c.titleId} が存在しません`, [c.titleId])
  // CROWNが失効済みでも、死亡した保持者をHELDに残すことはできない。
  // 継承承認（HELDへの移転）は従来どおり有効Titleに限定する。
  const existingHolder = title.holder
  const cleanupDeadCrown = title.kind === 'CROWN' && c.toHolder.status === 'UNDETERMINED' &&
    existingHolder.status === 'HELD' && w.persons.some(p => p.personId === existingHolder.personId && !p.alive)
  if (!title.valid && !cleanupDeadCrown) return fail('TITLE_INVALID', `Title ${c.titleId} は無効です`, [c.titleId])
  // 存命の保持者からの移転（授与・剥奪・譲渡）は A-TIT-06/08 の判断が必要で、本 reducer では適用しない。
  if (title.holder.status === 'HELD') {
    const cur = findPerson(w, title.holder.personId)
    if (cur?.alive) return fail('TITLE_HOLDER_ALIVE', `Title ${c.titleId} の保持者 ${cur.personId} は存命です。存命保持者からの移転は適用しません`, [cur.personId])
  }
  const legalCase = c.legalCaseId !== undefined ? w.legal.cases.find((x) => x.caseId === c.legalCaseId) : undefined
  if (c.legalCaseId !== undefined && (!legalCase || legalCase.titleId !== c.titleId)) {
    return fail('LEGAL_BASIS_MISSING', `LegalCase ${c.legalCaseId} が存在しない、または Title ${c.titleId} のものではありません`, [c.legalCaseId])
  }
  if (c.toHolder.status === 'HELD') {
    const holderId = c.toHolder.personId
    const r = requireAlivePerson(w, holderId)
    if (r) return r
    if (!title.hereditary) return fail('TITLE_NOT_HEREDITARY', `Title ${c.titleId} は世襲ではないため継承移転しません`, [c.titleId])
    // 承認済み SUCCESSION ケースに候補として含まれる人物にのみ移転する。順位は推測しない。
    if (!legalCase || legalCase.kind !== 'SUCCESSION' || legalCase.status !== 'APPROVED' || !legalCase.candidatePersonIds.includes(holderId)) {
      return fail('LEGAL_BASIS_MISSING', `Title ${c.titleId} を ${holderId} へ移す承認済み SUCCESSION ケースが確認できません`, [holderId])
    }
  }
  d.world = { ...w, titles: w.titles.map((t) => (t.titleId === c.titleId ? { ...t, holder: c.toHolder } : t)) }
  return null
}


/** CROWNとCOUNTRYの一意な対応記録がある場合のみ統治者参照を更新する。
 * 国王の交替は土地・実効支配・委任・税権に作用しない。 */
export const countryRulerSet: Handler<CountryRulerSetCommand> = (d, c) => {
  const w = d.world
  const country = w.countries.find(x => x.countryId === c.countryId)
  const title = findTitle(w, c.crownTitleId)
  const legalCase = w.legal.cases.find(x => x.caseId === c.legalCaseId)
  const predecessor = findPerson(w, c.predecessorPersonId)
  if (!country || !title || !legalCase || !predecessor) {
    return fail('LEGAL_BASIS_MISSING', '王位・国家・前保持者・LegalCaseの対応記録がありません')
  }
  if (title.kind !== 'CROWN' || title.recognition.sovereignCountryId !== c.countryId ||
      !title.valid || !title.hereditary ||
      w.titles.filter(t => t.kind === 'CROWN' && t.recognition.sovereignCountryId === c.countryId).length !== 1 ||
      legalCase.titleId !== title.titleId || legalCase.kind !== 'SUCCESSION' ||
      !legalCase.reasonCodes.includes('CROWN_SUCCESSION') ||
      !legalCase.reasonCodes.includes('PREDECESSOR_ID:' + c.predecessorPersonId) ||
      !legalCase.reasonCodes.includes('CROWN_RULER_COUNTRY:' + c.countryId) ||
      predecessor.alive || predecessor.deathYear === undefined || predecessor.deathYear > w.year) {
    return fail('LEGAL_BASIS_MISSING', '王位継承と国家統治者の明示的対応が未確認です')
  }
  if (country.rulerPersonId !== undefined && country.rulerPersonId !== c.predecessorPersonId) {
    return fail('LEGAL_BASIS_MISSING', '既存国家統治者が対象の前保持者と一致しません')
  }
  if (c.toRulerPersonId !== undefined) {
    const living = requireAlivePerson(w, c.toRulerPersonId)
    if (living) return living
    if (legalCase.status !== 'APPROVED' || legalCase.candidatePersonIds.length !== 1 ||
        legalCase.candidatePersonIds[0] !== c.toRulerPersonId ||
        title.holder.status !== 'HELD' || title.holder.personId !== c.toRulerPersonId ||
        !legalCase.reasonCodes.some(x => x.startsWith('CROWN_APPROVAL_DECISION:')) ||
        !legalCase.reasonCodes.some(x => x.startsWith('CROWN_AUTHORITY_BASIS:'))) {
      return fail('LEGAL_BASIS_MISSING', '王位と整合する承認済みの唯一の後継者がいません')
    }
  } else {
    if (country.rulerPersonId !== c.predecessorPersonId ||
        legalCase.status !== 'PENDING' || title.holder.status !== 'UNDETERMINED') {
      return fail('LEGAL_BASIS_MISSING', '未確定の王位と統治者記録の清算条件が一致しません')
    }
  }
  d.world = { ...w, countries: w.countries.map(x => {
    if (x.countryId !== c.countryId) return x
    if (c.toRulerPersonId !== undefined) return { ...x, rulerPersonId: c.toRulerPersonId }
    const { rulerPersonId: _former, ...withoutRuler } = x
    void _former
    return withoutRuler
  }) }
  return null
}

export const titleRecognitionSet: Handler<TitleRecognitionSetCommand> = (d, c) => {
  const w = d.world
  if (!findTitle(w, c.titleId)) return fail('NOT_FOUND', `Title ${c.titleId} が存在しません`, [c.titleId])
  const r = c.recognition
  if (r.status === 'ACTIVE' && (r.authority === undefined || !nonEmpty(r.sourceDecisionId))) {
    return fail('RECOGNITION_EVIDENCE_MISSING', 'ACTIVE の承認には authority と sourceDecisionId が必要です（権限を後付けしない: GAME-02）')
  }
  d.world = { ...w, titles: w.titles.map((t) => (t.titleId === c.titleId ? { ...t, recognition: r } : t)) }
  return null
}

export const legalCaseSet: Handler<LegalCaseSetCommand> = (d, c) => {
  const w = d.world
  const lc = c.legalCase
  if (!findTitle(w, lc.titleId)) return fail('NOT_FOUND', `Title ${lc.titleId} が存在しません`, [lc.titleId])
  if (lc.status !== 'REJECTED') {
    for (const id of lc.candidatePersonIds) {
      const r = requireAlivePerson(w, id)
      if (r) return r
    }
  }
  const prev = w.legal.cases.find((x) => x.caseId === lc.caseId)
  if (prev) {
    if (prev.status !== 'PENDING') return fail('LEGAL_CASE_FINALIZED', `LegalCase ${lc.caseId} は ${prev.status} で確定済みです`, [lc.caseId])
    if (prev.titleId !== lc.titleId || prev.kind !== lc.kind) return fail('INVALID_COMMAND', `LegalCase ${lc.caseId} の titleId / kind は変更できません`, [lc.caseId])
  }
  const cases = prev ? w.legal.cases.map((x) => (x.caseId === lc.caseId ? lc : x)) : [...w.legal.cases, lc]
  d.world = { ...w, legal: { ...w.legal, cases } }
  return null
}

export const controlMandateSet: Handler<ControlMandateSetCommand> = (d, c) => {
  const w = d.world
  const m = c.mandate
  if (w.legal.controlMandates.some((x) => x.mandateId === m.mandateId)) return fail('ID_EXISTS', `ControlMandate ${m.mandateId} は既に存在します`, [m.mandateId])
  if (!nonEmpty(m.sourceEventId)) return fail('MANDATE_EVIDENCE_MISSING', 'ControlMandate には sourceEventId が必要です')
  if (m.effectiveFromYear < w.year) return fail('RETROACTIVE_MANDATE', `委任の開始年 ${m.effectiveFromYear} が当年 ${w.year} より前です`)
  const title = findTitle(w, m.authorizingTitleId)
  if (!title) return fail('NOT_FOUND', `Title ${m.authorizingTitleId} が存在しません`, [m.authorizingTitleId])
  const r = requireAlivePerson(w, m.beneficiaryPersonId)
  if (r) return r
  if (!title.valid || title.recognition.status !== 'ACTIVE') {
    return fail('MANDATE_TITLE_NOT_ACTIVE', `根拠 Title ${title.titleId} が有効・承認済みではありません`, [title.titleId])
  }
  // 受益者の自動付替えはしない。根拠 Title を現に保持する本人への委任のみ（GAME-03）。
  if (title.holder.status !== 'HELD' || title.holder.personId !== m.beneficiaryPersonId) {
    return fail('MANDATE_BENEFICIARY_NOT_HOLDER', `受益者 ${m.beneficiaryPersonId} が根拠 Title ${title.titleId} の保持者ではありません`, [m.beneficiaryPersonId])
  }
  d.world = { ...w, legal: { ...w.legal, controlMandates: [...w.legal.controlMandates, m] } }
  return null
}

export const taxMandateSet: Handler<TaxMandateSetCommand> = (d, c) => {
  const w = d.world
  const m = c.mandate
  if (w.legal.taxMandates.some((x) => x.mandateId === m.mandateId)) return fail('ID_EXISTS', `TaxCollectionMandate ${m.mandateId} は既に存在します`, [m.mandateId])
  if (!nonEmpty(m.sourceTreatyOrLawId)) return fail('MANDATE_EVIDENCE_MISSING', 'TaxCollectionMandate には sourceTreatyOrLawId が必要です')
  // 当年の徴税先は C① で固定済み。④〜⑥の変更は①へ遡及しない（契約 §5）。
  if (m.effectiveFromYear <= w.year) return fail('RETROACTIVE_MANDATE', `徴税権の開始年 ${m.effectiveFromYear} は翌年（${w.year + 1}）以降に限ります`)
  d.world = { ...w, legal: { ...w.legal, taxMandates: [...w.legal.taxMandates, m] } }
  return null
}
