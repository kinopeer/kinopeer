// How much each screen's content moves as it loads (#387, #378): the built app, every server route
// mocked as in the screenshot tests, each screen of screens.ts opened afresh by its address on a
// phone and on desktop (and a few states in narrower desktop windows), with every answer it loads
// from held and let land one at a time, each after the page painted what the one before showed, in
// the two orders scripts/layout-shift/answers.ts names, and read once the screen shows what it shows
// complete (`complete`). The page's layout shifts are summed and judged against
// `budgets.layoutShift` in checks.json by scripts/layout-shift/budget.ts; the reading and the
// holding are in layoutShift.ts (docs/TESTING.md → The layout shift test).
import { readFileSync } from 'node:fs'
import { expect, test, type Page } from '@playwright/test'
import { chainOf, ORDER_NAMES, orders } from '../../scripts/layout-shift/answers.ts'
import { judge, readBudgets, uncased, unmatched, type Budgets } from '../../scripts/layout-shift/budget.ts'
import { torrent } from '../../src/test/fixtures.ts'
import type { Torrent } from '../../src/api/qbittorrent/types.ts'
import { DESKTOP, DESKTOP_RAIL, prepareApp, type AppOptions } from '../app.ts'
import { holdAnswers, layoutShifts, painted, recordLayoutShifts, type Answer } from './layoutShift.ts'
import { builtPaths, TORRENTS } from './page.ts'
import { SCREENS } from './screens.ts'

const BUDGETS = readBudgets(JSON.parse(readFileSync(new URL('../../checks.json', import.meta.url), 'utf8')))

/**
 * The window sizes the test reads, each a key of `budgets.layoutShift`: a phone's, and the desktop
 * layout at the canvas's width, the screenshot tests' `DESKTOP`, each with every screen of the list;
 * and two narrower desktop windows for what moves only there (`NARROW`).
 */
const VIEWPORTS = {
  phone: { width: 390, height: 844 },
  desktop: DESKTOP.viewport,
  /** The narrowest desktop, with the icon rail: the screenshot tests' `DESKTOP_RAIL`. */
  'desktop-rail': DESKTOP_RAIL.viewport,
  /** A common laptop's window, with the labeled sidebar. */
  'desktop-1280': { width: 1280, height: 800 },
}
type Size = keyof typeof VIEWPORTS
/** The sizes that read every screen of the list; the others read only the cases they name. */
const EVERY_SCREEN: Size[] = ['phone', 'desktop']

/**
 * Named here rather than taken from the configs this one builds on, since the test can only fail
 * with them: #387's jump, a frame drawn with the page 118px up, shows only under reduced motion,
 * whose rule in src/styles/base.css turns every style change into a 1 ms transition (without it
 * `main`'s page read 0.0656, under the bound); and each size (`VIEWPORTS`, set per size below),
 * since the share of the window that moves is the score.
 */
test.use({ reducedMotion: 'reduce' })

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
 * On desktop, the torrents for the sidebar's downloading count and qBittorrent card (`SidebarStatus`
 * in App), which read the shared poll on every screen; a screen that shows torrents asks for them
 * itself (`TORRENTS_AND_MATCHES`).
 */
const SIDEBAR: Record<string, Answer> = {
  torrents: { matches: get('/qbt/api/v2/sync/maindata'), after: ['tmdbSetup'], later: true },
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
  /** What else the mocked services answer: an indexer that failed. */
  app?: Omit<AppOptions, 'torrents'>
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

/** The size of a title's poster by layout: the desktop hero's is larger, at any desktop width. */
const POSTER = { phone: 'w342', desktop: 'w500' }
type Layout = keyof typeof POSTER

/**
 * The title page's answers (TitleScreen): the title's details, its poster once they're in, what to
 * watch next (TitleRelated, under the page's fold), and the torrents with their titles, of which the
 * title's own show in its "In downloads" badge and block once the details are in too. The block is
 * at the page's end, under the related titles, and waits for them: in the order where the torrents
 * land first, the row coming in above it would push it down (0.0608 without the wait, #394).
 */
const titleAnswers = (layout: Layout, type: string, id: number, related: Record<string, Answer>): Record<string, Answer> => {
  const poster = `/tmdb-img/${POSTER[layout]}/${type}-${id}.svg`
  return {
    ...SESSION,
    details: { matches: get(`/tmdb/${type}/${id}`), after: ['tmdbSetup'] },
    ...TORRENTS_AND_MATCHES,
    ...GUESS,
    poster: { matches: get(poster), after: ['details'] },
    ...related,
    relatedPosters: {
      matches: (url, method) => under('/tmdb-img/')(url, method) && url.pathname !== poster,
      after: [Object.keys(related).at(-1)!],
      later: true,
    },
  }
}
const titlePage = (layout: Layout, name: string, type: string, id: number, complete: Shown, related: Record<string, Answer>): Case => ({
  screen: type === 'movie' ? 'title' : 'series',
  name,
  complete,
  answers: titleAnswers(layout, type, id, related),
})
/** What to watch next on a series' page: TMDB has no recommendations for it, so similar titles, asked once the recommendations come back empty. */
const SERIES_RELATED: Record<string, Answer> = {
  recommendations: { matches: get('/tmdb/tv/126308/recommendations'), after: ['details'] },
  similar: { matches: get('/tmdb/tv/126308/similar'), after: ['recommendations'] },
}

/**
 * The releases screen's answers (ReleasesScreen): the series' details, then Prowlarr's search, then
 * which indexers failed during it, which the count's line says once it has answered (#393).
 */
const releasesPage = (name: string, failingIndexers: string[] = [], noReleases = false): Case => ({
  screen: 'releases',
  name,
  app: { failingIndexers, noReleases },
  complete: noReleases
    ? all(text('Сёгун · 2024'), text('Раздачи не найдены'))
    : all(
        text('Сёгун · 2024'),
        (page) => expect(page.getByRole('button', { name: 'Добавить в загрузки' }).first()).toBeVisible(),
        // With none failed, the last answer shows nothing: the results are the last state.
        ...(failingIndexers.length ? [(page: Page) => expect(page.getByRole('button', { name: /не ответил/ })).toBeVisible()] : []),
      ),
  answers: {
    ...SESSION,
    details: { matches: get('/tmdb/tv/126308'), after: ['tmdbSetup'] },
    search: { matches: get('/prowlarr/search'), after: ['details'] },
    failing: { matches: get('/prowlarr/failing'), after: ['search'] },
  },
})

/**
 * Every state of every screen the list names whose blocks differ, by size, each with the chain of
 * answers its code asks for (docs/TESTING.md → The layout shift test lists the late blocks each covers).
 */
const PHONE: Case[] = [
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
  titlePage('phone', 'in downloads, with recommendations', 'movie', 693134, all(heading('Дюна: Часть вторая'), heading('В загрузках', 2), heading('Рекомендации', 2), posters(2)), {
    recommendations: { matches: get('/tmdb/movie/693134/recommendations'), after: ['details'] },
  }),
  /** A series in downloads, which TMDB has no recommendations for: similar titles instead, asked once the recommendations come back empty. */
  titlePage('phone', 'in downloads, with similar titles', 'tv', 126308, all(heading('Сёгун'), heading('В загрузках', 2), heading('Похожее', 2), posters(2)), SERIES_RELATED),
  /** Releases found, every indexer answered: the filters' row is there, a skeleton, before them (#393). */
  releasesPage('every indexer answered'),
  /** Releases found, one indexer didn't answer: the count's line says so, where a note above the list moved it (#393). */
  releasesPage('an indexer didn’t answer', ['Indexer C']),
  /** Nothing found: the filters' row keeps its room, empty, over the empty state, where it went away and moved it up (#393's review). */
  releasesPage('nothing found', [], true),
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

/**
 * The title page with its releases under the hero, searched since the page opened at their
 * address: the series' page, and Prowlarr's search and which indexers failed once the details are in.
 */
const desktopReleases = (name: string, failingIndexers: string[] = [], noReleases = false): Case => ({
  screen: 'releases',
  name,
  app: { failingIndexers, noReleases },
  complete: all(
    heading('Сёгун'),
    noReleases
      ? text('Раздачи не найдены')
      : (page) => expect(page.getByRole('button', { name: 'Добавить в загрузки' }).first()).toBeVisible(),
    ...(failingIndexers.length && !noReleases ? [(page: Page) => expect(page.getByRole('button', { name: /не ответил/ })).toBeVisible()] : []),
    heading('В загрузках', 2),
    heading('Похожее', 2),
    posters(2),
  ),
  answers: {
    ...titleAnswers('desktop', 'tv', 126308, SERIES_RELATED),
    search: { matches: get('/prowlarr/search'), after: ['details'] },
    failing: { matches: get('/prowlarr/failing'), after: ['search'] },
  },
})

/** TMDB's search for a title by the name read from a torrent's. */
const searchFor =
  (query: string) =>
  (url: URL, method: string): boolean =>
    get('/tmdb/search/multi')(url, method) && url.searchParams.get('query') === query

/**
 * An untagged torrent's drawer over Downloads (`p3`'s or `p4`'s, `UNKNOWN` among the torrents). The
 * list looks its four titles up three at a time (`CONCURRENCY` in src/torrents/useTitleMatches.ts):
 * `p1`'s and `p2`'s by their tags' ids and `p3`'s guess by TMDB's search once the torrents and the
 * matches are in, then `p4`'s once one of those has. The drawer looks its own torrent up on its own
 * once the torrents and the matches are in, the same address as the list's guess for it. Then the
 * posters once a title is in, and `p3`'s guess saved a second after the first that finds it
 * (`guessed`, the answers that do).
 */
const drawerOverDownloads = (name: string, hash: string, shown: Shown, guesses: Record<string, Answer>, guessed: string[]): Case => ({
  screen: 'torrent',
  name,
  path: `/torrent/${hash}`,
  torrents: [...TORRENTS, UNKNOWN],
  complete: all(shown, link('Дюна: Часть вторая'), link('Сёгун'), link('Интерстеллар'), posters(3)),
  answers: {
    ...SESSION,
    ...TORRENTS_AND_MATCHES,
    titleP1: { matches: get('/tmdb/movie/693134'), after: ['torrents'] },
    titleP2: { matches: get('/tmdb/tv/126308'), after: ['torrents'] },
    ...guesses,
    posters: { matches: under('/tmdb-img/'), afterAny: ['titleP1', 'titleP2', ...guessed], later: true },
    saveGuess: { matches: (url, method) => method === 'PATCH' && url.pathname === '/api/matches', afterAny: guessed },
  },
})

/** A screen of the list with the sidebar's answer added, as desktop shows it: its answers, then the sidebar's. */
const withSidebar = (one: Case): Case => ({ ...one, answers: { ...one.answers, ...SIDEBAR } })
/**
 * The sidebar's qBittorrent card complete, its free space shown as a number, which it says once the
 * torrents have landed (a `—` until then). Read on the card's own free space line, which is in the
 * page on a narrow window too, where the rail's column shows instead: in the region's whole text the
 * speeds' numbers run up to that line's placeholder.
 */
const sidebarCard: Shown = (page) =>
  expect(page.getByRole('region', { name: 'qBittorrent' }).getByText(/^\S+\s\S+ свободно$|^— свободно$/)).toHaveText(/^\d/)
/** A desktop case, read once the sidebar's card is complete too: every desktop screen shows it. */
const onDesktop = (one: Case): Case => ({ ...one, complete: all(one.complete, sidebarCard) })
const casesOf = (screen: string) => PHONE.filter((one) => one.screen === screen)

const DESKTOP_CASES: Case[] = [
  // The list as on a phone, the sidebar reading the same poll: the grid of cards, desktop's default view.
  ...casesOf('downloads'),
  // The other view, the table of rows (`DownloadRow`, the column header): a layout of its own.
  ...casesOf('downloads').map((one) => ({ ...one, name: 'titles found, as a table', app: { downloadsView: 'list' as const } })),
  /**
   * `p2`'s drawer over Downloads: the list's lookups and posters, and the drawer's own load of the
   * title by its tag's id, the same address as the list's, once the torrent shows.
   */
  {
    screen: 'torrent',
    name: 'tagged and finished, over Downloads',
    path: '/torrent/p2',
    complete: all(heading('Сёгун', 2), link('Дюна: Часть вторая'), link('Интерстеллар'), posters(3)),
    answers: {
      ...SESSION,
      ...TORRENTS_AND_MATCHES,
      ...LOOKUPS,
      title: { matches: get('/tmdb/tv/126308'), after: ['torrents'] },
      posters: { matches: under('/tmdb-img/'), afterAny: ['titleP1', 'titleP2', 'title', 'guessP3'], later: true },
    },
  },
  // `p3`: the drawer's guess beside the list's.
  drawerOverDownloads('title guessed from its name, over Downloads', 'p3', heading('Интерстеллар', 2), {
    guessP3: { matches: searchFor('Interstellar'), after: ['torrents', 'matches'] },
    drawerGuess: { matches: searchFor('Interstellar'), after: ['torrents', 'matches'] },
    guessP4: { matches: searchFor('Family Trip'), after: ['torrents', 'matches'], afterAny: ['titleP1', 'titleP2', 'guessP3'] },
  }, ['guessP3', 'drawerGuess']),
  // `p4`: TMDB finds nothing for it, and nothing is saved for it.
  drawerOverDownloads(
    'no title found, over Downloads',
    'p4',
    (page) => expect(page.getByRole('dialog').getByRole('button', { name: /^Ещё действия/ })).toHaveAccessibleDescription('Торрент не сопоставлен с фильмом или сериалом'),
    {
      guessP3: { matches: searchFor('Interstellar'), after: ['torrents', 'matches'] },
      drawerGuess: { matches: searchFor('Family Trip'), after: ['torrents', 'matches'] },
      guessP4: { matches: searchFor('Family Trip'), after: ['torrents', 'matches'], afterAny: ['titleP1', 'titleP2', 'guessP3'] },
    },
    ['guessP3'],
  ),
  ...casesOf('browse').map(withSidebar),
  ...casesOf('search').map(withSidebar),
  ...casesOf('search-year').map(withSidebar),
  titlePage('desktop', 'in downloads, with recommendations', 'movie', 693134, all(heading('Дюна: Часть вторая'), heading('В загрузках', 2), heading('Рекомендации', 2), posters(2)), {
    recommendations: { matches: get('/tmdb/movie/693134/recommendations'), after: ['details'] },
  }),
  titlePage('desktop', 'in downloads, with similar titles', 'tv', 126308, all(heading('Сёгун'), heading('В загрузках', 2), heading('Похожее', 2), posters(2)), SERIES_RELATED),
  /**
   * The title page with its releases under the hero, searched since the page opened at their
   * address: the series' page, and Prowlarr's search and which indexers failed once the details are in.
   */
  desktopReleases('every indexer answered, on the series’ page'),
  desktopReleases('an indexer didn’t answer, on the series’ page', ['Indexer C']),
  /** Nothing found: the bar's room stays, empty, over the empty state (#393's review). */
  desktopReleases('nothing found, on the series’ page', [], true),
  ...casesOf('settings').map(withSidebar),
]

/**
 * The narrower desktop windows: the releases' filter bar, one line while the search runs, wraps to a
 * second once the results' filters land where they don't fit one line (#400).
 */
const NARROW: Case[] = [desktopReleases('every indexer answered, on the series’ page')]

const CASES: Record<Size, Case[]> = { phone: PHONE, desktop: DESKTOP_CASES.map(onDesktop), 'desktop-rail': NARROW.map(onDesktop), 'desktop-1280': NARROW.map(onDesktop) }

test('every screen the list names has a case on a phone and on desktop, every screen read a budget at its size, and every budget a screen read there', () => {
  expect(BUDGETS, `budgets.layoutShift in checks.json can't be read:\n${[BUDGETS].flat().join('\n')}`).not.toBeInstanceOf(Array)
  const listed = SCREENS.map(({ screen }) => screen)
  for (const size of EVERY_SCREEN) expect(uncased(listed, CASES[size].map(({ screen }) => screen)), size).toEqual([])
  const read = (Object.keys(VIEWPORTS) as Size[]).flatMap((size) => [...new Set(CASES[size].map(({ screen }) => screen))].map((screen) => ({ size, screen })))
  // A narrower size reads only some screens, so only the other half of `uncased` applies to it: no
  // case reads a screen the list doesn't name.
  expect(uncased(listed, read.map(({ screen }) => screen))).toEqual([])
  expect(unmatched(BUDGETS as Budgets, read)).toEqual([])
})

for (const size of Object.keys(VIEWPORTS) as Size[]) {
  test.describe(size, () => {
    test.use({ viewport: VIEWPORTS[size] })
    for (const { screen, name, path, torrents, app, answers, complete } of CASES[size]) {
      for (const order of orders(chainOf(answers))) {
        test(`${screen}, ${name}: ${ORDER_NAMES[order]}`, async ({ page }, testInfo) => {
          expect(BUDGETS, `budgets.layoutShift in checks.json can't be read:\n${[BUDGETS].flat().join('\n')}`).not.toBeInstanceOf(Array)
          await recordLayoutShifts(page)
          await prepareApp(page, { ...app, torrents: torrents ?? TORRENTS })
          const { land } = await holdAnswers(page, answers, order, builtPaths())
          await page.goto(path ?? SCREENS.find((listed) => listed.screen === screen)!.path)
          const { landed, unnamed } = await land()
          expect(unnamed, 'The page asked for what no answer of the case is: name it in the chain, from the screen\'s code').toEqual([])
          await complete(page)
          await painted(page)
          const shifts = await layoutShifts(page)
          const verdict = judge({ size, screen }, shifts, BUDGETS as Budgets)
          await testInfo.attach('layout shift', {
            contentType: 'application/json',
            body: JSON.stringify({ size, screen, name, order, landed, total: verdict.total, shifts }),
          })
          expect(verdict.passed, verdict.report).toBe(true)
        })
      }
    }
  })
}
