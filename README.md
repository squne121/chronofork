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

- [PR #171](https://github.com/squne121/chronofork/pull/171) で、標準出力の書き込みが詰まったら `drain` を待ってから次の応答を生成するようにしました。[実測](https://github.com/squne121/chronofork/pull/171#issuecomment-7162493389)では `FIXED_APPROVAL`（seed 1）で `DEBUG` 64回、読み取りを3秒遅らせたとき、最大 `writableLength` は 5,775,424 → 90,241 bytes、待機中の追加書き込みは 63 → 0 回で、全64応答を維持しました。この値は出力バッファの指標で、RSSではありません。
- [PR #173](https://github.com/squne121/chronofork/pull/173) で、未計算のA0に対する無効年の `observe` / `inspect` / `debug` がA0計算を起動しなくなりました。`compare` もA1があれば、範囲外（1250〜1350年の外）や非整数の年を、Event/Traceを走査する前に `YEAR_UNAVAILABLE` として拒否します。A1がなければ従来どおり `NO_BRANCH` が優先されます。

統合モードの実計算CLI検証（オプトイン・通常CI対象外）: `CHRONOFORK_LONG_INTEGRATED_TEXT=1 NODE_OPTIONS=--max-old-space-size=6144 npx vitest run tests/unit/text/integrated-mode-long.test.ts`

`debug` は明示したときだけ内部Event/Trace等を出力します。ゲーム内の歴史や勝敗を新たに生成するものではありません。現段階は `CALIBRATION_ONLY` のA0/A1人物ペア信頼試験のみで、正式勝敗・A2以降の保存・全介入方式は未完成です。

採用した検証手段: Vitest + fast-check（短いプロパティ検査）、Playwright Test（回帰E2E）、Playwright CLI（探索用の `npm run play:ui -- --help`）。長時間多seed試験・AIのGUI試遊は通常CIとは分離します。詳細は `docs/contracts/text-playtest-interface.md`。

## 試遊（experimental）

公開先（初回配信後）: https://squne121.github.io/chronofork/ 。画面の SHA は配信元コミットです。正式な勝敗は未成立です。

リポジトリ管理者は Settings → Pages → Build and deployment の Source を **GitHub Actions** に設定してください。main の `ci` の `quick-check` 成功後、同じ SHA の成果物をサブパスでブラウザ検証して配信し、公開 URL でも実Workerの操作を再検証します。Actions の `deploy-pages` の結果と失敗時の証跡を確認してください。公開設定・初回配信前の URL は未検証です。

配信は最大100件の待機キューで直列化します。上限到達やGitHub側の障害・API失敗では配信されない場合があります。Actionsで現行main HEADのpush由来 `ci` を探し、適格な実行を再実行して `quick-check` の成功と新しい `deploy-pages` の完了を確認してください。該当runがなければ通常のPR経由でmainに変更を統合してCIを起動します。mainのHEAD照合とデプロイは原子的ではなく、配信中にmainが進む場合があります。無制限の配信保証はありません。

初回配信後は `deploy-pages` のbuild・deploy・smokeと失敗時の証跡を確認し、公開画面のSHAを現行mainおよび成功したCIのSHAと照合してください。公開URLで観測・介入・比較を実行し、ブラウザエラーとWorkerを確認します。例えば `PAGES_SMOKE_REQUIRED=1 PAGES_SMOKE_URL=https://squne121.github.io/chronofork/ PAGES_EXPECTED_SHA=<mainのフルSHA> npx playwright test tests/e2e/pages-deploy.spec.ts` で再検証できます。

`npm run dev` で起動し、ブラウザで表示されるURLを開きます（既定は http://localhost:5173/）。
「介入して歴史を比べる」の「法制を試す方式」から、旧2方式に加え **統合法制・世代継続（experimental）** を選べます。
入力欄にはPR #78 で実測したCALIBRATION_ONLYの例（seed 20260101・人物02/05・1250年・信頼-20・5年間）が入りますが、固定の歴史ではなく、変更した値で1250〜1350年のA0/A1を再計算します。100年分のため端末により1〜数分かかり、計算はWeb Workerで行うため画面は操作できます（キャンセル可）。

- 長時間検証（オプトイン・通常CI対象外）: `CHRONOFORK_LONG_INTEGRATED_UI=1 npx vitest run tests/unit/ui/integrated-mode-long.test.ts` / `CHRONOFORK_E2E_INTEGRATED=1 npx playwright test integrated-mode`（要 `npm run build`）
- 表示の省略（experimental試遊限定の技術的処置）: A0/A1で内容が完全に同一の高頻度記録（`PERSON_PAIR_TRUST_SET` Event と `B-009` DecisionTrace）だけを、メモリ保護のため画面転送・一覧表示から省略します。全件数と省略件数は画面に表示し、差分のある記録は全て残します。省略した個別詳細は現在のUIでは後から閲覧できません（正式版の履歴省略・保存・閲覧は未設計）。
- 残件: 正式Goal（`goal=null`）・未実装37ルール・本人試遊は未完了。

## PR 試遊（Phase 2、未有効化）

[#182](https://github.com/squne121/chronofork/issues/182) の PR CI は、従来の `/chronofork/` ビルドと実 Web Worker smoke が成功した後、対象 PR の同じ `dist` を GitHub Actions artifact に保存します。`preview-<run ID>-<attempt>` 内の manifest は PR 番号・head SHA・base SHA・実 build SHA を区別します。artifact ID と SHA-256 digest は GitHub 側のメタデータです。この時点では Cloudflare に公開されません。一般 Fork・Dependabot では梱包しません。対象 PR でも梱包・保存だけが失敗した場合は試遊用 artifact を利用不可として警告し、既存の `quick-check` の判定は変更しません。

公開・削除・通知・公開後 smoke の workflow がレビューされ、main に統合されるまでは、Cloudflare や GitHub に配信用の設定・secret を登録しないでください。以下はその後の管理者受入手順です。

1. Cloudflare の Workers Free を確認し、専用の既存 Worker `chronofork-pr-previews` を静的 asset 専用で 1 件用意します。`workers.dev` の Preview URL を有効にし、production では何も配信しません。サーバー側コード・bindings・Preview base config・custom domain・cron は設定しません。Workers の [Previews](https://developers.cloudflare.com/workers/previews/) を使い、通常の version preview や Cloudflare Pages は使いません。`workers.dev` の Preview URL は既定で公開されます。
2. Cloudflare の **Manage Account → Account API tokens** で [個別 Worker 限定の account-owned API token](https://developers.cloudflare.com/workers/authorization/workers/) を作成します。まず対象 Worker だけの **Editor** を候補とし、Preview の作成・更新・削除が可能か実アカウントで確認します。拒否された場合は停止し、無断で対象・ロール・課金を拡大しません。固定版 Wrangler には親 Worker 不在時の作成経路があるため、Worker を作成できない token と既存 Worker の事前確認を必須にします。
3. GitHub **Settings → Environments** で `chronofork-pr-preview` を作り、deployment branches を **Selected branches and tags** の `main` ブランチだけに限定します。Environment の Variables に `CLOUDFLARE_ACCOUNT_ID`（32 桁の account ID）と `CLOUDFLARE_WORKERS_SUBDOMAIN`（`<subdomain>.workers.dev` の `<subdomain>` 部分）、Environment の Secrets に `CLOUDFLARE_PREVIEW_TOKEN` を登録します。repository-wide secret には置きません。公開 URL を検証する smoke job に token は渡りません。最後にリポジトリの Actions Variable `PR_PREVIEW_ENABLED` を `1` にして有効化します。未設定または無効時は公開・削除せず、管理コメントに未設定と表示します。
4. 本体 PR の作成・更新・閉鎖、承認 Bot Fork と別 PR の並列・異なる host、並びに失敗 CI・未承認 Fork・古い HEAD・閉鎖/再開・不正 artifact・未設定の否定ケースを段階受入します。固定 URL と deployment 固有 URL、表示 SHA、Web Worker の観測・介入・比較、閉鎖後の削除、main の GitHub Pages に影響がないことを確認します。fixture と実サービスの結果は別に記録し、実機受入完了まで Issue を閉じません。

Preview 名は `pr-<番号>` です。同じ PR の公開・削除・smoke・通知は同じ排他で実行し、PR ごとの管理コメントを更新します。閉鎖時や、管理対象だった PR の base を `main` 以外へ変更した場合は、その PR の Preview だけを削除対象にします。`verified` 相当の PASS は、固定 URL と deployment 固有 URL の両方で smoke が成功し、通知直前も同じ HEAD・CI attempt・成果物を確認できた場合に限ります。CI が新しい main との merge ref に追随していない場合、または再開前（同一秒を含む）の CI しかない場合は、新しい CI が必要です。旧 Preview の URL に以前の build が残ることはあるため、画面 SHA と最新の管理コメントを確認してください。

Free の上限は Worker あたり 100 Preview で、上限に達すると最も長く再配信されていない Preview が削除されます。GitHub の同一 PR の待機上限も 100 件です。GitHub API・キューや Cloudflare の伝播・障害では、コメントと URL が直ちに追随する保証はありません。GitHub の状態照合と Cloudflare の更新は原子的ではなく、更新中に PR が進んだ場合は成功を通知せず、後続イベントの照合に委ねます。失敗した公開は現行 HEAD の `ci` 全体を再実行し、`quick-check` と新しい artifact の成功を確認してください。再開直後に新しい run がない場合は、その PR を更新して新しい CI を起動します。閉鎖時の cleanup に失敗した場合は該当する `pr-preview` の閉鎖イベントを再実行し、対象 `pr-N` だけの削除結果を確認してください。定期実行はありません。

## 運用

- `main` へは PR 経由のみ（Squash merge）。必須チェックは `quick-check`（型検査・ESLint・Vitest・ビルド・Playwright smoke）。
- 長時間テストはローカル実行し、結果は `docs/planning/local-run-template.md` の形式で PR に記載します。
- 階層 `CLAUDE.md`（ルート / `src/*` / `tests`）でエージェント向け指示を管理します。

<!-- Issue #182: disposable preview UAT, revision 2; initial enabled deployment; not for merge. -->
