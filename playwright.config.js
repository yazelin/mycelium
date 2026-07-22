import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests',
  timeout: 60_000,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'list' : [['list']],
  use: {
    baseURL: 'http://127.0.0.1:8919',
    locale: 'zh-TW',
  },
  webServer: {
    command: 'python3 -m http.server 8919 --bind 127.0.0.1',
    url: 'http://127.0.0.1:8919',
    reuseExistingServer: !process.env.CI,
  },
  projects: [{ name: 'desktop', use: { ...devices['Desktop Chrome'] } }],
});
