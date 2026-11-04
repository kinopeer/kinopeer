import type { DownloadDefaultsBody, ProwlarrKeyBody, QbittorrentLoginBody, ServerSettings, SettingsErrorBody, TmdbKeyBody } from './types'

/** Settings the Kinoseed server keeps (server/settings.ts). */
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
  const response = await fetch(SETTINGS_BASE, { credentials: 'same-origin', signal })
  // No JSON: a server without /api/settings (the SPA fallback answered).
  if (!response.ok || !isJson(response)) throw await errorFor(response)
  return (await response.json()) as ServerSettings
}

async function send<T>(method: 'PUT' | 'PATCH', path: string, body: T): Promise<ServerSettings> {
  const response = await fetch(`${SETTINGS_BASE}/${path}`, {
    method,
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!response.ok || !isJson(response)) throw await errorFor(response)
  return (await response.json()) as ServerSettings
}

/**
 * Saves the TMDB key on the server, which checks it with TMDB first. Rejects with a SettingsError:
 * code 'invalid-key' when TMDB refuses it, 'unreachable' when TMDB doesn't answer.
 */
export function saveTmdbKey(apiKey: string): Promise<ServerSettings> {
  return send<TmdbKeyBody>('PUT', 'tmdb', { apiKey })
}

/**
 * Saves the Prowlarr API key on the server, which checks it with Prowlarr first. Rejects with a
 * SettingsError: code 'invalid-key' when Prowlarr refuses it, 'unreachable' when Prowlarr doesn't
 * answer, 'not-prowlarr' when PROWLARR_URL answers but isn't Prowlarr, or 'not-configured' when the
 * server has no PROWLARR_URL.
 */
export function saveProwlarrKey(apiKey: string): Promise<ServerSettings> {
  return send<ProwlarrKeyBody>('PUT', 'prowlarr', { apiKey })
}

async function forget(path: string): Promise<ServerSettings> {
  // The JSON content type, as on every request that changes something (server/json.ts).
  const response = await fetch(`${SETTINGS_BASE}/${path}`, {
    method: 'DELETE',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
  })
  if (!response.ok || !isJson(response)) throw await errorFor(response)
  return (await response.json()) as ServerSettings
}

/**
 * Forgets the saved TMDB key, so TMDB_API_KEY or Kinoseed's key applies (`tmdb.fallback`). Rejects
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
 * Saves the qBittorrent login on the server, which logs in with it first. Rejects with a
 * SettingsError: code 'invalid-credentials', 'banned' (too many failed logins), 'unreachable', or
 * 'not-configured' when the server has no QBITTORRENT_URL.
 */
export function saveQbittorrentLogin(username: string, password: string): Promise<ServerSettings> {
  return send<QbittorrentLoginBody>('PUT', 'qbittorrent', { username, password })
}

/** Saves some of the download defaults on the server; the others stay as they are. */
export function saveDownloadDefaults(changes: DownloadDefaultsBody): Promise<ServerSettings> {
  return send<DownloadDefaultsBody>('PATCH', 'downloads', changes)
}
