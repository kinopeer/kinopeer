import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Torrent } from '../api/qbittorrent'
import { getMovie, getTv, searchTitles, tmdbLanguage, toTitle, type Title } from '../api/tmdb'
import { parseName, tmdbTag, type ParsedName } from './parseName'

/** What a download row needs from TMDB. */
export type TitleMatch = Pick<Title, 'type' | 'id' | 'title' | 'year' | 'posterPath'>

interface Lookup {
  key: string
  tag?: { type: Title['type']; id: number }
  parsed?: ParsedName
}

export function lookupFor(torrent: Pick<Torrent, 'name' | 'tags'>): Lookup {
  const tag = tmdbTag(torrent.tags ?? '')
  if (tag) return { key: `id:${tag.type}:${tag.id}`, tag }
  const parsed = parseName(torrent.name)
  return { key: `q:${parsed.type ?? ''}:${parsed.year ?? ''}:${parsed.title.toLocaleLowerCase()}`, parsed }
}

/**
 * Picks the search result a release name most likely refers to. With a year, a movie must match
 * it (±1 for festival vs. wide release); a series' year may be a later season's, so it only ranks.
 */
export function pickBest(titles: Title[], parsed: ParsedName): Title | null {
  const candidates = parsed.type ? titles.filter((title) => title.type === parsed.type) : titles
  if (!parsed.year) return candidates[0] ?? null
  const near = (title: Title) => title.year !== undefined && Math.abs(title.year - parsed.year!) <= 1
  const best = candidates.find((title) => title.year === parsed.year) ?? candidates.find(near)
  if (best) return best
  const series = candidates.find((title) => title.type === 'tv')
  return series ?? null
}

function slim(title: Title): TitleMatch {
  return { type: title.type, id: title.id, title: title.title, year: title.year, posterPath: title.posterPath }
}

async function resolve(lookup: Lookup, language: string, signal: AbortSignal): Promise<TitleMatch | null> {
  if (lookup.tag) {
    const { type, id } = lookup.tag
    const details = type === 'movie' ? await getMovie(id, { language, signal }) : await getTv(id, { language, signal })
    return slim(toTitle(details, type))
  }
  const { titles } = await searchTitles(lookup.parsed!.title, { language, signal })
  const best = pickBest(titles, lookup.parsed!)
  return best ? slim(best) : null
}

// Matches are cached per browser so the list doesn't hit TMDB for every torrent on every visit.
const CACHE_KEY = 'kinoseed.titleMatches.v1'
const HIT_TTL_MS = 30 * 24 * 3600 * 1000
const MISS_TTL_MS = 24 * 3600 * 1000
const MAX_ENTRIES = 500

interface CacheEntry {
  match: TitleMatch | null
  at: number
}

let cache: Record<string, CacheEntry> | undefined

function loadCache(): Record<string, CacheEntry> {
  if (!cache) {
    try {
      cache = JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}') as Record<string, CacheEntry>
    } catch {
      cache = {}
    }
  }
  return cache
}

function readCache(key: string, now = Date.now()): TitleMatch | null | undefined {
  const entry = loadCache()[key]
  if (!entry) return undefined
  return now - entry.at < (entry.match ? HIT_TTL_MS : MISS_TTL_MS) ? entry.match : undefined
}

function writeCache(key: string, match: TitleMatch | null): void {
  const entries = loadCache()
  entries[key] = { match, at: Date.now() }
  const keys = Object.keys(entries)
  if (keys.length > MAX_ENTRIES) {
    keys.sort((a, b) => entries[a].at - entries[b].at)
    for (const old of keys.slice(0, keys.length - MAX_ENTRIES)) delete entries[old]
  }
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify(entries))
  } catch {
    // Storage full or blocked: the in-memory copy still saves requests for this session.
  }
}

/** For tests. */
export function clearTitleMatchCache(): void {
  cache = undefined
  try {
    localStorage.removeItem(CACHE_KEY)
  } catch {
    // Nothing to clear.
  }
}

const CONCURRENCY = 3

/**
 * TMDB title for each torrent, by hash: the match, null when there is none, or undefined while
 * unknown (still looking it up, or TMDB is unavailable).
 */
export function useTitleMatches(torrents: Pick<Torrent, 'hash' | 'name' | 'tags'>[]): Record<string, TitleMatch | null | undefined> {
  const { i18n } = useTranslation()
  const language = tmdbLanguage(i18n.resolvedLanguage ?? i18n.language)
  const [, setVersion] = useState(0)

  const lookups = useMemo(() => {
    const byHash: Record<string, Lookup> = {}
    for (const torrent of torrents) byHash[torrent.hash] = lookupFor(torrent)
    return byHash
  }, [torrents])

  const lookupsRef = useRef(lookups)
  useEffect(() => {
    lookupsRef.current = lookups
  })

  const pendingKey = [...new Set(Object.values(lookups).map((lookup) => lookup.key))]
    .filter((key) => readCache(`${language}|${key}`) === undefined)
    .sort()
    .join('\n')

  useEffect(() => {
    if (!pendingKey) return
    const controller = new AbortController()
    const all = Object.values(lookupsRef.current)
    const queue = pendingKey.split('\n').map((key) => all.find((lookup) => lookup.key === key)!)

    const worker = async () => {
      for (let lookup = queue.shift(); lookup && !controller.signal.aborted; lookup = queue.shift()) {
        try {
          const match = await resolve(lookup, language, controller.signal)
          writeCache(`${language}|${lookup.key}`, match)
          setVersion((n) => n + 1)
        } catch {
          // Offline, no key or rate-limited: leave it unknown; the next visit tries again.
          if (controller.signal.aborted) return
        }
      }
    }
    void Promise.all(Array.from({ length: CONCURRENCY }, worker))
    return () => controller.abort()
  }, [pendingKey, language])

  const matches: Record<string, TitleMatch | null | undefined> = {}
  for (const [hash, lookup] of Object.entries(lookups)) matches[hash] = readCache(`${language}|${lookup.key}`)
  return matches
}
