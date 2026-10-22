import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises'
import { createServer, type RequestListener, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { SettingsStore, settingsMiddleware, tmdbKey } from './settings.ts'

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

async function kinoseed(store: SettingsStore, options: { envKey?: string; apiBase?: string } = {}) {
  const middleware = settingsMiddleware({ store, envTmdbApiKey: options.envKey, tmdbApiBase: options.apiBase })
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

describe('settingsMiddleware', () => {
  it('reports where the TMDB key comes from, never the key', async () => {
    const store = new SettingsStore(dir)
    expect(await (await fetch(`${await kinoseed(store)}/api/settings`)).json()).toEqual({
      tmdb: { configured: false, source: null },
    })

    const withEnv = await kinoseed(store, { envKey: 'env-key' })
    const response = await fetch(`${withEnv}/api/settings`)
    expect(response.headers.get('cache-control')).toBe('no-store')
    const text = await response.text()
    expect(JSON.parse(text)).toEqual({ tmdb: { configured: true, source: 'env' } })
    expect(text).not.toContain('env-key')
  })

  it('checks a new key with TMDB before saving it', async () => {
    const tmdb = await fakeTmdb()
    const store = new SettingsStore(dir)
    const app = await kinoseed(store, { envKey: 'env-key', apiBase: tmdb.apiBase })

    const response = await putKey(app, ' good-key ')

    expect(response.status).toBe(200)
    expect(await response.json()).toEqual({ tmdb: { configured: true, source: 'saved' } })
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
    expect((await fetch(`${app}/api/settings/qbittorrent`)).status).toBe(404)
    expect(tmdb.seen).toEqual([])
  })

  it('leaves other paths alone', async () => {
    const app = await kinoseed(new SettingsStore(dir))
    expect(await (await fetch(`${app}/api/settingsx`)).text()).toBe('fallback')
    expect(await (await fetch(`${app}/settings`)).text()).toBe('fallback')
  })
})
