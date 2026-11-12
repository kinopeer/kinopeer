// A one-off trial for #378, not a check: how far time-based speed metrics move between runs of the
// same commit. The built app with every server route mocked as the requests tests do (prepareApp,
// their torrents), but on the real clock: each screen loaded afresh (a new browser context per
// load) in three regimes, as the machine is, with the CPU slowed four times, and with 100 ms of
// synchronous work planted at the start of the page. Every number is read on the page's own clock
// or from Chromium through CDP and appended as one JSON line to $TRIAL_OUT; scripts/timing-trial/
// aggregate.mjs reads those lines.
import { appendFileSync, mkdirSync } from 'node:fs'
import { cpus, totalmem, type as osType, release } from 'node:os'
import { dirname } from 'node:path'
import { expect, test, type CDPSession, type Page, type Request } from '@playwright/test'
import { tmdbTag, torrent } from '../../src/test/fixtures.ts'
import { DESKTOP, prepareApp } from '../app.ts'

const OUT = process.env.TRIAL_OUT ?? 'test-results/timing-trial.jsonl'
const REPEATS = Number(process.env.TRIAL_REPEATS ?? 5)
const JOB = process.env.TRIAL_JOB ?? 'local'

/** The requests test's torrents (e2e/performance/requests.perf.ts), the third guessed from its name. */
const TORRENTS = [
  torrent('p1', { name: 'Dune.Part.Two.2024.2160p.UHD.BluRay.REMUX-GRPA', tags: tmdbTag('movie', 693134), category: 'Movies', progress: 0.5 }),
  torrent('p2', { name: 'Shogun.S01.2160p.WEB-DL.DDP5.1.H.265-GRPB', tags: tmdbTag('tv', 126308), category: 'TV Shows', state: 'uploading', progress: 1 }),
  torrent('p3', { name: 'Interstellar.2014.1080p.BluRay.x264-GRPC', state: 'pausedDL', progress: 0.1 }),
]

type Heading = { level: number; name: string }
type Loaded = { role: 'link' | 'button'; name: string }
/** What shows that a screen has loaded: its heading and, where the requests test names one, a loaded control. */
type Target = { heading: Heading; loaded?: Loaded }

/** The nine screens of requests.perf.ts, with the same headings and loaded controls. */
const SCREENS: { screen: string; path: string; heading: Heading; desktop?: Heading; loaded?: Loaded }[] = [
  { screen: 'downloads', path: '/', heading: { level: 1, name: 'Загрузки' }, loaded: { role: 'link', name: 'Дюна: Часть вторая' } },
  { screen: 'torrent', path: '/torrent/p2', heading: { level: 1, name: 'Сёгун' }, desktop: { level: 2, name: 'Сёгун' } },
  { screen: 'browse', path: '/search', heading: { level: 1, name: 'Поиск' }, loaded: { role: 'link', name: 'Оппенгеймер' } },
  { screen: 'search', path: '/search?q=%D0%B4%D1%8E%D0%BD%D0%B0', heading: { level: 1, name: 'Поиск' }, loaded: { role: 'link', name: 'Дюна: Часть вторая' } },
  { screen: 'search-year', path: '/search?q=%D0%B0&year=2022', heading: { level: 1, name: 'Поиск' }, loaded: { role: 'link', name: 'Разделение' } },
  { screen: 'title', path: '/title/movie/693134', heading: { level: 1, name: 'Дюна: Часть вторая' } },
  { screen: 'series', path: '/title/tv/126308', heading: { level: 1, name: 'Сёгун' } },
  { screen: 'releases', path: '/title/tv/126308/releases', heading: { level: 1, name: 'Раздачи' }, desktop: { level: 1, name: 'Сёгун' }, loaded: { role: 'button', name: 'Добавить в загрузки' } },
  { screen: 'settings', path: '/settings', heading: { level: 1, name: 'Настройки' } },
]

const DOWNLOADS: Target = { heading: { level: 1, name: 'Загрузки' }, loaded: { role: 'link', name: 'Дюна: Часть вторая' } }
const BROWSE: Target = { heading: { level: 1, name: 'Поиск' }, loaded: { role: 'link', name: 'Оппенгеймер' } }

/** The three moves: where each starts, the input it makes and the event that input's latency is timed from. */
const MOVES: { move: string; path: string; from: Target; event: 'click' | 'input'; make: (page: Page) => Promise<unknown>; to: (desktop: boolean) => Target }[] = [
  {
    move: 'tab',
    path: '/',
    from: DOWNLOADS,
    event: 'click',
    make: (page) => page.getByRole('navigation').getByRole('link', { name: /^Поиск/ }).click(),
    to: () => BROWSE,
  },
  {
    move: 'row',
    path: '/',
    from: DOWNLOADS,
    event: 'click',
    make: (page) => page.getByRole('link', { name: 'Дюна: Часть вторая' }).click(),
    to: (desktop) => ({ heading: { level: desktop ? 2 : 1, name: 'Дюна: Часть вторая' } }),
  },
  {
    move: 'query',
    path: '/search',
    from: BROWSE,
    event: 'input',
    make: (page) => page.getByRole('searchbox').fill('дюна'),
    to: () => ({ heading: { level: 1, name: 'Поиск' }, loaded: { role: 'button', name: 'Показать ещё' } }),
  },
]

const SIZES = [
  { size: 'phone', use: {} },
  { size: 'desktop', use: DESKTOP },
]
const REGIMES = ['clean', 'cpu4x', 'planted'] as const
type Regime = (typeof REGIMES)[number]

/** The page is still once nothing in it changed and no request was in flight for this long. */
const STILL_MS = 500
/** How long after loading a page may take to be still before the run says it never was. */
const STILL_LIMIT_MS = 10_000
const PLANTED_MS = 100

function write(record: object): void {
  mkdirSync(dirname(OUT), { recursive: true })
  appendFileSync(OUT, `${JSON.stringify({ job: JOB, ...record })}\n`)
}

/**
 * The page's own instruments, before any of its scripts: paint, LCP, layout shifts, long tasks and
 * event timings through PerformanceObserver; the last moment anything changed (a mutation, a shift,
 * an LCP candidate, a load); and the first animation frame at which the target shows, timed from
 * the navigation's start (the frame's own timestamp, so on the page's clock).
 */
function instrument(target: Target): void {
  type Trial = {
    target: Target
    lcp: number | null
    shifts: { value: number; recent: boolean; at: number }[]
    longTasks: [number, number][]
    events: { name: string; start: number; duration: number; interaction: number }[]
    lastChange: number
    loadedAt: number | null
    nextPaint: number | null
  }
  const trial: Trial = { target, lcp: null, shifts: [], longTasks: [], events: [], lastChange: 0, loadedAt: null, nextPaint: null }
  ;(window as unknown as { __trial: Trial }).__trial = trial
  const changed = () => (trial.lastChange = performance.now())
  const observe = (type: string, onEntry: (entry: PerformanceEntry & Record<string, unknown>) => void, extra: object = {}) => {
    try {
      new PerformanceObserver((list) => list.getEntries().forEach((entry) => onEntry(entry as PerformanceEntry & Record<string, unknown>))).observe({ type, buffered: true, ...extra })
    } catch {
      // Unsupported: the field stays empty, and the report says so.
    }
  }
  observe('largest-contentful-paint', (entry) => {
    trial.lcp = entry.startTime
    changed()
  })
  observe('layout-shift', (entry) => {
    trial.shifts.push({ value: entry.value as number, recent: entry.hadRecentInput as boolean, at: entry.startTime })
    changed()
  })
  observe('longtask', (entry) => trial.longTasks.push([entry.startTime, entry.duration]))
  observe('event', (entry) => trial.events.push({ name: entry.name, start: entry.startTime, duration: entry.duration, interaction: entry.interactionId as number }), { durationThreshold: 16 })
  new MutationObserver(changed).observe(document, { childList: true, subtree: true, attributes: true, characterData: true })
  document.addEventListener('load', changed, true)

  const norm = (text: string | null | undefined) => (text ?? '').replace(/\s+/g, ' ').trim()
  const nameOf = (element: Element) => {
    const label = element.getAttribute('aria-label')
    if (label) return norm(label)
    const by = element.getAttribute('aria-labelledby')
    if (by) return norm(by.split(/\s+/).map((id) => document.getElementById(id)?.textContent).join(' '))
    return norm(element.textContent)
  }
  const visible = (element: Element) => {
    const box = element.getBoundingClientRect()
    return box.width > 0 && box.height > 0 && element.checkVisibility({ visibilityProperty: true, opacityProperty: true })
  }
  const shows = () => {
    const { heading, loaded } = trial.target
    const headings = document.querySelectorAll(`h${heading.level}, [role="heading"][aria-level="${heading.level}"]`)
    if (![...headings].some((element) => nameOf(element) === heading.name && visible(element))) return false
    if (!loaded) return true
    const wanted = loaded.name.toLowerCase()
    const controls = document.querySelectorAll(loaded.role === 'link' ? 'a[href], [role="link"]' : 'button, [role="button"]')
    return [...controls].some((element) => nameOf(element).toLowerCase().includes(wanted) && visible(element))
  }
  const frame = (at: number) => {
    if (trial.loadedAt === null && shows()) trial.loadedAt = at
    if (trial.loadedAt === null) requestAnimationFrame(frame)
  }
  requestAnimationFrame(frame)
}

/**
 * 100 ms of synchronous work at the start of the page, before any of its own scripts run: a task
 * the init script queues, rather than a loop in the init script itself, which Chromium runs while
 * it sets the document up and counts neither as a long task nor as script time (a first local run
 * showed TBT 0 and ScriptDuration unchanged with it), so it would test only those counters'
 * blindness to init scripts, not a slowdown the app's own code could make.
 */
function plant(ms: number): void {
  setTimeout(() => {
    const end = performance.now() + ms
    while (performance.now() < end) {
      // Busy.
    }
  }, 0)
}

/** Opens a CDP session with Chromium's own counters on and the CPU slowed for `cpu4x`. */
async function cdpFor(page: Page, regime: Regime): Promise<CDPSession> {
  const cdp = await page.context().newCDPSession(page)
  await cdp.send('Performance.enable')
  if (regime === 'cpu4x') await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 })
  return cdp
}

/** Tracks requests in flight and when the last one started or ended, in the test's real time. */
function network(page: Page): { inFlight: Set<Request>; lastAt: () => number } {
  const inFlight = new Set<Request>()
  let last = Date.now()
  page.on('request', (request) => {
    inFlight.add(request)
    last = Date.now()
  })
  const done = (request: Request) => {
    inFlight.delete(request)
    last = Date.now()
  }
  page.on('requestfinished', done)
  page.on('requestfailed', done)
  return { inFlight, lastAt: () => last }
}

/** Opens `path` afresh with the instruments in place, waits for `target` to show and the page to be still. */
async function open(page: Page, path: string, target: Target, regime: Regime) {
  const cdp = await cdpFor(page, regime)
  const net = network(page)
  await page.addInitScript(instrument, target)
  if (regime === 'planted') await page.addInitScript(plant, PLANTED_MS)
  await prepareApp(page, { torrents: TORRENTS })
  await page.goto(path)
  await page.waitForFunction(() => (window as unknown as { __trial: { loadedAt: number | null } }).__trial.loadedAt !== null, undefined, { polling: 50, timeout: 30_000 })
  // The page's check agrees with Playwright's: the same heading and control, by role and name.
  await expect(page.getByRole('heading', { level: target.heading.level, name: target.heading.name, exact: true })).toBeVisible()
  if (target.loaded) await expect(page.getByRole(target.loaded.role, { name: target.loaded.name }).first()).toBeVisible()
  const still = await waitStill(page, net)
  return { cdp, still }
}

/** Waits until nothing in the page changed and no request was in flight for `STILL_MS`; false if that never came. */
async function waitStill(page: Page, net: { inFlight: Set<Request>; lastAt: () => number }): Promise<boolean> {
  const started = Date.now()
  while (Date.now() - started < STILL_LIMIT_MS) {
    const quietFor = await page.evaluate(() => performance.now() - (window as unknown as { __trial: { lastChange: number } }).__trial.lastChange)
    const networkQuiet = net.inFlight.size === 0 && Date.now() - net.lastAt() >= STILL_MS
    if (quietFor >= STILL_MS && networkQuiet) return true
    await new Promise((resolve) => setTimeout(resolve, 50))
  }
  return false
}

/** Chromium's main-thread counters, in ms since the session turned them on (the page's whole life). */
async function mainThread(cdp: CDPSession) {
  const { metrics } = await cdp.send('Performance.getMetrics')
  const ms = (name: string) => {
    const metric = metrics.find((entry) => entry.name === name)
    return metric ? metric.value * 1000 : null
  }
  return { script: ms('ScriptDuration'), layout: ms('LayoutDuration'), style: ms('RecalcStyleDuration'), task: ms('TaskDuration') }
}

async function pageNumbers(page: Page) {
  return page.evaluate(() => {
    const trial = (window as unknown as { __trial: { lcp: number | null; shifts: { value: number; recent: boolean; at: number }[]; longTasks: [number, number][]; loadedAt: number | null } }).__trial
    const fcp = performance.getEntriesByName('first-contentful-paint')[0]?.startTime ?? null
    const tbt = trial.longTasks.reduce((sum, [, duration]) => sum + Math.max(0, duration - 50), 0)
    const cls = trial.shifts.filter((shift) => !shift.recent).reduce((sum, shift) => sum + shift.value, 0)
    return { fcp, lcp: trial.lcp, loaded: trial.loadedAt, tbt, longTasks: trial.longTasks, cls, shifts: trial.shifts.map((shift) => shift.value), measuredAt: performance.now() }
  })
}

// The machine, and one load of Downloads not recorded, so the first recorded load doesn't also pay
// for the preview server's and the browser's first start.
test('the machine', async ({ browser, page }) => {
  await prepareApp(page, { torrents: TORRENTS })
  await page.goto('/')
  await expect(page.getByRole('heading', { level: 1, name: 'Загрузки' })).toBeVisible()
  write({
    kind: 'meta',
    os: `${osType()} ${release()}`,
    cpu: cpus()[0]?.model,
    cores: cpus().length,
    memoryGb: Math.round(totalmem() / 2 ** 30),
    browser: browser.version(),
    node: process.version,
    repeats: REPEATS,
    runner: process.env.RUNNER_NAME ?? null,
    imageVersion: process.env.ImageVersion ?? null,
    startedAt: new Date().toISOString(),
  })
})

// Repeats outermost, so each regime's runs spread over the job's whole time rather than one stretch of it.
for (let repeat = 1; repeat <= REPEATS; repeat++) {
  for (const { size, use } of SIZES) {
    test.describe(`${repeat} ${size}`, () => {
      test.use(use)
      const desktop = size === 'desktop'
      for (const regime of REGIMES) {
        for (const { screen, path, heading, desktop: desktopHeading, loaded } of SCREENS) {
          test(`${regime} ${screen}`, async ({ page }) => {
            const base = { kind: 'screen', repeat, size, regime, name: screen }
            try {
              const { cdp, still } = await open(page, path, { heading: desktop && desktopHeading ? desktopHeading : heading, loaded }, regime)
              write({ ...base, still, ...(await pageNumbers(page)), ...(await mainThread(cdp)) })
            } catch (error) {
              write({ ...base, error: String(error).slice(0, 500) })
              throw error
            }
          })
        }
        for (const { move, path, from, event, make, to } of MOVES) {
          test(`${regime} move ${move}`, async ({ page }) => {
            const base = { kind: 'move', repeat, size, regime, name: move }
            try {
              await open(page, path, from, regime)
              // The input's latency to the next paint: from the event's own timestamp to a message
              // posted from the next animation frame, which runs after that frame is painted. In the
              // planted regime the input also does 100 ms of synchronous work, since the work planted
              // at the page's start is long over by the time of the move.
              await page.evaluate(
                ({ event, planted }) => {
                  const trial = (window as unknown as { __trial: { nextPaint: number | null; moveAt: number | null } }).__trial
                  trial.moveAt = null
                  window.addEventListener(
                    event,
                    (input) => {
                      if (trial.moveAt !== null) return
                      trial.moveAt = input.timeStamp
                      if (planted) {
                        const end = performance.now() + planted
                        while (performance.now() < end) {
                          // Busy.
                        }
                      }
                      requestAnimationFrame(() => {
                        const channel = new MessageChannel()
                        channel.port1.onmessage = () => (trial.nextPaint = performance.now() - input.timeStamp)
                        channel.port2.postMessage(null)
                      })
                    },
                    true,
                  )
                },
                { event, planted: regime === 'planted' ? PLANTED_MS : 0 },
              )
              await make(page)
              await page.waitForFunction(() => (window as unknown as { __trial: { nextPaint: number | null } }).__trial.nextPaint !== null, undefined, { polling: 50, timeout: 10_000 })
              const target = to(desktop)
              await expect(page.getByRole('heading', { level: target.heading.level, name: target.heading.name, exact: true })).toBeVisible()
              if (target.loaded) await expect(page.getByRole(target.loaded.role, { name: target.loaded.name }).first()).toBeVisible()
              // Event Timing's view of the same input, for comparison: rounded to 8 ms, and only
              // entries of 16 ms or more exist.
              const numbers = await page.evaluate(() => {
                const trial = (window as unknown as { __trial: { nextPaint: number; moveAt: number; events: { name: string; start: number; duration: number; interaction: number }[] } }).__trial
                const after = trial.events.filter((entry) => entry.start >= trial.moveAt - 50 && entry.interaction > 0)
                return { nextPaint: trial.nextPaint, eventTiming: after.length ? Math.max(...after.map((entry) => entry.duration)) : null, eventNames: [...new Set(after.map((entry) => entry.name))] }
              })
              write({ ...base, ...numbers })
            } catch (error) {
              write({ ...base, error: String(error).slice(0, 500) })
              throw error
            }
          })
        }
      }
    })
  }
}
