import { defineConfig, devices } from '@playwright/test'

if (process.env.PAGES_SMOKE_REQUIRED === '1' && (!process.env.PAGES_SMOKE_URL?.trim() || !process.env.PAGES_EXPECTED_SHA?.trim())) {
  throw new Error('必須の配信用smokeにはPAGES_SMOKE_URLとPAGES_EXPECTED_SHAが必要です')
}

export default defineConfig({
  testDir: 'tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  use: { baseURL: 'http://localhost:4173', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: process.env.PAGES_SMOKE_URL && !process.env.PAGES_LOCAL_PREVIEW ? undefined : {
    command: `npx vite preview --port 4173 --strictPort${process.env.PAGES_LOCAL_PREVIEW ? ' --base /chronofork/' : ''}`,
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI && !process.env.PAGES_LOCAL_PREVIEW,
    timeout: 120_000,
  },
})
