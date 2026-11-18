import { readFileSync } from 'node:fs'
import { defineConfig, devices } from '@playwright/test'

// How far a pixel may drift from its baseline before it counts as changed, in Playwright's YIQ
// scale (0 strict, 1 lax; Playwright's own default is 0.2): `budgets.screenshotThreshold` in
// checks.json, as data, where the checks guard marks a raise as a weakening (docs/QUALITY.md → What
// it marks); why its value is in docs/TESTING.md → Screenshot tests. No pixel over it is let through
// (maxDiffPixels stays 0). checks.test.ts checks that this config passes it on.
const { budgets } = JSON.parse(readFileSync(new URL('./checks.json', import.meta.url), 'utf8')) as { budgets?: { screenshotThreshold?: unknown } }
// Without it Playwright would quietly fall back to its own 0.2.
const threshold = budgets?.screenshotThreshold
if (typeof threshold !== 'number' || !(threshold >= 0 && threshold <= 1)) throw new Error('budgets.screenshotThreshold in checks.json must be a number from 0 to 1')

/**
 * Screenshot tests (e2e/): the built app in Chromium with every server route mocked. Baselines are
 * rendered on Linux in the Playwright Docker image only (`npm run test:visual`), because fonts render
 * differently on other systems. Keep @playwright/test and the image tag in
 * scripts/playwright-docker.sh and .github/workflows/ci.yml on the same version.
 */
export default defineConfig({
  testDir: 'e2e',
  // The smoke journeys have their own config (playwright.smoke.config.ts).
  testIgnore: '**/smoke/**',
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFileName}/{arg}{ext}',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: 0,
  // Two Chromiums fit the CI container (it runs with --ipc=host); locally Playwright picks.
  workers: process.env.CI ? 2 : undefined,
  // Also what axe read for the actual values, written only where ACTUALS_DIR is set (scripts/actuals/reporter.ts, docs/QUALITY.md → The actual values).
  reporter: [['list'], ...(process.env.CI ? [['html', { open: 'never' }] as const] : []), ['./scripts/actuals/reporter.ts', { tools: ['accessibility'] }]],
  expect: {
    toHaveScreenshot: { animations: 'disabled', caret: 'hide', threshold },
  },
  use: {
    ...devices['Desktop Chrome'],
    baseURL: 'http://localhost:4173',
    // A phone in portrait, the primary layout.
    viewport: { width: 390, height: 844 },
    locale: 'ru-RU',
    timezoneId: 'UTC',
    colorScheme: 'dark',
    reducedMotion: 'reduce',
    // The service worker would answer requests the tests mock.
    serviceWorkers: 'block',
    trace: 'retain-on-failure',
    // Left to itself, Chromium now and then draws part of a page's text in grayscale instead of LCD.
    // Two screenshots in CI came out so (#145); what triggers it wasn't found, and a page can't see
    // it, so a test can't wait it out. Grayscale always.
    launchOptions: { args: ['--disable-lcd-text'] },
  },
  projects: [{ name: 'chromium' }],
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
})
