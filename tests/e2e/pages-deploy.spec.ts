import { expect, test } from '@playwright/test'

const previewSmoke = process.env.PREVIEW_SMOKE_ORIGIN_ONLY === '1'
if (previewSmoke) test.use({ serviceWorkers: 'block' })

test('配信成果物で実Workerの観測・介入・比較を行う', async ({ page }) => {
  const url = process.env.PAGES_SMOKE_URL
  const sha = process.env.PAGES_EXPECTED_SHA
  test.skip(!url || !sha, '配信用smokeはURLと期待SHAを指定して実行する')
  test.setTimeout(600_000)
  const errors: string[] = []
  page.on('pageerror', error => errors.push(error.message))
  if (previewSmoke) {
    const origin = new URL(url!).origin
    await page.context().route(/^https?:\/\//, route =>
      new URL(route.request().url()).origin === origin ? route.continue() : route.abort('blockedbyclient'),
    )
    page.context().on('request', request => {
      const target = new URL(request.url())
      if (/^https?:$/.test(target.protocol) && target.origin !== origin) errors.push('試遊先以外のオリジンへのリクエスト')
    })
  }
  page.on('requestfailed', request => errors.push(`${request.url()}: ${request.failure()?.errorText}`))
  page.on('response', response => { if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`) })
  const workers: string[] = []
  page.on('worker', worker => workers.push(worker.url()))
  await page.goto(url!)
  await expect(page.getByTestId('build-identity')).toHaveText(` / EXPERIMENTAL / ${sha}`)
  await expect(page.getByTestId('goal-status')).toContainText('未成立')
  await page.getByRole('button', { name: '限定試遊を開始', exact: true }).click()
  await page.getByTestId('obs-start').click()
  await expect(page.getByTestId('obs-chronicle')).toHaveAttribute('data-year', '1250', { timeout: 180_000 })
  await page.getByTestId('obs-person').selectOption('person-exp-02')
  await page.getByRole('button', { name: '人物の資料を開く', exact: true }).click()
  const person = page.getByRole('dialog', { name: '人物 person-exp-02', exact: true })
  await person.getByRole('button', { name: 'この人物と年から介入を検討する', exact: true }).click()
  const form = page.getByRole('dialog', { name: /介入/ })
  await form.getByTestId('branch-person-two').selectOption('person-exp-05')
  await form.getByTestId('branch-trust-delta').fill('20')
  await form.getByTestId('branch-duration').fill('1')
  await form.getByTestId('branch-run').click()
  const compare = form.getByRole('button', { name: '同じ年の歴史を比較', exact: true })
  await expect(compare).toBeVisible({ timeout: 180_000 })
  await compare.click()
  await expect(page.getByRole('dialog', { name: /歴史の比較/ })).toContainText(/A0 条件に不一致.*A1 条件に一致/)
  expect(workers.length).toBeGreaterThan(0)
  expect(errors).toEqual([])
})
