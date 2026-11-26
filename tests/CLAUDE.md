# tests
- `unit/` は Vitest、`e2e/` は Playwright（Chromium）。必須CIは短時間を目指すが、固定性能予算は未決定。速度を理由に必須検証を弱めない。
- テスト追加時は発見したい不具合と必要な層（unit・実経路・browser・Worker等）を選び、既存の重複を確認する。実計算やassertionを省略して速く見せない。
- seed数、年数、入力規模、ブラウザ起動、メモリと実行時間を見積もり、関連する通常経路・否定例・不変条件を検証する。長時間検証をローカルに分類する場合も必須CIの既存範囲を削らない。
- 時間や負荷の回帰は同条件の実測、shard別の偏りと失敗を確認し、原因・未測定範囲をPRに記録する。計測・分割・previewの条件は [`docs/contracts/ci-development-and-performance.md`](../docs/contracts/ci-development-and-performance.md) を参照。
- 長時間・多シード検証はローカル実行とし、PRにコミットSHA・コマンド・結果・ログ要約を記載する（`local-runs/` は gitignore、`docs/planning/local-run-template.md` 参照）。
- ローカル結果を CI の PASS として扱わない。
