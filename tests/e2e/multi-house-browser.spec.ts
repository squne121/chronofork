import { expect, test } from '@playwright/test'

// 編纂机の通常入口は desk-playthrough で検証する。ここでは旧配置のタブと
// A2・開発用比較詳細の回帰を残し、同じ v0 の実100年をWorkerで計算する。
test.describe('旧調査配置：複数家門の歴史を調べ、介入して比較する', () => {
  test.skip(process.env.CHRONOFORK_E2E_MULTI_HOUSE !== '1', 'CHRONOFORK_E2E_MULTI_HOUSE=1 で実100年を計算する')
  test.setTimeout(15 * 60_000)

  test('C1：1251年の縁談判断から出生・帰属・相続と1350年の技術判定まで辿る', async ({ page }, testInfo) => {
    const get = (id: string) => page.getByTestId(id)
    const errors: string[] = []
    page.on('pageerror', error => errors.push(error.message))
    const atYear = async (year: number) => {
      await expect(get('obs-year-label')).toHaveText(`${year}年初`, { timeout: 180_000 })
    }
    const metrics: unknown[] = []
    await page.goto('/?entry=legacy')
    for (const width of [1280, 960]) {
      await page.setViewportSize({ width, height: 900 })
      await expect(get('obs-seed-input')).toHaveValue('20260101')
      if (width === 1280) await get('obs-start').click()
      else await page.getByRole('button', { name: '前年', exact: true }).click()
      await atYear(1250)
      if (!(await get('obs-dev-info').locator('summary').evaluate(el => (el.parentElement as HTMLDetailsElement).open))) {
        await get('obs-dev-info').locator('summary').click()
      }
      await expect(get('obs-source')).toContainText('experimental-multi-house-v0')
      await expect(get('obs-source')).toContainText('5090c8485f4b8570')
      await expect(get('obs-source')).toContainText('1250〜1350年')
      const initial = await get('obs-times').innerText()
      await page.getByRole('button', { name: '翌年', exact: true }).click()
      await atYear(1251)
      await expect(get('obs-cache-source')).toContainText('再利用')
      const reuse = await get('obs-times').innerText()
      await get('obs-tab-investigate').click()
      await get('obs-person').selectOption('person-exp-03')
      await expect(get('family-node-person-exp-03')).toBeVisible()
      await expect(get('family-house')).not.toBeEmpty()
      await expect(get('family-legal-dynasty')).toContainText('ナルヴェン')
      await get('obs-title-select').selectOption('title-exp-west')
      await expect(get('obs-title-history')).toBeVisible()

      const partnerName = await get('obs-person').locator('option[value="person-exp-04"]').innerText()
      const partner = get('history-partner').filter({ has: page.locator('summary').filter({ hasText: partnerName.split('（')[0]!.split('・')[0]! }) })
      const b5 = partner.locator('li').filter({ hasText: 'B-005' })
        .filter({ has: get('history-open-trace').filter({ hasText: '1251年の判断記録を開く' }) })
      if (!(await partner.evaluate(el => (el as HTMLDetailsElement).open))) await partner.locator('> summary').click()
      await b5.getByTestId('history-open-trace').click()
      await expect(get('obs-trace-detail')).toContainText(/B-005.*DEFER/)
      await partner.getByTestId('history-intervene-pair').click()
      await expect(get('play-law-mode')).toHaveCount(0)
      await expect(get('branch-fork-year')).toHaveValue('1251')
      await expect(get('branch-person-one')).toHaveValue('person-exp-03')
      await expect(get('branch-person-two')).toHaveValue('person-exp-04')
      await get('branch-trust-delta').fill('20')
      await get('branch-duration').fill('1')
      await expect(get('candidate-status')).toContainText('1251年初')
      await get('branch-run').click()
      // 計算中にも観測タブを操作できる（計算と同じメインスレッドで待たない）。
      const probe = performance.now()
      await get('obs-tab-world').click()
      await expect(get('obs-world-explorer')).toBeVisible()
      const tabMs = Math.round(performance.now() - probe)
      await get('obs-tab-investigate').click()
      await expect(get('branch-run')).toBeEnabled({ timeout: 180_000 })
      await expect(get('branch-results')).toBeVisible()
      await expect(get('effect-judgement')).toContainText('A0 ACCEPT（スコア 30） → A1 ACCEPT（スコア 50）')
      if (!(await get('integrated-source').locator('summary').evaluate(el => (el.parentElement as HTMLDetailsElement).open))) {
        await get('integrated-source').locator('summary').click()
      }
      await expect(get('integrated-a0-source')).toContainText('再利用')
      await expect(get('integrated-source')).toContainText('5090c8485f4b8570')
      await expect(get('integrated-source')).toContainText('1251年から1年間、信頼 +20')
      await expect(get('integrated-defaults-note')).toHaveCount(0)
      const worker = await get('integrated-compute-time').innerText()
      const wall = await get('integrated-wall-time').innerText()
      const agreed = get('integrated-evidence-links').getByRole('button', { name: /1251年・B-005・ACCEPT/ })
      await agreed.click()
      await expect(get('trace-detail')).toContainText('B-005')
      await expect(get('trace-detail')).toContainText('ACCEPT')
      const trust = get('integrated-evidence-links').getByRole('button', { name: /1251年・B-004・ACCEPT/ })
      await trust.click()
      await get('trace-detail').getByText('開発・検証情報（Trace）').click()
      await expect(get('trace-detail')).toContainText('effectiveTrust=50')
      await expect(get('trace-detail')).toContainText('rawModifierSum=20')

      for (const [category, year, type] of [
        ['marriage', '1251', 'MARRIAGE_REGISTER'], ['birth', '1260', 'PERSON_BIRTH'],
        ['dynasty', '1260', 'LEGAL_DYNASTY_SET'], ['title', '1265', 'LEGAL_TITLE_TRANSFER'],
      ]) {
        await get('change-category').selectOption(category!)
        await get('change-year').selectOption(year!)
        await get('change-list').getByRole('button', { name: /A1/ }).first().click()
        await expect(get('event-detail')).toContainText(type!)
      }
      await expect(get('event-detail')).toContainText('A-TIT-07')
      const slider = page.locator('#year-slider')
      await slider.focus()
      await slider.press('End')
      await expect(get('branch-comparison-year')).toContainText('1350年')
      await get('view-a0').click()
      await expect(get('active-branch')).toContainText('A0')
      await get('view-a1').click()
      await expect(get('active-branch')).toContainText('A1')
      await expect(get('effect-technical-goal')).toContainText('A0 条件に不一致（技術検証） → A1 条件に不一致（技術検証）')
      await get('effect-technical-goal').scrollIntoViewIfNeeded()
      await page.screenshot({ path: testInfo.outputPath(`multi-house-${width}.png`) })
      metrics.push({ width, initial, reuse, worker, wall, tabMs })
    }
    // 同じ複数家門のA1へ、第1介入を保持したまま別ペアへの介入を追加する。
    await get('a2-person-one').selectOption('person-exp-05')
    await get('a2-person-two').selectOption('person-exp-07')
    await get('a2-delta').fill('20')
    await get('a2-duration').fill('1')
    await get('a2-run').click()
    await expect(get('a2-results')).toBeVisible({ timeout: 180_000 })
    await expect(get('a2-goal-summary')).toContainText('A2 NOT_ACHIEVED')
    await expect(get('active-branch')).toContainText('A2')

    // 別seedの実観測に切り替えた直後、旧A2を旧試験扱いで残さない。
    await get('obs-seed-input').fill('20260202')
    await get('obs-start').click()
    await expect(get('branch-results')).toHaveCount(0)
    await expect(get('legacy-workspace')).not.toHaveAttribute('open', '')
    await expect(get('obs-cache-source')).toContainText('この条件で実計算済み', { timeout: 180_000 })
    await expect(get('obs-seed-active')).toContainText('20260202')
    expect(errors).toEqual([])
    console.info('複数家門の実Chromium計測:', JSON.stringify(metrics))
  })
})
