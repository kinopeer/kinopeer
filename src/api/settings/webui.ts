// Kinopeer's settings in the WebUI build, where there's no Kinopeer server: qBittorrent keeps them in
// its `clientdata` store (5.2+), so every device that signs in to that qBittorrent has the same. The
// client (./client.ts) sends its calls here in that build and answers with the same `ServerSettings`,
// so the screens read one shape on both builds (docs/ARCHITECTURE.md → Settings in qBittorrent).
import { isPrivateOrigin } from '../../logic/privateOrigin'
import { sharedRequests } from '../../logic/sharedRequests'
import { withTimeout } from '../../logic/withTimeout'
import { checkProwlarrKey } from '../../releases/prowlarrResults'
import { isStoreFull, loadClientData, storeClientData, type ClientData } from '../qbittorrent/webui'
import { checkTmdbKey } from '../tmdb/direct'
import { SettingsError } from './errors'
import type { DownloadDefaults, ServerSettings } from './types'

/**
 * The key of each setting in qBittorrent's store, with Kinopeer's prefix, since qBittorrent's own
 * interface and any other keep theirs there too. A key per setting, and a save sends only the keys
 * it changes, which qBittorrent merges one by one, so two devices changing different settings don't
 * overwrite each other. Prowlarr's address and key are one key: a key belongs to its address. A
 * Record, so a download default added to `DownloadDefaults` fails typecheck until it has a key.
 */
export const SETTING_KEYS = {
  tmdbKey: 'kinopeer.tmdbKey',
  prowlarr: 'kinopeer.prowlarr',
  movieCategory: 'kinopeer.downloads.movieCategory',
  tvCategory: 'kinopeer.downloads.tvCategory',
  startPaused: 'kinopeer.downloads.startPaused',
  sequential: 'kinopeer.downloads.sequential',
  firstLastPieces: 'kinopeer.downloads.firstLastPieces',
  notify: 'kinopeer.downloads.notify',
} as const satisfies Record<'tmdbKey' | 'prowlarr' | keyof DownloadDefaults, `kinopeer.${string}`>

/** Prowlarr as the browser calls it: its address and API key, saved together. */
export interface StoredProwlarr {
  url: string
  apiKey: string
}

/** What qBittorrent keeps of Kinopeer's settings, as read from its store. */
export interface WebuiSettings {
  /** The user's own TMDB key (a v3 key or a v4 token); null without one. */
  tmdbKey: string | null
  /** Prowlarr's address and key; null until saved. */
  prowlarr: StoredProwlarr | null
  /** The download defaults saved so far, as the server's `downloads` has them: null picks a category automatically. */
  downloads: Partial<DownloadDefaults>
}

/**
 * The key the store's answer is shared under on the page (`sharedRequests`): the values of
 * `SETTING_KEYS` as qBittorrent keeps them. Every save merges what it stored into it.
 */
export const WEBUI_SETTINGS_KEY = 'webui|settings'

/** As long as the server's settings are taken without asking again (`SERVER_SETTINGS_FRESH_MS`), for the same reasons. */
export const WEBUI_SETTINGS_FRESH_MS = 60_000

/**
 * A category set to pick automatically, as the store keeps it: a null would remove the key, which
 * would read as never set, and a device that had set a category would then send its own back
 * (`loadServerSettings` sends what the store doesn't have). No qBittorrent category is named "".
 */
const AUTOMATIC = ''

/**
 * What each download default is in the store: a category's name, or a switch. A Record, so a default
 * added to `DownloadDefaults` fails typecheck until it's read too.
 */
const DEFAULT_KINDS = {
  movieCategory: 'category',
  tvCategory: 'category',
  startPaused: 'switch',
  sequential: 'switch',
  firstLastPieces: 'switch',
  notify: 'switch',
} as const satisfies Record<keyof DownloadDefaults, 'category' | 'switch'>

const nonEmpty = (value: unknown): value is string => typeof value === 'string' && value !== ''

/** Kinopeer's settings in `data`, the store's answer; what isn't the shape it writes is left out. */
export function readSettings(data: ClientData): WebuiSettings {
  const downloads: Record<string, string | boolean | null> = {}
  for (const [key, kind] of Object.entries(DEFAULT_KINDS)) {
    const value = data[SETTING_KEYS[key as keyof DownloadDefaults]]
    if (kind === 'category' && typeof value === 'string') downloads[key] = value === AUTOMATIC ? null : value
    if (kind === 'switch' && typeof value === 'boolean') downloads[key] = value
  }
  const prowlarr = data[SETTING_KEYS.prowlarr] as Partial<StoredProwlarr> | null | undefined
  const tmdbKey = data[SETTING_KEYS.tmdbKey]
  return {
    tmdbKey: nonEmpty(tmdbKey) ? tmdbKey : null,
    prowlarr: nonEmpty(prowlarr?.url) && nonEmpty(prowlarr.apiKey) ? { url: prowlarr.url, apiKey: prowlarr.apiKey } : null,
    downloads: downloads as Partial<DownloadDefaults>,
  }
}

/**
 * The build has Kinopeer's TMDB proxy (`__TMDB_PROXY__`) and the page's origin is one it answers (a
 * private one, `isPrivateOrigin`, as the proxy reads it), so TMDB works without a key of the user's own.
 */
export function sharedTmdbAvailable(): boolean {
  // Read through globalThis, as the clients also run in Node (the integration tests), where there's no page.
  return __TMDB_PROXY__ !== '' && isPrivateOrigin((globalThis as { location?: { origin: string } }).location?.origin ?? null)
}

/**
 * `stored` in the shape the server answers, which the screens read: no secret in it, only whether
 * each is set; nothing of what only a server has (its login, notifications, an address from its
 * environment). `shared`: Kinopeer's TMDB key serves the page without one of the user's own.
 */
export function asServerSettings(stored: WebuiSettings, shared: boolean): ServerSettings {
  const ownTmdbKey = stored.tmdbKey !== null
  return {
    tmdb: {
      configured: ownTmdbKey || shared,
      source: ownTmdbKey ? 'saved' : shared ? 'shared' : null,
      fallback: ownTmdbKey && shared ? 'shared' : null,
    },
    prowlarr: {
      configured: stored.prowlarr !== null,
      source: stored.prowlarr ? 'saved' : null,
      address: stored.prowlarr ? { source: 'saved', url: stored.prowlarr.url } : { source: null },
      serverKey: false,
    },
    // The page's own qBittorrent: no login or address to keep.
    qbittorrent: { configured: true, source: null, address: { source: null } },
    downloads: stored.downloads,
  }
}

async function loadStored(signal: AbortSignal): Promise<ClientData> {
  return loadClientData(Object.values(SETTING_KEYS), signal)
}

/**
 * Kinopeer's settings as qBittorrent keeps them, shared with the page's other callers while
 * `WEBUI_SETTINGS_FRESH_MS` fresh; `renew` asks qBittorrent anew. Where TMDB's client reads the key it
 * calls TMDB with (src/api/tmdb/transport.ts) and Prowlarr's its address and key (src/api/prowlarr/direct.ts).
 */
export async function getWebuiSettings(signal?: AbortSignal, renew = false): Promise<WebuiSettings> {
  return readSettings(await sharedRequests.get(WEBUI_SETTINGS_KEY, loadStored, { freshFor: WEBUI_SETTINGS_FRESH_MS, signal, renew }))
}

/** `GET /api/settings` in this build: asked of qBittorrent anew, which the page's settings answer (`SERVER_SETTINGS_KEY`) shares. */
export async function loadWebuiServerSettings(signal?: AbortSignal): Promise<ServerSettings> {
  return asServerSettings(await getWebuiSettings(signal, true), sharedTmdbAvailable())
}

/**
 * Stores `changes` (a null removes its key) and answers the settings with them. What qBittorrent
 * keeps besides is read first, the page's answer while it's fresh, so once qBittorrent has taken the
 * change nothing more can fail the save; the page's newest answer then takes the change in (another
 * save's, settled meanwhile, among it), so callers don't read what was there before. Throws `SettingsError` with `store-full` when qBittorrent's
 * store has no room for them, and the transport's errors when qBittorrent doesn't answer or take them.
 */
async function store(changes: ClientData): Promise<ServerSettings> {
  const kept = await sharedRequests.get(WEBUI_SETTINGS_KEY, loadStored, { freshFor: WEBUI_SETTINGS_FRESH_MS })
  try {
    await storeClientData(changes)
  } catch (error) {
    if (isStoreFull(error)) throw new SettingsError(409, 'store-full')
    throw error
  }
  // Not `kept` alone: a save or a load that settled while this one was on its way set a newer answer.
  const merged: ClientData = { ...(sharedRequests.peek<ClientData>(WEBUI_SETTINGS_KEY, Infinity)?.data ?? kept), ...changes }
  for (const key of Object.keys(changes)) if (changes[key] === null) delete merged[key]
  sharedRequests.set(WEBUI_SETTINGS_KEY, merged)
  return asServerSettings(readSettings(merged), sharedTmdbAvailable())
}

/**
 * Checks the user's own TMDB key with TMDB, then saves it, trimmed, as the server does: rejects with
 * code 'bad-request' for an empty key or one with a space inside, 'invalid-key' for one TMDB
 * refuses and 'unreachable' when TMDB doesn't answer the check, and stores nothing then.
 */
export async function saveWebuiTmdbKey(apiKey: string): Promise<ServerSettings> {
  const key = apiKey.trim()
  if (key === '' || /\s/.test(key)) throw new SettingsError(400, 'bad-request')
  let valid: boolean
  try {
    valid = await checkTmdbKey(key)
  } catch {
    throw new SettingsError(502, 'unreachable')
  }
  if (!valid) throw new SettingsError(422, 'invalid-key')
  return store({ [SETTING_KEYS.tmdbKey]: key })
}

/** Forgets the user's TMDB key, for Kinopeer's; 'no-server-key' where the proxy doesn't answer this page. */
export function forgetWebuiTmdbKey(): Promise<ServerSettings> {
  if (!sharedTmdbAvailable()) return Promise.reject(new SettingsError(409, 'no-server-key'))
  return store({ [SETTING_KEYS.tmdbKey]: null })
}

/** Longer than any service address, as the server's limit (`MAX_ADDRESS_LENGTH` in server/address.ts). */
const MAX_ADDRESS_LENGTH = 2048

/**
 * The address the browser will call Prowlarr at, or undefined when it isn't one: http or https,
 * with no login (the key has its own field), query or fragment, a path kept for a reverse proxy, and
 * no trailing slash, and no longer than `MAX_ADDRESS_LENGTH`. The server's rule for a Prowlarr
 * address from the app (`parseAddress` in server/address.ts), which the image doesn't share: of src/
 * it ships only the modules the Dockerfile copies.
 */
export function prowlarrAddress(value: string): string | undefined {
  if (value.length > MAX_ADDRESS_LENGTH) return undefined
  let url: URL
  try {
    // The URL parser drops spaces around it itself.
    url = new URL(value)
  } catch {
    return undefined
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return undefined
  if (url.username || url.password || url.search || url.hash) return undefined
  return `${url.origin}${url.pathname}`.replace(/\/+$/, '')
}

/** How long a Prowlarr key's check waits, as the server's (`ADDRESS_CHECK_TIMEOUT_MS` in server/settings.ts). */
export const PROWLARR_CHECK_TIMEOUT_MS = 15_000

/**
 * Whether a page at `pageProtocol` can't call Prowlarr at `address`: the browser blocks a plain HTTP
 * call from a page served over HTTPS (mixed content), but for a loopback address, which it trusts.
 */
export function isMixedContent(pageProtocol: string | undefined, address: string): boolean {
  if (pageProtocol !== 'https:') return false
  const { protocol, hostname } = new URL(address)
  if (protocol !== 'http:') return false
  const loopback = hostname === 'localhost' || hostname.endsWith('.localhost') || hostname === '[::1]' || /^127\.\d+\.\d+\.\d+$/.test(hostname)
  return !loopback
}

/**
 * Checks Prowlarr's key at `url` or the address saved before, as the server does, then saves both
 * together. Rejects with code 'bad-request' for an empty key, 'invalid-address' for an address that
 * isn't one, 'not-configured' with no address at all, 'mixed-content' for a plain HTTP address on a
 * page served over HTTPS, 'invalid-key' for a key Prowlarr refuses, 'not-prowlarr' for an address
 * where something else answers and 'unreachable' when nothing answers in time, and stores nothing then.
 */
export async function saveWebuiProwlarr(apiKey: string, url?: string): Promise<ServerSettings> {
  const key = apiKey.trim()
  if (key === '') throw new SettingsError(400, 'bad-request')
  const address = url === undefined ? (await getWebuiSettings()).prowlarr?.url : prowlarrAddress(url)
  if (address === undefined) throw new SettingsError(url === undefined ? 409 : 400, url === undefined ? 'not-configured' : 'invalid-address')
  // Read through globalThis, as the clients also run in Node (the integration tests), where there's no page.
  if (isMixedContent((globalThis as { location?: { protocol: string } }).location?.protocol, address)) throw new SettingsError(400, 'mixed-content')
  let result: Awaited<ReturnType<typeof checkProwlarrKey>>
  try {
    result = await withTimeout(PROWLARR_CHECK_TIMEOUT_MS, new AbortController().signal, (signal) => checkProwlarrKey(address, key, signal))
  } catch {
    throw new SettingsError(502, 'unreachable')
  }
  if (result === 'invalid') throw new SettingsError(422, 'invalid-key')
  if (result === 'not-prowlarr') throw new SettingsError(502, 'not-prowlarr')
  return store({ [SETTING_KEYS.prowlarr]: { url: address, apiKey: key } satisfies StoredProwlarr })
}

/** How long Find waits for Prowlarr at each address: a host that drops the connection answers nothing. */
export const FIND_TIMEOUT_MS = 3000

/** Prowlarr's port as it installs. */
const PROWLARR_PORT = 9696

/**
 * Where Find looks for Prowlarr from the page (#560): on Prowlarr's port at qBittorrent's own host,
 * on this device and at Prowlarr's usual name, over plain HTTP as Prowlarr installs, leaving out an
 * address the browser would block as mixed content.
 */
export function prowlarrCandidates(page: { protocol: string; hostname: string }): string[] {
  const hosts = [page.hostname, 'localhost', 'prowlarr']
  const addresses = [...new Set(hosts.map((host) => `http://${host}:${PROWLARR_PORT}`))]
  return addresses.filter((address) => !isMixedContent(page.protocol, address))
}

/**
 * Whether Prowlarr answers at `address`: its API's 401 without a key, which it lets any origin read,
 * while another service sends no CORS (the page can't read its answer) or answers otherwise.
 */
async function answersAsProwlarr(address: string, signal: AbortSignal): Promise<boolean> {
  try {
    return await withTimeout(FIND_TIMEOUT_MS, signal, async (timed) => {
      // No header, so no preflight: a plain GET, as any page may send.
      const response = await fetch(`${address}/api/v1/system/status`, { signal: timed })
      await response.body?.cancel()
      return response.status === 401
    })
  } catch (error) {
    // Given up by the caller: an abort, not an address where nothing answers.
    if (signal.aborted) throw error
    return false
  }
}

/** The addresses among `prowlarrCandidates` where Prowlarr answers, in their order, for this page. */
export async function findWebuiProwlarr(signal: AbortSignal = new AbortController().signal): Promise<string[]> {
  // Read through globalThis, as saveWebuiProwlarr does: the clients also run in Node.
  const page = (globalThis as { location?: { protocol: string; hostname: string } }).location
  if (!page) return []
  const candidates = prowlarrCandidates(page)
  const answers = await Promise.all(candidates.map((address) => answersAsProwlarr(address, signal)))
  return candidates.filter((_address, index) => answers[index])
}

/** Saves the download defaults in `changes`, each under its own key; the others stay as they are. */
export function saveWebuiDownloadDefaults(changes: Partial<DownloadDefaults>): Promise<ServerSettings> {
  const values: ClientData = {}
  for (const [key, value] of Object.entries(changes) as [keyof DownloadDefaults, DownloadDefaults[keyof DownloadDefaults] | undefined][]) {
    if (value !== undefined) values[SETTING_KEYS[key]] = value ?? AUTOMATIC
  }
  return store(values)
}
