import { readFile } from 'node:fs/promises'
import { expect, test } from '@playwright/test'
import type { Locator, Page } from '@playwright/test'
import type { WorkerRequest, WorkerResponse } from '../../src/ui/play-worker.ts'
import { parseEvidence } from '../../src/ui/playtest-evidence/schema.ts'

test.use({ locale: 'ja-JP', viewport: { width: 1440, height: 960 } })
const firstPersonId = 'person-exp-02'
const secondPersonId = 'person-exp-05'

const controls = (page: Page) => {
  const panel = page.getByTestId('playtest-evidence')
  return { panel, a0: panel.getByRole('group', { name: 'A0 原史観測' }), pair: panel.getByRole('group', { name: /A0\/A1 比較/ }) }
}
const copy = (group: Locator) => group.getByRole('button', { name: 'JSON をコピー' })
const save = (group: Locator) => group.getByRole('button', { name: 'JSON を保存' })
const stage = (page: Page, year: number) => expect(page.getByTestId('obs-chronicle')).toHaveAttribute('data-year', String(year), { timeout: 60_000 })
async function enter(page: Page) {
  await page.goto('./')
  await page.getByRole('button', { name: '限定試遊を開始', exact: true }).click()
  await page.getByText('技術情報', { exact: true }).click()
}

async function openIntervention(page: Page) {
  await page.getByTestId('obs-person').selectOption(firstPersonId)
  await page.getByRole('button', { name: '人物の資料を開く', exact: true }).click()
  const person = page.getByRole('dialog', { name: `人物 ${firstPersonId}`, exact: true })
  await person.getByRole('button', { name: 'この人物と年から介入を検討する', exact: true }).click()
  await person.getByRole('button', { name: '資料を閉じる' }).click()
  const form = page.getByRole('dialog', { name: '介入', exact: true })
  await form.getByTestId('branch-person-two').selectOption(secondPersonId)
  await form.getByTestId('branch-trust-delta').fill('20')
  await form.getByTestId('branch-duration').fill('1')
  await form.getByTestId('branch-run').click()
  await form.getByRole('button', { name: '同じ年の歴史を比較' }).click({ timeout: 60_000 })
  return page.getByRole('dialog', { name: '歴史の比較', exact: true })
}

test('証跡の技術情報は限定試遊にだけ表示し、未観測では保存を許可しない', async ({ page }) => {
  await page.goto('./')
  await expect(controls(page).panel).toHaveCount(0)
  await enter(page)
  const { a0, pair } = controls(page)
  for (const group of [a0, pair]) {
    await expect(copy(group)).toBeDisabled()
    await expect(save(group)).toBeDisabled()
  }
})

test('実 Worker の原史・比較のコピーと保存は同じ証跡になる', async ({ page, context }, info) => {
  test.skip(process.env.CHRONOFORK_E2E_LIMITED !== '1', 'CHRONOFORK_E2E_LIMITED=1 で100年の実計算を行う')
  test.setTimeout(180_000)
  await context.grantPermissions(['clipboard-read', 'clipboard-write'])
  let requests = 0
  type CountsByYear = Record<string, { events: number; traces: number }>
  let omissions: CountsByYear | undefined
  const errors: string[] = []
  page.on('console', message => {
    const text = message.text()
    if (text === '証跡テスト: Worker 要求') requests++
    if (text.startsWith('証跡テスト: 省略 ')) omissions = JSON.parse(text.slice('証跡テスト: 省略 '.length))
  })
  page.on('pageerror', error => errors.push(error.message))
  await page.addInitScript(() => {
    const send = Worker.prototype.postMessage
    Worker.prototype.postMessage = function (message: WorkerRequest, transfer?: Transferable[] | StructuredSerializeOptions) {
      console.info('証跡テスト: Worker 要求')
      if ('input' in message) {
        const receive = ({ data }: MessageEvent<WorkerResponse>) => {
          if ('kind' in data) return
          this.removeEventListener('message', receive)
          if (!data.ok || !('view' in data)) return
          const count = (counts: Record<string, number>) => Object.values(counts).reduce((a, b) => a + b, 0)
          const byYear = Object.entries(data.view.displayOmission?.byYear ?? {}).flatMap(([year, summary]) => summary ? [[year, {
            events: count(summary.omittedEventsByType), traces: count(summary.omittedTracesByRule),
          }]] : [])
          console.info('証跡テスト: 省略 ' + JSON.stringify(Object.fromEntries(byYear)))
        }
        this.addEventListener('message', receive)
      }
      if (Array.isArray(transfer)) send.call(this, message, { transfer })
      else send.call(this, message, transfer)
    }
  })
  await enter(page)
  const { a0, pair } = controls(page)
  await expect(save(a0)).toBeDisabled()
  await expect(save(pair)).toBeDisabled()
  const displayedBuild = (await page.getByTestId('build-identity').innerText()).split('/').at(-1)!.trim()
  const expectedBuild = process.env.PAGES_EXPECTED_SHA || process.env.VITE_BUILD_SHA || 'local'
  expect(displayedBuild).toBe(expectedBuild)
  const build = expectedBuild === 'local' ? { kind: 'LOCAL', reason: 'LOCAL' } : { kind: 'COMMIT', sha: expectedBuild }
  const collect = async (group: Locator, name: string) => {
    const before = requests
    await copy(group).click()
    await expect(group.getByText('JSON をコピーしました。')).toBeVisible()
    const clipboard = await page.evaluate(() => navigator.clipboard.readText())
    const waiting = page.waitForEvent('download')
    await save(group).click()
    const download = await waiting
    await expect(group.getByText('JSON のダウンロードを開始しました。')).toBeVisible()
    const path = info.outputPath(name)
    await download.saveAs(path)
    const body = await readFile(path, 'utf8')
    expect(body).toBe(clipboard)
    expect(Buffer.byteLength(body)).toBeLessThanOrEqual(64 * 1024)
    expect(requests).toBe(before)
    const result = parseEvidence(body)
    expect(result).toMatchObject({ build, seed: 20260303, debug: null,
      config: { mode: 'MULTI_HOUSE_EXPERIMENTAL', configuration: 'LIMITED_PLAYTEST', configDigest: '844299b001142fee' },
      player: { status: 'COMPLETED', channel: 'PLAYER', officialGoal: 'NOT_ESTABLISHED' } })
    expect(result.config.identitySha256).toMatch(/^[0-9a-f]{64}$/)
    return result
  }

  await page.getByTestId('obs-start').click()
  await expect(page.getByTestId('obs-loading')).toBeVisible()
  await expect(copy(a0)).toBeDisabled()
  await stage(page, 1250)
  await expect(a0).toContainText('1250年・主観測')
  const observation = await collect(a0, 'a0.json')
  await page.screenshot({ path: info.outputPath('observation.png') })
  expect(observation).toMatchObject({ kind: 'OBSERVATION', year: 1250, branch: 'A0', intervention: null, transfer: 'FULL',
    player: { branches: [{ branch: 'A0', coverage: { kind: 'COMPLETE', omission: null } }] } })

  const comparison = await openIntervention(page)
  await expect(comparison).toContainText('観測年 1250年')
  const year = comparison.getByLabel('比較する年')
  const omitted = Object.entries(omissions ?? {}).find(([y, count]) => Number(y) > 1250 && count.events + count.traces > 0)
  if (!omitted) throw new Error('実 Worker の比較 DTO に転送省略がある年を取得できません')
  const [selectedYear, counts] = omitted
  await year.fill(selectedYear)
  await year.press('Enter')
  await expect(pair).toContainText(`${selectedYear}年・比較資料の選択年`)
  await expect(a0).toContainText('1250年・主観測')
  const compared = await collect(pair, 'a0-a1.json')
  expect(compared).toMatchObject({ kind: 'COMPARISON', year: Number(selectedYear), transfer: 'DISPLAY_YEAR',
    intervention: { firstPersonId, secondPersonId, year: 1250, signedDelta: 20, durationYears: 1 },
    player: { branches: [{ branch: 'A0', modifierIds: [] }, { branch: 'A1', modifierIds: [compared.intervention!.modifierId] }] } })
  for (const branch of compared.player.branches) {
    expect(branch.yearStart.population).toBeGreaterThan(0)
    expect(branch.events.sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(branch.coverage).toMatchObject({ kind: 'TRANSFER_OMISSION', omission: { scope: 'YEAR', ...counts } })
  }
  await page.screenshot({ path: info.outputPath('comparison.png') })
  await comparison.getByRole('button', { name: '歴史の比較を閉じる' }).click()
  await expect(save(pair)).toBeDisabled()
  await expect(pair).not.toContainText('ダウンロードを開始')
  await page.getByRole('button', { name: '限定試遊を最初からやり直す' }).click()
  await page.getByText('技術情報', { exact: true }).click()
  await expect(save(a0)).toBeDisabled()

  // 後年の介入では Worker 応答の分岐年初がキー順だけ異なり得る。実計算の比較を採用して保存できること。
  await page.getByTestId('obs-start').click()
  await stage(page, 1250)
  await page.getByRole('button', { name: '翌年', exact: true }).click()
  await stage(page, 1251)
  const later = await openIntervention(page)
  await expect(later).toContainText('観測年 1251年')
  const laterCompared = await collect(pair, 'a0-a1-1251.json')
  expect(laterCompared).toMatchObject({ kind: 'COMPARISON', year: 1251,
    intervention: { firstPersonId, secondPersonId, year: 1251, signedDelta: 20, durationYears: 1 },
    player: { branches: [{ branch: 'A0', modifierIds: [] }, { branch: 'A1', modifierIds: [laterCompared.intervention!.modifierId] }] } })
  await later.getByRole('button', { name: '歴史の比較を閉じる' }).click()
  await expect(save(pair)).toBeDisabled()
  await page.getByRole('button', { name: '限定試遊を退出して通常入口へ' }).click()
  await expect(controls(page).panel).toHaveCount(0)
  expect(errors).toEqual([])
})


test('観測の中断・失敗と非同期生成中の年変更では旧証跡を出さない', async ({ page }) => {
  test.skip(process.env.CHRONOFORK_E2E_LIMITED !== '1', 'CHRONOFORK_E2E_LIMITED=1 で100年の実計算を行う')
  test.setTimeout(180_000)
  type Probe = Window & { holdHash?: boolean; releaseHash?: () => void; fault?: 'fail' | 'hold'; copies: number }
  await page.addInitScript(() => {
    const probe = window as unknown as Probe
    probe.copies = 0
    const digest = SubtleCrypto.prototype.digest
    SubtleCrypto.prototype.digest = async function (algorithm, data) {
      if (probe.holdHash) {
        probe.holdHash = false
        await new Promise<void>(resolve => { probe.releaseHash = resolve })
      }
      return digest.call(this, algorithm, data)
    }
    Object.defineProperty(navigator.clipboard, 'writeText', { value: async () => {
      probe.copies++
      throw new Error('NotAllowedError')
    } })
    const send = Worker.prototype.postMessage
    Worker.prototype.postMessage = function (message: WorkerRequest, transfer?: Transferable[] | StructuredSerializeOptions) {
      if (probe.fault) {
        const fault = probe.fault
        delete probe.fault
        if (fault === 'fail') queueMicrotask(() => this.onmessage?.(new MessageEvent<WorkerResponse>('message', {
          data: { ok: false, code: 'TEST_FAILURE', message: '検証用の失敗応答', computeMs: 0 },
        })))
        return
      }
      send.call(this, message, Array.isArray(transfer) ? { transfer } : transfer)
    }
  })
  await enter(page)
  const { a0, pair } = controls(page)
  await page.getByTestId('obs-start').click()
  await stage(page, 1250)
  await page.evaluate(() => { (window as unknown as Probe).holdHash = true })
  await copy(a0).click()
  await expect.poll(() => page.evaluate(() => !!(window as unknown as Probe).releaseHash)).toBe(true)
  await page.getByRole('button', { name: '翌年', exact: true }).click()
  await stage(page, 1251)
  await page.evaluate(() => (window as unknown as Probe).releaseHash?.())
  await copy(a0).click()
  await expect(a0.getByRole('alert')).toContainText('書き込めませんでした')
  const manual = await a0.getByRole('textbox', { name: '手動コピー用 JSON' }).inputValue()
  expect(parseEvidence(manual).year).toBe(1251)
  expect(await page.evaluate(() => (window as unknown as Probe).copies)).toBe(1)
  const downloadEvent = page.waitForEvent('download')
  await save(a0).click()
  const download = await downloadEvent
  expect(await readFile((await download.path())!, 'utf8')).toBe(manual)

  await page.getByTestId('obs-year-slider').press('Home')
  await stage(page, 1250)
  const comparison = await openIntervention(page)
  const holdCopy = async (group: Locator) => {
    await page.evaluate(() => {
      const probe = window as unknown as Probe
      delete probe.releaseHash
      probe.holdHash = true
    })
    await copy(group).click()
    await expect.poll(() => page.evaluate(() => !!(window as unknown as Probe).releaseHash)).toBe(true)
  }
  const release = () => page.evaluate(() => (window as unknown as Probe).releaseHash?.())
  await holdCopy(pair)
  const compareYear = comparison.getByLabel('比較する年')
  await compareYear.fill('1252')
  await compareYear.press('Enter')
  await expect(pair).toContainText('1252年・比較資料の選択年')
  await release()
  await holdCopy(pair)
  await comparison.getByRole('button', { name: '歴史の比較を閉じる' }).click()
  await release()
  await expect(copy(pair)).toBeDisabled()
  await expect(pair.getByRole('alert')).toHaveCount(0)

  const form = page.getByRole('dialog', { name: '介入', exact: true })
  for (const fault of ['fail', 'hold'] as const) {
    await page.getByRole('button', { name: '介入の資料を開く', exact: true }).click()
    await page.evaluate(value => { (window as unknown as Probe).fault = value }, fault)
    await form.getByTestId('branch-run').click()
    if (fault === 'hold') {
      await expect(form.getByTestId('branch-running')).toBeVisible()
      await expect(save(pair)).toBeDisabled()
      await form.getByTestId('branch-cancel').click()
      await expect(form.getByTestId('branch-notice')).toContainText('キャンセル')
    } else await expect(form.getByRole('alert')).toBeVisible()
    await form.getByRole('button', { name: '介入を閉じる' }).click()
    await page.getByRole('button', { name: 'A0とA1の比較を開く', exact: true }).click()
    await expect(comparison).toBeVisible()
    await expect(save(pair)).toBeDisabled()
    await comparison.getByRole('button', { name: '歴史の比較を閉じる' }).click()
  }

  for (const fault of ['fail', 'hold'] as const) {
    await page.evaluate(value => { (window as unknown as Probe).fault = value }, fault)
    // 同じ年の再試行でも、前回の採用結果を現行として扱わない。
    await page.getByTestId('obs-start').click()
    if (fault === 'hold') {
      await expect(page.getByTestId('obs-loading')).toBeVisible()
      await expect(save(a0)).toBeDisabled()
      await page.getByTestId('obs-cancel').click()
    }
    await expect(page.getByTestId('obs-error')).toBeVisible()
    await stage(page, 1250)
    await expect(save(a0)).toBeDisabled()
    await expect(a0.getByRole('textbox')).toHaveCount(0)
  }
  await page.getByTestId('obs-start').click()
  await expect(copy(a0)).toBeEnabled({ timeout: 60_000 })
  await holdCopy(a0)
  await page.getByRole('button', { name: '限定試遊を退出して通常入口へ' }).click()
  await release()
  await expect(controls(page).panel).toHaveCount(0)
  expect(await page.evaluate(() => (window as unknown as Probe).copies)).toBe(1)
})
