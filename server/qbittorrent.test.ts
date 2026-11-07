import { request as httpRequest } from 'node:http'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { qbittorrentBridge, qbittorrentMiddleware, type QbittorrentConfig } from './qbittorrent.ts'
import { closeServers, fakeQbittorrent, listen, serve } from './test/fakes.ts'

/** Kinopeer's side: the middleware under test. */
const kinopeer = (config: QbittorrentConfig) => serve(qbittorrentMiddleware(config))

/** A request from Kinopeer's client, which marks every one (src/api/qbittorrent/client.ts). */
const call = (url: string, init: RequestInit = {}) =>
  fetch(url, { ...init, headers: { 'X-Kinopeer': '1', ...(init.headers as Record<string, string> | undefined) } })

/** Sends `path` as written: `fetch` would resolve its dots and backslashes first, as browsers do. */
function sendRaw(base: string, path: string): Promise<number> {
  const { hostname, port } = new URL(base)
  return new Promise((resolve, reject) => {
    const headers = { 'X-Kinopeer': '1', 'Content-Type': 'application/x-www-form-urlencoded' }
    const request = httpRequest({ hostname, port, path, method: 'POST', headers }, (response) => {
      response.resume()
      resolve(response.statusCode!)
    })
    request.on('error', reject)
    request.end('username=admin&password=x')
  })
}

afterEach(async () => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  await closeServers()
})

describe('qbittorrentMiddleware', () => {
  it('passes other paths on and reports a missing address', async () => {
    const base = await kinopeer({})
    expect((await fetch(`${base}/prowlarr/search`)).status).toBe(404)
    expect((await call(`${base}/qbt/api/v2/app/version`)).status).toBe(503)
  })

  it('never passes browser cookies on and keeps the browser away from /auth', async () => {
    const qbt = await fakeQbittorrent()
    const base = await kinopeer({ url: `${qbt.base}/` })

    const response = await call(`${base}/qbt/api/v2/app/version`, { headers: { Cookie: 'SID=sid1' } })
    expect(response.status).toBe(403)
    expect(qbt.seen.at(-1)).toMatchObject({ url: '/api/v2/app/version', cookie: undefined, origin: qbt.base })

    const login = await call(`${base}/qbt/api/v2/auth/login`, {
      method: 'POST',
      body: new URLSearchParams({ username: 'admin', password: 'pass word' }),
    })
    expect(login.status).toBe(404)
    expect(qbt.logins()).toBe(0)
  })

  it('switches to new credentials as soon as they change', async () => {
    const qbt = await fakeQbittorrent()
    let credentials = { username: 'admin', password: 'wrong' }
    vi.spyOn(console, 'warn').mockImplementation(() => {})
    const base = await kinopeer({ url: qbt.base, credentials: () => credentials })

    expect((await call(`${base}/qbt/api/v2/app/version`)).status).toBe(403)
    credentials = { username: 'admin', password: 'pass word' }
    expect((await call(`${base}/qbt/api/v2/app/version`)).status).toBe(200)
    expect(qbt.logins()).toBe(2)
  })

  it('logs in once with configured credentials and keeps the session to itself', async () => {
    const qbt = await fakeQbittorrent()
    const base = await kinopeer({ url: qbt.base, credentials: () => ({ username: 'admin', password: 'pass word' }) })

    const responses = await Promise.all(
      [1, 2, 3].map(() => call(`${base}/qbt/api/v2/app/version`, { headers: { Cookie: 'SID=browser' } })),
    )
    expect(responses.map((response) => response.status)).toEqual([200, 200, 200])
    expect(responses.every((response) => !response.headers.has('set-cookie'))).toBe(true)
    expect(qbt.logins()).toBe(1)
    expect(qbt.seen.map((request) => request.cookie)).toEqual(['SID=sid1', 'SID=sid1', 'SID=sid1'])
  })

  it('logs in again when the session expires and retries the request with its body', async () => {
    const qbt = await fakeQbittorrent()
    const base = await kinopeer({ url: qbt.base, credentials: () => ({ username: 'admin', password: 'pass word' }) })
    await call(`${base}/qbt/api/v2/app/version`)
    qbt.sessions.clear()

    const form = new FormData()
    form.set('urls', 'magnet:?xt=urn:btih:abc')
    const response = await call(`${base}/qbt/api/v2/torrents/add`, { method: 'POST', body: form })
    expect(response.status).toBe(200)
    expect(qbt.logins()).toBe(2)
    const [expired, retried] = qbt.seen.slice(-2)
    expect(expired.cookie).toBe('SID=sid1')
    expect(retried).toMatchObject({ method: 'POST', cookie: 'SID=sid2' })
    expect(retried.contentType).toMatch(/^multipart\/form-data; boundary=/)
    expect(retried.body).toContain('magnet:?xt=urn:btih:abc')
  })

  it.each([false, true])('stops using wrong credentials after one try, so the app asks for a login (legacy: %s)', async (legacy) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const qbt = await fakeQbittorrent({ legacy })
    const base = await kinopeer({ url: qbt.base, credentials: () => ({ username: 'admin', password: 'wrong' }) })

    expect((await call(`${base}/qbt/api/v2/app/version`)).status).toBe(403)
    expect((await call(`${base}/qbt/api/v2/app/version`)).status).toBe(403)
    expect(qbt.logins()).toBe(1)
    expect(warn).toHaveBeenCalledOnce()
    expect(String(warn.mock.calls[0][0])).not.toContain('wrong')
  })

  it('waits half a minute before logging in again after qBittorrent banned the address', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const qbt = await fakeQbittorrent()
    const base = await kinopeer({ url: qbt.base, credentials: () => ({ username: 'banned', password: 'pass word' }) })

    // Meanwhile requests go without a session, so auth bypass would still work; here it doesn't.
    expect((await call(`${base}/qbt/api/v2/app/version`)).status).toBe(403)
    expect((await call(`${base}/qbt/api/v2/app/version`)).status).toBe(403)
    expect(qbt.logins()).toBe(1)
    expect(qbt.seen.map((request) => request.cookie)).toEqual([undefined, undefined])

    vi.setSystemTime(Date.now() + 31_000)
    expect((await call(`${base}/qbt/api/v2/app/version`)).status).toBe(403)
    expect(qbt.logins()).toBe(2)
  })

  it('refuses a request that doesn’t come from Kinopeer’s client, so another site can’t act with the server’s session', async () => {
    const qbt = await fakeQbittorrent()
    const base = await kinopeer({ url: qbt.base, credentials: () => ({ username: 'admin', password: 'pass word' }) })

    // What a form on another site can send: no custom header, so no CORS preflight either.
    const form = await fetch(`${base}/qbt/api/v2/torrents/delete`, {
      method: 'POST',
      body: new URLSearchParams({ hashes: 'all', deleteFiles: 'true' }),
    })
    expect(form.status).toBe(400)
    expect((await fetch(`${base}/qbt/api/v2/torrents/info`)).status).toBe(400)
    // The header needs a preflight, which the bridge never allows.
    const preflight = await fetch(`${base}/qbt/api/v2/torrents/delete`, {
      method: 'OPTIONS',
      headers: { 'Access-Control-Request-Method': 'POST', 'Access-Control-Request-Headers': 'x-kinopeer' },
    })
    expect(preflight.ok).toBe(false)
    expect(preflight.headers.has('access-control-allow-origin')).toBe(false)
    expect(qbt.seen).toEqual([])
    expect(qbt.logins()).toBe(0)
  })

  it('forwards only the calls Kinopeer’s client makes, each with its own method', async () => {
    const qbt = await fakeQbittorrent()
    const base = await kinopeer({ url: qbt.base })

    const preferences = await call(`${base}/qbt/api/v2/app/setPreferences`, {
      method: 'POST',
      body: new URLSearchParams({ json: '{"save_path":"/elsewhere"}' }),
    })
    expect(preferences.status).toBe(404)
    const get = await call(`${base}/qbt/api/v2/torrents/delete`)
    expect(get.status).toBe(405)
    expect(get.headers.get('allow')).toBe('POST')
    const post = await call(`${base}/qbt/api/v2/torrents/info`, { method: 'POST' })
    expect(post.status).toBe(405)
    expect(post.headers.get('allow')).toBe('GET')
    expect(qbt.seen).toEqual([])

    expect((await call(`${base}/qbt/api/v2/torrents/files?hash=a1`)).status).toBe(403)
    expect(qbt.seen).toEqual([expect.objectContaining({ method: 'GET', url: '/api/v2/torrents/files?hash=a1' })])
  })

  it.each([
    '/qbt/api/x/../v2/auth/login',
    '/qbt/api/v2/%2e%2e/v2/auth/login',
    '/qbt/api/v2/%2E%2E/v2/auth/logout',
    '/qbt/api/v2\\auth/login',
    // Even where it would lead to a call the client makes.
    '/qbt/api/v2/auth/../torrents/delete',
  ])(
    'refuses %s, a path fetch would resolve to another, before it reaches qBittorrent',
    async (path) => {
      const qbt = await fakeQbittorrent()
      const base = await kinopeer({ url: qbt.base })
      expect(await sendRaw(base, path)).toBe(404)
      expect(qbt.logins()).toBe(0)
      expect(qbt.seen).toEqual([])
    },
  )

  // Its answers are the torrents and qBittorrent's settings: no cache on the way keeps them.
  it('answers with no-store, whatever qBittorrent says about caching', async () => {
    const qbittorrent = await listen((_request, response) => {
      response.setHeader('Cache-Control', 'public, max-age=600')
      response.end('v5.1.0')
    })
    const app = await kinopeer({ url: qbittorrent })

    const answer = await call(`${app}/qbt/api/v2/app/version`)
    expect(await answer.text()).toBe('v5.1.0')
    expect(answer.headers.get('cache-control')).toBe('no-store')
    // The bridge's own refusals too.
    expect((await call(`${app}/qbt/api/v2/auth/login`)).headers.get('cache-control')).toBe('no-store')
  })

  it('reports an unreachable qBittorrent and only proxies the API', async () => {
    const down = await kinopeer({ url: 'http://127.0.0.1:9', credentials: () => ({ username: 'admin', password: 'x' }) })
    expect((await call(`${down}/qbt/api/v2/app/version`)).status).toBe(502)

    const qbt = await fakeQbittorrent()
    const base = await kinopeer({ url: qbt.base })
    expect((await call(`${base}/qbt/index.html`)).status).toBe(404)
    expect(qbt.seen).toEqual([])
  })
})

describe('qbittorrentBridge.get', () => {
  it('asks qBittorrent with the server’s session, logging in when needed', async () => {
    const qbt = await fakeQbittorrent()
    const bridge = qbittorrentBridge({ url: qbt.base, credentials: () => ({ username: 'admin', password: 'pass word' }) })
    const response = await bridge.get('/api/v2/app/version')
    expect(await response.text()).toBe('v5.2.4')
    expect(qbt.logins()).toBe(1)
    expect(qbt.seen.at(-1)).toMatchObject({ method: 'GET', url: '/api/v2/app/version', cookie: 'SID=sid1' })
  })

  it('fails without an address', async () => {
    await expect(qbittorrentBridge({}).get('/api/v2/app/version')).rejects.toThrow()
  })
})
