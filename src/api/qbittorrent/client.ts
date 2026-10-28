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
  init: { method?: 'GET' | 'POST'; params?: Params; form?: FormData } = {},
): Promise<Response> {
  const { method = init.form ? 'POST' : 'GET', params = {} } = init
  const search = toSearchParams(params)
  const url = method === 'GET' && [...search].length ? `${QBITTORRENT_BASE}${path}?${search}` : `${QBITTORRENT_BASE}${path}`

  const response = await fetch(url, {
    method,
    credentials: 'same-origin',
    body: method === 'POST' ? (init.form ?? search) : undefined,
  })

  if (response.status === 401 || response.status === 403) throw new UnauthorizedError()
  if (!response.ok) throw new QbittorrentError(`qBittorrent responded ${response.status}`, response.status)
  return response
}

/** qBittorrent version, e.g. "v5.0.4". Also a cheap way to check the session is valid. */
export async function getAppVersion(): Promise<string> {
  const response = await request('/app/version')
  return (await response.text()).trim()
}

/** Web API version, e.g. "2.11.4". */
export async function getApiVersion(): Promise<string> {
  const response = await request('/app/webapiVersion')
  return (await response.text()).trim()
}

export async function getTorrents(query: TorrentsQuery = {}): Promise<Torrent[]> {
  const { hashes, ...rest } = query
  const response = await request('/torrents/info', {
    params: { ...rest, hashes: hashes?.join('|') },
  })
  return (await response.json()) as Torrent[]
}

/** Incremental sync: pass the `rid` from the previous response (0 for a full snapshot). */
export async function getMainData(rid = 0): Promise<MainData> {
  const response = await request('/sync/maindata', { params: { rid } })
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

export async function getCategories(): Promise<Category[]> {
  const response = await request('/torrents/categories')
  return Object.values((await response.json()) as Record<string, Category>)
}

/** Where torrents go without a category or a save path of their own. */
export async function getDefaultSavePath(): Promise<string> {
  const response = await request('/app/defaultSavePath')
  return (await response.text()).trim()
}

/** The preferences that decide where qBittorrent puts a category's torrents. */
interface FolderPreferences {
  auto_tmm_enabled?: boolean
  /** qBittorrent 4.4+. */
  use_category_paths_in_manual_mode?: boolean
  use_subcategories?: boolean
}

/** Categories by name, the default save path and how qBittorrent uses category folders. */
export async function getSaveLocations(): Promise<SaveLocations> {
  const [categories, defaultPath, preferences] = await Promise.all([
    getCategories().catch(() => []),
    getDefaultSavePath().catch(() => ''),
    request('/app/preferences').then(
      (response) => response.json() as Promise<FolderPreferences>,
      // qBittorrent's defaults: manual mode, no subcategories.
      (): FolderPreferences => ({}),
    ),
  ])
  return {
    categories: categories.sort((a, b) => a.name.localeCompare(b.name)),
    defaultPath,
    categoryPaths: !!(preferences.auto_tmm_enabled || preferences.use_category_paths_in_manual_mode),
    subcategories: !!preferences.use_subcategories,
  }
}

/** Files of a torrent, in index order. Empty until a magnet link's metadata has arrived. */
export async function getTorrentFiles(hash: string): Promise<TorrentFile[]> {
  const response = await request('/torrents/files', { params: { hash } })
  return (await response.json()) as TorrentFile[]
}

export async function setFilePriority(hash: string, ids: number[], priority: FilePriority): Promise<void> {
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
export async function getTorrentTrackers(hash: string): Promise<TorrentTracker[]> {
  const response = await request('/torrents/trackers', { params: { hash } })
  return (await response.json()) as TorrentTracker[]
}
