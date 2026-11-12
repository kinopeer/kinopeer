import { defineConfig } from '@playwright/test'
import base from './playwright.config.ts'

/**
 * A one-off trial (#378), not a check: how far time-based speed metrics move between runs of the
 * same commit. One worker, so no two pages compete for the CPU, and tests in the order declared,
 * so the regimes interleave over the job's time. Serves the build in dist/ (run `npm run build` first).
 */
export default defineConfig({
  ...base,
  testDir: 'e2e/timing-trial',
  // timings.trial.ts (the noise between runs) unless TRIAL_FILE names paired.trial.ts.
  testMatch: process.env.TRIAL_FILE ?? 'timings.trial.ts',
  testIgnore: [],
  fullyParallel: false,
  workers: 1,
  retries: 0,
  reporter: [['dot']],
  timeout: 60_000,
  use: { ...base.use, baseURL: 'http://localhost:4175', trace: 'off' },
  webServer: {
    command: 'npx vite preview --port 4175 --strictPort',
    url: 'http://localhost:4175',
    reuseExistingServer: false,
    timeout: 60_000,
  },
})
