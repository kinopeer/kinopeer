// How much a screen's content moves as it loads (#387): the built app, every server route mocked as
// in the screenshot tests, a screen opened afresh by its address on a phone, with the answers it
// loads from held and let land one at a time, each after the page painted what the one before
// showed. The page's layout shifts are summed and judged against `budgets.layoutShift` in
// checks.json by scripts/layout-shift/budget.ts; the reading is in layoutShift.ts.
import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { judge, readBudgets, type Budgets } from '../../scripts/layout-shift/budget.ts'
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
 * torrents (the poll), the server's title matches, the title from TMDB and its images.
 */
const ANSWERS = {
  session: (url: URL) => url.pathname === '/qbt/api/v2/app/version' || url.pathname === '/api/settings',
  torrents: (url: URL) => url.pathname === '/qbt/api/v2/sync/maindata',
  matches: (url: URL) => url.pathname === '/api/matches',
  title: (url: URL) => url.pathname.startsWith('/tmdb/'),
  poster: (url: URL) => url.pathname.startsWith('/tmdb-img/'),
}
type Answer = keyof typeof ANSWERS

/**
 * The page of `p2`, a torrent tagged with its title and finished, in the one order its answers can
 * land in that tells anything: the page asks for the torrents once the session is checked, for a
 * tagged torrent's title once the torrent shows, and for the poster once the title does. The
 * matches go out beside the first poll, after the session; the server has none for `p2`, whose
 * title comes from its tag (`prepareApp` answers `{}`), so where they land changes nothing on the
 * page and they land where a server answers them, before the torrents. A guessed torrent's title
 * waits for the matches instead, and its page is another state (docs/TESTING.md → The layout
 * shift test → What it leaves out).
 */
const ORDER: Answer[] = ['session', 'matches', 'torrents', 'title', 'poster']

/** What shows once an answer has landed, before the next is let through: its own content, so it painted. */
async function shown(page: Page, answer: Answer): Promise<void> {
  if (answer === 'session') await expect(page.getByText('Загружаем торрент')).toBeAttached()
  if (answer === 'torrents') await expect(page.getByRole('heading', { level: 1, name: TORRENTS[1].name })).toBeVisible()
  if (answer === 'title') await expect(page.getByRole('heading', { level: 1, name: 'Сёгун' })).toBeVisible()
  if (answer === 'poster') {
    await expect.poll(() => page.evaluate(() => [...document.images].every((image) => image.complete && image.naturalWidth > 0))).toBe(true)
  }
  await painted(page)
}

/**
 * A torrent's page on a phone, where #387 moved by 0.26. Not the desktop drawer: it's a third of the
 * window's width at 1440×900 and nearly half at 1024×768, the narrowest desktop, so even all its
 * content moving down by its header's height scores 0.027 and 0.062, and a bound of 0.1 can't
 * catch it there.
 */
test(`torrent, tagged and finished: ${ORDER.join(' → ')}`, async ({ page }, testInfo) => {
  expect(BUDGETS, `budgets.layoutShift in checks.json can't be read:\n${[BUDGETS].flat().join('\n')}`).not.toBeInstanceOf(Array)
  await recordLayoutShifts(page)
  await prepareApp(page, { torrents: TORRENTS })
  const { release } = await holdAnswers(page, ANSWERS)
  await page.goto('/torrent/p2')
  for (const answer of ORDER) {
    await release(answer)
    await shown(page, answer)
  }
  const shifts = await layoutShifts(page)
  const verdict = judge({ size: 'phone', screen: 'torrent' }, shifts, BUDGETS as Budgets)
  await testInfo.attach('layout shift', { contentType: 'application/json', body: JSON.stringify({ size: 'phone', screen: 'torrent', total: verdict.total, shifts }) })
  expect(verdict.passed, verdict.report).toBe(true)
})
