import { MAX_FAILING_WITHIN_MS, type FailingIndexers, type MagnetResponse, type ProwlarrErrorBody, type ProwlarrStatus, type Release, type SearchType } from './types'
import { knownFailure } from '../connectionFailure'
import { downloadDirect, failingDirect, searchDirect, statusDirect } from './direct'
import { ProwlarrError, ProwlarrSetupError } from './errors'
import { fetchKinopeer } from '../fetchKinopeer'
import { KinopeerUnreachableError } from '../qbittorrent/client'

export { ProwlarrError, ProwlarrKeyReadError, ProwlarrSetupError } from './errors'

/** Same-origin prefix served by Kinopeer's Prowlarr bridge (server/prowlarr.ts). */
export const PROWLARR_BASE = '/prowlarr'

async function errorFor(response: Response): Promise<ProwlarrError | KinopeerUnreachableError> {
  let body: Partial<ProwlarrErrorBody> = {}
  if (response.headers.get('content-type')?.includes('application/json')) {
    body = (await response.json().catch(() => ({}))) as Partial<ProwlarrErrorBody>
  }
  const code = body.error
  // The bridge answers every failure with its code: without one, something in front of the server
  // answered for it (a proxy's error page), or a server without the bridge did (#566).
  if (!code) return new KinopeerUnreachableError(response.status)
  if (code === 'not-configured' || code === 'unauthorized') return new ProwlarrSetupError(response.status, code)
  return new ProwlarrError(`Prowlarr request failed (${code})`, response.status, code, knownFailure(body.failure))
}

export interface SearchOptions {
  type?: SearchType
  /** Newznab category ids, e.g. MOVIE_CATEGORY. */
  categories?: number[]
  signal?: AbortSignal
}

export async function searchReleases(query: string, options: SearchOptions = {}): Promise<Release[]> {
  const { type = 'search', categories = [], signal } = options
  // The WebUI build calls Prowlarr itself, with the key qBittorrent keeps (./direct.ts).
  if (__WEBUI__) return searchDirect(query, type, categories, signal)
  const params = new URLSearchParams({ query, type })
  for (const category of categories) params.append('categories', String(category))
  const response = await fetchKinopeer(`${PROWLARR_BASE}/search?${params}`, { signal })
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw await errorFor(response)
  return (await response.json()) as Release[]
}

/**
 * Names of the enabled indexers that failed in the last `elapsedMs` (since a search started) or
 * that Prowlarr has put on hold, so a search can say whose results are missing. A duration rather
 * than a time, so the server dates it by its own clock, not this device's.
 */
export async function getFailingIndexers(elapsedMs: number, signal?: AbortSignal): Promise<string[]> {
  // The server takes ten minutes at most. A page left open longer (or a clock that kept counting
  // through sleep) still gets a note about the last ten minutes.
  const within = Math.min(MAX_FAILING_WITHIN_MS, Math.max(0, Math.round(elapsedMs)))
  if (__WEBUI__) return failingDirect(within, signal)
  const params = new URLSearchParams({ within: String(within) })
  const response = await fetchKinopeer(`${PROWLARR_BASE}/failing?${params}`, { signal })
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw await errorFor(response)
  return ((await response.json()) as FailingIndexers).indexers
}

/** Checks the connection: Prowlarr's version and how many indexers are enabled. */
export async function getProwlarrStatus(signal?: AbortSignal): Promise<ProwlarrStatus> {
  if (__WEBUI__) return statusDirect(signal)
  const response = await fetchKinopeer(`${PROWLARR_BASE}/status`, { signal })
  if (!response.ok || !response.headers.get('content-type')?.includes('application/json')) throw await errorFor(response)
  return (await response.json()) as ProwlarrStatus
}

/**
 * What qBittorrent is given to add a release: a magnet link, a .torrent, or, in the WebUI build, the
 * download link Prowlarr answered with a redirect, which qBittorrent follows itself (`link`).
 */
export type ReleaseSource = { kind: 'magnet'; uri: string } | { kind: 'torrent'; file: File } | { kind: 'link'; uri: string }

/**
 * Gets what qBittorrent needs to add a release. The .torrent file comes first, because it lists the
 * files before adding; the magnet link is the fallback.
 */
export async function fetchRelease(release: Release, signal?: AbortSignal): Promise<ReleaseSource> {
  const magnet = release.magnet ? ({ kind: 'magnet', uri: release.magnet } as const) : undefined
  if (!release.download) {
    if (magnet) return magnet
    throw new ProwlarrError('The release has no download link', 404, 'not-found')
  }
  try {
    return await download(release, release.download, signal)
  } catch (error) {
    if (magnet && !signal?.aborted) return magnet
    throw error
  }
}

async function download(release: Release, token: string, signal?: AbortSignal): Promise<ReleaseSource> {
  if (__WEBUI__) {
    const got = await downloadDirect(token, signal)
    if (got.kind === 'file') return { kind: 'torrent', file: torrentFile(release, got.bytes) }
    // A magnet link names the torrent's hash, so the sheet can tell whether qBittorrent has it; a link doesn't.
    return release.magnet ? { kind: 'magnet', uri: release.magnet } : { kind: 'link', uri: got.url }
  }
  const params = new URLSearchParams({ token })
  const response = await fetchKinopeer(`${PROWLARR_BASE}/download?${params}`, { signal })
  if (!response.ok) throw await errorFor(response)
  if (response.headers.get('content-type')?.includes('application/json')) {
    return { kind: 'magnet', uri: ((await response.json()) as MagnetResponse).magnet }
  }
  // A view, not the buffer itself: typed as a blob part by the DOM's and Node's File alike.
  return { kind: 'torrent', file: torrentFile(release, new Uint8Array(await response.arrayBuffer())) }
}

/** The .torrent's bytes as a file named after the release. */
function torrentFile(release: Release, bytes: Uint8Array<ArrayBuffer>): File {
  const name = `${release.title.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim() || 'release'}.torrent`
  return new File([bytes], name, { type: 'application/x-bittorrent' })
}
