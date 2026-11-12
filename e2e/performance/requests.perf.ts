// What each screen asks the servers for when it opens (docs/QUALITY.md → The requests budget): the
// built app, every server route mocked as in the screenshot tests, each screen loaded afresh by its
// address in both window sizes, its requests counted by route and compared with `budgets.requests`
// in checks.json. The rules are in scripts/requests/budget.ts; this file only collects the numbers.
import { readdirSync, readFileSync } from 'node:fs'
import { relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { expect, test, type Page, type Request } from '@playwright/test'
import { clockRun, judge, countsOf, grouped, readBudgets, unmatched, type App, type Budgets, type Opened, type Sent } from '../../scripts/requests/budget.ts'
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

type Heading = { level: number; name: string }
/** A control only the screen's loaded content has. */
type Loaded = { role: 'link' | 'button'; name: string }
/**
 * Each screen the test opens by its address, with its own heading (`desktop` where the desktop's
 * differs) and, where that heading stays above a "not answering" or empty state, a control only
 * the loaded content has: every screen the screenshot tests open by an address. What they open besides
 * is another state of one of these (another torrent's page, a search that finds nothing,
 * onboarding), left out as docs/QUALITY.md says.
 */
const SCREENS: { screen: string; path: string; heading: Heading; desktop?: Heading; loaded?: Loaded }[] = [
  { screen: 'downloads', path: '/', heading: { level: 1, name: 'Загрузки' }, loaded: { role: 'link', name: 'Дюна: Часть вторая' } },
  // On desktop the torrent's drawer over Downloads.
  { screen: 'torrent', path: '/torrent/p2', heading: { level: 1, name: 'Сёгун' }, desktop: { level: 2, name: 'Сёгун' } },
  { screen: 'browse', path: '/search', heading: { level: 1, name: 'Поиск' }, loaded: { role: 'link', name: 'Оппенгеймер' } },
  { screen: 'search', path: '/search?q=%D0%B4%D1%8E%D0%BD%D0%B0', heading: { level: 1, name: 'Поиск' }, loaded: { role: 'link', name: 'Дюна: Часть вторая' } },
  // With a year, movies and series are searched apart.
  { screen: 'search-year', path: '/search?q=%D0%B0&year=2022', heading: { level: 1, name: 'Поиск' }, loaded: { role: 'link', name: 'Разделение' } },
  { screen: 'title', path: '/title/movie/693134', heading: { level: 1, name: 'Дюна: Часть вторая' } },
  { screen: 'series', path: '/title/tv/126308', heading: { level: 1, name: 'Сёгун' } },
  // On desktop the title page with its releases under the hero.
  { screen: 'releases', path: '/title/tv/126308/releases', heading: { level: 1, name: 'Раздачи' }, desktop: { level: 1, name: 'Сёгун' }, loaded: { role: 'button', name: 'Добавить в загрузки' } },
  { screen: 'settings', path: '/settings', heading: { level: 1, name: 'Настройки' } },
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
const RUN_MS = clockRun(intervals)
/** The clock runs in steps, with the page left to settle after each, so a timer set after an answer fires in order. */
const STEP_MS = 100
/** The page has settled when no request has been in flight for this long, in real time. */
const QUIET_MS = 250
/** How long the page may take to settle before the test gives up and names what is still in flight. */
const SETTLE_LIMIT_MS = 10_000

const BUDGETS = readBudgets(JSON.parse(readFileSync(new URL('../../checks.json', import.meta.url), 'utf8')))

/**
 * The paths of the build's files as the server serves them (`/theme.js`, `/assets/…`): what the page
 * loads of them isn't counted. Read when a test runs, after the config's server has built nothing:
 * `npm run build` comes first, as in CI.
 */
function builtPaths(): Set<string> {
  const dist = fileURLToPath(new URL('../../dist/', import.meta.url))
  return new Set(
    readdirSync(dist, { recursive: true, withFileTypes: true })
      .filter((entry) => !entry.isDirectory())
      .map((entry) => `/${relative(dist, `${entry.parentPath}${sep}${entry.name}`).split(sep).join('/')}`),
  )
}

/**
 * Waits until no request has been in flight for `QUIET_MS` of real time: the page's clock is paused,
 * but its requests are answered on the test's side, which the page's clock doesn't run (a wait on
 * the page's timers would never end). After `SETTLE_LIMIT_MS` it throws, naming what is still in
 * flight, rather than hang until the test's timeout with nothing said.
 */
async function settled(inFlight: Set<Request>): Promise<void> {
  const started = Date.now()
  let quietSince = started
  while (Date.now() - quietSince < QUIET_MS) {
    if (Date.now() - started > SETTLE_LIMIT_MS) {
      const named = [...inFlight].map((request) => `  - ${request.method()} ${request.url()}`).join('\n')
      throw new Error(`The page didn't settle in ${SETTLE_LIMIT_MS} ms; still in flight:\n${named}`)
    }
    await new Promise((resolve) => setTimeout(resolve, 10))
    if (inFlight.size > 0) quietSince = Date.now()
  }
}

/** Opens `path` afresh with the clock paused and returns every request the page sent until the clock ran `run` ms. */
async function open(page: Page, path: string, run: number): Promise<Sent[]> {
  const sent: Sent[] = []
  const inFlight = new Set<Request>()
  page.on('request', (request) => {
    // The page itself: the main frame's navigation, not a frame's or a fetch of the same address.
    sent.push({ method: request.method(), url: request.url(), document: request.isNavigationRequest() && request.frame() === page.mainFrame() })
    inFlight.add(request)
  })
  page.on('requestfinished', (request) => inFlight.delete(request))
  page.on('requestfailed', (request) => inFlight.delete(request))
  await page.clock.install({ time: NOW - 1_000 })
  await page.clock.pauseAt(NOW)
  await prepareApp(page, { torrents: TORRENTS })
  await page.goto(path)
  await settled(inFlight)
  for (let ran = 0; ran < run; ran += STEP_MS) {
    await page.clock.runFor(Math.min(STEP_MS, run - ran))
    await settled(inFlight)
  }
  return sent
}

test('the poll intervals give the clock a time to run for', () => {
  expect(RUN_MS, `src/torrents/pollIntervals.ts can't be read:\n${[RUN_MS].flat().join('\n')}`).not.toBeInstanceOf(Array)
})

test('every budget is for a screen the test opens, and every screen it opens has one', () => {
  const budgets = BUDGETS as Budgets
  expect(BUDGETS, 'budgets.requests in checks.json').not.toBeInstanceOf(Array)
  const opened: Opened[] = SIZES.flatMap(({ size }) => SCREENS.map(({ screen }) => ({ size, screen })))
  expect(unmatched(budgets, opened)).toEqual([])
})

for (const { size, use } of SIZES) {
  test.describe(size, () => {
    test.use(use)
    for (const { screen, path, heading, desktop, loaded } of SCREENS) {
      test(screen, async ({ page, baseURL }, testInfo) => {
        expect(RUN_MS, `src/torrents/pollIntervals.ts can't be read:\n${[RUN_MS].flat().join('\n')}`).not.toBeInstanceOf(Array)
        const sent = await open(page, path, RUN_MS as number)
        // The screen itself opened: its own heading, not a crash or another screen; and where that
        // heading stays above a "not answering" or empty state, what only its loaded content has.
        // Elsewhere a service that didn't answer shows in the counts (docs/QUALITY.md).
        const { level, name } = size === 'desktop' && desktop ? desktop : heading
        await expect(page.getByRole('heading', { level, name, exact: true })).toBeVisible()
        if (loaded) await expect(page.getByRole(loaded.role, { name: loaded.name }).first()).toBeVisible()
        const app: App = { origin: new URL(baseURL!).origin, files: builtPaths() }
        await testInfo.attach('requests', {
          contentType: 'application/json',
          body: JSON.stringify({ size, screen, counts: countsOf(grouped(sent, app)) }),
        })
        expect(BUDGETS, `budgets.requests in checks.json can't be read:\n${[BUDGETS].flat().join('\n')}`).not.toBeInstanceOf(Array)
        const { passed, report } = judge({ size, screen, path }, sent, app, BUDGETS as Budgets)
        expect(passed, report).toBe(true)
      })
    }
  })
}
