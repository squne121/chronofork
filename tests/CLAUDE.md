# tests
- `unit/` は Vitest、`e2e/` は Playwright（Chromium）。必須CIは短時間（目標1〜3分）のものだけ。
- 長時間・多シード検証はローカル実行とし、PRにコミットSHA・コマンド・結果・ログ要約を記載する（`local-runs/` は gitignore、`docs/planning/local-run-template.md` 参照）。
- ローカル結果を CI の PASS として扱わない。
