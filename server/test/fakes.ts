/**
 * For the server tests: HTTP servers on random ports, the middleware under test served the way
 * Vite serves it, and stand-ins for qBittorrent and TMDB that record what reached them. Every
 * server started here is closed by `closeServers()`, which the tests call in afterEach.
 */
import { createServer, type IncomingMessage, type RequestListener, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'

type Middleware = (request: IncomingMessage, response: ServerResponse, next: () => void) => unknown

const servers: Server[] = []

/** Starts `handler` on a free port of 127.0.0.1 and returns its origin. */
export async function listen(handler: RequestListener): Promise<string> {
  const server = createServer(handler)
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

/** Closes every server `listen` started; for afterEach. */
export async function closeServers(): Promise<void> {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))))
}

/** Kinoseed's side: a middleware with a 404 fallback like Vite's, so a path it passes on is told apart. */
export function serve(middleware: Middleware): Promise<string> {
  return listen((request, response) =>
    middleware(request, response, () => {
      response.statusCode = 404
      response.end('fallback')
    }),
  )
}

/** The request's body as text. */
export async function bodyOf(request: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = []
  for await (const chunk of request as AsyncIterable<Buffer>) chunks.push(chunk)
  return Buffer.concat(chunks).toString()
}

/** What the fake qBittorrent saw of a request past the login. */
export interface QbittorrentRequest {
  method?: string
  url?: string
  cookie?: string
  origin?: string
  contentType?: string
  body: string
}

/**
 * A qBittorrent with one user, admin / "pass word", that hands out SID cookies and can expire them
 * (`sessions.clear()`). Any other path needs a live session and answers the version. A wrong
 * password gets 401 (qBittorrent 5.3+), or 200 "Fails." with `legacy`; the user "banned" gets 403,
 * as from an IP qBittorrent has banned.
 */
export async function fakeQbittorrent({ legacy = false } = {}) {
  const sessions = new Set<string>()
  const seen: QbittorrentRequest[] = []
  let logins = 0
  const base = await listen(async (request, response) => {
    const body = await bodyOf(request)
    const url = request.url ?? ''
    if (url === '/api/v2/auth/login') {
      logins++
      const params = new URLSearchParams(body)
      if (params.get('username') === 'banned') {
        response.statusCode = 403
        return response.end('Forbidden')
      }
      if (params.get('username') !== 'admin' || params.get('password') !== 'pass word') {
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

/** What the fake TMDB saw of a request. */
export interface TmdbRequest {
  url?: string
  authorization?: string
  cookie?: string
}

/**
 * TMDB's API and image hosts, recording what reached them. `/3/authentication` accepts the key
 * "good-key" or the bearer token "eyJgood" and answers `{ success }`; `/t/p/*` is a JPEG; anything
 * else is an empty result list with a tracking cookie, which Kinoseed must not pass on.
 */
export async function fakeTmdb() {
  const seen: TmdbRequest[] = []
  const base = await listen((request, response) => {
    const url = request.url ?? ''
    seen.push({ url, authorization: request.headers.authorization, cookie: request.headers.cookie })
    if (url.startsWith('/t/p/')) {
      response.setHeader('Content-Type', 'image/jpeg')
      response.setHeader('Cache-Control', 'max-age=31536000')
      return response.end(Buffer.from([0xff, 0xd8, 0xff]))
    }
    if (url.startsWith('/3/authentication')) {
      const ok = url === '/3/authentication?api_key=good-key' || request.headers.authorization === 'Bearer eyJgood'
      response.statusCode = ok ? 200 : 401
      response.setHeader('Content-Type', 'application/json')
      return response.end(JSON.stringify({ success: ok }))
    }
    response.setHeader('Content-Type', 'application/json;charset=utf-8')
    response.setHeader('Set-Cookie', 'tracking=1')
    response.end(JSON.stringify({ results: [] }))
  })
  return { base, apiBase: `${base}/3`, seen }
}
