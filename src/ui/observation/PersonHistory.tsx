// 選択人物の「この世界線の観測期間内の履歴」。選択年初の状態（FamilyTree）とは別に、実A0全期間の記録を示す。
// 婚姻・出生が成立しなかった理由は、実DecisionTraceに記録された範囲だけを読む。記録がない部分は記録がないと示す。
import type { Id } from '../../simulation/contracts/index.ts'
import type { JudgmentSpan, PersonRecord } from './person-record.ts'
import { reasonView } from './reason-labels.ts'

export type PersonHistoryProps = Readonly<{
  records: readonly PersonRecord[]
  personId: Id
  /** 観測中の年（年初）。 */
  currentYear: number
  nameOf: (id: Id) => string | undefined
  disabled?: boolean
  onFocusPerson: (personId: Id, year: number) => void
  onOpenEvent: (eventId: Id, year: number) => void
  onOpenTrace: (traceId: Id, year: number) => void
  onYear: (year: number) => void
  onSelectTitle: (titleId: Id, year: number) => void
  /** 婚姻候補の2人を介入フォームへ渡す。未指定なら導線を出さない。 */
  onIntervene?: (year: number, personId: Id, partnerId: Id) => void
}>

const RULE_LABEL: Readonly<Record<JudgmentSpan['ruleId'], string>> = {
  'B-004': '婚姻候補の判断（B-004）',
  'B-005': '婚姻契約の交渉（B-005）',
  'B-002': '出生の判断（B-002）',
  'B-001': '婚姻相手の候補の供給（B-001）',
}
const STATUS_LABEL: Readonly<Record<JudgmentSpan['status'], string>> = { ACCEPT: '採用', DEFER: '保留', REJECT: '不採用' }
const KINSHIP_LABEL: Readonly<Record<string, string>> = { SIBLING: 'きょうだい', PARENT_CHILD: '親子' }
const yearsText = (s: Pick<JudgmentSpan, 'fromYear' | 'toYear'>) => (s.fromYear === s.toYear ? `${s.fromYear}年` : `${s.fromYear}〜${s.toYear}年`)

/** 結果を判断の種類ごとに言い換えた見出し。理由コードに無いことは書かない。 */
function outcomeLabel(s: JudgmentSpan): string {
  const codes = new Set(s.reasonCodes)
  if (s.ruleId === 'B-001') return s.status === 'ACCEPT' ? '候補が供給された' : '候補の供給が見送られた'
  if (s.ruleId === 'B-004') {
    if (s.status === 'REJECT') return '婚姻候補として不採用'
    if (s.status === 'DEFER') return '婚姻候補として保留（候補にならなかった）'
    return '婚姻候補として採用'
  }
  if (s.ruleId === 'B-005') {
    if (s.status === 'ACCEPT') return '契約交渉が成立'
    if (codes.has('B004_NOT_ACCEPTED')) return '交渉に進まなかった'
    return s.status === 'REJECT' ? '契約交渉が不成立（不採用）' : '契約交渉が成立しなかった（保留）'
  }
  if (s.status === 'ACCEPT') return '出生が成立'
  return s.status === 'REJECT' ? '出生が成立しなかった（抽選等で選ばれず・不採用）' : '出生が成立しなかった（保留）'
}

export function PersonHistory(p: PersonHistoryProps) {
  const rec = p.records.find(r => r.personId === p.personId)
  const name = (id: Id) => p.nameOf(id) ?? '名前未確認の人物'
  const recOf = (id: Id) => p.records.find(r => r.personId === id)
  const appearYear = (id: Id) => {
    const r = recOf(id)
    return r === undefined || p.currentYear >= r.firstYear ? p.currentYear : r.firstYear
  }
  if (!rec) {
    return <section className="obs-history" data-testid="person-history">
      <h4>この世界線の観測期間内の履歴</h4>
      <p className="note">この人物の履歴記録は、観測した原史A0にありません。</p>
    </section>
  }
  const link = (id: Id | undefined, role: string) => {
    if (id === undefined) return <span>{role}：記録なし</span>
    const r = recOf(id)
    if (!r) return <span>{role}：{name(id)}（人物記録を確認できない）</span>
    const y = appearYear(id)
    return <span>{role}：<button type="button" disabled={p.disabled} onClick={() => p.onFocusPerson(id, y)}>
      {name(id)}（{r.birthYear}年生）を調べる</button></span>
  }
  const spansByPartner = new Map<string, JudgmentSpan[]>()
  for (const s of rec.judgments) {
    if (s.ruleId === 'B-002' || s.ruleId === 'B-001') continue
    const k = s.partnerId ?? ''
    const l = spansByPartner.get(k) ?? []
    l.push(s)
    spansByPartner.set(k, l)
  }
  const birthSpans = rec.judgments.filter(s => s.ruleId === 'B-002')
  const supplySpans = rec.judgments.filter(s => s.ruleId === 'B-001')
  const candidateSpans = rec.judgments.filter(s => s.ruleId === 'B-004')
  const traceButton = (s: JudgmentSpan) => <button type="button" disabled={p.disabled} data-testid="history-open-trace"
    onClick={() => p.onOpenTrace(s.firstTraceId, s.fromYear)}>{s.fromYear}年の判断記録を開く</button>
  const detail = (s: JudgmentSpan) => {
    const v = reasonView(s.reasonCodes)
    return <details className="dev-details"><summary>技術詳細</summary>
      <span className="note">規則 {s.ruleId}／判断 {s.status}／理由コード {s.reasonCodes.join(', ') || '記録なし'}
        {v.unclassified.length > 0 ? `／未分類コード ${v.unclassified.join(', ')}` : ''}</span></details>
  }
  const spanLine = (s: JudgmentSpan) => {
    const v = reasonView(s.reasonCodes)
    const kin = s.knownKinship ? `記録上の続柄：${KINSHIP_LABEL[s.knownKinship] ?? '未分類（' + s.knownKinship + '）'}` : undefined
    const trust = s.trustMin !== undefined && s.threshold !== undefined
      ? `信頼値 ${s.trustMin === s.trustMax ? s.trustMin : s.trustMin + '〜' + s.trustMax}／採用の閾値 ${s.threshold}` : undefined
    const ages = s.motherAge !== undefined ? `母 ${s.motherAge}歳${s.fatherAge === undefined ? '' : '・父 ' + s.fatherAge + '歳'}（判断時点の記録）` : undefined
    return <li key={s.firstTraceId + s.status}>
      <strong>{yearsText(s)}（判断{s.count}件）：{outcomeLabel(s)}</strong><span className="note"> {RULE_LABEL[s.ruleId]}・記録上の判断：{STATUS_LABEL[s.status]}</span>
      <div className="note">{[...v.labels, ...(v.unclassified.length > 0 ? ['未分類の理由が' + v.unclassified.length + '件（技術詳細）'] : []),
        ...(kin ? [kin] : []), ...(trust ? [trust] : []), ...(ages ? [ages] : [])].join('。') || '通常表示できる理由の記録なし'}</div>
      <div className="obs-related-links">{traceButton(s)}</div>
      {detail(s)}
    </li>
  }
  const marriedYearsText = (m: PersonRecord['marriages'][number]) => m.dissolvedYear === undefined
    ? `${m.registeredYear}年〜（観測終了時も継続）` : `${m.registeredYear}〜${m.dissolvedYear}年`
  const notAppeared = p.currentYear < rec.firstYear

  return <section className="obs-history" data-testid="person-history" aria-label="この世界線の観測期間内の履歴">
    <h4>この世界線の観測期間内の履歴（1250〜1350年・原史A0）</h4>
    <p className="note">選択年初の状態とは別に、この原史A0の観測期間に記録された出来事を人物ごとに集めたものです。</p>
    {notAppeared && <p role="status" data-testid="history-not-yet">
      この人物は{p.currentYear}年初の記録にまだ現れません（{rec.birthYear}年生。年初の記録に現れるのは{rec.firstYear}年初）。
      <button type="button" disabled={p.disabled} onClick={() => p.onFocusPerson(rec.personId, rec.firstYear)}>{rec.firstYear}年初へ移動</button>
    </p>}
    <dl className="obs-history-facts">
      <dt>生没</dt>
      <dd data-testid="history-life">{rec.birthYear}年生{rec.deathYear === undefined ? '・観測期間内は存命' : '・' + rec.deathYear + '年没'}
        {rec.birthEventId !== undefined
          ? <button type="button" disabled={p.disabled} onClick={() => p.onOpenEvent(rec.birthEventId!, rec.birthYear)}>出生の記録を開く</button>
          : <span className="note">（観測開始前の出生で、出生Eventはありません）</span>}
        {rec.deathEventId !== undefined && rec.deathYear !== undefined &&
          <button type="button" disabled={p.disabled} data-testid="history-death-link" onClick={() => p.onOpenEvent(rec.deathEventId!, rec.deathYear!)}>死亡の記録を開く</button>}
      </dd>
      <dt>両親</dt>
      <dd data-testid="history-parents">{link(rec.fatherId, '父')} / {link(rec.motherId, '母')}</dd>
      <dt>婚姻歴</dt>
      <dd data-testid="history-marriages">{rec.marriages.length === 0
        ? '観測期間内に成立した婚姻の記録なし'
        : <ul>{rec.marriages.map(m => <li key={m.marriageId}>{marriedYearsText(m)}：{link(m.partnerId, '配偶者')}
          <button type="button" disabled={p.disabled} onClick={() => p.onYear(m.registeredYear)}>成立の年を観測</button></li>)}</ul>}</dd>
      <dt>子</dt>
      <dd data-testid="history-children">{rec.childIds.length === 0
        ? '観測期間内に出生した子の記録なし'
        : <ul className="obs-history-children">{rec.childIds.map(id => {
          const c = recOf(id)
          return <li key={id}>{c ? <button type="button" disabled={p.disabled} onClick={() => p.onFocusPerson(id, appearYear(id))}>
            {name(id)}（{c.birthYear}年生{c.deathYear === undefined ? '' : '・' + c.deathYear + '年没'}）</button> : name(id)}</li>
        })}</ul>}</dd>
      <dt>称号の保持</dt>
      <dd data-testid="history-titles">{rec.titles.length === 0
        ? '観測期間内に称号の保持は記録されていません'
        : <ul>{rec.titles.map(t => <li key={t.titleId + t.fromYear}>
          <button type="button" disabled={p.disabled} onClick={() => p.onSelectTitle(t.titleId, t.fromYear)}>{t.label}</button>
          ：{t.fromYear}{t.throughYear > t.fromYear ? '〜' + t.throughYear : ''}年初{t.life === 'DEAD' ? '（故人の名義が残る期間を含む）' : ''}</li>)}</ul>}</dd>
    </dl>

    <div data-testid="history-judgments">
      <h5>婚姻・出生が成立しなかった理由（記録された判断）</h5>
      {candidateSpans.length === 0 && rec.marriages.length === 0 && <p className="missing" data-testid="history-no-candidate">
        <strong>婚姻候補の記録なし。</strong>この人物を含む婚姻候補の判断記録が、観測期間にありません。
        候補が供給されなかったのか、候補の列挙前に対象外とされたのか、記録が不足しているのかは、この記録からは区別できません。
        原因は断定せず、世界構成（候補となる人物の有無）の確認が必要な箇所として残します。</p>}
      {supplySpans.length > 0 && <section data-testid="history-supply">
        <h6>婚姻相手の候補の供給（記録された判断）</h6>
        <ul>{supplySpans.map(spanLine)}</ul>
        <p className="note">供給が見送られた理由は上記の記録のとおりです。人物間信頼の調整が候補の供給に影響するかは、この記録からは確認できません。候補の供給は世界構成・試遊データ側の確認事項です。</p>
      </section>}
      {[...spansByPartner.entries()].map(([partnerId, spans]) => {
        const kin = spans.find(s => s.knownKinship)?.knownKinship
        const b4 = spans.filter(s => s.ruleId === 'B-004')
        const firstB4 = b4[0]
        return <details key={partnerId} className="obs-history-partner" data-testid="history-partner">
          <summary>{partnerId ? name(partnerId) : '相手の記録なし'}
            {kin && <span className="note">（記録上の続柄：{KINSHIP_LABEL[kin] ?? '未分類'}）</span>}
            <span className="note">・{yearsText({ fromYear: Math.min(...spans.map(x => x.fromYear)), toYear: Math.max(...spans.map(x => x.toYear)) })}・{outcomeLabel((b4.length > 0 ? b4 : spans).at(-1)!)}</span></summary>
          {partnerId && <div>{link(partnerId, '相手')}</div>}
          <ul>{spans.map(spanLine)}</ul>
          {p.onIntervene && firstB4 && partnerId && firstB4.fromYear < 1350 && !kin &&
            !spans.some(x => x.reasonCodes.includes('COMMON_ANCESTOR_WITHIN_TWO_GENERATIONS')) &&
            <button type="button" disabled={p.disabled} data-testid="history-intervene-pair"
              onClick={() => p.onIntervene!(firstB4.fromYear, rec.personId, partnerId)}>
              この2人の信頼を介入として検討する（{firstB4.fromYear}年）</button>}
        </details>
      })}
      {candidateSpans.length > 0 && <p className="note">信頼の数値介入が結果を変えられるのは、不採用・保留の理由が信頼値の閾値であるときです。
        血縁や共通祖先の記録が理由のときは、信頼値だけでは変わるとは限りません（変わらないとも断定しません）。</p>}
      <h5>出生の判断（この人物が親として記録されたもの）</h5>
      {birthSpans.length === 0
        ? <p className="missing" data-testid="history-no-birth-judgment">
          この人物を親とする出生の判断記録はありません。出生の判断は有効な婚姻を単位に記録されるため、
          {rec.marriages.length === 0 ? '婚姻が成立していない場合は、出生が成立しなかったのではなく判断の対象外です。' : '婚姻中の判断記録が見つかりません（記録不足）。'}</p>
        : <ul>{birthSpans.map(spanLine)}</ul>}
    </div>
  </section>
}
