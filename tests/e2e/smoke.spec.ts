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
  const traceText = (await page.getByTestId('trace-detail').getByTestId('trace-id').textContent()) ?? ''
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

  await page.getByTestId('dev-info').locator('summary').click()
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

test('介入→実再計算→同一年比較→A0/A1切替→Event/Traceを辿れる',async({page})=>{
  test.setTimeout(90000)
  await page.goto('/')
  await expect(page.getByTestId('branch-results')).toHaveCount(0)
  await page.getByTestId('branch-run').click()
  await expect(page.getByTestId('branch-status')).toContainText('A1 COMPLETED')
  await expect(page.getByTestId('branch-b004-a0')).toContainText('REJECT')
  await expect(page.getByTestId('branch-b004-a1')).toContainText('ACCEPT')
  await expect(page.getByTestId('branch-b004-a1')).toContainText('41')
  await expect(page.getByTestId('branch-event-diffs')).toContainText('MARRIAGE_REGISTER')
  await expect(page.getByTestId('current-year')).toContainText('1260年')
  await expect(page.getByTestId('goal-status')).toContainText('未成立')
  await page.getByTestId('view-a0').click()
  await expect(page.getByTestId('active-branch')).toContainText('A0')
  await expect(page.getByTestId('run-inputs')).toContainText('A0-play')
  await page.getByTestId('view-a1').click()
  await expect(page.getByTestId('active-branch')).toContainText('A1')
  await page.getByTestId('branch-event-diffs').getByRole('button',{name:/MARRIAGE_REGISTER/}).first().click()
  await expect(page.getByTestId('event-detail')).toContainText('MARRIAGE_REGISTER')
  await expect(page.getByTestId('event-backlink')).toContainText('一致（')
  await page.getByRole('slider').focus()
  await page.keyboard.press('ArrowRight')
  await expect(page.getByTestId('branch-event-diffs')).toContainText('PERSON_BIRTH')
  await expect(page.getByTestId('branch-comparison-year')).toContainText('1261年')
})

for (const width of [1280, 960]) {
  test(`${width}px: 介入→A0 REJECT/A1 ACCEPT→婚姻→出生→Event→Trace を横スクロールなしで操作できる`, async ({ page }, testInfo) => {
    test.setTimeout(90000)
    await page.setViewportSize({ width, height: 900 })
    await page.goto('/')
    // 初期表示: 目標・観測年・歴史・正式勝敗未成立・CALIBRATION_ONLY が先に読める。内部診断は折りたたみ。
    await expect(page.getByTestId('trial-guide')).toBeVisible()
    await expect(page.getByTestId('experimental-banner')).toContainText('CALIBRATION_ONLY')
    await expect(page.getByTestId('goal-status')).toBeVisible()
    await expect(page.getByTestId('goal-status')).toContainText('未成立')
    await expect(page.getByTestId('dev-info')).not.toHaveAttribute('open', '')
    await expect(page.getByTestId('run-inputs')).toBeHidden()
    await page.screenshot({ path: testInfo.outputPath(`initial-${width}.png`), fullPage: true })

    await page.getByTestId('branch-run').click()
    const results = page.getByTestId('branch-results')
    await expect(results).toBeVisible()
    await expect(page.getByTestId('branch-headline')).toContainText('A0 REJECT → A1 ACCEPT')
    await expect(page.getByTestId('branch-b004-a0')).toContainText('REJECT')
    await expect(page.getByTestId('branch-b004-a1')).toContainText('ACCEPT')
    await expect(page.getByTestId('branch-b004-a1')).toContainText('41')
    await expect(page.getByTestId('branch-b004-a0')).toContainText('21')
    await expect(page.getByTestId('branch-trace-ids')).toBeHidden()
    // 比較欄が画面外へ切れず、本文が横スクロールしない
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)
    expect(overflow).toBeLessThanOrEqual(0)
    for (const id of ['branch-snapshot-a0', 'branch-snapshot-a1', 'branch-event-diffs']) {
      const box = await page.getByTestId(id).boundingBox()
      expect(box && box.x >= 0 && box.x + box.width <= width).toBe(true)
    }
    await page.screenshot({ path: testInfo.outputPath(`compare-${width}.png`), fullPage: true })

    // A1 婚姻 Event → Trace
    await page.getByTestId('branch-event-diffs').getByRole('button', { name: /MARRIAGE_REGISTER/ }).first().click()
    await expect(page.getByTestId('event-detail')).toContainText('MARRIAGE_REGISTER')
    await expect(page.getByTestId('event-backlink')).toContainText('一致（')
    await page.getByTestId('event-detail').getByRole('button', { name: /判断根拠を開く/ }).click()
    await expect(page.getByTestId('trace-detail')).toContainText('CALIBRATION_ONLY')
    await expect(page.getByTestId('trace-forwardlink')).toContainText('一致（')
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0)
    // 1261 出生
    await page.getByRole('slider').focus()
    await page.keyboard.press('ArrowRight')
    await expect(page.getByTestId('branch-event-diffs')).toContainText('PERSON_BIRTH')
    await expect(page.getByTestId('branch-comparison-year')).toContainText('1261年')
    // 出生Event: 新生児は参照不明にならず、判断根拠を開くとTrace詳細へ移動・フォーカスする
    const diffs = page.getByTestId('branch-event-diffs')
    await expect(page.getByTestId('headline-focused')).toContainText('A1にだけ記録')
    await diffs.getByRole('button', { name: /人物の出生/ }).first().click()
    await expect(page.getByTestId('event-summary')).toContainText('両親')
    await expect(page.getByTestId('event-detail')).not.toContainText('参照不明')
    await page.getByTestId('event-detail').getByRole('button', { name: /判断根拠を開く/ }).click()
    await expect(page.getByTestId('trace-detail')).toContainText('B-002')
    await expect(page.getByTestId('trace-detail').getByRole('heading', { level: 3 })).toBeInViewport()
    await expect(page.getByTestId('trace-detail')).toBeFocused()
    await diffs.getByRole('button', { name: /法的王朝の確定/ }).first().click()
    await page.getByTestId('event-detail').getByRole('button', { name: /判断根拠を開く/ }).click()
    await expect(page.getByTestId('trace-detail')).toContainText('A-DYN-02')
    await expect(page.getByTestId('trace-detail').getByRole('heading', { level: 3 })).toBeInViewport()
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0)
    // 枝切替と年変更
    await page.getByTestId('view-a0').click()
    await expect(page.getByTestId('active-branch')).toContainText('A0')
    await expect(page.getByTestId('history-status')).toContainText('A0')
    await page.getByTestId('view-a1').click()
    await expect(page.getByTestId('active-branch')).toContainText('A1')
    // 開発・検証情報は展開して読める
    await page.getByTestId('dev-info').locator('summary').click()
    await expect(page.getByTestId('run-inputs')).toContainText('A1-play')
    await expect(page.getByTestId('todo-rules')).toBeVisible()
    expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0)
  })
}
