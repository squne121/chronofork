// 試験データの由来。正式な世界設定ではない（pending-approvals §2）。
export type ProvenanceOrigin =
  | 'SPEC_KNOWN' // 承認済み仕様に値がある
  | 'PLACEHOLDER' // 資料に値が無く、試験のために置いた仮値

export type ProvenanceEntry = Readonly<{
  subject: string
  origin: ProvenanceOrigin
  source: string
  note?: string
}>
