# Project Chronofork

React + TypeScript + Vite によるゲーム開発リポジトリ。現在は開発基盤のみで、ゲーム機能は未実装です。
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

Node.js 22+で `npm run play:text -- --seed=1 --mode=FIXED_APPROVAL` を起動し、次のテキストコマンドで現在のGUIと同じexperimental試験世界を観測・操作できます。機械向けには `--json`（JSON Lines）を指定します。

```text
observe 1250 A0
inspect person person-exp-01 1250 A0
intervene 1260 person-exp-04 person-exp-05 20 5
compare 1261
debug 1260 A1 B-004
exit
```

`debug` は明示したときだけ内部Event/Trace等を出力します。ゲーム内の歴史や勝敗を新たに生成するものではありません。現段階は `CALIBRATION_ONLY` のA0/A1人物ペア信頼試験のみで、正式勝敗・A2以降の保存・全介入方式は未完成です。

採用した検証手段: Vitest + fast-check（短いプロパティ検査）、Playwright Test（回帰E2E）、Playwright CLI（探索用の `npm run play:ui -- --help`）。長時間多seed試験・AIのGUI試遊は通常CIとは分離します。詳細は `docs/contracts/text-playtest-interface.md`。

## 運用

- `main` へは PR 経由のみ（Squash merge）。必須チェックは `quick-check`（型検査・ESLint・Vitest・ビルド・Playwright smoke）。
- 長時間テストはローカル実行し、結果は `docs/planning/local-run-template.md` の形式で PR に記載します。
- 階層 `CLAUDE.md`（ルート / `src/*` / `tests`）でエージェント向け指示を管理します。
