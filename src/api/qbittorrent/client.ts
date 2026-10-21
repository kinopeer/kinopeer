import type { AddTorrentOptions, FilePriority, MainData, Torrent, TorrentFile, TorrentsQuery } from './types'

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

/** Wrong username or password. */
export class InvalidCredentialsError extends QbittorrentError {
  constructor() {
    super('Invalid username or password', 200)
    this.name = 'InvalidCredentialsError'
  }
}

/** Too many failed logins: qBittorrent bans the client IP for a while. */
export class IpBannedError extends QbittorrentError {
  constructor() {
    super('Too many failed login attempts; the IP is temporarily banned', 403)
    this.name = 'IpBannedError'
  }
}

/** No valid session cookie. */
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

export async function login(username: string, password: string): Promise<void> {
  const response = await fetch(`${QBITTORRENT_BASE}/auth/login`, {
    method: 'POST',
    credentials: 'same-origin',
    body: new URLSearchParams({ username, password }),
  })
  if (response.status === 403) throw new IpBannedError()
  // qBittorrent 5.3+ answers wrong credentials with 401; older versions with 200 "Fails.".
  if (response.status === 401) throw new InvalidCredentialsError()
  if (!response.ok) throw new QbittorrentError(`qBittorrent responded ${response.status}`, response.status)
  // Success is "Ok." (or an empty 204).
  const text = (await response.text()).trim()
  if (text === 'Fails.') throw new InvalidCredentialsError()
}

export async function logout(): Promise<void> {
  await request('/auth/logout', { method: 'POST' })
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
  const { files = [], urls = [], tags = [], category, savePath, stopped, stopCondition } = options
  const form = new FormData()
  for (const file of files) form.append('torrents', file, file.name)
  if (urls.length) form.append('urls', urls.join('\n'))
  if (tags.length) form.append('tags', tags.join(','))
  if (category) form.append('category', category)
  if (savePath) form.append('savepath', savePath)
  if (stopCondition) form.append('stopCondition', stopCondition)
  if (stopped !== undefined) {
    // qBittorrent 5 renamed "paused" to "stopped"; send both so 4.x works too.
    form.append('stopped', String(stopped))
    form.append('paused', String(stopped))
  }
  const response = await request('/torrents/add', { form })
  if ((await response.text()).trim() === 'Fails.') throw new QbittorrentError('qBittorrent could not add the torrent', 200)
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

/** Starts (resumes) torrents: /torrents/start on qBittorrent 5, /torrents/resume on 4.x. */
export async function startTorrents(hashes: string[]): Promise<void> {
  const params = { hashes: hashes.join('|') }
  try {
    await request('/torrents/start', { method: 'POST', params })
  } catch (error) {
    if (!(error instanceof QbittorrentError && error.status === 404)) throw error
    await request('/torrents/resume', { method: 'POST', params })
  }
}
