import { afterEach, describe, expect, it } from 'vitest'
import { forgetTmdbKey, getServerSettings, saveTmdbKey } from '../../src/api/settings/client.ts'
import { TmdbError, TmdbKeyError, checkTmdb, getTv, searchTitles } from '../../src/api/tmdb/client.ts'
import { details } from '../../src/test/fixtures.ts'
import { startKinopeer, stopKinopeer } from '../test/integration.ts'

afterEach(stopKinopeer)

describe('TMDB through Kinopeer’s proxy', () => {
  it('reads a title and searches without a key of the server’s own, Kinopeer’s key added by the proxy', async () => {
    const { tmdb, proxy, responses } = await startKinopeer({ env: { TMDB_API_KEY: undefined }, tmdbProxy: true })

    await expect(getTv(126308, { language: 'ru-RU' })).resolves.toEqual(details('tv', 126308, 'ru-RU'))
    await expect(searchTitles('Dune')).resolves.toMatchObject({ page: 1 })
    await expect(checkTmdb()).resolves.toBeUndefined()

    // Both ends agree on every path: the server sends the client's, the worker lets it through.
    expect(proxy?.seen).toEqual([
      { url: '/3/tv/126308?language=ru-RU', authorization: undefined },
      { url: expect.stringMatching(/^\/3\/search\/multi\?/), authorization: undefined },
      { url: '/3/configuration', authorization: undefined },
    ])
    expect(tmdb.seen.map((request) => request.url)).toEqual([
      '/3/tv/126308?language=ru-RU&api_key=good-key',
      expect.stringMatching(/^\/3\/search\/multi\?.*&api_key=good-key$/),
      '/3/configuration?api_key=good-key',
    ])
    for (const response of responses) expect(await response.text()).not.toContain('good-key')
  })

  it('says Kinopeer’s key is used, so onboarding doesn’t ask for one', async () => {
    await startKinopeer({ env: { TMDB_API_KEY: undefined }, tmdbProxy: true })

    await expect(getServerSettings()).resolves.toMatchObject({ tmdb: { configured: true, source: 'shared', fallback: 'shared' } })
  })

  it('goes back from a saved key to Kinopeer’s once it’s forgotten', async () => {
    const { tmdb, proxy, stores } = await startKinopeer({ env: { TMDB_API_KEY: undefined }, tmdbProxy: true })
    // The user's own key differs from Kinopeer's (good-key), so each call shows whose key it took.
    await expect(saveTmdbKey('eyJgood')).resolves.toMatchObject({ tmdb: { source: 'saved', fallback: 'shared' } })
    tmdb.seen.length = 0
    await expect(checkTmdb()).resolves.toBeUndefined()
    expect(proxy?.seen).toEqual([])
    expect(tmdb.seen).toEqual([{ url: '/3/configuration', authorization: 'Bearer eyJgood', cookie: undefined }])

    await expect(forgetTmdbKey()).resolves.toMatchObject({ tmdb: { configured: true, source: 'shared', fallback: 'shared' } })
    expect(stores.settings.current.tmdbApiKey).toBeUndefined()
    tmdb.seen.length = 0
    await expect(checkTmdb()).resolves.toBeUndefined()

    // The check goes without a key of the server's own, through the proxy, which adds Kinopeer's.
    expect(proxy?.seen).toEqual([{ url: '/3/configuration', authorization: undefined }])
    expect(tmdb.seen.map((request) => request.url)).toEqual(['/3/configuration?api_key=good-key'])
  })

  it('says how long the proxy asks to wait once over its limit', async () => {
    const { tmdb } = await startKinopeer({ env: { TMDB_API_KEY: undefined }, tmdbProxy: { overLimit: true } })

    // The worker's Retry-After reaches the client, which waits that long before asking TMDB again.
    await expect(getTv(126308)).rejects.toMatchObject({ status: 429, retryAfterMs: 10_000 })
    expect(tmdb.seen).toEqual([])
  })

  it('reports the proxy refusing a call as TMDB failing, not as a missing key', async () => {
    const { tmdb } = await startKinopeer({ env: { TMDB_API_KEY: undefined }, tmdbProxy: { key: '' } })

    // The worker answers 503 without its secret; a wrong-key screen would send users to a key they don't need.
    const failed = await checkTmdb().catch((error: unknown) => error)
    expect(failed).toBeInstanceOf(TmdbError)
    expect(failed).not.toBeInstanceOf(TmdbKeyError)
    expect(failed).toMatchObject({ status: 503 })
    expect(tmdb.seen).toEqual([])
  })
})
