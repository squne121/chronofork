# Chronofork テキストゲーム I/O・AIプレイテストの技術契約（初期実装）

状態: DEC-065/066に基づく**技術設計**。ゲーム仕様は `docs/spec/mvp-spec.md` が優先する。
適用範囲: MVP『亡国の王冠』。最初の実装は `EXPERIMENTAL / CALIBRATION_ONLY` のA0/A1試験経路だけを扱う。
Playwright CLIによるAIのGUI試遊、正式Goal公開、正式シナリオデータは今回の実装完了条件ではない。

## 原則

- **一つのゲーム計算**: テキストCLIとReact GUIは同じ `runTimeline`・`forkHistory`・世界/法制/介入契約に接続する。テキスト専用のシミュレーション・勝敗・分岐規則を複製しない。
- **情報区分**: `PLAYER` は観測年の実WorldStateと、公開可能な実Event/Traceの参照。デバッグにしか使わない校正値、内部判定候補、技術Goal、乱数値、スタック情報は明示的な `DEBUG` 操作に限る。試験中のUIが一部を折りたたみ表示していることは正式な公開規則の決定ではない。
- **証拠の出典**: `RuleID`、`EventLog`、`DecisionTrace`を読み取り専用で再利用。テキスト説明から独自の歴史事実や法的証拠を作らない。差分だけで原因を断定しない。
- **再現**: AIの提案した操作は数値介入の既存バリデータを通す。seed、実行コードのコミット、scenario/ruleset/legal/rngの版、入力操作列、結果ステータスを保存し、AIなしで再実行する。AIへの文脈供給は年度・主体・RuleIDごとの段階的取得を原則とする。
- **分業**: AIは仮説・調査・反例生成を担当できるが、固定アサーション・勝敗条件を修正しない。修正と独立検証を別担当にし、失敗のスキップ・期待値の緩和を禁止する。

## 現段階の接続と実装範囲

`src/text/game.ts` は `src/ui/branch-play-source.ts` の既存A0/A1実験経路と `src/ui/timeline-source.ts` の型を再利用する**暫定アダプタ**。最終的には両UIが利用するゲームアプリケーションサービスへ移すが、現時点で未整備の複数枝や全介入項目を完成扱いしない。

`npm run play:text -- --seed=1 --mode=FIXED_APPROVAL` でNode 22+のテキストセッション（Node専用エントリポイントは\`scripts/text-game.ts\`）を開始する。

| 入力 | プレイヤー／検証上の機能 |
|---|---|
| `observe 1250 A0` | 同一の試験A0を計算し、1250年初の国・地域・集団・人物・Titleと当年Eventを観測 |
| `inspect person person-exp-01 1250 A0` | 選択年の実人物などを調査。EventとTraceもIDで参照 |
| `intervene 1260 person-exp-04 person-exp-05 20 5` | GUIと同じ試験用「人物ペア信頼の補正」→A1を1350年まで再計算 |
| `compare 1261` | 実計算に基づく両史の変化と、共通のTrace対応付け結果を参照 |
| `debug 1260 A1 B-004` | 指定年・RuleIDの内部Trace/Event/実行状態を明示的に取得 |
| `help` / `exit` | 利用案内／終了 |

### 起動モード

`--mode=` は `FIXED_APPROVAL`（既定）／`ORDINARY_LAW`／`INTEGRATED_EXPERIMENTAL`。それ以外は起動時に拒否し非ゼロ終了する。

`INTEGRATED_EXPERIMENTAL` は mainの `createExperimentalIntegratedTimelineOptions` / `createExperimentalIntegratedEvaluators` を再利用する（`--seed` は実行のseedとして上書きする）。A0単独実行（`observe` 等）と `intervene` 内のA0は同じ `prepareRoot`/`runRootTimeline` を通り、完全に一致する。A1は同じ初期世界の介入年初のWorldStateと、許可された介入だけを加えた台帳で `forkHistory` により再計算する。`technicalGoal` は正式Goalではなく、PLAYERには出さずDEBUGのみ。例: `npm run play:text -- --mode=INTEGRATED_EXPERIMENTAL --seed=20260101 --json`。

### メモリと表示の違い（GUIとCLI）

- GUI（PR #91）はWorkerから画面へ転送する**表示用ビュー**で、A0/A1で内容が完全に同一の高頻度記録（`PERSON_PAIR_TRUST_SET` Eventと`B-009` DecisionTrace）を省略する。省略件数は表示され、省略した個別詳細は現UIでは閲覧できない。
- CLIは省略せず、**完全なEventLog・DecisionTraceを保持**する（`debug`はその実データを返す）。これは「省略データが消失した」という意味ではなく、表示ビューの技術的処置の違いである。勝敗や因果関係の根拠にはしない。
- 統合100年のA0＋A1は完全保持のためメモリが大きい（実測: 1セッションの最大RSSは約4.4GB）。`npm run play:text` はNodeのヒープ上限を `--max-old-space-size=6144` で引き上げて起動する。メモリの少ない環境では不足しうる。`intervene` 実行時は先に単独A0を解放する。計算は1セッション内で、A0単独約1分、`intervene`はA0再計算を含め約1分以上かかる（環境依存）。

標準はテキスト形式、`--json`は機械向けJSON Lines出力。単一プロセス内でA0/A1結果を保持するが、永続セーブ・A2以降・独立した実験ノート保存は未実装。AIが観測・仮説・予測・試行・棄却・未解決を保持する実験ノートは後続のテスト基盤側の責務とし、ゲーム内部の`DecisionTrace`に混ぜない。

**注意:** 初期実装の`inspect`などが開発UIで既に閲覧できる情報を反映していても、それは最終的なプレイヤー情報公開範囲の採用ではない。正式実装では可視性の単一契約を定め、GUI/テキストの情報差異を検証する。

## 検証・段階導入

1. **短い回帰テスト（必須CI）**: PLAYERとDEBUGの分離、同一WorldStateからの投影、未計算年の拒否、介入前のA1拒否。既存Vitest/Playwright Testは維持。
2. **fast-check**（devDependency追加済み）: 初回は101年初の実snapshotに対してPLAYER/DEBUG分離とEvent参照のプロパティテストを実装。後続では合法な操作列と不正入力を生成し、不変条件・決定的再実行・失敗の縮小と再生を検査。テストの合否基準をAIが変更しない。
3. **Playwright CLI**（採用、\`npm run play:ui -- --help\`の入口を追加）: 既存Playwrightへ委譲し、AIがGUIを探索して発見した不具合は固定Playwright Testに移す。実ブラウザでの試遊は未検証。AIのGUI試遊の正式評価方法は保留。
4. **長時間ローカル試験**: 100年統合・多seed・AIによる探索は必須quick-checkから分離し、コミットと条件に紐付く証跡を残す。人間が面白さを最終評価する（DEC-018）。

正式Goal、未承認GAME-01〜05、試験用法令・係数の正式昇格、MVPの勝利・介入・年次処理は一切変更しない。
