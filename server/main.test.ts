import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
import { createApp, dataStores, kinoseedServer } from './main.ts'

let root: string
let server: Server
let app: string

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'kinoseed-main-'))
  await writeFile(join(root, 'index.html'), '<!doctype html><title>Kinoseed</title>')
  server = createApp(root, kinoseedServer({}, dataStores(join(root, 'data'))))
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
      qbittorrent: { configured: false, source: null },
    })
    expect(await (await fetch(`${app}/api/matches`)).json()).toEqual({})
  })

  it('serves the app for its routes and 404 for missing files', async () => {
    expect(await (await fetch(`${app}/settings`)).text()).toContain('Kinoseed')
    expect((await fetch(`${app}/assets/missing.js`)).status).toBe(404)
    expect((await fetch(`${app}/settings`, { method: 'POST' })).status).toBe(404)
  })
})

describe('kinoseedServer', () => {
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
