# C2 実配信物の確認

2026-11-20 11:10:02〜11:10:04 JST、統合 worktree の実験ディレクトリを `npm --prefix /home/squne/projects/chronofork-wt-city-pipeline-138/experiments/graphics-city-pipeline run dev -- --port 5191 --strictPort` で配信。各 URL を `curl -fsS` で取得し、その応答 bytes に `sha256sum` を適用した。続けて同じ URL を `CITY_URL` として `inspect-c2.mjs` を実行し、`c2-artifacts-N6bMQk/` に画像と結果を保存。検査前後の対象ソース・GLB hash と HEAD はその JSON 内。

| URL | SHA-256 |
|---|---|
| `http://127.0.0.1:5191/a/block.glb` | `a0c143a6d89388a4b257cfdb8f4d39cc5a9530797deb0ee135642721bf887df7` |
| `http://127.0.0.1:5191/a/taper.glb` | `7671d77822dc839b567d8fdcfd2cce0eb94382a8eef0f0c675bec75acbfff701` |
| `http://127.0.0.1:5191/a/tiered.glb` | `daf3a711e4f38f210a1fcdac4ad41bfdf5b2f3e8c99c86b24a0c460214f69e9e` |

同じファイル群のローカル hash と一致した。HTTP 応答検査はブラウザ実行前の別リクエストであり、各ブラウザリクエストの bytes を直接記録したものではない。検査範囲や自己交差などの制約は `STATUS.md` を参照。
