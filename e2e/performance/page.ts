// What both requests tests do with the page (docs/QUALITY.md → The requests budget): record what it
// sends, hold its clock and run it in steps, and wait for it to settle. The opening test
// (requests.perf.ts) and the journeys test (journeys.perf.ts) import it; the rules the numbers are
// judged by are in scripts/requests/budget.ts.
import { readdirSync } from 'node:fs'
import { relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import type { Page, Request } from '@playwright/test'
import { clockRun, type Sent } from '../../scripts/requests/budget.ts'
import * as intervals from '../../src/torrents/pollIntervals.ts'
import { NOW } from '../../src/test/fixtures.ts'
import { DESKTOP } from '../app.ts'

/** The phone is the config's viewport; the desktop the screenshot tests' `DESKTOP`. */
export const SIZES = [
  { size: 'phone', use: {} },
  { size: 'desktop', use: DESKTOP },
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

/** What the page sends, from the moment it's recorded: `take` hands over what was sent since the last `take`. */
export type Recording = { inFlight: Set<Request>; take: () => Sent[] }

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

/** Installs the page's clock, paused at the fixtures' `NOW`, before anything loads. */
export async function holdClock(page: Page): Promise<void> {
  await page.clock.install({ time: NOW - 1_000 })
  await page.clock.pauseAt(NOW)
}

/** Lets the page settle, then runs its clock for `run` ms in steps of `STEP_MS`, letting it settle after each. */
export async function runClock(page: Page, inFlight: Set<Request>, run: number): Promise<void> {
  await settled(inFlight)
  for (let ran = 0; ran < run; ran += STEP_MS) {
    await page.clock.runFor(Math.min(STEP_MS, run - ran))
    await settled(inFlight)
  }
}
