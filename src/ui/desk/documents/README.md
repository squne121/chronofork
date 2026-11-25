# 独立資料窓（#155）

`DeskDocuments` は表示専用の非モーダル資料窓です。Worker を発行せず、年・枝の切替は親に要求します。`HistoryYear` の年・seed・構成 ID/digest・枝・介入 ID が窓の参照と一致しない間は旧データを表示しません。A0 の `slice` は同じ参照のときだけ人物の全期間要約に使います。年初と年内記録、未取得・省略・照会範囲の記録なしを区別します。

```tsx
import { DeskDocuments, type DocumentOpenRequest } from './desk/documents/index.tsx'
import { historyFromObservation } from './desk/data/history.ts'

// slice は親が最新要求を照合して受理した実 ObservationSlice。
const history = historyFromObservation(slice).at(slice.year)
const request: DocumentOpenRequest = {
  requestId: 'open-1', // 開く操作ごとに一意。同じ要求の再描画では再オープンしない
  ref: history.ref,
  history, // 比較元の HistoryYear をそのまま渡す（同一 ref でも転送範囲は異なる）
  target: { kind: 'person', id: personId },
}
<DeskDocuments history={history} slice={slice} openRequest={request}
  onYear={(ref, context) => selectYearAndBranch(ref, context)}
  onOpenRelated={request => recordNavigation(request)}
  onFilter={(target, ref) => filterTimeline(target, ref)}
  onIntervene={(year, personId, partnerId, ref) => openIntervention(year, personId, partnerId, ref)} />
```

対象は既存 Selection（person/group/region/title）と country/family（中心人物 ID）/event/trace。`source` は遷移元対象です。関連操作は窓を内部で追加し、`onOpenRelated` に通知します。通知には `internallyOpened: true` が入り、コピーして親から戻しても二重に開きません。各窓は最初の一致した確定 HistoryYear を保持し、同じ参照でも別比較の転送範囲にすり替えません。共通 history 由来の未取得・未計算 HistoryYear は確定データへ更新できます。openRequest.history で明示された DTO は未確定でも共通 history に置換しません。比較から開く場合は必ず `openRequest.history` に比較元の HistoryYear 自体を渡してください。未指定時は共通 `history` の初回一致を採用します。未取得の窓から参照年・枝への移動を要求でき、親が対応する HistoryYear を渡すと表示します。取得処理そのものは親の責務です。

窓ヘッダーの移動ボタンはドラッグまたは矢印キーで移動、ポインター操作・キーボードフォーカスで前面化、Escape または閉じるボタンで閉じます。関連リンクはホバー/フォーカスで簡易プレビュー、クリックで開き、右クリックで開く・年表絞込・家系等の文脈メニューを表示します。配置の永続化や高度な窓管理は行いません。`onFilter`、`onIntervene` は実処理を親が所有します。参照契約と Worker 観測の例は `../data/README.md` を参照してください。

### 明示比較の未取得を更新

`onYear(ref, { windowId, sourceHistory })` と `onOpenRelated` の `windowId` / `sourceHistory` は取得対象窓と元の比較 DTO を示します。親がこの出典を維持した取得結果と確認できた場合だけ `historyUpdate={{ windowId, history: acquiredHistory }}` を渡してください。外部開窓の ID は `externalDocumentWindowId(requestId)` で得られます。`historyUpdate` は参照一致かつ未確定からの前進だけを反映し、確定済みの転送範囲を上書きしません。取得元の同一性は `HistoryYearRef` だけでは判定できないため、親が同じ比較ビューであることを保証できなければ更新しないでください。別年の関連窓にも元 DTO を渡し、共通 history で自動補完しません。未取得時は窓内の移動/取得ボタンを使えます。
