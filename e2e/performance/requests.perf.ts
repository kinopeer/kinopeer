// What each screen asks the servers for when it opens (docs/QUALITY.md → The requests budget): the
// built app, every server route mocked as in the screenshot tests, each screen loaded afresh by its
// address in both window sizes, its requests counted by route and compared with `budgets.requests`
// in checks.json. The rules are in scripts/requests/budget.ts; this file only collects the numbers.
import { readFileSync } from 'node:fs'
import { expect, test, type Page, type Request } from '@playwright/test'
import { judge, countsOf, grouped, readBudgets, unmatched, type Budgets, type Opened, type Sent } from '../../scripts/requests/budget.ts'
import * as intervals from '../../src/torrents/pollIntervals.ts'
import { NOW, tmdbTag, torrent } from '../../src/test/fixtures.ts'
import { DESKTOP, prepareApp } from '../app.ts'

/**
 * The test's own torrents, so a change to the shared fixtures for a screenshot doesn't move a
 * budget: two whose titles their tags name and one whose title the app guesses from its name, which
 * asks TMDB and saves the guess on the server.
 */
const TORRENTS = [
  torrent('p1', { name: 'Dune.Part.Two.2024.2160p.UHD.BluRay.REMUX-GRPA', tags: tmdbTag('movie', 693134), category: 'Movies', progress: 0.5 }),
  torrent('p2', { name: 'Shogun.S01.2160p.WEB-DL.DDP5.1.H.265-GRPB', tags: tmdbTag('tv', 126308), category: 'TV Shows', state: 'uploading', progress: 1 }),
  torrent('p3', { name: 'Interstellar.2014.1080p.BluRay.x264-GRPC', state: 'pausedDL', progress: 0.1 }),
]

/** Each screen the test opens by its address: at least those the screenshot tests open so. */
const SCREENS = [
  { screen: 'downloads', path: '/' },
  { screen: 'torrent', path: '/torrent/p2' },
  { screen: 'search', path: '/search?q=%D0%B4%D1%8E%D0%BD%D0%B0' },
  { screen: 'title', path: '/title/movie/693134' },
  { screen: 'releases', path: '/title/tv/126308/releases' },
  { screen: 'settings', path: '/settings' },
]
/** The phone is the config's viewport; the desktop the screenshot tests' `DESKTOP`. */
const SIZES = [
  { size: 'phone', use: {} },
  { size: 'desktop', use: DESKTOP },
]

/**
 * How far the clock runs after the page loads: less than the shortest interval the app polls at, so
 * the timers a screen's open sets off fire (the save of a guessed title a second later) and no poll
 * repeats. The clock is paused otherwise, so the count doesn't grow with the time a run takes.
 */
const RUN_MS = Math.min(...Object.values(intervals)) - 1
/** The clock runs in steps, with the page left to settle after each, so a timer set after an answer fires in order. */
const STEP_MS = 100
/** The page has settled when no request has been in flight for this long, in real time. */
const QUIET_MS = 250

const BUDGETS = readBudgets(JSON.parse(readFileSync(new URL('../../checks.json', import.meta.url), 'utf8')))

/** Waits until no request has been in flight for `QUIET_MS`. */
async function settled(inFlight: Set<Request>): Promise<void> {
  let quietSince = Date.now()
  while (Date.now() - quietSince < QUIET_MS) {
    await new Promise((resolve) => setTimeout(resolve, 10))
    if (inFlight.size > 0) quietSince = Date.now()
  }
}

/** Opens `path` afresh with the clock paused and returns every request the page sent until the clock ran `RUN_MS`. */
async function open(page: Page, path: string): Promise<Sent[]> {
  const sent: Sent[] = []
  const inFlight = new Set<Request>()
  page.on('request', (request) => {
    sent.push({ method: request.method(), url: request.url() })
    inFlight.add(request)
  })
  page.on('requestfinished', (request) => inFlight.delete(request))
  page.on('requestfailed', (request) => inFlight.delete(request))
  await page.clock.install({ time: NOW - 1_000 })
  await page.clock.pauseAt(NOW)
  await prepareApp(page, { torrents: TORRENTS })
  await page.goto(path)
  await settled(inFlight)
  for (let ran = 0; ran < RUN_MS; ran += STEP_MS) {
    await page.clock.runFor(Math.min(STEP_MS, RUN_MS - ran))
    await settled(inFlight)
  }
  return sent
}

test('every budget is for a screen the test opens, and every screen it opens has one', () => {
  const budgets = BUDGETS as Budgets
  expect(BUDGETS, 'budgets.requests in checks.json').not.toBeInstanceOf(Array)
  const opened: Opened[] = SIZES.flatMap(({ size }) => SCREENS.map(({ screen }) => ({ size, screen })))
  expect(unmatched(budgets, opened)).toEqual([])
})

for (const { size, use } of SIZES) {
  test.describe(size, () => {
    test.use(use)
    for (const { screen, path } of SCREENS) {
      test(screen, async ({ page, baseURL }, testInfo) => {
        const sent = await open(page, path)
        const appOrigin = new URL(baseURL!).origin
        await testInfo.attach('requests', {
          contentType: 'application/json',
          body: JSON.stringify({ size, screen, counts: countsOf(grouped(sent, appOrigin)) }),
        })
        expect(BUDGETS, `budgets.requests in checks.json can't be read:\n${[BUDGETS].flat().join('\n')}`).not.toBeInstanceOf(Array)
        const { passed, report } = judge({ size, screen, path }, sent, appOrigin, BUDGETS as Budgets)
        expect(passed, report).toBe(true)
      })
    }
  })
}
