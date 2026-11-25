# 編纂机の接合点（#156）

通常入口では `ObservationPanel` が同じ `HistoryYear` の年代記と世界図を `DeskLayout` に渡す。年選択・既存 `observe` の要求発行と受理は B が所有し、年移動で履歴を全量転送しない。`?entry=legacy` と `?run=legacy-integrated` は既存の検証配置を使う。

## UI-C の統合後

- `ObservationPanel.onOpenDocument`（`OpenDeskDocument`）は対象と確定した `HistoryYearRef` を通知する。年代記・地図で同じ対象を再度選んでも通知を送る。C の公開 props に合わせて、App で個別の開く要求に変換する。
- App が受理した `ObservationSlice` と `historyFromObservation(slice).at(slice.year)` を、対応する確定年・A0 の資料として渡す。未取得・別年・別枝の値を混ぜない。資料からの年移動は B の観測要求へ、介入は既存のフォームへ返す。対象フィルターも年代記へ返し、C は Worker を発行しない。
- この差分には C の窓管理、未統合モジュールへの import、比較用資料窓を含まない。現時点の既存資料・介入・比較経路は保持し、C 統合後に接合してから既存表示の置換を判断する。
