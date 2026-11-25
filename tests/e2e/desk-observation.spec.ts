import { expect, test } from '@playwright/test'

// 通常入口と既定 v0 の実 A0 を使う。時間のかかる試験なので明示指定時のみ有効。
test('編纂机で実 A0 の重大事件を開き、同期した年代記・世界図を再生・停止する', async ({ page }, testInfo) => {
  test.skip(process.env.CHRONOFORK_E2E_DESK !== '1', 'CHRONOFORK_E2E_DESK=1 で既定 v0 の100年を実計算する')
  test.setTimeout(8 * 60_000)
  const get = (id: string) => page.getByTestId(id)
  const yearLabel = get('obs-year-label')
  const atYear = async (year: number) => {
    await expect(yearLabel).toHaveText(`${year}年初`, { timeout: 180_000 })
    await expect(get('obs-chronicle')).toBeVisible()
    await expect(get('obs-chronicle')).toHaveAttribute('data-year', String(year))
    await expect(get('region-map')).toBeVisible()
    await expect(get('region-map')).toHaveAttribute('data-year', String(year))
  }
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  await page.setViewportSize({ width: 1280, height: 900 })
  await page.goto('/')
  await expect(get('obs-intro')).toBeVisible()
  await expect(get('obs-seed-input')).toHaveValue('20260101')
  await get('obs-start').click()
  await atYear(1250)
  await expect(get('obs-cache-source')).toContainText('実計算済み')
  await get('obs-dev-info').getByText('開発・検証情報', { exact: true }).click()
  await expect(get('obs-source')).toContainText('experimental-multi-house-v0')
  await get('obs-dev-info').getByText('開発・検証情報', { exact: true }).click()
  await expect(get('region-map').getByRole('button')).toHaveCount(6)

  const play = page.getByRole('button', { name: '再生', exact: true })
  const stop = page.getByRole('button', { name: '停止', exact: true })
  await play.click()
  await expect(stop).toBeVisible()
  await expect(get('obs-year-slider')).toHaveCount(0)
  await expect(yearLabel).not.toContainText('1250年初')
  await stop.click()
  const stopped = Number((await yearLabel.innerText()).match(/\d{4}/)![0])
  expect(stopped).toBeGreaterThan(1250)
  await atYear(stopped)
  await expect(get('obs-cache-source')).toContainText('再利用')
  // 次の再生 tick を越えても確定年は変わらない。
  await page.clock.install()
  await page.clock.runFor(2000)
  await atYear(stopped)
  await expect(play).toBeEnabled()

  const seek = get('obs-year-slider')
  await seek.press('Home')
  await atYear(1250)
  const hint = get('obs-year-hints').getByRole('button', { name: /^(?!1250)\d{4}年/ }).first()
  const eventYear = Number((await hint.innerText()).match(/\d{4}/)![0])
  await hint.click()
  await atYear(eventYear)
  await get('obs-event-list').getByRole('button').first().click()
  await expect(get('obs-event-detail')).toBeVisible()
  await expect(get('region-map')).toBeVisible()

  for (const width of [1280, 960]) {
    await page.setViewportSize({ width, height: 900 })
    const chronicle = await get('obs-chronicle').boundingBox()
    const map = await get('region-map').boundingBox()
    expect(map!.x).toBeGreaterThan(chronicle!.x + chronicle!.width)
    const nodes = await Promise.all((await get('region-map').getByRole('button').all()).map(node => node.boundingBox()))
    for (const [i, a] of nodes.entries()) for (const b of nodes.slice(i + 1)) {
      expect(a!.x + a!.width <= b!.x || b!.x + b!.width <= a!.x || a!.y + a!.height <= b!.y || b!.y + b!.height <= a!.y).toBe(true)
    }
    expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(width)
    await page.evaluate(() => window.scrollTo(0, 0))
    await page.screenshot({ path: testInfo.outputPath(`desk-${width}.png`) })
  }

  // 既定 v0 の実ログに土地称号の移転がある年。1350年には年内Eventがない。
  await page.getByText('すべての年の記録件数を見る（Event・Trace）', { exact: true }).click()
  await page.getByRole('button', { name: /^1265年・事件/ }).click()
  await atYear(1265)
  await expect(get('desk-map-events').first()).toBeVisible()
  await seek.press('End')
  await atYear(1350)
  await expect(get('desk-map-events')).toHaveCount(0)
  await expect(get('obs-event-count')).toContainText('確定Event 0件')
  await expect(play).toBeDisabled()
  await expect(get('obs-time-controls')).toContainText('計算済み履歴の末尾')
  await page.getByText('シナリオ目標と1350年の参考判定', { exact: true }).click()
  await expect(get('obs-goal')).toContainText('正式勝敗：未成立')
  expect(errors).toEqual([])
})
