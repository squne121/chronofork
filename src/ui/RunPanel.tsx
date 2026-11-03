import type { TimelineResult } from '../simulation/engine/index.ts'
import { goalStatusLabel } from './timeline-source.ts'
import type { RunInputs } from './timeline-source.ts'

type Props = Readonly<{
  inputs: RunInputs
  result: TimelineResult
  seedText: string
  onSeedText: (v: string) => void
  onRerun: () => void
}>

/** 試験計算の入力・版・状態・網羅状況。正式な歴史・勝敗が未成立であることを常に示す。 */
export function RunPanel({ inputs, result, seedText, onSeedText, onRerun }: Props) {
  const halt = result.halt
  const seedValid = /^\d+$/.test(seedText.trim()) && Number.isSafeInteger(Number(seedText.trim()))
  return (
    <section aria-labelledby="run-heading" className="panel" data-testid="run-panel">
      <h2 id="run-heading">試験計算（CALIBRATION_ONLY・partial）</h2>
      <p className="note">
        {inputs.evaluatedRuleIds.length===1 ? '人口コホート（RULE-C-004）のみを試験係数で計算した結果です。' : '人口・人物・法制の試験用評価器を明示注入した計算結果です。'}正式なゲーム規則による歴史ではありません。
      </p>
      <dl>
        <dt>計算状態</dt>
        <dd data-testid="run-status">
          {result.status === 'COMPLETED' ? `完了（${result.transitions}年分を計算）` : `HALTED（停止・${result.transitions}年分まで確定）`}
        </dd>
        <dt>入力</dt>
        <dd data-testid="run-inputs">
          シナリオ {inputs.scenarioId} / seed {inputs.seed} / ruleset {inputs.rulesetVersion} / rng {inputs.rngVersion} / 評価器{' '}
          {inputs.evaluatedRuleIds.join('、')}
        </dd>
        <dt>自律歴史</dt>
        <dd data-testid="autonomous-history">
          {result.autonomousHistory.status}（{result.autonomousHistory.blockers.join('、') || '阻害要因なし'}）
        </dd>
        <dt>未実装ルール</dt>
        <dd data-testid="todo-rules">
          TODO {result.coverage.todoRuleIds.length}件 / 実行済み {result.coverage.executedRuleIds.join('、') || 'なし'}
          {result.coverage.injectedTodoRuleIds.length > 0 && '（試験注入であり実装済みを意味しません）'}
        </dd>
        <dt>1350年の勝敗</dt>
        <dd data-testid="goal-status">{goalStatusLabel(result)}</dd>
        {result.technicalGoal !== null && (
          <>
            <dt>technicalGoal</dt>
            <dd data-testid="technical-goal">非権威の技術検証値です。勝敗としては扱いません。</dd>
          </>
        )}
      </dl>
      {halt && (
        <div role="alert" className="halt" data-testid="halt-diagnostic">
          <p>
            <strong>計算が停止しました（ゲーム内の敗北ではなく、データまたは技術上の停止です）</strong>
          </p>
          <dl>
            <dt>停止コード</dt>
            <dd>{halt.code}</dd>
            <dt>年・フェーズ・ルール</dt>
            <dd>
              {halt.year}年 / {halt.phase ?? '—'} / {halt.ruleId ?? '—'}
            </dd>
            <dt>原因</dt>
            <dd>{halt.message}</dd>
            {(halt.diagnostics.length > 0 || halt.evaluatorDiagnostics.length > 0) && (
              <>
                <dt>診断</dt>
                <dd>
                  <ul>
                    {halt.evaluatorDiagnostics.map((d, i) => (
                      <li key={`e${i}`}>
                        {d.code}: {d.message}
                      </li>
                    ))}
                    {halt.diagnostics.map((d, i) => (
                      <li key={`d${i}`}>
                        {d.code}: {d.message}
                      </li>
                    ))}
                  </ul>
                </dd>
              </>
            )}
          </dl>
        </div>
      )}
      <form
        className="filters"
        onSubmit={(e) => {
          e.preventDefault()
          if (seedValid) onRerun()
        }}
      >
        <label>
          seed{' '}
          <input
            type="text"
            inputMode="numeric"
            value={seedText}
            onChange={(e) => onSeedText(e.target.value)}
            aria-invalid={!seedValid}
            data-testid="seed-input"
          />
        </label>
        <button type="submit" disabled={!seedValid} data-testid="rerun">
          試験計算をやり直す
        </button>
        {!seedValid && <span className="missing">seed は 0 以上の安全な整数で入力してください</span>}
      </form>
    </section>
  )
}
