import { defineConfig, devices } from '@playwright/test'

/**
 * Screenshot tests (e2e/): the built app in Chromium with every server route mocked. Baselines are
 * rendered on Linux in the Playwright Docker image only (`npm run test:visual`), because fonts render
 * differently on other systems. Keep @playwright/test and the image tag in scripts/test-visual.sh,
 * scripts/readme-screenshots.sh and .github/workflows/ci.yml on the same version.
 */
export default defineConfig({
  testDir: 'e2e',
  // The smoke journeys have their own config (playwright.smoke.config.ts).
  testIgnore: '**/smoke/**',
  snapshotPathTemplate: '{testDir}/__screenshots__/{testFileName}/{arg}{ext}',
  fullyParallel: true,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  // Two Chromiums fit the CI container (it runs with --ipc=host); locally Playwright picks.
  workers: process.env.CI ? 2 : undefined,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : [['list']],
  expect: {
    toHaveScreenshot: { animations: 'disabled', caret: 'hide' },
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
  },
  projects: [{ name: 'chromium' }],
  webServer: {
    command: 'npm run build && npx vite preview --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
    timeout: 180_000,
  },
})
