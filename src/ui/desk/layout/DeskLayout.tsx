import type { ReactNode } from 'react'

type Props = Readonly<{
  chronicle: ReactNode
  world: ReactNode
  onChronicle: () => void
  onWorld: () => void
}>

/** 二つの閲覧面は同時に表示し、移動ボタンはフォーカスだけを移す。 */
export function DeskLayout({ chronicle, world, onChronicle, onWorld }: Props) {
  return <>
    <nav className="obs-desk-jumps" aria-label="編纂机内の移動">
      <button type="button" onClick={onChronicle} data-testid="obs-tab-investigate">年代記へ</button>
      <button type="button" onClick={onWorld} data-testid="obs-tab-world">世界図へ</button>
    </nav>
    <div className="obs-desk-grid" data-testid="obs-desk-grid">
      <section id="obs-desk-chronicle" tabIndex={-1} aria-label="年代記">{chronicle}</section>
      <section id="obs-desk-world" tabIndex={-1} aria-label="簡略世界図と既存の資料参照">{world}</section>
    </div>
  </>
}
