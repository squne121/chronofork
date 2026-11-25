# 編纂机の実履歴参照（#154、現行 v0）

この層は公開済みの実計算結果を読むだけです。画面配置、操作仕様、既定構成、Goal、評価器、Worker のキャッシュ方針は変更しません。

| 利用先 | 入口 | 読める内容 |
| --- | --- | --- |
| UI-B：年代記・世界図 | `historyFromObservation(slice).at(year)` | `workerPlayRunner.observe` が返した A0 の選択年。`start.world` の実地域・人口・人物・称号と、`records` の同年の Event/Trace。再生・年移動で別年が必要なら同じ `observe` を使用し、受け取った年だけ表示する。 |
| UI-C：資料 | 観測アダプタの `personRecord(id)`、`titleHistories`、選択年の `person(id)` / `event(id)` / `trace(id)` | 前二者は既存 A0 全期間要約。選択年初の生死・保持者とは別枠。比較枝では `historyFromPlayView(view).personHistory(branch, id)` でその枝の当人の年初観測のみを取得できる。A0 要約を A1/A2 に流用しない。 |
| UI-D：比較 | `historyFromPlayView(view)?.at(branch, year)` / `.compare('A0_A1' \| 'A1_A2', year)` | `compareYear` を使い、両枝ラベル・年・構成来歴・転送範囲と同時に返す。A2 Worker 応答は単独で渡さず、既存の親比較に `second` として付ける。枝自身が持つ `playModifierIds` と同じ親介入・第2介入でなければ A2 を読めない。 |

`HistoryYear.ref` は `{ origin: { seed, configuration, branch, modifierIds }, year }`。`configuration` は同じブラウザビルド内の `mode` / `configId` / `configDigest` です。比較ビュースロットの `a0` / `a1` やエンジンの `branchId` だけを来歴として使わないでください。`PlayInput.year` は介入年であって閲覧年ではありません。対象はこの年・枝の参照に紐づけ、人物・Event・Trace を ID だけのグローバル索引で混ぜないでください。保存形式や異なるビルド間の同一性はこの参照の対象外です。Worker 側の完全な A0 キャッシュ照合は従来どおりです。比較の `changes` は既存 `compareYear` の出力で、`A0_ONLY` / `a0Only` は `before`、`A1_ONLY` / `a1Only` は `after` のスロットを指します。画面では `before.ref.origin.branch` / `after.ref.origin.branch` をラベルに使ってください。A1→A2 の `before` は A0→A1 の `after` と同じ実枝でも別の転送範囲を持つため、比較から資料を開く場合は元の参照を維持してください。

## 欠損と証拠の扱い

- `start: CONFIRMED` は年初です。年内の出生・死亡・婚姻などは `records: COMMITTED` から読み、その変化は翌年初に反映されます。1350 年初は `EVALUATION_ONLY`。停止年初が確定済みでも、その年のログは `HALTED` で、診断用 Trace を確定履歴に混ぜません。`UNCOMPUTED` と、別年の A0 スライスがまだ手元にない `NOT_LOADED` は別です。既存 Runner が `A0_HALTED` 等のエラーで返す場合は、失敗として表示し、部分スライスを補いません。
- `ALIVE` / `DEAD` は年初の `Person.alive`、`NOT_BORN` は同じ枝で出生年が確認できて年初にはまだいない場合です。出生年後に未登録等で見つからなければ `NOT_PRESENT`、全観測期間に実人物が現れなければ `ABSENT_FROM_BRANCH`、未完走で断定できなければ `UNKNOWN`。別枝の同じ ID を代用しません。
- `RECORDED` は渡された実 Event/Trace です。`NO_RECORD` は照会範囲でそのレコードを確認できないことだけを表し、関係値ゼロ・ルール不成立・因果なしを意味しません。種別/ルールが確かな場合は `event(id, eventType)` / `trace(id, ruleId)` に渡せます。
- `TRANSFER_OMISSION` は省略件数（新しい DTO は年別、旧 DTO は全期間）。照会が省略の範囲に当たる場合、個別 ID の不存在を断定できないため `POSSIBLY_OMITTED` とします。A0 は同一構成・seed・年の `observe` で完全な年内記録を読み直せます。A1/A2 に個別詳細を再取得する現行 Worker API はなく、省略分は未取得のままです。差分一覧が空でも、転送ビューが完全なログを含むとは表示しません。
- 年初 `WorldState` の基礎値と `DecisionTrace` の実評価は別の根拠です。限定試遊構成でのみ、下記の SIM 読取 API を使えます。通常 v0 では `UNSUPPORTED_CONFIGURATION` です。値や過去の Event/Trace を補いません。正式 `goal` と `technicalGoal` は別のままです。

## 非同期の採用

表示先ごとに `createLatestHistoryRequest()` を保持します。選択（年・構成・seed・枝・対象）の変更時に古い表示を外し、`invalidate()` または新しい `begin()` で旧要求を無効化します。同じ年へ戻っても要求の世代は別です。進捗の反映前も `isCurrent()` を確認してください。既存 Worker が処理中のときは同時発行せず、完了後に最新の要求だけを送ると、年送りのたびに `cancel()` で A0 を破棄せずに済みます。UI-A は発行順や再生を管理する新しい状態管理は追加しません。

```ts
const ticket = gate.begin()
const outcome = await workerPlayRunner.observe!(input).promise
if (outcome.kind === 'DONE' && outcome.result.ok) {
  ticket.commit(outcome.result.observation, slice => matchesObservation(input, slice), slice => {
    show(historyFromObservation(slice).at(input.year))
  })
}
```

失敗・キャンセルを表示する場合も同じ世代確認が必要です。比較結果の採用には `matchesPlayRequest(input, view)` を使えます（第2介入の Worker 応答は親ビューと合成してから照合）。

## 限定試遊入口（#165）

`limited-playtest.ts` の `createLimitedPlaytestSession()` を限定試遊への明示操作で一度だけ呼びます。通常入口のモード・seed・Worker は切り替えません。限定試遊は固定 seed `20260303`、drift `0`、1250〜1350 年の experimental / CALIBRATION_ONLY。A0/A1 のみです。`session.configuration` には SIM から計算した完全な `configIdentity` と、識別表示用の `configId` / `configDigest` が入ります。履歴照合とキャッシュは短い digest だけに頼りません。資料窓の要求照合には `sameHistoryYearRef(a, b)` を使ってください（既存窓への適用は画面統合時）。介入照合は実枝の `playLedger` を使います。

```ts
const session = createLimitedPlaytestSession()
const observed = await session.observe(selectedYear).promise
if (observed.kind === 'DONE' && observed.result.ok) {
  const slice = observed.result.observation
  const year = historyFromObservation(slice).at(selectedYear)
  const candidates = candidatesAtYear(slice.candidates, interventionYear)
  const basis = year.relationship(leftId, rightId)
  // 選択世代がまだ有効なら year / candidates / basis を表示する。
}
const compared = await session.compare(interventionYear, playerIntervention).promise
if (compared.kind === 'DONE' && compared.result.ok && 'view' in compared.result) {
  const comparison = historyFromPlayView(compared.result.view)?.compare('A0_A1', selectedYear)
  // 選択世代がまだ有効なら comparison を表示する。
}
// 退出・アンマウント時:
session.reset()
```

`playerIntervention` はプレイヤーの `{ firstPersonId, secondPersonId, signedDelta, durationYears }`。観測から得る候補は実 A0 の候補で、`observe` と `compare` は同じセッションで A0 を再利用します。ハンドルは `cancel` と `promise` を持ち、来歴不一致は `FAILED / HISTORY_MISMATCH`。表示では従来どおり最新要求の世代を別途照合してください。

`relationship(leftId, rightId)` の `YEAR_START_BASE` は、SIM の `RECORDED` / `DERIVED` / `UNKNOWN` とその根拠を返します。肯定結果の `throughYear` が基礎値の対象年で、閲覧年や当年の介入後の値ではありません。当年の実効値・採否は同じ枝・年の `records` と実 `trace` を参照します。関係値を読めても、Event/Trace に `TRANSFER_OMISSION` がないとは限りません。候補登録上限の `DEFER` は実 Trace の技術的な予算制約であり、世界内の法的理由には置き換えません。技術評価は正式勝利として表示しません。

開発者用の実 Worker 受入は `tests/unit/ui/desk-data/run-limited-browser.ts`（Vitest/標準 E2E には含めない）。専用ポートで `npm run dev -- --host 127.0.0.1 --port 5295 --strictPort`、別シェルで `node --experimental-strip-types tests/unit/ui/desk-data/run-limited-browser.ts http://127.0.0.1:5295 <工程2F証跡ディレクトリ>`。入力例は検証専用で、プレイヤーへの提示には使いません。
