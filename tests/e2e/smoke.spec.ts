import { expect, test } from '@playwright/test'

test('トップ画面が表示され、仕様ステータスを切り替えられる', async ({ page }) => {
  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Project Chronofork' })).toBeVisible()
  await expect(page.getByTestId('spec-status')).toHaveCount(0)
  await page.getByRole('button', { name: '仕様ステータスを表示' }).click()
  await expect(page.getByTestId('spec-status')).toContainText('移行待ち')
})
