import { expect, test } from '@playwright/test'
import type { Page } from '@playwright/test'
import type { WorkerRequest, WorkerResponse } from '../../src/ui/play-worker.ts'

test.use({ locale: 'ja-JP' })

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
  await expect(page).toHaveURL(/\?play=limited$/)
  await page.reload()
  await expect(page.getByRole('button', { name: '限定試遊を開始', exact: true })).toHaveCount(0)
  await expect(page.getByTestId('obs-seed-input')).toHaveCount(0)
  await expect(page.getByTestId('legacy-workspace')).toHaveCount(0)
  await page.getByRole('button', { name: '限定試遊を最初からやり直す' }).click()
  await expect(page.getByTestId('obs-intro')).toBeVisible()
  await page.getByRole('button', { name: '限定試遊を退出して通常入口へ' }).click()
  await expect(page).toHaveURL('/')
  await expect(page.getByTestId('obs-seed-input')).toHaveValue('20260101')
  await expect(page.getByTestId('legacy-workspace')).toHaveCount(1)
  await page.goto('/?play=limited')
  await expect(page.getByTestId('obs-intro')).toBeVisible()
  await expect(page.getByRole('button', { name: '限定試遊を開始', exact: true })).toHaveCount(0)
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
    await page.goto('/?play=limited')
    const finishHeap = await measureWorkerHeap(page)
    const get = (id: string) => page.getByTestId(id)
    const dialogs = page.getByRole('dialog')
    const documents = get('desk-document')
    const docs = (kind: string, id: string) => documents.and(page.locator(`[data-kind="${kind}"][data-target="${id}"]`))
    const stage = async (year: number) => {
      await expect(get('obs-chronicle')).toHaveAttribute('data-year', String(year), { timeout: 45_000 })
      await expect(get('obs-world-explorer')).toHaveAttribute('data-year', String(year))
      await expect(get('obs-chronicle').locator('[aria-current=date]')).toHaveAttribute('data-chronicle-year', String(year))
    }
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
    const openPerson = async (id: string) => {
      const picker = get('obs-person')
      if (!(await picker.isVisible())) await page.getByText('人物・称号の索引', { exact: true }).click()
      await picker.selectOption(id)
      await page.getByRole('button', { name: '人物の資料を開く', exact: true }).click()
      return docs('person', id)
    }
    const choosePartner = async (person: ReturnType<typeof docs>, name: string) => {
      await person.getByText('相手を探す', { exact: true }).click()
      await person.getByRole('searchbox', { name: '名前' }).fill(name)
      await person.getByRole('list', { name: '信頼の相手候補' }).getByRole('button', { name, exact: true }).click()
    }
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
      await get('obs-start').click()
      await stage(1250)
      const endingGoal = get('obs-goal')
      await expect(endingGoal).toContainText('参考判定：条件を満たしていない')
      await expect(endingGoal.locator('.obs-ending-territories > li')).toHaveCount(6)
      for (const id of ['obs-person-year-state', 'obs-title-detail', 'obs-event-detail', 'obs-trace-detail']) await expect(get(id)).toHaveCount(0)
      await endingGoal.scrollIntoViewIfNeeded()
      await screenshot('原史の結末')
      const opening = endingGoal.getByRole('button', { name: /中央.*継承の経緯/ })
      const ending = docs('ending', 'title-exp-central')
      const earlier = docs('title', 'title-exp-central')
      await opening.click()
      await expect(ending.getByTestId('succession-evidence')).toContainText(/1324年内.*保持者が死亡.*保留案件の登録.*保持者を未確定にした記録/s)
      await expect(ending).toContainText(/1325年初.*保持者は未確定.*1325〜1349年内の再審査.*確立した後継者がいない/s)
      await expect(ending).toContainText('全候補と個別の適格性までは残っていません')
      await stage(1250)
      await screenshot('原史の中央領地')
      if (width === 960) await arm('identity')
      await ending.getByRole('button', { name: '称号', exact: true }).click()
      if (width === 960) {
        for (const fault of ['branch', 'oldYear'] as const) {
          await expect(earlier).toContainText('HISTORY_MISMATCH')
          await expect(earlier).not.toContainText('年初の保持者')
          await stage(1250)
          await arm(fault)
          await earlier.getByRole('button', { name: '取得', exact: true }).click()
        }
        await expect(earlier).toContainText('HISTORY_MISMATCH')
        await earlier.getByRole('button', { name: '取得', exact: true }).click()
      }
      await expect(earlier.getByTestId('document-reference')).toHaveText('A0 / 1325年 / seed 20260303')
      await expect(earlier).toContainText('年初の保持者：未確定')
      await expect(documents).toHaveCount(1)
      await stage(1250)
      await earlier.getByRole('button', { name: '戻る', exact: true }).click()
      await ending.getByRole('button', { name: '1325年の判断', exact: true }).click()
      const succession = documents.filter({ hasText: '後継者や継承結果を直接変更する介入はありません' })
      await expect(succession).toContainText('確立した後継者がいない')
      await expect(succession).toContainText('Event参照なし')
      await screenshot('継承判断')
      await succession.getByRole('button', { name: '戻る', exact: true }).click()
      await ending.getByRole('button', { name: '前保持者の家系' }).click()
      const family = documents.and(page.locator('[data-kind=family]'))
      await expect(family.getByTestId('document-reference')).toHaveText('A0 / 1324年 / seed 20260303')
      await expect(family.getByTestId('family-legal-dynasty')).toContainText('ナルヴェン')
      await expect(documents).toHaveCount(1)
      await stage(1250)
      await screenshot('家系資料')
      await family.getByRole('button', { name: '戻る', exact: true }).click()
      await ending.getByText('婚姻・出生の判断', { exact: true }).click()
      await expect(ending).toContainText(/1322〜1323年：出生：出生枠・抽選で出生が選ばれなかった/)
      await expect(ending).toContainText(/1324年：出生：親が不在/)
      await ending.getByRole('button', { name: /^婚姻候補：/ }).first().click()
      const candidate = documents.filter({ has: page.getByRole('heading', { name: '婚姻候補の審査', exact: true }) })
      await expect(candidate.getByTestId('document-reference')).toHaveText('A0 / 1321年 / seed 20260303')
      await stage(1250)
      await candidate.getByRole('button', { name: '1321年のこの2人の信頼を介入として検討する' }).click()
      await expect(form.getByTestId('branch-fork-year')).toHaveValue('1321')
      await expect(form.getByTestId('branch-trust-delta')).toHaveValue('')
      await expect(form.getByTestId('branch-duration')).toHaveValue('')
      if (width === 960) {
        // 画面だけでの独立探索で見つかった、後年分岐の正しい年初DTOが拒否される回帰。
        await form.getByTestId('branch-trust-delta').fill('-10')
        await form.getByTestId('branch-duration').fill('1')
        await form.getByTestId('branch-run').click()
        await expect(compareButton).toBeVisible({ timeout: 45_000 })
        expect(await page.evaluate(() => (window as unknown as Probe).compared?.view.input.year)).toBe(1321)
        await checkView('NOT_ACHIEVED')
        await compareButton.click()
        await expect(comparison).toBeVisible()
        await comparison.getByRole('button', { name: '元の調査へ戻る' }).click()
        await stage(1250)
      } else {
        await form.getByRole('button', { name: '介入を閉じる', exact: true }).click()
      }
      await close(candidate)
      const firstYear = get('obs-chronicle').locator('[data-chronicle-year="1250"]')
      await firstYear.getByRole('button', { name: /^全記録/ }).click()
      const records = docs('records', '1250')
      await records.getByLabel('記録の種類').selectOption('trace')
      const registration = records.getByRole('button', { name: /登録枠を超えるため、婚姻登録を保留/ })
      const more = records.getByRole('button', { name: 'さらに表示', exact: true })
      while (await registration.count() < 4 && await more.isVisible()) await more.click()
      await expect(registration).toHaveCount(4)
      await registration.first().click()
      const budget = documents.filter({ hasText: '試遊の技術上の登録・追跡枠' })
      await expect(budget).toContainText('Event参照なし')
      await close(budget)
      const person = await openPerson(first)
      await choosePartner(person, '試験人物05')
      await expect(person.getByTestId('relationship-basis')).toContainText('UNKNOWN')
      const trust = person.getByTestId('recorded-effective-trust')
      await expect(trust).toContainText('27')
      await trust.locator('..').getByRole('button').click()
      const originalTrace = documents.and(page.locator('[data-kind=trace]')).filter({ has: get('recorded-effective-trust') })
      await expect(originalTrace.getByTestId('document-reference')).toHaveText('A0 / 1250年 / seed 20260303')
      await expect(originalTrace).toContainText('不採用')
      await expect(originalTrace.getByTestId('recorded-effective-trust')).toContainText('比較に使った得点 27。採用の閾値 30。')
      await expect(originalTrace).toContainText('Event参照なし')
      const originalTraceName = await originalTrace.getAttribute('aria-label')
      await screenshot('実判断の根拠')
      await page.getByRole('button', { name: '翌年', exact: true }).press('Enter')
      await stage(1251)
      await originalTrace.getByRole('button', { name: '1250年のこの2人の信頼を介入として検討する' }).click()
      await close(originalTrace)
      await expect(form.getByTestId('branch-fork-year')).toHaveValue('1250')
      await expect(form.getByTestId('branch-person-two')).toHaveValue(second)
      for (const id of ['branch-trust-delta', 'branch-duration']) await expect(form.getByTestId(id)).toHaveValue('')
      await expect(form.getByTestId('branch-run')).toBeDisabled()
      await screenshot('判断から介入フォーム')
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
      await expect(marriage.getByRole('button', { name: '比較で絞る', exact: true })).toBeVisible()
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
      await stage(1251)
      await expect(page.getByRole('dialog', { name: originalTraceName!, exact: true }).getByTestId('document-reference')).toHaveText('A0 / 1250年 / seed 20260303')
      await screenshot('元の調査へ復帰')
      for (const button of await dialogs.getByRole('button', { name: '資料を閉じる' }).all().then(xs => xs.reverse())) {
        // Locatorの添字は閉じるたびに変わるので末尾から閉じる。
        await button.click()
      }
      await openPerson(first)
      await choosePartner(person, '試験人物01')
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
        await (await openPerson(second)).getByRole('button', { name: 'この人物と年から介入を検討する', exact: true }).click()
        await expect(form.getByTestId('branch-person-one')).toHaveValue(second)
        await expect(form.getByTestId('branch-person-two')).toHaveValue('')
        await expect(page.getByRole('button', { name: 'A0とA1の比較を開く', exact: true })).toHaveCount(0)
        await form.getByRole('button', { name: '介入を閉じる', exact: true }).click()
        for (const fault of ['identity', 'branch', 'candidates', 'oldYear'] as const) {
          await arm(fault)
          await page.getByRole('button', { name: '翌年', exact: true }).click()
          await expect(get('obs-error')).toContainText('HISTORY_MISMATCH')
          await stage(1250)
        }
        await arm('hold')
        await page.getByRole('button', { name: '翌年', exact: true }).click()
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

  test(`同じ原史で資料を整理せず読み進める・${width}px`, async ({ page }, testInfo) => {
    test.skip(process.env.CHRONOFORK_E2E_LIMITED !== '1', '限定試遊の実A0を使用する')
    test.setTimeout(180_000)
    await page.setViewportSize({ width, height: 900 })
    const get = (id: string) => page.getByTestId(id)
    const documents = get('desk-document')
    const work = documents.and(page.locator('[data-slot=work]'))
    const fixed = documents.and(page.locator('[data-slot=fixed]'))
    const chronicle = get('obs-chronicle')
    const measurements: { action: string; year: string | null; documents: number }[] = []
    const measure = async (action: string, year: number, count: number) => {
      await expect(chronicle).toHaveAttribute('data-year', String(year), { timeout: 45_000 })
      await expect(get('obs-world-explorer')).toHaveAttribute('data-year', String(year))
      await expect(chronicle.locator('[aria-current=date]')).toHaveAttribute('data-chronicle-year', String(year))
      await expect(documents).toHaveCount(count)
      measurements.push({ action, year: await chronicle.getAttribute('data-year'), documents: await documents.count() })
    }
    const image = async (name: string) => {
      await page.evaluate(() => document.fonts.ready.then(() => undefined))
      await page.screenshot({ path: testInfo.outputPath(`${name}-${width}.png`), animations: 'disabled' })
    }
    const button = (name: string, doc = work) => doc.getByRole('button', { name, exact: true })
    const access = async () => {
      for (const doc of await documents.all()) {
        await expect(doc).toHaveAccessibleName(/^(人物|家系|称号|継承|年代記) .+/)
        const controls = doc.locator('header').getByRole('button')
        for (const control of await controls.all()) {
          expect(await control.evaluate(el => {
            const r = el.getBoundingClientRect()
            return r.left >= 0 && r.right <= innerWidth && r.top >= 0 && r.bottom <= innerHeight &&
              el.contains(document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2))
          })).toBe(true)
        }
      }
    }
    const pageErrors: string[] = []
    page.on('pageerror', e => pageErrors.push(e.message))
    await page.goto('/?play=limited')
    await get('obs-start').click()
    await measure('原史を表示', 1250, 0)
    const goal = get('obs-goal')
    const central = goal.getByRole('listitem').filter({ has: page.getByRole('button', { name: /中央.*継承の経緯/ }) })
    const openEnding = central.getByRole('button', { name: /中央.*継承の経緯/ })
    await expect(goal).toContainText('評価時点：1350年初')
    await expect(central).toContainText('1325年初から保持者未確定')
    await expect(central).toContainText('保持者が必要')
    await expect(central).not.toContainText('理由の記録なし')
    await image('after-initial')
    await openEnding.click()
    await expect(work).toHaveAttribute('data-kind', 'ending')
    await button('称号').click()
    await expect(work).toContainText('年初の保持者：未確定')
    await measure('中央領地資料を開く', 1250, 1)
    await work.getByRole('button', { name: /1323年初/ }).click()
    await expect(work.getByTestId('document-reference')).toContainText('1323年')
    await expect(work).toContainText('年初 20歳（存命）')
    await measure('前保持者の資料', 1250, 1)
    await button('家系を開く').click()
    await expect(work.getByTestId('family-legal-dynasty')).toContainText('ナルヴェン')
    await measure('家系を開く', 1250, 1)
    await image('after-family')
    await button('戻る').click()
    await expect(work).toHaveAttribute('data-kind', 'person')
    await work.getByText('相手を探す', { exact: true }).click()
    const candidates = work.getByRole('list', { name: '信頼の相手候補' })
    const count = work.getByTestId('partner-count')
    await expect(candidates.getByRole('button')).toHaveCount(8)
    await expect(candidates).not.toContainText('死亡済み')
    const living = await count.innerText()
    expect(living).toContain('43人')
    const deceased = work.getByRole('checkbox', { name: '死亡済みの人物も参照' })
    await deceased.check()
    const historical = await count.innerText()
    expect(historical).toContain('73人')
    await deceased.uncheck()
    const related = work.getByRole('checkbox', { name: /親子・婚姻・当年の判断/ })
    await related.check()
    const relatedCount = await count.innerText()
    expect(relatedCount).not.toBe(living)
    await related.uncheck()
    const origin = work.getByRole('combobox', { name: '出身地域' })
    await origin.selectOption({ index: 1 })
    const originCount = await count.innerText()
    expect(originCount).not.toBe(living)
    await origin.selectOption('')
    const firstName = (await candidates.getByRole('button').first().innerText()).trim()
    await work.getByRole('searchbox', { name: '名前', exact: true }).fill(firstName)
    await candidates.getByRole('button', { name: firstName, exact: true }).click()
    await expect(work.getByTestId('relationship-basis')).toBeVisible()
    await image('after-partners')

    // 実ホイールが資料の端に届いたときの連鎖を、外側にスクロールの余裕を作って測る。
    const body = work.locator('.desk-document-body')
    const wheel = []
    for (const delta of [600, -600]) {
      const before = await body.evaluate((el, delta) => {
        window.scrollTo(0, delta > 0 ? 0 : 300)
        el.scrollTop = delta > 0 ? el.scrollHeight : 0
        const r = el.getBoundingClientRect()
        const x = r.left + 20, y = r.bottom - 15
        const hit = el.contains(document.elementFromPoint(x, y))
        const outerMax = document.documentElement.scrollHeight - innerHeight
        return { x, y, hit, outer: window.scrollY, outerMax, inner: el.scrollTop, innerMax: el.scrollHeight - el.clientHeight }
      }, delta)
      expect(before.hit).toBe(true)
      expect(delta > 0 ? before.outerMax - before.outer : before.outer).toBeGreaterThan(100)
      expect(before.innerMax).toBeGreaterThan(0)
      await page.mouse.move(before.x, before.y)
      await page.mouse.wheel(0, delta)
      await page.waitForTimeout(200) // Chromiumの非同期スクロールを待つ
      const after = await body.evaluate(el => ({ outer: window.scrollY, inner: el.scrollTop }))
      const edge = delta > 0 ? before.innerMax : 0
      // 外側の連鎖は一切許さない。内側の端だけ、CSSOMの整数寸法とChromiumの丸め差を許す。
      expect(Math.abs(before.inner - edge)).toBeLessThanOrEqual(1)
      expect(Math.abs(after.inner - edge)).toBeLessThanOrEqual(1)
      expect(after.outer).toBe(before.outer)
      wheel.push({ delta, before, after })
    }
    await button('固定').click()
    await measure('人物資料を固定', 1250, 1)
    await button('家系を開く', fixed).click()
    await measure('固定を残して家系を参照', 1250, 2)
    await access()
    await image('after-pinned')
    const self = await fixed.getAttribute('data-target')
    await work.getByTestId(`family-node-${self}`).click()
    await measure('同じ出典・対象の人物を再参照', 1250, 2)
    await expect(work).toHaveAttribute('data-kind', 'family')
    await button('解除', fixed).click()
    await measure('固定解除', 1250, 1)
    await button('1323年へ移動').click()
    await measure('資料から年へ明示移動', 1323, 1)
    await work.press('Escape')
    await expect(documents).toHaveCount(0)
    const active = chronicle.locator('[aria-current=date]')
    const area = chronicle.getByLabel('年代順の記録')
    await expect(active).toBeInViewport()
    const type = chronicle.getByRole('combobox', { name: '種類' })
    await type.selectOption('decision')
    const review = chronicle.locator('[data-chronicle-year="1325"]').getByRole('button', { name: /継承審査.*出来事なし/ }).first()
    await review.click()
    await expect(work).toContainText('Event参照なし')
    await measure('年代記から判断だけ読む', 1323, 1)
    await work.press('Escape')
    await type.selectOption('all')
    await chronicle.getByRole('searchbox', { name: '人物名' }).fill('該当しない名前')
    await expect(active).toContainText('該当する主要記録なし')
    await active.getByRole('button', { name: /^全記録/ }).click()
    await expect(work.getByRole('heading', { name: '1323年内の記録' })).toBeVisible()
    await expect(work.getByRole('button', { name: 'さらに表示', exact: true })).toBeVisible()
    await measure('絞り込みから独立した全記録', 1323, 1)
    await work.press('Escape')
    await chronicle.getByRole('searchbox', { name: '人物名' }).clear()
    await area.scrollIntoViewIfNeeded()
    await image('after-chronicle')
    expect(pageErrors).toEqual([])
    const report = { width, height: 900, seed: 20260303, measurements, candidates: { living, historical, relatedCount, originCount }, wheel, pageErrors }
    console.info(JSON.stringify(report))
    await testInfo.attach('操作計測', { body: JSON.stringify(report, null, 2), contentType: 'application/json' })
  })
}
