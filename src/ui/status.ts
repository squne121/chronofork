export type SpecStatus = 'pending-migration' | 'approved'

export function describeSpecStatus(status: SpecStatus): string {
  switch (status) {
    case 'pending-migration':
      return '承認済みMVP仕様は移行待ちです。ゲーム機能は未実装です。'
    case 'approved':
      return '承認済み仕様が配置されています。'
  }
}
