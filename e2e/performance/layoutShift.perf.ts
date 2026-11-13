// How much each screen's content moves as it loads (#387, #378): the built app, every server route
// mocked as in the screenshot tests, each screen of screens.ts opened afresh by its address on a
// phone, with every answer it loads from held and let land one at a time, each after the page
// painted what the one before showed, in the two orders scripts/layout-shift/answers.ts names. The
// page's layout shifts are summed and judged against `budgets.layoutShift` in checks.json by
// scripts/layout-shift/budget.ts; the reading and the holding are in layoutShift.ts
// (docs/TESTING.md → The layout shift test).
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

// What an answer shows, waited for once it lands.
const heading = (name: string, level = 1) => async (page: Page) => expect(page.getByRole('heading', { level, name, exact: true })).toBeVisible()
const link = (name: string | RegExp) => async (page: Page) => expect(page.getByRole('link', { name }).first()).toBeVisible()
const text = (content: string | RegExp) => async (page: Page) => expect(page.getByText(content).first()).toBeVisible()
/**
 * Every image on the page has loaded, or every one whose address has `only` in it, or every one
 * without `except`: the posters that came with this answer, when another's are still held.
 */
const images =
  ({ only, except }: { only?: string; except?: string } = {}) =>
  async (page: Page) => {
    const loaded = () =>
      page.evaluate(
        ({ only, except }) =>
          [...document.images]
            .filter((image) => (only === undefined || image.src.includes(only)) && (except === undefined || !image.src.includes(except)))
            .every((image) => image.complete && image.naturalWidth > 0),
        { only, except },
      )
    await expect.poll(loaded).toBe(true)
  }
/** The status Connections shows for a service, in its own row: other rows say "Connected" too. */
const connection = (name: string, status: string | RegExp) => async (page: Page) =>
  expect(page.getByRole('listitem').filter({ has: page.getByText(name, { exact: true }) }).getByRole('status')).toHaveText(status)
/** Waits for what `wait` shows only once every one of `answers` has landed: a block that needs them all. */
const once =
  (answers: string[], wait: (page: Page) => Promise<void>) =>
  async (page: Page, landed: ReadonlySet<string>) => {
    if (answers.every((name) => landed.has(name))) await wait(page)
  }

/**
 * Every screen's first answers (src/App.tsx): qBittorrent's version, the session check, before which
 * the app shows "Connecting" and no screen; the server's settings, which say whether onboarding asks
 * for a TMDB key (`useTmdbSetup`), after which the screen paints (`firstPaint`); and the server's
 * settings again, the download defaults `useSettings` loads once per page.
 */
const session = (firstPaint: (page: Page) => Promise<void>): Record<string, Answer> => ({
  version: { matches: get('/qbt/api/v2/app/version') },
  tmdbSetup: { matches: get('/api/settings'), after: ['version'], shown: firstPaint },
  defaults: { matches: get('/api/settings'), after: ['tmdbSetup'] },
})

/**
 * The torrents (the poll) and the server's title matches, which a screen that shows torrents asks for
 * together once it paints.
 */
const torrentsAndMatches = (shown?: Answer['shown']): Record<string, Answer> => ({
  torrents: { matches: get('/qbt/api/v2/sync/maindata'), after: ['tmdbSetup'], shown, polls: true },
  matches: { matches: get('/api/matches'), after: ['tmdbSetup'] },
})

/**
 * The titles of the performance tests' torrents (`TORRENTS`), which `useTitleMatches` looks up for
 * any screen that shows them or picks a title's among them: `p1`'s and `p2`'s by the ids their tags
 * name, once the torrents are known, and `p3`'s guessed from its name by TMDB's search, which waits
 * for the server's matches too (another device may have made the guess); a second after the guess
 * it is saved on the server.
 */
const lookups = (shown: { p1?: Answer['shown']; p2?: Answer['shown']; p3?: Answer['shown'] } = {}): Record<string, Answer> => ({
  titleP1: { matches: get('/tmdb/movie/693134'), after: ['torrents'], shown: shown.p1 },
  titleP2: { matches: get('/tmdb/tv/126308'), after: ['torrents'], shown: shown.p2 },
  guessP3: { matches: under('/tmdb/search/'), after: ['torrents', 'matches'], shown: shown.p3 },
  saveGuess: { matches: (url, method) => method === 'PATCH' && url.pathname === '/api/matches', after: ['guessP3'] },
})

/** A state of a screen: its answers, the order they're asked for in (its chain), and what each shows. */
interface Case {
  screen: string
  name: string
  /** Another address than the screen's in screens.ts: another torrent's page. */
  path?: string
  /** The torrents qBittorrent has, instead of the performance tests' own. */
  torrents?: Torrent[]
  answers: Record<string, Answer>
}

const torrentPage = (name: string, hash: string, title: (page: Page) => Promise<void>, rest: Record<string, Answer>): Case => ({
  screen: 'torrent',
  name,
  path: `/torrent/${hash}`,
  torrents: [...TORRENTS, UNKNOWN],
  answers: {
    ...session(async (page) => expect(page.getByText('Загружаем торрент')).toBeAttached()),
    ...torrentsAndMatches(title),
    ...rest,
  },
})

/**
 * The title page's answers (TitleScreen): the title's details, its poster once they're in, what to
 * watch next (TitleRelated, under the page's fold), and the torrents with their titles, of which the
 * title's own show in its "In downloads" badge and block once the details are in too.
 */
const titlePage = (name: string, title: string, type: string, id: number, related: Record<string, Answer>): Case => ({
  screen: type === 'movie' ? 'title' : 'series',
  name,
  answers: {
    ...session(async (page) => expect(page.getByText('Загружаем')).toBeAttached()),
    details: {
      matches: get(`/tmdb/${type}/${id}`),
      after: ['tmdbSetup'],
      shown: async (page, landed) => {
        await heading(title)(page)
        if (landed.has('torrents')) await heading('В загрузках', 2)(page)
      },
    },
    ...torrentsAndMatches(once(['details'], heading('В загрузках', 2))),
    // The same address as the details for this title's own torrent: claimed by the details first.
    ...lookups(),
    poster: { matches: get(`/tmdb-img/w342/${type}-${id}.svg`), after: ['details'], shown: images({ only: `${type}-${id}.svg` }) },
    ...related,
    relatedPosters: {
      matches: (url, method) => under('/tmdb-img/')(url, method) && url.pathname !== `/tmdb-img/w342/${type}-${id}.svg`,
      after: [Object.keys(related).at(-1)!],
      shown: images({ except: `${type}-${id}.svg` }),
    },
  },
})

/** The releases screen's answers (ReleasesScreen): the series' details, then Prowlarr's search, then which indexers failed during it. */
const releasesPage = (name: string): Case => ({
  screen: 'releases',
  name,
  answers: {
    ...session(heading('Раздачи')),
    details: { matches: get('/tmdb/tv/126308'), after: ['tmdbSetup'], shown: text('Сёгун · 2024') },
    search: { matches: get('/prowlarr/search'), after: ['details'], shown: async (page) => expect(page.getByRole('button', { name: 'Добавить в загрузки' }).first()).toBeVisible() },
    failing: { matches: get('/prowlarr/failing'), after: ['search'] },
  },
})

/** Search's three rows, which show once all three of their queries have answered. */
const rows = once(['newMovies', 'newEpisodes', 'bestOfYear'], heading('Лучшее за год', 2))

/**
 * Every state of every screen the list names whose blocks differ, each with the chain of answers its
 * code asks for (docs/TESTING.md → The layout shift test lists the late blocks each covers).
 */
const CASES: Case[] = [
  {
    screen: 'downloads',
    name: 'titles found',
    answers: {
      ...session(heading('Загрузки')),
      ...torrentsAndMatches(link(/GRPC/)),
      ...lookups({ p1: link('Дюна: Часть вторая'), p2: link('Сёгун'), p3: link('Интерстеллар') }),
      posters: { matches: under('/tmdb-img/'), afterAny: ['titleP1', 'titleP2', 'guessP3'], shown: images() },
    },
  },
  /**
   * `p2`: tagged with its title and finished. The page asks for the title by its id once the
   * torrent shows, and for the poster once the title does.
   */
  torrentPage('tagged and finished', 'p2', heading(TORRENTS[1].name), {
    title: { matches: get('/tmdb/tv/126308'), after: ['torrents'], shown: heading('Сёгун') },
    poster: { matches: under('/tmdb-img/'), after: ['title'], shown: images() },
  }),
  /**
   * `p3`: no tag, its title guessed from its name with a cold cache (#389: "Is it right?" came in
   * above the progress card with the guess and moved it, Pause and Delete, by 0.1051). The poster
   * is asked for once the guess shows, and a second after it the guess is saved on the server.
   */
  torrentPage('title guessed from its name', 'p3', heading(TORRENTS[2].name), {
    search: { matches: under('/tmdb/search/'), after: ['torrents', 'matches'], shown: heading('Интерстеллар') },
    poster: { matches: under('/tmdb-img/'), after: ['search'], shown: images() },
    saveGuess: { matches: (url, method) => method === 'PATCH' && url.pathname === '/api/matches', after: ['search'] },
  }),
  /**
   * `p4`: no tag, and TMDB's search finds nothing for its name. Once it has answered More gets its
   * dot, out of the flow; nothing else is asked for, and nothing is saved.
   */
  torrentPage('no title found', 'p4', heading(UNKNOWN.name), {
    search: {
      matches: under('/tmdb/search/'),
      after: ['torrents', 'matches'],
      shown: async (page) =>
        expect(page.getByRole('button', { name: /^Ещё действия/ })).toHaveAccessibleDescription('Торрент не сопоставлен с фильмом или сериалом'),
    },
  }),
  /**
   * Search with no query: its three rows of titles, each a Discover query, show together once all
   * three have answered (`loadBrowseRows`), in place of the skeleton; then their posters.
   */
  {
    screen: 'browse',
    name: 'rows of titles',
    answers: {
      ...session(heading('Поиск')),
      newMovies: {
        matches: (url, method) => get('/tmdb/discover/movie')(url, method) && !url.searchParams.has('vote_count.gte'),
        after: ['tmdbSetup'],
        shown: rows,
      },
      newEpisodes: { matches: get('/tmdb/discover/tv'), after: ['tmdbSetup'], shown: rows },
      bestOfYear: { matches: (url, method) => get('/tmdb/discover/movie')(url, method) && url.searchParams.has('vote_count.gte'), after: ['tmdbSetup'], shown: rows },
      posters: { matches: under('/tmdb-img/'), after: ['newMovies', 'newEpisodes', 'bestOfYear'], shown: images() },
    },
  },
  /** A search: its results in place of the skeleton, with their count and Show more, then their posters. */
  {
    screen: 'search',
    name: 'titles found',
    answers: {
      ...session(heading('Поиск')),
      results: { matches: get('/tmdb/search/multi'), after: ['tmdbSetup'], shown: link('Дюна: Часть вторая') },
      posters: { matches: under('/tmdb-img/'), after: ['results'], shown: images() },
    },
  },
  /** A search with a year: movies and series searched apart, shown together once both have answered. */
  {
    screen: 'search-year',
    name: 'titles found',
    answers: {
      ...session(heading('Поиск')),
      movies: { matches: get('/tmdb/search/movie'), after: ['tmdbSetup'], shown: once(['movies', 'series'], link('Разделение')) },
      series: { matches: get('/tmdb/search/tv'), after: ['tmdbSetup'], shown: once(['movies', 'series'], link('Разделение')) },
      posters: { matches: under('/tmdb-img/'), after: ['movies', 'series'], shown: images() },
    },
  },
  /** A movie in downloads, with TMDB's recommendations. */
  titlePage('in downloads, with recommendations', 'Дюна: Часть вторая', 'movie', 693134, {
    recommendations: { matches: get('/tmdb/movie/693134/recommendations'), after: ['details'], shown: heading('Рекомендации', 2) },
  }),
  /** A series in downloads, which TMDB has no recommendations for: similar titles instead, asked once the recommendations come back empty. */
  titlePage('in downloads, with similar titles', 'Сёгун', 'tv', 126308, {
    recommendations: { matches: get('/tmdb/tv/126308/recommendations'), after: ['details'] },
    similar: { matches: get('/tmdb/tv/126308/similar'), after: ['recommendations'], shown: heading('Похожее', 2) },
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
    answers: {
      ...session(heading('Настройки')),
      // The same address as the session's two: Settings' own load of the server's settings.
      serverSettings: { matches: get('/api/settings'), after: ['tmdbSetup'] },
      // The same address as the session's check: Connections' check of qBittorrent.
      qbittorrentCheck: { matches: get('/qbt/api/v2/app/version'), after: ['tmdbSetup'], shown: connection('qBittorrent', 'Подключено') },
      prowlarrCheck: { matches: get('/prowlarr/status'), after: ['tmdbSetup'], shown: connection('Prowlarr', 'Подключено') },
      tmdbCheck: { matches: get('/tmdb/configuration'), after: ['tmdbSetup'], shown: connection('TMDB', /^Подключено/) },
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

for (const { screen, name, path, torrents, answers } of CASES) {
  for (const order of orders(chainOf(answers))) {
    test(`${screen}, ${name}: ${ORDER_NAMES[order]}`, async ({ page }, testInfo) => {
      expect(BUDGETS, `budgets.layoutShift in checks.json can't be read:\n${[BUDGETS].flat().join('\n')}`).not.toBeInstanceOf(Array)
      await recordLayoutShifts(page)
      await prepareApp(page, { torrents: torrents ?? TORRENTS })
      const { land } = await holdAnswers(page, answers, order, builtPaths())
      await page.goto(path ?? SCREENS.find((listed) => listed.screen === screen)!.path)
      const { landed, unnamed } = await land()
      expect(unnamed, 'The page asked for what no answer of the case is: name it in the chain, from the screen\'s code').toEqual([])
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
