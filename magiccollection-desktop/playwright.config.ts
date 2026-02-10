import { defineConfig, devices } from '@playwright/test'

const useTauriMode = process.env.PW_USE_TAURI === '1'
const webBaseUrl = process.env.PW_BASE_URL ?? 'http://127.0.0.1:4173'
const tauriBaseUrl = process.env.PW_TAURI_BASE_URL ?? 'http://127.0.0.1:1420'

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: process.env.CI ? 1 : undefined,
  reporter: [['list'], ['html', { open: 'never' }]],
  timeout: 60_000,
  expect: {
    timeout: 12_000,
  },
  use: {
    baseURL: useTauriMode ? tauriBaseUrl : webBaseUrl,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  webServer: useTauriMode
    ? undefined
    : {
        command: 'npm run dev -- --host 127.0.0.1 --port 4173 --strictPort',
        url: webBaseUrl,
        timeout: 120_000,
        reuseExistingServer: !process.env.CI,
      },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
})

