# 編纂机の接合点（#156）

通常入口では `ObservationPanel` が同じ `HistoryYear` の年代記と世界図を `DeskLayout` に渡す。年選択・既存 `observe` の要求発行と受理は B が所有し、年移動で履歴を全量転送しない。`?entry=legacy` と `?run=legacy-integrated` は既存の検証配置を使う。

## 通常入口の資料接続（UI-B/C）

- `ObservationPanel.onOpenDocument`（`OpenDeskDocument`）は対象と確定した `HistoryYearRef` を通知する。App は開く操作ごとに一意の `openRequest` を作る。同じ対象の再選択でも別窓を開ける。
- 年代記・世界図・資料窓には、App が受理した同じ `HistoryYear` を渡す。資料の別年取得は親の直列観測要求に合流し、最新世代・観測入力・完全な参照が一致した応答だけを採用する。窓を開くことや絞り込みで介入は発行しない。
- 資料の絞り込みは、資料の参照と年代記の表示年が一致する場合だけ、実記録の関連を使って適用する。介入への遷移はフォームへの年・人物の引き渡しまでで、再計算はフォームでの明示操作に委ねる。通常入口以外の検証配置は追従させない。

## D2 で比較を接続するとき

比較から開く場合は、同じ `HistoryYearRef` でも別出典の転送範囲を混ぜず、比較元 `HistoryYear` を `openRequest.history` に渡す。`onYear` の `sourceHistory` は通常 A0 の観測取得で置換しない。比較側で同じ出典からの取得を保証できる場合だけ `historyUpdate` で対象窓を更新する。A1/A2 の転送省略は現行 Worker API では個別再取得できない。詳細は [資料窓の接合契約](../documents/README.md) を参照。
