import type {
  AddTorrentOptions,
  Category,
  FilePriority,
  MainData,
  SaveLocations,
  Torrent,
  TorrentFile,
  TorrentTracker,
  TorrentsQuery,
} from './types'
import { ProxySignInError, fetchKinopeer } from '../fetchKinopeer'

/** Same-origin prefix bridged to qBittorrent's Web API by server/qbittorrent.ts. */
export const QBITTORRENT_BASE = '/qbt/api/v2'

export class QbittorrentError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'QbittorrentError'
    this.status = status
  }
}

/**
 * The bridge's mark on each of its answers (`BRIDGE_HEADER` in server/qbittorrent.ts): a failure
 * without it never reached Kinopeer's server, a proxy in front answered for it.
 */
export const BRIDGE_HEADER = 'x-kinopeer-bridge'

/** A request failed without reaching Kinopeer's server: something in front of it answered. */
export class KinopeerUnreachableError extends QbittorrentError {
  constructor(status: number) {
    super(`Kinopeer's server did not answer (${status})`, status)
    this.name = 'KinopeerUnreachableError'
  }
}

/** Who didn't answer: Kinopeer's own server (or the way to it), or qBittorrent behind it. */
export type Unreachable = 'kinopeer' | 'qbittorrent'

/**
 * Who a failed request didn't get an answer from. Kinopeer's: the network failed (fetch's
 * TypeError), a proxy in front asked to sign in, or answered for the server. Otherwise
 * qBittorrent's, a request that took too long included: the bridge waits for qBittorrent, so a
 * request that hangs is most likely waiting on it.
 */
export function unreachable(error: unknown): Unreachable {
  return error instanceof TypeError || error instanceof ProxySignInError || error instanceof KinopeerUnreachableError ? 'kinopeer' : 'qbittorrent'
}

/** The server has no working qBittorrent login (the app asks for one, see src/api/settings). */
export class UnauthorizedError extends QbittorrentError {
  constructor() {
    super('Not logged in to qBittorrent', 403)
    this.name = 'UnauthorizedError'
  }
}

type Params = Record<string, string | number | boolean | undefined>

function toSearchParams(params: Params): URLSearchParams {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) search.set(key, String(value))
  }
  return search
}

async function request(
  path: string,
  init: { method?: 'GET' | 'POST'; params?: Params; form?: FormData; signal?: AbortSignal } = {},
): Promise<Response> {
  const { method = init.form ? 'POST' : 'GET', params = {} } = init
  const search = toSearchParams(params)
  const url = method === 'GET' && [...search].length ? `${QBITTORRENT_BASE}${path}?${search}` : `${QBITTORRENT_BASE}${path}`

  const response = await fetchKinopeer(url, {
    method,
    // The server forwards only requests that carry it (server/qbittorrent.ts): another site can't
    // add a header to a request without asking first, so it can't act through Kinopeer.
    headers: { 'X-Kinopeer': '1' },
    body: method === 'POST' ? (init.form ?? search) : undefined,
    signal: init.signal,
  })

  if (!response.ok && !response.headers.has(BRIDGE_HEADER)) throw new KinopeerUnreachableError(response.status)
  if (response.status === 401 || response.status === 403) throw new UnauthorizedError()
  if (!response.ok) throw new QbittorrentError(`qBittorrent responded ${response.status}`, response.status)
  return response
}

/**
 * qBittorrent version, e.g. "5.0.4": qBittorrent answers "v5.0.4", and the "v" goes so it's written
 * like Kinopeer's and Prowlarr's. Also a cheap way to check the session is valid.
 */
export async function getAppVersion(signal?: AbortSignal): Promise<string> {
  const response = await request('/app/version', { signal })
  return (await response.text()).trim().replace(/^v/, '')
}

export async function getTorrents(query: TorrentsQuery = {}): Promise<Torrent[]> {
  const { hashes, ...rest } = query
  const response = await request('/torrents/info', {
    params: { ...rest, hashes: hashes?.join('|') },
  })
  return (await response.json()) as Torrent[]
}

/** Incremental sync: pass the `rid` from the previous response (0 for a full snapshot). */
export async function getMainData(rid = 0, signal?: AbortSignal): Promise<MainData> {
  const response = await request('/sync/maindata', { params: { rid }, signal })
  return (await response.json()) as MainData
}

/**
 * Adds torrents from .torrent files and/or magnet or HTTP links. qBittorrent answers "Fails." when
 * none of them could be added (invalid file, or the torrent is already there).
 */
export async function addTorrents(options: AddTorrentOptions): Promise<void> {
  const {
    files = [],
    urls = [],
    tags = [],
    category,
    savePath,
    stopped,
    stopCondition,
    sequentialDownload,
    firstLastPiecePrio,
    addToTopOfQueue,
  } = options
  const form = new FormData()
  for (const file of files) form.append('torrents', file, file.name)
  if (urls.length) form.append('urls', urls.join('\n'))
  if (tags.length) form.append('tags', tags.join(','))
  if (category) form.append('category', category)
  if (savePath) form.append('savepath', savePath)
  if (stopCondition) form.append('stopCondition', stopCondition)
  if (sequentialDownload) form.append('sequentialDownload', 'true')
  if (firstLastPiecePrio) form.append('firstLastPiecePrio', 'true')
  if (addToTopOfQueue) form.append('addToTopOfQueue', 'true')
  if (stopped !== undefined) {
    // qBittorrent 5 renamed "paused" to "stopped"; send both so 4.x works too.
    form.append('stopped', String(stopped))
    form.append('paused', String(stopped))
  }
  const response = await request('/torrents/add', { form })
  if ((await response.text()).trim() === 'Fails.') throw new QbittorrentError('qBittorrent could not add the torrent', 200)
}

export async function getCategories(signal?: AbortSignal): Promise<Category[]> {
  const response = await request('/torrents/categories', { signal })
  return Object.values((await response.json()) as Record<string, Category>)
}

/** Where torrents go without a category or a save path of their own. */
export async function getDefaultSavePath(signal?: AbortSignal): Promise<string> {
  const response = await request('/app/defaultSavePath', { signal })
  return (await response.text()).trim()
}

/** The preferences that decide where qBittorrent puts a category's torrents. */
interface FolderPreferences {
  auto_tmm_enabled?: boolean
  /** qBittorrent 4.4+. */
  use_category_paths_in_manual_mode?: boolean
  use_subcategories?: boolean
  /** "When Torrent Category changed": relocate the torrent (true) or switch it to manual mode. */
  torrent_changed_tmm_enabled?: boolean
  /** "Keep incomplete torrents in". */
  temp_path_enabled?: boolean
}

/** Categories by name, the default save path and how qBittorrent uses category folders. */
export async function getSaveLocations(signal?: AbortSignal): Promise<SaveLocations> {
  const [categories, defaultPath, preferences] = await Promise.all([
    getCategories(signal).catch(() => []),
    getDefaultSavePath(signal).catch(() => ''),
    request('/app/preferences', { signal })
      .then((response) => response.json() as Promise<FolderPreferences>)
      // qBittorrent's defaults: manual mode, no subcategories.
      .catch((): FolderPreferences => ({})),
  ])
  return {
    categories: categories.sort((a, b) => a.name.localeCompare(b.name)),
    defaultPath,
    categoryPaths: !!(preferences.auto_tmm_enabled || preferences.use_category_paths_in_manual_mode),
    subcategories: !!preferences.use_subcategories,
    // qBittorrent relocates by default.
    relocateOnCategoryChange: preferences.torrent_changed_tmm_enabled !== false,
    downloadPath: !!preferences.temp_path_enabled,
  }
}

/**
 * How often qBittorrent updates the torrents' states it reports (ms): its "Refresh interval", or
 * undefined when it doesn't say.
 */
export async function getRefreshInterval(): Promise<number | undefined> {
  const preferences = (await (await request('/app/preferences')).json()) as { refresh_interval?: unknown }
  const interval = preferences.refresh_interval
  return typeof interval === 'number' && interval > 0 ? interval : undefined
}

/** Files of a torrent, in index order. Empty until a magnet link's metadata has arrived. */
export async function getTorrentFiles(hash: string): Promise<TorrentFile[]> {
  const response = await request('/torrents/files', { params: { hash } })
  return (await response.json()) as TorrentFile[]
}

export async function setFilePriority(hash: string, ids: readonly number[], priority: FilePriority): Promise<void> {
  if (!ids.length) return
  await request('/torrents/filePrio', { method: 'POST', params: { hash, id: ids.join('|'), priority } })
}

/** Posts to a qBittorrent 5 endpoint, falling back to its 4.x name when that one doesn't exist. */
async function postRenamed(path: string, legacyPath: string, params: Params): Promise<void> {
  try {
    await request(path, { method: 'POST', params })
  } catch (error) {
    if (!(error instanceof QbittorrentError && error.status === 404)) throw error
    await request(legacyPath, { method: 'POST', params })
  }
}

/** Starts (resumes) torrents: /torrents/start on qBittorrent 5, /torrents/resume on 4.x. */
export async function startTorrents(hashes: string[]): Promise<void> {
  await postRenamed('/torrents/start', '/torrents/resume', { hashes: hashes.join('|') })
}

/** Stops (pauses) torrents: /torrents/stop on qBittorrent 5, /torrents/pause on 4.x. */
export async function stopTorrents(hashes: string[]): Promise<void> {
  await postRenamed('/torrents/stop', '/torrents/pause', { hashes: hashes.join('|') })
}

/** Sets per-torrent speed limits in bytes/s; 0 removes a limit, and a limit left out stays as it is. */
export async function setSpeedLimits(hashes: string[], limits: { download?: number; upload?: number }): Promise<void> {
  const joined = hashes.join('|')
  const set = (path: string, limit: number | undefined) =>
    limit === undefined ? undefined : request(path, { method: 'POST', params: { hashes: joined, limit } })
  // Both run at once, and a failure waits for the other request, so a refresh after it sees both.
  const results = await Promise.allSettled([
    set('/torrents/setDownloadLimit', limits.download),
    set('/torrents/setUploadLimit', limits.upload),
  ])
  const failed = results.find((result): result is PromiseRejectedResult => result.status === 'rejected')
  if (failed) throw failed.reason
}

/**
 * Flips sequential download: qBittorrent has no call that sets it, so a request sent twice undoes
 * itself, and the caller checks the torrent's value first.
 */
export async function toggleSequentialDownload(hashes: string[]): Promise<void> {
  await request('/torrents/toggleSequentialDownload', { method: 'POST', params: { hashes: hashes.join('|') } })
}

/** Flips "first and last pieces first", which, like sequential download, can only be flipped. */
export async function toggleFirstLastPiecePrio(hashes: string[]): Promise<void> {
  await request('/torrents/toggleFirstLastPiecePrio', { method: 'POST', params: { hashes: hashes.join('|') } })
}

/**
 * Sets torrents' category, an empty one for none. Under automatic management qBittorrent then moves
 * their files to the category's folder, or turns automatic management off
 * (`SaveLocations.relocateOnCategoryChange`). It answers 409 for a category it doesn't have.
 */
export async function setCategory(hashes: string[], category: string): Promise<void> {
  await request('/torrents/setCategory', { method: 'POST', params: { hashes: hashes.join('|'), category } })
}

/** Rechecks torrents' downloaded data against their hashes; qBittorrent shows them as checking meanwhile. */
export async function recheckTorrents(hashes: string[]): Promise<void> {
  await request('/torrents/recheck', { method: 'POST', params: { hashes: hashes.join('|') } })
}

/** Announces torrents to all their trackers right away, without waiting for the next interval. */
export async function reannounceTorrents(hashes: string[]): Promise<void> {
  await request('/torrents/reannounce', { method: 'POST', params: { hashes: hashes.join('|') } })
}

/** Removes torrents from qBittorrent, and with `deleteFiles` their downloaded data too. */
export async function deleteTorrents(hashes: string[], deleteFiles: boolean): Promise<void> {
  await request('/torrents/delete', { method: 'POST', params: { hashes: hashes.join('|'), deleteFiles } })
}

/**
 * Moves torrents' files to `location`, creating it if needed. qBittorrent answers 409 when it can't
 * create the folder and 403 when it can't write there, but 403 is also its answer without a
 * session: the version check, which needs only a session, tells the two apart.
 */
export async function setTorrentLocation(hashes: string[], location: string): Promise<void> {
  try {
    await request('/torrents/setLocation', { method: 'POST', params: { hashes: hashes.join('|'), location } })
  } catch (error) {
    if (!(error instanceof UnauthorizedError)) throw error
    await getAppVersion()
    throw new QbittorrentError('qBittorrent cannot write to that folder', 403)
  }
}

/** Trackers of a torrent, including the DHT, PeX and LSD pseudo-trackers. */
export async function getTorrentTrackers(hash: string, signal?: AbortSignal): Promise<TorrentTracker[]> {
  const response = await request('/torrents/trackers', { params: { hash }, signal })
  return (await response.json()) as TorrentTracker[]
}

/** Switches between qBittorrent's global and alternative speed limits; `use_alt_speed_limits` shows which apply. */
export async function toggleSpeedLimitsMode(): Promise<void> {
  await request('/transfer/toggleSpeedLimitsMode', { method: 'POST' })
}
