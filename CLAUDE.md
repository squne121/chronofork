# Project Chronofork

- ゲーム仕様の正本は GitHub 内の承認済み仕様（`docs/spec/`、`docs/contracts/`、`docs/decisions/`）。会話の断片や推測で仕様を復元しない。
- ゲーム仕様の変更にはユーザー承認が必要。技術的な実装判断（構成・ライブラリ・テスト設計）は Claude Code に委任。
- ゲーム実装の際は、関連する仕様・契約の必要範囲を読む（目安: `docs/spec/mvp-spec.md`（規則）→ `docs/contracts/mvp-implementation-contract.md`・`first-vertical-slice.md`（技術契約・実装順））。すべての作業で全文書の読込は不要。`docs/spec/pending-approvals.md` は未承認で、実装の根拠にしない（根拠のない成功扱いをせず PENDING にする）。
- LICENSE は未設定。ユーザー承認なしに追加しない。

## ディレクトリの責務
- `src/simulation/` 純粋なシミュレーション（UI・DOM非依存）
- `src/scenario/` シナリオ定義・データ
- `src/ui/` React UI
- `tests/` unit（Vitest）/ e2e（Playwright）
- `docs/` 仕様・契約・決定記録・計画

## テスト
- `npm run check`（型検査・ESLint・Vitest・ビルド）、`npm run test:e2e`（Playwright smoke）
- PR必須チェックは CI の `quick-check`。main へは PR + Squash merge のみ。
- 未実行のテストや失敗を PASS と報告しない。
