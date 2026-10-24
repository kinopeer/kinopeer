import { useEffect, useMemo, useRef, useState } from 'react'
import type { Matches, StoredMatch } from '../api/matches'
import type { Torrent } from '../api/qbittorrent'
import { getMovie, getTv, searchTitles, toTitle, type MediaType, type Title } from '../api/tmdb'
import { useTmdbLanguage } from '../settings/settings'
import { parseName, tmdbTag, type ParsedName } from './parseName'
import { chooseMatch, forgetServerGuesses, rememberMatches, useServerMatches } from './serverMatches'

/** What a download row needs from TMDB. */
export type TitleMatch = Pick<Title, 'type' | 'id' | 'title' | 'year' | 'posterPath'>

interface Lookup {
  key: string
  /** A known title: the user's choice, the `tmdb:` tag or a saved guess. */
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

// Bump when matching changes, so earlier guesses, in this browser and on the server, are redone.
export const GUESS_VERSION = 2

function known(type: MediaType, id: number): Lookup {
  return { key: `id:${type}:${id}`, tag: { type, id } }
}

/**
 * How to find a torrent's title: the user's choice first, then the `tmdb:` tag Kinoseed adds with a
 * release, then a guess the server keeps, and only then a new guess from the release name.
 */
export function lookupFor(
  torrent: Pick<Torrent, 'name' | 'tags'> & { category?: string },
  stored?: StoredMatch,
): Lookup {
  if (stored?.source === 'user') return known(stored.type, stored.id)
  const tag = tmdbTag(torrent.tags ?? '')
  if (tag) return known(tag.type, tag.id)
  if (stored?.source === 'guess' && stored.version === GUESS_VERSION) return known(stored.type, stored.id)
  const parsed = parseName(torrent.name)
  const hint = parsed.type ? undefined : categoryType(torrent.category)
  const type = parsed.type ?? (hint ? `~${hint}` : '')
  return { key: `q:${type}:${parsed.year ?? ''}:${parsed.title.toLocaleLowerCase()}`, parsed, hint }
}

/** Whether a torrent's title was guessed from its name: neither the user's choice nor the `tmdb:` tag. */
export function isGuessed(torrent: Pick<Torrent, 'tags'>, stored?: StoredMatch): boolean {
  return stored?.source !== 'user' && !tmdbTag(torrent.tags ?? '')
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

function slim(title: TitleMatch): TitleMatch {
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

// Titles and guesses are cached per browser so the list doesn't hit TMDB for every torrent on every
// visit; guesses are also saved on the server, so other devices don't have to make them again.
const CACHE_KEY = `kinoseed.titleMatches.v${GUESS_VERSION}`
const HIT_TTL_MS = 30 * 24 * 3600 * 1000
const MISS_TTL_MS = 24 * 3600 * 1000
// A guessed torrent takes two: its guess by name and its title by id.
const MAX_ENTRIES = 1000

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

function writeCache(changes: Record<string, TitleMatch | null>): void {
  const entries = loadCache()
  const at = Date.now()
  for (const [key, match] of Object.entries(changes)) entries[key] = { match, at }
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

/**
 * Saves the user's choice of title for a torrent on the server (picking the guessed title confirms
 * it). Its title is cached first, so every screen shows it without asking TMDB again.
 */
export async function chooseTitle(hash: string, title: TitleMatch, language: string): Promise<void> {
  writeCache({ [`${language}|${known(title.type, title.id).key}`]: slim(title) })
  await chooseMatch(hash, title)
}

/** Forgets cached titles and guesses here and on the server; the user's choices stay. */
export async function clearTitleMatches(): Promise<void> {
  clearTitleMatchCache()
  await forgetServerGuesses()
}

/** Forgets what this browser cached. */
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
  const language = useTmdbLanguage()
  const [version, setVersion] = useState(0)
  const server = useServerMatches()

  const lookups = useMemo(() => {
    const byHash: Record<string, Lookup> = {}
    for (const torrent of torrents) byHash[torrent.hash] = lookupFor(torrent, server?.[torrent.hash])
    return byHash
  }, [torrents, server])

  const lookupsRef = useRef(lookups)
  useEffect(() => {
    lookupsRef.current = lookups
  })

  // New guesses wait for the server's matches: another device may have made them already.
  const pendingKey = [
    ...new Set(Object.values(lookups).flatMap((lookup) => (lookup.tag || server ? [lookup.key] : []))),
  ]
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
          writeCache({ [`${language}|${lookup.key}`]: match })
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

  // Guesses go to the server, so other devices show the same title without guessing. The title is
  // cached under its id as well, which is how it is looked up once the server has the guess.
  useEffect(() => {
    if (!server) return
    const guesses: Matches = {}
    const titles: Record<string, TitleMatch> = {}
    for (const [hash, lookup] of Object.entries(lookups)) {
      const match = lookup.tag ? undefined : readCache(`${language}|${lookup.key}`)
      if (!match) continue
      guesses[hash] = { type: match.type, id: match.id, source: 'guess', version: GUESS_VERSION }
      const idKey = `${language}|${known(match.type, match.id).key}`
      if (readCache(idKey) === undefined) titles[idKey] = match
    }
    if (Object.keys(titles).length > 0) writeCache(titles)
    rememberMatches(guesses)
  }, [lookups, server, language, version])

  const matches: Record<string, TitleMatch | null | undefined> = {}
  for (const [hash, lookup] of Object.entries(lookups)) matches[hash] = readCache(`${language}|${lookup.key}`)
  return matches
}
