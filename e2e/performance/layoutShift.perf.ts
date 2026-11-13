// How much a screen's content moves as it loads (#387): the built app, every server route mocked as
// in the screenshot tests, a screen opened afresh by its address on a phone, with the answers it
// loads from held and let land one at a time, each after the page painted what the one before
// showed. The page's layout shifts are summed and judged against `budgets.layoutShift` in
// checks.json by scripts/layout-shift/budget.ts; the reading is in layoutShift.ts.
import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { judge, readBudgets, type Budgets } from '../../scripts/layout-shift/budget.ts'
import { torrent } from '../../src/test/fixtures.ts'
import { prepareApp } from '../app.ts'
import { holdAnswers, layoutShifts, painted, recordLayoutShifts } from './layoutShift.ts'
import { TORRENTS } from './page.ts'

const BUDGETS = readBudgets(JSON.parse(readFileSync(new URL('../../checks.json', import.meta.url), 'utf8')))

/**
 * Named here rather than taken from the configs this one builds on, since the test can only fail
 * with them: #387's jump, a frame drawn with the page 118px up, shows only under reduced motion,
 * whose rule in src/styles/base.css turns every style change into a 1 ms transition (without it
 * `main`'s page read 0.0656, under the bound); and the phone at its size, since the share of the
 * window that moves is the score (from 1024px wide the page is the desktop drawer).
 */
test.use({ reducedMotion: 'reduce', viewport: { width: 390, height: 844 } })

/**
 * The answers a torrent's page loads from, each held until the test lets it land: the session check
 * (qBittorrent's version and the server's settings, before which the app shows no screen), the
 * torrents (the poll), the server's title matches, TMDB's search for a title guessed from the
 * release name, a known title from TMDB by its id, and the images.
 */
const ANSWERS = {
  session: (url: URL) => url.pathname === '/qbt/api/v2/app/version' || url.pathname === '/api/settings',
  torrents: (url: URL) => url.pathname === '/qbt/api/v2/sync/maindata',
  matches: (url: URL) => url.pathname === '/api/matches',
  search: (url: URL) => url.pathname.startsWith('/tmdb/search/'),
  title: (url: URL) => url.pathname.startsWith('/tmdb/') && !url.pathname.startsWith('/tmdb/search/'),
  poster: (url: URL) => url.pathname.startsWith('/tmdb-img/'),
}
type Answer = keyof typeof ANSWERS

/** Not tagged, and named so that TMDB finds nothing for it: no title is found, the page offers to match one. */
const UNKNOWN = torrent('p4', { name: 'Family.Trip.2019.1080p.WEB-DL.x264-GRPD', state: 'pausedDL', progress: 0.1 })

/** A torrent's page, the order its answers land in, and what shows once each has landed. */
interface Case {
  name: string
  hash: string
  order: Answer[]
  /** Waits for what the answer shows, if anything: its own content, so it painted. */
  shown: Partial<Record<Answer, (page: Page) => Promise<void>>>
  /**
   * An answer to what the page sends by itself later, waited for after the last of `order`: set
   * up before the page opens, so it can't land unseen.
   */
  later?: (page: Page) => Promise<unknown>
}

const loading = async (page: Page) => expect(page.getByText('Загружаем торрент')).toBeAttached()
const heading = (name: string) => async (page: Page) => expect(page.getByRole('heading', { level: 1, name })).toBeVisible()
const images = async (page: Page) => {
  await expect.poll(() => page.evaluate(() => [...document.images].every((image) => image.complete && image.naturalWidth > 0))).toBe(true)
}

/**
 * Each page in the one order its answers can land in that tells anything. The session comes first
 * on every page: the app asks for nothing else before it. The matches go out beside the first
 * poll; the server has none for these torrents (`prepareApp` answers `{}`) and the test lands them
 * where a server answers them, before the torrents.
 */
const CASES: Case[] = [
  /**
   * `p2`: tagged with its title and finished. The page asks for the title by its id once the
   * torrent shows, and for the poster once the title does; the matches, `{}`, change nothing on
   * the page wherever they land.
   */
  {
    name: 'tagged and finished',
    hash: 'p2',
    order: ['session', 'matches', 'torrents', 'title', 'poster'],
    shown: { session: loading, torrents: heading(TORRENTS[1].name), title: heading('Сёгун'), poster: images },
  },
  /**
   * `p3`: no tag, its title guessed from its name with a cold cache (#389: "Is it right?" came in
   * above the progress card with the guess and moved it, Pause and Delete, by 0.1051). A guess waits
   * for both the torrents and the server's matches (another device may have made it already), so
   * TMDB's search goes out after the later of the two; with the matches empty, landing them after
   * the torrents paints the same states as before them. The poster is asked for once the guess
   * shows, and a second after it the guess is saved on the server, whose answer is waited for too.
   */
  {
    name: 'title guessed from its name',
    hash: 'p3',
    order: ['session', 'matches', 'torrents', 'search', 'poster'],
    shown: { session: loading, torrents: heading(TORRENTS[2].name), search: heading('Интерстеллар'), poster: images },
    later: (page) =>
      page.waitForResponse((response) => new URL(response.url()).pathname === '/api/matches' && response.request().method() === 'PATCH'),
  },
  /**
   * `p4`: no tag, and TMDB's search finds nothing for its name, which waits for the torrents and the
   * matches as `p3`'s does. Once it has answered Match title shows beside More, out of the flow;
   * nothing else is asked for, and nothing is saved.
   */
  {
    name: 'no title found',
    hash: 'p4',
    order: ['session', 'matches', 'torrents', 'search'],
    shown: {
      session: loading,
      torrents: heading(UNKNOWN.name),
      search: async (page) => expect(page.getByRole('button', { name: 'Сопоставить' })).toBeVisible(),
    },
  },
]

/**
 * A torrent's page on a phone, where #387 moved by 0.26 and #389 by 0.105. Not the desktop drawer:
 * it's a third of the window's width at 1440×900 and nearly half at 1024×768, the narrowest
 * desktop, so even all its content moving down by its header's height scores 0.027 and 0.062, and
 * a bound of 0.1 can't catch it there.
 */
for (const { name, hash, order, shown, later } of CASES) {
  test(`torrent, ${name}: ${order.join(' → ')}`, async ({ page }, testInfo) => {
    expect(BUDGETS, `budgets.layoutShift in checks.json can't be read:\n${[BUDGETS].flat().join('\n')}`).not.toBeInstanceOf(Array)
    await recordLayoutShifts(page)
    await prepareApp(page, { torrents: [...TORRENTS, UNKNOWN] })
    const { release } = await holdAnswers(page, ANSWERS)
    const answered = later?.(page)
    await page.goto(`/torrent/${hash}`)
    for (const answer of order) {
      await release(answer)
      await shown[answer]?.(page)
      await painted(page)
    }
    if (answered) {
      await answered
      await painted(page)
    }
    const shifts = await layoutShifts(page)
    const verdict = judge({ size: 'phone', screen: 'torrent' }, shifts, BUDGETS as Budgets)
    await testInfo.attach('layout shift', { contentType: 'application/json', body: JSON.stringify({ size: 'phone', screen: 'torrent', hash, total: verdict.total, shifts }) })
    expect(verdict.passed, verdict.report).toBe(true)
  })
}
