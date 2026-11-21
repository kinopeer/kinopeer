import type {
  DownloadDefaultsBody,
  FoundAddresses,
  NotifyLanguage,
  ProwlarrKeyBody,
  QbittorrentLoginBody,
  ServerSettings,
  SettingsErrorBody,
  SourceAddress,
  TelegramChatBody,
  TelegramCheck,
  TelegramFoundChat,
  TelegramTestBody,
  TelegramTokenBody,
  TmdbKeyBody,
} from './types'
import { knownFailure, type ConnectionFailure } from '../connectionFailure'
import { isContainerHint, isSourceAddress } from '../containerHints'
import { fetchKinopeer } from '../fetchKinopeer'
import { sharedRequests } from '../../logic/sharedRequests'

/** Settings the Kinopeer server keeps (server/settings.ts). */
export const SETTINGS_BASE = '/api/settings'

export class SettingsError extends Error {
  readonly status: number
  readonly code?: SettingsErrorBody['error']
  /** Why qBittorrent or Prowlarr didn't answer a check (`unreachable`), where the server could tell. */
  readonly failure?: ConnectionFailure
  /** The address was localhost inside Kinopeer's container (#509), and the host's, when known. */
  readonly container?: { hostAddress?: string }
  /** No login sent, and qBittorrent asks for one: where it sees Kinopeer come from, for its auth bypass (#509). */
  readonly source?: SourceAddress

  constructor(
    status: number,
    code?: SettingsErrorBody['error'],
    failure?: ConnectionFailure,
    hints: Pick<SettingsErrorBody, 'container' | 'source'> = {},
  ) {
    super(`Settings request failed (${code ?? status})`)
    this.name = 'SettingsError'
    this.status = status
    this.code = code
    this.failure = failure
    this.container = hints.container
    this.source = hints.source
  }
}

function isJson(response: Response): boolean {
  return response.headers.get('content-type')?.includes('application/json') ?? false
}

async function errorFor(response: Response): Promise<SettingsError> {
  const body = isJson(response) ? ((await response.json().catch(() => ({}))) as Partial<SettingsErrorBody>) : {}
  return new SettingsError(response.status, body.error, knownFailure(body.failure), {
    container: isContainerHint(body.container) ? body.container : undefined,
    source: isSourceAddress(body.source) ? body.source : undefined,
  })
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

async function send<T>(method: 'PUT' | 'PATCH' | 'POST', path: string, body: T): Promise<ServerSettings> {
  const response = await fetchKinopeer(`${SETTINGS_BASE}/${path}`, {
    method,
    headers: { 'Content-Type': 'application/json' },
    // A field left undefined (an address not sent) isn't in the JSON at all.
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
  return send<ProwlarrKeyBody>('PUT', 'prowlarr', { apiKey, url })
}

/**
 * Find (#511): the addresses where the server found `service` answering, for a form to offer; an
 * empty list when it found none. Rejects with code 'env-address' or 'auth-off' where an address
 * can't be saved from the app.
 */
export async function findAddresses(service: 'qbittorrent' | 'prowlarr', signal?: AbortSignal): Promise<string[]> {
  const response = await fetchKinopeer(`${SETTINGS_BASE}/${service}/find`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: '{}',
    signal,
  })
  if (!response.ok || !isJson(response)) throw await errorFor(response)
  const { addresses } = (await response.json()) as Partial<FoundAddresses>
  return Array.isArray(addresses) ? addresses.filter((address) => typeof address === 'string') : []
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
  return send<QbittorrentLoginBody>('PUT', 'qbittorrent', { username, password, url })
}

/** Saves some of the download defaults on the server; the others stay as they are. */
export function saveDownloadDefaults(changes: DownloadDefaultsBody): Promise<ServerSettings> {
  return send<DownloadDefaultsBody>('PATCH', 'downloads', changes)
}

/** A GET of one of the Telegram routes that answers something else than the settings. */
async function getTelegram<T>(path: string, signal?: AbortSignal): Promise<T> {
  const response = await fetchKinopeer(`${SETTINGS_BASE}/telegram/${path}`, { signal })
  if (!response.ok || !isJson(response)) throw await errorFor(response)
  return (await response.json()) as T
}

/**
 * Saves the Telegram bot's token on the server, which checks it with Telegram first. Rejects with a
 * SettingsError: code 'invalid-key' when Telegram doesn't know it, 'bad-request' when it isn't a
 * token, 'unreachable' when Telegram doesn't answer.
 */
export function saveTelegramToken(token: string): Promise<ServerSettings> {
  return send<TelegramTokenBody>('PUT', 'telegram', { token })
}

/**
 * The chat that last sent the bot /start, not saved yet, so the user sees it first. Rejects with
 * code 'no-chat' when none did, 'token-rejected', 'bot-in-use' when another program takes the bot's
 * updates (a webhook, or an app polling it), or 'unreachable'.
 */
export function findTelegramChat(signal?: AbortSignal): Promise<TelegramFoundChat> {
  return getTelegram<TelegramFoundChat>('chat', signal)
}

/**
 * Sends notifications to that chat, in `language`. Rejects with code 'no-chat' when it no longer
 * is one that sent /start, 'token-rejected', 'bot-in-use' or 'unreachable'.
 */
export function saveTelegramChat(id: number, language: NotifyLanguage): Promise<ServerSettings> {
  return send<TelegramChatBody>('PUT', 'telegram/chat', { id, language })
}

/**
 * Sends a test message in `language`. Rejects with code 'token-rejected' or 'chat-rejected' when
 * Telegram refused it, 'unreachable' when it didn't answer.
 */
export function testTelegram(language: NotifyLanguage): Promise<ServerSettings> {
  return send<TelegramTestBody>('POST', 'telegram/test', { language })
}

/**
 * Settings' connection check: the bot's name. Rejects with code 'not-configured' without a bot,
 * 'token-rejected' or 'unreachable'.
 */
export function checkTelegram(signal?: AbortSignal): Promise<TelegramCheck> {
  return getTelegram<TelegramCheck>('check', signal)
}

/** Forgets the Telegram bot: no more notifications through it. */
export function forgetTelegram(): Promise<ServerSettings> {
  return forget('telegram')
}
