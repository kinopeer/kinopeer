// What both requests tests do with the page (docs/QUALITY.md → The requests budget): record what it
// sends, hold its clock and run it in steps, keep the images it loaded and collect its garbage, and
// wait for it to settle. The opening test
// (requests.perf.ts) and the journeys test (journeys.perf.ts) import it; the rules the numbers are
// judged by are in scripts/requests/budget.ts. The layout shift test (layoutShift.perf.ts) takes
// its torrents from here too.
import { readdirSync } from 'node:fs'
import { relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { CDPSession, Page, Request } from '@playwright/test'
import { clockRun, type Sent } from '../../scripts/requests/budget.ts'
import * as intervals from '../../src/torrents/pollIntervals.ts'
import { NOW, tmdbTag, torrent } from '../../src/test/fixtures.ts'
import { DESKTOP } from '../app.ts'

/** The phone is the config's viewport; the desktop the screenshot tests' `DESKTOP`. */
export const SIZES = [
  { size: 'phone', use: {} },
  { size: 'desktop', use: DESKTOP },
]

/**
 * The performance tests' own torrents (the requests test's and the layout shift test's), so a change
 * to the shared fixtures for a screenshot doesn't move a budget: two whose titles their tags name and
 * one whose title the app guesses from its name, which asks TMDB and saves the guess on the server.
 */
export const TORRENTS = [
  torrent('p1', { name: 'Dune.Part.Two.2024.2160p.UHD.BluRay.REMUX-GRPA', tags: tmdbTag('movie', 693134), category: 'Movies', progress: 0.5 }),
  torrent('p2', { name: 'Shogun.S01.2160p.WEB-DL.DDP5.1.H.265-GRPB', tags: tmdbTag('tv', 126308), category: 'TV Shows', state: 'uploading', progress: 1 }),
  torrent('p3', { name: 'Interstellar.2014.1080p.BluRay.x264-GRPC', state: 'pausedDL', progress: 0.1 }),
]

/** A screen's heading, by its level and name. */
export type Heading = { level: number; name: string }
/** A control only the screen's loaded content has. */
export type Loaded = { role: 'link' | 'button'; name: string }

/**
 * How far the clock runs after the page loads: less than the shortest interval the app polls at, so
 * the timers a screen's open sets off fire (the save of a guessed title a second later) and no poll
 * repeats. The clock is paused otherwise, so the count doesn't grow with the time a run takes. A
 * journey shares it between its opening and its moves (`clockShare`).
 */
export const RUN_MS = clockRun(intervals)
/** The clock runs in steps, with the page left to settle after each, so a timer set after an answer fires in order. */
export const STEP_MS = 100
/** The page has settled when no request has been in flight for this long, in real time. */
const QUIET_MS = 250
/** How long the page may take to settle before the test gives up and names what is still in flight. */
const SETTLE_LIMIT_MS = 10_000

/**
 * The paths of the build's files as the server serves them (`/theme.js`, `/assets/…`): what the page
 * loads of them isn't counted. Read when a test runs, after the config's server has built nothing:
 * `npm run build` comes first, as in CI.
 */
export function builtPaths(): Set<string> {
  const dist = fileURLToPath(new URL('../../dist/', import.meta.url))
  return new Set(
    readdirSync(dist, { recursive: true, withFileTypes: true })
      .filter((entry) => !entry.isDirectory())
      .map((entry) => `/${relative(dist, `${entry.parentPath}${sep}${entry.name}`).split(sep).join('/')}`),
  )
}

/**
 * What the page sends, from the moment it's recorded: `take` hands over what was sent since the last
 * `take`; `sending` gives the list it's adding to now, which keeps growing until the next `take`.
 */
export type Recording = { inFlight: Set<Request>; take: () => Sent[]; sending: () => Sent[] }

/** Records every request the page sends and keeps those still in flight, for `settled`. */
export function record(page: Page): Recording {
  let sent: Sent[] = []
  const inFlight = new Set<Request>()
  page.on('request', (request) => {
    // The page itself: the main frame's navigation, not a frame's or a fetch of the same address.
    sent.push({ method: request.method(), url: request.url(), document: request.isNavigationRequest() && request.frame() === page.mainFrame() })
    inFlight.add(request)
  })
  page.on('requestfinished', (request) => inFlight.delete(request))
  page.on('requestfailed', (request) => inFlight.delete(request))
  return {
    inFlight,
    sending: () => sent,
    take: () => {
      const taken = sent
      sent = []
      return taken
    },
  }
}

/**
 * Waits until no request has been in flight for `QUIET_MS` of real time: the page's clock is paused,
 * but its requests are answered on the test's side, which the page's clock doesn't run (a wait on
 * the page's timers would never end). After `SETTLE_LIMIT_MS` it throws, naming what is still in
 * flight, rather than hang until the test's timeout with nothing said.
 */
export async function settled(inFlight: Set<Request>): Promise<void> {
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

/**
 * Holds the page for counting, before anything loads: its clock installed and paused at the fixtures'
 * `NOW`, and every image it loads kept in memory for as long as the page lives.
 *
 * Kept, because whether a poster shown again is asked for again otherwise depends on the browser's
 * garbage collection: an image no element shows any more stays in Chromium's memory of the document's
 * images only until the next collection, and the tests block the service worker, while Playwright's
 * routes turn the HTTP cache off. Kept, a poster the page loaded once isn't asked for again, as the
 * HTTP cache and the service worker give in production. Every TMDB image the app shows is an `<img>`.
 */
export async function holdForCounting(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const kept = new Set<HTMLImageElement>()
    // On the capture phase, since `load` doesn't bubble: every image of the document, whoever adds it.
    document.addEventListener('load', (event) => event.target instanceof HTMLImageElement && kept.add(event.target), true)
  })
  await page.clock.install({ time: NOW - 1_000 })
  await page.clock.pauseAt(NOW)
}

const sessions = new WeakMap<Page, CDPSession>()

/**
 * Has Chromium collect the page's garbage now, so a count never rests on a collection not having
 * happened: a part's requests are counted as they are after one, every run, and the images
 * `holdForCounting` keeps are what stops a collection from adding a request.
 */
async function collectGarbage(page: Page): Promise<void> {
  let session = sessions.get(page)
  if (!session) {
    session = await page.context().newCDPSession(page)
    sessions.set(page, session)
  }
  await session.send('HeapProfiler.collectGarbage')
}

/**
 * Collects the page's garbage, then lets it settle and runs its clock for `run` ms in steps of
 * `STEP_MS`, collecting again and letting it settle after each. The first collection lands while the
 * requests a move set off are still in flight, the later ones between steps and after the part.
 */
export async function runClock(page: Page, inFlight: Set<Request>, run: number): Promise<void> {
  await collectGarbage(page)
  await settled(inFlight)
  for (let ran = 0; ran < run; ran += STEP_MS) {
    await page.clock.runFor(Math.min(STEP_MS, run - ran))
    await settled(inFlight)
    await collectGarbage(page)
  }
}
