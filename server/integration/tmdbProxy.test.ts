import { afterEach, describe, expect, it } from 'vitest'
import { getServerSettings } from '../../src/api/settings/client.ts'
import { TmdbError, TmdbKeyError, checkTmdb, getTv, searchTitles } from '../../src/api/tmdb/client.ts'
import { details } from '../../src/test/fixtures.ts'
import { startKinoseed, stopKinoseed } from '../test/integration.ts'

afterEach(stopKinoseed)

describe('TMDB through Kinoseed’s proxy', () => {
  it('reads a title and searches without a key of the server’s own, Kinoseed’s key added by the proxy', async () => {
    const { tmdb, proxy, responses } = await startKinoseed({ env: { TMDB_API_KEY: undefined }, tmdbProxy: true })

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

  it('says Kinoseed’s key is used, so onboarding doesn’t ask for one', async () => {
    await startKinoseed({ env: { TMDB_API_KEY: undefined }, tmdbProxy: true })

    await expect(getServerSettings()).resolves.toMatchObject({ tmdb: { configured: true, source: 'shared' } })
  })

  it('reports the proxy refusing a call as TMDB failing, not as a missing key', async () => {
    const { tmdb } = await startKinoseed({ env: { TMDB_API_KEY: undefined }, tmdbProxy: { key: '' } })

    // The worker answers 503 without its secret; a wrong-key screen would send users to a key they don't need.
    const failed = await checkTmdb().catch((error: unknown) => error)
    expect(failed).toBeInstanceOf(TmdbError)
    expect(failed).not.toBeInstanceOf(TmdbKeyError)
    expect(failed).toMatchObject({ status: 503 })
    expect(tmdb.seen).toEqual([])
  })
})
