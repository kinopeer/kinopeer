// How much a screen's content moves as it loads (#387): the built app, every server route mocked as
// in the screenshot tests, a screen opened afresh by its address on a phone, with the
// answers it loads from held and let land one at a time, in each order the page can get them in,
// every state painted before the next answer. The page's layout
// shifts are summed and held to `GOOD_LAYOUT_SHIFT`. The reading is in layoutShift.ts.
import { expect, test, type Page } from '@playwright/test'
import { tmdbTag, torrent } from '../../src/test/fixtures.ts'
import { prepareApp } from '../app.ts'
import { holdAnswers, layoutShifts, painted, recordLayoutShifts, total } from './layoutShift.ts'

/** The bound Web Vitals call good for layout shift. */
const GOOD_LAYOUT_SHIFT = 0.1

/** The requests test's torrents (requests.perf.ts): two titles named by their tags, one guessed from its name. */
const TORRENTS = [
  torrent('p1', { name: 'Dune.Part.Two.2024.2160p.UHD.BluRay.REMUX-GRPA', tags: tmdbTag('movie', 693134), category: 'Movies', progress: 0.5 }),
  torrent('p2', { name: 'Shogun.S01.2160p.WEB-DL.DDP5.1.H.265-GRPB', tags: tmdbTag('tv', 126308), category: 'TV Shows', state: 'uploading', progress: 1 }),
  torrent('p3', { name: 'Interstellar.2014.1080p.BluRay.x264-GRPC', state: 'pausedDL', progress: 0.1 }),
]

/**
 * The answers a torrent's page loads from, each held until the test lets it land: the session check
 * (qBittorrent's version and the server's settings, before which the app shows no screen), the
 * torrents (the poll), the server's title matches, the titles from TMDB and their images.
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
 * The page asks for each of these only once the one before has landed and shown (the torrents once
 * the session is checked, a title once its torrent shows, a poster once its title does), so they
 * land in this order whatever the network does; the server's matches are asked for beside them and
 * may land anywhere among them.
 */
const CHAIN: Answer[] = ['session', 'torrents', 'title', 'poster']

/**
 * Every order the answers can land in: the matches at each place in the chain. Each answer lands
 * after the page has painted what the one before showed, so every state in between is on the
 * screen for a frame at least, as on a slow connection, the worst case: a state that never painted
 * can't move anything.
 */
const ORDERS: Answer[][] = CHAIN.map((_, at) => [...CHAIN.slice(0, at + 1), 'matches', ...CHAIN.slice(at + 1)])

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
 * window's width, so even all its content moving by its header's height scores under 0.03, and the
 * bound couldn't catch it there.
 */
for (const order of ORDERS) {
  test(`torrent: ${order.join(' → ')}`, async ({ page }, testInfo) => {
    await recordLayoutShifts(page)
    await prepareApp(page, { torrents: TORRENTS })
    const { release } = await holdAnswers(page, ANSWERS)
    await page.goto('/torrent/p2')
    for (const answer of order) {
      await release(answer)
      await shown(page, answer)
    }
    const shifts = await layoutShifts(page)
    await testInfo.attach('layout shift', { contentType: 'application/json', body: JSON.stringify({ screen: 'torrent', order, value: total(shifts), shifts }) })
    const report = shifts.map((shift) => `  ${shift.value.toFixed(4)}: ${shift.sources.join(', ')}`).join('\n')
    expect(total(shifts), `The page's content moved as it loaded:\n${report}`).toBeLessThanOrEqual(GOOD_LAYOUT_SHIFT)
  })
}
