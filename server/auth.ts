import { createHash, randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { AuthErrorBody, AuthStatus, ChangePasswordBody, PasswordBody, SignInNeed } from '../src/api/auth/types.ts'
import { isJsonRequest, readJson, sendJson } from './json.ts'
import { JsonFile } from './jsonFile.ts'
import { LoginThrottle, clientKey } from './loginThrottle.ts'
import type { Middleware } from './prowlarr.ts'

/**
 * Kinopeer's own login, for installs without a login in front (beyond Umbrel, whose app_proxy has
 * one: there the package sets KINOPEER_AUTH=off). Until someone signs in, the server answers only
 * the app's files (server/static.ts), /healthz and the routes below; every route that reaches
 * qBittorrent, Prowlarr, TMDB or the saved settings answers 401 with `AUTH_HEADER` saying whether
 * to sign in or to set the password first, which the client turns into its screens
 * (src/api/fetchKinopeer.ts).
 *
 * The password is KINOPEER_PASSWORD when that's set, else the one the first visitor sets. It's kept
 * only as a scrypt hash, in auth.json in the data directory, beside the sessions, which are kept
 * by a hash of their token too, so a copy of the file signs no one in. A session lasts
 * `SESSION_MS` from its last use and survives a restart; a changed password ends every other one.
 *
 * POST /api/auth/setup { password } → sets the first password and signs in; 409 once one is set
 * POST /api/auth/login { password } → signs in; 422 for a wrong password, 429 while throttled
 * POST /api/auth/logout → ends this browser's session
 * PUT /api/auth/password { current, password } → changes the password, signed in only; 409 when
 *   KINOPEER_PASSWORD sets it
 *
 * Each takes a JSON body (a DELETE-like logout too, with the header), which a page on another site
 * can't send without a CORS preflight, and the cookie is SameSite=Strict besides.
 */

/** Whether the login is on: KINOPEER_AUTH, `on` by default. */
export type AuthMode = 'on' | 'off'

/** KINOPEER_AUTH's value; anything but `on`, `off` or nothing stops the server, so a typo never opens it. */
export function authMode(value: string | undefined): AuthMode {
  const mode = value?.trim().toLowerCase() || 'on'
  if (mode === 'on' || mode === 'off') return mode
  throw new Error(`KINOPEER_AUTH must be "on" or "off", not "${value}"`)
}

export interface StoredSession {
  /** SHA-256 of the cookie's token, hex. */
  id: string
  expiresAt: number
  /** When `expiresAt` was last moved on, so a session in use is written at most once a day. */
  renewedAt: number
}

export interface StoredAuth {
  /** `scrypt$N$r$p$salt$hash`, salt and hash in base64. */
  password?: string
  /** Where the password came from: KINOPEER_PASSWORD, or set in the app. */
  source?: 'env' | 'saved'
  sessions?: StoredSession[]
}

export class AuthStore extends JsonFile<StoredAuth> {
  constructor(dir: string) {
    super(dir, 'auth.json')
  }
}

/** The cookie that carries a session. */
export const SESSION_COOKIE = 'kinopeer_session'
/** The header on a 401 that names what the browser needs: `SignInNeed`. */
export const AUTH_HEADER = 'X-Kinopeer-Auth'
/** A session lasts this long from its last use. */
export const SESSION_MS = 30 * 24 * 60 * 60_000
/** A session in use is moved on at most this often, so it isn't written with every request. */
export const RENEW_EVERY_MS = 24 * 60 * 60_000
/** Sessions kept at most: past it, the one that would end soonest goes. */
export const MAX_SESSIONS = 100
export const MIN_PASSWORD_LENGTH = 8
export const MAX_PASSWORD_LENGTH = 256

/**
 * scrypt's cost: 32 MiB and about 50–100 ms a hash on a home server, so a copy of auth.json is slow
 * to guess at, while a sign-in waits no longer than a request does. `maxmem` above Node's 32 MiB
 * default, which this cost would just exceed.
 */
const SCRYPT: Required<Pick<ScryptOptions, 'N' | 'r' | 'p'>> = { N: 2 ** 15, r: 8, p: 1 }
const SCRYPT_MAXMEM = 64 * 1024 * 1024
const KEY_LENGTH = 32

function derive(password: string, salt: Buffer, options: typeof SCRYPT): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password.normalize('NFC'), salt, KEY_LENGTH, { ...options, maxmem: SCRYPT_MAXMEM }, (error, key) =>
      error ? reject(error) : resolve(key),
    ),
  )
}

/** A new salted scrypt hash of `password`, as auth.json keeps it. */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16)
  const hash = await derive(password, salt, SCRYPT)
  return ['scrypt', SCRYPT.N, SCRYPT.r, SCRYPT.p, salt.toString('base64'), hash.toString('base64')].join('$')
}

/** Whether `password` is the one `stored` was made from; false for a hash it can't read. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, N, r, p, salt, hash] = stored.split('$')
  if (scheme !== 'scrypt' || !salt || !hash) return false
  const expected = Buffer.from(hash, 'base64')
  const actual = await derive(password, Buffer.from(salt, 'base64'), { N: Number(N), r: Number(r), p: Number(p) })
  return actual.length === expected.length && timingSafeEqual(actual, expected)
}

const sessionId = (token: string) => createHash('sha256').update(token).digest('hex')

/** The session cookie's token from the request, if it has one. */
function tokenOf(request: IncomingMessage): string | undefined {
  for (const pair of (request.headers.cookie ?? '').split(';')) {
    const index = pair.indexOf('=')
    if (index > 0 && pair.slice(0, index).trim() === SESSION_COOKIE) return pair.slice(index + 1).trim() || undefined
  }
  return undefined
}

/**
 * Whether the browser reached Kinopeer over HTTPS, which only a reverse proxy in front can say:
 * Kinopeer serves plain HTTP itself. Such a cookie is Secure, so it never goes out over plain HTTP.
 * A request that claims HTTPS falsely only keeps its own cookie from being sent back.
 */
function overHttps(request: IncomingMessage): boolean {
  const forwarded = request.headers['x-forwarded-proto']
  const proto = (Array.isArray(forwarded) ? forwarded[0] : forwarded)?.split(',')[0].trim().toLowerCase()
  return proto === 'https'
}

function sessionCookie(request: IncomingMessage, token: string, maxAgeMs: number): string {
  const attributes = [`${SESSION_COOKIE}=${token}`, 'Path=/', 'HttpOnly', 'SameSite=Strict', `Max-Age=${Math.floor(maxAgeMs / 1000)}`]
  if (overHttps(request)) attributes.push('Secure')
  return attributes.join('; ')
}


export interface AuthConfig {
  store: AuthStore
  mode: AuthMode
  /** KINOPEER_PASSWORD: the password, which the app can't change then. */
  envPassword?: string
  /** Overridable for tests. */
  now?: () => number
  throttle?: LoginThrottle
}

/** What a request can do with the login on: everything with a session, else what it needs first. */
type Access = { allowed: true; session: StoredSession } | { allowed: false; need: SignInNeed }

const PREFIX = '/api/auth'
/** Every route but these and the app's files needs a session (`guarded`). */
const GUARDED_PREFIXES = ['/api', '/qbt', '/prowlarr', '/tmdb', '/tmdb-img']
const MAX_BODY_BYTES = 4 * 1024

/**
 * Whether a path belongs to the server's routes rather than the app's files: as written and as
 * `new URL` reads it, since some routes match one and some the other (`//x/api`, `/a/../qbt`).
 */
export function guarded(url: string | undefined): boolean {
  const written = (url ?? '/').split('?')[0]
  let parsed = written
  try {
    parsed = new URL(url ?? '/', 'http://kinopeer.local').pathname
  } catch {
    // Not a URL Node's own routes could read either; the written path decides.
  }
  return [written, parsed].some((path) => {
    const lower = path.toLowerCase()
    return GUARDED_PREFIXES.some((prefix) => lower === prefix || lower.startsWith(`${prefix}/`))
  })
}

function fail(response: ServerResponse, status: number, error: AuthErrorBody['error'], retryAfterMs?: number): void {
  if (retryAfterMs !== undefined) response.setHeader('Retry-After', String(Math.ceil(retryAfterMs / 1000)))
  // JSON leaves out a retryAfterMs that's undefined.
  sendJson(response, status, { error, retryAfterMs } satisfies AuthErrorBody)
}

function needSignIn(response: ServerResponse, need: SignInNeed): void {
  response.setHeader(AUTH_HEADER, need)
  sendJson(response, 401, { error: need } satisfies AuthErrorBody)
}

export interface Auth {
  /** The routes above and the check in front of every other server route; goes first after the headers. */
  middleware: Middleware
  /** What GET /api/settings says about the login. */
  status: () => AuthStatus
}

export function kinopeerAuth(config: AuthConfig): Auth {
  const { store, mode } = config
  const now = config.now ?? Date.now
  const throttle = config.throttle ?? new LoginThrottle(now)
  const envPassword = config.envPassword || undefined
  let preparing: Promise<void> | undefined

  /**
   * Loads auth.json and, when KINOPEER_PASSWORD is set, makes it the password: a new one replaces
   * the hash and ends every session, since a password changed in the environment is most likely a
   * leaked one. Once per server; a failure is tried again on the next request.
   */
  const ready = () =>
    (preparing ??= (async () => {
      const stored = await store.load()
      if (envPassword === undefined) {
        // KINOPEER_PASSWORD taken away: its password stays, now one the app can change.
        if (stored.source === 'env') await store.change((current) => ({ ...current, source: 'saved' }))
        return
      }
      if (stored.source === 'env' && stored.password && (await verifyPassword(envPassword, stored.password))) return
      const password = await hashPassword(envPassword)
      await store.change(() => ({ password, source: 'env', sessions: [] }))
    })().catch((error: unknown) => {
      preparing = undefined
      throw error
    }))

  const live = (sessions: StoredSession[] | undefined) => (sessions ?? []).filter((session) => session.expiresAt > now())

  /** The request's session, moved on when it's due, with its cookie. */
  const sessionOf = (request: IncomingMessage, response: ServerResponse): StoredSession | undefined => {
    const token = tokenOf(request)
    if (!token) return undefined
    const id = sessionId(token)
    const session = live(store.current.sessions).find((candidate) => candidate.id === id)
    if (!session) return undefined
    if (now() - session.renewedAt >= RENEW_EVERY_MS) {
      const renewed = { ...session, expiresAt: now() + SESSION_MS, renewedAt: now() }
      response.setHeader('Set-Cookie', sessionCookie(request, token, SESSION_MS))
      // Not waited for: a failed write leaves the session as it was, still valid.
      store
        .change((current) => ({ ...current, sessions: (current.sessions ?? []).map((s) => (s.id === id ? renewed : s)) }))
        .catch(() => {})
      return renewed
    }
    return session
  }

  const access = (request: IncomingMessage, response: ServerResponse): Access => {
    if (!store.current.password) return { allowed: false, need: 'set-up' }
    const session = sessionOf(request, response)
    return session ? { allowed: true, session } : { allowed: false, need: 'sign-in' }
  }

  /**
   * Starts a session for the browser with what `change` makes of the stored state, and sets its
   * cookie; `change` returning undefined starts none. Says whether it started one.
   */
  const startSession = async (
    request: IncomingMessage,
    response: ServerResponse,
    change: (current: StoredAuth) => StoredAuth | undefined,
  ): Promise<boolean> => {
    const token = randomBytes(32).toString('base64url')
    const session: StoredSession = { id: sessionId(token), expiresAt: now() + SESSION_MS, renewedAt: now() }
    let started = false
    await store.change((current) => {
      const next = change(current)
      if (!next) return current
      started = true
      const sessions = [...live(next.sessions), session].sort((a, b) => b.expiresAt - a.expiresAt).slice(0, MAX_SESSIONS)
      return { ...next, sessions }
    })
    if (started) response.setHeader('Set-Cookie', sessionCookie(request, token, SESSION_MS))
    return started
  }

  /** A body's password, or undefined when it isn't one this server could take. */
  const readPassword = (value: unknown): string | undefined =>
    typeof value === 'string' && value.length > 0 && value.length <= MAX_PASSWORD_LENGTH ? value : undefined

  /**
   * Checks `password` against the stored one, counted by the throttle; answers and returns false
   * when it's refused.
   */
  const checkPassword = async (request: IncomingMessage, response: ServerResponse, password: string) => {
    const key = clientKey(request.socket.remoteAddress)
    const wait = throttle.retryAfter(key)
    if (wait > 0) {
      fail(response, 429, 'throttled', wait)
      return false
    }
    throttle.attempt(key)
    if (await verifyPassword(password, store.current.password ?? '')) {
      throttle.succeeded(key)
      return true
    }
    const next = throttle.retryAfter(key)
    fail(response, 422, 'invalid-password', next > 0 ? next : undefined)
    return false
  }

  const setUp = async (request: IncomingMessage, response: ServerResponse, body: Partial<PasswordBody>) => {
    const password = readPassword(body.password)
    if (password === undefined) return fail(response, 400, 'bad-request')
    if (password.length < MIN_PASSWORD_LENGTH) return fail(response, 400, 'too-short')
    if (store.current.password) return fail(response, 409, 'already-set')
    const hash = await hashPassword(password)
    // Someone else may have set one while this was hashing: theirs stands.
    const set = await startSession(request, response, (current) =>
      current.password ? undefined : { password: hash, source: 'saved', sessions: [] },
    )
    if (!set) return fail(response, 409, 'already-set')
    response.statusCode = 204
    response.end()
  }

  const signIn = async (request: IncomingMessage, response: ServerResponse, body: Partial<PasswordBody>) => {
    const password = readPassword(body.password)
    if (password === undefined) return fail(response, 400, 'bad-request')
    if (!store.current.password) return fail(response, 409, 'not-set-up')
    if (!(await checkPassword(request, response, password))) return
    await startSession(request, response, (current) => current)
    response.statusCode = 204
    response.end()
  }

  const signOut = async (request: IncomingMessage, response: ServerResponse) => {
    const token = tokenOf(request)
    if (token) {
      const id = sessionId(token)
      await store.change((current) => ({ ...current, sessions: (current.sessions ?? []).filter((session) => session.id !== id) }))
    }
    response.setHeader('Set-Cookie', sessionCookie(request, '', 0))
    response.statusCode = 204
    response.end()
  }

  const changePassword = async (request: IncomingMessage, response: ServerResponse, body: Partial<ChangePasswordBody>) => {
    const checked = access(request, response)
    if (!checked.allowed) return needSignIn(response, checked.need)
    const current = readPassword(body.current)
    const password = readPassword(body.password)
    if (current === undefined || password === undefined) return fail(response, 400, 'bad-request')
    if (store.current.source === 'env') return fail(response, 409, 'env-password')
    if (password.length < MIN_PASSWORD_LENGTH) return fail(response, 400, 'too-short')
    if (!(await checkPassword(request, response, current))) return
    const hash = await hashPassword(password)
    const id = checked.session.id
    // This browser stays signed in; every other session ends.
    await store.change((stored) => ({
      ...stored,
      password: hash,
      source: 'saved',
      sessions: live(stored.sessions).filter((session) => session.id === id),
    }))
    response.statusCode = 204
    response.end()
  }

  const route = (request: IncomingMessage, response: ServerResponse, path: string) => {
    const handler =
      path === `${PREFIX}/setup` && request.method === 'POST'
        ? setUp
        : path === `${PREFIX}/login` && request.method === 'POST'
          ? signIn
          : path === `${PREFIX}/logout` && request.method === 'POST'
            ? signOut
            : path === `${PREFIX}/password` && request.method === 'PUT'
              ? changePassword
              : undefined
    if (!handler) return fail(response, 404, 'not-found')
    if (mode === 'off') return fail(response, 409, 'auth-off')
    if (!isJsonRequest(request)) return fail(response, 415, 'bad-request')
    const run = async () => {
      let body: unknown = {}
      if (handler !== signOut) {
        try {
          body = await readJson(request, MAX_BODY_BYTES)
        } catch {
          return fail(response, 400, 'bad-request')
        }
        if (!body || typeof body !== 'object' || Array.isArray(body)) return fail(response, 400, 'bad-request')
      }
      await handler(request, response, body as Record<string, unknown>)
    }
    run().catch(() => {
      if (!response.headersSent) {
        console.warn('[kinopeer] could not write auth.json; is the data directory writable?')
        fail(response, 500, 'storage')
      }
    })
  }

  const middleware: Middleware = (request, response, next) => {
    const path = new URL(request.url ?? '/', 'http://kinopeer.local').pathname
    const own = path === PREFIX || path.startsWith(`${PREFIX}/`)
    if (!own && (mode === 'off' || !guarded(request.url))) return next()
    ready().then(
      () => {
        if (own) return route(request, response, path)
        const checked = access(request, response)
        if (checked.allowed) return next()
        needSignIn(response, checked.need)
      },
      () => {
        console.warn('[kinopeer] could not read or write auth.json; is the data directory writable?')
        fail(response, 500, 'storage')
      },
    )
  }

  return {
    middleware,
    status: () =>
      mode === 'off'
        ? { enabled: false }
        : { enabled: true, source: store.current.source === 'env' ? 'env' : 'saved' },
  }
}
