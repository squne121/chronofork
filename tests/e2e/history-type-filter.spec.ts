import { expect, test } from '@playwright/test'

for (const width of [1280, 960]) {
  test(`${width}px: 実EventLogを種類で絞り込み、詳細を開いても横スクロールしない`, async ({ page }, testInfo) => {
    test.setTimeout(90000)
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/')
    await page.getByTestId('branch-run').click()
    await expect(page.getByTestId('branch-status')).toContainText('A1 COMPLETED')
    await page.getByTestId('event-scope').selectOption('all')

    const events = page.getByTestId('chronicle-list').getByRole('button')
    const originalCount = await events.count()
    expect(originalCount).toBeGreaterThan(0)
    await page.screenshot({ path: testInfo.outputPath(`chronicle-before-${width}.png`), fullPage: true })

    await page.getByTestId('event-type').selectOption('PERSON_BIRTH')
    await expect(events.first()).toBeVisible()
    const filteredCount = await events.count()
    expect(filteredCount).toBeGreaterThan(0)
    expect(filteredCount).toBeLessThan(originalCount)
    await expect(page.getByTestId('chronicle-count')).toContainText(`表示 ${filteredCount}件`)

    await events.first().click()
    await expect(page.getByTestId('event-detail')).toContainText('PERSON_BIRTH')
    await page.screenshot({ path: testInfo.outputPath(`chronicle-filtered-${width}.png`), fullPage: true })
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0)

    await page.getByTestId('event-type').selectOption('')
    await expect(events).toHaveCount(originalCount)
  })
}
