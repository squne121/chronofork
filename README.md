# Project Chronofork

React + TypeScript + Vite によるゲーム開発リポジトリ。現在は試験用の試遊UI（experimental / CALIBRATION_ONLY）のみで、正式なゲーム機能・勝敗は未成立です。
承認済みMVP仕様は `docs/spec/`、実装契約は `docs/contracts/`、決定記録は `docs/decisions/` にあります。承認待ちの事項は `docs/spec/pending-approvals.md`。ライセンスは未設定です（権利の再利用条件は未決定）。

## 開発

```bash
npm ci
npm run dev        # 開発サーバー
npm run check      # 型検査 + ESLint + Vitest + ビルド
npx playwright install chromium   # 初回のみ
npm run test:e2e   # ビルド後に Playwright smoke
```

## テキスト操作・AIプレイテスト（試験版）

Node.js 22+で `npm run play:text -- --seed=1 --mode=FIXED_APPROVAL`（`ORDINARY_LAW`、`INTEGRATED_EXPERIMENTAL` も指定可）を起動し、次のテキストコマンドで現在のGUIと同じexperimental試験世界を観測・操作できます。機械向けには `--json`（JSON Lines）を指定します。

```text
observe 1250 A0
inspect person person-exp-01 1250 A0
intervene 1260 person-exp-04 person-exp-05 20 5
compare 1261
debug 1260 A1 B-004
exit
```

`intervene` の引数個数や整数構文の誤りで拒否した場合、既存履歴は変わりません。構文を通過した要求は、共有エンジンの検証・再計算に入る前に旧A1を含む比較結果と単独A0の参照を外します。以後に失敗するとA1参照・比較は `NO_BRANCH` になり、A0は次の参照時に同じseed・モードで再計算します。

統合モードは100年のA0/A1を計算するため数分・数GBを要します。GUIの表示用ビューは同一の高頻度Event/Traceを省略しますが、CLIは完全なEventLog・DecisionTraceを保持します。[#99](https://github.com/squne121/chronofork/issues/99) の過去の統合100年実測では、単回介入の最大RSSは約4.4GB、seed 20260101で複数回介入した際は約5.9GBでした。別の2GiB cgroup環境では、同seedの弱い単回介入がOOMで終了コード137（JSONL出力なし）でした。`--max-old-space-size=6144` はNodeの旧世代ヒープ上限で、プロセスRSSやcgroup上限ではありません。**利用可能なメモリが8GB以下の環境では、統合モードの反復介入を避け、短い動作確認には `FIXED_APPROVAL` を使ってください。** RAM・スワップ・cgroupの実効制限は別々に確認してください。参照を外しても即時のメモリ返却は保証されず、統合100年での変更前後のRSS比較は未検証（UNVERIFIED）です。

統合モードの実計算CLI検証（オプトイン・通常CI対象外）: `CHRONOFORK_LONG_INTEGRATED_TEXT=1 NODE_OPTIONS=--max-old-space-size=6144 npx vitest run tests/unit/text/integrated-mode-long.test.ts`

`debug` は明示したときだけ内部Event/Trace等を出力します。ゲーム内の歴史や勝敗を新たに生成するものではありません。現段階は `CALIBRATION_ONLY` のA0/A1人物ペア信頼試験のみで、正式勝敗・A2以降の保存・全介入方式は未完成です。

採用した検証手段: Vitest + fast-check（短いプロパティ検査）、Playwright Test（回帰E2E）、Playwright CLI（探索用の `npm run play:ui -- --help`）。長時間多seed試験・AIのGUI試遊は通常CIとは分離します。詳細は `docs/contracts/text-playtest-interface.md`。

## 試遊（experimental）

公開先（初回配信後）: https://squne121.github.io/chronofork/ 。画面の SHA は配信元コミットです。正式な勝敗は未成立です。

リポジトリ管理者は Settings → Pages → Build and deployment の Source を **GitHub Actions** に設定してください。main の `ci` の `quick-check` 成功後、同じ SHA の成果物をサブパスでブラウザ検証して配信し、公開 URL でも実Workerの操作を再検証します。Actions の `deploy-pages` の結果と失敗時の証跡を確認してください。公開設定・初回配信前の URL は未検証です。

`npm run dev` で起動し、ブラウザで表示されるURLを開きます（既定は http://localhost:5173/）。
「介入して歴史を比べる」の「法制を試す方式」から、旧2方式に加え **統合法制・世代継続（experimental）** を選べます。
入力欄にはPR #78 で実測したCALIBRATION_ONLYの例（seed 20260101・人物02/05・1250年・信頼-20・5年間）が入りますが、固定の歴史ではなく、変更した値で1250〜1350年のA0/A1を再計算します。100年分のため端末により1〜数分かかり、計算はWeb Workerで行うため画面は操作できます（キャンセル可）。

- 長時間検証（オプトイン・通常CI対象外）: `CHRONOFORK_LONG_INTEGRATED_UI=1 npx vitest run tests/unit/ui/integrated-mode-long.test.ts` / `CHRONOFORK_E2E_INTEGRATED=1 npx playwright test integrated-mode`（要 `npm run build`）
- 表示の省略（experimental試遊限定の技術的処置）: A0/A1で内容が完全に同一の高頻度記録（`PERSON_PAIR_TRUST_SET` Event と `B-009` DecisionTrace）だけを、メモリ保護のため画面転送・一覧表示から省略します。全件数と省略件数は画面に表示し、差分のある記録は全て残します。省略した個別詳細は現在のUIでは後から閲覧できません（正式版の履歴省略・保存・閲覧は未設計）。
- 残件: 正式Goal（`goal=null`）・未実装37ルール・本人試遊は未完了。

## 運用

- `main` へは PR 経由のみ（Squash merge）。必須チェックは `quick-check`（型検査・ESLint・Vitest・ビルド・Playwright smoke）。
- 長時間テストはローカル実行し、結果は `docs/planning/local-run-template.md` の形式で PR に記載します。
- 階層 `CLAUDE.md`（ルート / `src/*` / `tests`）でエージェント向け指示を管理します。
