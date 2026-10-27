import { afterEach, describe, expect, it } from 'vitest'
import { TmdbError, TmdbKeyError, checkTmdb, getMovie, getTv } from '../../src/api/tmdb/client.ts'
import { details } from '../../src/test/fixtures.ts'
import { startKinoseed, stopKinoseed } from '../test/integration.ts'

afterEach(stopKinoseed)

describe('TMDB client through /tmdb', () => {
  it('reports a key TMDB rejects', async () => {
    const { tmdb } = await startKinoseed({ env: { TMDB_API_KEY: 'bad-key' } })
    await expect(getMovie(693134)).rejects.toBeInstanceOf(TmdbKeyError)
    expect(tmdb.seen).toEqual([{ url: '/3/movie/693134?api_key=bad-key', authorization: undefined, cookie: undefined }])
  })

  it('reads a title with the key the server adds, and keeps TMDB’s own 404 as a plain error', async () => {
    const { tmdb, responses } = await startKinoseed()
    await expect(getTv(126308, { language: 'ru-RU' })).resolves.toEqual(details('tv', 126308, 'ru-RU'))
    expect(tmdb.seen).toEqual([{ url: '/3/tv/126308?language=ru-RU&api_key=good-key', authorization: undefined, cookie: undefined }])
    expect(await responses[0].text()).not.toContain('good-key')

    const missing = await getMovie(1).catch((error: unknown) => error)
    expect(missing).toBeInstanceOf(TmdbError)
    expect(missing).not.toBeInstanceOf(TmdbKeyError)
    expect(missing).toMatchObject({ status: 404 })
  })

  it('checks the connection through the configuration and reports a bad key', async () => {
    const { tmdb } = await startKinoseed()
    await expect(checkTmdb()).resolves.toBeUndefined()
    expect(tmdb.seen.map((request) => request.url)).toEqual(['/3/configuration?api_key=good-key'])

    await startKinoseed({ env: { TMDB_API_KEY: 'bad-key' } })
    await expect(checkTmdb()).rejects.toBeInstanceOf(TmdbKeyError)
  })
})
