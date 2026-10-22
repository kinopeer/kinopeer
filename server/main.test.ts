import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import type { Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createApp } from './main.ts'
import { SettingsStore } from './settings.ts'

let root: string
let server: Server
let app: string

beforeAll(async () => {
  root = await mkdtemp(join(tmpdir(), 'kinoseed-main-'))
  await writeFile(join(root, 'index.html'), '<!doctype html><title>Kinoseed</title>')
  server = createApp({}, root, new SettingsStore(join(root, 'data')))
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
    expect(await (await fetch(`${app}/api/settings`)).json()).toEqual({ tmdb: { configured: false, source: null } })
  })

  it('serves the app for its routes and 404 for missing files', async () => {
    expect(await (await fetch(`${app}/settings`)).text()).toContain('Kinoseed')
    expect((await fetch(`${app}/assets/missing.js`)).status).toBe(404)
    expect((await fetch(`${app}/settings`, { method: 'POST' })).status).toBe(404)
  })
})
