import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import type { WorkerRequest, WorkerResponse } from '../../src/ui/play-worker.ts'

type Observation = Extract<WorkerResponse, { observation: unknown }>
type Comparison = Extract<WorkerResponse, { view: unknown }>
type Fault = 'identity' | 'branch' | 'candidates' | 'oldYear' | 'differentInput' | 'hold'
type Timing = { operation: string; computeMs: number; viewMs?: number; responseMs: number }
type Probe = Window & {
  timings: Timing[]; observation?: Observation; compared?: Comparison; initial?: Observation
  fault?: Fault; late?: () => void; terminations: number
}

/** 成功・対照には介入せず、異種DTO拒否の操作でのみ実応答のコピーを差し替える。 */
async function observeWorker(page: Page) {
  await page.addInitScript(() => {
    const probe = window as unknown as Probe
    probe.timings = []
    probe.terminations = 0
    const terminate = Worker.prototype.terminate
    Worker.prototype.terminate = function () { probe.terminations++; terminate.call(this) }
    const send = Worker.prototype.postMessage
    Worker.prototype.postMessage = function (this: Worker, request: WorkerRequest) {
      const fault = probe.fault
      delete probe.fault
      const handler = this.onmessage
      if (fault && handler) {
        if ('observe' in request && probe.observation) {
          const response = structuredClone(probe.observation)
          if (fault === 'identity') Object.assign(response.observation, { configIdentity: '別構成の完全identity' })
          if (fault === 'branch') Object.assign(response.observation, { branchId: 'A1-play' })
          if (fault === 'candidates') Object.assign(response.observation.candidates, { configIdentity: '別構成の候補' })
          const deliver = () => handler.call(this, new MessageEvent('message', { data: response }))
          if (fault === 'hold') probe.late = deliver
          else queueMicrotask(deliver)
          return
        }
        if ('input' in request && probe.compared && fault === 'differentInput') {
          queueMicrotask(() => handler.call(this, new MessageEvent('message', { data: probe.compared })))
          return
        }
      }
      const start = performance.now()
      const receive = (event: MessageEvent<WorkerResponse>) => {
        const data = event.data
        if ('kind' in data) return
        this.removeEventListener('message', receive)
        if (data.ok && 'observation' in data) {
          probe.observation = data
          if (data.observation.configuration === 'LIMITED_PLAYTEST' && !probe.initial) probe.initial = data
        }
        if (data.ok && 'view' in data) probe.compared = data
        probe.timings.push({ operation: 'observe' in request ? `A0-${request.observe.year}` : 'input' in request ? `A1-${request.input.signedDelta}` : '候補',
          computeMs: data.computeMs, viewMs: 'viewMs' in data ? data.viewMs : undefined, responseMs: performance.now() - start })
      }
      this.addEventListener('message', receive)
      send.call(this, request, { transfer: [] })
    }
  })
}

async function measureWorkerHeap(page: Page) {
  const cdp = await page.context().newCDPSession(page)
  const workers = new Map<string, number>()
  const heap = new Map<string, { samples: number; peakUsedBytes: number; peakTotalBytes: number }>()
  let sequence = 0
  cdp.on('Target.attachedToTarget', e => {
    if (e.targetInfo.type === 'worker' && e.targetInfo.url.includes('play-worker')) workers.set(e.sessionId, 0)
  })
  cdp.on('Target.detachedFromTarget', e => workers.delete(e.sessionId))
  cdp.on('Target.receivedMessageFromTarget', e => {
    const { id, result } = JSON.parse(e.message)
    if (!workers.has(e.sessionId) || workers.get(e.sessionId) !== id) return
    workers.set(e.sessionId, 0)
    if (typeof result?.usedSize !== 'number') return
    const stats = heap.get(e.sessionId) ?? { samples: 0, peakUsedBytes: 0, peakTotalBytes: 0 }
    stats.samples++
    stats.peakUsedBytes = Math.max(stats.peakUsedBytes, result.usedSize)
    stats.peakTotalBytes = Math.max(stats.peakTotalBytes, result.totalSize)
    heap.set(e.sessionId, stats)
  })
  await cdp.send('Target.setAutoAttach', { autoAttach: true, waitForDebuggerOnStart: false, flatten: false })
  const timer = setInterval(() => {
    for (const [sessionId, pending] of workers) {
      if (pending) continue
      const id = ++sequence
      workers.set(sessionId, id)
      void cdp.send('Target.sendMessageToTarget', { sessionId, message: JSON.stringify({ id, method: 'Runtime.getHeapUsage' }) })
        .catch(() => { if (workers.has(sessionId)) workers.set(sessionId, 0) })
    }
  }, 200)
  return async () => {
    clearInterval(timer)
    await cdp.detach()
    return heap.size ? [...heap.values()] : 'UNVERIFIED'
  }
}

test('限定試遊は明示入口からのみ開き、通常・legacy の内容を持ち越さない', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByTestId('obs-seed-input')).toHaveValue('20260101')
  await page.getByRole('button', { name: '限定試遊を開始', exact: true }).click()
  await expect(page.getByTestId('obs-seed-input')).toHaveValue('20260303')
  await expect(page.getByTestId('obs-seed-input')).toHaveAttribute('readonly', '')
  await expect(page.getByTestId('legacy-workspace')).toHaveCount(0)
  await page.getByRole('button', { name: '限定試遊を最初からやり直す' }).click()
  await expect(page.getByTestId('obs-intro')).toBeVisible()
  await page.getByRole('button', { name: '限定試遊を退出して通常入口へ' }).click()
  await expect(page.getByTestId('obs-seed-input')).toHaveValue('20260101')
  await expect(page.getByTestId('legacy-workspace')).toHaveCount(1)
  await page.goto('/?entry=legacy')
  await expect(page.getByTestId('legacy-workspace')).toHaveAttribute('open', '')
  await expect(page.getByRole('button', { name: '限定試遊を開始', exact: true })).toHaveCount(0)
})

// 工程2Fで固定した検証用入力。製品UIの初期値・ヒントには使わない。
const [first, second] = ['person-exp-02', 'person-exp-05']
for (const width of [1280, 960]) {
  test(`実Workerの限定試遊縦断・${width}px`, async ({ page }, testInfo) => {
    test.skip(process.env.CHRONOFORK_E2E_LIMITED !== '1', 'CHRONOFORK_E2E_LIMITED=1 で100年の実計算を行う')
    test.setTimeout(180_000)
    await page.setViewportSize({ width, height: 900 })
    page.setDefaultTimeout(10_000)
    await observeWorker(page)
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    await page.goto('/')
    const finishHeap = await measureWorkerHeap(page)
    const get = (id: string) => page.getByTestId(id)
    const dialogs = page.getByRole('dialog')
    const docs = (kind: string, id: string) => page.getByRole('dialog', { name: `${kind} ${id}`, exact: true })
    const stage = (year: number) => expect(get('obs-chronicle')).toHaveAttribute('data-year', String(year), { timeout: 45_000 })
    const goal = page.getByText('シナリオ目標と1350年の参考判定', { exact: true })
    const form = page.getByRole('dialog', { name: '介入', exact: true })
    const comparison = page.getByRole('dialog', { name: '歴史の比較', exact: true })
    const compareButton = form.getByRole('button', { name: '同じ年の歴史を比較' })
    const arm = (fault: Fault) => page.evaluate(value => { (window as unknown as Probe).fault = value }, fault)
    const close = (dialog: ReturnType<typeof docs>) => dialog.getByRole('button', { name: '資料を閉じる' }).click()
    const screenshot = async (name: string) => {
      await page.evaluate(() => document.fonts.ready.then(() => undefined))
      const path = testInfo.outputPath(`${name}-${width}.png`)
      await page.screenshot({ path, animations: 'disabled' })
      await testInfo.attach(name, { path, contentType: 'image/png' })
    }
    const openLimited = () => page.getByRole('button', { name: '限定試遊を開始', exact: true }).click()
    const checkView = async (status: string) => {
      const records = await page.evaluate(() => {
        const { view } = (window as unknown as Probe).compared!
        return { reused: view.a0Source, branches: [view.a0, view.a1].map(run => ({
          goal: run.result.goal, technical: run.result.technicalGoal?.status, status: run.result.status,
          first: run.result.snapshots[0]?.year, last: run.result.snapshots.at(-1)?.year,
          digest: run.inputs.configDigest, ledger: run.playLedger?.length,
        })) }
      })
      expect(records).toEqual({ reused: 'REUSED', branches: ['NOT_ACHIEVED', status].map((technical, ledger) => ({
        goal: null, technical, status: 'COMPLETED', first: 1250, last: 1350, digest: '844299b001142fee', ledger,
      })) })
    }

    try {
      await openLimited()
      await get('obs-start').click()
      await stage(1250)
      await goal.click()
      await expect(get('obs-goal')).toContainText('参考判定：条件を満たしていない')
      await expect(get('limited-central-assessment')).toContainText('保持者が未確定')
      await expect(get('limited-registration-deferrals')).toContainText('登録枠による保留（4件）')
      await get('limited-central-assessment').getByRole('button', { name: /中央領地の称号資料を開く/ }).click()
      const initialTitle = docs('称号', 'title-exp-central')
      await expect(initialTitle).toContainText('1350年初には保持者を確認できません')
      await initialTitle.getByRole('button', { name: '年表で絞り込む' }).click()
      await expect(get('limited-registration-deferrals')).toHaveCount(0)
      await close(initialTitle)
      await page.getByRole('button', { name: '資料の絞り込みを解除' }).click()
      await get('limited-central-assessment').getByRole('button', { name: '判定時点の1350年初へ' }).click()
      await stage(1350)
      await get('limited-central-assessment').getByRole('button', { name: /中央領地の称号資料を開く/ }).click()
      const central = docs('称号', 'title-exp-central')
      await expect(central.getByTestId('document-reference')).toHaveText('A0 / 1350年 / seed 20260303')
      await expect(central).toContainText('年初の保持者：未確定')
      await screenshot('原史の中央領地')
      await central.getByRole('button', { name: /保持者が未確定になった1325年初/ }).click()
      await stage(1325)
      const earlier = central.filter({ hasText: 'A0 / 1325年' })
      await earlier.getByRole('button', { name: /確立した後継者がいない/ }).click()
      const succession = dialogs.filter({ has: page.getByText(/記録された判断：.*確立した後継者がいない/) })
      await expect(succession).toContainText('Event参照なし')
      await close(succession)
      await close(earlier)
      const ending = central.filter({ hasText: 'A0 / 1350年' })
      await ending.getByText('歴代の称号移転', { exact: false }).and(ending.locator('summary')).click()
      await ending.getByRole('button', { name: '1322年の移転と判断を開く' }).click()
      const transfer = dialogs.filter({ has: page.getByRole('heading', { name: /年内の出来事：.*称号/ }) })
      await expect(transfer).toContainText('A0 / 1322年')
      await expect(transfer.getByRole('heading', { name: '実判断記録' })).toBeVisible()
      await close(transfer)
      await ending.getByRole('button', { name: /1323年初|1322年初/ }).filter({ hasNotText: /移転/ }).click()
      const formerHolder = dialogs.filter({ has: page.getByRole('button', { name: '家系を開く', exact: true }) })
      await formerHolder.getByRole('button', { name: '家系を開く', exact: true }).click()
      const family = page.getByRole('dialog', { name: /^家系 / })
      await expect(family).toBeVisible()
      await close(family)
      await close(formerHolder)
      await close(ending)

      await get('obs-year-slider').press('Home')
      await stage(1250)
      await get('limited-registration-deferrals').getByRole('button').first().click()
      const budget = dialogs.filter({ hasText: '試遊の技術上の登録・追跡枠' })
      await expect(budget).toContainText('Event参照なし')
      await close(budget)
      await get('obs-person').selectOption(first)
      await page.getByRole('button', { name: '人物の資料を開く', exact: true }).click()
      const person = docs('人物', first)
      await person.getByLabel('この年の信頼を調べる相手').selectOption(second)
      await expect(person.getByTestId('relationship-basis')).toContainText('UNKNOWN')
      const trust = person.getByTestId('recorded-effective-trust')
      await expect(trust).toContainText('27')
      await trust.locator('..').getByRole('button').click()
      const originalTrace = page.getByRole('dialog', { name: /^Trace / }).filter({ has: get('recorded-effective-trust') })
      await expect(originalTrace.getByTestId('document-reference')).toHaveText('A0 / 1250年 / seed 20260303')
      await expect(originalTrace).toContainText('不採用')
      await expect(originalTrace).toContainText('Event参照なし')
      const originalTraceName = await originalTrace.getAttribute('aria-label')
      await close(originalTrace)
      await person.getByRole('button', { name: 'この人物と年から介入を検討する', exact: true }).click()
      await expect(form.getByTestId('branch-fork-year')).toHaveValue('1250')
      for (const id of ['branch-person-two', 'branch-trust-delta', 'branch-duration']) await expect(form.getByTestId(id)).toHaveValue('')
      await expect(form.getByTestId('branch-run')).toBeDisabled()
      await form.getByTestId('branch-person-two').selectOption(second)
      await form.getByTestId('branch-trust-delta').fill('20')
      await form.getByTestId('branch-duration').fill('1')
      await form.getByTestId('branch-run').click()
      for (const field of ['person-one', 'person-two', 'trust-delta', 'fork-year', 'duration']) {
        await expect(form.getByTestId(`branch-${field}`)).toBeDisabled()
      }
      await expect(compareButton).toBeVisible({ timeout: 45_000 })
      await checkView('ACHIEVED')
      await compareButton.click()
      await expect(comparison).toContainText('介入年 1250年／観測年 1250年')
      await expect(comparison).toContainText(/A0 条件に不一致.*A1 条件に一致/)
      await expect(comparison).toContainText('有効な統治委任により条件を満たしている')
      await expect(comparison.getByRole('region', { name: '年初の状態差' })).toContainText('実値に差なし')
      const change = comparison.getByRole('region', { name: '記録差分' }).getByRole('button', { name: /婚姻/ }).first()
      await change.click()
      const marriage = dialogs.filter({ has: page.getByRole('heading', { name: /年内の出来事：.*婚姻/ }) })
      await expect(marriage.getByTestId('document-reference')).toHaveText('A1 / 1250年 / seed 20260303')
      await expect(marriage.getByRole('heading', { name: '実判断記録' })).toBeVisible()
      const sourceFilter = 'この資料の出典の比較で絞り込む'
      await expect(marriage.getByRole('button', { name: sourceFilter })).toBeVisible()
      await marriage.getByTestId(`document-link-person-${first}`).click({ button: 'right' })
      await expect(marriage.getByRole('menuitem', { name: sourceFilter })).toBeVisible()
      await marriage.getByRole('menuitem', { name: 'メニューを閉じる' }).click()
      await close(marriage)
      const after = comparison.getByRole('region', { name: 'A1の記録' })
      await expect(after.getByTestId('relationship-basis')).toContainText('UNKNOWN')
      await expect(after.getByTestId('recorded-effective-trust')).toContainText('47')
      await expect(after.getByTestId('recorded-effective-trust')).toContainText('介入の補正を反映')
      await screenshot('改変史の技術判定')
      await after.getByTestId('recorded-effective-trust').scrollIntoViewIfNeeded()
      await screenshot('改変史の実判断')
      const year = comparison.getByLabel('比較する年')
      await year.fill('1251')
      await year.press('Enter')
      const before = comparison.getByRole('region', { name: 'A0の記録' })
      await expect(before.getByTestId('relationship-basis')).toContainText('27（1250年までの基礎値・記録済み（RECORDED））')
      await year.fill('1350')
      await year.press('Enter')
      await expect(comparison).toContainText('評価年は年内Event・Traceを比較しません')
      await comparison.getByRole('button', { name: '元の調査へ戻る' }).click()
      await stage(1250)
      await expect(page.getByRole('dialog', { name: originalTraceName!, exact: true }).getByTestId('document-reference')).toHaveText('A0 / 1250年 / seed 20260303')
      for (const button of await dialogs.getByRole('button', { name: '資料を閉じる' }).all().then(xs => xs.reverse())) {
        // Locatorの添字は閉じるたびに変わるので末尾から閉じる。
        await button.click()
      }
      await page.getByRole('button', { name: '翌年', exact: true }).click()
      await stage(1251)
      await page.getByRole('button', { name: '人物の資料を開く', exact: true }).click()
      await person.getByLabel('この年の信頼を調べる相手').selectOption('person-exp-01')
      await expect(person.getByTestId('relationship-basis')).toContainText('32（1250年までの基礎値・過去の記録・初期値から導出（DERIVED））')
      await close(person)
      await get('obs-year-slider').press('Home')
      await stage(1250)
      await expect.poll(() => page.evaluate(() => {
        const { observation, initial } = window as unknown as Probe
        return observation?.observation.a0Source === 'REUSED' && JSON.stringify(observation.observation) ===
          JSON.stringify({ ...initial?.observation, a0Source: 'REUSED' })
      })).toBe(true)

      if (width === 960) {
        await page.getByRole('button', { name: '介入の資料を開く', exact: true }).click()
        await form.getByTestId('branch-trust-delta').fill('1')
        await form.getByTestId('branch-run').click()
        await expect(form.getByTestId('branch-notice')).toContainText('計算が完了', { timeout: 45_000 })
        await checkView('NOT_ACHIEVED')
        await compareButton.click()
        await expect(comparison).toContainText(/A0 条件に不一致.*A1 条件に不一致/)
        const omittedYear = await page.evaluate(() => Number(Object.entries((window as unknown as Probe).compared?.view.displayOmission?.byYear ?? {})
          .find(([, omission]) => (omission?.omittedTracesByRule['B-009'] ?? 0) > 0)?.[0]))
        expect(omittedYear).toBeGreaterThan(1249)
        await year.fill(String(omittedYear))
        await year.press('Enter')
        await expect(before).toContainText('転送省略あり')
        await expect(before.getByTestId('relationship-basis')).toBeVisible()
        await comparison.getByRole('button', { name: '元の調査へ戻る' }).click()
        while (await dialogs.getByRole('button', { name: '資料を閉じる' }).count()) await dialogs.getByRole('button', { name: '資料を閉じる' }).last().click()
        await page.getByRole('button', { name: '介入の資料を開く', exact: true }).click()
        await form.getByTestId('branch-trust-delta').fill('20')
        await expect(compareButton).toHaveCount(0)
        await expect(form.getByTestId('branch-notice')).toHaveCount(0)
        await expect(page.getByRole('button', { name: 'A0とA1の比較を開く', exact: true })).toHaveCount(0)
        await arm('differentInput')
        await form.getByTestId('branch-run').click()
        await expect(form.getByRole('alert')).toContainText('HISTORY_MISMATCH')
        await form.getByRole('button', { name: '介入を閉じる', exact: true }).click()
        await get('obs-person').selectOption(second)
        await get('obs-to-intervention').click()
        await expect(form.getByTestId('branch-person-one')).toHaveValue(second)
        await expect(page.getByRole('button', { name: 'A0とA1の比較を開く', exact: true })).toHaveCount(0)
        await form.getByRole('button', { name: '介入を閉じる', exact: true }).click()
        for (const fault of ['identity', 'branch', 'candidates', 'oldYear'] as const) {
          await arm(fault)
          await (fault === 'oldYear' ? page.getByRole('button', { name: '翌年', exact: true }) : get('obs-start')).click()
          await expect(get('obs-error')).toContainText('HISTORY_MISMATCH')
          await stage(1250)
        }
        await arm('hold')
        await get('obs-start').click()
        await expect(get('obs-loading')).toBeVisible()
        const terminations = () => page.evaluate(() => (window as unknown as Probe).terminations)
        const beforeExit = await terminations()
        await page.getByRole('button', { name: '限定試遊を退出して通常入口へ' }).click()
        await expect.poll(terminations).toBe(beforeExit + 1)
        await expect(get('obs-intro')).toBeVisible()
        await expect(dialogs).toHaveCount(0)
        await get('obs-start').click()
        await page.evaluate(() => (window as unknown as Probe).late?.())
        await stage(1250)
        expect(await page.evaluate(() => (window as unknown as Probe).observation?.observation.configDigest)).toBe('5090c8485f4b8570')
        await openLimited()
        await expect(get('obs-intro')).toBeVisible()
        await get('obs-start').click()
        await stage(1250)
        expect(await page.evaluate(() => (window as unknown as Probe).observation?.observation.a0Source)).toBe('COMPUTED')
        const beforeRestart = await terminations()
        await page.getByRole('button', { name: '限定試遊を最初からやり直す' }).click()
        await expect.poll(terminations).toBe(beforeRestart + 1)
        await expect(get('obs-intro')).toBeVisible()
        await expect(dialogs).toHaveCount(0)
      }
      expect(errors).toEqual([])
    } finally {
      const workerV8Heap = await finishHeap()
      const timings = await page.evaluate(() => (window as unknown as Probe).timings)
      const metrics = { width, timings, workerV8Heap, nativeWorkerPeak: 'UNVERIFIED' }
      console.info(JSON.stringify(metrics))
      await testInfo.attach('Worker実測', { body: JSON.stringify(metrics, null, 2), contentType: 'application/json' })
    }
  })
}
