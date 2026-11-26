# 実験記録（比較判定保留）

## C3 fresh 引継ぎ（検査範囲で PASS）

- 元の会話を引き継がない担当が `32219b850e52c6adbd208e2ae2f885b82cfa5fb8` の保存済みソースから一時コピーで再生成し、異なる街区配置と3D方向の橋、`tiered` を含む30棟を表示。`west-1` の高さと色を局所変更した。`c3-handoff.txt`、`c3-results.json`、`c3-final-results.json`、`c3-final-extra-results.json` に実行と検査の詳細、失敗した先行試行も保存。
- 独立静的レビューは実施済みの対象・対象外保持、入力色、240本の実ヒット断面、配信GLB hash、および同一カメラ画像の範囲で PASS を支持。画像は `c3-final-alternate.png` / `c3-final-after.png`。ユーザーによる確認は未実施。
- production build の出力ではなく一時コピーの Vite dev で表示。変換済みBソースの配信元の暗号学的完全証明は未実施。橋と台地の OBB 交差は確認したが、歩行可能性や面一は未証明。外部負荷の非競合、effort の一致、全面形状の厳密同値、人間評価は UNVERIFIED。`.blend` hash の差の原因は未調査。詳細と測定上の制約は引継ぎ記録参照。

## C2 段付き形状（2026-11-20、検査範囲で PASS）

- C0 固定 `9665c577cabc2a4aa244bc6463ea1cfbc7e06c10` 後の 10:50:16 JST に課題を選定、C1 基準 `c33307ab58492fa60aa46263b6e809c4bf87ca87`、共通型・課題 `92be955a6716eead5e35c232fdc023840a15feae`。仕様・選定理由は `C2-TASK.md`。C0 担当へ事前開示していない。
- A は別 worktree で 10:51:38.149 JST に受領を記録、10:53:44.728 に実装・単体検査終了。Blender 生成 10:52:52.801〜10:52:53.360、tiered の生成と単体検査に成功。内部で Edit パラメータ誤り1回（ファイル変更なし）。block/taper GLB は hash 不変、`tiered.glb` と `parts.blend` を再出力。初回提出後の差戻し・統合検査結果は別途記録。
- B は別 worktree で 10:54:28 JST に受領を記録、10:56:13.408 に実装・単体検査終了。初回生成・検査 10:55:55.356〜10:55:55.622、既存 block/taper の生成データ保持と tiered の形状検査に成功。npm ci は 10:54:53〜10:54:58、環境導入として制作と分離。内部修正・失敗なし。
- A/B とも実効モデルは環境表示 `gpt-6.1-terra`、effort は未確認。受領時刻は担当の最初の観測で、正確な委任時刻ではない。担当作業は直列。初回制作時間の内訳や外部競合の完全な不在は未確認。共通型・検査・統合費用は経路固有時間へ加算しない。
- 11:02 JST の統合物 hash は `tiered.glb` `daf3a711e4f38f210a1fcdac4ad41bfdf5b2f3e8c99c86b24a0c460214f69e9e`、`parts.blend` `5ed8439c0392cda68062c5d8a05f5e9061f399036d36a20d738c4d9418608b87`。A生成器・Bソースの hash は `C2-BENCHMARK.md` 参照。既存 block/taper の GLB hash は C0 と一致。
- C2 の再実行は非競合を依頼し、A→B / B→A / A→B の順で各3回。A の Blender 起動・3 GLB と .blend 出力は 0.517426 / 0.463380 / 0.470276 秒、B の Node 起動・3形状生成と JSON 出力は 0.076350 / 0.060946 / 0.065534 秒。処理範囲・出力が異なるため単純な順位付けはできない。GLB は3回同一 hash、.blend は3回目に変化し原因未調査。詳細と時刻は `C2-BENCHMARK.md`。
- 統合時に差分転送で一度 `No valid patches in input` が発生し、raw diff で再適用した。共通統合の障害であり各経路固有の失敗ではない。実験 build と `inspect-c2.mjs` は成功（A/B両方の実体・断面・対象外保持、`c2-results.json`、同一カメラ `c2-before.png` / `c2-after.png`）。独立レビューでは自動検査が穴・反転を見逃す可能性と、実行時点の成果物 hash 紐付け不足を指摘。面の辺整合・向き・体積を補強し、穴・反転 fixture 4件と実ブラウザ検査は成功。最新の結果・画像は `c2-artifacts-N6bMQk/`（それ以前の画像・JSONは途中実行）。統合worktree を root とした Vite `http://127.0.0.1:5191/` で 11:10:02〜11:10:04 JST に実行し、配信された3 GLB の SHA-256 がローカル生成物と一致。検査はカメラのA/B状態と検査前後のソース・生成物hashおよびHEADを記録し、失敗・未検査とも0。独立再レビューは検査範囲での PASS を支持し、配信物の同一性は上記の追加確認で補った。対象外保持は C2 画面内の変更前後であり、C1版からC2版への実体保持を直接証明しない。人間の確認は未実施。

## C1 通常更新（2026-11-20）

- 基準 `9665c577cabc2a4aa244bc6463ea1cfbc7e06c10`。担当開始 10:30:46 JST、計測 10:42:41.815〜10:42:47.035 JST、拡張検査 10:48:01〜10:48:05 JST。初回提出後の独立レビューから検査不足とAのみの画像を指摘され、差戻し1回として検査追加と両画面画像に修正。独立再レビューで同一入力再適用時のscene全体、対象の変換検査の不足を指摘され差戻し2回目、検査を拡張。root lintで未定義globalsの指摘を受け修正。観測した他の実行障害 0、人間への問い合わせ 0。独立再レビューで色・寸法変更、同一入力再適用、ブラウザ再構築の自動検査範囲の PASS を支持。計測不足や人間評価、最終HEADレビューは別途未検証。
- **PASS（自動検査の範囲）**：C0入力それぞれから center の10棟の所属色のみ `#49a460`、または高さ1.3倍・幅1.2倍を共通 `setCity` でA/Bに適用。画面で実在する名前付き object・mesh の参照、geometry参照と属性/index、world transform、material参照とJSON、名前/IDを対象外について検査し、同一入力再適用では対象を含めて検査。対象の色・幅・高さも期待値と照合、エラー0。追加検査 `node inspect-c1-expanded.mjs` は名前なしを含むscene全体（A 68、B 38 object）の個数・順序・参照・IDと対象外のtransform/geometry/materialを検査し、対象の配置・奥行・kind・mesh有無・geometry保持も確認（地形・橋も含む）。同一入力再適用の前後にもscene全体の同一性・変換・材質を検査。色のみ変更では対象world matrix、寸法変更では対象root回転と子local transformを検査、エラー0。全材質の内部GPU状態は検査範囲外。
- カメラ position `[28,32,36]`、target `[0,1,0]`、zoom 1。画面画像 `c1-color.png` / `c1-dimensions.png`。人間の画像確認・好み・確認所要時間は UNVERIFIED。ブラウザ環境の日本語フォント欠落は既知。
- `node inspect-c1.mjs`（サーバー 5189 が必要）で再実行。`c1-results.json` は最終実行の観測値。warm状態の再計測4回、順序 A→B / B→A / A→B / B→A。真の初回は並行buildとの競合の有無が不明で比較不能。ブラウザ実験自身の `setCity` と renderer を使用。共通APIの色変更総時間は 14.1 / 10.4 / 7.4 / 4.4 ms、寸法は 10.2 / 8.6 / 7.1 / 9.4 ms。各経路の同期 `renderer.render` 呼出し合計と回数はJSON参照（各31回）。GPU完了時間や経路別更新総時間ではなく、生成器の初回制作費・人間負担の比較にも使えない。先行計測は並行担当のbuildとの重複の有無が不明のため比較から除外。担当者にbuild終了・生成描画停止を確認して最終計測をやり直した（他の外部プロセス全体の不在は保証できない）。実験build PASS、サイズ警告あり。
- 更新は既存GLBを読み込んだ画面内で実施。別途、一時ディレクトリにソースを複写してBlenderを新規プロセス実行し、再生成GLBのSHA-256が基準の両GLBと一致（block `a0c143a6d89388a4b257cfdb8f4d39cc5a9530797deb0ee135642721bf887df7`、taper `7671d77822dc839b567d8fdcfd2cce0eb94382a8eef0f0c675bec75acbfff701`、終了コード0）。基準GLB/blendは上書きしていない。別ブラウザ2プロセスで同一入力から再構築した全scene構造値はA/Bとも一致、保存データは `c1-regeneration-0.json` / `c1-regeneration-1.json`、hashは `c1-expanded-results.json`。Blender再生成結果の独立検証は UNVERIFIED。新規再生成の経路別時間・同一入力再適用時間・AI作業時間・トークン・GPU情報は未計測。実効モデルは実行環境表示で `gpt-6.1-terra`、effort は確認手段がなく UNVERIFIED。C2/C3・最終判定・root check/e2e・CIはこのC1担当では未実施。

## 2026-11-20 実 Blender 起動・生成（C0 基準）

- C0: **PASS**（限定された共通契約の最低品質）。独立担当が 10:27:10〜10:29:25 JST に実画面・全60棟の三角形辺の共有回数・外形・体積と橋の接触を確認。閉鎖性の厳密な証明ではなく、橋接触は手動判断。後から保存した検査と結果の適用範囲は `C0-REVIEW.md` を参照。橋端に最大約 0.212 都市単位の段差があるが、契約は面一を求めていない。`c0-independent-bridge.png` は橋の拡大画像。文字のフォント欠落は残る。C1〜C3 と人間の評価を意味しない。


- 追加承認後、Ubuntu noble の `libsm6` / `libice6` を公式パッケージから取得。APT metadata の SHA-256 とそれぞれ `1d27ebc381b499075a28c504be4d7d424c63b6866354736ac7f8d25813860cdf`、`ad1edb5303574fee154e487947177e5bd15363aa71b92f78f5a2a7145fdb81c5` の一致を確認してユーザーローカル `/home/squne/.local/opt/chronofork-blender-libs.GxcyFo8m` に展開。システムへインストールしていない。
- `LD_LIBRARY_PATH` を上記の `usr/lib/x86_64-linux-gnu` に指定して実行した `--version` は Blender 5.2.4 LTS、build hash `cd5dc428cce1` を表示。10:26:19 JST に `--background --python route-a/generate.py` を開始し、終了コード 0、壁時計 1.84 秒。これは環境導入でも初期制作時間でもない。
- 初回生成 hash: `block.glb` = `a0c143a6d89388a4b257cfdb8f4d39cc5a9530797deb0ee135642721bf887df7`、`taper.glb` = `7671d77822dc839b567d8fdcfd2cce0eb94382a8eef0f0c675bec75acbfff701`、`parts.blend` = `41d58c9d19a2821d4e7c1cc37889d4c6792f66680276e479aad92ebc8cd84356`。
- 基準・別配置の A/B 共通ブラウザ実体検査は checked 4、failures 0、pending 0。独立担当による基準画面の画像 `c0-independent-comparison.png` は同一カメラ `[28,32,36]`、target `[0,1,0]`、zoom 1 で取得。SHA-256 `39890ab1c9bcfa11173f6be13bd5b2f5bba6c238f3e8ad623c3f35a0fe6da702`。画像環境に日本語フォントがなく文字は欠落。これは C0 freeze を単独で代替しない。

## 2026-11-20 再開時の環境導入（履歴）

- 承認された Blender 5.2.4 Linux x64 の [公式アーカイブ](https://download.blender.org/release/Blender5.2/blender-5.2.4-linux-x64.tar.xz) と [公式 SHA-256](https://download.blender.org/release/Blender5.2/blender-5.2.4.sha256) を 09:50:00〜09:51:01 JST に取得。対象ファイルの公式値と実測値は共に `2fd14c50987426897ba60237ee996edf2b4151f4b1a72a460ca20be58c1d2d86` で一致。
- 展開先の実行ファイルは `/home/squne/.local/opt/chronofork-blender-5.2.4.uUPgtwDV/blender-5.2.4-linux-x64/blender`。09:51:43 JST の `--version` は終了コード 127、`libSM.so.6` と `libICE.so.6` が見つからず起動失敗。実行による版の確認、バックグラウンド実行、GLB と .blend 生成はいずれも **UNVERIFIED**。
- 不足する Ubuntu パッケージをシステム変更なしでユーザーローカルへ展開し読み込む試行は、追加配布元の実行承認がないとして実行環境に拒否された。取得・実行は行っていない。環境導入の時間を制作・修正時間に含めない。
- 共通基盤修正は 09:50:29〜09:51:49 JST、C0 検査の初期実装は 09:50:45〜09:52:11 JST。並行作業の壁時計時刻であり、経路固有の費用や合格所要時間ではない。前回の初期費用は補推しない。
- `CITY_URL=http://127.0.0.1:5189/ node inspect-c0.mjs` は基準・別入力の B を検査し failures なし、A は scene 不在で pending、終了コード 2。橋の中心線端点と形状頂点・寸法などを検査するが、橋面の完全な接合、面の閉鎖性、視覚品質は未検証。色のみの更新、形状切替や地形・橋の更新前後保持の網羅的検査は未実施。
- 独立レビューで地形再生成と底面の他街区依存、実体検査の欠落・退化三角形の問題を指摘され、修正した。最終的な C0 の判定や A の動作を承認するレビューではない。
- C0 の A は未実行のため **UNVERIFIED**。C1〜C3 は C0 の PASS 基準版がないため **UNVERIFIED**、C2 の具体課題は未選定。B 単独の部分検査は比較成立や C0 全体の PASS を意味しない。人間の確認時間・理解・好み、A/B 担当の実効モデル設定も未確認。比較は共通 Three.js の地形・橋・配置に対する建物部品の制作経路に限られる。


## 2026-11-19 時点の記録（履歴）

- main base: `5dd99cc208fa661c15fb76216d4d71d8d3fe528f`。共通契約固定: `eccf22ec1a8d4fba486f193a09ac841dac6c0f83`（C0完成版ではない）。
- 2026-11-19 21:11:14 JST に共通基盤作業を開始し、21:13:27 に基準 commit。環境確認、依存取得、AI改修、外部待ちの厳密な内訳は未計測。
- A: 担当が 21:14:15 に受領を確認、21:15:30 に Python 構文解析。Blender 実行、.blend/GLB、取込みは **UNVERIFIED**。この時間は合格までの時間ではない。
- B: 担当が 21:14:05 に受領を確認、21:15:27 に形状の単体検査。合格までの経過は概算でなく、観測時刻の差として82秒。ただし単体検査のみで C0 全体の合格ではない。担当の記録は `route-b/RESULT.md`。
- B のブラウザ部分検査では実体30棟、各建物に position attribute と material が存在することを確認。`b-inspection.json`、`b-only.png`、`inspect-b.mjs`。色・寸法の期待値照合、橋接合や形状同等性、実体保持までは検査していない。画像は A/B 比較画像ではなく、ヘッドレス環境の日本語フォント不足により文字が欠ける。
- C0: A/B とも **UNVERIFIED**（共通最低品質検査・A実生成が未完了）。C1、C2、C3: **UNVERIFIED**（C0合格基準版がないため実施しない）。C2 の具体仕様は未選定・未開示。対象外オブジェクトの実体保持は未検証。
- 各経路の同一資源による交互計測、再実行3回、比較画像、生成物 hash、改修・人間確認時間、token・金額は未取得。これらの数値を推定しない。
- このセッションの報告されたモデルは `gpt-6.1-terra`。担当者の実効モデル・設定の独立確認はできていない。同一 Claude モデル・設定の条件は満たしたと主張できない。人間による理解・好み・確認時間は未確認。
- 推奨は **判定保留**。A/B が同一条件で成立し、C2・C3 と局所性を検証するまで単独採用・併用のどちらも結論できない。
