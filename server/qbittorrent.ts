import type { IncomingMessage, ServerResponse } from 'node:http'
import { abandoned } from './abandoned.ts'
import type { Middleware } from './prowlarr.ts'

/**
 * Same-origin bridge to qBittorrent's Web API: /qbt/api/v2/… → {qBittorrent's address}/api/v2/…, the
 * address QBITTORRENT_URL sets, else the one saved from the app (server/settings.ts).
 *
 * It forwards only the calls Kinopeer's client makes (ENDPOINTS), and only from the client: every
 * request carries the X-Kinopeer header, which a page on another site can't add without a CORS
 * preflight, and the bridge allows none. That stands in for qBittorrent's own CSRF check, which
 * can't see the browser: Origin and Referer are rewritten to the target so it passes. The server
 * logs in itself with the credentials it has (saved from the app, else QBITTORRENT_USERNAME and
 * QBITTORRENT_PASSWORD, only while QBITTORRENT_URL sets the address: `kinopeerServer`), keeps the session and logs in again when it expires, so the browser never
 * sees the password or a qBittorrent cookie. Without credentials, or after qBittorrent rejects
 * them, requests go without a session: that works with qBittorrent's auth bypass, and otherwise
 * answers 403 so the app asks for a login (server/settings.ts saves it). The browser can't reach
 * /auth/* itself, so it can't get the server's IP banned.
 *
 * Runs as Vite middleware in dev and in the production server. The server's own jobs (the matches
 * cleanup, the notifications) go through the same session with `get` and `post`.
 */
export interface QbittorrentCredentials {
  username: string
  password: string
}

export interface QbittorrentConfig {
  /**
   * The address, e.g. http://192.168.1.10:8080, without a trailing slash: read on every request, so
   * an address saved from the app applies at once.
   */
  url: () => string | undefined
  /** Read on every request, so credentials saved from the app apply at once. */
  credentials?: () => QbittorrentCredentials | undefined
}

export type LoginResult = { status: 'ok'; cookie: string } | { status: 'invalid' } | { status: 'banned' } | { status: 'not-qbittorrent' }

/**
 * Logs in to qBittorrent at `base`. 'banned' is a 403 (the IP is banned after failed logins), and
 * 'not-qbittorrent' a redirect or any other error, which qBittorrent's login doesn't answer with (a
 * wrong address, a proxy in front); rejects when nothing answers, or `signal` aborts first.
 */
export async function qbittorrentLogin(
  base: string,
  username: string,
  password: string,
  signal?: AbortSignal,
): Promise<LoginResult> {
  const response = await fetch(`${base}/api/v2/auth/login`, {
    method: 'POST',
    headers: { Origin: base, Referer: `${base}/` },
    body: new URLSearchParams({ username, password }),
    // Never on to wherever a redirect points: the password goes to qBittorrent's address only, and
    // the bridge doesn't follow redirects either, so an address that redirects isn't qBittorrent's.
    redirect: 'manual',
    signal,
  })
  const text = (await response.text()).trim()
  // Wrong credentials: 401 since qBittorrent 5.3, 200 "Fails." before.
  if (response.status === 401 || (response.ok && text === 'Fails.')) return { status: 'invalid' }
  if (response.status === 403) return { status: 'banned' }
  if (!response.ok) return { status: 'not-qbittorrent' }
  const cookie = response.headers
    .getSetCookie()
    .map((value) => value.split(';')[0].trim())
    .filter(Boolean)
    .join('; ')
  return { status: 'ok', cookie }
}

/** What qBittorrent's version looks like (`v5.2.4`, `v4.6.7`), told from a page that answers every path. */
const VERSION = /^v?\d+\.\d+/

/**
 * Whether qBittorrent at `base` lets the server in: with `credentials`, by logging in, and without,
 * through its auth bypass. Either way it then asks for qBittorrent's version, so an address that
 * answers but isn't qBittorrent (a proxy's sign-in page, another app) says so rather than passing.
 * Rejects when nothing answers, or `signal` aborts first.
 */
export async function checkQbittorrent(
  base: string,
  credentials: QbittorrentCredentials | undefined,
  signal?: AbortSignal,
): Promise<'ok' | 'invalid' | 'banned' | 'not-qbittorrent'> {
  let cookie: string | undefined
  if (credentials) {
    const login = await qbittorrentLogin(base, credentials.username, credentials.password, signal)
    if (login.status !== 'ok') return login.status
    cookie = login.cookie
  }
  const response = await fetch(`${base}/api/v2/app/version`, {
    headers: { Origin: base, Referer: `${base}/`, ...(cookie && { Cookie: cookie }) },
    redirect: 'manual',
    signal,
  })
  const text = await response.text()
  // Without a login, a 403 is qBittorrent asking for one.
  if (!credentials && response.status === 403) return 'invalid'
  return response.ok && VERSION.test(text) ? 'ok' : 'not-qbittorrent'
}

const PREFIX = '/qbt/'
/** Sent by src/api/qbittorrent/client.ts on every request. */
const CLIENT_HEADER = 'x-kinopeer'
/**
 * On every answer of the bridge, so the client tells a failure of qBittorrent's from one that never
 * reached Kinopeer's server (a proxy in front answering for it): `BRIDGE_HEADER` in
 * src/api/qbittorrent/client.ts, which server code can't import (the image has no src/).
 */
export const BRIDGE_HEADER = 'x-kinopeer-bridge'
/**
 * What src/api/qbittorrent/client.ts calls, with its method: the only requests the bridge sends on,
 * so nothing reaches qBittorrent's preferences, its logins or anything else Kinopeer doesn't use.
 * server/integration/qbittorrent.test.ts checks that every call of the client gets through.
 */
const ENDPOINTS = new Map<string, 'GET' | 'POST'>([
  ['/api/v2/app/version', 'GET'],
  ['/api/v2/app/defaultSavePath', 'GET'],
  ['/api/v2/app/preferences', 'GET'],
  ['/api/v2/sync/maindata', 'GET'],
  ['/api/v2/torrents/info', 'GET'],
  ['/api/v2/torrents/categories', 'GET'],
  ['/api/v2/torrents/files', 'GET'],
  ['/api/v2/torrents/trackers', 'GET'],
  ['/api/v2/torrents/add', 'POST'],
  ['/api/v2/torrents/delete', 'POST'],
  ['/api/v2/torrents/filePrio', 'POST'],
  // qBittorrent 5's names, then 4.x's.
  ['/api/v2/torrents/start', 'POST'],
  ['/api/v2/torrents/stop', 'POST'],
  ['/api/v2/torrents/resume', 'POST'],
  ['/api/v2/torrents/pause', 'POST'],
  ['/api/v2/torrents/setDownloadLimit', 'POST'],
  ['/api/v2/torrents/setUploadLimit', 'POST'],
  ['/api/v2/torrents/toggleSequentialDownload', 'POST'],
  ['/api/v2/torrents/toggleFirstLastPiecePrio', 'POST'],
  ['/api/v2/torrents/setCategory', 'POST'],
  ['/api/v2/torrents/recheck', 'POST'],
  ['/api/v2/torrents/reannounce', 'POST'],
  ['/api/v2/torrents/setLocation', 'POST'],
  // The notification switch (server/notifier.ts).
  ['/api/v2/torrents/addTags', 'POST'],
  ['/api/v2/torrents/removeTags', 'POST'],
  ['/api/v2/transfer/toggleSpeedLimitsMode', 'POST'],
])
const MAX_BODY_BYTES = 50 * 1024 * 1024
/** After qBittorrent refuses a login (e.g. the IP is banned), wait before trying again. */
const LOGIN_RETRY_MS = 30_000
/** Upstream response headers passed on to the browser. */
const RESPONSE_HEADERS = ['content-type', 'last-modified', 'etag']

class BodyTooLargeError extends Error {}

/** A qBittorrent session the server holds itself, shared by every browser that uses Kinopeer. */
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
      console.warn('[kinopeer] qBittorrent rejected the saved login; the app will ask for a new one')
      return undefined
    }
    if (result.status !== 'ok') {
      // qBittorrent banned this IP after failed logins, or something else answered: try again later.
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

interface UpstreamRequest {
  method: string
  /** From /api/v2/… on. */
  path: string
  headers?: Record<string, string>
  body?: Buffer
  /** Gives the request up, as when the browser it's made for has gone. */
  signal?: AbortSignal
}

/** Sends a request to qBittorrent with the server's session, logging in again once if it expired. */
async function send(base: string, session: ServerSession | undefined, upstream: UpstreamRequest): Promise<Response> {
  const attempt = (cookie: string | undefined) => {
    const headers: Record<string, string> = { ...upstream.headers, Origin: base, Referer: `${base}/` }
    if (cookie) headers.Cookie = cookie
    return fetch(`${base}${upstream.path}`, {
      method: upstream.method,
      headers,
      body: upstream.body,
      redirect: 'manual',
      signal: upstream.signal,
    })
  }

  let cookie = session?.usable ? await session.current() : undefined
  let response = await attempt(cookie)
  if (cookie !== undefined && response.status === 403) {
    // The session expired or qBittorrent restarted: log in again and retry once.
    cookie = await session!.renew(cookie)
    if (cookie !== undefined) response = await attempt(cookie)
  }
  return response
}

async function forward(
  base: string,
  session: ServerSession | undefined,
  request: IncomingMessage,
  response: ServerResponse,
  path: string,
): Promise<void> {
  const method = request.method ?? 'GET'
  // Only the call itself: a login it waits for is the session's, shared with other requests.
  const signal = abandoned(response)
  const headers: Record<string, string> = {}
  if (request.headers['content-type']) headers['Content-Type'] = request.headers['content-type']
  if (request.headers.accept) headers.Accept = request.headers.accept
  const upstream = await send(base, session, {
    method,
    path,
    headers,
    body: method === 'GET' || method === 'HEAD' ? undefined : await readBody(request),
    signal,
  })

  response.statusCode = upstream.status
  for (const name of RESPONSE_HEADERS) {
    const value = upstream.headers.get(name)
    if (value) response.setHeader(name, value)
  }
  response.end(Buffer.from(await upstream.arrayBuffer()))
}

/**
 * The session for the current address and credentials: a new one when either changes, so a login
 * qBittorrent rejected at one address is tried at a new one.
 */
function sessions(credentials: QbittorrentConfig['credentials']) {
  let key: string | undefined
  let session: ServerSession | undefined
  return (base: string) => {
    const current = credentials?.()
    const username = current?.username.trim()
    const next = username ? `${base}\0${username}\0${current!.password}` : undefined
    if (next !== key) {
      key = next
      session = username ? new ServerSession(base, username, current!.password) : undefined
    }
    return session
  }
}

export interface QbittorrentBridge {
  middleware: Middleware
  /**
   * A GET of qBittorrent's Web API for the server itself, e.g. `/api/v2/torrents/info`, with the
   * same session as the browsers'. Rejects when qBittorrent has no address or can't be reached.
   */
  get(path: string): Promise<Response>
  /** A POST of a form, the same way, e.g. `/api/v2/torrents/removeTags`. */
  post(path: string, form: URLSearchParams): Promise<Response>
}

export function qbittorrentBridge(config: QbittorrentConfig): QbittorrentBridge {
  const currentSession = sessions(config.credentials)

  const middleware: Middleware = (request, response, next) => {
    const path = request.url ?? '/'
    if (!path.startsWith(PREFIX)) return next()
    // The torrents and qBittorrent's settings: no cache on the way keeps them, whatever qBittorrent says.
    response.setHeader('Cache-Control', 'no-store')
    response.setHeader(BRIDGE_HEADER, '1')
    const fail = (status: number, message: string) => {
      response.statusCode = status
      response.setHeader('Content-Type', 'text/plain; charset=utf-8')
      response.end(message)
    }
    const base = config.url()
    if (!base) return fail(503, 'qBittorrent has no address')
    const target = path.slice(PREFIX.length - 1)
    // Matched as written: a path with dots, encoded dots or a backslash, which fetch would resolve
    // to another one, matches none.
    const method = ENDPOINTS.get(target.split('?', 1)[0])
    if (!method) return fail(404, 'Not found')
    if (request.method !== method) {
      response.setHeader('Allow', method)
      return fail(405, 'Method not allowed')
    }
    if (!request.headers[CLIENT_HEADER]) return fail(400, 'Not a request from Kinopeer')

    forward(base, currentSession(base), request, response, target).catch((error: unknown) => {
      if (response.headersSent) return void response.end()
      if (error instanceof BodyTooLargeError) fail(413, 'Request body too large')
      else fail(502, 'qBittorrent is unreachable')
    })
  }

  return {
    middleware,
    get: async (path) => {
      const base = config.url()
      if (!base) throw new Error('qBittorrent has no address')
      return send(base, currentSession(base), { method: 'GET', path })
    },
    post: async (path, form) => {
      const base = config.url()
      if (!base) throw new Error('qBittorrent has no address')
      return send(base, currentSession(base), {
        method: 'POST',
        path,
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: Buffer.from(form.toString()),
      })
    },
  }
}

export function qbittorrentMiddleware(config: QbittorrentConfig): Middleware {
  return qbittorrentBridge(config).middleware
}
