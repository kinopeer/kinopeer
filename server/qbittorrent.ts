import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Middleware } from './prowlarr.ts'

/**
 * Same-origin bridge to qBittorrent's Web API: /qbt/api/v2/… → $QBITTORRENT_URL/api/v2/…
 *
 * Origin and Referer are rewritten to the target so qBittorrent's CSRF check passes. The server
 * logs in itself with the credentials it has (saved from the app, else QBITTORRENT_USERNAME and
 * QBITTORRENT_PASSWORD), keeps the session and logs in again when it expires, so the browser never
 * sees the password or a qBittorrent cookie. Without credentials, or after qBittorrent rejects
 * them, requests go without a session: that works with qBittorrent's auth bypass, and otherwise
 * answers 403 so the app asks for a login (server/settings.ts saves it). The browser can't reach
 * /auth/* itself, so it can't get the server's IP banned.
 *
 * Runs as Vite middleware in dev and in the production server.
 */
export interface QbittorrentCredentials {
  username: string
  password: string
}

export interface QbittorrentConfig {
  /** e.g. http://192.168.1.10:8080 */
  url?: string
  /** Read on every request, so credentials saved from the app apply at once. */
  credentials?: () => QbittorrentCredentials | undefined
}

export type LoginResult = { status: 'ok'; cookie: string } | { status: 'invalid' } | { status: 'banned' }

/**
 * Logs in to qBittorrent at `base`. 'banned' covers a 403 (the IP is banned after failed logins)
 * and other refusals; rejects when qBittorrent can't be reached.
 */
export async function qbittorrentLogin(base: string, username: string, password: string): Promise<LoginResult> {
  const response = await fetch(`${base}/api/v2/auth/login`, {
    method: 'POST',
    headers: { Origin: base, Referer: `${base}/` },
    body: new URLSearchParams({ username, password }),
  })
  const text = (await response.text()).trim()
  // Wrong credentials: 401 since qBittorrent 5.3, 200 "Fails." before.
  if (response.status === 401 || (response.ok && text === 'Fails.')) return { status: 'invalid' }
  if (!response.ok) return { status: 'banned' }
  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(';')[0].trim())
    .filter(Boolean)
    .join('; ')
  return { status: 'ok', cookie }
}

const PREFIX = '/qbt/'
const API_PREFIX = '/qbt/api/'
const AUTH_PREFIX = '/qbt/api/v2/auth/'
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
    const result = await qbittorrentLogin(this.base, this.username, this.password)
    if (result.status === 'invalid') {
      this.rejected = true
      // Never log the credentials themselves.
      console.warn('[kinoseed] qBittorrent rejected the saved login; the app will ask for a new one')
      return undefined
    }
    if (result.status === 'banned') {
      // qBittorrent banned this IP after failed logins: try again later.
      this.failedAt = Date.now()
      return undefined
    }
    this.cookie = result.cookie
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
  let upstream = await send(cookie)
  if (cookie !== undefined && upstream.status === 403) {
    // The session expired or qBittorrent restarted: log in again and retry once.
    cookie = await session!.renew(cookie)
    if (cookie !== undefined) upstream = await send(cookie)
  }

  response.statusCode = upstream.status
  for (const name of RESPONSE_HEADERS) {
    const value = upstream.headers.get(name)
    if (value) response.setHeader(name, value)
  }
  response.end(Buffer.from(await upstream.arrayBuffer()))
}

/** The session for the current credentials: a new one when they change. */
function sessions(base: string | undefined, credentials: QbittorrentConfig['credentials']) {
  let key: string | undefined
  let session: ServerSession | undefined
  return () => {
    const current = credentials?.()
    const username = current?.username.trim()
    const next = base && username ? `${username}\0${current!.password}` : undefined
    if (next !== key) {
      key = next
      session = base && username ? new ServerSession(base, username, current!.password) : undefined
    }
    return session
  }
}

export function qbittorrentMiddleware(config: QbittorrentConfig): Middleware {
  const base = config.url?.trim().replace(/\/+$/, '')
  const currentSession = sessions(base, config.credentials)

  return (request, response, next) => {
    const path = request.url ?? '/'
    if (!path.startsWith(PREFIX)) return next()
    const fail = (status: number, message: string) => {
      response.statusCode = status
      response.setHeader('Content-Type', 'text/plain; charset=utf-8')
      response.end(message)
    }
    if (!base) return fail(503, 'QBITTORRENT_URL is not set')
    if (!path.startsWith(API_PREFIX) || path.startsWith(AUTH_PREFIX)) return fail(404, 'Not found')

    forward(base, currentSession(), request, response).catch((error: unknown) => {
      if (response.headersSent) return void response.end()
      if (error instanceof BodyTooLargeError) fail(413, 'Request body too large')
      else fail(502, 'qBittorrent is unreachable')
    })
  }
}
