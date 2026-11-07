import { expect, test, type Page } from '@playwright/test'
import { DESKTOP, openApp, settle, type AppOptions } from './app.ts'
import { RELEASES, TORRENTS } from './fixtures.ts'
import type { Torrent } from '../src/api/qbittorrent/types.ts'

/**
 * Renders the README screenshots into docs/screenshots/ (not a test: nothing is compared). Run with
 * `npm run screenshots:readme`. Titles and posters come from TMDB for real, through Kinopeer's edge
 * TMDB proxy without a key of your own (the dev server's default). The interface is in English,
 * like the README.
 */

// Every status a healthy list has; the error and the unknown release are left out, and Shōgun
// downloads rather than stalls, so two rows show a speed.
const torrents = TORRENTS.slice(0, 7).map(
  (torrent): Torrent => (torrent.hash === 'a2' ? { ...torrent, state: 'downloading', dlspeed: 6.4 * 1024 ** 2, eta: 5400 } : torrent),
)
const options: AppOptions = { realTmdb: true, torrents, lang: 'en' }

async function shoot(page: Page, name: string, { top = true } = {}) {
  await settle(page)
  // Opening the releases scrolls them into view; the screenshot starts at the top.
  if (top) await page.evaluate(() => window.scrollTo(0, 0))
  await page.screenshot({ path: `docs/screenshots/${name}.png` })
}

/**
 * Titles are guessed from the release names a few at a time, so the first rows get their posters
 * before the last: waits until every torrent shows one.
 */
async function everyPoster(page: Page, poster: string) {
  await expect(page.locator(`${poster} img`)).toHaveCount(torrents.length, { timeout: 30_000 })
}

test('downloads', async ({ page }) => {
  await openApp(page, '/', options)
  await everyPoster(page, '.dl-poster')
  await shoot(page, 'downloads')
})

test('search', async ({ page }) => {
  await openApp(page, '/search', options)
  await expect(page.getByRole('link').nth(8)).toBeVisible()
  await shoot(page, 'search')
})

test('title', async ({ page }) => {
  await openApp(page, '/title/tv/126308', options)
  await expect(page.getByRole('region', { name: /^In downloads/ })).toBeVisible()
  await shoot(page, 'title')
})

test('releases', async ({ page }) => {
  await openApp(page, '/title/tv/126308/releases', options)
  await expect(page.getByText(RELEASES[0].title)).toBeVisible()
  await shoot(page, 'releases')
})

test('adding a release, picking its files', async ({ page }) => {
  await openApp(page, '/title/tv/126308/releases', options)
  await page.getByRole('button', { name: 'Add to downloads' }).first().click()
  await page.getByRole('button', { name: /^Files: all/ }).click()
  await page.getByRole('button', { name: /^Episodes/ }).click()
  await expect(page.getByText(/Shogun\.S01E10/)).toBeVisible()
  // Episodes already watched are left out, so the folder and the total show a part picked.
  for (const episode of ['01', '02', '03']) {
    await page.getByRole('checkbox', { name: new RegExp(`^Shogun\\.S01E${episode}`) }).click()
  }
  await shoot(page, 'add-files', { top: false })
})

test('torrent details', async ({ page }) => {
  await openApp(page, '/torrent/a2', options)
  await expect(page.getByRole('heading', { level: 1, name: 'Shōgun' })).toBeVisible()
  await shoot(page, 'torrent')
})

test.describe('desktop', () => {
  test.use(DESKTOP)

  test('downloads', async ({ page }) => {
    await openApp(page, '/', { ...options, downloadsView: 'list' })
    await everyPoster(page, '.dl-row-poster')
    await shoot(page, 'desktop-downloads')
  })

  test('title with releases', async ({ page }) => {
    // Taller than the screenshot tests' desktop, so the hero shows a few releases under the title.
    await page.setViewportSize({ width: DESKTOP.viewport.width, height: 1240 })
    await openApp(page, '/title/tv/126308/releases', options)
    await expect(page.getByText(RELEASES[0].title)).toBeVisible()
    await page.mouse.move(0, 0)
    await shoot(page, 'desktop-title')
  })
})
