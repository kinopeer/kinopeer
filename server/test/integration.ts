/**
 * The stand for the integration tests (server/integration/, docs/TESTING.md → Integration tests):
 * the real `kinoseedServer()` in front of the fake qBittorrent, TMDB and Prowlarr from ./fakes.ts,
 * with a data directory of its own, and the browser's `fetch` stood in for, so the real clients in
 * src/api reach it the way they reach the dev server.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { vi } from 'vitest'
import { dataStores, kinoseedServer, type DataStores } from '../main.ts'
import { closeServers, fakeProwlarr, fakeQbittorrent, fakeTmdb, listen } from './fakes.ts'

/** What the Kinoseed server saw of a request from the browser. */
export interface ReceivedRequest {
  method?: string
  url?: string
  cookie?: string
}

/**
 * The browser's cookies for Kinoseed's origin: what the server (or a proxy in front of it, like
 * Umbrel's) set, sent back with every request, the way `credentials: 'same-origin'` does.
 */
export class CookieJar {
  private readonly cookies = new Map<string, string>()

  set(name: string, value: string): void {
    this.cookies.set(name, value)
  }

  all(): Record<string, string> {
    return Object.fromEntries(this.cookies)
  }

  /** The Cookie header for the next request, or undefined without any. */
  header(): string | undefined {
    return this.cookies.size ? [...this.cookies].map(([name, value]) => `${name}=${value}`).join('; ') : undefined
  }

  absorb(setCookies: string[]): void {
    for (const header of setCookies) {
      const [pair] = header.split(';')
      const index = pair.indexOf('=')
      if (index > 0) this.cookies.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim())
    }
  }
}

export interface StandOptions {
  /**
   * The server's environment on top of the defaults, which point every service at its fake and
   * log in to qBittorrent as admin: a variable set to undefined is unset.
   */
  env?: Record<string, string | undefined>
  /** The fakes' options. */
  qbittorrent?: Parameters<typeof fakeQbittorrent>[0]
  prowlarr?: Parameters<typeof fakeProwlarr>[0]
  /** false puts the data directory where it can't be created, so every write fails. */
  writableData?: boolean
}

export interface Stand {
  /** The Kinoseed server's origin; the clients reach it through the stubbed `fetch`. */
  origin: string
  qbittorrent: Awaited<ReturnType<typeof fakeQbittorrent>>
  tmdb: Awaited<ReturnType<typeof fakeTmdb>>
  prowlarr: Awaited<ReturnType<typeof fakeProwlarr>>
  stores: DataStores
  dataDir: string
  cookies: CookieJar
  /** Every request the server got from the browser, in order. */
  received: ReceivedRequest[]
  /** A copy of every answer the browser got, to check what must never be in one. */
  responses: Response[]
}

const realFetch = globalThis.fetch
const dirs: string[] = []
let current: Stand | undefined

/**
 * Stands in for the browser's `fetch`: a request for a path (`/qbt/api/…`, as the clients send
 * them) goes to the stand's origin with the jar's cookies, and what it sets is kept; a request for
 * a full URL (the server's own, to the fakes) goes out as is. An adapter for Node, not a mock: it
 * answers nothing itself.
 */
const browserFetch: typeof fetch = async (input, init) => {
  if (typeof input !== 'string' || !input.startsWith('/')) return realFetch(input, init)
  const stand = current
  if (!stand) throw new Error('No Kinoseed stand is running')
  const headers = new Headers(init?.headers)
  const cookie = stand.cookies.header()
  if (cookie) headers.set('Cookie', cookie)
  const response = await realFetch(`${stand.origin}${input}`, { ...init, headers })
  stand.cookies.absorb(response.headers.getSetCookie())
  stand.responses.push(response.clone())
  return response
}

/**
 * Starts the fakes and the real server in front of them, and points the clients at it. A test may
 * start several stands (with different environments); the clients reach the last one. Every
 * stand is torn down by `stopKinoseed()`, which the tests call in afterEach.
 */
export async function startKinoseed(options: StandOptions = {}): Promise<Stand> {
  const [qbittorrent, tmdb, prowlarr] = await Promise.all([
    fakeQbittorrent(options.qbittorrent),
    fakeTmdb(),
    fakeProwlarr(options.prowlarr),
  ])
  let dataDir = await mkdtemp(join(tmpdir(), 'kinoseed-integration-'))
  dirs.push(dataDir)
  if (options.writableData === false) {
    await writeFile(join(dataDir, 'file'), '')
    dataDir = join(dataDir, 'file', 'data')
  }
  const env: Record<string, string | undefined> = {
    QBITTORRENT_URL: qbittorrent.base,
    QBITTORRENT_USERNAME: 'admin',
    QBITTORRENT_PASSWORD: 'pass word',
    PROWLARR_URL: prowlarr.base,
    PROWLARR_API_KEY: prowlarr.apiKey,
    TMDB_API_KEY: 'good-key',
    TMDB_API_URL: tmdb.apiBase,
    KINOSEED_DATA_DIR: dataDir,
    ...options.env,
  }
  const stores = dataStores(env.KINOSEED_DATA_DIR!)
  await Promise.all([stores.settings.load(), stores.matches.load()])
  const { routes } = kinoseedServer(env, stores)
  const received: ReceivedRequest[] = []
  // The production server's chain (server/main.ts) without the static files: the routes in order,
  // then 404, as the dev server's own fallback would answer an unknown API path.
  const origin = await listen((request, response) => {
    received.push({ method: request.method, url: request.url, cookie: request.headers.cookie })
    const run = (index: number) => {
      const route = routes[index]
      if (!route) {
        response.statusCode = 404
        response.setHeader('Content-Type', 'text/plain; charset=utf-8')
        return response.end('Not found')
      }
      route(request, response, () => run(index + 1))
    }
    run(0)
  })
  current = { origin, qbittorrent, tmdb, prowlarr, stores, dataDir, cookies: new CookieJar(), received, responses: [] }
  vi.stubGlobal('fetch', browserFetch)
  return current
}

/** Closes every stand's servers, restores `fetch` and removes the data directories; for afterEach. */
export async function stopKinoseed(): Promise<void> {
  current = undefined
  vi.unstubAllGlobals()
  await closeServers()
  await Promise.all(dirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true })))
}
