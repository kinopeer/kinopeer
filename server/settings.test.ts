import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { ServerSettings } from '../src/api/settings/types.ts'
import { SettingsStore, prowlarrKey, qbittorrentCredentials, settingsMiddleware, tmdbKey } from './settings.ts'
import { abandon, closeServers, fakeProwlarr, fakeQbittorrent, fakeTmdb, serve, settlesWithin, silentService } from './test/fakes.ts'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'kinopeer-settings-'))
})

afterEach(async () => {
  await closeServers()
  await rm(dir, { recursive: true, force: true })
})

/** Kinopeer's side: the middleware under test, with the environment a test wants. */
function kinopeer(
  store: SettingsStore,
  options: { envKey?: string; apiBase?: string; timeoutMs?: number; proxy?: string; qbittorrentUrl?: string; envUser?: string } = {},
) {
  return serve(
    settingsMiddleware({
      store,
      envTmdbApiKey: options.envKey,
      tmdbApiBase: options.apiBase,
      tmdbTimeoutMs: options.timeoutMs,
      tmdbProxy: options.proxy,
      qbittorrentUrl: options.qbittorrentUrl,
      envQbittorrent: { username: options.envUser, password: 'adminadmin' },
    }),
  )
}

/** The PUT a browser sends to save `body` in Settings. */
function saving(body: unknown, contentType = 'application/json'): RequestInit {
  return { method: 'PUT', headers: { 'Content-Type': contentType }, body: JSON.stringify(body) }
}

function putKey(app: string, apiKey: unknown, contentType = 'application/json') {
  return fetch(`${app}/api/settings/tmdb`, saving({ apiKey }, contentType))
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
  return fetch(`${app}/api/settings/qbittorrent`, saving(body))
}

describe('settingsMiddleware: qBittorrent login', () => {
  it('logs in before saving the login, and never echoes it', async () => {
    const qbt = await fakeQbittorrent()
    const store = new SettingsStore(dir)
    const app = await kinopeer(store, { qbittorrentUrl: `${qbt.base}/`, envUser: 'admin' })
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
    const app = await kinopeer(store, { qbittorrentUrl: qbt.base })

    const wrong = await putLogin(app, { username: 'admin', password: 'nope' })
    expect(wrong.status).toBe(422)
    expect(await wrong.json()).toEqual({ error: 'invalid-credentials' })
    const banned = await putLogin(app, { username: 'banned', password: 'x' })
    expect(banned.status).toBe(429)
    expect(await banned.json()).toEqual({ error: 'banned' })
    expect(qbittorrentCredentials(store, undefined)).toBeUndefined()
  })

  it('gives up the login with qBittorrent when the browser gives up on saving it', async () => {
    const qbittorrent = await silentService()
    const app = await kinopeer(new SettingsStore(dir), { qbittorrentUrl: qbittorrent.base })

    await abandon(`${app}/api/settings/qbittorrent`, qbittorrent.received, saving({ username: 'admin', password: 'x' }))

    expect(await settlesWithin(qbittorrent.closed, 1000)).toBe(true)
  })

  it('needs a qBittorrent address and a username', async () => {
    const store = new SettingsStore(dir)
    expect((await putLogin(await kinopeer(store), { username: 'admin', password: '' })).status).toBe(503)
    const qbt = await fakeQbittorrent()
    const app = await kinopeer(store, { qbittorrentUrl: qbt.base })
    expect((await putLogin(app, { username: ' ', password: 'x' })).status).toBe(400)
    expect((await putLogin(app, { username: 'admin' })).status).toBe(400)
    expect(qbt.logins()).toBe(0)
  })

  it('says when qBittorrent is unreachable', async () => {
    const app = await kinopeer(new SettingsStore(dir), { qbittorrentUrl: 'http://127.0.0.1:1' })
    const response = await putLogin(app, { username: 'admin', password: 'x' })
    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ error: 'unreachable' })
  })
})

describe('settingsMiddleware', () => {
  it('reports where the TMDB key comes from, never the key', async () => {
    const store = new SettingsStore(dir)
    expect(await (await fetch(`${await kinopeer(store)}/api/settings`)).json()).toEqual({
      tmdb: { configured: false, source: null, fallback: null },
      prowlarr: { configured: false, source: null, serverKey: false },
      qbittorrent: { configured: false, source: null },
      downloads: null,
    })

    const withEnv = await kinopeer(store, { envKey: 'env-key' })
    const response = await fetch(`${withEnv}/api/settings`)
    expect(response.headers.get('cache-control')).toBe('no-store')
    const text = await response.text()
    expect(JSON.parse(text)).toEqual({
      tmdb: { configured: true, source: 'env', fallback: 'env' },
      prowlarr: { configured: false, source: null, serverKey: false },
      qbittorrent: { configured: false, source: null },
      downloads: null,
    })
    expect(text).not.toContain('env-key')
  })

  it('reports Kinopeer’s key while the server has none of its own and a proxy to use', async () => {
    const store = new SettingsStore(dir)
    const app = await kinopeer(store, { proxy: 'https://proxy.test/3' })
    const tmdbStatus = async (url: string) => ((await (await fetch(`${url}/api/settings`)).json()) as { tmdb: unknown }).tmdb

    expect(await tmdbStatus(app)).toEqual({ configured: true, source: 'shared', fallback: 'shared' })
    // A blank key in a hand-edited settings.json isn't used (tmdbKey), so it isn't reported either.
    await store.update({ tmdbApiKey: '  ' })
    expect(await tmdbStatus(app)).toEqual({ configured: true, source: 'shared', fallback: 'shared' })
    expect(await tmdbStatus(await kinopeer(store, { proxy: 'https://proxy.test/3', envKey: 'env-key' }))).toEqual({
      configured: true,
      source: 'env',
      fallback: 'env',
    })
    await store.update({ tmdbApiKey: 'saved-key' })
    expect(await tmdbStatus(app)).toEqual({ configured: true, source: 'saved', fallback: 'shared' })
  })

  describe('forgetting the saved TMDB key', () => {
    const forget = (app: string) =>
      fetch(`${app}/api/settings/tmdb`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' } })

    it.each([
      ['Kinopeer’s key', { proxy: 'https://proxy.test/3' }, { configured: true, source: 'shared', fallback: 'shared' }],
      ['TMDB_API_KEY, even with the proxy on', { proxy: 'https://proxy.test/3', envKey: 'env-key' }, { configured: true, source: 'env', fallback: 'env' }],
    ] as const)('goes back to %s', async (_name, options, expected) => {
      const store = new SettingsStore(dir)
      await store.update({ tmdbApiKey: 'saved-key', prowlarrApiKey: 'prowlarr-key' })
      const app = await kinopeer(store, options)

      const response = await forget(app)

      expect(response.status).toBe(200)
      expect(((await response.json()) as ServerSettings).tmdb).toEqual(expected)
      expect(store.current).toEqual({ prowlarrApiKey: 'prowlarr-key' })
      expect(JSON.parse(await readFile(join(dir, 'settings.json'), 'utf8'))).toEqual({ prowlarrApiKey: 'prowlarr-key' })
    })

    it('keeps the saved key when nothing else would serve TMDB', async () => {
      const store = new SettingsStore(dir)
      await store.update({ tmdbApiKey: 'saved-key' })
      // A blank TMDB_API_KEY and the proxy turned off (TMDB_PROXY_URL set empty) are no fallback.
      const app = await kinopeer(store, { envKey: '  ', proxy: '' })
      expect((((await (await fetch(`${app}/api/settings`)).json()) as ServerSettings).tmdb)).toEqual({
        configured: true,
        source: 'saved',
        fallback: null,
      })

      const response = await forget(app)

      expect(response.status).toBe(409)
      expect(await response.json()).toEqual({ error: 'no-server-key' })
      expect(tmdbKey(store, undefined)).toBe('saved-key')
    })

    it('forgets the key only on a request marked as JSON', async () => {
      const store = new SettingsStore(dir)
      await store.update({ tmdbApiKey: 'saved-key' })
      const app = await kinopeer(store, { envKey: 'env-key' })

      expect((await fetch(`${app}/api/settings/tmdb`, { method: 'DELETE' })).status).toBe(415)
      expect(tmdbKey(store, 'env-key')).toBe('saved-key')
    })
  })

  it('checks a new key with TMDB before saving it', async () => {
    const tmdb = await fakeTmdb()
    const store = new SettingsStore(dir)
    const app = await kinopeer(store, { envKey: 'env-key', apiBase: tmdb.apiBase })

    const response = await putKey(app, ' good-key ')

    expect(response.status).toBe(200)
    expect(((await response.json()) as ServerSettings).tmdb).toEqual({ configured: true, source: 'saved', fallback: 'env' })
    expect(tmdb.seen.map((request) => request.url)).toEqual(['/3/authentication?api_key=good-key'])
    expect(tmdbKey(store, 'env-key')).toBe('good-key')
  })

  it('accepts a v4 read access token', async () => {
    const tmdb = await fakeTmdb()
    const store = new SettingsStore(dir)
    const app = await kinopeer(store, { apiBase: tmdb.apiBase })

    expect((await putKey(app, 'eyJgood')).status).toBe(200)
    expect(tmdbKey(store, undefined)).toBe('eyJgood')
  })

  it('refuses a key TMDB rejects and keeps the old one', async () => {
    const tmdb = await fakeTmdb()
    const store = new SettingsStore(dir)
    await store.update({ tmdbApiKey: 'old-key' })
    const app = await kinopeer(store, { apiBase: tmdb.apiBase })

    const response = await putKey(app, 'wrong-key')

    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({ error: 'invalid-key' })
    expect(tmdbKey(store, undefined)).toBe('old-key')
  })

  it('says when TMDB is unreachable', async () => {
    const app = await kinopeer(new SettingsStore(dir), { apiBase: 'http://127.0.0.1:1/3' })
    const response = await putKey(app, 'good-key')
    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ error: 'unreachable' })
  })

  it('gives up checking the key with TMDB when the browser gives up on saving it', async () => {
    const tmdb = await silentService()
    const app = await kinopeer(new SettingsStore(dir), { apiBase: `${tmdb.base}/3` })

    await abandon(`${app}/api/settings/tmdb`, tmdb.received, saving({ apiKey: 'good-key' }))

    expect(await settlesWithin(tmdb.closed, 1000)).toBe(true)
  })

  it('says TMDB is unreachable when it doesn’t answer the key check in time, and gives the check up', async () => {
    const tmdb = await silentService()
    const app = await kinopeer(new SettingsStore(dir), { apiBase: `${tmdb.base}/3`, timeoutMs: 50 })

    const response = await putKey(app, 'good-key')

    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ error: 'unreachable' })
    expect(await settlesWithin(tmdb.closed, 1000)).toBe(true)
  })

  it('rejects malformed requests', async () => {
    const tmdb = await fakeTmdb()
    const app = await kinopeer(new SettingsStore(dir), { apiBase: tmdb.apiBase })

    expect((await putKey(app, '')).status).toBe(400)
    expect((await putKey(app, 42)).status).toBe(400)
    expect((await putKey(app, 'two words')).status).toBe(400)
    expect((await putKey(app, 'good-key', 'application/x-www-form-urlencoded')).status).toBe(415)
    expect((await fetch(`${app}/api/settings/tmdb`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: '{' })).status).toBe(400)
    expect((await fetch(`${app}/api/settings/other`)).status).toBe(404)
    expect(tmdb.seen.map((request) => request.url)).toEqual([])
  })

  it('leaves other paths alone', async () => {
    const app = await kinopeer(new SettingsStore(dir))
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
    const app = await kinopeer(store)

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
    const app = await kinopeer(store)

    await patchDownloads(app, { tvCategory: 'TV Shows' })

    expect(tmdbKey(store, undefined)).toBe('abc')
    expect(store.current.downloads).toEqual({ tvCategory: 'TV Shows' })
  })

  it('rejects unknown fields, wrong types and other methods, and saves nothing', async () => {
    const store = new SettingsStore(dir)
    const app = await kinopeer(store)

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
    const app = await kinopeer(new SettingsStore(join(dir, 'file', 'nested')))
    const response = await patchDownloads(app, { startPaused: true })
    expect(response.status).toBe(500)
    expect(await response.json()).toEqual({ error: 'storage' })
  })
})

describe('prowlarrKey', () => {
  it('takes the saved key, else the variable, else the one in config.xml', async () => {
    const store = new SettingsStore(dir)
    await store.load()
    const configXml = join(dir, 'config.xml')
    await writeFile(configXml, '<Config><ApiKey>file-key</ApiKey></Config>')

    expect(await prowlarrKey(store, undefined, undefined)).toBeUndefined()
    expect(await prowlarrKey(store, undefined, join(dir, 'missing.xml'))).toBeUndefined()
    expect(await prowlarrKey(store, undefined, configXml)).toBe('file-key')
    expect(await prowlarrKey(store, ' env-key ', configXml)).toBe('env-key')
    await store.update({ prowlarrApiKey: 'saved-key' })
    expect(await prowlarrKey(store, 'env-key', configXml)).toBe('saved-key')
  })
})

describe('settingsMiddleware: Prowlarr key', () => {
  function app(store: SettingsStore, options: { url?: string; envKey?: string; configXml?: string } = {}) {
    return serve(
      settingsMiddleware({
        store,
        prowlarrUrl: options.url,
        envProwlarrApiKey: options.envKey,
        prowlarrConfigXml: options.configXml,
      }),
    )
  }

  function put(base: string, apiKey: unknown) {
    return fetch(`${base}/api/settings/prowlarr`, saving({ apiKey }))
  }

  function forget(base: string) {
    return fetch(`${base}/api/settings/prowlarr`, { method: 'DELETE', headers: { 'Content-Type': 'application/json' } })
  }

  it('gives up checking the key with Prowlarr when the browser gives up on saving it', async () => {
    const prowlarr = await silentService()
    const base = await app(new SettingsStore(dir), { url: prowlarr.base })

    await abandon(`${base}/api/settings/prowlarr`, prowlarr.received, saving({ apiKey: 'key' }))

    expect(await settlesWithin(prowlarr.closed, 1000)).toBe(true)
  })

  async function prowlarrStatus(base: string) {
    return ((await (await fetch(`${base}/api/settings`)).json()) as ServerSettings).prowlarr
  }

  it("reports a key from the variable or Prowlarr's config.xml as the server's, never the key", async () => {
    const store = new SettingsStore(dir)
    const configXml = join(dir, 'config.xml')
    await writeFile(configXml, '<Config><ApiKey>file-key</ApiKey></Config>')

    expect(await prowlarrStatus(await app(store, { configXml: join(dir, 'missing.xml') }))).toEqual({ configured: false, source: null, serverKey: false })
    expect(await prowlarrStatus(await app(store, { envKey: 'env-key' }))).toEqual({ configured: true, source: 'env', serverKey: true })
    const withFile = await app(store, { configXml })
    expect(await prowlarrStatus(withFile)).toEqual({ configured: true, source: 'env', serverKey: true })
    expect(await (await fetch(`${withFile}/api/settings`)).text()).not.toContain('file-key')
  })

  it('checks a new key with Prowlarr before saving it', async () => {
    const prowlarr = await fakeProwlarr({ apiKey: 'good-key' })
    const store = new SettingsStore(dir)
    const base = await app(store, { url: `${prowlarr.base}/`, envKey: 'env-key' })

    const response = await put(base, ' good-key ')

    expect(response.status).toBe(200)
    expect(((await response.json()) as ServerSettings).prowlarr).toEqual({ configured: true, source: 'saved', serverKey: true })
    expect(prowlarr.seen.map((request) => request.url)).toEqual(['/api/v1/system/status'])
    expect(await prowlarrKey(store, 'env-key', undefined)).toBe('good-key')
  })

  it('refuses a key Prowlarr rejects and keeps the old one', async () => {
    const prowlarr = await fakeProwlarr({ apiKey: 'good-key' })
    const store = new SettingsStore(dir)
    await store.update({ prowlarrApiKey: 'old-key' })
    const base = await app(store, { url: prowlarr.base })

    const response = await put(base, 'wrong-key')

    expect(response.status).toBe(422)
    expect(await response.json()).toEqual({ error: 'invalid-key' })
    expect(await prowlarrKey(store, undefined, undefined)).toBe('old-key')
  })

  it('says when Prowlarr is unreachable or not set up', async () => {
    const unreachable = await put(await app(new SettingsStore(dir), { url: 'http://127.0.0.1:1' }), 'good-key')
    expect(unreachable.status).toBe(502)
    expect(await unreachable.json()).toEqual({ error: 'unreachable' })

    const noUrl = await put(await app(new SettingsStore(dir)), 'good-key')
    expect(noUrl.status).toBe(503)
    expect(await noUrl.json()).toEqual({ error: 'not-configured' })
  })

  it('forgets a saved key, so the one in config.xml applies again', async () => {
    const store = new SettingsStore(dir)
    await store.update({ prowlarrApiKey: 'saved-key' })
    const configXml = join(dir, 'config.xml')
    await writeFile(configXml, '<Config><ApiKey>file-key</ApiKey></Config>')
    const base = await app(store, { configXml })

    const response = await forget(base)

    expect(response.status).toBe(200)
    expect(((await response.json()) as ServerSettings).prowlarr).toEqual({ configured: true, source: 'env', serverKey: true })
    expect(await prowlarrKey(store, undefined, configXml)).toBe('file-key')
  })

  it('keeps a saved key when the server has none of its own to fall back on', async () => {
    const store = new SettingsStore(dir)
    await store.update({ prowlarrApiKey: 'saved-key' })
    const base = await app(store, { configXml: join(dir, 'missing.xml') })
    expect(await prowlarrStatus(base)).toEqual({ configured: true, source: 'saved', serverKey: false })

    const response = await forget(base)

    expect(response.status).toBe(409)
    expect(await response.json()).toEqual({ error: 'no-server-key' })
    expect(await prowlarrKey(store, undefined, undefined)).toBe('saved-key')
  })

  it('forgets a key only on a request marked as JSON', async () => {
    const store = new SettingsStore(dir)
    await store.update({ prowlarrApiKey: 'saved-key' })
    const base = await app(store, { envKey: 'env-key' })

    expect((await fetch(`${base}/api/settings/prowlarr`, { method: 'DELETE' })).status).toBe(415)
    expect(await prowlarrKey(store, 'env-key', undefined)).toBe('saved-key')
  })

  it("doesn't save a key when the address answers but isn't Prowlarr", async () => {
    // A proxy's login page or an app's index.html answers 200 to any path and any key.
    const notProwlarr = await serve((_request, response) => {
      response.setHeader('Content-Type', 'text/html')
      response.end('<!doctype html><title>Sign in</title>')
    })
    const store = new SettingsStore(dir)
    const base = await app(store, { url: notProwlarr })

    const response = await put(base, 'any-key')

    expect(response.status).toBe(502)
    expect(await response.json()).toEqual({ error: 'not-prowlarr' })
    expect(store.current.prowlarrApiKey).toBeUndefined()
  })

  it('rejects malformed keys without asking Prowlarr', async () => {
    const prowlarr = await fakeProwlarr()
    const base = await app(new SettingsStore(dir), { url: prowlarr.base })

    expect((await put(base, '')).status).toBe(400)
    expect((await put(base, 42)).status).toBe(400)
    expect((await put(base, 'two words')).status).toBe(400)
    expect(prowlarr.seen).toEqual([])
  })
})
