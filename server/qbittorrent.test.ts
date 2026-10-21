import { createServer, type IncomingMessage, type RequestListener, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { qbittorrentMiddleware, type QbittorrentConfig } from './qbittorrent.ts'

const servers: Server[] = []

async function listen(handler: RequestListener): Promise<string> {
  const server = createServer(handler)
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

/** Kinoseed's side: the middleware, with a 404 fallback like Vite's. */
function kinoseed(config: QbittorrentConfig): Promise<string> {
  const middleware = qbittorrentMiddleware(config)
  return listen((request, response) =>
    middleware(request, response, () => {
      response.statusCode = 404
      response.end('fallback')
    }),
  )
}

async function bodyOf(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of request as AsyncIterable<Buffer>) chunks.push(chunk)
  return Buffer.concat(chunks).toString()
}

interface Seen {
  method?: string
  url?: string
  cookie?: string
  origin?: string
  contentType?: string
  body: string
}

/** A qBittorrent with one user that hands out SID cookies and can expire them. */
async function fakeQbittorrent({ legacy = false } = {}) {
  const sessions = new Set<string>()
  const seen: Seen[] = []
  let logins = 0
  const base = await listen(async (request, response) => {
    const body = await bodyOf(request)
    const url = request.url ?? ''
    if (url === '/api/v2/auth/login') {
      logins++
      const params = new URLSearchParams(body)
      if (params.get('username') !== 'admin' || params.get('password') !== 'pass word') {
        // qBittorrent 5.3+ answers 401; older versions 200 "Fails.".
        if (legacy) return response.end('Fails.')
        response.statusCode = 401
        return response.end('Unauthorized')
      }
      const sid = `sid${logins}`
      sessions.add(sid)
      response.setHeader('Set-Cookie', `SID=${sid}; HttpOnly; SameSite=Strict; path=/`)
      return response.end('Ok.')
    }
    seen.push({
      method: request.method,
      url,
      cookie: request.headers.cookie,
      origin: request.headers.origin,
      contentType: request.headers['content-type'],
      body,
    })
    if (!sessions.has(/SID=(\w+)/.exec(request.headers.cookie ?? '')?.[1] ?? '')) {
      response.statusCode = 403
      return response.end('Forbidden')
    }
    response.setHeader('Content-Type', 'text/plain')
    response.end('v5.2.4')
  })
  return { base, seen, sessions, logins: () => logins }
}

afterEach(async () => {
  vi.restoreAllMocks()
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))))
})

describe('qbittorrentMiddleware', () => {
  it('passes other paths on and reports a missing address', async () => {
    const base = await kinoseed({})
    expect((await fetch(`${base}/prowlarr/search`)).status).toBe(404)
    expect((await fetch(`${base}/qbt/api/v2/app/version`)).status).toBe(503)
  })

  it('passes the browser’s own session through without credentials', async () => {
    const qbt = await fakeQbittorrent()
    const base = await kinoseed({ url: `${qbt.base}/` })

    expect((await fetch(`${base}/qbt/api/v2/app/version`)).status).toBe(403)
    const login = await fetch(`${base}/qbt/api/v2/auth/login`, {
      method: 'POST',
      body: new URLSearchParams({ username: 'admin', password: 'pass word' }),
    })
    const cookie = login.headers.get('set-cookie')
    expect(cookie).toContain('SID=sid1')

    const response = await fetch(`${base}/qbt/api/v2/torrents/info?filter=all`, {
      headers: { Cookie: cookie!.split(';')[0] },
    })
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('v5.2.4')
    expect(qbt.seen.at(-1)).toMatchObject({ url: '/api/v2/torrents/info?filter=all', cookie: 'SID=sid1', origin: qbt.base })
  })

  it('logs in once with configured credentials and keeps the session to itself', async () => {
    const qbt = await fakeQbittorrent()
    const base = await kinoseed({ url: qbt.base, username: 'admin', password: 'pass word' })

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
    const base = await kinoseed({ url: qbt.base, username: 'admin', password: 'pass word' })
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

  it.each([false, true])('falls back to the login form after wrong credentials without trying them again (legacy: %s)', async (legacy) => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const qbt = await fakeQbittorrent({ legacy })
    const base = await kinoseed({ url: qbt.base, username: 'admin', password: 'wrong' })

    expect((await fetch(`${base}/qbt/api/v2/app/version`)).status).toBe(403)
    expect((await fetch(`${base}/qbt/api/v2/app/version`)).status).toBe(403)
    expect(qbt.logins()).toBe(1)
    expect(warn).toHaveBeenCalledOnce()
    expect(String(warn.mock.calls[0][0])).not.toContain('wrong')

    const login = await fetch(`${base}/qbt/api/v2/auth/login`, {
      method: 'POST',
      body: new URLSearchParams({ username: 'admin', password: 'pass word' }),
    })
    expect(login.headers.get('set-cookie')).toContain('SID=')
  })

  it('reports an unreachable qBittorrent and only proxies the API', async () => {
    const down = await kinoseed({ url: 'http://127.0.0.1:9', username: 'admin', password: 'x' })
    expect((await fetch(`${down}/qbt/api/v2/app/version`)).status).toBe(502)

    const qbt = await fakeQbittorrent()
    const base = await kinoseed({ url: qbt.base })
    expect((await fetch(`${base}/qbt/index.html`)).status).toBe(404)
    expect(qbt.seen).toEqual([])
  })
})
