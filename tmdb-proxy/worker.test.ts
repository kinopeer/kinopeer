import { afterEach, describe, expect, it, vi } from 'vitest'
import worker, { handle, type EdgeCache, type Env } from './worker.ts'

const ORIGIN = 'https://kinoseed-tmdb.example.workers.dev'
const TMDB = 'https://tmdb.test/3'

/** TMDB answering every call with `status` and a small JSON body. */
function fakeTmdb(status = 200) {
  return vi.fn<typeof fetch>(async () =>
    new Response(JSON.stringify({ ok: status === 200 }), {
      status,
      headers: { 'Content-Type': 'application/json;charset=utf-8', 'Cache-Control': 'public, max-age=1', ETag: 'W/"1"' },
    }),
  )
}

/** The Workers Cache API by URL, as `caches.default` keys it. */
function fakeCache(): EdgeCache & { entries: Map<string, Response> } {
  const entries = new Map<string, Response>()
  return {
    entries,
    match: async (request) => entries.get(request.url)?.clone(),
    put: async (request, response) => void entries.set(request.url, response),
  }
}

/** A rate limiter that lets every call through. */
const allow = { limit: async () => ({ success: true }) }

function setup({ env = { TMDB_API_KEY: 'v3key', LIMITER: allow } as Env, status = 200 } = {}) {
  const tmdb = fakeTmdb(status)
  const cache = fakeCache()
  const pending: Promise<unknown>[] = []
  const call = async (path: string, init: RequestInit & { ip?: string } = {}) => {
    const headers = new Headers(init.headers)
    if (init.ip) headers.set('cf-connecting-ip', init.ip)
    const response = await handle(new Request(`${ORIGIN}${path}`, { ...init, headers }), env, {
      waitUntil: (promise) => void pending.push(promise),
    }, { cache, fetch: tmdb, apiBase: TMDB })
    await Promise.all(pending)
    return response
  }
  const calledUrl = (n = 0) => String(tmdb.mock.calls[n]?.[0])
  const calledHeaders = (n = 0) => new Headers(tmdb.mock.calls[n]?.[1]?.headers)
  return { call, tmdb, cache, calledUrl, calledHeaders }
}

describe('TMDB proxy worker', () => {
  it('sends an allowed call to TMDB with Kinoseed’s key and the caller’s parameters', async () => {
    const { call, calledUrl, calledHeaders } = setup()
    const response = await call('/3/search/movie?query=Dune&page=2&language=ru-RU')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    expect(calledUrl()).toBe(`${TMDB}/search/movie?language=ru-RU&page=2&query=Dune&api_key=v3key`)
    expect(calledHeaders().get('user-agent')).toBe('Kinoseed-TMDB-proxy')
    expect(calledHeaders().get('authorization')).toBeNull()
  })

  it('sends a v4 read access token as a bearer token, not in the URL', async () => {
    const { call, calledUrl, calledHeaders } = setup({ env: { TMDB_API_KEY: 'eyJtoken', LIMITER: allow } })
    await call('/3/movie/550')

    expect(calledUrl()).toBe(`${TMDB}/movie/550`)
    expect(calledHeaders().get('authorization')).toBe('Bearer eyJtoken')
  })

  it('drops a key the caller sends, so the call goes with Kinoseed’s key alone', async () => {
    const { call, calledUrl, cache } = setup()
    await call('/3/search/tv?query=Dark&api_key=theirs')

    expect(calledUrl()).toBe(`${TMDB}/search/tv?query=Dark&api_key=v3key`)
    expect([...cache.entries.keys()]).toEqual([`${ORIGIN}/3/search/tv?query=Dark`])
  })

  // append_to_response would add a title's credits, videos or images to an allowed path, which the
  // 404s below refuse on their own paths; the session ids are for TMDB's account calls.
  it.each(['append_to_response=credits,videos', 'session_id=abc', 'guest_session_id=abc'])(
    'drops %s, which would widen what an allowed path answers',
    async (parameter) => {
      const { call, calledUrl, cache } = setup()
      await call(`/3/movie/550?language=ru-RU&${parameter}`)

      expect(calledUrl()).toBe(`${TMDB}/movie/550?language=ru-RU&api_key=v3key`)
      expect([...cache.entries.keys()]).toEqual([`${ORIGIN}/3/movie/550?language=ru-RU`])
    },
  )

  // The paths src/api/tmdb/client.ts calls: each of its functions' requests, with a real id. A
  // contract with every released version: a path is added here, never removed while a supported
  // version calls it; a breaking change goes into a new worker (docs/DEVELOPMENT.md → The TMDB proxy).
  it.each([
    '/configuration',
    '/search/multi',
    '/search/movie',
    '/search/tv',
    '/discover/movie',
    '/discover/tv',
    '/movie/550',
    '/tv/1399',
    '/movie/550/recommendations',
    '/tv/1399/similar',
  ])('lets %s through', async (path) => {
    const { call, tmdb } = setup()

    expect((await call(`/3${path}`)).status).toBe(200)
    expect(tmdb).toHaveBeenCalledOnce()
  })

  it.each([
    ['a path Kinoseed doesn’t call', '/3/movie/550/credits'],
    ['an account path', '/3/account'],
    ['an id that isn’t a number', '/3/movie/abc'],
    ['a path without the version', '/search/movie'],
    ['the root', '/'],
    // Each route's pattern holds the whole path, not a part of it.
    ...['/configuration', '/search/movie', '/discover/tv', '/movie/550', '/tv/1399/similar'].flatMap((path) => [
      [`${path} under another path`, `/3/account${path}`],
      [`${path} with more after it`, `/3${path}/videos`],
    ]),
  ])('answers 404 for %s without calling TMDB', async (_, path) => {
    const { call, tmdb } = setup()
    const response = await call(path)

    expect(response.status).toBe(404)
    expect(tmdb).not.toHaveBeenCalled()
  })

  it('answers 405 for anything but GET and HEAD', async () => {
    const { call, tmdb } = setup()
    const response = await call('/3/search/movie', { method: 'POST', body: '{}' })

    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('GET, HEAD')
    expect(tmdb).not.toHaveBeenCalled()
  })

  it('answers 500 without its rate limiter rather than call TMDB with no limit', async () => {
    const { call, tmdb } = setup({ env: { TMDB_API_KEY: 'v3key' } })
    const response = await call('/3/configuration')

    expect(response.status).toBe(500)
    expect(tmdb).not.toHaveBeenCalled()
  })

  it('answers 503 while the worker has no key, so it isn’t read as a wrong key', async () => {
    const { call, tmdb } = setup({ env: { TMDB_API_KEY: ' ', LIMITER: allow } })
    const response = await call('/3/configuration')

    expect(response.status).toBe(503)
    expect(tmdb).not.toHaveBeenCalled()
  })

  it('answers the same call again from the edge cache, whatever the order of its parameters', async () => {
    const { call, tmdb } = setup()
    await call('/3/discover/movie?page=1&language=en-US')
    const again = await call('/3/discover/movie?language=en-US&page=1')

    expect(again.status).toBe(200)
    expect(await again.json()).toEqual({ ok: true })
    expect(tmdb).toHaveBeenCalledOnce()
  })

  it('keeps a call with other parameters apart in the cache', async () => {
    const { call, tmdb } = setup()
    await call('/3/search/movie?query=Dune')
    await call('/3/search/movie?query=Dune&language=ru-RU')

    expect(tmdb).toHaveBeenCalledTimes(2)
  })

  it('keeps an answer at the edge for its route’s time, not in the browser', async () => {
    const { call } = setup()

    expect((await call('/3/search/movie?query=Dune')).headers.get('cache-control')).toBe('public, s-maxage=3600')
    expect((await call('/3/discover/tv')).headers.get('cache-control')).toBe('public, s-maxage=21600')
    expect((await call('/3/tv/1399')).headers.get('cache-control')).toBe('public, s-maxage=86400')
    expect((await call('/3/configuration')).headers.get('cache-control')).toBe('public, s-maxage=86400')
    expect((await call('/3/movie/550/recommendations')).headers.get('cache-control')).toBe('public, s-maxage=86400')
  })

  it('passes TMDB’s content type and validators on', async () => {
    const { call } = setup()
    const response = await call('/3/movie/550')

    expect(response.headers.get('content-type')).toBe('application/json;charset=utf-8')
    expect(response.headers.get('etag')).toBe('W/"1"')
  })

  it('leaves out a header TMDB didn’t send', async () => {
    const { call, tmdb } = setup()
    tmdb.mockResolvedValueOnce(new Response('{}', { headers: { 'Content-Type': 'application/json' } }))
    const response = await call('/3/movie/550')

    expect(response.headers.has('etag')).toBe(false)
    expect(response.headers.has('last-modified')).toBe(false)
  })

  it('passes TMDB’s error on and doesn’t cache it', async () => {
    const { call, tmdb, cache } = setup({ status: 404 })
    const response = await call('/3/movie/1')

    expect(response.status).toBe(404)
    expect(response.headers.get('cache-control')).toBeNull()
    expect(cache.entries.size).toBe(0)
    await call('/3/movie/1')
    expect(tmdb).toHaveBeenCalledTimes(2)
  })

  it('answers 502 when TMDB can’t be reached', async () => {
    const { call, tmdb } = setup()
    tmdb.mockRejectedValueOnce(new TypeError('fetch failed'))

    expect((await call('/3/configuration')).status).toBe(502)
  })

  it('answers HEAD with the headers and no body, and caches the answer for a GET', async () => {
    const { call, tmdb } = setup()
    const head = await call('/3/configuration', { method: 'HEAD' })

    expect(head.status).toBe(200)
    expect(await head.text()).toBe('')
    expect(tmdb.mock.calls[0]?.[1]?.method).toBeUndefined()
    expect(await (await call('/3/configuration')).json()).toEqual({ ok: true })
    expect(tmdb).toHaveBeenCalledOnce()
  })

  it('answers 429 once an IP is over its limit, without calling TMDB', async () => {
    const limit = vi.fn(async () => ({ success: false }))
    const { call, tmdb } = setup({ env: { TMDB_API_KEY: 'v3key', LIMITER: { limit } } })
    const response = await call('/3/search/movie?query=Dune', { ip: '203.0.113.7' })

    expect(response.status).toBe(429)
    expect(response.headers.get('retry-after')).toBe('10')
    expect(limit).toHaveBeenCalledWith({ key: '203.0.113.7' })
    expect(tmdb).not.toHaveBeenCalled()
  })

  it('counts only the calls that reach TMDB against the limit', async () => {
    const limit = vi.fn(async () => ({ success: true }))
    const { call } = setup({ env: { TMDB_API_KEY: 'v3key', LIMITER: { limit } } })
    await call('/3/movie/550', { ip: '203.0.113.7' })
    await call('/3/movie/550', { ip: '203.0.113.7' })

    expect(limit).toHaveBeenCalledOnce()
  })

  describe('as deployed', () => {
    afterEach(() => vi.unstubAllGlobals())

    it('calls TMDB and caches in the Workers runtime’s own cache', async () => {
      const tmdb = fakeTmdb()
      const cache = fakeCache()
      vi.stubGlobal('fetch', tmdb)
      vi.stubGlobal('caches', { default: cache })
      const pending: Promise<unknown>[] = []
      const response = await worker.fetch(new Request(`${ORIGIN}/3/configuration`), { TMDB_API_KEY: 'v3key', LIMITER: allow }, {
        waitUntil: (promise) => void pending.push(promise),
      })
      await Promise.all(pending)

      expect(response.status).toBe(200)
      expect(String(tmdb.mock.calls[0]?.[0])).toBe('https://api.themoviedb.org/3/configuration?api_key=v3key')
      expect([...cache.entries.keys()]).toEqual([`${ORIGIN}/3/configuration`])
    })
  })
})
