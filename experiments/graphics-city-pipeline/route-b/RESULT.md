# 経路 B / C0 作業記録

- 課題受領時刻: 2026-11-19 21:14:05 JST（最初に確認した時刻。正確な受信時刻は未計測）
- 基準: `eccf22ec1a8d4fba486f193a09ac841dac6c0f83`
- 処理: 契約と共通入力・表示側インターフェースを確認し、Three.js で足元原点・幅奥行高さ 1 の block と、上下幅 1 / 0.6 の taper を直接生成。形状を共有し、表示側が個別の位置・寸法・色を適用する。
- 修正: 四角錐台の面を平坦に照明できるよう非インデックス化して面法線を再計算。所属情報は形状に含めない。
- 結果: 2026-11-19 21:15:27 JST、下記の単一機能確認で両形状の上下端の X/Z 範囲とインスタンス独立性・形状共有を確認し PASS。
- `src/route-b.ts` SHA-256: `87fc9ad81c096f69e725985580e9826ec65df307938b5b34d638d70bb0d4ef0c`
- 未確認: ブラウザでの表示、統合後の更新、型検査・ビルド、比較性能計測。性能計測は統合担当が実施。C2 の具体内容は未受領。

## 再実行手順

実験ディレクトリで `npm ci --no-audit --no-fund` を実行後、Node.js v24.14.0 で以下を実行する（TypeScript 型除去対応の Node が必要）。

```sh
node --input-type=module -e 'import assert from "node:assert/strict"; import {createBuilding} from "./src/route-b.ts"; for (const [kind, top] of [["block", 1], ["taper", 0.6]]) { const a=createBuilding(kind), b=createBuilding(kind); assert.notEqual(a,b); assert.equal(a.geometry,b.geometry); const p=a.geometry.getAttribute("position"); for (const [y,width] of [[0,1],[1,top]]) { let xs=[],zs=[]; for (let i=0;i<p.count;i++) if (Math.abs(p.getY(i)-y)<1e-6) { xs.push(p.getX(i)); zs.push(p.getZ(i)); } assert.ok(xs.length); for (const v of [Math.min(...xs),Math.min(...zs)]) assert.ok(Math.abs(v+width/2)<1e-6); for (const v of [Math.max(...xs),Math.max(...zs)]) assert.ok(Math.abs(v-width/2)<1e-6); } console.log(`${kind}: bounds and independent objects OK`); }'
sha256sum src/route-b.ts
```
