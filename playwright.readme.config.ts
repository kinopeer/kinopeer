import { defineConfig } from '@playwright/test'
import base from './playwright.config.ts'

/**
 * The README screenshots (`npm run screenshots:readme`): e2e/readme.shots.ts on the dev server, so
 * TMDB answers for real with the key from `.env.local`, while qBittorrent and Prowlarr stay mocked.
 */
export default defineConfig({
  ...base,
  testMatch: 'readme.shots.ts',
  retries: 0,
  reporter: [['list']],
  use: { ...base.use, baseURL: 'http://localhost:5173', deviceScaleFactor: 2 },
  webServer: {
    command: 'npm run dev -- --port 5173 --strictPort',
    url: 'http://localhost:5173',
    reuseExistingServer: false,
    timeout: 120_000,
  },
})
