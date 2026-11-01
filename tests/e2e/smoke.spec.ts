import { expect, test } from '@playwright/test'

const REGIONS = [
  ['region-eldia-central', 'エルディア中央'],
  ['region-eldia-west', 'エルディア西部'],
  ['region-eldia-east', 'エルディア東部'],
  ['region-eldia-south', 'エルディア南部'],
  ['region-margald-home', 'マルガルド本領'],
  ['region-versa-coast', 'ヴェルサ沿岸'],
] as const

test.use({ viewport: { width: 1280, height: 800 } })

test('experimental・未計算を明示し、架空の結果を表示しない', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Project Chronofork', level: 1 })).toBeVisible()
  await expect(page.getByTestId('experimental-banner')).toHaveText('experimental / 仮データ / 歴史計算未接続')
  await expect(page.getByTestId('current-year')).toContainText('1250年')
  await expect(page.getByTestId('goal-status')).toContainText('未計算')
  await expect(page.getByTestId('chronicle-status')).toContainText('未接続')
  await expect(page.getByTestId('reserved-areas')).toContainText('未接続: 介入機能')
  await expect(page.getByTestId('reserved-areas')).toContainText('未接続: 比較機能')
  const body = page.locator('body')
  await expect(body).not.toContainText(/勝利|敗北|達成|1350年の結果/)
  await expect(body).not.toContainText('参照不明')
  await expect(page.getByRole('slider')).toBeDisabled()
  await expect(page.getByRole('button', { name: /介入|比較|実行|適用/ })).toHaveCount(0)
})

test('6地域が表示され、選択すると詳細が切り替わる', async ({ page }) => {
  await page.goto('/')
  const map = page.getByTestId('region-map')
  await expect(map.getByRole('button')).toHaveCount(6)
  for (const [id, name] of REGIONS) {
    await expect(page.getByTestId(`region-node-${id}`)).toContainText(name)
    await page.getByTestId(`region-node-${id}`).click()
    await expect(page.getByTestId(`region-node-${id}`)).toHaveAttribute('aria-pressed', 'true')
    await expect(page.getByTestId('detail').getByRole('heading', { name, level: 3 })).toBeVisible()
  }
})

test('キーボードで地域を選択できる', async ({ page }) => {
  await page.goto('/')
  const node = page.getByTestId('region-node-region-eldia-south')
  await node.focus()
  await page.keyboard.press('Enter')
  await expect(page.getByTestId('detail').getByRole('heading', { name: 'エルディア南部' })).toBeVisible()
  const tab = page.getByRole('tab', { name: '地域' })
  await tab.focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('tab', { name: '人口集団' })).toHaveAttribute('aria-selected', 'true')
})

test('人口集団・人物・称号を選択し、リンクで詳細を切り替えられる', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('region-node-region-eldia-central').click()
  await page.getByTestId('detail').getByRole('button', { name: '中央・一般住民' }).click()
  await expect(page.getByRole('tab', { name: '人口集団' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('detail')).toContainText('家門支持')

  await page.getByRole('tab', { name: '称号' }).click()
  await page.getByTestId('item-title-title-exp-crown-eldia').click()
  await expect(page.getByTestId('detail')).toContainText('王冠称号')
  await page.getByTestId('detail').getByRole('button', { name: /試験人物01/ }).click()
  await expect(page.getByRole('tab', { name: '人物' })).toHaveAttribute('aria-selected', 'true')
  await expect(page.getByTestId('detail').getByRole('heading', { name: /試験人物01/ })).toBeVisible()
  await expect(page.getByTestId('detail')).toContainText('保有称号')
})

test('タブ操作は選択を解除し、詳細リンク移動は選択を維持する', async ({ page }) => {
  await page.goto('/')
  const detail = page.getByTestId('detail')
  const empty = '地域・集団・人物・称号を選ぶと詳細を表示します。'

  // クリックで切替
  await page.getByTestId('region-node-region-eldia-central').click()
  await expect(detail.getByRole('heading', { name: 'エルディア中央', level: 3 })).toBeVisible()
  await page.getByRole('tab', { name: '人物' }).click()
  await expect(page.getByRole('tab', { name: '人物' })).toHaveAttribute('aria-selected', 'true')
  await expect(detail).toContainText(empty)
  await expect(detail.getByRole('heading', { name: 'エルディア中央' })).toHaveCount(0)
  await expect(page.getByTestId('region-node-region-eldia-central')).toHaveAttribute('aria-pressed', 'false')

  // キーボードで切替
  await page.getByRole('tab', { name: '地域' }).click()
  await page.getByTestId('region-node-region-eldia-west').click()
  await expect(detail.getByRole('heading', { name: 'エルディア西部', level: 3 })).toBeVisible()
  await page.getByRole('tab', { name: '地域' }).focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByRole('tab', { name: '人口集団' })).toHaveAttribute('aria-selected', 'true')
  await expect(detail).toContainText(empty)
  await expect(detail.getByRole('heading', { name: 'エルディア西部' })).toHaveCount(0)

  // 詳細リンクでは選択を維持
  await page.getByRole('tab', { name: '称号' }).click()
  await page.getByTestId('item-title-title-exp-crown-eldia').click()
  await detail.getByRole('button', { name: /試験人物01/ }).click()
  await expect(page.getByRole('tab', { name: '人物' })).toHaveAttribute('aria-selected', 'true')
  await expect(detail.getByRole('heading', { name: /試験人物01/ })).toBeVisible()
  await expect(detail).not.toContainText(empty)
})
