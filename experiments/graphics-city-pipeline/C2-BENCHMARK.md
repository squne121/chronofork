# C2 生成の再実行計測

## 対象と条件

- 2026-11-20 JST、統合済みソースの**再実行（warm）**のみ。初回制作の計測ではない。人間の制作・操作時間は未測定。
- 直列順序は A→B、B→A、A→B。各回は新しい OS プロセス。プロセス起動直前から終了・出力回収までの壁時計を `time.monotonic_ns()` で測定。開始・終了時刻はローカル時計（JST、UTC+09:00）。
- 他の担当者に CPU/GPU 競合を避けるよう依頼し、調整担当から計測中はビルド・生成・描画を実行せず他担当は静的レビューのみとの連絡を受けた。観測できない外部プロセスの競合は未確認。無競合の保証ではない。
- A は `route-a/generate.py` を `/tmp/chronofork-c2-bench-bd9u88q2/route-a/generate.py` に複写し、その親を実験ディレクトリに見立てて実行。出力先も一時ディレクトリ内であり、実験内の既存成果物は上書きしない。Blender の起動、Python 実行、block/taper/tiered のメッシュ作成、3 GLB 出力、`.blend` 保存とプロセス終了を含む。2回目以降は同じ一時出力先を再利用し、Blender が既存 `.blend` のバックアップ `.blend1` を作る処理も含む。
- B は Node v24.14.0 で統合済み `src/route-b.ts` を直接 import し、Three.js 0.182.0 により block/taper/tiered の形状・マテリアルを生成。各形状の index および全 attribute の itemSize と数値配列を JSON にシリアライズして一時ファイルへ保存する処理とプロセス起動・終了を含む。A の成果物は使わない。Node の TypeScript 型消去を用い、別途 `tsc` やバンドルは実行していない。ブラウザ描画・検査は含まない。
- A は GLB と Blender プロジェクトを保存し、B はメモリ上のジオメトリを検証用 JSON に出力する。生成範囲・処理・出力形式が違うため、単純な速度順位や同等作業の比較にはできない。

## 実行方法

A の各回（環境変数を設定し、cwd は一時ディレクトリ）:

```sh
LD_LIBRARY_PATH=/home/squne/.local/opt/chronofork-blender-libs.GxcyFo8m/usr/lib/x86_64-linux-gnu \
  /home/squne/.local/opt/chronofork-blender-5.2.4.uUPgtwDV/blender-5.2.4-linux-x64/blender \
  --background --python-exit-code 1 --python /tmp/chronofork-c2-bench-bd9u88q2/route-a/generate.py
```

B の各回は `node /tmp/chronofork-c2-bench-bd9u88q2/generate-b.mjs /tmp/chronofork-c2-bench-bd9u88q2/b-N.json`。一時ラッパーの処理は以下（`route-b.ts` は実験内の絶対 file URL を指定）。

```js
import { createBuilding } from 'file:///home/squne/projects/chronofork-wt-city-pipeline-138/experiments/graphics-city-pipeline/src/route-b.ts';
import { writeFileSync } from 'node:fs';
const result = {};
for (const kind of ['block', 'taper', 'tiered']) {
  const mesh = createBuilding(kind); const g = mesh.geometry;
  result[kind] = {index: g.index ? Array.from(g.index.array) : null, attributes: Object.fromEntries(Object.entries(g.attributes).map(([key, a]) => [key, {itemSize: a.itemSize, array: Array.from(a.array)}]))};
}
writeFileSync(process.argv[2], JSON.stringify(result));
```

計測時ソースの SHA-256: A `6d53f0a266f867641d53ba3613888f0c78a373faa481fff5bf9388344c1ec1f8`、B `1b9aaf9deec5f1447ecfedbe5accb28d051a90823fa1af446519c6d047873fc4`。一時 B ラッパー `3a7cce62622bfce0c2dca1cc1ba22fb5cd72c7e05742a0272255e8fb3fa2ca9b`。

## 計測結果

| 順序 | 経路 | 開始 JST | 終了 JST | 壁時計 秒 | 終了コード |
|---:|:---:|:---|:---|---:|---:|
| 1 | A | 2026-11-20 10:59:18.912497 | 2026-11-20 10:59:19.429957 | 0.517426 | 0 |
| 2 | B | 2026-11-20 10:59:19.430537 | 2026-11-20 10:59:19.506901 | 0.076350 | 0 |
| 3 | B | 2026-11-20 10:59:19.507136 | 2026-11-20 10:59:19.568094 | 0.060946 | 0 |
| 4 | A | 2026-11-20 10:59:19.568308 | 2026-11-20 10:59:20.031701 | 0.463380 | 0 |
| 5 | A | 2026-11-20 10:59:20.032186 | 2026-11-20 10:59:20.502477 | 0.470276 | 0 |
| 6 | B | 2026-11-20 10:59:20.502917 | 2026-11-20 10:59:20.568464 | 0.065534 | 0 |

## 各回の成果物 SHA-256

| 成果物 | 1 A | 4 A | 5 A |
|---|---|---|---|
| block.glb | `a0c143a6d89388a4b257cfdb8f4d39cc5a9530797deb0ee135642721bf887df7` | 同左 | 同左 |
| taper.glb | `7671d77822dc839b567d8fdcfd2cce0eb94382a8eef0f0c675bec75acbfff701` | 同左 | 同左 |
| tiered.glb | `daf3a711e4f38f210a1fcdac4ad41bfdf5b2f3e8c99c86b24a0c460214f69e9e` | 同左 | 同左 |
| parts.blend | `2bbbdfa619e94437263ebf275607e56072dc8efbadf5700f9a35903c49224fc5` | 同左 | `911042e2008e836cdb1765a7180acbbf63946621cf6dee745e12b9165e3b26c4` |
| parts.blend1（バックアップ） | なし | `2bbbdfa619e94437263ebf275607e56072dc8efbadf5700f9a35903c49224fc5` | `2bbbdfa619e94437263ebf275607e56072dc8efbadf5700f9a35903c49224fc5` |

B の `b-2.json`、`b-3.json`、`b-6.json` はすべて `c9fcab0e0c07644a94c617732008de22224155b2cd36c4b4b59b32bc6bd2322b`。A の GLB は3回とも同一ハッシュだが `.blend` は5回目に変化した。原因は未調査。ハッシュ一致は形状の正しさを保証しない。

一時ディレクトリには各プロセスの結合 stdout/stderr ログ（`1-A.log` など）と最終的な一時成果物が残る。通常の一時領域であり永続保存は保証されない。
