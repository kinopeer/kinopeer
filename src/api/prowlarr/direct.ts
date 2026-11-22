// Prowlarr called straight from the browser, in the WebUI build, which has no Kinopeer server to keep
// its key: the address and key qBittorrent keeps (src/api/settings/webui.ts), the key in `X-Api-Key`.
// Prowlarr answers any origin's CORS, its 401s and the `X-Api-Key` preflight included, so the page
// does what Kinopeer's bridge does (server/prowlarr.ts), with the same reading of Prowlarr's answers
// (src/releases/prowlarrResults.ts). The key in the browser is a stated exception (docs/SPEC.md's
// decision log, 2026-11-22).
import { withTimeout } from '../../logic/withTimeout'
import {
  downloadUrl,
  enabledIndexers,
  failedIds,
  indexerNames,
  isTorrentFile,
  searchQuery,
  toReleases,
  type ProwlarrIndexer,
  type ProwlarrIndexerStatus,
  type ProwlarrRelease,
} from '../../releases/prowlarrResults'
import { getWebuiSettings, type StoredProwlarr } from '../settings/webui'
import { ProwlarrError, ProwlarrKeyReadError, ProwlarrSetupError } from './errors'
import type { ProwlarrStatus, Release, SearchType } from './types'

/** How long the failing indexers' note waits for Prowlarr, as the bridge's (`failingTimeoutMs`). */
export const FAILING_TIMEOUT_MS = 5000

/**
 * What a download gives: a .torrent's bytes, or, when Prowlarr answers with a redirect (a magnet link,
 * or the indexer's own link), which the page can't follow or read, the link itself for qBittorrent,
 * which follows it, with the key in its query.
 */
export type DirectDownload = { kind: 'file'; bytes: Uint8Array<ArrayBuffer> } | { kind: 'link'; url: string }

/** Prowlarr as qBittorrent keeps it for this browser; `ProwlarrKeyReadError` when qBittorrent doesn't give it. */
async function prowlarr(signal?: AbortSignal): Promise<StoredProwlarr> {
  let stored: StoredProwlarr | null
  try {
    stored = (await getWebuiSettings(signal)).prowlarr
  } catch (error) {
    // Given up by the caller: an abort like any other call's.
    if (signal?.aborted) throw error
    throw new ProwlarrKeyReadError(error)
  }
  if (!stored) throw new ProwlarrSetupError(503, 'not-configured')
  return stored
}

/**
 * Prowlarr's refusal as the bridge's code says it: a 401 is a key it refuses, a download's 404 a
 * release it no longer has, anything else an answer that isn't the one asked for.
 */
function refusal(status: number, download = false): ProwlarrError {
  if (status === 401) return new ProwlarrSetupError(status, 'unauthorized')
  if (download && status === 404) return new ProwlarrError('Prowlarr has no such download', status, 'not-found')
  return new ProwlarrError(`Prowlarr responded ${status}`, status, 'upstream')
}

/** JSON of `path` from Prowlarr; fetch's own error when nothing answers, `ProwlarrError` for an answer that isn't Prowlarr's JSON. */
async function json<T>({ url, apiKey }: StoredProwlarr, path: string, signal?: AbortSignal): Promise<T> {
  // No cookie: Prowlarr takes the key, and a cross-origin request sends none by default anyway.
  const response = await fetch(`${url}${path}`, { headers: { 'X-Api-Key': apiKey, Accept: 'application/json' }, signal })
  if (!response.ok) {
    // Free the connection now rather than when the body is collected.
    await response.body?.cancel()
    throw refusal(response.status)
  }
  try {
    return (await response.json()) as T
  } catch {
    // A proxy's login page, say: not Prowlarr's answer.
    throw new ProwlarrError('Prowlarr answered with no JSON', 502, 'upstream')
  }
}

/** Prowlarr's search, as the bridge's `/prowlarr/search`: the releases Kinopeer can add. */
export async function searchDirect(term: string, type: SearchType, categories: number[], signal?: AbortSignal): Promise<Release[]> {
  const stored = await prowlarr(signal)
  const items = await json<unknown>(stored, `/api/v1/search?${searchQuery(term, type, categories)}`, signal)
  if (!Array.isArray(items)) throw new ProwlarrError('Prowlarr answered with no list', 502, 'upstream')
  return toReleases(items as ProwlarrRelease[])
}

/** Prowlarr's version and how many indexers are enabled, as the bridge's `/prowlarr/status`. */
export async function statusDirect(signal?: AbortSignal): Promise<ProwlarrStatus> {
  const stored = await prowlarr(signal)
  const [system, indexers] = await Promise.all([
    json<{ version?: string }>(stored, '/api/v1/system/status', signal),
    json<ProwlarrIndexer[]>(stored, '/api/v1/indexer', signal),
  ])
  return { version: system.version ?? '', indexers: Array.isArray(indexers) ? enabledIndexers(indexers) : 0 }
}

/**
 * The enabled indexers that failed in the last `withinMs` or are on hold, as the bridge's
 * `/prowlarr/failing`. Dated by this device's clock against Prowlarr's, as the page can read no
 * other: a device whose clock is off by more than a search takes names an older failure or misses one.
 */
export async function failingDirect(withinMs: number, signal: AbortSignal = new AbortController().signal): Promise<string[]> {
  const since = Date.now() - withinMs
  // A note beside the results isn't worth a request that hangs.
  return withTimeout(FAILING_TIMEOUT_MS, signal, async (timed) => {
    const stored = await prowlarr(timed)
    const statuses = await json<ProwlarrIndexerStatus[]>(stored, '/api/v1/indexerstatus', timed)
    if (!Array.isArray(statuses)) throw new ProwlarrError('Prowlarr answered with no list', 502, 'upstream')
    const failed = failedIds(statuses, since, Date.now())
    // The indexer list carries every indexer's full definition: fetch it only to name a failure.
    if (!failed.size) return []
    const indexers = await json<ProwlarrIndexer[]>(stored, '/api/v1/indexer', timed)
    if (!Array.isArray(indexers)) throw new ProwlarrError('Prowlarr answered with no list', 502, 'upstream')
    return indexerNames(indexers, failed)
  })
}

/** The release behind a download token, as the bridge's `/prowlarr/download`. */
export async function downloadDirect(token: string, signal?: AbortSignal): Promise<DirectDownload> {
  const stored = await prowlarr(signal)
  const url = downloadUrl(stored.url, token, stored.apiKey)
  if (!url) throw new ProwlarrError('Not a download token', 400, 'bad-request')
  // The key is in the query, as qBittorrent will need it should Prowlarr redirect, so the request
  // needs no header, nor a preflight. A redirect isn't followed: the page could read neither a magnet
  // link nor, without CORS, the indexer's own answer.
  const response = await fetch(url, { redirect: 'manual', signal })
  if (response.type === 'opaqueredirect') return { kind: 'link', url: url.href }
  if (!response.ok) {
    await response.body?.cancel()
    throw refusal(response.status, true)
  }
  const bytes = new Uint8Array(await response.arrayBuffer())
  if (!isTorrentFile(bytes)) throw new ProwlarrError('Prowlarr answered with no .torrent', 502, 'upstream')
  return { kind: 'file', bytes }
}
