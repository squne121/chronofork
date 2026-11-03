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

test('experimental・partial・正式な勝敗未成立・37件TODOを明示する', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Project Chronofork', level: 1 })).toBeVisible()
  await expect(page.getByTestId('experimental-banner')).toContainText('試験計算')
  await expect(page.getByTestId('current-year')).toContainText('1250年')
  await expect(page.getByTestId('goal-status')).toContainText('未成立')
  await expect(page.getByTestId('autonomous-history')).toContainText('NOT_ESTABLISHED')
  await expect(page.getByTestId('todo-rules')).toContainText('TODO 37件')
  await expect(page.getByTestId('run-inputs')).toContainText('seed 1')
  await expect(page.getByTestId('reserved-areas')).toContainText('試験版で接続済み')
  await expect(page.getByTestId('reserved-areas')).toContainText('保存・3枝以上の比較')
  const body = page.locator('body')
  await expect(body).not.toContainText(/勝利|敗北|達成/)
  await expect(body).not.toContainText('参照不明')
  await expect(page.getByTestId('branch-run')).toBeVisible()
  await expect(page.getByTestId('branch-results')).toHaveCount(0)
})

test('年スライダーで 1250→1251→1350 を選び、実計算の人口が変化する', async ({ page }) => {
  await page.goto('/')
  const slider = page.getByRole('slider')
  await expect(slider).toBeEnabled()
  await expect(slider).toHaveAttribute('max', '1350')
  const pop = async () => {
    await page.getByRole('tab', { name: '人口集団' }).click()
    await page.getByTestId('item-group-group-west-commons').click()
    return (await page.getByTestId('detail').locator('dt:text-is("人口") + dd').textContent()) ?? ''
  }
  const p1250 = await pop()
  await slider.focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByTestId('current-year')).toContainText('1251年')
  const p1251 = await pop()
  await slider.focus()
  await page.keyboard.press('End')
  await expect(page.getByTestId('current-year')).toContainText('1350年')
  const p1350 = await pop()
  expect(p1250).not.toBe(p1251)
  expect(p1251).not.toBe(p1350)
  expect(Number(p1250.replace(/,/g, ''))).toBeLessThan(Number(p1251.replace(/,/g, '')))
  await expect(page.getByTestId('chronicle-status')).toContainText('事件はありません')
  await expect(page.getByTestId('autonomous-history')).toContainText('NOT_ESTABLISHED')
})

test('EventLog の人口差分から Trace を開き、Event へ戻れる', async ({ page }) => {
  await page.goto('/')
  await page.getByTestId('event-target').selectOption('GROUP:group-west-commons')
  const item = page.getByTestId('chronicle-list').getByRole('button')
  await expect(item).toHaveCount(1)
  await expect(item).toContainText('人口')
  const label = (await item.textContent()) ?? ''
  const [, before, after] = /人口 ([\d,]+)→([\d,]+)/.exec(label) ?? []
  expect(before).toBeTruthy()
  expect(after).not.toBe(before)
  await item.click()
  const ev = page.getByTestId('event-detail')
  await expect(ev).toContainText(before.replace(/,/g, ''))
  await expect(ev).toContainText(after.replace(/,/g, ''))
  await expect(page.getByTestId('event-backlink')).toContainText('一致（')
  await ev.getByRole('button', { name: /判断根拠を開く/ }).click()
  const tr = page.getByTestId('trace-detail')
  await expect(tr).toContainText('RULE-C-004')
  await expect(tr).toContainText('CALIBRATION_ONLY')
  await expect(page.getByTestId('trace-forwardlink')).toContainText('一致（')
  await tr.getByRole('button', { name: /Event を開く/ }).click()
  await expect(item).toHaveAttribute('aria-pressed', 'true')
  // 翌年初の人口は Event の変更後と一致する
  await page.getByRole('slider').focus()
  await page.keyboard.press('ArrowRight')
  await page.getByRole('tab', { name: '人口集団' }).click()
  await page.getByTestId('item-group-group-west-commons').click()
  await expect(page.getByTestId('detail').locator('dt:text-is("人口") + dd')).toHaveText(after)
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

test('Event 切替・対象フィルタ変更で古い Trace/詳細が残らない。seed と 1350 年の案内', async ({ page }) => {
  await page.goto('/')
  const list = page.getByTestId('chronicle-list').getByRole('button')
  await list.nth(0).click()
  await page.getByTestId('event-detail').getByRole('button', { name: /判断根拠を開く/ }).click()
  const traceText = (await page.getByTestId('trace-detail').locator('dd').first().textContent()) ?? ''
  expect(traceText).toContain('trace:')
  await list.nth(1).click()
  await expect(page.getByTestId('trace-detail')).not.toContainText(traceText)
  await expect(page.getByTestId('trace-detail')).toContainText('Event の「判断根拠を開く」')

  await list.nth(0).click()
  await page.getByTestId('event-target').selectOption('GROUP:group-west-commons')
  const first = await page.getByTestId('chronicle-list').getByRole('button').first().textContent()
  await page.getByTestId('chronicle-list').getByRole('button').first().click()
  const options = await page.getByTestId('event-target').locator('option').evaluateAll((o) => o.map((x) => (x as HTMLOptionElement).value))
  const another = options.find((v) => v && v !== 'GROUP:group-west-commons')!
  await page.getByTestId('event-target').selectOption(another)
  await expect(page.getByTestId('event-detail')).toContainText('事件を選ぶと')
  expect(first).toBeTruthy()

  await page.getByTestId('seed-input').fill('-1')
  await expect(page.getByTestId('rerun')).toBeDisabled()
  await page.getByTestId('seed-input').fill('7')
  await expect(page.getByTestId('rerun')).toBeEnabled()

  await page.getByRole('slider').focus()
  await page.keyboard.press('End')
  await expect(page.getByTestId('current-year')).toContainText('1350年')
  await expect(page.locator('#chronicle-heading').locator('..')).toContainText('1350年は評価専用')
  await expect(page.locator('#chronicle-heading').locator('..')).not.toContainText('1351')
})
