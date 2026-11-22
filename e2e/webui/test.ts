import type { BrowserContext } from '@playwright/test'
import { expect, test as base } from '../smoke/test.ts'
import { QBITTORRENT_URL, resetClientData } from './qbittorrent.ts'

/** A TMDB call the page sent, as the fake below took it. */
export interface TmdbCall {
  /** The journey's own context is the first device, `newContext`'s the second. */
  device: 'first' | 'second'
  path: string
  /** The v3 key in the query, or the v4 token as a bearer token. */
  key: string | null
}

/** The one title the fake TMDB knows: the series the stand's torrent is named after. */
export const SHOGUN = { id: 126308, name: 'Сёгун', originalName: 'Shogun', firstAirDate: '2024-02-27' }

/** The fake TMDB's record for one journey, shared by its contexts. */
interface FakeTmdb {
  calls: TmdbCall[]
  /** What was refused for leaving qBittorrent and TMDB: none, or the journey fails. */
  strays: string[]
}

/** What the fake answers a path with: the key check, the one series in a search and by its id, else nothing. */
function answer(path: string): unknown {
  const series = { id: SHOGUN.id, name: SHOGUN.name, original_name: SHOGUN.originalName, first_air_date: SHOGUN.firstAirDate, poster_path: null }
  if (path === '/3/authentication') return { success: true }
  if (path.startsWith('/3/search/')) {
    const results = path.endsWith('/movie') ? [] : [{ ...series, media_type: 'tv' }]
    return { page: 1, results, total_pages: results.length, total_results: results.length }
  }
  if (path === `/3/tv/${SHOGUN.id}`) return { ...series, overview: '', genres: [], seasons: [], number_of_seasons: 1 }
  return { page: 1, results: [], total_pages: 0, total_results: 0 }
}

/**
 * The page talks to qBittorrent for real and to TMDB through a fake in the browser: the build has
 * no TMDB proxy (`TMDB_PROXY_URL=` in scripts/test-smoke-webui.sh), so TMDB is called with the
 * user's own key, which the fake accepts as any. Any other request leaving qBittorrent's origin is
 * refused and fails the journey, so nothing reaches a real service.
 */
async function fakeTmdb(context: BrowserContext, device: TmdbCall['device'], { calls, strays }: FakeTmdb): Promise<void> {
  await context.route(
    (url) => url.origin !== QBITTORRENT_URL,
    async (route) => {
      const url = new URL(route.request().url())
      if (url.origin !== 'https://api.themoviedb.org') {
        strays.push(url.href)
        return route.abort()
      }
      // Recorded at once, before anything awaited, so a call is in the list as soon as the page sent it.
      const bearer = route.request().headers().authorization?.replace(/^Bearer /, '') ?? null
      calls.push({ device, path: url.pathname, key: url.searchParams.get('api_key') ?? bearer })
      return route.fulfill({ json: answer(url.pathname), headers: { 'Access-Control-Allow-Origin': '*' } })
    },
  )
}

/**
 * The WebUI journeys' `test`: the smoke journeys' (no Content-Security-Policy violation, here the
 * build's own `<meta>` policy, in the journey's own context), Kinopeer's keys gone from
 * qBittorrent's `clientdata` before each, and the fake TMDB on every context, `newContext`
 * included, for a second device.
 */
export const test = base.extend<{
  fakeTmdb: FakeTmdb
  /** What the fake TMDB took, from every context. */
  tmdbCalls: TmdbCall[]
  newContext: () => Promise<BrowserContext>
}>({
  // On every journey, whether it reads TMDB's calls or not.
  fakeTmdb: [
    async ({ context }, provide) => {
      await resetClientData()
      const fake: FakeTmdb = { calls: [], strays: [] }
      await fakeTmdb(context, 'first', fake)
      await provide(fake)
      expect(fake.strays, 'requests that left qBittorrent and TMDB').toEqual([])
    },
    { auto: true },
  ],
  tmdbCalls: async ({ fakeTmdb }, provide) => provide(fakeTmdb.calls),
  newContext: async ({ browser, fakeTmdb: fake }, provide) => {
    const contexts: BrowserContext[] = []
    await provide(async () => {
      // The second device is a desktop browser (Chromium's own 1280×720), in the journeys' language.
      const context = await browser.newContext({ baseURL: QBITTORRENT_URL, locale: 'ru-RU', timezoneId: 'UTC', reducedMotion: 'reduce' })
      await fakeTmdb(context, 'second', fake)
      contexts.push(context)
      return context
    })
    await Promise.all(contexts.map((context) => context.close()))
  },
})

export { expect }
