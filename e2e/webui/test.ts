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

/**
 * The page talks to qBittorrent for real and to TMDB through a fake in the browser: the build has
 * no TMDB proxy (`TMDB_PROXY_URL=` in scripts/test-smoke-webui.sh), so TMDB is called with the
 * user's own key, which the fake accepts as any; a search finds nothing. Any other request leaving
 * qBittorrent's origin is refused and fails the journey, so nothing reaches a real service.
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
      const bearer = (await route.request().headerValue('authorization'))?.replace(/^Bearer /, '') ?? null
      calls.push({ device, path: url.pathname, key: url.searchParams.get('api_key') ?? bearer })
      const body = url.pathname === '/3/authentication' ? { success: true } : { page: 1, results: [], total_pages: 0, total_results: 0 }
      return route.fulfill({ json: body, headers: { 'Access-Control-Allow-Origin': '*' } })
    },
  )
}

/**
 * The WebUI journeys' `test`: the smoke journeys' (no Content-Security-Policy violation, here the
 * build's own `<meta>` policy), Kinopeer's keys gone from qBittorrent's `clientdata` before each,
 * and the fake TMDB on every context, `newContext` included, for a second device.
 */
/** The fake TMDB's record for one journey, shared by its contexts. */
interface FakeTmdb {
  calls: TmdbCall[]
  /** What was refused for leaving qBittorrent and TMDB: none, or the journey fails. */
  strays: string[]
}

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
      // As the config's `use` sets the journeys' own context, which a context made here doesn't take.
      const context = await browser.newContext({ baseURL: QBITTORRENT_URL, locale: 'ru-RU', timezoneId: 'UTC', reducedMotion: 'reduce' })
      await fakeTmdb(context, 'second', fake)
      contexts.push(context)
      return context
    })
    await Promise.all(contexts.map((context) => context.close()))
  },
})

export { expect }
