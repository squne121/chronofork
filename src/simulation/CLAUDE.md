# src/simulation
- 純粋関数・決定的に保つ。React / DOM / `Date.now` / `Math.random` に依存しない（乱数はシード注入）。
- ゲームルールは `docs/spec/` の承認済み仕様にのみ従う。仕様に無い挙動を追加しない。
- 変更時は `tests/unit/` に対応テストを置く。
