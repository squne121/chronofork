import { defineConfig, devices } from '@playwright/test'

const pagesSmokeUrl = process.env.PAGES_SMOKE_URL
if (process.env.PAGES_SMOKE_REQUIRED === '1' && (!pagesSmokeUrl?.trim() || !process.env.PAGES_EXPECTED_SHA?.trim())) {
  throw new Error('必須の配信用smokeにはPAGES_SMOKE_URLとPAGES_EXPECTED_SHAが必要です')
}

const localPagesPreview = !!process.env.PAGES_LOCAL_PREVIEW
const previewHost = '127.0.0.1'
const previewPort = 4173
const pagesBasePath = '/chronofork/'
const previewUrl = `http://${previewHost}:${previewPort}${localPagesPreview ? pagesBasePath : '/'}`

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: pagesSmokeUrl || previewUrl, trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: pagesSmokeUrl && !localPagesPreview ? undefined : {
    command: `npx vite preview --host ${previewHost} --port ${previewPort} --strictPort${localPagesPreview ? ` --base ${pagesBasePath}` : ''}`,
    url: previewUrl,
    reuseExistingServer: !process.env.CI && !localPagesPreview,
    timeout: 120_000,
  },
})
