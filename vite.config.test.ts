import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createServer, preview } from 'vite'
import { SECURITY_HEADERS } from './server/securityHeaders.ts'

/**
 * `npm run dev` and `npm run preview` from this config. loadEnv lets process.env win over
 * .env.local, so stubbing the variables keeps a clone's real services and data out of the test.
 */
let dir: string
const closers: (() => Promise<void>)[] = []

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'kinopeer-vite-'))
  for (const name of ['QBITTORRENT_URL', 'QBITTORRENT_USERNAME', 'QBITTORRENT_PASSWORD', 'PROWLARR_URL', 'PROWLARR_API_KEY', 'TMDB_API_KEY'])
    vi.stubEnv(name, '')
  vi.stubEnv('KINOPEER_DATA_DIR', join(dir, 'data'))
})

afterEach(async () => {
  for (const close of closers.splice(0)) await close()
  await rm(dir, { recursive: true, force: true })
})

const options = { configFile: 'vite.config.ts', logLevel: 'silent' } as const
const listening = { port: 0, host: '127.0.0.1', strictPort: true } as const

/** `npm run dev` from this config; resolves to its port. */
async function startDev(): Promise<number> {
  const server = await createServer({ ...options, server: { ...listening, watch: null }, optimizeDeps: { noDiscovery: true } })
  closers.push(() => server.close())
  await server.listen()
  return (server.httpServer!.address() as AddressInfo).port
}

/** `npm run preview` from this config, over a build that is only an index.html; resolves to its port. */
async function startPreview(): Promise<number> {
  const outDir = join(dir, 'dist')
  await mkdir(outDir)
  await writeFile(join(outDir, 'index.html'), '<!doctype html>')
  const server = await preview({ ...options, build: { outDir }, preview: listening })
  closers.push(() => server.close())
  return (server.httpServer.address() as AddressInfo).port
}

/** A preflight from a page on another localhost port that wants to send /qbt the client's header. */
const preflight = (port: number) =>
  fetch(`http://127.0.0.1:${port}/qbt/api/v2/torrents/delete`, {
    method: 'OPTIONS',
    headers: {
      Origin: 'http://localhost:3000',
      'Access-Control-Request-Method': 'POST',
      'Access-Control-Request-Headers': 'x-kinopeer',
    },
  })

describe('vite.config.ts', () => {
  it('answers no cross-origin preflight on the dev server, so another local page can’t send /qbt the header', async () => {
    const answer = await preflight(await startDev())
    expect(answer.headers.has('access-control-allow-origin')).toBe(false)
    expect(answer.ok).toBe(false)
  })

  it('sends the server’s security headers from the dev and preview servers too', async () => {
    for (const [server, port] of [['dev', await startDev()], ['preview', await startPreview()]]) {
      const { headers } = await fetch(`http://127.0.0.1:${port}/`)
      for (const [name, value] of Object.entries(SECURITY_HEADERS)) expect(headers.get(name), `${server} ${name}`).toBe(value)
    }
  })

  it('answers no cross-origin preflight on the preview server either', async () => {
    const answer = await preflight(await startPreview())
    expect(answer.headers.has('access-control-allow-origin')).toBe(false)
    expect(answer.ok).toBe(false)
  })
})
