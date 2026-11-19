import { scryptSync } from 'node:crypto'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  AUTH_HEADER,
  AuthStore,
  MAX_SESSIONS,
  RENEW_EVERY_MS,
  SESSION_COOKIE,
  SESSION_MS,
  authMode,
  guarded,
  hashPassword,
  kinopeerAuth,
  verifyPassword,
  type AuthConfig,
  type StoredAuth,
} from './auth.ts'
import { FIRST_LOCK_MS, LoginThrottle } from './loginThrottle.ts'
import { closeServers, serve } from './test/fakes.ts'

let dir: string
let clock: number

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'kinopeer-auth-'))
  clock = Date.UTC(2026, 10, 19)
})

afterEach(async () => {
  await closeServers()
  await rm(dir, { recursive: true, force: true })
})

/** Kinopeer's side: the login in front of a route that answers 404 'fallback' when it's reached. */
function kinopeer(options: Partial<AuthConfig> = {}) {
  const store = options.store ?? new AuthStore(dir)
  const auth = kinopeerAuth({ mode: 'on', now: () => clock, ...options, store })
  return { store, auth, origin: serve(auth.middleware) }
}

function post(origin: string, path: string, body: unknown, cookie?: string, headers: Record<string, string> = {}) {
  return fetch(`${origin}/api/auth/${path}`, {
    method: path === 'password' ? 'PUT' : 'POST',
    headers: { 'Content-Type': 'application/json', ...(cookie && { Cookie: cookie }), ...headers },
    body: JSON.stringify(body),
  })
}

/** The session cookie a response set, as the browser sends it back. */
function cookieOf(response: Response): string {
  const header = response.headers.getSetCookie().find((value) => value.startsWith(`${SESSION_COOKIE}=`))
  if (!header) throw new Error('No session cookie')
  return header.split(';')[0]
}

const reached = async (origin: string, cookie?: string, path = '/qbt/api/v2/app/version') => {
  const response = await fetch(`${origin}${path}`, { headers: cookie ? { Cookie: cookie } : {} })
  return response.status === 404 && (await response.text()) === 'fallback'
}

/** A throttle that runs `onAttempt` once each try is counted, while its password is being checked. */
function watchingThrottle() {
  const watch = { onAttempt: () => {} }
  class Watching extends LoginThrottle {
    attempt(key: string) {
      super.attempt(key)
      watch.onAttempt()
    }
  }
  return { watch, throttle: new Watching(() => clock) }
}

describe('authMode', () => {
  it('is on unless KINOPEER_AUTH says off, and refuses anything else', () => {
    expect(authMode(undefined)).toBe('on')
    expect(authMode('')).toBe('on')
    expect(authMode('on')).toBe('on')
    expect(authMode(' Off ')).toBe('off')
    expect(() => authMode('false')).toThrow('KINOPEER_AUTH must be "on" or "off", not "false"')
  })
})

describe('hashPassword', () => {
  it('keeps a salted scrypt hash that only the same password matches', async () => {
    const stored = await hashPassword('correct horse')
    expect(stored).toMatch(/^scrypt\$32768\$8\$1\$[A-Za-z0-9+/=]{24}\$[A-Za-z0-9+/=]{44}$/)
    expect(stored).not.toContain('correct horse')
    expect(await hashPassword('correct horse')).not.toBe(stored)
    await expect(verifyPassword('correct horse', stored)).resolves.toBe(true)
    await expect(verifyPassword('correct hors', stored)).resolves.toBe(false)
  })

  it('takes a password in either Unicode form', async () => {
    const stored = await hashPassword('café au lait')
    await expect(verifyPassword('café au lait', stored)).resolves.toBe(true)
  })

  it('matches nothing against a hash it can’t read', async () => {
    await expect(verifyPassword('anything', '')).resolves.toBe(false)
    // Parameters scrypt refuses: an N that isn't a power of two, a cost past its memory limit.
    const salt = Buffer.alloc(16).toString('base64')
    const hash = Buffer.alloc(32).toString('base64')
    await expect(verifyPassword('anything', `scrypt$3$8$1$${salt}$${hash}`)).resolves.toBe(false)
    await expect(verifyPassword('anything', `scrypt$${2 ** 20}$8$1$${salt}$${hash}`)).resolves.toBe(false)
    await expect(verifyPassword('anything', 'bcrypt$x$y')).resolves.toBe(false)
    await expect(verifyPassword('anything', 'scrypt$32768$8$1$c2FsdA==$')).resolves.toBe(false)
    const stored = await hashPassword('anything')
    await expect(verifyPassword('anything', stored.replace(/^scrypt/, 'bcrypt'))).resolves.toBe(false)
    // Cut short, or made without a salt: not a hash this server made.
    await expect(verifyPassword('anything', stored.slice(0, -8))).resolves.toBe(false)
    const unsalted = scryptSync('anything', '', 32, { N: 2 ** 15, r: 8, p: 1, maxmem: 64 * 1024 * 1024 }).toString('base64')
    await expect(verifyPassword('anything', `scrypt$32768$8$1$$${unsalted}`)).resolves.toBe(false)
  })
})

describe('guarded', () => {
  it('takes every route of the server and none of the app’s files', () => {
    for (const path of ['/qbt/api/v2/app/version', '/prowlarr/search?q=x', '/tmdb/movie/1', '/tmdb-img/w342/a.jpg', '/api/settings', '/api/matches', '/api', '/qbt']) {
      expect(guarded(path), path).toBe(true)
    }
    for (const path of ['/', '/settings', '/torrent/abc', '/assets/index.js', '/sw.js', '/version.json', '/healthz', '/apical', '/tmdbx/1', undefined]) {
      expect(guarded(path), String(path)).toBe(false)
    }
  })

  it('takes a route however its path is written', () => {
    for (const path of ['/a/../qbt/api/v2/app/version', '/./api/settings', '//host/api/matches', '/QBT/api', '/%2e%2e/prowlarr/status', '/Api/Settings']) {
      expect(guarded(path), path).toBe(true)
    }
  })
})

describe('the login', () => {
  it('holds every route back until a password is set, then signs in whoever sets it', async () => {
    const { store, origin } = kinopeer()
    const app = await origin
    const before = await fetch(`${app}/api/settings`)
    expect(before.status).toBe(401)
    expect(before.headers.get(AUTH_HEADER)).toBe('set-up')
    expect(before.headers.get('cache-control')).toBe('no-store')
    expect(await before.json()).toEqual({ error: 'set-up' })
    // Nothing is written until there's something to keep.
    await expect(readFile(join(dir, 'auth.json'), 'utf8')).rejects.toThrow()
    // The app's files and anything else the server doesn't own go on.
    expect(await reached(app, undefined, '/settings')).toBe(true)

    const response = await post(app, 'setup', { password: 'correct horse' })
    expect(response.status).toBe(204)
    const [header] = response.headers.getSetCookie()
    expect(header).toMatch(new RegExp(`^${SESSION_COOKIE}=[A-Za-z0-9_-]{43}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000$`))
    expect(await reached(app, cookieOf(response))).toBe(true)

    const signedOut = await fetch(`${app}/qbt/api/v2/app/version`)
    expect(signedOut.status).toBe(401)
    expect(signedOut.headers.get(AUTH_HEADER)).toBe('sign-in')

    // Neither the password nor the token is in the file.
    const file = await readFile(join(dir, 'auth.json'), 'utf8')
    expect(file).not.toContain('correct horse')
    expect(file).not.toContain(cookieOf(response).split('=')[1])
    expect(store.current).toMatchObject({ source: 'saved', sessions: [{ expiresAt: clock + SESSION_MS }] })
  })

  it('takes the first password only, and none shorter than 8 characters', async () => {
    const { origin } = kinopeer()
    const app = await origin
    expect(await (await post(app, 'setup', { password: 'short' })).json()).toEqual({ error: 'too-short' })
    expect((await post(app, 'setup', { password: '' })).status).toBe(400)
    expect((await post(app, 'setup', { password: 12345678 })).status).toBe(400)
    expect((await post(app, 'setup', { password: 'x'.repeat(257) })).status).toBe(400)
    for (const body of ['null', '"correct horse"', '1']) {
      expect((await fetch(`${app}/api/auth/setup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })).status, body).toBe(400)
    }

    // Two browsers at once: one sets it, the other is told.
    const answers = await Promise.all([post(app, 'setup', { password: 'first one!' }), post(app, 'setup', { password: 'second one' })])
    expect(answers.map((answer) => answer.status).sort()).toEqual([204, 409])
    const refused = answers.find((answer) => answer.status === 409)!
    expect(refused.headers.getSetCookie()).toEqual([])
    expect(await refused.json()).toEqual({ error: 'already-set' })
    const winner = answers[0].status === 204 ? 'first one!' : 'second one'
    expect((await post(app, 'login', { password: winner })).status).toBe(204)
  })

  it('signs in with the password and refuses a wrong one', async () => {
    const { origin } = kinopeer()
    const app = await origin
    expect(await (await post(app, 'login', { password: 'correct horse' })).json()).toEqual({ error: 'not-set-up' })
    await post(app, 'setup', { password: 'correct horse' })

    const wrong = await post(app, 'login', { password: 'wrong horse' })
    expect(wrong.status).toBe(422)
    expect(wrong.headers.getSetCookie()).toEqual([])
    expect(wrong.headers.get('retry-after')).toBeNull()
    expect(await wrong.json()).toEqual({ error: 'invalid-password' })

    const right = await post(app, 'login', { password: 'correct horse' })
    expect(right.status).toBe(204)
    expect(await reached(app, cookieOf(right))).toBe(true)
    expect(await reached(app, `${SESSION_COOKIE}=made-up`)).toBe(false)
  })

  it('takes passwords of 8 to 256 characters, and refuses what isn’t one before counting it', async () => {
    const { origin } = kinopeer()
    const app = await origin
    const cookie = cookieOf(await post(app, 'setup', { password: '8 chars!' }))
    expect((await post(app, 'password', { current: '8 chars!', password: 'y'.repeat(256) }, cookie)).status).toBe(204)
    expect((await post(app, 'password', { current: 'y'.repeat(256), password: '8 chars?' }, cookie)).status).toBe(204)
    for (const body of [{ password: '' }, { password: 12345678 }, {}]) {
      expect(await (await post(app, 'login', body)).json()).toEqual({ error: 'bad-request' })
    }
    expect(await (await post(app, 'password', { password: 'battery staple' }, cookie)).json()).toEqual({ error: 'bad-request' })
    // None of them counted as a wrong password: five more are still allowed.
    for (let i = 0; i < 4; i++) expect((await post(app, 'login', { password: `wrong ${i}` })).status).toBe(422)
    expect((await post(app, 'login', { password: '8 chars?' })).status).toBe(204)
  })

  it('finds its cookie among the browser’s others', async () => {
    const { origin } = kinopeer()
    const app = await origin
    const token = cookieOf(await post(app, 'setup', { password: 'correct horse' })).split('=')[1]
    expect(await reached(app, `theme=dark; ${SESSION_COOKIE}=${token} ; other=1`)).toBe(true)
    expect(await reached(app, `theme=${token}; ${SESSION_COOKIE}=made-up`)).toBe(false)
    expect(await reached(app, `x${SESSION_COOKIE}=${token}`)).toBe(false)
  })

  it('makes the cookie Secure when a proxy in front says the browser came over HTTPS', async () => {
    const { origin } = kinopeer()
    const app = await origin
    const response = await post(app, 'setup', { password: 'correct horse' }, undefined, { 'X-Forwarded-Proto': 'HTTPS , http' })
    expect(response.headers.getSetCookie()[0]).toMatch(/; Secure$/)
  })

  it('throttles wrong passwords: five, then a wait, longer each time', async () => {
    const { store, origin } = kinopeer()
    const app = await origin
    await post(app, 'setup', { password: 'correct horse' })
    for (let i = 0; i < 4; i++) expect((await post(app, 'login', { password: `wrong ${i}` })).status).toBe(422)
    const fifth = await post(app, 'login', { password: 'wrong 4' })
    expect(await fifth.json()).toEqual({ error: 'invalid-password', retryAfterMs: FIRST_LOCK_MS })

    // Even the right password waits.
    const held = await post(app, 'login', { password: 'correct horse' })
    expect(held.status).toBe(429)
    expect(held.headers.get('retry-after')).toBe(String(FIRST_LOCK_MS / 1000))
    expect(await held.json()).toEqual({ error: 'throttled', retryAfterMs: FIRST_LOCK_MS })
    expect(held.headers.getSetCookie()).toEqual([])
    // And starts no session: once the writes queued before it are done, only the first is kept.
    await store.change((current) => current)
    expect(store.current.sessions).toHaveLength(1)

    clock += FIRST_LOCK_MS
    expect((await post(app, 'login', { password: 'correct horse' })).status).toBe(204)
  })

  it('starts the count afresh after the right password', async () => {
    const { origin } = kinopeer()
    const app = await origin
    await post(app, 'setup', { password: 'correct horse' })
    for (let i = 0; i < 4; i++) await post(app, 'login', { password: `wrong ${i}` })
    const cookie = cookieOf(await post(app, 'login', { password: 'correct horse' }))
    for (let i = 0; i < 4; i++) await post(app, 'login', { password: `wrong ${i}` })
    expect((await post(app, 'login', { password: 'correct horse' })).status).toBe(204)
    // A change of the password with the right current one, too.
    for (let i = 0; i < 4; i++) await post(app, 'password', { current: `wrong ${i}`, password: 'battery staple' }, cookie)
    expect((await post(app, 'password', { current: 'correct horse', password: 'battery staple' }, cookie)).status).toBe(204)
    expect((await post(app, 'login', { password: 'battery staple' })).status).toBe(204)
  })

  it('counts tries sent at once before answering any', async () => {
    const { origin } = kinopeer()
    const app = await origin
    await post(app, 'setup', { password: 'correct horse' })
    const answers = await Promise.all(Array.from({ length: 8 }, (_, i) => post(app, 'login', { password: `wrong ${i}` })))
    expect(answers.map((answer) => answer.status).sort()).toEqual([422, 422, 422, 422, 422, 429, 429, 429])
  })

  it('signs out this browser only', async () => {
    const { origin } = kinopeer()
    const app = await origin
    const first = cookieOf(await post(app, 'setup', { password: 'correct horse' }))
    const second = cookieOf(await post(app, 'login', { password: 'correct horse' }))

    // The app sends no body to sign out, only the JSON content type.
    const response = await fetch(`${app}/api/auth/logout`, { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: first } })
    expect(response.status).toBe(204)
    expect(response.headers.getSetCookie()).toEqual([`${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0`])
    expect(await reached(app, first)).toBe(false)
    expect(await reached(app, second)).toBe(true)
    // Without a session there's nothing to end, and nothing fails.
    expect((await post(app, 'logout', {})).status).toBe(204)
    // The last one ends too.
    await post(app, 'logout', {}, second)
    expect(await reached(app, second)).toBe(false)
  })

  it('starts no session for the old password when it changes while that one is checked, and keeps the try counted', async () => {
    const { watch, throttle } = watchingThrottle()
    const { store, origin } = kinopeer({ throttle })
    const app = await origin
    await post(app, 'setup', { password: 'correct horse' })
    for (let i = 0; i < 3; i++) await post(app, 'login', { password: `wrong ${i}` })
    const changed = await hashPassword('battery staple')
    // As another browser's change of the password lands while this sign-in's hash is computed.
    watch.onAttempt = () => void store.change((current) => ({ ...current, password: changed, sessions: [] }))

    const late = await post(app, 'login', { password: 'correct horse' })
    watch.onAttempt = () => {}
    expect(late.status).toBe(422)
    expect(late.headers.getSetCookie()).toEqual([])
    expect(await late.json()).toEqual({ error: 'invalid-password' })
    expect(store.current.sessions).toEqual([])
    // Three wrong, the late one, and this: five, so the address waits.
    expect(await (await post(app, 'login', { password: 'wrong again' })).json()).toEqual({ error: 'invalid-password', retryAfterMs: FIRST_LOCK_MS })
  })

  it.each([
    ['replaced the password it matched', 422, { error: 'invalid-password' }, (current: StoredAuth, changed: string) => ({ ...current, password: changed })],
    ['signed this browser out', 401, { error: 'sign-in' }, (current: StoredAuth, changed: string) => ({ ...current, password: changed, sessions: [] })],
    // Its session ended some other way (signed out in another tab), the password as it was.
    ['left the password but ended this browser’s session', 401, { error: 'sign-in' }, (current: StoredAuth) => ({ ...current, sessions: [] })],
  ] as const)('changes nothing when another change %s while this one was checked', async (_, status, answer, other) => {
    const { watch, throttle } = watchingThrottle()
    const { store, origin } = kinopeer({ throttle })
    const app = await origin
    const cookie = cookieOf(await post(app, 'setup', { password: 'correct horse' }))
    const changed = await hashPassword('battery staple')
    const left = other(store.current, changed).password
    watch.onAttempt = () => void store.change((current) => other(current, changed))

    const late = await post(app, 'password', { current: 'correct horse', password: 'other password' }, cookie)
    watch.onAttempt = () => {}
    expect(late.status).toBe(status)
    expect(await late.json()).toEqual(answer)
    expect(store.current.password).toBe(left)
  })

  it('takes one of two changes sent at once, and signs the other browser out', async () => {
    const { origin } = kinopeer()
    const app = await origin
    const first = cookieOf(await post(app, 'setup', { password: 'correct horse' }))
    const second = cookieOf(await post(app, 'login', { password: 'correct horse' }))
    const answers = await Promise.all([
      post(app, 'password', { current: 'correct horse', password: 'first browser' }, first),
      post(app, 'password', { current: 'correct horse', password: 'second browser' }, second),
    ])
    expect(answers.map((answer) => answer.status).sort()).toEqual([204, 401])
    const won = answers[0].status === 204 ? { password: 'first browser', cookie: first } : { password: 'second browser', cookie: second }
    expect(await reached(app, won.cookie)).toBe(true)
    expect((await post(app, 'login', { password: won.password })).status).toBe(204)
  })

  it('changes the password for a signed-in browser and signs every other one out', async () => {
    const { origin } = kinopeer()
    const app = await origin
    const mine = cookieOf(await post(app, 'setup', { password: 'correct horse' }))
    const other = cookieOf(await post(app, 'login', { password: 'correct horse' }))

    const signedOut = await post(app, 'password', { current: 'correct horse', password: 'battery staple' })
    expect(signedOut.status).toBe(401)
    expect(signedOut.headers.get(AUTH_HEADER)).toBe('sign-in')
    expect(await (await post(app, 'password', { current: 'wrong horse', password: 'battery staple' }, mine)).json()).toEqual({
      error: 'invalid-password',
    })
    expect(await (await post(app, 'password', { current: 'correct horse', password: 'short' }, mine)).json()).toEqual({ error: 'too-short' })
    expect((await post(app, 'password', { current: 'correct horse' }, mine)).status).toBe(400)

    expect((await post(app, 'password', { current: 'correct horse', password: 'battery staple' }, mine)).status).toBe(204)
    expect(await reached(app, mine)).toBe(true)
    expect(await reached(app, other)).toBe(false)
    expect((await post(app, 'login', { password: 'correct horse' })).status).toBe(422)
    expect((await post(app, 'login', { password: 'battery staple' })).status).toBe(204)
  })

  it('keeps a session for 30 days from its last use, and over a restart', async () => {
    const first = kinopeer()
    const cookie = cookieOf(await post(await first.origin, 'setup', { password: 'correct horse' }))

    // Used now and then: moved on once a day at most, with its cookie.
    const hours23 = 23 * 60 * 60_000
    clock += hours23
    expect((await fetch(`${await first.origin}/api/settings`, { headers: { Cookie: cookie } })).headers.getSetCookie()).toEqual([])
    clock += RENEW_EVERY_MS - 1 - hours23
    const early = await fetch(`${await first.origin}/api/settings`, { headers: { Cookie: cookie } })
    expect(early.headers.getSetCookie()).toEqual([])
    clock += 1
    // Never on the TMDB bridges' answers, which pass on TMDB's caching, so a shared cache may keep them.
    for (const path of ['/tmdb-img/w342/poster.jpg', '/tmdb/movie/1', '/TMDB-IMG/w342/poster.jpg']) {
      const bridged = await fetch(`${await first.origin}${path}`, { headers: { Cookie: cookie } })
      expect(bridged.headers.getSetCookie(), path).toEqual([])
    }
    const due = await fetch(`${await first.origin}/qbt/api/v2/app/version`, { headers: { Cookie: cookie } })
    expect(due.headers.getSetCookie()[0]).toMatch(new RegExp(`^${cookie}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000$`))
    const renewedUntil = clock + SESSION_MS
    await expect.poll(() => first.store.current.sessions?.[0].expiresAt).toBe(renewedUntil)

    // Another server on the same data directory, as after a restart.
    const restarted = kinopeer({ store: new AuthStore(dir) })
    clock = renewedUntil - SESSION_MS + 1
    expect(await reached(await restarted.origin, cookie)).toBe(true)
    // Unused for 30 days: over, on the server's own routes too.
    clock = renewedUntil
    expect(await reached(await restarted.origin, cookie)).toBe(false)
    expect((await fetch(`${await restarted.origin}/api/settings`, { headers: { Cookie: cookie } })).headers.get(AUTH_HEADER)).toBe('sign-in')
  })

  it('keeps a session used only through qBittorrent’s poll, as a tab left open on Downloads', async () => {
    const { store, origin } = kinopeer()
    const app = await origin
    const cookie = cookieOf(await post(app, 'setup', { password: 'correct horse' }))
    for (let day = 0; day < 40; day++) {
      clock += RENEW_EVERY_MS
      expect(await reached(app, cookie), `day ${day}`).toBe(true)
    }
    expect(await reached(app, cookie, '/prowlarr/search')).toBe(true)
    // The renewals' writes, which no answer waits for, are done before the directory goes.
    await store.change((current) => current)
  })

  it('moves a session on with any answer but TMDB’s, changing the password’s too', async () => {
    const { origin } = kinopeer()
    const app = await origin
    const cookie = cookieOf(await post(app, 'setup', { password: 'correct horse' }))
    clock += RENEW_EVERY_MS
    const changed = await post(app, 'password', { current: 'correct horse', password: 'battery staple' }, cookie)
    expect(changed.status).toBe(204)
    expect(changed.headers.getSetCookie()[0]).toMatch(new RegExp(`^${cookie}; Path=/;.*Max-Age=2592000$`))
  })

  it('moves on only the session in use', async () => {
    const { store, origin } = kinopeer()
    const app = await origin
    const started = clock
    const used = cookieOf(await post(app, 'setup', { password: 'correct horse' }))
    await post(app, 'login', { password: 'correct horse' })
    clock += RENEW_EVERY_MS
    await fetch(`${app}/api/settings`, { headers: { Cookie: used } })
    await expect
      .poll(() => store.current.sessions?.map((session) => session.expiresAt).sort())
      .toEqual([started + SESSION_MS, clock + SESSION_MS])
  })

  it(`keeps the ${MAX_SESSIONS} sessions that last longest`, async () => {
    const { store, origin } = kinopeer()
    const app = await origin
    const oldest = cookieOf(await post(app, 'setup', { password: 'correct horse' }))
    clock += 1
    await store.change((current) => ({
      ...current,
      sessions: [
        ...current.sessions!,
        ...Array.from({ length: MAX_SESSIONS - 1 }, (_, i) => ({ id: `id-${i}`, expiresAt: clock + SESSION_MS, renewedAt: clock })),
      ],
    }))
    await post(app, 'login', { password: 'correct horse' })
    expect(store.current.sessions).toHaveLength(MAX_SESSIONS)
    expect(await reached(app, oldest)).toBe(false)
  })

  it('answers only JSON requests to its routes, and 404 for a route it doesn’t have', async () => {
    const { origin } = kinopeer()
    const app = await origin
    const form = await fetch(`${app}/api/auth/setup`, { method: 'POST', body: new URLSearchParams({ password: 'correct horse' }) })
    expect(form.status).toBe(415)
    expect((await fetch(`${app}/api/auth/setup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '[' })).status).toBe(400)
    expect((await fetch(`${app}/api/auth/setup`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '[]' })).status).toBe(400)
    // A body it can't read is refused before anything else, a session's check included.
    await post(app, 'setup', { password: 'correct horse' })
    for (const body of ['[', '"x"']) {
      const response = await fetch(`${app}/api/auth/password`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body })
      expect(response.status, body).toBe(400)
    }
    expect((await fetch(`${app}/api/auth/login`)).status).toBe(404)
    expect((await fetch(`${app}/api/auth`)).status).toBe(404)
    // Each route takes its own method only.
    for (const [method, path] of [['PUT', 'setup'], ['PUT', 'login'], ['PUT', 'logout'], ['POST', 'password'], ['POST', 'other'], ['PUT', 'other']]) {
      const response = await fetch(`${app}/api/auth/${path}`, { method, headers: { 'Content-Type': 'application/json' }, body: '{}' })
      expect(response.status, `${method} ${path}`).toBe(404)
    }
  })

  it('says it can’t keep anything when the data directory isn’t writable', async () => {
    await writeFile(join(dir, 'file'), '')
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { origin } = kinopeer({ store: new AuthStore(join(dir, 'file', 'data')) })
    const response = await post(await origin, 'setup', { password: 'correct horse' })
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'storage' })
    expect(warn).toHaveBeenCalledWith('[kinopeer] could not read or write auth.json; is the data directory writable?')
  })

  it('says it can’t keep a new password when auth.json can’t be written, though it can be read', async () => {
    // A directory where JsonFile writes the file before moving it in place.
    await mkdir(join(dir, `auth.json.${process.pid}.tmp`))
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { origin } = kinopeer()
    const response = await post(await origin, 'setup', { password: 'correct horse' })
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'storage' })
    expect(warn).toHaveBeenCalledWith('[kinopeer] could not write auth.json; is the data directory writable?')
  })
})

describe('a login it can’t read', () => {
  it.each([
    ['broken', () => writeFile(join(dir, 'auth.json'), '{ "password": "scrypt$')],
    ['unreadable', () => mkdir(join(dir, 'auth.json'))],
  ])('holds everything back when auth.json is %s, rather than asking for a new password', async (_, spoil) => {
    await spoil()
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const { origin } = kinopeer()
    const app = await origin
    for (const response of [await fetch(`${app}/api/settings`), await post(app, 'setup', { password: 'correct horse' })]) {
      expect(response.status).toBe(500)
      expect(response.headers.get(AUTH_HEADER)).toBeNull()
      expect(await response.json()).toEqual({ error: 'storage' })
    }
    expect(warn).toHaveBeenCalledWith('[kinopeer] could not read or write auth.json; is the data directory writable?')
  })
})

describe('the login with KINOPEER_PASSWORD', () => {
  it('says it can’t keep the password when the data directory isn’t writable, and tries again on the next request', async () => {
    await writeFile(join(dir, 'file'), '')
    const { origin } = kinopeer({ store: new AuthStore(join(dir, 'file', 'data')), envPassword: 'from the environment' })
    const app = await origin
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {})
    const response = await fetch(`${app}/api/settings`)
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'storage' })
    expect(warn).toHaveBeenCalledWith('[kinopeer] could not read or write auth.json; is the data directory writable?')

    await rm(join(dir, 'file'))
    expect((await fetch(`${app}/api/settings`)).headers.get(AUTH_HEADER)).toBe('sign-in')
  })

  it('takes over a password set in the app even when it’s the same, signing everyone out', async () => {
    const saved = kinopeer()
    const cookie = cookieOf(await post(await saved.origin, 'setup', { password: 'same password' }))
    const env = kinopeer({ store: new AuthStore(dir), envPassword: 'same password' })
    expect(await reached(await env.origin, cookie)).toBe(false)
    expect(env.auth.status()).toEqual({ enabled: true, source: 'env' })
  })

  it('signs in with that password, which nobody can set or change in the app', async () => {
    const { origin, auth } = kinopeer({ envPassword: 'from the environment' })
    const app = await origin
    expect((await fetch(`${app}/api/settings`)).headers.get(AUTH_HEADER)).toBe('sign-in')
    expect(auth.status()).toEqual({ enabled: true, source: 'env' })
    expect(await (await post(app, 'setup', { password: 'correct horse' })).json()).toEqual({ error: 'already-set' })

    const cookie = cookieOf(await post(app, 'login', { password: 'from the environment' }))
    expect(await (await post(app, 'password', { current: 'from the environment', password: 'correct horse' }, cookie)).json()).toEqual({
      error: 'env-password',
    })
  })

  it('ends every session when the variable changes, and keeps them while it doesn’t', async () => {
    const before = kinopeer({ envPassword: 'first password' })
    const cookie = cookieOf(await post(await before.origin, 'login', { password: 'first password' }))

    const same = kinopeer({ store: new AuthStore(dir), envPassword: 'first password' })
    expect(await reached(await same.origin, cookie)).toBe(true)

    const changed = kinopeer({ store: new AuthStore(dir), envPassword: 'second password' })
    expect(await reached(await changed.origin, cookie)).toBe(false)
    expect((await post(await changed.origin, 'login', { password: 'first password' })).status).toBe(422)
    expect((await post(await changed.origin, 'login', { password: 'second password' })).status).toBe(204)
  })

  it('takes over a password set in the app, and leaves it to the app once the variable goes', async () => {
    const saved = kinopeer()
    await post(await saved.origin, 'setup', { password: 'set in the app' })

    const env = kinopeer({ store: new AuthStore(dir), envPassword: 'from the environment' })
    expect((await post(await env.origin, 'login', { password: 'set in the app' })).status).toBe(422)

    const after = kinopeer({ store: new AuthStore(dir) })
    const cookie = cookieOf(await post(await after.origin, 'login', { password: 'from the environment' }))
    expect(after.auth.status()).toEqual({ enabled: true, source: 'saved' })
    expect((await post(await after.origin, 'password', { current: 'from the environment', password: 'set in the app' }, cookie)).status).toBe(204)
  })
})

describe('the login off', () => {
  it('lets every request through and has no routes of its own', async () => {
    const { origin, auth } = kinopeer({ mode: 'off' })
    const app = await origin
    expect(await reached(app)).toBe(true)
    expect(await reached(app, undefined, '/api/settings')).toBe(true)
    expect(await (await post(app, 'setup', { password: 'correct horse' })).json()).toEqual({ error: 'auth-off' })
    expect(auth.status()).toEqual({ enabled: false })
  })

  it('neither reads nor writes auth.json, so a data directory it can’t use holds nothing back, its own routes included', async () => {
    await writeFile(join(dir, 'file'), '')
    const { origin } = kinopeer({ mode: 'off', store: new AuthStore(join(dir, 'file', 'data')), envPassword: 'from the environment' })
    const app = await origin
    expect(await reached(app)).toBe(true)
    const login = await post(app, 'login', { password: 'from the environment' })
    expect(login.status).toBe(409)
    expect(await login.json()).toEqual({ error: 'auth-off' })
  })
})

describe('LoginThrottle', () => {
  it('is shared by the routes of one server, so changing the password counts too', async () => {
    const throttle = new LoginThrottle(() => clock)
    const { origin } = kinopeer({ throttle })
    const app = await origin
    const cookie = cookieOf(await post(app, 'setup', { password: 'correct horse' }))
    for (let i = 0; i < 5; i++) await post(app, 'password', { current: `wrong ${i}`, password: 'battery staple' }, cookie)
    expect((await post(app, 'login', { password: 'correct horse' })).status).toBe(429)
  })
})
