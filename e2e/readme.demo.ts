import { mkdirSync, writeFileSync } from 'node:fs'
import type { Page } from '@playwright/test'
import { expect, test } from './test.ts'
import { prepareApp, settle, type AppOptions } from './app.ts'
import { NOW, RELEASES, TORRENTS } from './fixtures.ts'
import type { Torrent } from '../src/api/qbittorrent/types.ts'

/**
 * Records the README's demo (not a test: nothing is compared), a phone going from a title to its
 * download: `npm run demo:readme`, which turns the recording into docs/demo.gif
 * (scripts/readme-demo.sh). Like the README screenshots, titles and posters come from TMDB for real,
 * while qBittorrent and Prowlarr answer from the fixtures.
 */

const PHONE = { width: 390, height: 844 }
const VIDEO = 'test-results/demo/demo.webm'
/** Where the recording's first frame worth showing is, for the script to cut what comes before. */
const START = 'test-results/demo/start.json'

// Shōgun isn't downloading until the demo adds it, then downloads as in the README screenshots.
const shogun = TORRENTS.find((torrent) => torrent.hash === 'a2')!
const added: Torrent = { ...shogun, state: 'downloading', progress: 0.04, dlspeed: 6.4 * 1024 ** 2, eta: 5400 }
const options: AppOptions = {
  realTmdb: true,
  lang: 'en',
  torrents: TORRENTS.slice(0, 7).filter((torrent) => torrent !== shogun),
  addsTorrent: added,
}

test.use({
  viewport: PHONE,
  // The sheets' and toasts' own motion is part of what the demo shows.
  reducedMotion: 'no-preference',
  // Playwright records the page at its CSS size whatever the device scale, so the video is that size.
  video: { mode: 'on', size: PHONE },
})

/** A ring where each tap lands, since a recording shows no pointer. */
async function showTaps(page: Page) {
  await page.addInitScript(() => {
    window.addEventListener(
      'pointerdown',
      (event) => {
        const ring = document.createElement('div')
        ring.style.cssText = `position:fixed;z-index:2147483647;pointer-events:none;left:${event.clientX - 22}px;top:${event.clientY - 22}px;width:44px;height:44px;border-radius:50%;background:rgba(255,255,255,.35);border:2px solid rgba(255,255,255,.8)`
        document.documentElement.append(ring)
        ring
          .animate([{ transform: 'scale(.6)', opacity: 1 }, { transform: 'scale(1.2)', opacity: 0 }], { duration: 450, easing: 'ease-out' })
          .finished.then(() => ring.remove())
      },
      true,
    )
  })
}

test('demo', async ({ page }) => {
  test.setTimeout(120_000)
  const started = Date.now()
  const pause = (ms: number) => page.waitForTimeout(ms)
  await showTaps(page)
  // The demo runs at a person's pace, so the clock runs too, from the fixtures' moment.
  await page.clock.install({ time: NOW })
  await prepareApp(page, options)
  await page.goto('/search')
  await expect(page.getByRole('link').nth(8)).toBeVisible()
  await settle(page)
  // Playwright empties test-results/ as it starts, so the folder is made here.
  mkdirSync('test-results/demo', { recursive: true })
  writeFileSync(START, JSON.stringify({ seconds: (Date.now() - started) / 1000 }))
  await pause(1200)

  await page.getByRole('searchbox').click()
  await page.getByRole('searchbox').pressSequentially('Shogun', { delay: 110 })
  const result = page.getByRole('link', { name: /Shōgun/ }).first()
  await expect(result).toBeVisible()
  await settle(page)
  await pause(900)
  await result.click()

  await expect(page.getByRole('heading', { level: 1, name: 'Shōgun' })).toBeVisible()
  await settle(page)
  await pause(1500)
  await page.getByText('Find releases').click()

  await expect(page.getByText(RELEASES[0].title)).toBeVisible()
  await pause(1800)
  // The second release, whose name is in English like the rest of the demo.
  await page.getByRole('button', { name: 'Add to downloads' }).nth(1).click()
  await pause(1200)
  await page.getByRole('button', { name: /^Files: all/ }).click()
  await page.getByRole('button', { name: /^Episodes/ }).click()
  await expect(page.getByText(/Shogun\.S01E10/)).toBeVisible()
  await pause(600)
  for (const episode of ['01', '02', '03']) {
    await page.getByRole('checkbox', { name: new RegExp(`^Shogun\\.S01E${episode}`) }).click()
    await pause(350)
  }
  await pause(900)
  await page.getByRole('dialog').getByRole('button', { name: 'Done' }).click()
  await pause(1200)
  await page.getByRole('dialog').getByRole('button', { name: /^Download ·/ }).click()
  // The pointer would stay over the tab bar, which shows the tab under it as hovered.
  await page.mouse.move(PHONE.width / 2, PHONE.height / 3)

  await expect(page.getByRole('heading', { level: 1, name: 'Downloads' })).toBeVisible()
  await expect(page.locator('.dl-poster img')).toHaveCount(options.torrents!.length + 1, { timeout: 30_000 })
  await pause(3000)

  await page.close()
  await page.video()!.saveAs(VIDEO)
})
