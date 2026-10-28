import type {
  AddTorrentOptions,
  Category,
  FilePriority,
  MainData,
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
  const { files = [], urls = [], tags = [], category, savePath, stopped, stopCondition, sequentialDownload, addToTopOfQueue } =
    options
  const form = new FormData()
  for (const file of files) form.append('torrents', file, file.name)
  if (urls.length) form.append('urls', urls.join('\n'))
  if (tags.length) form.append('tags', tags.join(','))
  if (category) form.append('category', category)
  if (savePath) form.append('savepath', savePath)
  if (stopCondition) form.append('stopCondition', stopCondition)
  if (sequentialDownload) form.append('sequentialDownload', 'true')
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

/** Sets per-torrent speed limits in bytes/s; 0 removes a limit, and a limit left out stays as it is. */
export async function setSpeedLimits(hashes: string[], limits: { download?: number; upload?: number }): Promise<void> {
  const joined = hashes.join('|')
  if (limits.download !== undefined) {
    await request('/torrents/setDownloadLimit', { method: 'POST', params: { hashes: joined, limit: limits.download } })
  }
  if (limits.upload !== undefined) {
    await request('/torrents/setUploadLimit', { method: 'POST', params: { hashes: joined, limit: limits.upload } })
  }
}

/** Removes torrents from qBittorrent, and with `deleteFiles` their downloaded data too. */
export async function deleteTorrents(hashes: string[], deleteFiles: boolean): Promise<void> {
  await request('/torrents/delete', { method: 'POST', params: { hashes: hashes.join('|'), deleteFiles } })
}

/** Trackers of a torrent, including the DHT, PeX and LSD pseudo-trackers. */
export async function getTorrentTrackers(hash: string): Promise<TorrentTracker[]> {
  const response = await request('/torrents/trackers', { params: { hash } })
  return (await response.json()) as TorrentTracker[]
}
