import { readFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { baseOf } from './address.ts'
import { AuthStore, authMode, envPassword, kinopeerAuth } from './auth.ts'
import { allowedHosts, allowedHostsWarning, hostCheck } from './hostCheck.ts'
import { MatchesStore, matchesMiddleware, qbittorrentHashes, startMatchesCleanup } from './matches.ts'
import { prowlarrMiddleware, type Middleware } from './prowlarr.ts'
import { qbittorrentBridge } from './qbittorrent.ts'
import { contentSecurityPolicy, securityHeaders } from './securityHeaders.ts'
import { SettingsStore, prowlarrAddress, prowlarrKey, qbittorrentAddress, qbittorrentCredentials, settingsMiddleware, tmdbKey } from './settings.ts'
import { staticMiddleware } from './static.ts'
import { tmdbMiddleware } from './tmdb.ts'

/**
 * The production server: the built app plus the same /api/settings, /api/matches, /qbt, /prowlarr,
 * /tmdb and /tmdb-img routes the dev server has. Configured through environment variables (see .env.example)
 * and the settings saved from the app:
 *
 *   node server/main.ts
 *
 * PORT (default 8080), HOST (default 0.0.0.0) and KINOPEER_DIST (default ../dist) set where it
 * listens and what it serves; KINOPEER_DATA_DIR (default ./data) is where settings saved from the
 * app and torrent-to-title matches are kept.
 */
export function createApp(root: string, kinopeer: KinopeerServer) {
  return createServer(chain([contentSecurityPolicy, ...kinopeer.routes, staticMiddleware({ root })]))
}

/** What the server keeps in its data directory. */
export interface DataStores {
  settings: SettingsStore
  matches: MatchesStore
  auth: AuthStore
}

export function dataStores(dir: string): DataStores {
  return { settings: new SettingsStore(dir), matches: new MatchesStore(dir), auth: new AuthStore(dir) }
}

export interface KinopeerServer {
  /**
   * The server's own routes, shared with the Vite dev and preview servers; the security headers and
   * the host check first, then /healthz and Kinopeer's own login, which holds back every route after it.
   */
  routes: Middleware[]
  /** Starts the background jobs (the hourly matches cleanup); returns a function that stops them. */
  startJobs: () => () => void
}

/** Kinopeer's TMDB proxy for released versions (tmdb-proxy/, docs/DEVELOPMENT.md → The TMDB proxy). */
export const TMDB_PROXY = 'https://tmdb.kinopeer.com/3'

/** Its edge worker, which follows main: edge images bake it in (edge.yml), and the dev server defaults to it. */
export const TMDB_PROXY_EDGE = 'https://tmdb-edge.kinopeer.com/3'

/**
 * Where TMDB calls without a key go: TMDB_PROXY_URL, which an empty value turns off, else the
 * proxy the image was built for (KINOPEER_TMDB_PROXY, the edge worker in edge builds), else the
 * released versions'.
 */
export function tmdbProxy(env: Record<string, string | undefined>): string | undefined {
  const url = env.TMDB_PROXY_URL ?? (env.KINOPEER_TMDB_PROXY?.trim() || TMDB_PROXY)
  return url.trim().replace(/\/+$/, '') || undefined
}

/**
 * What the server warns about at startup: the services it has no address for, from the environment
 * or the app, and the keys it lacks.
 */
export function missingSettings(env: Record<string, string | undefined>, settings: SettingsStore): string[] {
  const missing: string[] = []
  if (!qbittorrentAddress(settings, env.QBITTORRENT_URL)) missing.push('QBITTORRENT_URL')
  if (!prowlarrAddress(settings, env.PROWLARR_URL)) missing.push('PROWLARR_URL')
  // The environment's key counts only with the environment's address (`kinopeerServer`); with an
  // address saved from the app, only a key saved there does.
  const envKey = baseOf(env.PROWLARR_URL) && (env.PROWLARR_API_KEY || env.PROWLARR_CONFIG_XML)
  if (!settings.current.prowlarrApiKey?.trim() && !envKey) {
    missing.push(baseOf(env.PROWLARR_URL) || !baseOf(settings.current.prowlarrUrl) ? 'PROWLARR_API_KEY' : 'Prowlarr key (enter it in the app)')
  }
  // Without a key, Kinopeer's proxy serves TMDB; only with it off is a key missing.
  if (!tmdbKey(settings, env.TMDB_API_KEY) && !tmdbProxy(env)) missing.push('TMDB key (enter it in the app)')
  return missing
}

/**
 * The environment's logins and keys the server ignores at startup, each set without its service's
 * address in the environment (`kinopeerServer`), so an operator who set one learns it isn't used.
 */
export function ignoredSettings(env: Record<string, string | undefined>): string[] {
  const ignored = (url: string, names: string[]) => (baseOf(env[url]) ? [] : names.filter((name) => env[name]).map((name) => `${name} (only with ${url})`))
  return [
    ...ignored('QBITTORRENT_URL', ['QBITTORRENT_USERNAME', 'QBITTORRENT_PASSWORD']),
    ...ignored('PROWLARR_URL', ['PROWLARR_API_KEY', 'PROWLARR_CONFIG_XML']),
  ]
}

/**
 * What the server warns about at startup when Kinopeer's own login is off, the operator's one sign
 * that nothing of Kinopeer's asks for a password; undefined with it on.
 */
export function loginWarning(env: Record<string, string | undefined>): string | undefined {
  return authMode(env.KINOPEER_AUTH) === 'off' ? 'own login off (KINOPEER_AUTH=off): keep a login in front of Kinopeer' : undefined
}

/**
 * The server's routes and jobs. Besides the variables in .env.example, PROWLARR_CONFIG_XML points
 * at Prowlarr's config.xml to read its API key from (the Umbrel package mounts it), used when
 * neither a key saved from the app nor PROWLARR_API_KEY is set. Both, like QBITTORRENT_USERNAME and
 * QBITTORRENT_PASSWORD, apply only while the environment sets that service's address
 * (PROWLARR_URL, QBITTORRENT_URL): a browser chose an address saved from the app. TMDB_API_URL and
 * TMDB_IMAGE_URL replace TMDB's API and image addresses (the integration and smoke tests point them
 * at a fake), and TMDB_PROXY_URL replaces Kinopeer's TMDB proxy (`tmdbProxy`). KINOPEER_ALLOWED_HOSTS adds the host names it answers at
 * (`allowedHosts`). KINOPEER_AUTH=off turns Kinopeer's own login off (server/auth.ts), and throws
 * for a value it doesn't know, so the server doesn't start, as it does for a KINOPEER_PASSWORD
 * shorter than 8 characters or longer than 256 (`envPassword`).
 */
export function kinopeerServer(env: Record<string, string | undefined>, stores: DataStores): KinopeerServer {
  const store = stores.settings
  const auth = kinopeerAuth({ store: stores.auth, mode: authMode(env.KINOPEER_AUTH), envPassword: envPassword(env.KINOPEER_PASSWORD) })
  // The environment's login and key go only to the environment's address: where an address comes
  // from the app, a browser chose where they'd be sent, so only a login or key saved from the app is.
  const envQbittorrent = baseOf(env.QBITTORRENT_URL) ? { username: env.QBITTORRENT_USERNAME, password: env.QBITTORRENT_PASSWORD } : {}
  const envProwlarrKey = baseOf(env.PROWLARR_URL) ? env.PROWLARR_API_KEY : undefined
  const prowlarrConfig = baseOf(env.PROWLARR_URL) ? env.PROWLARR_CONFIG_XML : undefined
  const proxy = tmdbProxy(env)
  const qbittorrent = qbittorrentBridge({
    url: () => qbittorrentAddress(store, env.QBITTORRENT_URL),
    credentials: () => qbittorrentCredentials(store, envQbittorrent),
  })
  return {
    routes: [
      // First, so every answer has them, a 404 included.
      securityHeaders,
      // Before every route, the health check included: a page rebound to Kinopeer's address gets nothing.
      hostCheck(allowedHosts(env.KINOPEER_ALLOWED_HOSTS).allowed),
      health,
      auth.middleware,
      settingsMiddleware({
        store,
        auth: auth.status,
        envTmdbApiKey: env.TMDB_API_KEY,
        tmdbProxy: proxy,
        tmdbApiBase: env.TMDB_API_URL,
        envQbittorrentUrl: env.QBITTORRENT_URL,
        envQbittorrent,
        envProwlarrUrl: env.PROWLARR_URL,
        envProwlarrApiKey: envProwlarrKey,
        prowlarrConfigXml: prowlarrConfig,
      }),
      matchesMiddleware(stores.matches),
      qbittorrent.middleware,
      prowlarrMiddleware({
        url: () => prowlarrAddress(store, env.PROWLARR_URL),
        apiKey: () => prowlarrKey(store, envProwlarrKey, prowlarrConfig),
      }),
      tmdbMiddleware({
        apiKey: () => tmdbKey(store, env.TMDB_API_KEY),
        proxyBase: proxy,
        apiBase: env.TMDB_API_URL,
        imageBase: env.TMDB_IMAGE_URL,
      }),
    ],
    // Runs whether or not qBittorrent has an address yet: one saved from the app later applies, and a
    // check without one finds nothing to forget.
    startJobs: () => startMatchesCleanup(stores.matches, () => qbittorrentHashes(qbittorrent.get)),
  }
}

function chain(middlewares: Middleware[]) {
  return (request: IncomingMessage, response: ServerResponse) => {

    const run = (index: number) => {
      const middleware = middlewares[index]
      if (!middleware) return notFound(response)
      try {
        middleware(request, response, () => run(index + 1))
      } catch {
        if (!response.headersSent) internalError(response)
      }
    }
    run(0)
  }
}

/** For Docker's HEALTHCHECK and uptime monitors: the server is up (not whether qBittorrent is). */
function health(request: IncomingMessage, response: ServerResponse, next: () => void) {
  if (request.url !== '/healthz') return next()
  response.setHeader('Content-Type', 'text/plain; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  response.end('ok')
}

function notFound(response: ServerResponse) {
  response.statusCode = 404
  response.setHeader('Content-Type', 'text/plain; charset=utf-8')
  response.end('Not found')
}

function internalError(response: ServerResponse) {
  response.statusCode = 500
  response.setHeader('Content-Type', 'text/plain; charset=utf-8')
  response.end('Internal error')
}

async function main() {
  const env = process.env
  const port = Number(env.PORT || 8080)
  const host = env.HOST || '0.0.0.0'
  const root = resolve(env.KINOPEER_DIST || resolve(dirname(fileURLToPath(import.meta.url)), '../dist'))
  const stores = dataStores(resolve(env.KINOPEER_DATA_DIR || 'data'))
  // auth.json is read with the first request the login holds back: one it can't read answers 500
  // then, rather than keeping the server from starting with the login off.
  await Promise.all([stores.settings.load(), stores.matches.load()])
  const kinopeer = kinopeerServer(env, stores)
  const server = createApp(root, kinopeer)
  const stopJobs = kinopeer.startJobs()
  const { version } = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8')) as { version: string }

  server.listen(port, host, () => {
    console.log(`[kinopeer] ${version} listening on http://${host}:${port}`)
    const missing = missingSettings(env, stores.settings)
    if (missing.length) console.warn(`[kinopeer] not set: ${missing.join(', ')}`)
    const ignored = ignoredSettings(env)
    if (ignored.length) console.warn(`[kinopeer] ignored: ${ignored.join(', ')}`)
    const login = loginWarning(env)
    if (login) console.warn(`[kinopeer] ${login}`)
    const hostsWarning = allowedHostsWarning(env.KINOPEER_ALLOWED_HOSTS)
    if (hostsWarning) console.warn(`[kinopeer] ${hostsWarning}`)
  })

  // Docker sends SIGTERM on stop: finish open requests instead of waiting to be killed.
  const stop = () => {
    stopJobs()
    server.close(() => process.exit(0))
    server.closeIdleConnections()
    setTimeout(() => process.exit(0), 5000).unref()
  }
  process.on('SIGTERM', stop)
  process.on('SIGINT', stop)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) void main()
