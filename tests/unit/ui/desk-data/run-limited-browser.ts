// 開発者用。Vite を専用ポートで起動し、URL と工程2Fの証跡ディレクトリを引数に渡す。
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { chromium } from '@playwright/test'

const [baseURL, referenceDir] = process.argv.slice(2)
assert(baseURL && referenceDir, '引数: 専用 Vite URL / 工程2F証跡ディレクトリ')
const url = new URL(baseURL)
assert(url.hostname === '127.0.0.1' && url.port !== '4173' && url.port !== '5291' && url.port !== '', '専用のローカルポートを指定してください')
const reference = Object.fromEntries(await Promise.all(['A0', 'A1', 'small'].map(async name => {
  const data = JSON.parse(await readFile(join(referenceDir, `demand-20260303-${name}.json`), 'utf8'))
  return [name, { technicalGoal: data.technicalGoal, hashes: data.hashes }]
})))
const browser = await chromium.launch()
try {
  const page = await browser.newPage()
  await page.goto(url.href)
  await page.locator('#root').locator('h1').first().waitFor({ state: 'visible' })
  const cdp = await page.context().newCDPSession(page)
  const sessions = new Set<string>()
  const heap = new Map<string, { samples: number; peakUsedBytes: number; peakTotalBytes: number }>()
  const messages = new Map<number, string>()
  let id = 0
  cdp.on('Target.attachedToTarget', event => {
    if (event.targetInfo.type === 'worker' && event.targetInfo.url.includes('/play-worker.ts')) sessions.add(event.sessionId)
  })
  cdp.on('Target.detachedFromTarget', event => {
    sessions.delete(event.sessionId)
    for (const [message, session] of messages) if (session === event.sessionId) messages.delete(message)
  })
  cdp.on('Target.receivedMessageFromTarget', event => {
    const { id: messageId, result } = JSON.parse(event.message)
    if (!messages.delete(messageId) || typeof result?.usedSize !== 'number') return
    const entry = heap.get(event.sessionId) ?? { samples: 0, peakUsedBytes: 0, peakTotalBytes: 0 }
    entry.samples++
    entry.peakUsedBytes = Math.max(entry.peakUsedBytes, result.usedSize)
    entry.peakTotalBytes = Math.max(entry.peakTotalBytes, result.totalSize)
    heap.set(event.sessionId, entry)
  })
  await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: false })
  const timer = setInterval(() => {
    for (const sessionId of sessions) {
      if ([...messages.values()].includes(sessionId)) continue
      const messageId = ++id
      messages.set(messageId, sessionId)
      void cdp.send('Target.sendMessageToTarget', {
        sessionId, message: JSON.stringify({ id: messageId, method: 'Runtime.getHeapUsage' }),
      }).catch(() => messages.delete(messageId))
    }
  }, 200)
  try {
    const result = await page.evaluate(async ({ entry, data }) => (await import(entry)).verifyLimitedPlaytest(data), {
      entry: '/tests/unit/ui/desk-data/limited-playtest.browser.ts', data: reference,
    })
    console.log(JSON.stringify({ ...result, workerV8Heap: heap.size ? [...heap.values()] : 'UNVERIFIED', nativeWorkerPeak: 'UNVERIFIED' }, null, 2))
  } finally {
    clearInterval(timer)
  }
} finally {
  await browser.close()
}
