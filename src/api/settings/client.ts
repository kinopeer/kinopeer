import type { DownloadDefaultsBody, ProwlarrKeyBody, QbittorrentLoginBody, ServerSettings, SettingsErrorBody, TmdbKeyBody } from './types'
import { fetchKinopeer } from '../fetchKinopeer'
import { sharedRequests } from '../../logic/sharedRequests'

/** Settings the Kinopeer server keeps (server/settings.ts). */
export const SETTINGS_BASE = '/api/settings'

export class SettingsError extends Error {
  readonly status: number
  readonly code?: SettingsErrorBody['error']

  constructor(status: number, code?: SettingsErrorBody['error']) {
    super(`Settings request failed (${code ?? status})`)
    this.name = 'SettingsError'
    this.status = status
    this.code = code
  }
}

function isJson(response: Response): boolean {
  return response.headers.get('content-type')?.includes('application/json') ?? false
}

async function errorFor(response: Response): Promise<SettingsError> {
  const body = isJson(response) ? ((await response.json().catch(() => ({}))) as Partial<SettingsErrorBody>) : {}
  return new SettingsError(response.status, body.error)
}

export async function getServerSettings(signal?: AbortSignal): Promise<ServerSettings> {
  const response = await fetchKinopeer(SETTINGS_BASE, { signal })
  // No JSON: a server without /api/settings (the SPA fallback answered).
  if (!response.ok || !isJson(response)) throw await errorFor(response)
  return (await response.json()) as ServerSettings
}

/**
 * The key the server's settings are shared under on the page (`sharedRequests`). Every change the
 * app saves answers with the new settings, which replace the kept answer.
 */
export const SERVER_SETTINGS_KEY = 'api|settings'

/**
 * How long the page takes the server's settings it has instead of asking again: a minute, so the
 * download defaults, onboarding's TMDB key step and Settings opened as the app opens, or a tab away,
 * share one answer, while Settings opened later shows what the server has then (a key changed from
 * another device).
 */
export const SERVER_SETTINGS_FRESH_MS = 60_000

/** Keeps a save's answer as the page's settings, so no one reads the settings from before it. */
function saved(settings: ServerSettings): ServerSettings {
  sharedRequests.set(SERVER_SETTINGS_KEY, settings)
  return settings
}

async function send<T>(method: 'PUT' | 'PATCH', path: string, body: T): Promise<ServerSettings> {
  const response = await fetchKinopeer(`${SETTINGS_BASE}/${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok || !isJson(response)) throw await errorFor(response)
  return saved((await response.json()) as ServerSettings)
}

/**
 * Saves the TMDB key on the server, which checks it with TMDB first. Rejects with a SettingsError:
 * code 'invalid-key' when TMDB refuses it, 'unreachable' when TMDB doesn't answer.
 */
export function saveTmdbKey(apiKey: string): Promise<ServerSettings> {
  return send<TmdbKeyBody>('PUT', 'tmdb', { apiKey })
}

/**
 * Saves the Prowlarr API key on the server, which checks it with Prowlarr first, at `url` when
 * given, which it then saves as Prowlarr's address. Rejects with a SettingsError: code 'invalid-key'
 * when Prowlarr refuses it, 'unreachable' when Prowlarr doesn't answer, 'not-prowlarr' when
 * Prowlarr's address answers but isn't Prowlarr, 'not-configured' when the server has no address for
 * Prowlarr, from its environment or saved from the app, and with `url`, 'invalid-address',
 * 'env-address' or 'auth-off' (`ProwlarrKeyBody`).
 */
export function saveProwlarrKey(apiKey: string, url?: string): Promise<ServerSettings> {
  return send<ProwlarrKeyBody>('PUT', 'prowlarr', url === undefined ? { apiKey } : { apiKey, url })
}

async function forget(path: string): Promise<ServerSettings> {
  // The JSON content type, as on every request that changes something (server/json.ts).
  const response = await fetchKinopeer(`${SETTINGS_BASE}/${path}`, {
    method: 'DELETE',
    headers: { 'Content-Type': 'application/json' },
  })
  if (!response.ok || !isJson(response)) throw await errorFor(response)
  return saved((await response.json()) as ServerSettings)
}

/**
 * Forgets the saved TMDB key, so TMDB_API_KEY or Kinopeer's key applies (`tmdb.fallback`). Rejects
 * with code 'no-server-key' when neither would.
 */
export function forgetTmdbKey(): Promise<ServerSettings> {
  return forget('tmdb')
}

/**
 * Forgets the saved Prowlarr key, so the server's own (environment or Prowlarr's config.xml)
 * applies. Rejects with code 'no-server-key' when the server has none to fall back on.
 */
export function forgetProwlarrKey(): Promise<ServerSettings> {
  return forget('prowlarr')
}

/**
 * Saves the qBittorrent login on the server, which logs in with it first, at `url` when given,
 * which it then saves as qBittorrent's address. An empty username is no login, for
 * qBittorrent's auth bypass. Rejects with a SettingsError: code 'invalid-credentials', 'banned' (too
 * many failed logins), 'unreachable', 'not-qbittorrent' when qBittorrent's address answers but isn't
 * qBittorrent, 'not-configured' when the server has no address for qBittorrent, from its environment
 * or saved from the app, and with `url`, 'invalid-address', 'env-address' or 'auth-off'
 * (`QbittorrentLoginBody`).
 */
export function saveQbittorrentLogin(username: string, password: string, url?: string): Promise<ServerSettings> {
  return send<QbittorrentLoginBody>('PUT', 'qbittorrent', url === undefined ? { username, password } : { username, password, url })
}

/** Saves some of the download defaults on the server; the others stay as they are. */
export function saveDownloadDefaults(changes: DownloadDefaultsBody): Promise<ServerSettings> {
  return send<DownloadDefaultsBody>('PATCH', 'downloads', changes)
}
