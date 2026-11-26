# CI開発・性能計測の契約

Issue #185 で採用されたCI高速化と引継ぎの技術方針。ゲーム規則を変更しない。実装・適用状況や実測値は当該Issue、PR、Actions runを参照し、本書の目標構成を実測済みの事実と混同しない。実際のジョブ名・条件・コマンドは対象commitの `.github/workflows/ci.yml` を確認する。

## Phase 1の構成と必須チェック

- 静的検査（decision register、型、lint、build等）、Vitest、通常E2E、配信用buildと実Worker検証を独立して並列化し、`quick-check` が必要な結果を集約する。Vitest は2分割とする。候補比較の少数サンプルでは分割を増やした効果が安定して確認できず runner 使用量も増えるため、必要に応じて同一条件の実測で再評価する。測定値と未計測項目はPRに残す。
- `quick-check` は従来と同じ必須検証の成功を意味し、static・unit・e2e の failure、cancelled、skipped、未実行を成功にしない。worker は PR で success 必須、main push ではジョブ自体を実行せず skipped のみ許容する。他イベント・ref や予期しない結果は失敗とする。fork、Dependabotの従来条件を維持し、branch保護の変更に頼らない。集約 shell の反例は `python3 -IB scripts/test_quick_check.py` で検証する。
- 各ジョブに必要なcheckout・依存・cacheを用意し、read-only権限とconcurrencyを維持する。検査、assertion、実計算や既存skip条件を速度のために削らない。全Vitest対象が各run全体で欠落・重複なく実行されたことを実行結果から確認する。ファイル一覧コマンドだけをshard割当の証拠にしない。
- ローカルの `npm run check` は基準の全テストを実行するが、CIの集約結果の代用ではない。ブラウザ、Worker、preview安全性fixtureもそれぞれ検証し、意図的な失敗が集約の失敗になることを確認する。

## Phase 2の依存準備

- PR CIのPlaywright準備は、OS依存とbrowser binaryを別stepで実行する。どちらもChromium用の公式CLIを使い、OSのフォント・ライブラリやcold cache時のbrowser取得を省略しない。分離は遅延・失敗箇所の可視化であり、それ自体を高速化とみなさない。
- 依存の正本は引き続きnpm lockfileとし、auditを含む `npm ci` を使う。`--prefer-offline` はCI比較で短時間だった一方、auditの報告内容に差が観測され、同等性・最新性を確認できなかったため採用しない。原因は未確定。pnpm・Bunへの移行も、audit・lifecycle・解決内容の同等性と運用負担の検証が不足しているため行わない。実測と未検証項目はIssue #189とPR #191を参照する。
- Playwright公式Dockerイメージやrunner OS固定は、取得・運用・既存検証との互換性を含む有効性を確認できておらず、採用しない。OS依存準備が失敗した場合はbrowser準備・後続テストを成功扱いしない。

## PR previewの信頼境界

previewは必須チェックと別の公開判断。対象runの全必須検証が成功し、実Workerで検証した成果物だけを公開候補とする。package/uploadの失敗やartifact欠落は公開不可だが、従来どおり必須検証の失敗とは区別する。workflow変更PR自身を拒否する既存の安全策を迂回しない。

CIのjob・ready stepを変えるときは `scripts/preview/source.py`、`github_preview.py` とそのテストを一緒に確認する。run ID・attempt・head/base/merge SHA、信頼済みmainのworkflow blob、artifact名・ID・digestを同一対象に結び付ける。古いattempt、部分rerun、失敗・cancel・skipped、未完了、artifact欠落・誤結合などを反例で検証する。公開設定、secret、権限の拡張はこの方針の対象外。

## 再現可能な計測と比較

1. baselineと変更後のcommit、workflow差分、source tree、Node/依存lockfile、runner OS/種別、イベント・対象ブランチ、shard数とコマンドを記録する。CI構成だけを比較する場合は同一source treeを使い、workflow以外の差を混ぜない。GitHub上で同一条件を実現できなければ差と制約を明記し、同等比較とは主張しない。
2. GitHub Actionsのrun ID/attempt、各job・stepの開始/終了、run全体のwall-clockとqueue、cache hit/miss、各shardのテスト件数・skip・失敗、取得できるピークメモリを標準ログやstep summaryから記録する。cacheキーと温/冷の区別も残す。取得できない値は未計測とする。計測のための全PRへの追加負荷は最小限にし、観測値を合否に直結しない。
3. 同条件で複数runを集め、温/冷cache、runner、queue、失敗やrerunを区別する。比較対象の選択と除外理由、サンプル数、中央値とP90を併記する。少数サンプルの数値を改善の保証としない。実測、残るボトルネックと次工程、未完の比較はIssue/PRに記録し、未検証はUNVERIFIEDとする。
4. PRではcommit/run ID、実行コマンドとexit code、各検証の結果、件数と欠落・重複確認、cache条件を示す。最終HEADのGitHub `quick-check` と独立レビューを別途確認し、未実行・失敗・ローカル結果をCI PASSにしない。

## テスト追加・レビュー

必要な振る舞いと否定例を最小の適切な層で検証し、実経路や境界をunitのモックだけで代用しない。seed・年数・入力規模・worker数・ブラウザ起動とメモリの負荷を見積もり、関連する不変条件・回帰テストを実行する。長時間・多seedの検証は `tests/CLAUDE.md` に従って記録するが、既存の必須範囲を縮小しない。レビューでは検証対象の維持、shardの網羅性、集約失敗時、previewの信頼境界、測定条件と未検証事項を確認する。

## 次工程と未決事項

Phase 1の実測を踏まえ、Phase 2のinstall、Phase 3のsimulation profile、Phase 4のcompiler/lint比較を費用対効果と維持負担に応じて検討する。Phase 2以降のpackage manager・lockfile・TypeScript・ESLint変更をPhase 1の前提にしない。

恒久的な性能予算、警告・起動閾値と、決定論的な観測・トリガーからセマンティックな原因分析・実装・レビューへの自動改善ループは未決定。過去の120/90/180秒は参考値であり、完了条件や自動警告の閾値ではない。定期監視、Issue自動作成、自律改善、新規サービス・有料runner・secret/権限追加は今回実装しない。性能だけの外乱でPRをブロックしない。
