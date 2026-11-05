import { afterEach, describe, expect, it, vi } from 'vitest'
import { qbittorrentBridge, qbittorrentMiddleware, type QbittorrentConfig } from './qbittorrent.ts'
import { closeServers, fakeQbittorrent, serve } from './test/fakes.ts'

/** Kinopeer's side: the middleware under test. */
const kinopeer = (config: QbittorrentConfig) => serve(qbittorrentMiddleware(config))

afterEach(async () => {
  vi.restoreAllMocks()
  vi.useRealTimers()
  await closeServers()
})

describe('qbittorrentMiddleware', () => {
  it('passes other paths on and reports a missing address', async () => {
    const base = await kinopeer({})
    expect((await fetch(`${base}/prowlarr/search`)).status).toBe(404)
    expect((await fetch(`${base}/qbt/api/v2/app/version`)).status).toBe(503)
  })

  it('never passes browser cookies on and keeps the browser away from /auth', async () => {
    const qbt = await fakeQbittorrent()
    const base = await kinopeer({ url: `${qbt.base}/` })

    const response = await fetch(`${base}/qbt/api/v2/app/version`, { headers: { Cookie: 'SID=sid1' } })
    expect(response.status).toBe(403)
    expect(qbt.seen.at(-1)).toMatchObject({ url: '/api/v2/app/version', cookie: undefined, origin: qbt.base })

    const login = await fetch(`${base}/qbt/api/v2/auth/login`, {
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

    expect((await fetch(`${base}/qbt/api/v2/app/version`)).status).toBe(403)
    credentials = { username: 'admin', password: 'pass word' }
    expect((await fetch(`${base}/qbt/api/v2/app/version`)).status).toBe(200)
    expect(qbt.logins()).toBe(2)
  })

  it('logs in once with configured credentials and keeps the session to itself', async () => {
    const qbt = await fakeQbittorrent()
    const base = await kinopeer({ url: qbt.base, credentials: () => ({ username: 'admin', password: 'pass word' }) })

    const responses = await Promise.all(
      [1, 2, 3].map(() => fetch(`${base}/qbt/api/v2/app/version`, { headers: { Cookie: 'SID=browser' } })),
    )
    expect(responses.map((response) => response.status)).toEqual([200, 200, 200])
    expect(responses.every((response) => !response.headers.has('set-cookie'))).toBe(true)
    expect(qbt.logins()).toBe(1)
    expect(qbt.seen.map((request) => request.cookie)).toEqual(['SID=sid1', 'SID=sid1', 'SID=sid1'])
  })

  it('logs in again when the session expires and retries the request with its body', async () => {
    const qbt = await fakeQbittorrent()
    const base = await kinopeer({ url: qbt.base, credentials: () => ({ username: 'admin', password: 'pass word' }) })
    await fetch(`${base}/qbt/api/v2/app/version`)
    qbt.sessions.clear()

    const form = new FormData()
    form.set('urls', 'magnet:?xt=urn:btih:abc')
    const response = await fetch(`${base}/qbt/api/v2/torrents/add`, { method: 'POST', body: form })
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

    expect((await fetch(`${base}/qbt/api/v2/app/version`)).status).toBe(403)
    expect((await fetch(`${base}/qbt/api/v2/app/version`)).status).toBe(403)
    expect(qbt.logins()).toBe(1)
    expect(warn).toHaveBeenCalledOnce()
    expect(String(warn.mock.calls[0][0])).not.toContain('wrong')
  })

  it('waits half a minute before logging in again after qBittorrent banned the address', async () => {
    vi.useFakeTimers({ toFake: ['Date'] })
    const qbt = await fakeQbittorrent()
    const base = await kinopeer({ url: qbt.base, credentials: () => ({ username: 'banned', password: 'pass word' }) })

    // Meanwhile requests go without a session, so auth bypass would still work; here it doesn't.
    expect((await fetch(`${base}/qbt/api/v2/app/version`)).status).toBe(403)
    expect((await fetch(`${base}/qbt/api/v2/app/version`)).status).toBe(403)
    expect(qbt.logins()).toBe(1)
    expect(qbt.seen.map((request) => request.cookie)).toEqual([undefined, undefined])

    vi.setSystemTime(Date.now() + 31_000)
    expect((await fetch(`${base}/qbt/api/v2/app/version`)).status).toBe(403)
    expect(qbt.logins()).toBe(2)
  })

  it('reports an unreachable qBittorrent and only proxies the API', async () => {
    const down = await kinopeer({ url: 'http://127.0.0.1:9', credentials: () => ({ username: 'admin', password: 'x' }) })
    expect((await fetch(`${down}/qbt/api/v2/app/version`)).status).toBe(502)

    const qbt = await fakeQbittorrent()
    const base = await kinopeer({ url: qbt.base })
    expect((await fetch(`${base}/qbt/index.html`)).status).toBe(404)
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
