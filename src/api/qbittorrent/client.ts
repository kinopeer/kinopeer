import type { Torrent, TorrentsQuery } from './types'

/** Same-origin prefix proxied to qBittorrent's Web UI (Vite in dev, nginx in production). */
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

async function request(path: string, init: { method?: 'GET' | 'POST'; params?: Params } = {}): Promise<Response> {
  const { method = 'GET', params = {} } = init
  const search = toSearchParams(params)
  const url = method === 'GET' && [...search].length ? `${QBITTORRENT_BASE}${path}?${search}` : `${QBITTORRENT_BASE}${path}`

  const response = await fetch(url, {
    method,
    credentials: 'same-origin',
    body: method === 'POST' ? search : undefined,
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
  if (!response.ok) throw new QbittorrentError(`qBittorrent responded ${response.status}`, response.status)
  // qBittorrent answers 200 with "Fails." for wrong credentials and "Ok." (or an empty 204) on success.
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
