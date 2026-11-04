import { afterEach, describe, expect, it } from 'vitest'
import { tmdbMiddleware, type TmdbConfig } from './tmdb.ts'
import { closeServers, fakeTmdb, serve } from './test/fakes.ts'

/** Kinoseed's side: the middleware under test. */
const kinoseed = (config: TmdbConfig) => serve(tmdbMiddleware(config))

afterEach(closeServers)

describe('tmdbMiddleware', () => {
  it('adds a v3 key as a query parameter and drops browser cookies', async () => {
    const tmdb = await fakeTmdb()
    const app = await kinoseed({ apiKey: ' abc123 ', apiBase: `${tmdb.base}/3` })

    const response = await fetch(`${app}/tmdb/search/multi?query=alien&language=ru-RU`, { headers: { Cookie: 'SID=secret' } })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ results: [] })
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(tmdb.seen).toEqual([{ url: '/3/search/multi?query=alien&language=ru-RU&api_key=abc123', authorization: undefined, cookie: undefined }])
  })

  it('sends a v4 read access token as a bearer token', async () => {
    const tmdb = await fakeTmdb()
    const app = await kinoseed({ apiKey: 'eyJhbGciOi.token', apiBase: `${tmdb.base}/3` })

    await fetch(`${app}/tmdb/movie/771`)

    expect(tmdb.seen).toEqual([{ url: '/3/movie/771', authorization: 'Bearer eyJhbGciOi.token', cookie: undefined }])
  })

  it('reads the key on every request, so a key saved from the app applies at once', async () => {
    const tmdb = await fakeTmdb()
    let key: string | undefined
    const app = await kinoseed({ apiKey: () => key, apiBase: `${tmdb.base}/3` })

    expect((await fetch(`${app}/tmdb/movie/693134`)).status).toBe(401)
    key = 'saved'
    expect((await fetch(`${app}/tmdb/movie/693134`)).status).toBe(200)
    expect(tmdb.seen.map((request) => request.url)).toEqual(['/3/movie/693134?api_key=saved'])
  })

  it('answers 401 without a key, so the app reports a missing key', async () => {
    const app = await kinoseed({})

    const response = await fetch(`${app}/tmdb/movie/771`)

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ status_message: 'The TMDB API key is not set' })
  })

  it('sends calls without a key to Kinoseed’s proxy, which adds its own', async () => {
    const tmdb = await fakeTmdb()
    const proxy = await fakeTmdb()
    const app = await kinoseed({ apiBase: tmdb.apiBase, proxyBase: proxy.apiBase })

    const response = await fetch(`${app}/tmdb/search/multi?query=alien&language=ru-RU`, { headers: { Cookie: 'SID=secret' } })

    expect(response.status).toBe(200)
    // No Authorization header: Workers Cache bypasses a request that carries one.
    expect(proxy.seen).toEqual([{ url: '/3/search/multi?query=alien&language=ru-RU', authorization: undefined, cookie: undefined }])
    expect(tmdb.seen).toEqual([])
  })

  it('sends calls to TMDB once a key is set, not to the proxy', async () => {
    const tmdb = await fakeTmdb()
    const proxy = await fakeTmdb()
    let key: string | undefined
    const app = await kinoseed({ apiKey: () => key, apiBase: tmdb.apiBase, proxyBase: proxy.apiBase })

    await fetch(`${app}/tmdb/movie/771`)
    key = 'saved'
    await fetch(`${app}/tmdb/movie/771`)

    expect(proxy.seen.map((request) => request.url)).toEqual(['/3/movie/771'])
    expect(tmdb.seen.map((request) => request.url)).toEqual(['/3/movie/771?api_key=saved'])
  })

  it('reports an unreachable proxy as TMDB being unreachable, not as a missing key', async () => {
    const app = await kinoseed({ proxyBase: 'http://127.0.0.1:1/3' })

    expect((await fetch(`${app}/tmdb/movie/771`)).status).toBe(502)
  })

  it('serves images without a key, with their cache headers', async () => {
    const tmdb = await fakeTmdb()
    const app = await kinoseed({ imageBase: `${tmdb.base}/t/p` })

    const response = await fetch(`${app}/tmdb-img/w342/poster.jpg`)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/jpeg')
    expect(response.headers.get('cache-control')).toBe('max-age=31536000')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([0xff, 0xd8, 0xff]))
    expect(tmdb.seen[0].url).toBe('/t/p/w342/poster.jpg')
  })

  it('reports an unreachable TMDB without the key', async () => {
    const app = await kinoseed({ apiKey: 'abc123', apiBase: 'http://127.0.0.1:1/3' })

    const response = await fetch(`${app}/tmdb/movie/771`)

    expect(response.status).toBe(502)
    expect(await response.text()).not.toContain('abc123')
  })

  it('leaves other paths and methods alone', async () => {
    const app = await kinoseed({ apiKey: 'abc123' })

    expect(await (await fetch(`${app}/tmdbx/movie`)).text()).toBe('fallback')
    expect((await fetch(`${app}/tmdb/movie/771`, { method: 'POST' })).status).toBe(405)
  })
})
