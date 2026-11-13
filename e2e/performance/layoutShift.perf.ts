// How much each screen's content moves as it loads (#387, #378): the built app, every server route
// mocked as in the screenshot tests, each screen of screens.ts opened afresh by its address on a
// phone, with every answer it loads from held and let land one at a time, each after the page
// painted what the one before showed, in the two orders scripts/layout-shift/answers.ts names, and
// read once the screen shows what it shows complete (`complete`). The page's layout shifts are
// summed and judged against `budgets.layoutShift` in checks.json by scripts/layout-shift/budget.ts;
// the reading and the holding are in layoutShift.ts (docs/TESTING.md → The layout shift test).
import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { chainOf, ORDER_NAMES, orders } from '../../scripts/layout-shift/answers.ts'
import { judge, readBudgets, uncased, unmatched, type Budgets } from '../../scripts/layout-shift/budget.ts'
import { torrent } from '../../src/test/fixtures.ts'
import type { Torrent } from '../../src/api/qbittorrent/types.ts'
import { prepareApp } from '../app.ts'
import { holdAnswers, layoutShifts, painted, recordLayoutShifts, type Answer } from './layoutShift.ts'
import { builtPaths, TORRENTS } from './page.ts'
import { SCREENS } from './screens.ts'

const BUDGETS = readBudgets(JSON.parse(readFileSync(new URL('../../checks.json', import.meta.url), 'utf8')))

/** The one window size the test reads: a phone's. */
const SIZE = 'phone'

/**
 * Named here rather than taken from the configs this one builds on, since the test can only fail
 * with them: #387's jump, a frame drawn with the page 118px up, shows only under reduced motion,
 * whose rule in src/styles/base.css turns every style change into a 1 ms transition (without it
 * `main`'s page read 0.0656, under the bound); and the phone at its size, since the share of the
 * window that moves is the score.
 */
test.use({ reducedMotion: 'reduce', viewport: { width: 390, height: 844 } })

/** Not tagged, and named so that TMDB finds nothing for it: no title is found, the page offers to match one. */
const UNKNOWN = torrent('p4', { name: 'Family.Trip.2019.1080p.WEB-DL.x264-GRPD', state: 'pausedDL', progress: 0.1 })

// What a request is: by its path and method, the query aside unless it tells two answers apart.
const get =
  (path: string) =>
  (url: URL, method: string): boolean =>
    method === 'GET' && url.pathname === path
const under =
  (prefix: string) =>
  (url: URL, method: string): boolean =>
    method === 'GET' && url.pathname.startsWith(prefix)

// What a screen shows when it is complete, waited for once its last answer has landed: a condition
// on the page, since what the last answer brings can show later than it lands (a title in a list
// shows with the next show, `SHOW_EVERY_MS`), and nothing after it is due to hold the reading.
type Shown = (page: Page) => Promise<void>
const heading = (name: string, level = 1): Shown => (page) => expect(page.getByRole('heading', { level, name, exact: true })).toBeVisible()
const link = (name: string): Shown => (page) => expect(page.getByRole('link', { name }).first()).toBeVisible()
const text = (content: string): Shown => (page) => expect(page.getByText(content).first()).toBeVisible()
/** The status Connections shows for a service, in its own row: other rows say "Connected" too. */
const connection = (name: string, status: string | RegExp): Shown => (page) =>
  expect(page.getByRole('listitem').filter({ has: page.getByText(name, { exact: true }) }).getByRole('status')).toHaveText(status)
/** Every poster on the page (`Poster`, decorative, so found by its frame) shown and loaded, at least `count` of them. */
const posters =
  (count: number): Shown =>
  async (page) => {
    const loaded = () =>
      page.evaluate(() =>
        [...document.querySelectorAll<HTMLImageElement>('.ks-poster img')].filter((image) => image.complete && image.naturalWidth > 0 && image.checkVisibility()).length,
      )
    await expect.poll(loaded).toBeGreaterThanOrEqual(count)
    const all = () => page.evaluate(() => [...document.querySelectorAll<HTMLImageElement>('.ks-poster img')].every((image) => image.complete && image.naturalWidth > 0 && image.checkVisibility()))
    await expect.poll(all).toBe(true)
  }
/** Each of `shown`, in turn. */
const all =
  (...shown: Shown[]): Shown =>
  async (page) => {
    for (const one of shown) await one(page)
  }

/**
 * Every screen's first answers (src/App.tsx): qBittorrent's version, the session check, before which
 * the app shows "Connecting" and no screen; the server's settings, which say whether onboarding asks
 * for a TMDB key (`useTmdbSetup`), after which the screen paints; and the server's settings again,
 * the download defaults `useSettings` loads once per page.
 */
const SESSION: Record<string, Answer> = {
  version: { matches: get('/qbt/api/v2/app/version') },
  tmdbSetup: { matches: get('/api/settings'), after: ['version'] },
  defaults: { matches: get('/api/settings'), after: ['tmdbSetup'] },
}

/**
 * The torrents (the poll) and the server's title matches, which a screen that shows torrents asks for
 * together once it paints.
 */
const TORRENTS_AND_MATCHES: Record<string, Answer> = {
  torrents: { matches: get('/qbt/api/v2/sync/maindata'), after: ['tmdbSetup'], later: true },
  matches: { matches: get('/api/matches'), after: ['tmdbSetup'] },
}

/**
 * `p3`'s title, guessed from its name by TMDB's search, which waits for the server's matches too
 * (another device may have made the guess); a second after the guess it is saved on the server.
 * A title page picks its torrents among them with this guess alone (#381).
 */
const GUESS: Record<string, Answer> = {
  guessP3: { matches: under('/tmdb/search/'), after: ['torrents', 'matches'] },
  saveGuess: { matches: (url, method) => method === 'PATCH' && url.pathname === '/api/matches', after: ['guessP3'] },
}

/**
 * The titles of the performance tests' torrents (`TORRENTS`), which `useTitleMatches` looks up for
 * a screen that shows them: `p1`'s and `p2`'s by the ids their tags name, once the torrents are
 * known, and `p3`'s guess.
 */
const LOOKUPS: Record<string, Answer> = {
  titleP1: { matches: get('/tmdb/movie/693134'), after: ['torrents'] },
  titleP2: { matches: get('/tmdb/tv/126308'), after: ['torrents'] },
  ...GUESS,
}

/** A state of a screen: its answers and the order they're asked for in (its chain). */
interface Case {
  screen: string
  name: string
  /** Another address than the screen's in screens.ts: another torrent's page. */
  path?: string
  /** The torrents qBittorrent has, instead of the performance tests' own. */
  torrents?: Torrent[]
  answers: Record<string, Answer>
  /** What the screen shows once every answer has landed and been shown: the reading waits for it. */
  complete: Shown
}

const torrentPage = (name: string, hash: string, complete: Shown, rest: Record<string, Answer>): Case => ({
  screen: 'torrent',
  name,
  path: `/torrent/${hash}`,
  torrents: [...TORRENTS, UNKNOWN],
  complete,
  answers: {
    ...SESSION,
    ...TORRENTS_AND_MATCHES,
    ...rest,
  },
})

/**
 * The title page's answers (TitleScreen): the title's details, its poster once they're in, what to
 * watch next (TitleRelated, under the page's fold), and the torrents with their titles, of which the
 * title's own show in its "In downloads" badge and block once the details are in too. The block is
 * at the page's end, under the related titles, and waits for them: in the order where the torrents
 * land first, the row coming in above it would push it down (0.0608 without the wait, #394).
 */
const titlePage = (name: string, type: string, id: number, complete: Shown, related: Record<string, Answer>): Case => ({
  screen: type === 'movie' ? 'title' : 'series',
  name,
  complete,
  answers: {
    ...SESSION,
    details: { matches: get(`/tmdb/${type}/${id}`), after: ['tmdbSetup'] },
    ...TORRENTS_AND_MATCHES,
    ...GUESS,
    poster: { matches: get(`/tmdb-img/w342/${type}-${id}.svg`), after: ['details'] },
    ...related,
    relatedPosters: {
      matches: (url, method) => under('/tmdb-img/')(url, method) && url.pathname !== `/tmdb-img/w342/${type}-${id}.svg`,
      after: [Object.keys(related).at(-1)!],
      later: true,
    },
  },
})

/** The releases screen's answers (ReleasesScreen): the series' details, then Prowlarr's search, then which indexers failed during it. */
const releasesPage = (name: string): Case => ({
  screen: 'releases',
  name,
  // The last answer, which indexers failed, shows nothing when none did: the results are the last state.
  complete: all(text('Сёгун · 2024'), (page) => expect(page.getByRole('button', { name: 'Добавить в загрузки' }).first()).toBeVisible()),
  answers: {
    ...SESSION,
    details: { matches: get('/tmdb/tv/126308'), after: ['tmdbSetup'] },
    search: { matches: get('/prowlarr/search'), after: ['details'] },
    failing: { matches: get('/prowlarr/failing'), after: ['search'] },
  },
})

/**
 * Every state of every screen the list names whose blocks differ, each with the chain of answers its
 * code asks for (docs/TESTING.md → The layout shift test lists the late blocks each covers).
 */
const CASES: Case[] = [
  {
    screen: 'downloads',
    name: 'titles found',
    complete: all(link('Дюна: Часть вторая'), link('Сёгун'), link('Интерстеллар'), posters(3)),
    answers: {
      ...SESSION,
      ...TORRENTS_AND_MATCHES,
      ...LOOKUPS,
      posters: { matches: under('/tmdb-img/'), afterAny: ['titleP1', 'titleP2', 'guessP3'], later: true },
    },
  },
  /**
   * `p2`: tagged with its title and finished. The page asks for the title by its id once the
   * torrent shows, and for the poster once the title does.
   */
  torrentPage('tagged and finished', 'p2', all(heading('Сёгун'), posters(1)), {
    title: { matches: get('/tmdb/tv/126308'), after: ['torrents'] },
    poster: { matches: under('/tmdb-img/'), after: ['title'] },
  }),
  /**
   * `p3`: no tag, its title guessed from its name with a cold cache (#389: "Is it right?" came in
   * above the progress card with the guess and moved it, Pause and Delete, by 0.1051). The poster
   * is asked for once the guess shows, and a second after it the guess is saved on the server.
   */
  torrentPage('title guessed from its name', 'p3', all(heading('Интерстеллар'), posters(1)), {
    search: { matches: under('/tmdb/search/'), after: ['torrents', 'matches'] },
    poster: { matches: under('/tmdb-img/'), after: ['search'] },
    saveGuess: { matches: (url, method) => method === 'PATCH' && url.pathname === '/api/matches', after: ['search'] },
  }),
  /**
   * `p4`: no tag, and TMDB's search finds nothing for its name. Once it has answered More gets its
   * dot, out of the flow; nothing else is asked for, and nothing is saved.
   */
  torrentPage(
    'no title found',
    'p4',
    (page) => expect(page.getByRole('button', { name: /^Ещё действия/ })).toHaveAccessibleDescription('Торрент не сопоставлен с фильмом или сериалом'),
    { search: { matches: under('/tmdb/search/'), after: ['torrents', 'matches'] } },
  ),
  /**
   * Search with no query: its three rows of titles, each a Discover query, show together once all
   * three have answered (`loadBrowseRows`), in place of the skeleton; then their posters.
   */
  {
    screen: 'browse',
    name: 'rows of titles',
    complete: all(heading('Лучшее за год', 2), posters(1)),
    answers: {
      ...SESSION,
      newMovies: { matches: (url, method) => get('/tmdb/discover/movie')(url, method) && !url.searchParams.has('vote_count.gte'), after: ['tmdbSetup'] },
      newEpisodes: { matches: get('/tmdb/discover/tv'), after: ['tmdbSetup'] },
      bestOfYear: { matches: (url, method) => get('/tmdb/discover/movie')(url, method) && url.searchParams.has('vote_count.gte'), after: ['tmdbSetup'] },
      posters: { matches: under('/tmdb-img/'), after: ['newMovies', 'newEpisodes', 'bestOfYear'], later: true },
    },
  },
  /** A search: its results in place of the skeleton, with their count and Show more, then their posters. */
  {
    screen: 'search',
    name: 'titles found',
    complete: all(link('Дюна: Часть вторая'), posters(1)),
    answers: {
      ...SESSION,
      results: { matches: get('/tmdb/search/multi'), after: ['tmdbSetup'] },
      posters: { matches: under('/tmdb-img/'), after: ['results'] },
    },
  },
  /** A search with a year: movies and series searched apart, shown together once both have answered. */
  {
    screen: 'search-year',
    name: 'titles found',
    complete: all(link('Разделение'), posters(1)),
    answers: {
      ...SESSION,
      movies: { matches: get('/tmdb/search/movie'), after: ['tmdbSetup'] },
      series: { matches: get('/tmdb/search/tv'), after: ['tmdbSetup'] },
      posters: { matches: under('/tmdb-img/'), after: ['movies', 'series'], later: true },
    },
  },
  /** A movie in downloads, with TMDB's recommendations. */
  titlePage('in downloads, with recommendations', 'movie', 693134, all(heading('Дюна: Часть вторая'), heading('В загрузках', 2), heading('Рекомендации', 2), posters(2)), {
    recommendations: { matches: get('/tmdb/movie/693134/recommendations'), after: ['details'] },
  }),
  /** A series in downloads, which TMDB has no recommendations for: similar titles instead, asked once the recommendations come back empty. */
  titlePage('in downloads, with similar titles', 'tv', 126308, all(heading('Сёгун'), heading('В загрузках', 2), heading('Похожее', 2), posters(2)), {
    recommendations: { matches: get('/tmdb/tv/126308/recommendations'), after: ['details'] },
    similar: { matches: get('/tmdb/tv/126308/similar'), after: ['recommendations'] },
  }),
  /**
   * Releases found, every indexer answered. With one that failed, the note above the list moves it
   * (#393): that case comes with the fix.
   */
  releasesPage('every indexer answered'),
  /**
   * Settings: every row is there from its first paint, and the checks only change what the rows say
   * (Connections, About) and fill the category selects.
   */
  {
    screen: 'settings',
    name: 'every service answers',
    complete: all(
      connection('qBittorrent', 'Подключено'),
      connection('Prowlarr', 'Подключено'),
      connection('TMDB', /^Подключено/),
      text('2.0.5.5160'),
      (page) => expect(page.getByRole('combobox', { name: 'Категория фильмов' })).toBeEnabled(),
    ),
    answers: {
      ...SESSION,
      // The same address as the session's two: Settings' own load of the server's settings.
      serverSettings: { matches: get('/api/settings'), after: ['tmdbSetup'] },
      // The same address as the session's check: Connections' check of qBittorrent.
      qbittorrentCheck: { matches: get('/qbt/api/v2/app/version'), after: ['tmdbSetup'] },
      prowlarrCheck: { matches: get('/prowlarr/status'), after: ['tmdbSetup'] },
      tmdbCheck: { matches: get('/tmdb/configuration'), after: ['tmdbSetup'] },
      categories: { matches: get('/qbt/api/v2/torrents/categories'), after: ['qbittorrentCheck'] },
    },
  },
]

test('every screen the list names has a case and a budget, and every budget a screen', () => {
  expect(BUDGETS, `budgets.layoutShift in checks.json can't be read:\n${[BUDGETS].flat().join('\n')}`).not.toBeInstanceOf(Array)
  const listed = SCREENS.map(({ screen }) => screen)
  expect(uncased(listed, CASES.map(({ screen }) => screen))).toEqual([])
  expect(unmatched(BUDGETS as Budgets, listed.map((screen) => ({ size: SIZE, screen })))).toEqual([])
})

for (const { screen, name, path, torrents, answers, complete } of CASES) {
  for (const order of orders(chainOf(answers))) {
    test(`${screen}, ${name}: ${ORDER_NAMES[order]}`, async ({ page }, testInfo) => {
      expect(BUDGETS, `budgets.layoutShift in checks.json can't be read:\n${[BUDGETS].flat().join('\n')}`).not.toBeInstanceOf(Array)
      await recordLayoutShifts(page)
      await prepareApp(page, { torrents: torrents ?? TORRENTS })
      const { land } = await holdAnswers(page, answers, order, builtPaths())
      await page.goto(path ?? SCREENS.find((listed) => listed.screen === screen)!.path)
      const { landed, unnamed } = await land()
      expect(unnamed, 'The page asked for what no answer of the case is: name it in the chain, from the screen\'s code').toEqual([])
      await complete(page)
      await painted(page)
      const shifts = await layoutShifts(page)
      const verdict = judge({ size: SIZE, screen }, shifts, BUDGETS as Budgets)
      await testInfo.attach('layout shift', {
        contentType: 'application/json',
        body: JSON.stringify({ size: SIZE, screen, name, order, landed, total: verdict.total, shifts }),
      })
      expect(verdict.passed, verdict.report).toBe(true)
    })
  }
}
