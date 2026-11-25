import type { HistoryYearRef } from '../data/history.ts'
import type { Selection } from '../../inspection-source.ts'

export type DeskDocumentTarget = Selection | Readonly<{ kind: 'event' | 'trace'; id: string }>

/** C の公開 props に変換するための通知。開閉・重複管理はここで行わない。 */
export type OpenDeskDocument = (target: DeskDocumentTarget, year: HistoryYearRef, source?: DeskDocumentTarget) => void
