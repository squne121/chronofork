import type { ReactNode } from 'react'
import type { PlayView } from '../../branch-play-source.ts'
import { DeskComparison } from './DeskComparison.tsx'
import type { ComparedRecord, ComparisonTarget, EvidenceRequest, InvestigationContext } from './DeskComparison.tsx'
import { YEAR_RANGE } from '../../timeline-source.ts'
import './desk-intervention.css'

export type DeskPair = 'A0_A1' | 'A1_A2'
export type DeskComparisonSelection = Readonly<{
  view: PlayView; context: InvestigationContext; pair: DeskPair; year: number; target?: ComparisonTarget; focus?: ComparedRecord
}>

/** 介入・比較の一枚だけを置く。通常資料の管理と出典保持は DeskDocuments に委ねる。 */
export function DeskInterventionWindow({ open, front, onFront, comparison, onCompare, onClose, onReturn, onEvidence, children }: Readonly<{
  open: boolean
  front: boolean
  onFront: () => void
  comparison?: DeskComparisonSelection
  onCompare: (selection: DeskComparisonSelection) => void
  onClose: () => void
  onReturn: (context: InvestigationContext) => void
  onEvidence: (request: EvidenceRequest) => void
  children: ReactNode
}>) {
  const label = comparison ? '歴史の比較' : '介入'
  return <section hidden={!open} role="dialog" aria-label={label} className="desk-document desk-intervention"
    style={front ? { zIndex: 10000 } : undefined} onPointerDown={onFront} onFocus={onFront}
    onKeyDown={e => { if (e.key === 'Escape') { e.stopPropagation(); onClose() } }}>
    <header>
      <strong>{label}</strong>
      <button type="button" onClick={onClose}>{label}を閉じる</button>
    </header>
    <div className="desk-document-body" key={comparison ? 'comparison' : 'intervention'} hidden={!comparison}>
      {comparison && <>
        <label>比較する年 <input key={comparison.year} type="number" min={YEAR_RANGE.min} max={YEAR_RANGE.max} step={1}
          defaultValue={comparison.year} onKeyDown={e => { if (e.key === 'Enter') e.currentTarget.blur() }} onBlur={e => {
            const next = e.currentTarget.valueAsNumber
            if (next === comparison.year) return
            if (Number.isInteger(next) && next >= YEAR_RANGE.min && next <= YEAR_RANGE.max) onCompare({ ...comparison, year: next, focus: undefined })
            else e.currentTarget.value = String(comparison.year)
          }} /></label>
        {comparison.focus && <button type="button" onClick={() => onCompare({ ...comparison, focus: undefined })}>根拠の絞り込みを解除</button>}
        <DeskComparison {...comparison} onReturn={onReturn} onEvidence={onEvidence} />
      </>}
    </div>
    <div className="desk-document-body" hidden={!!comparison}>{children}</div>
  </section>
}
