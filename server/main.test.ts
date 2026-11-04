import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { TMDB_PROXY, TMDB_PROXY_EDGE, createApp, dataStores, kinoseedServer, missingSettings, tmdbProxy } from './main.ts'
import { SettingsStore } from './settings.ts'
import { closeServers, fakeTmdb } from './test/fakes.ts'

let root: string
let server: Server
let app: string

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'kinoseed-main-'))
  await writeFile(join(root, 'index.html'), '<!doctype html><title>Kinoseed</title>')
  // The proxy off, so nothing here calls the real one.
  server = createApp(root, kinoseedServer({ TMDB_PROXY_URL: '' }, dataStores(join(root, 'data'))))
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
  app = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  await new Promise((resolve) => server.close(resolve))
  await rm(root, { recursive: true, force: true })
})

describe('createApp', () => {
  it('answers the health check', async () => {
    const response = await fetch(`${app}/healthz`)
    expect(response.status).toBe(200)
    expect(await response.text()).toBe('ok')
  })

  it('routes the bridges before the app, and says what is not configured', async () => {
    expect((await fetch(`${app}/qbt/api/v2/app/version`)).status).toBe(503)
    expect(await (await fetch(`${app}/prowlarr/status`)).json()).toEqual({ error: 'not-configured' })
    expect((await fetch(`${app}/tmdb/movie/771`)).status).toBe(401)
    expect(await (await fetch(`${app}/api/settings`)).json()).toEqual({
      tmdb: { configured: false, source: null },
      prowlarr: { configured: false, source: null, serverKey: false },
      qbittorrent: { configured: false, source: null },
      downloads: null,
    })
    expect(await (await fetch(`${app}/api/matches`)).json()).toEqual({})
  })

  it('serves the app for its routes and 404 for missing files', async () => {
    expect(await (await fetch(`${app}/settings`)).text()).toContain('Kinoseed')
    expect((await fetch(`${app}/assets/missing.js`)).status).toBe(404)
    expect((await fetch(`${app}/settings`, { method: 'POST' })).status).toBe(404)
  })
})

describe('missingSettings', () => {
  const services = { QBITTORRENT_URL: 'http://qbt', PROWLARR_URL: 'http://prowlarr', PROWLARR_API_KEY: 'p' }

  it('names no TMDB key while the proxy serves the calls without one', async () => {
    const settings = new SettingsStore(join(root, 'missing-proxy'))

    expect(missingSettings(services, settings)).toEqual([])
  })

  it('names the TMDB key with the proxy off and no key', async () => {
    const settings = new SettingsStore(join(root, 'missing-off'))

    expect(missingSettings({ ...services, TMDB_PROXY_URL: '' }, settings)).toEqual(['TMDB key (enter it in the app)'])
    expect(missingSettings({ ...services, TMDB_PROXY_URL: '', TMDB_API_KEY: 'env-key' }, settings)).toEqual([])
    await settings.update({ tmdbApiKey: 'saved-key' })
    expect(missingSettings({ ...services, TMDB_PROXY_URL: '' }, settings)).toEqual([])
  })

  it('names the services and the Prowlarr key that aren’t set', () => {
    const settings = new SettingsStore(join(root, 'missing-services'))

    expect(missingSettings({ TMDB_PROXY_URL: '' }, settings)).toEqual([
      'QBITTORRENT_URL',
      'PROWLARR_URL',
      'PROWLARR_API_KEY',
      'TMDB key (enter it in the app)',
    ])
    expect(missingSettings({ ...services, PROWLARR_API_KEY: undefined, PROWLARR_CONFIG_XML: '/config.xml' }, settings)).toEqual([])
  })
})

describe('tmdbProxy', () => {
  it('is the released versions’ worker by default', () => {
    expect(TMDB_PROXY).toBe('https://kinoseed-tmdb.kinoseed.workers.dev/3')
    expect(tmdbProxy({})).toBe(TMDB_PROXY)
  })

  it('is the edge worker the Edge workflow bakes into edge images', async () => {
    const workflow = await readFile(new URL('../.github/workflows/edge.yml', import.meta.url), 'utf8')

    expect(TMDB_PROXY_EDGE).toBe('https://kinoseed-tmdb-edge.kinoseed.workers.dev/3')
    expect(workflow).toContain(`KINOSEED_TMDB_PROXY=${TMDB_PROXY_EDGE}\n`)
  })

  it('is the one an edge build bakes in, KINOSEED_TMDB_PROXY', () => {
    expect(tmdbProxy({ KINOSEED_TMDB_PROXY: 'https://kinoseed-tmdb-edge.kinoseed.workers.dev/3' })).toBe(
      'https://kinoseed-tmdb-edge.kinoseed.workers.dev/3',
    )
    // A release build passes the build argument empty.
    expect(tmdbProxy({ KINOSEED_TMDB_PROXY: '' })).toBe(TMDB_PROXY)
    expect(tmdbProxy({ KINOSEED_TMDB_PROXY: ' ' })).toBe(TMDB_PROXY)
  })

  it('takes TMDB_PROXY_URL over both, and none when it’s empty', () => {
    const env = { KINOSEED_TMDB_PROXY: 'https://edge.test/3' }
    expect(tmdbProxy({ ...env, TMDB_PROXY_URL: 'https://own.test/3/' })).toBe('https://own.test/3')
    expect(tmdbProxy({ ...env, TMDB_PROXY_URL: '' })).toBeUndefined()
    expect(tmdbProxy({ ...env, TMDB_PROXY_URL: ' ' })).toBeUndefined()
  })
})

describe('kinoseedServer', () => {
  it('sends TMDB calls without a key to the proxy, and says Kinoseed’s key is used', async () => {
    const proxy = await fakeTmdb()
    const server = createApp(root, kinoseedServer({ TMDB_PROXY_URL: proxy.apiBase }, dataStores(join(root, 'proxy'))))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    try {
      expect((await fetch(`${base}/tmdb/configuration`)).status).toBe(200)
      expect(proxy.seen.map((request) => request.url)).toEqual(['/3/configuration'])
      expect(await (await fetch(`${base}/api/settings`)).json()).toMatchObject({ tmdb: { configured: true, source: 'shared' } })
    } finally {
      await new Promise((resolve) => server.close(resolve))
      await closeServers()
    }
  })

  it('points the TMDB bridge at TMDB_API_URL and TMDB_IMAGE_URL', async () => {
    const tmdb = await fakeTmdb()
    const env = { TMDB_API_KEY: 'good-key', TMDB_API_URL: tmdb.apiBase, TMDB_IMAGE_URL: `${tmdb.base}/t/p` }
    const server = createApp(root, kinoseedServer(env, dataStores(join(root, 'tmdb'))))
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
    try {
      expect((await fetch(`${base}/tmdb/movie/693134`)).status).toBe(200)
      expect((await fetch(`${base}/tmdb-img/w342/poster.jpg`)).headers.get('content-type')).toBe('image/jpeg')
      expect(tmdb.seen.map((request) => request.url)).toEqual(['/3/movie/693134?api_key=good-key', '/t/p/w342/poster.jpg'])
    } finally {
      await new Promise((resolve) => server.close(resolve))
      await closeServers()
    }
  })

  it('starts no jobs without qBittorrent', () => {
    const stores = dataStores(join(root, 'no-jobs'))
    const prune = vi.spyOn(stores.matches, 'prune')
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'] })
    try {
      kinoseedServer({}, stores).startJobs()()
      vi.advanceTimersByTime(2 * 60 * 60_000)
      expect(prune).not.toHaveBeenCalled()
    } finally {
      vi.useRealTimers()
    }
  })

  it('checks qBittorrent’s torrents to forget the matches of deleted ones', async () => {
    const present = 'a'.repeat(40)
    const deleted = 'b'.repeat(40)
    const qbittorrent = createServer((request, response) => {
      response.setHeader('Content-Type', 'application/json')
      response.end(request.url === '/api/v2/torrents/info' ? JSON.stringify([{ hash: present }]) : '[]')
    })
    await new Promise<void>((resolve) => qbittorrent.listen(0, '127.0.0.1', resolve))
    const stores = dataStores(join(root, 'jobs'))
    await stores.matches.save({
      [present]: { type: 'movie', id: 1, source: 'user' },
      [deleted]: { type: 'movie', id: 2, source: 'guess', version: 2 },
    })
    vi.useFakeTimers({ toFake: ['setTimeout', 'setInterval', 'clearTimeout', 'clearInterval'] })
    try {
      const url = `http://127.0.0.1:${(qbittorrent.address() as AddressInfo).port}`
      const stop = kinoseedServer({ QBITTORRENT_URL: url }, stores).startJobs()
      await vi.advanceTimersByTimeAsync(60_000)
      await vi.waitFor(() => expect(stores.matches.current[deleted]?.missingSince).toBeTypeOf('number'))
      expect(stores.matches.current[present]?.missingSince).toBeUndefined()
      stop()
    } finally {
      vi.useRealTimers()
      await new Promise((resolve) => qbittorrent.close(resolve))
    }
  })
})
