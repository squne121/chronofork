import type { HistoryYearRef } from '../data/history.ts'
import type { DocumentTarget } from '../documents/index.tsx'

export type DeskDocumentTarget = DocumentTarget
export type OpenDeskDocument = (target: DeskDocumentTarget, year: HistoryYearRef, source?: DeskDocumentTarget) => void
