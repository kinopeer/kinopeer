import { defineConfig } from '@playwright/test'
import { PROXY_URL } from './e2e/smoke/control.ts'
import base from './playwright.config.ts'

/**
 * The smoke journeys (`npm run test:smoke`): e2e/smoke/*.smoke.ts in Chromium against the real
 * production server, behind a proxy that wants a cookie, with the services faked (e2e/smoke/stack.ts).
 * No screenshots, so no Docker: Chromium on the host (`npx playwright install chromium`) will do.
 */
export default defineConfig({
  ...base,
  testDir: 'e2e/smoke',
  testMatch: '*.smoke.ts',
  testIgnore: [],
  // One stand, reset before each journey: they run one at a time.
  fullyParallel: false,
  workers: 1,
  use: { ...base.use, baseURL: PROXY_URL, serviceWorkers: 'allow' },
  webServer: {
    command: 'npm run build && node e2e/smoke/stack.ts',
    url: `${PROXY_URL}/`,
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
})
