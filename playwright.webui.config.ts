import { defineConfig } from '@playwright/test'
import { QBITTORRENT_URL } from './e2e/webui/qbittorrent.ts'
import base from './playwright.config.ts'

/**
 * The WebUI's smoke journeys (`npm run test:smoke:webui`): e2e/webui/*.smoke.ts in Chromium against
 * a real qBittorrent serving `npm run build:webui` as its Alternative WebUI. Everything runs in
 * Docker (scripts/test-smoke-webui.sh), qBittorrent and Playwright's image on one network, so
 * there's no webServer here: the script starts qBittorrent and builds the WebUI before this runs.
 */
export default defineConfig({
  ...base,
  testDir: 'e2e/webui',
  testMatch: '*.smoke.ts',
  testIgnore: [],
  // One qBittorrent, its clientdata reset before each journey: they run one at a time.
  fullyParallel: false,
  workers: 1,
  reporter: [['list'], ...(process.env.CI ? [['html', { open: 'never' }] as const] : [])],
  globalSetup: './e2e/webui/setup.ts',
  use: { ...base.use, baseURL: QBITTORRENT_URL },
  webServer: undefined,
})
