import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ServerSettings } from '../src/api/settings/types.ts'
import { SettingsStore, qbittorrentCredentials, settingsMiddleware, tmdbKey } from './settings.ts'
import { closeServers, fakeQbittorrent, fakeTmdb, serve } from './test/fakes.ts'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'kinoseed-settings-'))
})

afterEach(async () => {
  await closeServers()
  await rm(dir, { recursive: true, force: true })
})

/** Kinoseed's side: the middleware under test, with the environment a test wants. */
function kinoseed(
  store: SettingsStore,
  options: { envKey?: string; apiBase?: string; qbittorrentUrl?: string; envUser?: string } = {},
) {
  return serve(
    settingsMiddleware({
      store,
      envTmdbApiKey: options.envKey,
      tmdbApiBase: options.apiBase,
      qbittorrentUrl: options.qbittorrentUrl,
      envQbittorrent: { username: options.envUser, password: 'adminadmin' },
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
      downloads: null,
    })

    const withEnv = await kinoseed(store, { envKey: 'env-key' })
    const response = await fetch(`${withEnv}/api/settings`)
    expect(response.headers.get('cache-control')).toBe('no-store')
    const text = await response.text()
    expect(JSON.parse(text)).toEqual({
      tmdb: { configured: true, source: 'env' },
      qbittorrent: { configured: false, source: null },
      downloads: null,
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
    expect(tmdb.seen.map((request) => request.url)).toEqual(['/3/authentication?api_key=good-key'])
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
    expect(tmdb.seen.map((request) => request.url)).toEqual([])
  })

  it('leaves other paths alone', async () => {
    const app = await kinoseed(new SettingsStore(dir))
    expect(await (await fetch(`${app}/api/settingsx`)).text()).toBe('fallback')
    expect(await (await fetch(`${app}/settings`)).text()).toBe('fallback')
  })
})

function patchDownloads(app: string, body: unknown, contentType = 'application/json') {
  return fetch(`${app}/api/settings/downloads`, {
    method: 'PATCH',
    headers: { 'Content-Type': contentType },
    body: typeof body === 'string' ? body : JSON.stringify(body),
  })
}

describe('settingsMiddleware: download defaults', () => {
  it('saves only the defaults sent, so changes from two devices both stay', async () => {
    const store = new SettingsStore(dir)
    const app = await kinoseed(store)

    const first = await patchDownloads(app, { movieCategory: 'Movies', startPaused: true })
    expect(first.status).toBe(200)
    expect(((await first.json()) as ServerSettings).downloads).toEqual({ movieCategory: 'Movies', startPaused: true })

    await patchDownloads(app, { sequential: true, firstLastPieces: true, movieCategory: null })

    const settings = (await (await fetch(`${app}/api/settings`)).json()) as ServerSettings
    expect(settings.downloads).toEqual({ movieCategory: null, startPaused: true, sequential: true, firstLastPieces: true })
    expect(JSON.parse(await readFile(join(dir, 'settings.json'), 'utf8'))).toEqual({
      downloads: { movieCategory: null, startPaused: true, sequential: true, firstLastPieces: true },
    })
  })

  it('keeps the secrets next to them', async () => {
    const store = new SettingsStore(dir)
    await store.update({ tmdbApiKey: 'abc' })
    const app = await kinoseed(store)

    await patchDownloads(app, { tvCategory: 'TV Shows' })

    expect(tmdbKey(store, undefined)).toBe('abc')
    expect(store.current.downloads).toEqual({ tvCategory: 'TV Shows' })
  })

  it('rejects unknown fields, wrong types and other methods, and saves nothing', async () => {
    const store = new SettingsStore(dir)
    const app = await kinoseed(store)

    for (const body of [
      { theme: 'dark' },
      { startPaused: 'yes' },
      { sequential: null },
      { firstLastPieces: 'true' },
      { movieCategory: '' },
      { movieCategory: 42 },
      { tvCategory: 'x'.repeat(257) },
      ['startPaused'],
      null,
      '{',
    ]) {
      expect((await patchDownloads(app, body)).status).toBe(400)
    }
    expect((await patchDownloads(app, { startPaused: true }, 'text/plain')).status).toBe(415)
    expect((await fetch(`${app}/api/settings/downloads`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status).toBe(404)
    expect((await fetch(`${app}/api/settings/tmdb`, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status).toBe(404)
    expect(store.current).toEqual({})
  })

  it('says when the data directory is not writable', async () => {
    await writeFile(join(dir, 'file'), '')
    const app = await kinoseed(new SettingsStore(join(dir, 'file', 'nested')))
    const response = await patchDownloads(app, { startPaused: true })
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'storage' })
  })
})
