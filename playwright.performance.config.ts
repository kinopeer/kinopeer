import { defineConfig } from '@playwright/test'
import base from './playwright.config.ts'

/**
 * The requests budget (`npm run test:requests`, after `npm run build`): e2e/performance/*.perf.ts
 * in Chromium against the built app, with every server route mocked as in the screenshot tests. No
 * screenshots, so no Docker: Chromium on the host will do. It serves the build that is in dist/
 * rather than building, as `npm run size` reads it: CI's `performance` job builds once for both.
 */
export default defineConfig({
  ...base,
  testDir: 'e2e/performance',
  testMatch: '*.perf.ts',
  testIgnore: [],
  // The screenshot tests' reporters, and the table of the counts (e2e/performance/summary.ts).
  reporter: [['list'], ...(process.env.CI ? [['html', { open: 'never' }] as const] : []), ['./e2e/performance/summary.ts']],
  use: { ...base.use, baseURL: 'http://localhost:4174' },
  webServer: {
    // Another port than the screenshot tests', so neither reuses the other's server and its build.
    command: 'npx vite preview --port 4174 --strictPort',
    url: 'http://localhost:4174',
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
})
