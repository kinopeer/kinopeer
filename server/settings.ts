import type { IncomingMessage, ServerResponse } from 'node:http'
import type {
  DownloadDefaults,
  DownloadDefaultsBody,
  ProwlarrKeyBody,
  QbittorrentLoginBody,
  SecretStatus,
  ServerSettings,
  SettingsErrorBody,
  TmdbFallback,
  TmdbKeyBody,
} from '../src/api/settings/types.ts'
import { isJsonRequest, readJson, sendJson } from './json.ts'
import { JsonFile } from './jsonFile.ts'
import { checkProwlarrKey, readProwlarrApiKey, type Middleware } from './prowlarr.ts'
import { qbittorrentLogin, type QbittorrentCredentials } from './qbittorrent.ts'
import { checkTmdbKey } from './tmdb.ts'

/**
 * Settings the user enters in the app and the server keeps: the TMDB key, the Prowlarr key, the
 * qBittorrent login and the download defaults. They live in settings.json in the data directory ($KINOSEED_DATA_DIR,
 * /data in the Docker image), readable only by the server. A saved secret wins over the matching
 * environment variables, which stay as the defaults (the Umbrel package sets qBittorrent's) and for
 * development.
 *
 * GET /api/settings → ServerSettings (only whether each secret is set, never its value)
 * PUT /api/settings/tmdb { apiKey } → checks the key with TMDB, saves it, answers ServerSettings
 * PUT /api/settings/prowlarr { apiKey } → checks the key with Prowlarr, saves it, answers ServerSettings
 * DELETE /api/settings/tmdb → forgets the saved key, so TMDB_API_KEY or Kinoseed's key applies again;
 *   refused (409) when neither would
 * DELETE /api/settings/prowlarr → forgets the saved key, so the environment's or config.xml's applies
 *   again; refused (409) when the server has no key of its own
 * PUT /api/settings/qbittorrent { username, password } → logs in to qBittorrent, saves the login
 * PATCH /api/settings/downloads { …some DownloadDefaults } → merges them in, answers ServerSettings
 */
export interface StoredSettings {
  tmdbApiKey?: string
  prowlarrApiKey?: string
  qbittorrentUsername?: string
  qbittorrentPassword?: string
  downloads?: Partial<DownloadDefaults>
}

export class SettingsStore extends JsonFile<StoredSettings> {
  constructor(dir: string) {
    super(dir, 'settings.json')
  }

  /** Merges `changes` in and saves them. */
  update(changes: StoredSettings): Promise<StoredSettings> {
    return this.change((current) => ({ ...current, ...changes }))
  }

  /** Merges in only the download defaults given, so two devices changing different ones keep both. */
  updateDownloads(changes: DownloadDefaultsBody): Promise<StoredSettings> {
    return this.change((current) => ({ ...current, downloads: { ...current.downloads, ...changes } }))
  }
}

export interface SettingsConfig {
  store: SettingsStore
  /** TMDB_API_KEY from the environment, the fallback. */
  envTmdbApiKey?: string
  /** Kinoseed's TMDB proxy, which serves calls without a key (server/tmdb.ts); none to turn it off. */
  tmdbProxy?: string
  /** PROWLARR_URL, to check a key before saving it. */
  prowlarrUrl?: string
  /** PROWLARR_API_KEY, the fallback. */
  envProwlarrApiKey?: string
  /** PROWLARR_CONFIG_XML, Prowlarr's config.xml to read its key from, the last fallback. */
  prowlarrConfigXml?: string
  /** QBITTORRENT_URL, to check a login before saving it. */
  qbittorrentUrl?: string
  /** QBITTORRENT_USERNAME and QBITTORRENT_PASSWORD, the fallback. */
  envQbittorrent?: Partial<QbittorrentCredentials>
  /** Overridable for tests. */
  tmdbApiBase?: string
}

/** The TMDB key the bridge uses: the saved one, else the environment's. */
export function tmdbKey(store: SettingsStore, envKey: string | undefined): string | undefined {
  return store.current.tmdbApiKey?.trim() || envKey?.trim() || undefined
}

/**
 * The Prowlarr key the bridge uses: the saved one, else PROWLARR_API_KEY, else the one in Prowlarr's
 * config.xml (read on every call, so a key changed in Prowlarr is picked up).
 */
export async function prowlarrKey(
  store: SettingsStore,
  envKey: string | undefined,
  configXml: string | undefined,
): Promise<string | undefined> {
  return (
    store.current.prowlarrApiKey?.trim() ||
    envKey?.trim() ||
    (configXml ? (await readProwlarrApiKey(configXml))?.trim() : undefined) ||
    undefined
  )
}

/** The qBittorrent login the bridge uses: the saved one, else the environment's. */
export function qbittorrentCredentials(
  store: SettingsStore,
  env: Partial<QbittorrentCredentials> | undefined,
): QbittorrentCredentials | undefined {
  const saved = store.current
  if (saved.qbittorrentUsername?.trim()) {
    return { username: saved.qbittorrentUsername.trim(), password: saved.qbittorrentPassword ?? '' }
  }
  if (env?.username?.trim()) return { username: env.username.trim(), password: env.password ?? '' }
  return undefined
}

const PREFIX = '/api/settings'
const MAX_BODY_BYTES = 16 * 1024

function fail(response: ServerResponse, status: number, error: SettingsErrorBody['error']): void {
  sendJson(response, status, { error } satisfies SettingsErrorBody)
}

function status(saved: string | undefined, env: string | undefined): SecretStatus {
  const source = saved?.trim() ? 'saved' : env?.trim() ? 'env' : null
  return { configured: source !== null, source }
}

/** What serves TMDB without a saved key: TMDB_API_KEY, else Kinoseed's key behind its proxy. */
function tmdbFallback(config: SettingsConfig): TmdbFallback | null {
  return config.envTmdbApiKey?.trim() ? 'env' : config.tmdbProxy ? 'shared' : null
}

/** Kinoseed's key counts as a key, so onboarding doesn't ask for one; the user's own still wins. */
function tmdbStatus(saved: string | undefined, config: SettingsConfig): ServerSettings['tmdb'] {
  const fallback = tmdbFallback(config)
  const source = saved?.trim() ? 'saved' : fallback
  return { configured: source !== null, source, fallback }
}

/** The server's own Prowlarr key: a key in config.xml counts as its configuration, like the variable. */
async function serverProwlarrKey(config: SettingsConfig): Promise<string | undefined> {
  return (
    config.envProwlarrApiKey?.trim() ||
    (config.prowlarrConfigXml ? (await readProwlarrApiKey(config.prowlarrConfigXml))?.trim() : undefined) ||
    undefined
  )
}

async function snapshot(stored: StoredSettings, config: SettingsConfig): Promise<ServerSettings> {
  // Reads config.xml on every GET (a small local file): the answer says whether the server has a
  // key of its own, which decides whether a saved key can be forgotten.
  const envProwlarr = await serverProwlarrKey(config)
  return {
    tmdb: tmdbStatus(stored.tmdbApiKey, config),
    prowlarr: { ...status(stored.prowlarrApiKey, envProwlarr), serverKey: Boolean(envProwlarr) },
    qbittorrent: status(stored.qbittorrentUsername, config.envQbittorrent?.username),
    downloads: stored.downloads ?? null,
  }
}

async function save(config: SettingsConfig, response: ServerResponse, saving: Promise<StoredSettings>) {
  try {
    const stored = await saving
    sendJson(response, 200, await snapshot(stored, config))
  } catch {
    console.warn('[kinoseed] could not write settings.json; is the data directory writable?')
    fail(response, 500, 'storage')
  }
}

async function saveTmdbKey(config: SettingsConfig, request: IncomingMessage, response: ServerResponse) {
  let body: unknown
  try {
    body = await readJson(request, MAX_BODY_BYTES)
  } catch {
    return fail(response, 400, 'bad-request')
  }
  const apiKey = (body as Partial<TmdbKeyBody> | null)?.apiKey
  if (typeof apiKey !== 'string' || !apiKey.trim() || /\s/.test(apiKey.trim())) return fail(response, 400, 'bad-request')

  let valid: boolean
  try {
    valid = await checkTmdbKey(apiKey.trim(), config.tmdbApiBase)
  } catch {
    return fail(response, 502, 'unreachable')
  }
  if (!valid) return fail(response, 422, 'invalid-key')
  await save(config, response, config.store.update({ tmdbApiKey: apiKey.trim() }))
}

/** Forgets the saved key, only when something else would serve TMDB, so Kinoseed is never left without it. */
async function forgetTmdbKey(config: SettingsConfig, _request: IncomingMessage, response: ServerResponse) {
  if (!tmdbFallback(config)) return fail(response, 409, 'no-server-key')
  await save(config, response, config.store.update({ tmdbApiKey: undefined }))
}

async function saveProwlarrKey(config: SettingsConfig, request: IncomingMessage, response: ServerResponse) {
  const base = config.prowlarrUrl?.trim().replace(/\/+$/, '')
  if (!base) return fail(response, 503, 'not-configured')
  let body: unknown
  try {
    body = await readJson(request, MAX_BODY_BYTES)
  } catch {
    return fail(response, 400, 'bad-request')
  }
  const apiKey = (body as Partial<ProwlarrKeyBody> | null)?.apiKey
  if (typeof apiKey !== 'string' || !apiKey.trim() || /\s/.test(apiKey.trim())) return fail(response, 400, 'bad-request')

  let result: Awaited<ReturnType<typeof checkProwlarrKey>>
  try {
    result = await checkProwlarrKey(base, apiKey.trim())
  } catch {
    return fail(response, 502, 'unreachable')
  }
  if (result === 'invalid') return fail(response, 422, 'invalid-key')
  if (result === 'not-prowlarr') return fail(response, 502, 'not-prowlarr')
  await save(config, response, config.store.update({ prowlarrApiKey: apiKey.trim() }))
}

/** Forgets the saved key, only when the server has one of its own to fall back on. */
async function forgetProwlarrKey(config: SettingsConfig, _request: IncomingMessage, response: ServerResponse) {
  if (!(await serverProwlarrKey(config))) return fail(response, 409, 'no-server-key')
  await save(config, response, config.store.update({ prowlarrApiKey: undefined }))
}

async function saveQbittorrentLogin(config: SettingsConfig, request: IncomingMessage, response: ServerResponse) {
  const base = config.qbittorrentUrl?.trim().replace(/\/+$/, '')
  if (!base) return fail(response, 503, 'not-configured')
  let body: Partial<QbittorrentLoginBody> | null
  try {
    body = (await readJson(request, MAX_BODY_BYTES)) as Partial<QbittorrentLoginBody> | null
  } catch {
    return fail(response, 400, 'bad-request')
  }
  const { username, password } = body ?? {}
  if (typeof username !== 'string' || !username.trim() || typeof password !== 'string') {
    return fail(response, 400, 'bad-request')
  }

  let result: Awaited<ReturnType<typeof qbittorrentLogin>>
  try {
    result = await qbittorrentLogin(base, username.trim(), password)
  } catch {
    return fail(response, 502, 'unreachable')
  }
  if (result.status === 'invalid') return fail(response, 422, 'invalid-credentials')
  if (result.status === 'banned') return fail(response, 429, 'banned')
  await save(config, response, config.store.update({ qbittorrentUsername: username.trim(), qbittorrentPassword: password }))
}

const MAX_CATEGORY_LENGTH = 256

type BooleanDefault = { [K in keyof DownloadDefaults]: DownloadDefaults[K] extends boolean ? K : never }[keyof DownloadDefaults]

/** The on/off defaults: a Record, so a boolean added to DownloadDefaults fails typecheck until it's here. */
const BOOLEAN_DEFAULTS: Record<BooleanDefault, true> = { startPaused: true, sequential: true, firstLastPieces: true }

const isBooleanDefault = (key: string): key is BooleanDefault => Object.hasOwn(BOOLEAN_DEFAULTS, key)

/** The changes in a PATCH body, or undefined when it holds anything but known, well-typed fields. */
function downloadChanges(body: unknown): DownloadDefaultsBody | undefined {
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return undefined
  const changes: DownloadDefaultsBody = {}
  for (const [key, value] of Object.entries(body)) {
    if (key === 'movieCategory' || key === 'tvCategory') {
      if (value !== null && (typeof value !== 'string' || !value.trim() || value.length > MAX_CATEGORY_LENGTH)) {
        return undefined
      }
      changes[key] = value
    } else if (isBooleanDefault(key)) {
      if (typeof value !== 'boolean') return undefined
      changes[key] = value
    } else {
      return undefined
    }
  }
  return changes
}

async function saveDownloadDefaults(config: SettingsConfig, request: IncomingMessage, response: ServerResponse) {
  let body: unknown
  try {
    body = await readJson(request, MAX_BODY_BYTES)
  } catch {
    return fail(response, 400, 'bad-request')
  }
  const changes = downloadChanges(body)
  if (!changes) return fail(response, 400, 'bad-request')
  await save(config, response, config.store.updateDownloads(changes))
}

export function settingsMiddleware(config: SettingsConfig): Middleware {
  return (request, response, next) => {
    const path = new URL(request.url ?? '/', 'http://kinoseed.local').pathname
    if (path !== PREFIX && !path.startsWith(`${PREFIX}/`)) return next()

    if (path === PREFIX && request.method === 'GET') {
      void config.store
        .load()
        .then((stored) => snapshot(stored, config))
        .then((settings) => sendJson(response, 200, settings))
      return
    }
    const handler =
      path === `${PREFIX}/tmdb` && request.method === 'PUT'
        ? saveTmdbKey
        : path === `${PREFIX}/tmdb` && request.method === 'DELETE'
          ? forgetTmdbKey
        : path === `${PREFIX}/prowlarr` && request.method === 'PUT'
          ? saveProwlarrKey
          : path === `${PREFIX}/prowlarr` && request.method === 'DELETE'
            ? forgetProwlarrKey
          : path === `${PREFIX}/qbittorrent` && request.method === 'PUT'
          ? saveQbittorrentLogin
          : path === `${PREFIX}/downloads` && request.method === 'PATCH'
            ? saveDownloadDefaults
            : undefined
    if (handler) {
      if (!isJsonRequest(request)) return fail(response, 415, 'bad-request')
      handler(config, request, response).catch(() => {
        if (!response.headersSent) fail(response, 500, 'storage')
      })
      return
    }
    fail(response, 404, 'not-found')
  }
}
