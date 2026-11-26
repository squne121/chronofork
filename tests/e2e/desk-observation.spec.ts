import { expect, test } from '@playwright/test'

type ResponseControl = { next?: 'hold' | 'branch' | 'identity'; release?: () => void }
declare global { interface Window { deskResponseTest: ResponseControl } }

test.use({ actionTimeout: 15_000 })

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
  // 実 Worker の応答を使う。否定試験でのみ配送を遅らせるか、来歴を一項目だけ変える。
  await page.addInitScript(() => {
    const descriptor = Object.getOwnPropertyDescriptor(Worker.prototype, 'onmessage')!
    const control: ResponseControl = window.deskResponseTest = {}
    Object.defineProperty(Worker.prototype, 'onmessage', {
      ...descriptor,
      set(this: Worker, handler: Worker['onmessage']) {
        descriptor.set!.call(this, !handler ? null : (event: MessageEvent) => {
          const payload = event.data
          if (!control.next || !payload?.ok || !payload.observation) return handler.call(this, event)
          const action = control.next
          control.next = undefined
          if (action === 'hold') {
            control.release = () => { delete control.release; handler.call(this, event) }
          } else {
            const wrong = action === 'branch' ? { branchId: 'A1-play' } : { configIdentity: '別の完全構成' }
            handler.call(this, new MessageEvent('message', { data: { ...payload, observation: { ...payload.observation, ...wrong } } }))
          }
        })
      },
    })
  })
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
  await expect(get('obs-event-detail')).toHaveCount(0)
  await expect(get('region-map')).toBeVisible()
  const dialogs = page.getByRole('dialog')
  const close = async () => { await dialogs.last().getByRole('button', { name: '資料を閉じる' }).press('Escape') }
  const event = page.getByRole('dialog', { name: /^Event / })
  await expect(event).toContainText('年内の出来事：')
  await event.getByTestId(/^document-link-trace-/).first().click()
  const trace = page.getByRole('dialog', { name: /^Trace / })
  await expect(trace).toContainText('記録された判断：')
  await expect(trace).toContainText('参照元: Event')
  await expect(dialogs).toHaveCount(2)
  const move = event.getByRole('button', { name: '資料を移動' })
  // 被さっている窓もキーボードで前面化でき、その後ポインターで移動できる。
  await move.focus()
  expect(Number(await event.evaluate(el => getComputedStyle(el).zIndex))).toBeGreaterThan(Number(await trace.evaluate(el => getComputedStyle(el).zIndex)))
  const position = await move.boundingBox()
  const x = position!.x + position!.width / 2
  const y = position!.y + position!.height / 2
  await page.mouse.move(x, y)
  await page.mouse.down()
  await page.mouse.move(x + 460, y + 15, { steps: 8 })
  await page.mouse.up()
  const left = (await event.boundingBox())!.x
  expect(left).toBeGreaterThan(300)
  expect(Number(await event.evaluate(el => getComputedStyle(el).zIndex))).toBeGreaterThan(Number(await trace.evaluate(el => getComputedStyle(el).zIndex)))
  await move.press('ArrowRight')
  expect((await event.boundingBox())!.x).toBe(left + 20)

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

  await close()
  await close()
  await expect(dialogs).toHaveCount(0)

  await get('region-node-region-eldia-central').click()
  const region = page.getByRole('dialog', { name: /^地域 / })
  await expect(region).toContainText('上位主権：')
  await region.getByTestId(/^document-link-group-/).first().click()
  await expect(page.getByRole('dialog', { name: /^集団 / })).toContainText('人口：')
  await close()
  await region.getByTestId(/^document-link-country-/).click()
  await expect(page.getByRole('dialog', { name: /^国家 / })).toContainText('統治者：')
  await close()
  await close()

  await get('obs-title-select').selectOption('title-exp-west')
  await page.getByRole('button', { name: '称号の資料を開く' }).click()
  await expect(page.getByRole('dialog', { name: '称号 title-exp-west' })).toContainText('年初の保持者：')
  await close()
  await seek.press('Home')
  await atYear(1250)
  await get('obs-person').selectOption('person-exp-03')
  await page.getByRole('button', { name: '人物の資料を開く' }).click()
  const person = page.getByRole('dialog', { name: '人物 person-exp-03' })
  await person.getByRole('button', { name: '家系を開く' }).click()
  const family = page.getByRole('dialog', { name: '家系 person-exp-03' })
  await expect(family.getByTestId('family-house')).not.toBeEmpty()
  await expect(family).toContainText('参照元: 人物')
  const relatedPerson = family.getByTestId(/^family-node-/).filter({ has: page.locator('.ft-name') }).and(family.getByRole('button')).first()
  if (await relatedPerson.count()) {
    await relatedPerson.click()
    await expect(dialogs.last()).toContainText('参照元: 家系')
    await close()
  }
  await close()

  const allEventsBeforeFilter = await get('obs-all-events').isChecked()
  const beforeFilter = await get('obs-event-count').innerText()
  await person.getByRole('button', { name: '年表で絞り込む' }).click()
  await expect(get('obs-document-filter')).toContainText('絞り込み中')
  expect((await get('obs-event-count').innerText()).match(/確定Event (\d+)/)?.[1]).toBe(beforeFilter.match(/確定Event (\d+)/)?.[1])
  await expect(get('obs-event-type')).toBeDisabled()
  const movePerson = person.getByRole('button', { name: '資料を移動' })
  for (let i = 0; i < 25; i++) await movePerson.press('ArrowRight')
  await person.getByRole('button', { name: 'この人物と年から介入を検討する' }).click()
  const intervention = page.getByRole('dialog', { name: '介入', exact: true })
  await expect(intervention.getByTestId('branch-person-one')).toHaveValue('person-exp-03')
  await expect(intervention.getByTestId('branch-fork-year')).toHaveValue('1250')
  await expect(intervention.getByRole('button', { name: '同じ年の歴史を比較', exact: true })).toHaveCount(0)
  await expect(get('legacy-workspace')).not.toHaveAttribute('open', '')
  await page.screenshot({ path: testInfo.outputPath('desk-intervention.png') })
  await intervention.getByRole('button', { name: '介入を閉じる', exact: true }).press('Escape')
  await expect(intervention).toHaveCount(0)

  // 元の人物窓は指定年に固定したまま、別年の実記録を開く。
  await page.evaluate(() => { window.deskResponseTest.next = 'hold' })
  const targetYear = 1251
  const partnerName = (await get('obs-person').locator('option[value="person-exp-04"]').innerText()).split('（')[0]!.split('・')[0]!
  await person.getByText('生涯の婚姻・称号・過去の判断を調べる', { exact: true }).click()
  const partner = person.getByTestId('history-partner').filter({ has: page.locator('summary').filter({ hasText: partnerName }) })
  await partner.locator('> summary').click()
  await partner.locator('li').filter({ hasText: 'B-005' }).getByTestId('history-open-trace')
    .filter({ hasText: `${targetYear}年の判断記録を開く` }).click()
  await expect(trace).toContainText('未取得')
  await expect(trace.getByTestId('document-reference')).toContainText(`${targetYear}年`)
  await expect.poll(() => page.evaluate(() => !!window.deskResponseTest.release)).toBe(true)
  await seek.press('Home')
  await page.evaluate(() => window.deskResponseTest.release?.())
  await atYear(1250)
  await expect(trace).toContainText('未取得')
  await expect(trace).not.toContainText('記録された判断：')
  for (const next of ['branch', 'identity'] as const) {
    await page.evaluate(value => { window.deskResponseTest.next = value }, next)
    await trace.getByRole('button', { name: 'この参照へ移動' }).click()
    await expect(get('obs-error')).toContainText('OBSERVATION_IDENTITY_MISMATCH')
    await atYear(1250)
    await expect(trace).toContainText('未取得')
  }
  await trace.getByRole('button', { name: 'この参照へ移動' }).click()
  await atYear(targetYear)
  await expect(trace).toContainText('記録された判断：')
  await expect(trace).toContainText('参照元: 人物')
  await expect(person.getByTestId('document-reference')).toContainText('1250年')
  await expect(person.getByTestId('person-history')).toBeVisible()
  await page.screenshot({ path: testInfo.outputPath('desk-cross-year.png') })
  await close()
  await close()
  await get('obs-document-filter').getByRole('button', { name: '資料の絞り込みを解除' }).click()
  expect(await get('obs-all-events').isChecked()).toBe(allEventsBeforeFilter)

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
  await expect(get('obs-goal')).toContainText('正式勝敗：未成立')
  expect(errors).toEqual([])
})
