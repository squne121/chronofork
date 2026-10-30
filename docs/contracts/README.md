# 実装契約

実装のための技術契約。ゲーム規則を追加・変更しない（規則は [`docs/spec/`](../spec/README.md) が正本）。技術判断は Claude Code に委任済み（DEC-038）で、型・DTO 名は改善してよいが、意味と書込責任は変えない。

| ファイル | 内容 |
|---|---|
| [mvp-implementation-contract.md](mvp-implementation-contract.md) | 型、書込 owner、原子性、台帳、人口/人物、法制/Goal、年次境界、乱数/介入/保存、37 RuleID |
| [first-vertical-slice.md](first-vertical-slice.md) | 最初のプレイアブル縦断経路の実装順と完了条件 |
