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

## 試遊（experimental）

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
