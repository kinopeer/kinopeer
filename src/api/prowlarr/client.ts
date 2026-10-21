import type { MagnetResponse, ProwlarrErrorBody, Release, SearchType } from './types'

/** Same-origin prefix served by Kinoseed's Prowlarr bridge (server/prowlarr.ts). */
export const PROWLARR_BASE = '/prowlarr'

export class ProwlarrError extends Error {
  readonly status: number
  readonly code?: ProwlarrErrorBody['error']

  constructor(message: string, status: number, code?: ProwlarrErrorBody['error']) {
    super(message)
    this.name = 'ProwlarrError'
    this.status = status
    this.code = code
  }
}

/** PROWLARR_URL or PROWLARR_API_KEY isn't set on the server, or Prowlarr rejected the key. */
export class ProwlarrSetupError extends ProwlarrError {
  constructor(status: number, code?: ProwlarrErrorBody['error']) {
    super('Prowlarr is not configured or rejected the API key', status, code)
    this.name = 'ProwlarrSetupError'
  }
}

async function errorFor(response: Response): Promise<ProwlarrError> {
  let code: ProwlarrErrorBody['error'] | undefined
  if (response.headers.get('content-type')?.includes('application/json')) {
    code = ((await response.json().catch(() => ({}))) as Partial<ProwlarrErrorBody>).error
  }
  // No JSON at all: the server has no /prowlarr route (e.g. an old build), so treat it as setup.
  if (code === 'not-configured' || code === 'unauthorized' || !code) return new ProwlarrSetupError(response.status, code)
  return new ProwlarrError(`Prowlarr request failed (${code})`, response.status, code)
}

export interface SearchOptions {
  type?: SearchType
  /** Newznab category ids, e.g. MOVIE_CATEGORY. */
  categories?: number[]
  signal?: AbortSignal
}

export async function searchReleases(query: string, options: SearchOptions = {}): Promise<Release[]> {
  const { type = 'search', categories = [], signal } = options
  const params = new URLSearchParams({ query, type })
  for (const category of categories) params.append('categories', String(category))
  const response = await fetch(`${PROWLARR_BASE}/search?${params}`, { credentials: 'omit', signal })
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw await errorFor(response)
  return (await response.json()) as Release[]
}

export type ReleaseSource = { kind: 'magnet'; uri: string } | { kind: 'torrent'; file: File }

/** Gets what qBittorrent needs to add a release: its magnet link or its .torrent file. */
export async function fetchRelease(release: Release, signal?: AbortSignal): Promise<ReleaseSource> {
  if (release.magnet) return { kind: 'magnet', uri: release.magnet }
  if (!release.download) throw new ProwlarrError('The release has no download link', 404, 'not-found')

  const params = new URLSearchParams({ token: release.download })
  const response = await fetch(`${PROWLARR_BASE}/download?${params}`, { credentials: 'omit', signal })
  if (!response.ok) throw await errorFor(response)
  if (response.headers.get('content-type')?.includes('application/json')) {
    return { kind: 'magnet', uri: ((await response.json()) as MagnetResponse).magnet }
  }
  const name = `${release.title.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'release'}.torrent`
  return { kind: 'torrent', file: new File([await response.arrayBuffer()], name, { type: 'application/x-bittorrent' }) }
}
