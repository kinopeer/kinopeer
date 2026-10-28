import { expect, type Page, type Route } from '@playwright/test'
import {
  NOW,
  RELEASES,
  TITLES,
  TORRENTS,
  details,
  mainData,
  page as titlePage,
  posterSvg,
  shogunTorrent,
  torrentFiles,
} from './fixtures.ts'
import type { Torrent } from '../src/api/qbittorrent/types.ts'

export interface AppOptions {
  theme?: 'dark' | 'light'
  /** Interface language; Intl formatting follows the context's `locale`. */
  lang?: 'ru' | 'en'
  /** The Downloads view; on a phone the list by default, on desktop the grid. */
  downloadsView?: 'list' | 'grid'
  torrents?: Torrent[]
  /** qBittorrent answers the first poll, then stops answering. */
  goesOffline?: boolean
  /** The server rejects the login sent from the connect screen as a wrong login or password. */
  wrongLogin?: boolean
  /** Prowlarr doesn't answer the server's connection check. */
  prowlarrDown?: boolean
  /** Indexers Prowlarr says failed during the release search. */
  failingIndexers?: string[]
  /** Leaves /tmdb and /tmdb-img to the server, for real titles and posters (the README screenshots). */
  realTmdb?: boolean
}

/** The desktop layout at the canvas's width: `test.use(DESKTOP)` in a describe block. */
export const DESKTOP = { viewport: { width: 1440, height: 900 } }
/** The narrowest desktop width, where the sidebar is an icon rail without labels. */
export const DESKTOP_RAIL = { viewport: { width: 1024, height: 768 } }

const json = (route: Route, body: unknown, status = 200) =>
  route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(body) })

/**
 * Answers the server routes the app calls (/qbt, /tmdb, /tmdb-img, /prowlarr, /api/settings,
 * /api/matches) from fixtures. Matched by pathname, so Vite's own module paths such as
 * /src/api/tmdb/ are left alone.
 */
async function mockServer(page: Page, options: AppOptions): Promise<void> {
  const torrents = options.torrents ?? TORRENTS
  let polls = 0

  await page.route(
    (url) => url.pathname.startsWith('/qbt/'),
    (route) => {
      const { pathname } = new URL(route.request().url())
      if (pathname === '/qbt/api/v2/app/version') return route.fulfill({ body: 'v5.3.0' })
      if (pathname === '/qbt/api/v2/sync/maindata') {
        polls += 1
        if (options.goesOffline && polls > 1) return route.abort('connectionrefused')
        return json(route, mainData(torrents))
      }
      if (pathname === '/qbt/api/v2/app/webapiVersion') return route.fulfill({ body: '2.11.4' })
      if (pathname === '/qbt/api/v2/app/defaultSavePath') return route.fulfill({ body: '/downloads' })
      if (pathname === '/qbt/api/v2/torrents/categories') {
        return json(route, {
          Movies: { name: 'Movies', savePath: '/downloads/movies' },
          'TV Shows': { name: 'TV Shows', savePath: '/downloads/tv' },
        })
      }
      if (pathname === '/qbt/api/v2/torrents/files') return json(route, torrentFiles())
      if (pathname === '/qbt/api/v2/torrents/trackers') {
        return json(route, [{ url: 'http://bt.example.org/announce', status: 2, msg: '' }])
      }
      return route.fulfill({ body: 'Ok.' })
    },
  )

  if (!options.realTmdb) await mockTmdb(page)

  await page.route(
    (url) => url.pathname === '/api/settings',
    (route) =>
      json(route, {
        tmdb: { configured: true, source: 'saved' },
        qbittorrent: { configured: true, source: 'saved' },
        downloads: null,
      }),
  )
  if (options.wrongLogin) {
    await page.route(
      (url) => url.pathname === '/api/settings/qbittorrent',
      (route) => json(route, { error: 'invalid-credentials' }, 422),
    )
  }

  // Starts with no matches, so the app guesses titles from the release names and saves them.
  let matches = {}
  await page.route(
    (url) => url.pathname === '/api/matches',
    (route) => {
      const request = route.request()
      if (request.method() === 'PATCH') matches = { ...matches, ...(request.postDataJSON() as object) }
      if (request.method() === 'DELETE') matches = {}
      return json(route, matches)
    },
  )

  await page.route(
    (url) => url.pathname.startsWith('/prowlarr/'),
    (route) => {
      const { pathname } = new URL(route.request().url())
      if (pathname === '/prowlarr/status') {
        if (options.prowlarrDown) return json(route, { error: 'unreachable' }, 502)
        return json(route, { version: '2.0.5.5160', indexers: 2 })
      }
      if (pathname === '/prowlarr/search') return json(route, RELEASES)
      if (pathname === '/prowlarr/failing') return json(route, { indexers: options.failingIndexers ?? [] })
      if (pathname === '/prowlarr/download') {
        return route.fulfill({ contentType: 'application/x-bittorrent', body: shogunTorrent() })
      }
      return json(route, { error: 'not-found' }, 404)
    },
  )
}

/** Answers /tmdb and /tmdb-img from the fixtures, with generated posters. */
async function mockTmdb(page: Page): Promise<void> {
  await page.route(
    (url) => url.pathname.startsWith('/tmdb/'),
    (route) => {
      const url = new URL(route.request().url())
      const language = url.searchParams.get('language') ?? 'en-US'
      const path = url.pathname.slice('/tmdb'.length)
      const query = url.searchParams.get('query')?.toLocaleLowerCase()
      if (path === '/configuration') return json(route, {})
      if (path === '/search/multi') {
        const found = TITLES.filter((title) => [title.en, title.ru].some((name) => name.toLocaleLowerCase().includes(query ?? '')))
        return json(route, titlePage(found, language))
      }
      if (path.startsWith('/trending/')) return json(route, titlePage(TITLES, language))
      if (path === '/movie/popular') return json(route, titlePage(TITLES.filter((title) => title.type === 'movie'), language))
      if (path === '/tv/popular') return json(route, titlePage(TITLES.filter((title) => title.type === 'tv'), language))
      const [, type, id] = path.split('/')
      const found = details(type, Number(id), language)
      return found ? json(route, found) : json(route, { status_message: 'Not found' }, 404)
    },
  )

  await page.route(
    (url) => url.pathname.startsWith('/tmdb-img/'),
    (route) => route.fulfill({ contentType: 'image/svg+xml', body: posterSvg(new URL(route.request().url()).pathname) }),
  )
}

/** Opens the app at `path` with mocked servers, a frozen clock and the given preferences. */
export async function openApp(page: Page, path: string, options: AppOptions = {}): Promise<void> {
  await page.clock.setFixedTime(NOW)
  await page.addInitScript(
    ({ theme, lang, downloadsView }) => {
      localStorage.setItem('kinoseed.theme', theme)
      localStorage.setItem('kinoseed.lang', lang)
      localStorage.setItem(
        'kinoseed.settings',
        JSON.stringify({ downloadsView: downloadsView ?? 'list', downloadsDesktopView: downloadsView }),
      )
      localStorage.setItem('kinoseed.installDismissed', '1')
    },
    { theme: options.theme ?? 'dark', lang: options.lang ?? 'ru', downloadsView: options.downloadsView },
  )
  await mockServer(page, options)
  await page.goto(path)
}

/**
 * Waits until the fonts and every image have loaded, so the screenshot doesn't catch them midway.
 * Lazy posters below the fold are loaded too, for full-page screenshots.
 */
export async function settle(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const image of document.images) image.loading = 'eager'
    return document.fonts.ready
  })
  await expect
    .poll(() => page.evaluate(() => [...document.images].every((image) => image.complete && image.naturalWidth > 0)))
    .toBe(true)
}

/**
 * Makes the viewport as tall as the page, so a screenshot shows the whole list with the tab bar at
 * the bottom. A full-page screenshot would leave the fixed tab bar over the middle of the list.
 *
 * The page is only its final height once the fonts and images have loaded (the fallback font wraps
 * text differently), and a taller viewport can lay it out again, so it is measured after settling,
 * and again after each resize, until the height stops changing.
 */
export async function showWholePage(page: Page): Promise<void> {
  const width = page.viewportSize()!.width
  let height = 0
  for (let round = 0; round < 5; round++) {
    await settle(page)
    const measured = await page.evaluate(() => document.documentElement.scrollHeight)
    if (measured === height) return
    height = measured
    await page.setViewportSize({ width, height })
  }
  throw new Error(`The page's height kept changing after five measurements (last ${height}px)`)
}
