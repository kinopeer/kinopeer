import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createServer, type RequestListener, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ServerSettings } from '../src/api/settings/types.ts'
import { SettingsStore, qbittorrentCredentials, settingsMiddleware, tmdbKey } from './settings.ts'

const servers: Server[] = []
let dir: string

async function listen(handler: RequestListener): Promise<string> {
  const server = createServer(handler)
  servers.push(server)
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'kinoseed-settings-'))
})

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => new Promise((resolve) => server.close(resolve))))
  await rm(dir, { recursive: true, force: true })
})

/** TMDB's /authentication: accepts "good-key" and the bearer token "eyJgood". */
async function fakeTmdb() {
  const seen: string[] = []
  const base = await listen((request, response) => {
    seen.push(request.url ?? '')
    const ok = request.url === '/3/authentication?api_key=good-key' || request.headers.authorization === 'Bearer eyJgood'
    response.statusCode = ok ? 200 : 401
    response.setHeader('Content-Type', 'application/json')
    response.end(JSON.stringify({ success: ok }))
  })
  return { apiBase: `${base}/3`, seen }
}

/** qBittorrent's login: accepts admin / "pass word", answers 403 (banned) to "banned". */
async function fakeQbittorrent() {
  let logins = 0
  const base = await listen(async (request, response) => {
    logins++
    const chunks: Buffer[] = []
    for await (const chunk of request as AsyncIterable<Buffer>) chunks.push(chunk)
    const params = new URLSearchParams(Buffer.concat(chunks).toString())
    if (params.get('username') === 'banned') {
      response.statusCode = 403
      return response.end('Forbidden')
    }
    if (params.get('username') !== 'admin' || params.get('password') !== 'pass word') {
      response.statusCode = 401
      return response.end('Unauthorized')
    }
    response.setHeader('Set-Cookie', 'SID=abc; HttpOnly')
    response.end('Ok.')
  })
  return { base, logins: () => logins }
}

async function kinoseed(
  store: SettingsStore,
  options: { envKey?: string; apiBase?: string; qbittorrentUrl?: string; envUser?: string } = {},
) {
  const middleware = settingsMiddleware({
    store,
    envTmdbApiKey: options.envKey,
    tmdbApiBase: options.apiBase,
    qbittorrentUrl: options.qbittorrentUrl,
    envQbittorrent: { username: options.envUser, password: 'adminadmin' },
  })
  return listen((request, response) =>
    middleware(request, response, () => {
      response.statusCode = 404
      response.end('fallback')
    }),
  )
}

function putKey(app: string, apiKey: unknown, contentType = 'application/json') {
  return fetch(`${app}/api/settings/tmdb`, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: JSON.stringify({ apiKey }),
  })
}

describe('SettingsStore', () => {
  it('starts empty, saves atomically to settings.json readable only by the server, and reads it back', async () => {
    const store = new SettingsStore(join(dir, 'nested'))
    expect(await store.load()).toEqual({})

    await store.update({ tmdbApiKey: 'abc' })

    const path = join(dir, 'nested', 'settings.json')
    expect(JSON.parse(await readFile(path, 'utf8'))).toEqual({ tmdbApiKey: 'abc' })
    expect((await stat(path)).mode & 0o777).toBe(0o600)
    expect(await new SettingsStore(join(dir, 'nested')).load()).toEqual({ tmdbApiKey: 'abc' })
  })

  it('treats a broken file as empty', async () => {
    await writeFile(join(dir, 'settings.json'), '{ not json')
    expect(await new SettingsStore(dir).load()).toEqual({})
  })
})

describe('tmdbKey', () => {
  it('prefers the saved key over the environment', async () => {
    const store = new SettingsStore(dir)
    await store.load()
    expect(tmdbKey(store, undefined)).toBeUndefined()
    expect(tmdbKey(store, ' env-key ')).toBe('env-key')
    await store.update({ tmdbApiKey: 'saved-key' })
    expect(tmdbKey(store, 'env-key')).toBe('saved-key')
  })
})

describe('qbittorrentCredentials', () => {
  it('prefers the saved login over the environment', async () => {
    const store = new SettingsStore(dir)
    await store.load()
    expect(qbittorrentCredentials(store, {})).toBeUndefined()
    expect(qbittorrentCredentials(store, { username: 'admin', password: 'adminadmin' })).toEqual({
      username: 'admin',
      password: 'adminadmin',
    })
    await store.update({ qbittorrentUsername: 'me', qbittorrentPassword: 'secret' })
    expect(qbittorrentCredentials(store, { username: 'admin', password: 'adminadmin' })).toEqual({
      username: 'me',
      password: 'secret',
    })
  })
})

function putLogin(app: string, body: unknown) {
  return fetch(`${app}/api/settings/qbittorrent`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
}

describe('settingsMiddleware: qBittorrent login', () => {
  it('logs in before saving the login, and never echoes it', async () => {
    const qbt = await fakeQbittorrent()
    const store = new SettingsStore(dir)
    const app = await kinoseed(store, { qbittorrentUrl: `${qbt.base}/`, envUser: 'admin' })
    expect(((await (await fetch(`${app}/api/settings`)).json()) as ServerSettings).qbittorrent).toEqual({ configured: true, source: 'env' })

    const response = await putLogin(app, { username: ' admin ', password: 'pass word' })

    expect(response.status).toBe(200)
    const text = await response.text()
    expect(JSON.parse(text).qbittorrent).toEqual({ configured: true, source: 'saved' })
    expect(text).not.toContain('pass word')
    expect(qbittorrentCredentials(store, undefined)).toEqual({ username: 'admin', password: 'pass word' })
  })

  it('says why qBittorrent refused, and saves nothing', async () => {
    const qbt = await fakeQbittorrent()
    const store = new SettingsStore(dir)
    const app = await kinoseed(store, { qbittorrentUrl: qbt.base })

    const wrong = await putLogin(app, { username: 'admin', password: 'nope' })
    expect(wrong.status).toBe(422)
    expect(await wrong.json()).toEqual({ error: 'invalid-credentials' })
    const banned = await putLogin(app, { username: 'banned', password: 'x' })
    expect(banned.status).toBe(429)
    expect(await banned.json()).toEqual({ error: 'banned' })
    expect(qbittorrentCredentials(store, undefined)).toBeUndefined()
  })

  it('needs a qBittorrent address and a username', async () => {
    const store = new SettingsStore(dir)
    expect((await putLogin(await kinoseed(store), { username: 'admin', password: '' })).status).toBe(503)
    const qbt = await fakeQbittorrent()
    const app = await kinoseed(store, { qbittorrentUrl: qbt.base })
    expect((await putLogin(app, { username: ' ', password: 'x' })).status).toBe(400)
    expect((await putLogin(app, { username: 'admin' })).status).toBe(400)
    expect(qbt.logins()).toBe(0)
  })

  it('says when qBittorrent is unreachable', async () => {
    const app = await kinoseed(new SettingsStore(dir), { qbittorrentUrl: 'http://127.0.0.1:1' })
    const response = await putLogin(app, { username: 'admin', password: 'x' })
    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ error: 'unreachable' })
  })
})

describe('settingsMiddleware', () => {
  it('reports where the TMDB key comes from, never the key', async () => {
    const store = new SettingsStore(dir)
    expect(await (await fetch(`${await kinoseed(store)}/api/settings`)).json()).toEqual({
      tmdb: { configured: false, source: null },
      qbittorrent: { configured: false, source: null },
    })

    const withEnv = await kinoseed(store, { envKey: 'env-key' })
    const response = await fetch(`${withEnv}/api/settings`)
    expect(response.headers.get('cache-control')).toBe('no-store')
    const text = await response.text()
    expect(JSON.parse(text)).toEqual({
      tmdb: { configured: true, source: 'env' },
      qbittorrent: { configured: false, source: null },
    })
    expect(text).not.toContain('env-key')
  })

  it('checks a new key with TMDB before saving it', async () => {
    const tmdb = await fakeTmdb()
    const store = new SettingsStore(dir)
    const app = await kinoseed(store, { envKey: 'env-key', apiBase: tmdb.apiBase })

    const response = await putKey(app, ' good-key ')

    expect(response.status).toBe(200)
    expect(((await response.json()) as ServerSettings).tmdb).toEqual({ configured: true, source: 'saved' })
    expect(tmdb.seen).toEqual(['/3/authentication?api_key=good-key'])
    expect(tmdbKey(store, 'env-key')).toBe('good-key')
  })

  it('accepts a v4 read access token', async () => {
    const tmdb = await fakeTmdb()
    const store = new SettingsStore(dir)
    const app = await kinoseed(store, { apiBase: tmdb.apiBase })

    expect((await putKey(app, 'eyJgood')).status).toBe(200)
    expect(tmdbKey(store, undefined)).toBe('eyJgood')
  })

  it('refuses a key TMDB rejects and keeps the old one', async () => {
    const tmdb = await fakeTmdb()
    const store = new SettingsStore(dir)
    await store.update({ tmdbApiKey: 'old-key' })
    const app = await kinoseed(store, { apiBase: tmdb.apiBase })

    const response = await putKey(app, 'wrong-key')

    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({ error: 'invalid-key' })
    expect(tmdbKey(store, undefined)).toBe('old-key')
  })

  it('says when TMDB is unreachable', async () => {
    const app = await kinoseed(new SettingsStore(dir), { apiBase: 'http://127.0.0.1:1/3' })
    const response = await putKey(app, 'good-key')
    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ error: 'unreachable' })
  })

  it('rejects malformed requests', async () => {
    const tmdb = await fakeTmdb()
    const app = await kinoseed(new SettingsStore(dir), { apiBase: tmdb.apiBase })

    expect((await putKey(app, '')).status).toBe(400)
    expect((await putKey(app, 42)).status).toBe(400)
    expect((await putKey(app, 'two words')).status).toBe(400)
    expect((await putKey(app, 'good-key', 'application/x-www-form-urlencoded')).status).toBe(415)
    expect((await fetch(`${app}/api/settings/tmdb`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{' })).status).toBe(400)
    expect((await fetch(`${app}/api/settings/other`)).status).toBe(404)
    expect(tmdb.seen).toEqual([])
  })

  it('leaves other paths alone', async () => {
    const app = await kinoseed(new SettingsStore(dir))
    expect(await (await fetch(`${app}/api/settingsx`)).text()).toBe('fallback')
    expect(await (await fetch(`${app}/settings`)).text()).toBe('fallback')
  })
})
