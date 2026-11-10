import { expect, test } from '@playwright/test'

// 統合法制・世代継続(experimental)。軽量版は通常CIで、100年の実計算(1〜数分)は明示オプトインで実行する:
//   CHRONOFORK_E2E_INTEGRATED=1 npx playwright test integrated-mode
const heavy = process.env.CHRONOFORK_E2E_INTEGRATED === '1'

test.describe('統合モード: 起動・計算中の操作・キャンセル(軽量)', () => {
  test.use({ viewport: { width: 1280, height: 800 } })

  test('モード選択でPR #78の実測条件が初期入力例に入り、計算中も操作でき、キャンセルで復旧する', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('play-law-mode').selectOption('INTEGRATED_EXPERIMENTAL')
    await expect(page.getByTestId('play-mode-description')).toContainText('PR #78')
    await expect(page.getByTestId('branch-fork-year')).toHaveValue('1250')
    await expect(page.getByTestId('branch-trust-delta')).toHaveValue('-20')
    await expect(page.getByTestId('branch-duration')).toHaveValue('5')
    await expect(page.getByTestId('branch-person-one')).toHaveValue('person-exp-02')
    await expect(page.getByTestId('branch-person-two')).toHaveValue('person-exp-05')
    await expect(page.getByLabel(/seed/)).toHaveValue('20260101')

    await page.getByTestId('branch-run').click()
    await expect(page.getByTestId('branch-running')).toContainText('計算中')
    await expect(page.getByTestId('branch-running')).not.toContainText(/%|残り/)
    await expect(page.getByTestId('branch-run')).toBeDisabled()
    // 計算中でもメインスレッドは空いており、地域選択など他の操作が即座に反映される。
    const t0 = Date.now()
    await page.getByTestId('region-node-region-eldia-south').click()
    await expect(page.getByTestId('detail').getByRole('heading', { name: 'エルディア南部' })).toBeVisible()
    expect(Date.now() - t0).toBeLessThan(3000)
    await page.getByRole('slider').focus()
    await page.keyboard.press('ArrowRight')
    await expect(page.getByTestId('current-year')).toContainText('1251年')
    // 経過秒が進む(実測できる値のみ。進捗率は出さない)。
    await expect(page.getByTestId('branch-running')).toContainText(/経過 [1-9]\d*秒/, { timeout: 15_000 })

    await page.getByTestId('branch-cancel').click()
    await expect(page.getByTestId('branch-running')).toHaveCount(0)
    await expect(page.getByTestId('branch-notice')).toContainText('キャンセル')
    await expect(page.getByTestId('branch-run')).toBeEnabled()
    await expect(page.getByTestId('branch-results')).toHaveCount(0)
    await expect(page.locator('body')).not.toContainText('参照不明')
  })

  test('旧2モードは従来どおり同期で再計算でき、統合モードの表示を出さない', async ({ page }) => {
    await page.goto('/')
    await page.getByTestId('branch-run').click()
    await expect(page.getByTestId('branch-results')).toBeVisible({ timeout: 60_000 })
    await expect(page.getByTestId('branch-status')).toContainText('A1 COMPLETED')
    await expect(page.getByTestId('integrated-overview')).toHaveCount(0)
    await expect(page.getByTestId('branch-running')).toHaveCount(0)
  })
})

test.describe('統合モード: 100年の実計算(オプトイン)', () => {
  test.skip(!heavy, 'CHRONOFORK_E2E_INTEGRATED=1 のときだけ実行する(1〜数分)')
  test.setTimeout(15 * 60_000)

  for (const width of [1280, 960]) {
    test(`統合モード選択→再計算→A0/A1切替→年表→判断根拠(${width}px)`, async ({ page }) => {
      await page.setViewportSize({ width, height: 900 })
      await page.goto('/')
      await page.getByTestId('play-law-mode').selectOption('INTEGRATED_EXPERIMENTAL')
      const started = Date.now()
      await page.getByTestId('branch-run').click()
      await expect(page.getByTestId('branch-running')).toBeVisible()
      // 計算中の操作性を実測する(メインスレッドの応答時間)。
      const latencies: number[] = []
      while (!(await page.getByTestId('branch-results').isVisible())) {
        const t = Date.now()
        await page.getByRole('tab', { name: '人物' }).click()
        latencies.push(Date.now() - t)
        await page.waitForTimeout(5_000)
        if (Date.now() - started > 12 * 60_000) throw new Error('統合モードの計算が12分で終わりません')
      }
      const wallMs = Date.now() - started
      console.info('CHRONOFORK_E2E_INTEGRATED=' + JSON.stringify({ width, wallMs, maxUiLatencyMs: Math.max(0, ...latencies), samples: latencies.length }))
      expect(Math.max(0, ...latencies)).toBeLessThan(3000)

      await expect(page.getByTestId('branch-error')).toHaveCount(0)
      await expect(page.getByTestId('integrated-overview')).toBeVisible()
      await expect(page.getByTestId('integrated-source')).toContainText('seed')
      await expect(page.getByTestId('integrated-compute-time')).toContainText('秒')
      await expect(page.getByTestId('integrated-verdict')).toContainText(/差は確認されませんでした|差が確認されました/)
      await expect(page.getByTestId('branch-status')).toContainText('goal=null')
      await expect(page.getByTestId('todo-rules')).toContainText('TODO 37件')

      // A0/A1を切り替え、年表(経過一覧)からEventを開いて判断根拠(Trace)へ辿る。
      await page.getByTestId('view-a0').click()
      await expect(page.getByTestId('history-status')).toContainText('A0')
      await page.getByTestId('view-a1').click()
      await expect(page.getByTestId('history-status')).toContainText('A1')
      const list = page.getByTestId('integrated-list-birth')
      await list.locator('summary').click()
      await list.getByRole('button').first().click()
      await expect(page.getByTestId('active-branch')).toContainText('A0')
      await expect(page.getByTestId('event-detail')).toBeVisible()
      await page.getByTestId('event-detail').getByRole('button', { name: /判断根拠を開く/ }).first().click()
      await expect(page.getByTestId('trace-detail')).toBeVisible()
    })
  }
})

test.describe('統合モード: 後出生KEY人物のGUI選択（Issue #104・オプトイン）', () => {
  test.skip(!heavy, 'CHRONOFORK_E2E_INTEGRATED=1 のときだけ実行する(A0取得と再計算で各1〜数分)')
  test.setTimeout(30 * 60_000)

  test('A0の候補を取得し、1278年に1252年生まれの人物と初期人物へ介入できる', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 })
    await page.goto('/')
    await page.getByTestId('play-law-mode').selectOption('INTEGRATED_EXPERIMENTAL')
    // 取得前は初期人物のみ。取得中は介入の再計算が始まらず、画面は操作できる。
    await expect(page.getByTestId('branch-person-two').locator('option', { hasText: '1252年生' })).toHaveCount(0)
    await page.getByTestId('candidates-fetch').click()
    await expect(page.getByTestId('candidate-status')).toContainText('取得中')
    await expect(page.getByTestId('branch-run')).toBeDisabled()
    await expect(page.getByTestId('candidate-status')).toContainText('A0の', { timeout: 12 * 60_000 })
    await expect(page.getByTestId('candidate-error')).toHaveCount(0)

    // 1251年には出ず、1278年に選べる。
    await page.getByTestId('branch-fork-year').fill('1251')
    await expect(page.getByTestId('branch-person-two').locator('option', { hasText: '1252年生' })).toHaveCount(0)
    await page.getByTestId('branch-fork-year').fill('1278')
    const born1252 = page.getByTestId('branch-person-two').locator('option:not([disabled])', { hasText: '1252年生' })
    expect(await born1252.count()).toBeGreaterThan(0)
    const childId = await born1252.first().getAttribute('value')
    expect(childId).toBeTruthy()
    await page.getByTestId('branch-person-one').selectOption('person-exp-05')
    await page.getByTestId('branch-person-two').selectOption(childId!)
    await page.getByTestId('branch-trust-delta').fill('20')
    await page.getByTestId('branch-run').click()
    await expect(page.getByTestId('branch-results')).toBeVisible({ timeout: 20 * 60_000 })
    await expect(page.getByTestId('branch-error')).toHaveCount(0)
    await expect(page.getByTestId('branch-status')).toContainText('goal=null')
    await expect(page.getByTestId('branch-headline')).toContainText('1278年')
    await expect(page.getByTestId('branch-headline')).not.toContainText(childId!) // 長いIDでなく名前で表示される
    await expect(page.getByTestId('integrated-verdict')).toContainText(/差は確認されませんでした|差が確認されました/)
  })
})
