// What Kinopeer reads from Prowlarr's API, shared by Kinopeer's server (server/prowlarr.ts) and the
// WebUI build, which calls Prowlarr from the page (src/api/prowlarr/direct.ts). The server imports it
// as it runs, so the image ships this file beside server/ (the Dockerfile), and its imports are types
// alone, with their `.ts` paths, as Node's type stripping reads them.
import type { Release, SearchType } from '../api/prowlarr/types.ts'

/** What Kinopeer reads from Prowlarr's /api/v1/search results. */
export interface ProwlarrRelease {
  guid?: string
  title?: string
  indexer?: string
  size?: number
  seeders?: number
  leechers?: number
  publishDate?: string
  infoUrl?: string
  categories?: { id: number }[]
  infoHash?: string
  magnetUrl?: string
  downloadUrl?: string
  imdbId?: number
  tmdbId?: number
  protocol?: string
}

/** What Kinopeer reads from Prowlarr's /api/v1/indexer. */
export interface ProwlarrIndexer {
  id?: number
  name?: string
  enable?: boolean
}

/** What Kinopeer reads from Prowlarr's /api/v1/indexerstatus: indexers that have failed lately. */
export interface ProwlarrIndexerStatus {
  indexerId?: number
  /** ISO date until which Prowlarr skips the indexer. */
  disabledTill?: string
  mostRecentFailure?: string
}

/** The query of Prowlarr's /api/v1/search for a search: at most 100 results. */
export function searchQuery(term: string, type: SearchType, categories: readonly (number | string)[]): URLSearchParams {
  const params = new URLSearchParams({ query: term, type, limit: '100' })
  for (const category of categories) params.append('categories', String(category))
  return params
}

/**
 * Prowlarr download links look like {base}/{indexerId}/download?apikey=…&link=…&file=…. The token
 * keeps the indexer id and the query without the key, so the link can be rebuilt later with it.
 */
export function downloadToken(link: string | undefined): string | undefined {
  if (!link) return undefined
  let url: URL
  try {
    url = new URL(link)
  } catch {
    return undefined
  }
  const match = /\/(\d+)\/download$/.exec(url.pathname)
  if (!match) return undefined
  url.searchParams.delete('apikey')
  return `${match[1]}/download?${url.searchParams}`
}

/** The download link a token stands for at `base`, with `apiKey` in its query; undefined for anything but a token. */
export function downloadUrl(base: string, token: string, apiKey: string): URL | undefined {
  const match = /^(\d+)\/download\?(.*)$/.exec(token)
  if (!match) return undefined
  const params = new URLSearchParams(match[2])
  params.delete('apikey')
  params.set('apikey', apiKey)
  // The /api/ path, not Prowlarr's /{id}/download alias: proxies in front of Prowlarr (e.g. Umbrel's
  // app auth) often let only /api/* through without their own login.
  return new URL(`${base}/api/v1/indexer/${match[1]}/download?${params}`)
}

/** A search result as the UI takes it, without the links that carry the key; undefined for one it can't add. */
export function toRelease(item: ProwlarrRelease): Release | undefined {
  if (!item.guid || !item.title || (item.protocol && item.protocol !== 'torrent')) return undefined
  const magnet = item.magnetUrl?.startsWith('magnet:') ? item.magnetUrl : undefined
  const download = downloadToken(item.downloadUrl) ?? (magnet ? undefined : downloadToken(item.magnetUrl))
  if (!magnet && !download) return undefined
  return {
    id: item.guid,
    title: item.title,
    indexer: item.indexer ?? '',
    size: item.size ?? 0,
    seeders: item.seeders,
    leechers: item.leechers,
    publishDate: item.publishDate,
    infoUrl: item.infoUrl,
    categories: (item.categories ?? []).map((category) => category.id),
    infoHash: item.infoHash?.toLowerCase(),
    magnet,
    download,
    imdbId: item.imdbId || undefined,
    tmdbId: item.tmdbId || undefined,
  }
}

/** The releases Kinopeer can add among Prowlarr's search results. */
export function toReleases(items: ProwlarrRelease[]): Release[] {
  return items.map(toRelease).filter((release): release is Release => release !== undefined)
}

/** A .torrent is a bencoded dictionary, which starts with "d"; anything else (a proxy's login page) isn't one. */
export const BENCODE_DICT = 0x64

/** The largest .torrent taken. */
export const MAX_TORRENT_BYTES = 20 * 1024 * 1024

/** Whether `bytes` can be a .torrent: a bencoded dictionary no larger than `MAX_TORRENT_BYTES`. */
export function isTorrentFile(bytes: Uint8Array): boolean {
  return bytes.length <= MAX_TORRENT_BYTES && bytes[0] === BENCODE_DICT
}

/**
 * Ids of the indexers that failed at or after `since`, or that are on hold now. Prowlarr's search
 * answers 200 with whatever the other indexers found, so this is the only way to tell.
 */
export function failedIds(statuses: ProwlarrIndexerStatus[], since: number, now: number): Set<number> {
  return new Set(
    statuses
      .filter(
        (status) =>
          Date.parse(status.disabledTill ?? '') > now || Date.parse(status.mostRecentFailure ?? '') >= since,
      )
      .map((status) => status.indexerId)
      // A row without an id is malformed, never a failure.
      .filter((id): id is number => typeof id === 'number'),
  )
}

/** Names of the enabled indexers among `ids`, sorted. */
export function indexerNames(indexers: ProwlarrIndexer[], ids: Set<number>): string[] {
  return indexers
    .filter((indexer) => indexer.enable && indexer.name && typeof indexer.id === 'number' && ids.has(indexer.id))
    .map((indexer) => indexer.name!)
    .sort((a, b) => a.localeCompare(b))
}

/** How many of Prowlarr's indexers are enabled. */
export function enabledIndexers(indexers: ProwlarrIndexer[]): number {
  return indexers.filter((indexer) => indexer.enable).length
}

/**
 * Whether Prowlarr at `base` takes `apiKey`: 'invalid' when it answers 401, 'not-prowlarr' when
 * the answer isn't Prowlarr's status (a proxy's login page, an app's index.html, another app's 404).
 * Throws when it doesn't answer, answers with a server error, a 408 or a 429, or `signal` aborts first.
 */
export async function checkProwlarrKey(
  base: string,
  apiKey: string,
  signal?: AbortSignal,
): Promise<'valid' | 'invalid' | 'not-prowlarr'> {
  const response = await fetch(`${base}/api/v1/system/status`, {
    headers: { 'X-Api-Key': apiKey, Accept: 'application/json' },
    signal,
  })
  if (response.status === 401) return 'invalid'
  // Prowlarr's status answers whenever it runs; another error of the caller's is another app there,
  // but a timeout or a rate limit (a proxy in front, say) is one to try again.
  if (response.status >= 400 && response.status < 500 && response.status !== 408 && response.status !== 429) return 'not-prowlarr'
  if (!response.ok) throw new Error(`Prowlarr answered ${response.status}`)
  const body = (await response.json().catch(() => undefined)) as { version?: unknown } | undefined
  return typeof body?.version === 'string' ? 'valid' : 'not-prowlarr'
}
