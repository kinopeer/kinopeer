import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Middleware } from './prowlarr.ts'

/**
 * Same-origin bridge to qBittorrent's Web API: /qbt/api/v2/… → $QBITTORRENT_URL/api/v2/…
 *
 * Origin and Referer are rewritten to the target so qBittorrent's CSRF check passes. With a
 * username and password configured, the server logs in itself and keeps the session, logging in
 * again when it expires, so the browser never sees a login form or the password. Without them (or
 * when qBittorrent rejects them) the browser's own session cookie is passed through and the app
 * shows its login form.
 *
 * Runs as Vite middleware in dev and in the production server.
 */
export interface QbittorrentConfig {
  /** e.g. http://192.168.1.10:8080 */
  url?: string
  username?: string
  password?: string
}

const PREFIX = '/qbt/'
const API_PREFIX = '/qbt/api/'
const MAX_BODY_BYTES = 50 * 1024 * 1024
/** After qBittorrent refuses a login (e.g. the IP is banned), wait before trying again. */
const LOGIN_RETRY_MS = 30_000
/** Upstream response headers passed on to the browser. */
const RESPONSE_HEADERS = ['content-type', 'cache-control', 'last-modified', 'etag']

class BodyTooLargeError extends Error {}

/** A qBittorrent session the server holds itself, shared by every browser that uses Kinoseed. */
class ServerSession {
  /** "SID=…" for the Cookie header, '' when qBittorrent needs none (auth bypass), undefined when logged out. */
  private cookie: string | undefined
  private pending: Promise<string | undefined> | undefined
  /** qBittorrent rejected the credentials: trying them again would only get the server's IP banned. */
  private rejected = false
  private failedAt = Number.NEGATIVE_INFINITY

  private readonly base: string
  private readonly username: string
  private readonly password: string

  constructor(base: string, username: string, password: string) {
    this.base = base
    this.username = username
    this.password = password
  }

  get usable(): boolean {
    return !this.rejected
  }

  async current(): Promise<string | undefined> {
    return this.cookie ?? this.renew()
  }

  /** Logs in again, unless another request already replaced the `stale` cookie. */
  renew(stale?: string): Promise<string | undefined> {
    if (stale !== undefined && this.cookie !== undefined && this.cookie !== stale) return Promise.resolve(this.cookie)
    this.cookie = undefined
    this.pending ??= this.login().finally(() => {
      this.pending = undefined
    })
    return this.pending
  }

  private async login(): Promise<string | undefined> {
    if (this.rejected || Date.now() - this.failedAt < LOGIN_RETRY_MS) return undefined
    const response = await fetch(`${this.base}/api/v2/auth/login`, {
      method: 'POST',
      headers: { Origin: this.base, Referer: `${this.base}/` },
      body: new URLSearchParams({ username: this.username, password: this.password }),
    })
    const text = (await response.text()).trim()
    // Wrong credentials: 401 since qBittorrent 5.3, 200 "Fails." before.
    if (response.status === 401 || (response.ok && text === 'Fails.')) {
      this.rejected = true
      // Never log the credentials themselves.
      console.warn('[kinoseed] qBittorrent rejected QBITTORRENT_USERNAME/QBITTORRENT_PASSWORD; using the login form instead')
      return undefined
    }
    if (!response.ok) {
      // 403 means qBittorrent banned this IP after failed logins: try again later.
      this.failedAt = Date.now()
      return undefined
    }

    this.cookie = response.headers
      .getSetCookie()
      .map((cookie) => cookie.split(';')[0].trim())
      .filter(Boolean)
      .join('; ')
    return this.cookie
  }
}

async function readBody(request: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request as AsyncIterable<Buffer>) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) throw new BodyTooLargeError()
    chunks.push(chunk)
  }
  return Buffer.concat(chunks)
}

async function forward(
  base: string,
  session: ServerSession | undefined,
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  const method = request.method ?? 'GET'
  const body = method === 'GET' || method === 'HEAD' ? undefined : await readBody(request)
  const send = (cookie: string | undefined) => {
    const headers: Record<string, string> = { Origin: base, Referer: `${base}/` }
    if (cookie) headers.Cookie = cookie
    if (request.headers['content-type']) headers['Content-Type'] = request.headers['content-type']
    if (request.headers.accept) headers.Accept = request.headers.accept
    return fetch(`${base}${request.url!.slice(PREFIX.length - 1)}`, { method, headers, body, redirect: 'manual' })
  }

  let cookie = session?.usable ? await session.current() : undefined
  const serverAuth = cookie !== undefined
  let upstream = await send(serverAuth ? cookie : request.headers.cookie)
  if (serverAuth && upstream.status === 403) {
    // The session expired or qBittorrent restarted: log in again and retry once.
    cookie = await session!.renew(cookie)
    if (cookie !== undefined) upstream = await send(cookie)
  }

  response.statusCode = upstream.status
  for (const name of RESPONSE_HEADERS) {
    const value = upstream.headers.get(name)
    if (value) response.setHeader(name, value)
  }
  // The browser only needs qBittorrent's cookie when it holds the session itself.
  const cookies = upstream.headers.getSetCookie()
  if (!serverAuth && cookies.length) response.setHeader('Set-Cookie', cookies)
  response.end(Buffer.from(await upstream.arrayBuffer()))
}

export function qbittorrentMiddleware(config: QbittorrentConfig): Middleware {
  const base = config.url?.trim().replace(/\/+$/, '')
  const username = config.username?.trim()
  const password = config.password ?? ''
  const session = base && username ? new ServerSession(base, username, password) : undefined

  return (request, response, next) => {
    const path = request.url ?? '/'
    if (!path.startsWith(PREFIX)) return next()
    const fail = (status: number, message: string) => {
      response.statusCode = status
      response.setHeader('Content-Type', 'text/plain; charset=utf-8')
      response.end(message)
    }
    if (!base) return fail(503, 'QBITTORRENT_URL is not set')
    if (!path.startsWith(API_PREFIX)) return fail(404, 'Not found')

    forward(base, session, request, response).catch((error: unknown) => {
      if (response.headersSent) return void response.end()
      if (error instanceof BodyTooLargeError) fail(413, 'Request body too large')
      else fail(502, 'qBittorrent is unreachable')
    })
  }
}
