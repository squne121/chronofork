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
  const inputs = trace.candidates.find(candidate => typeof candidate.inputs?.effectiveTrust === 'number')?.inputs
  if (!inputs) return null
  return <p data-testid="recorded-effective-trust">当年の婚姻候補審査で使った実効信頼：{String(inputs.effectiveTrust)}
    （{trace.modifierIds.length ? '介入の補正を反映' : '適用された介入なし'}）</p>
}
