import { useMemo, useState } from 'react'
import { reasonSentence } from '../../observation/reason-labels.ts'
import type { DecisionTrace } from '../../../simulation/contracts/index.ts'
import type { HistoryYear } from '../data/history.ts'

/** 当年の判断と、同じ枝の年初に読める基礎値を別々に表示する。 */
export function RelationshipBasis({ history, left, right }: Readonly<{ history: HistoryYear; left: string; right: string }>) {
  const result = useMemo(() => history.relationship(left, right), [history, left, right])
  return <p data-testid="relationship-basis">年初の信頼基礎値（当年の介入・判断とは別）：{result.kind !== 'YEAR_START_BASE'
    ? 'この参照では取得できません'
    : result.observation.status === 'UNKNOWN' ? '未確定（UNKNOWN）。値ゼロとは扱いません。'
    : `${result.observation.value}（${result.observation.throughYear}年までの基礎値・${result.observation.status === 'RECORDED' ? '記録済み（RECORDED）' : '過去の記録・初期値から導出（DERIVED）'}）`}</p>
}

export function pairJudgments(history: HistoryYear, left: string, right: string) {
  return history.records.kind === 'COMMITTED' ? history.records.traces.filter(trace =>
    (trace.ruleId === 'B-004' || trace.ruleId === 'B-005') && trace.actorRef.kind === 'PERSON_PAIR' &&
    trace.actorRef.ids.includes(left) && trace.actorRef.ids.includes(right)) : []
}

export function PersonRelationship({ history, personId, nameOf, onTrace }: Readonly<{
  history: HistoryYear; personId: string; nameOf: (id: string) => string; onTrace: (trace: DecisionTrace) => void
}>) {
  const [right, setRight] = useState('')
  if (history.start.kind !== 'CONFIRMED') return null
  const others = history.start.world.persons.filter(p => p.personId !== personId)
  const selected = others.some(p => p.personId === right)
  const judgments = selected ? pairJudgments(history, personId, right) : []
  return <section aria-label="人物間の信頼と判断">
    <label>この年の信頼を調べる相手 <select value={selected ? right : ''} onChange={e => setRight(e.target.value)}>
      <option value="">選択してください</option>
      {others.map(p => <option key={p.personId} value={p.personId}>{nameOf(p.personId)}{p.alive ? '' : '（年初に死亡済み）'}</option>)}
    </select></label>
    {selected && <>
      <RelationshipBasis history={history} left={personId} right={right} />
      <h5>選んだ2人についての当年の実判断</h5>
      {judgments.length === 0 ? <p>取得範囲に婚姻候補・交渉の判断記録はありません。</p> : <ul>{judgments.map(trace => <li key={trace.traceId}>
        <button type="button" onClick={() => onTrace(trace)}>{reasonSentence(trace.reasonCodes)}（{trace.eventIds.length === 0 ? '関連Eventなし' : '関連Eventあり'}）</button>
        <RecordedTrust trace={trace} />
      </li>)}</ul>}
    </>}
  </section>
}

export function RecordedTrust({ trace }: Readonly<{ trace: DecisionTrace }>) {
  if (trace.ruleId !== 'B-004') return null
  return trace.candidates.map(candidate => {
    const value = candidate.inputs?.effectiveTrust
    if (typeof value !== 'number') return null
    const weight = candidate.inputs?.trustWeight
    return <p key={candidate.candidateId} data-testid="recorded-effective-trust">当年の婚姻候補審査で使った実効信頼：{value}
      （{trace.modifierIds.length ? '介入の補正を反映' : '適用された介入なし'}）。
      {typeof weight === 'number' && `信頼の重み ${weight}。`}
      {typeof candidate.score === 'number' && `比較に使った得点 ${candidate.score}。`}
      {typeof candidate.threshold === 'number' && `採用の閾値 ${candidate.threshold}。`}</p>
  })
}

export function RecordedNegotiation({ trace, nameOf, dynastyOf }: Readonly<{ trace: DecisionTrace; nameOf: (id:string) => string; dynastyOf: (id:string) => string | undefined }>) {
  if (trace.ruleId !== 'B-005' || trace.actorRef.kind !== 'PERSON_PAIR') return null
  const [left, right] = trace.actorRef.ids.map(nameOf)
  return trace.candidates.map(candidate => {
    const { sourceB004Score, contractOptions, selectedContractKey, partnerHouseInterests } = candidate.inputs ?? {}
    const options = Array.isArray(contractOptions) ? contractOptions.flatMap(option => {
      if (option === null || typeof option !== 'object' || Array.isArray(option) || !('key' in option) ||
        typeof option.firstConsentScore !== 'number' || typeof option.secondConsentScore !== 'number') return []
      return [option]
    }) : []
    return <div key={candidate.candidateId}>
      {typeof sourceB004Score === 'number' && <p>交渉が参照した婚姻候補審査の得点：{sourceB004Score}。</p>}
      {Array.isArray(partnerHouseInterests) && typeof partnerHouseInterests[0] === 'number' && typeof partnerHouseInterests[1] === 'number' &&
        <p>候補比較に記録された家門の利害値：{left} {partnerHouseInterests[0]}／{right} {partnerHouseInterests[1]}。</p>}
      {options.length > 0 && <details><summary>記録された契約案と両者の同意値（{options.length}件）</summary>
        <ol>{options.map((option, i) => <li key={i}>案{i + 1}{typeof option.dynastyId === 'string' ? `（王朝条項：${dynastyOf(option.dynastyId) ?? '名称未確認'}）`
          : option.dynastyId === null ? '（王朝の指定なし）' : ''}：{left} {String(option.firstConsentScore)}／{right} {String(option.secondConsentScore)}。
          {option.mutuallyAccepted === true ? '相互同意あり。' : option.mutuallyAccepted === false ? '相互同意なし。' : ''}
          {typeof selectedContractKey === 'string' && option.key === selectedContractKey && '記録上の選択案。'}</li>)}</ol>
      </details>}
    </div>
  })
}
