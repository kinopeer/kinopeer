import { describe, expect, it, vi } from 'vitest'
import worker, { handle, isPrivateOrigin, limitKey, type Env } from './worker.ts'

const ORIGIN = 'https://kinopeer-tmdb.example.workers.dev'
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

/** A rate limiter that lets every call through. */
const allow = { limit: async () => ({ success: true }) }

function setup({ env = { TMDB_API_KEY: 'v3key', LIMITER: allow } as Env, status = 200 } = {}) {
  const tmdb = fakeTmdb(status)
  const call = (path: string, init: RequestInit & { ip?: string } = {}) => {
    const headers = new Headers(init.headers)
    if (init.ip) headers.set('cf-connecting-ip', init.ip)
    return handle(new Request(`${ORIGIN}${path}`, { ...init, headers }), env, { fetch: tmdb, apiBase: TMDB })
  }
  const calledUrl = (n = 0) => String(tmdb.mock.calls[n]?.[0])
  const calledHeaders = (n = 0) => new Headers(tmdb.mock.calls[n]?.[1]?.headers)
  return { call, tmdb, calledUrl, calledHeaders }
}

describe('TMDB proxy worker', () => {
  it('sends an allowed call to TMDB with Kinopeer’s key and the caller’s parameters', async () => {
    const { call, calledUrl, calledHeaders } = setup()
    const response = await call('/3/search/movie?query=Dune&page=2&language=ru-RU')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ ok: true })
    expect(calledUrl()).toBe(`${TMDB}/search/movie?query=Dune&page=2&language=ru-RU&api_key=v3key`)
    expect(calledHeaders().get('user-agent')).toBe('Kinopeer-TMDB-proxy')
    expect(calledHeaders().get('authorization')).toBeNull()
  })

  it('sends a v4 read access token as a bearer token, not in the URL', async () => {
    const { call, calledUrl, calledHeaders } = setup({ env: { TMDB_API_KEY: 'eyJtoken', LIMITER: allow } })
    await call('/3/movie/550')

    expect(calledUrl()).toBe(`${TMDB}/movie/550`)
    expect(calledHeaders().get('authorization')).toBe('Bearer eyJtoken')
  })

  it('drops a key the caller sends, so the call goes with Kinopeer’s key alone', async () => {
    const { call, calledUrl } = setup()
    await call('/3/search/tv?query=Dark&api_key=theirs')

    expect(calledUrl()).toBe(`${TMDB}/search/tv?query=Dark&api_key=v3key`)
  })

  // append_to_response would add a title's credits, videos or images to an allowed path, which the
  // 404s below refuse on their own paths; the session ids are for TMDB's account calls.
  it.each(['append_to_response=credits,videos', 'session_id=abc', 'guest_session_id=abc'])(
    'drops %s, which would widen what an allowed path answers',
    async (parameter) => {
      const { call, calledUrl } = setup()
      await call(`/3/movie/550?language=ru-RU&${parameter}`)

      expect(calledUrl()).toBe(`${TMDB}/movie/550?language=ru-RU&api_key=v3key`)
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
    ['a path Kinopeer doesn’t call', '/3/movie/550/credits'],
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

  it('answers 405 for anything but GET, HEAD and OPTIONS', async () => {
    const { call, tmdb } = setup()
    const response = await call('/3/search/movie', { method: 'POST', body: '{}' })

    expect(response.status).toBe(405)
    expect(response.headers.get('allow')).toBe('GET, HEAD, OPTIONS')
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

  it('has Workers Cache keep an answer for its route’s time, and not the browser', async () => {
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

  it('passes TMDB’s error on and keeps it out of the cache', async () => {
    const { call } = setup({ status: 404 })
    const response = await call('/3/movie/1')

    expect(response.status).toBe(404)
    expect(response.headers.get('cache-control')).toBe('no-store')
  })

  // A 429 kept by Workers Cache would answer every install, not the IP over its limit.
  it.each([
    ['404', '/3/account', { TMDB_API_KEY: 'v3key', LIMITER: allow }],
    ['429', '/3/configuration', { TMDB_API_KEY: 'v3key', LIMITER: { limit: async () => ({ success: false }) } }],
    ['503', '/3/configuration', { TMDB_API_KEY: '', LIMITER: allow }],
  ] as const)('keeps its own %s out of the cache', async (_, path, env) => {
    const { call } = setup({ env })

    expect((await call(path)).headers.get('cache-control')).toBe('no-store')
  })

  it('answers 502 when TMDB can’t be reached', async () => {
    const { call, tmdb } = setup()
    tmdb.mockRejectedValueOnce(new TypeError('fetch failed'))

    expect((await call('/3/configuration')).status).toBe(502)
  })

  // GET and HEAD share a Workers Cache entry: a kept HEAD would answer the next GET with no body.
  it('answers HEAD with the headers and no body, and keeps it out of the cache', async () => {
    const { call, tmdb } = setup()
    const head = await call('/3/configuration', { method: 'HEAD' })

    expect(head.status).toBe(200)
    expect(head.headers.get('content-type')).toBe('application/json;charset=utf-8')
    expect(await head.text()).toBe('')
    expect(head.headers.get('cache-control')).toBe('no-store')
    expect(tmdb.mock.calls[0]?.[1]?.method).toBeUndefined()
  })

  it('releases TMDB’s answer to a HEAD rather than leave it unread', async () => {
    const { call, tmdb } = setup()
    const answer = new Response('{"ok":true}', { headers: { 'Content-Type': 'application/json' } })
    tmdb.mockResolvedValueOnce(answer)
    await call('/3/configuration', { method: 'HEAD' })

    // Cancelling marks the body as used; one left alone could still be read.
    expect(answer.bodyUsed).toBe(true)
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

  it('counts an IPv6 caller by its /64, the block a single client gets', async () => {
    const limit = vi.fn(async () => ({ success: true }))
    const { call } = setup({ env: { TMDB_API_KEY: 'v3key', LIMITER: { limit } } })
    await call('/3/search/movie?query=Dune', { ip: '2001:db8:1:2:aaaa:bbbb:cccc:dddd' })

    expect(limit).toHaveBeenCalledWith({ key: '2001:db8:1:2::/64' })
  })

  describe('CORS', () => {
    const LAN = 'http://192.168.1.20:8080'

    it('lets a page on a private origin read the answer', async () => {
      const { call } = setup()
      const response = await call('/3/movie/550', { headers: { Origin: LAN } })

      expect(response.status).toBe(200)
      expect(response.headers.get('access-control-allow-origin')).toBe(LAN)
      expect(response.headers.get('access-control-expose-headers')).toBe('Retry-After')
      expect(await response.json()).toEqual({ ok: true })
    })

    // A public site could otherwise spend the shared key's daily quota from its visitors' browsers.
    it('gives a page on a public origin no CORS headers, and still answers', async () => {
      const { call } = setup()
      const response = await call('/3/movie/550', { headers: { Origin: 'https://example.com' } })

      expect(response.status).toBe(200)
      expect(response.headers.has('access-control-allow-origin')).toBe(false)
      expect(response.headers.has('access-control-expose-headers')).toBe(false)
    })

    it('gives a call with no Origin, Kinopeer’s server, no CORS headers', async () => {
      const { call } = setup()
      const response = await call('/3/movie/550')

      expect(response.headers.has('access-control-allow-origin')).toBe(false)
    })

    // Workers Cache keeps a variant per value of each header Vary names, so a cached answer never
    // carries another origin's CORS headers, nor a server's answer lack them for a page.
    it.each([
      ['a private origin', LAN],
      ['a public origin', 'https://example.com'],
      ['no Origin', undefined],
    ])('says Vary: Origin to %s', async (_, origin) => {
      const { call } = setup()
      const response = await call('/3/search/movie?query=Dune', { headers: origin ? { Origin: origin } : {} })

      expect(response.headers.get('vary')).toBe('Origin')
      expect(response.headers.get('cache-control')).toBe('public, s-maxage=3600')
    })

    // A page reads why it was refused: a 429's Retry-After among them.
    it.each([
      ['its own 429', '/3/configuration', { TMDB_API_KEY: 'v3key', LIMITER: { limit: async () => ({ success: false }) } }],
      ['its own 404', '/3/account', { TMDB_API_KEY: 'v3key', LIMITER: allow }],
      ['its own 503', '/3/configuration', { TMDB_API_KEY: '', LIMITER: allow }],
    ] as const)('puts the CORS headers on %s', async (_, path, env) => {
      const { call } = setup({ env })
      const response = await call(path, { headers: { Origin: LAN } })

      expect(response.headers.get('access-control-allow-origin')).toBe(LAN)
      expect(response.headers.get('vary')).toBe('Origin')
    })

    it('answers a preflight from a private origin for a path it serves, without the key, the limit or TMDB', async () => {
      const limit = vi.fn(async () => ({ success: true }))
      const { call, tmdb } = setup({ env: { LIMITER: { limit } } })
      const response = await call('/3/search/movie?query=Dune', {
        method: 'OPTIONS',
        headers: { Origin: LAN, 'Access-Control-Request-Method': 'GET' },
      })

      expect(response.status).toBe(204)
      expect(response.headers.get('access-control-allow-origin')).toBe(LAN)
      expect(response.headers.get('access-control-allow-methods')).toBe('GET, HEAD')
      expect(response.headers.get('access-control-max-age')).toBe('86400')
      expect(response.headers.get('allow')).toBe('GET, HEAD, OPTIONS')
      expect(response.headers.get('cache-control')).toBe('no-store')
      expect(response.headers.get('vary')).toBe('Origin')
      expect(limit).not.toHaveBeenCalled()
      expect(tmdb).not.toHaveBeenCalled()
    })

    it('answers a preflight from a public origin with no CORS headers, so the browser refuses the call', async () => {
      const { call } = setup()
      const response = await call('/3/movie/550', { method: 'OPTIONS', headers: { Origin: 'https://example.com' } })

      expect(response.status).toBe(204)
      expect(response.headers.has('access-control-allow-origin')).toBe(false)
      expect(response.headers.has('access-control-allow-methods')).toBe(false)
    })

    it('answers 404 to a preflight for a path it doesn’t serve', async () => {
      const { call } = setup()
      const response = await call('/3/movie/550/credits', { method: 'OPTIONS', headers: { Origin: LAN } })

      expect(response.status).toBe(404)
      expect(response.headers.has('access-control-allow-methods')).toBe(false)
    })

    it('gives a GET no preflight headers', async () => {
      const { call } = setup()
      const response = await call('/3/movie/550', { headers: { Origin: LAN } })

      expect(response.headers.has('access-control-allow-methods')).toBe(false)
      expect(response.headers.has('access-control-max-age')).toBe(false)
    })
  })

  describe('as deployed', () => {
    it('calls TMDB itself', async () => {
      const tmdb = fakeTmdb()
      vi.stubGlobal('fetch', tmdb)
      const response = await worker.fetch(new Request(`${ORIGIN}/3/configuration`), { TMDB_API_KEY: 'v3key', LIMITER: allow })

      expect(response.status).toBe(200)
      expect(String(tmdb.mock.calls[0]?.[0])).toBe('https://api.themoviedb.org/3/configuration?api_key=v3key')
    })
  })
})

describe('limitKey', () => {
  it('keeps an IPv4 address as it is', () => {
    expect(limitKey('203.0.113.7')).toBe('203.0.113.7')
  })

  // Any address in one /64 is one client's: privacy extensions alone hand out new ones all the time.
  it.each([
    ['another address in the block', '2001:db8:1:2::1'],
    ['the block written in full, with leading zeros', '2001:0db8:0001:0002:0000:0000:0000:0001'],
    ['upper case', '2001:DB8:1:2:AAAA:BBBB:CCCC:DDDD'],
    ['an IPv4 address in its last 32 bits', '2001:db8:1:2:0:0:198.51.100.1'],
  ])('gives the same key for %s', (_, ip) => {
    expect(limitKey(ip)).toBe(limitKey('2001:db8:1:2:aaaa:bbbb:cccc:dddd'))
  })

  it('gives another /64 its own key', () => {
    expect(limitKey('2001:db8:1:3::1')).not.toBe(limitKey('2001:db8:1:2::1'))
  })

  it.each([
    ['zeros elided inside the first half', '2001:db8::1', '2001:db8:0:0::/64'],
    ['zeros elided at the start', '::1', '0:0:0:0::/64'],
    ['zeros elided at the end', '2001:db8:1:2:3::', '2001:db8:1:2::/64'],
    ['a single group elided, the rest after it', '2001::1:2:3:4:5:6', '2001:0:1:2::/64'],
  ])('reads %s', (_, ip, key) => {
    expect(limitKey(ip)).toBe(key)
  })

  // Not an address Cloudflare sends; kept whole rather than guessed at, so it still has a limit.
  it.each(['2001:db8::1::2', '1:2:3:4:5:6:7::8::9', '2001:db8:1:2:3:4:5', '1:2:3:4:5:6:7:8:9::', 'unknown'])('keeps %s as it is', (ip) => {
    expect(limitKey(ip)).toBe(ip)
  })
})

describe('isPrivateOrigin', () => {
  it.each([
    ['a 10/8 address', 'http://10.0.0.5:8080'],
    ['a 172.16/12 address, at its start', 'http://172.16.0.1'],
    ['a 172.16/12 address, at its end', 'http://172.31.255.254'],
    ['a 192.168/16 address', 'https://192.168.1.20:8443'],
    ['a loopback address', 'http://127.0.0.1:8080'],
    ['a loopback address in another form', 'http://0x7f.1'],
    ['a link-local address', 'http://169.254.10.1'],
    ['a CGNAT address, at its start', 'http://100.64.0.1'],
    ['a CGNAT address, at its end', 'http://100.127.255.254'],
    ['IPv6 loopback', 'http://[::1]:8080'],
    ['an IPv6 unique local address (fc00::/7), fd', 'http://[fd12:3456::1]'],
    ['an IPv6 unique local address (fc00::/7), fc', 'http://[fc00::1]'],
    ['an IPv6 unique local address with its zeros elided at the end', 'http://[fd00::]'],
    ['an IPv6 link-local address, at the start of fe80::/10', 'http://[fe80::1]'],
    ['an IPv6 link-local address, at the end of fe80::/10', 'http://[febf::1]'],
    ['localhost', 'http://localhost:8080'],
    ['a name under .localhost', 'http://kinopeer.localhost'],
    ['a name under .local', 'http://umbrel.local'],
    ['a name under .local, in capitals', 'http://Umbrel.LOCAL'],
    ['a name under .home.arpa', 'http://nas.home.arpa:8080'],
    ['a name under .internal', 'https://qbt.internal'],
    ['a name of one label', 'http://nas:8080'],
    ['a fully qualified name with its trailing dot', 'http://umbrel.local.'],
  ])('reads %s as private', (_, origin) => {
    expect(isPrivateOrigin(origin)).toBe(true)
  })

  it.each([
    ['a public name', 'https://example.com'],
    ['a public IPv4 address', 'http://203.0.113.7'],
    ['an address just below 172.16/12', 'http://172.15.255.255'],
    ['an address just above 172.16/12', 'http://172.32.0.1'],
    ['an address just below CGNAT', 'http://100.63.255.255'],
    ['an address just above CGNAT', 'http://100.128.0.1'],
    ['192.169/16', 'http://192.169.0.1'],
    // The second number of a private range, after another first number.
    ['8.16/16, the second number of 172.16/12', 'http://8.16.0.1'],
    ['8.168/16, the second number of 192.168/16', 'http://8.168.0.1'],
    ['8.254/16, the second number of 169.254/16', 'http://8.254.0.1'],
    ['8.64/16, the second number of 100.64/10', 'http://8.64.0.1'],
    ['a public name that starts like a private address', 'http://10.0.0.1.example.com'],
    ['169.253/16', 'http://169.253.0.1'],
    ['a public IPv6 address', 'http://[2001:db8::1]'],
    ['an IPv6 address just below fc00::/7', 'http://[fbff::1]'],
    ['an IPv6 address just above fe80::/10', 'http://[fec0::1]'],
    ['the IPv6 unspecified address', 'http://[::]'],
    ['a name that only ends like .local', 'http://evil-local.com'],
    ['a public name with .local inside it', 'http://umbrel.local.example.com'],
    ['a name whose last label ends in "local"', 'http://example.nonlocal'],
    ['the opaque origin of a sandboxed page or a file', 'null'],
    ['an origin that isn’t http(s)', 'chrome-extension://abcdef'],
    ['no origin', null],
    ['an empty origin', ''],
    ['an origin of a lone dot', 'http://.'],
  ])('reads %s as public', (_, origin) => {
    expect(isPrivateOrigin(origin)).toBe(false)
  })
})
