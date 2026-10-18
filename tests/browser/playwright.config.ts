import { defineConfig } from '@playwright/test'

export default defineConfig({
  testDir: '.',
  testMatch: '*.spec.ts',
  fullyParallel: false,
  workers: 1,
  timeout: 240_000,
  use: { headless: true, launchOptions: { args: ['--use-mock-keychain', '--password-store=basic'] }, trace: 'off', video: 'off', screenshot: 'off' },
  reporter: [['list']],
  outputDir: process.env.LARDER_BROWSER_OUTPUT || '/tmp/larder-browser-results',
})
