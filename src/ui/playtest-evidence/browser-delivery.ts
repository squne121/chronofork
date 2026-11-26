import { exportPlaytestEvidence, serializePlaytestEvidence } from '../playtest-evidence.ts'
import type { EvidenceSource } from '../playtest-evidence.ts'

export type Delivery = 'copy' | 'download'
export type DeliveryResult = { kind: 'copied' | 'downloaded' | 'stale' } | { kind: 'copy-failed'; json: string }

type Outputs = Readonly<{ copy: (json: string) => Promise<void>; download: (json: string, name: string) => void }>

export function evidenceFilename(source: EvidenceSource): string {
  const build = source.build.kind === 'COMMIT' && /^[0-9a-f]{40}$/.test(source.build.sha) ? source.build.sha.slice(0, 12) : 'local'
  return `chronofork-${build}-${source.selected.year}-${source.kind.toLowerCase()}.json`
}

export function downloadEvidence(json: string, filename: string): void {
  const link = document.createElement('a')
  const url = URL.createObjectURL(new Blob([json], { type: 'application/json' }))
  try {
    link.href = url
    link.download = filename
    document.body.append(link)
    link.click()
  } finally {
    link.remove()
    // ブラウザがダウンロードを開始できるよう、次のタスクで解放する。
    setTimeout(() => URL.revokeObjectURL(url), 0)
  }
}

const browserOutputs: Outputs = {
  copy: async json => { await navigator.clipboard.writeText(json) },
  download: downloadEvidence,
}

export async function deliverEvidence(source: EvidenceSource, action: Delivery, isCurrent: () => boolean,
  fallbackJson?: string, outputs = browserOutputs, generate = exportPlaytestEvidence): Promise<DeliveryResult> {
  if (!isCurrent()) return { kind: 'stale' }
  const json = fallbackJson ?? serializePlaytestEvidence(await generate(source))
  if (!isCurrent()) return { kind: 'stale' }
  if (action === 'download') {
    outputs.download(json, evidenceFilename(source))
    return { kind: 'downloaded' }
  }
  try {
    await outputs.copy(json)
  } catch {
    return isCurrent() ? { kind: 'copy-failed', json } : { kind: 'stale' }
  }
  return { kind: isCurrent() ? 'copied' : 'stale' }
}
