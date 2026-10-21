import { useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Torrent } from '../api/qbittorrent'
import { getMovie, getTv, searchTitles, tmdbLanguage, toTitle, type MediaType, type Title } from '../api/tmdb'
import { parseName, tmdbTag, type ParsedName } from './parseName'

/** What a download row needs from TMDB. */
export type TitleMatch = Pick<Title, 'type' | 'id' | 'title' | 'year' | 'posterPath'>

interface Lookup {
  key: string
  tag?: { type: Title['type']; id: number }
  parsed?: ParsedName
  /** From the qBittorrent category ("Movies", "TV Shows", "Сериалы"): a hint, not a filter. */
  hint?: MediaType
}

const TV_CATEGORY = /\b(?:tv|series|shows?)\b|сериал/iu
const MOVIE_CATEGORY = /\b(?:movies?|films?)\b|фильм|кино/iu

export function categoryType(category: string | undefined): MediaType | undefined {
  if (!category) return undefined
  if (TV_CATEGORY.test(category)) return 'tv'
  if (MOVIE_CATEGORY.test(category)) return 'movie'
  return undefined
}

export function lookupFor(torrent: Pick<Torrent, 'name' | 'tags'> & { category?: string }): Lookup {
  const tag = tmdbTag(torrent.tags ?? '')
  if (tag) return { key: `id:${tag.type}:${tag.id}`, tag }
  const parsed = parseName(torrent.name)
  const hint = parsed.type ? undefined : categoryType(torrent.category)
  const type = parsed.type ?? (hint ? `~${hint}` : '')
  return { key: `q:${type}:${parsed.year ?? ''}:${parsed.title.toLocaleLowerCase()}`, parsed, hint }
}

function normalize(text: string): string {
  return text
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
}

/**
 * Picks the search result a release name most likely refers to.
 *
 * Season markers in the name make it a series. Otherwise, with a year, movies come first (or the
 * category's type): a movie must match the year (±1 for festival vs. wide release), while a series'
 * year may be a later season's, so a series of another year is the last resort. Without a year,
 * TMDB's order stands unless the category says otherwise. An exact name (localized or original)
 * beats the year being off by one, and a "<name>: Subtitle" spin-off ranks after the rest.
 */
export function pickBest(titles: Title[], parsed: ParsedName, hint?: MediaType): Title | null {
  const candidates = parsed.type ? titles.filter((title) => title.type === parsed.type) : titles
  const name = normalize(parsed.title)
  const names = (title: Title) => [title.title, title.originalTitle]
  const exactName = (title: Title) => names(title).some((text) => normalize(text) === name)
  const spinOff = (title: Title) =>
    names(title).some((text) => text.includes(':') && normalize(text.slice(0, text.indexOf(':'))) === name)
  const first = (list: Title[]) =>
    list.find(exactName) ?? list.find((title) => !spinOff(title)) ?? list[0]

  const preferred = parsed.type ?? hint ?? (parsed.year ? 'movie' : undefined)
  const groups = preferred
    ? [candidates.filter((title) => title.type === preferred), candidates.filter((title) => title.type !== preferred)]
    : [candidates]

  if (!parsed.year) return groups.map(first).find(Boolean) ?? null
  const year = parsed.year
  const exact = (title: Title) => title.year === year
  const near = (title: Title) => title.year !== undefined && Math.abs(title.year - year) <= 1
  for (const group of groups) {
    const named = group.filter(exactName)
    const best = named.find(exact) ?? named.find(near) ?? first(group.filter(exact)) ?? first(group.filter(near))
    if (best) return best
  }
  return first(candidates.filter((title) => title.type === 'tv')) ?? null
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
  const best = pickBest(titles, lookup.parsed!, lookup.hint)
  return best ? slim(best) : null
}

// Matches are cached per browser so the list doesn't hit TMDB for every torrent on every visit.
// Bump the version when matching changes, so earlier guesses are redone.
const CACHE_KEY = 'kinoseed.titleMatches.v2'
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
export function useTitleMatches(
  torrents: (Pick<Torrent, 'hash' | 'name' | 'tags'> & { category?: string })[],
): Record<string, TitleMatch | null | undefined> {
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
