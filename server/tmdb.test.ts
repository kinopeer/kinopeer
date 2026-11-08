import { afterEach, describe, expect, it } from 'vitest'
import { tmdbMiddleware, type TmdbConfig } from './tmdb.ts'
import { abandon, closeServers, fakeTmdb, listen, serve, settlesWithin, silentService } from './test/fakes.ts'

/** Kinopeer's side: the middleware under test. */
const kinopeer = (config: TmdbConfig) => serve(tmdbMiddleware(config))

afterEach(closeServers)

describe('tmdbMiddleware', () => {
  it('adds a v3 key as a query parameter and drops browser cookies', async () => {
    const tmdb = await fakeTmdb()
    const app = await kinopeer({ apiKey: ' abc123 ', apiBase: `${tmdb.base}/3` })

    const response = await fetch(`${app}/tmdb/search/multi?query=alien&language=ru-RU`, { headers: { Cookie: 'SID=secret' } })

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ results: [] })
    expect(response.headers.get('set-cookie')).toBeNull()
    expect(tmdb.seen).toEqual([{ url: '/3/search/multi?query=alien&language=ru-RU&api_key=abc123', authorization: undefined, cookie: undefined }])
  })

  it('sends a v4 read access token as a bearer token', async () => {
    const tmdb = await fakeTmdb()
    const app = await kinopeer({ apiKey: 'eyJhbGciOi.token', apiBase: `${tmdb.base}/3` })

    await fetch(`${app}/tmdb/movie/771`)

    expect(tmdb.seen).toEqual([{ url: '/3/movie/771', authorization: 'Bearer eyJhbGciOi.token', cookie: undefined }])
  })

  it('reads the key on every request, so a key saved from the app applies at once', async () => {
    const tmdb = await fakeTmdb()
    let key: string | undefined
    const app = await kinopeer({ apiKey: () => key, apiBase: `${tmdb.base}/3` })

    expect((await fetch(`${app}/tmdb/movie/693134`)).status).toBe(401)
    key = 'saved'
    expect((await fetch(`${app}/tmdb/movie/693134`)).status).toBe(200)
    expect(tmdb.seen.map((request) => request.url)).toEqual(['/3/movie/693134?api_key=saved'])
  })

  it('answers 401 without a key, so the app reports a missing key', async () => {
    const app = await kinopeer({})

    const response = await fetch(`${app}/tmdb/movie/771`)

    expect(response.status).toBe(401)
    expect(await response.json()).toEqual({ status_message: 'The TMDB API key is not set' })
  })

  it('sends calls without a key to Kinopeer’s proxy, which adds its own', async () => {
    const tmdb = await fakeTmdb()
    const proxy = await fakeTmdb()
    const app = await kinopeer({ apiBase: tmdb.apiBase, proxyBase: proxy.apiBase })

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
    const app = await kinopeer({ apiKey: () => key, apiBase: tmdb.apiBase, proxyBase: proxy.apiBase })

    await fetch(`${app}/tmdb/movie/771`)
    key = 'saved'
    await fetch(`${app}/tmdb/movie/771`)

    expect(proxy.seen.map((request) => request.url)).toEqual(['/3/movie/771'])
    expect(tmdb.seen.map((request) => request.url)).toEqual(['/3/movie/771?api_key=saved'])
  })

  it('reports an unreachable proxy as TMDB being unreachable, not as a missing key', async () => {
    const app = await kinopeer({ proxyBase: 'http://127.0.0.1:1/3' })

    expect((await fetch(`${app}/tmdb/movie/771`)).status).toBe(502)
  })

  it('serves images without a key, with their cache headers', async () => {
    const tmdb = await fakeTmdb()
    const app = await kinopeer({ imageBase: `${tmdb.base}/t/p` })

    const response = await fetch(`${app}/tmdb-img/w342/poster.jpg`)

    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('image/jpeg')
    expect(response.headers.get('cache-control')).toBe('max-age=31536000')
    expect(new Uint8Array(await response.arrayBuffer())).toEqual(new Uint8Array([0xff, 0xd8, 0xff]))
    expect(tmdb.seen[0].url).toBe('/t/p/w342/poster.jpg')
  })

  // Passed on as sent, a page in another type would open as Kinopeer's own: HTML, or an SVG (TMDB's
  // logos, uploaded by its users), which can carry a script.
  describe('passes on only the content types the app reads', () => {
    async function answering(contentType: string | undefined) {
      const tmdb = await listen((_request, response) => {
        if (contentType) response.setHeader('Content-Type', contentType)
        response.end('<html><script>alert(1)</script></html>')
      })
      return kinopeer({ apiKey: 'abc123', apiBase: `${tmdb}/3`, imageBase: `${tmdb}/t/p` })
    }
    const typeOf = async (url: string) => (await fetch(url)).headers.get('content-type')

    it.each(['application/json;charset=utf-8', 'APPLICATION/JSON'])('keeps %s from the API', async (type) => {
      expect(await typeOf(`${await answering(type)}/tmdb/movie/771`)).toBe(type)
    })

    it.each(['image/jpeg', 'image/png', 'image/webp', 'image/gif', 'image/avif'])('keeps %s from the images', async (type) => {
      expect(await typeOf(`${await answering(type)}/tmdb-img/w342/poster.jpg`)).toBe(type)
    })

    it.each([
      ['an HTML page from the API', 'text/html; charset=utf-8', '/tmdb/movie/771'],
      ['an image type from the API', 'image/jpeg', '/tmdb/movie/771'],
      ['JSON from the images', 'application/json', '/tmdb-img/w342/poster.jpg'],
      ['an HTML page from the images', 'text/html', '/tmdb-img/w342/poster.jpg'],
      ['an SVG from the images', 'image/svg+xml', '/tmdb-img/original/logo.svg'],
      ['no type at all', undefined, '/tmdb/movie/771'],
      // The type is what comes first, not a word anywhere in the header.
      ['HTML that names JSON after it', 'text/html; profile=application/json', '/tmdb/movie/771'],
      ['HTML that names an image after it', 'text/html; profile=image/jpeg', '/tmdb-img/w342/poster.jpg'],
      // A type is the whole word: JSONP is a script, and a made-up image type is none of the app's.
      ['JSONP from the API', 'application/jsonp', '/tmdb/movie/771'],
      ['a type that only starts like an image one', 'image/pngx', '/tmdb-img/w342/poster.jpg'],
    ])('sends %s as bytes to download', async (_, type, path) => {
      expect(await typeOf(`${await answering(type)}${path}`)).toBe('application/octet-stream')
    })
  })

  it('reports an unreachable TMDB without the key', async () => {
    const app = await kinopeer({ apiKey: 'abc123', apiBase: 'http://127.0.0.1:1/3' })

    const response = await fetch(`${app}/tmdb/movie/771`)

    expect(response.status).toBe(502)
    expect(await response.text()).not.toContain('abc123')
  })

  it('gives up its request to TMDB when the browser gives up on it', async () => {
    const tmdb = await silentService()
    const app = await kinopeer({ apiKey: 'abc123', apiBase: `${tmdb.base}/3` })

    await abandon(`${app}/tmdb/search/multi?query=alien`, tmdb.received)

    expect(await settlesWithin(tmdb.closed, 1000)).toBe(true)
  })

  it('answers 504 when TMDB doesn’t answer in time, and gives its request up', async () => {
    const tmdb = await silentService()
    const app = await kinopeer({ apiKey: 'abc123', apiBase: `${tmdb.base}/3`, timeoutMs: 50 })

    const response = await fetch(`${app}/tmdb/movie/771`)

    expect(response.status).toBe(504)
    expect(await response.json()).toEqual({ status_message: 'TMDB didn’t answer in time' })
    expect(await settlesWithin(tmdb.closed, 1000)).toBe(true)
  })

  it('leaves other paths and methods alone', async () => {
    const app = await kinopeer({ apiKey: 'abc123' })

    expect(await (await fetch(`${app}/tmdbx/movie`)).text()).toBe('fallback')
    expect((await fetch(`${app}/tmdb/movie/771`, { method: 'POST' })).status).toBe(405)
  })
})
