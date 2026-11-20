# 実験都市の再実行・引継ぎ

このディレクトリは Issue #140 の実験であり、正式なゲーム仕様や実装基盤ではありません。以下のコマンドは、特記しない限りこの README があるディレクトリで実行します。P1 の結果は独立再検査中です。画像、機械検査、ユーザーによる可読性評価のいずれも、未確認のものを成功と扱わないでください。

## 必要な環境と依存

- Node.js 22 以上。`package.json` と `package-lock.json` に実験の依存と版があります。ブラウザ表示には Three.js / Vite、検査には Playwright とインストール済み Chromium が必要です。
- A の再生成にはローカルの Blender 5.2.4 LTS が必要です。GLB の閲覧だけなら Blender は不要です。
- 今回は外部取得を行わず、同一マシンに既存の #139 実験の依存を再利用しました。作業環境で `node_modules` がない場合、既存ディレクトリを確認したうえで次のようにリンクできます。

```sh
ln -s /home/squne/projects/chronofork-wt-city-pipeline-138/experiments/graphics-city-pipeline/node_modules node_modules
```

この絶対パスとシンボリックリンクは他環境では使えません。他環境では、ロックファイルに合う既存の依存ディレクトリと Playwright 用ブラウザ、A 再生成時は Blender を別途用意してください。ネットワークからの依存や実行物の取得は今回の実施には含まれていません。

## 共通入力と生成

`common/city.js` が両経路の共通入力、`common/contract.js` が座標・ID・インターフェースの説明です。右手系 Y-up、寸法は全幅、建物位置は地面の接地点です。街区、城塞、橋、建物の ID と座標はここで管理します。A と B は造形をそれぞれの経路で制作し、比較ビューは同じ入力を渡します。

### A: Blender → GLB

`route-a/generate.py` は `route-a/city.json` を読み、編集可能な `route-a/city.blend` と表示用 `route-a/city.glb` を上書き生成します。既存資産や検査用基準を保持してから実施してください。次の `BLENDER` には既存の Blender 実行ファイルの絶対パスを指定します。

```sh
node route-a/snapshot.mjs
BLENDER=/path/to/existing/blender
"$BLENDER" --background --python-exit-code 1 --python route-a/generate.py
```

今回実際に使用したローカル環境では、生成コマンドは次の通りです（パスはその環境に限ります）。

```sh
LD_LIBRARY_PATH=/home/squne/.local/opt/chronofork-blender-libs.GxcyFo8m/usr/lib/x86_64-linux-gnu \
  /home/squne/.local/opt/chronofork-blender-5.2.4.uUPgtwDV/blender-5.2.4-linux-x64/blender \
  --background --python-exit-code 1 --python route-a/generate.py
```

`snapshot.mjs` は `common/city.js` を `route-a/city.json` に書き出します。ビューは実行時入力と保存済み JSON の一致のみを検証し、GLB がその JSON から生成されたことは検証しません。特に JSON だけ更新すると古い GLB が表示され得ます。JSON を更新したら必ず GLB も再生成し、生成・検査結果を確認してください。

`route-a/uv-baseline.json` は P0 の既存ノードの UV スナップショットです。生成後、そのノードの UV を GLB に復元します。構造の不適合や対象ノード不足はエラーになります。ただしアクセサの形式・長さが一致しても、形状や頂点順が変われば元の UV が意味的に正しいとは限りません。**スナップショット対象ノードの shape / topology / 頂点順を変更した場合は UV 復元方式と基準そのものを見直し、実際の出力を再検査してください。** 新規ノードは Blender 出力の UV を使います。UV 復元の成功は形状・見た目の同一性を証明しません。

### B: TypeScript / Three.js

`routes/b.js` が入口で、`route-b/city.ts` が受け取った共通入力からブラウザ上で生成します。B には Blender 由来の GLB や別の生成コマンドは不要です。ソースまたは共通入力の変更後にブラウザを再読込します。両経路のビルド確認は次のコマンドです。

```sh
npm run build
```

ビルド成果物は実験内の `build/node_modules/.cache/city-dist` に出力します。依存再利用用 `node_modules` のリンク先には書きません。出力は Git と ESLint の node_modules 除外対象です。

## 比較ビュー

```sh
npm run dev -- --port 4175
```

`http://127.0.0.1:4175/` を開きます。Normal / Close で同じ固定視点を選び、ドラッグで平行移動、ホイールでズームすると左右が同期します。`?view=close` で接近から開始できます。画面上は Sample 1 / 2 とし、対応は `sample-mapping.json` に分離しています。ただし並びは固定で、画像や順序を知る人には経路が推測可能なため厳密な盲検ではありません。

## 検査と限界

画像・シーン情報の収集には、既存 Playwright と Chromium を使い、実験ディレクトリで以下を実行します。専用設定により Vite のキャッシュを実験内に置きます。

```sh
./node_modules/.bin/vite --config inspection/vite.config.mjs --configLoader native
# 別の端末で
node inspection/capture.mjs http://127.0.0.1:5178/ handoff
```

Vite が示す URL とポートが異なる場合は capture 側の URL を合わせてください。出力先は実行時に表示される `inspection/snapshots/` 内の新しい日時付きディレクトリです。normal / close の画面・各 canvas とシーン JSON を保存します。`window.cityComparison` は ready / error、各 scene・camera・renderer、共通 city、`setView('normal'|'close')` を公開します。読み込み失敗やブラウザエラーは成功ではありません。

保存した2つのスナップショットのディレクトリ名を指定して比較できます。

```sh
node inspection/compare.mjs BASE_SNAPSHOT CURRENT_SNAPSHOT
```

`CURRENT_SNAPSHOT/p0-comparison.json` を新規作成します（既存の場合は上書きせず失敗）。結果の missing / changed / added とカメラ・canvas を確認し、対象内の意図した差と対象外の予期しない差を区別してください。名前の重複や無名ノードは階層・出現順の照合が曖昧で、属性の非暗号学的ハッシュには衝突の可能性があります。材質記録はテクスチャやシェーダを網羅しません。矩形境界の接近は接合・接地の証明ではありません。実画像で接続や視認性を確認し、人間の判断が必要な項目は未評価として扱ってください。
