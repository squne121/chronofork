# 都市制作経路の比較実験

Issue #138 の実験であり、正式仕様・技術採用ではありません。共通基準 `eccf22ec1a8d4fba486f193a09ac841dac6c0f83` には仮都市・契約・表示側を含みますが、経路実装は含まれず C0 PASS を意味しません。要件整理 PR #137 は未マージの入力です。

## 実行

Node 24.14.0、npm 11.12.1 で以下を実行します。依存は本ディレクトリ内だけに入ります。

```sh
cd experiments/graphics-city-pipeline
npm ci
npm run build
npm run dev
```

ブラウザで表示された URL を開きます。A の GLB がない場合は A は未表示となり、B のみが表示されます。両者の比較画像ではありません。

B の部分検査は `npx playwright install chromium` で対応ブラウザを用意し、別端末で開発サーバーを起動した状態で `CITY_URL=http://127.0.0.1:5173/ node inspect-b.mjs` を実行します。この検査は `b-only.png` を上書きします。比較検査・局所保持の検査ではありません。

## 状態

公式 Blender 5.2.4 のアーカイブをチェックサム照合し、追加承認を受けた不足ライブラリをローカルに用意して GLB と .blend を生成しました。生成の経緯・実測 hash と C0〜C3 の検査結果・制約は `STATUS.md`、比較は `COMPARISON.md` を参照してください。生成器や画面は実生成・比較検査の代用にはなりません。

生成例（Blender と不足ライブラリの配置先は環境に応じて変更）:

```sh
LD_LIBRARY_PATH=/home/squne/.local/opt/chronofork-blender-libs.GxcyFo8m/usr/lib/x86_64-linux-gnu \
  /home/squne/.local/opt/chronofork-blender-5.2.4.uUPgtwDV/blender-5.2.4-linux-x64/blender \
  --background --python route-a/generate.py
```

共通実体検査はサーバー起動後に `CITY_URL=http://127.0.0.1:5173/ node inspect-c0.mjs` を実行します。A 未表示など未検査を含む場合は終了コード 2、検査失敗は 1 です。この検査だけでは面の閉鎖性・橋面の完全な接合・視覚品質を保証しません。

## 入力と更新

実験入力の型と初期値は `src/input.ts`。ブラウザで初期化完了後、`window.experiment.city` から現在の入力を読み、複製して `window.experiment.setCity(city)` に渡すと両画面へ反映されます。建物1棟は `window.experiment.updateBuilding(building)` で変更できます。比較用カメラは `window.experiment.setCameraState({ position: [28,32,36], target: [0,1,0], zoom: 1 })` で指定し、`getCameraState()` で取得します。これらは実験専用APIであり本体の WorldState ではありません。
