// Kinopeer's settings in the WebUI build, where there's no Kinopeer server: qBittorrent keeps them in
// its `clientdata` store (5.2+), so every device that signs in to that qBittorrent has the same. The
// client (./client.ts) sends its calls here in that build and answers with the same `ServerSettings`,
// so the screens read one shape on both builds (docs/ARCHITECTURE.md → Settings in qBittorrent).
import { isPrivateOrigin } from '../../logic/privateOrigin'
import { sharedRequests } from '../../logic/sharedRequests'
import { isStoreFull, loadClientData, storeClientData, type ClientData } from '../qbittorrent/webui'
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
 * The page's origin is one Kinopeer's TMDB proxy answers (a private one, `isPrivateOrigin`, as the
 * proxy reads it), so TMDB works without a key of the user's own.
 */
export function sharedTmdbAvailable(): boolean {
  // Read through globalThis, as the clients also run in Node (the integration tests), where there's no page.
  return isPrivateOrigin((globalThis as { location?: { origin: string } }).location?.origin ?? null)
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
 * `WEBUI_SETTINGS_FRESH_MS` fresh; `renew` asks qBittorrent anew. Where TMDB's and Prowlarr's
 * clients will read the keys they call with once this build calls them itself (#559, #560).
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
 * change nothing more can fail the save; the page's answer then takes the change in, so callers
 * don't read what was there before. Throws `SettingsError` with `store-full` when qBittorrent's
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
  const merged: ClientData = { ...kept, ...changes }
  for (const key of Object.keys(changes)) if (changes[key] === null) delete merged[key]
  sharedRequests.set(WEBUI_SETTINGS_KEY, merged)
  return asServerSettings(readSettings(merged), sharedTmdbAvailable())
}

/**
 * Saves the user's own TMDB key. Not checked with TMDB yet: the WebUI build calls TMDB itself from
 * #559 on. Rejects with code 'bad-request' for an empty key, as the server does.
 */
export function saveWebuiTmdbKey(apiKey: string): Promise<ServerSettings> {
  if (apiKey === '') return Promise.reject(new SettingsError(400, 'bad-request'))
  return store({ [SETTING_KEYS.tmdbKey]: apiKey })
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
 * address from the app (`parseAddress` in server/address.ts), which the image can't share, since it
 * ships server/ alone.
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

/**
 * Saves Prowlarr's address and key together, at `url` or the address saved before. Not checked with
 * Prowlarr yet: the WebUI build calls Prowlarr itself from #560 on. Rejects with code 'bad-request'
 * for an empty key, 'invalid-address' for an address that isn't one, and 'not-configured' with no
 * address at all, as the server does.
 */
export async function saveWebuiProwlarr(apiKey: string, url?: string): Promise<ServerSettings> {
  if (apiKey === '') throw new SettingsError(400, 'bad-request')
  const address = url === undefined ? (await getWebuiSettings()).prowlarr?.url : prowlarrAddress(url)
  if (address === undefined) throw new SettingsError(url === undefined ? 409 : 400, url === undefined ? 'not-configured' : 'invalid-address')
  return store({ [SETTING_KEYS.prowlarr]: { url: address, apiKey } satisfies StoredProwlarr })
}

/** Saves the download defaults in `changes`, each under its own key; the others stay as they are. */
export function saveWebuiDownloadDefaults(changes: Partial<DownloadDefaults>): Promise<ServerSettings> {
  const values: ClientData = {}
  for (const [key, value] of Object.entries(changes) as [keyof DownloadDefaults, DownloadDefaults[keyof DownloadDefaults] | undefined][]) {
    if (value !== undefined) values[SETTING_KEYS[key]] = value ?? AUTOMATIC
  }
  return store(values)
}
