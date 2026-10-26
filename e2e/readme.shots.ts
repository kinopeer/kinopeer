import { expect, test, type Page } from '@playwright/test'
import { DESKTOP, openApp, settle, type AppOptions } from './app.ts'
import { RELEASES, TORRENTS } from './fixtures.ts'
import type { Torrent } from '../src/api/qbittorrent/types.ts'

/**
 * Renders the README screenshots into docs/screenshots/ (not a test: nothing is compared). Run with
 * `npm run screenshots:readme`, which needs TMDB_API_KEY (or a saved key) for real titles and posters.
 */

// Every status a healthy list has; the error and the unknown release are left out, and Shōgun
// downloads rather than stalls, so two rows show a speed.
const torrents = TORRENTS.slice(0, 7).map(
  (torrent): Torrent => (torrent.hash === 'a2' ? { ...torrent, state: 'downloading', dlspeed: 6.4 * 1024 ** 2, eta: 5400 } : torrent),
)
const options: AppOptions = { realTmdb: true, torrents }

async function shoot(page: Page, name: string) {
  await settle(page)
  // Opening the releases scrolls them into view; the screenshot starts at the top.
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: `docs/screenshots/${name}.png` })
}

test('downloads', async ({ page }) => {
  await openApp(page, '/', options)
  await expect(page.getByText('Дюна: Часть вторая', { exact: true }).first()).toBeVisible()
  await shoot(page, 'downloads')
})

test('search', async ({ page }) => {
  await openApp(page, '/search', options)
  await expect(page.getByRole('link').nth(8)).toBeVisible()
  await shoot(page, 'search')
})

test('title', async ({ page }) => {
  await openApp(page, '/title/tv/126308', options)
  await expect(page.getByRole('region', { name: /^В загрузках/ })).toBeVisible()
  await shoot(page, 'title')
})

test('releases', async ({ page }) => {
  await openApp(page, '/title/tv/126308/releases', options)
  await expect(page.getByText(RELEASES[0].title)).toBeVisible()
  await shoot(page, 'releases')
})

test.describe('desktop', () => {
  test.use(DESKTOP)

  test('downloads', async ({ page }) => {
    await openApp(page, '/', { ...options, downloadsView: 'list' })
    await expect(page.getByText('Дюна: Часть вторая', { exact: true }).first()).toBeVisible()
    await shoot(page, 'desktop-downloads')
  })

  test('title with releases', async ({ page }) => {
    await openApp(page, '/title/tv/126308/releases', options)
    await expect(page.getByText(RELEASES[0].title)).toBeVisible()
    await shoot(page, 'desktop-title')
  })
})
