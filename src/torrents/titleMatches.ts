import { useEffect, useMemo, useRef, useState } from 'react'
import type { Matches, StoredMatch } from '../api/matches'
import type { Torrent } from '../api/qbittorrent'
import { TmdbError, getMovie, getTv, searchTitles, toTitle, type MediaType, type Title } from '../api/tmdb'
import { useTmdbLanguage } from '../settings/settings'
import { parseName, tmdbTag, type ParsedName } from './parseName'
import { chooseMatch, forgetServerGuesses, rememberMatches, useServerMatches } from './serverMatches'

/** What a download row needs from TMDB. */
export type TitleMatch = Pick<Title, 'type' | 'id' | 'title' | 'year' | 'posterPath'>

/** Whether two titles are the same TMDB title. */
export const sameTitle = (a: Pick<Title, 'type' | 'id'> | null | undefined, b: Pick<Title, 'type' | 'id'> | null | undefined) =>
  !!a && !!b && a.type === b.type && a.id === b.id

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

/** The Downloads type filter: every torrent, or movies or series only. */
export type TypeFilter = 'all' | MediaType

export const TYPE_FILTERS: readonly TypeFilter[] = ['all', 'movie', 'tv']

/**
 * Whether a torrent is a movie or a series: the matched title's type, else what the lookup knows
 * without TMDB (a known title, season markers in the name, the category). Undefined when nothing
 * says, so the torrent shows only under All.
 */
export function titleType(
  torrent: Pick<Torrent, 'name' | 'tags'> & { category?: string },
  stored?: StoredMatch,
  match?: TitleMatch | null,
): MediaType | undefined {
  if (match) return match.type
  const lookup = lookupFor(torrent, stored)
  return lookup.tag?.type ?? lookup.parsed?.type ?? lookup.hint
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

/** Caches titles in memory; `storeCache` writes them to localStorage. */
function cacheTitles(changes: Record<string, TitleMatch | null>): void {
  const entries = loadCache()
  const at = Date.now()
  for (const [key, match] of Object.entries(changes)) entries[key] = { match, at }
}

function storeCache(): void {
  const entries = loadCache()
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

function writeCache(changes: Record<string, TitleMatch | null>): void {
  cacheTitles(changes)
  storeCache()
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
 * While titles keep coming, they show at most this often: each time the whole list renders again
 * and the cache is written to localStorage, which for a library of hundreds costs more than the
 * answer itself (#239).
 */
export const SHOW_EVERY_MS = 250
/** A request TMDB hasn't answered in this long is given up, and counts as failed. */
export const LOOKUP_TIMEOUT_MS = 15_000
/**
 * How long a failed lookup waits before it's asked again, longer after each failure, then every
 * last one: not with every change to the list, which would keep asking a TMDB that's down, or the
 * shared proxy over its limit per IP.
 */
export const RETRY_DELAYS_MS = [30_000, 120_000, 600_000]
/** How long a 429 without Retry-After stops the lookups; Kinoseed's proxy asks for 10 s. */
export const RATE_LIMIT_WAIT_MS = 10_000

/** Runs `request` with a signal that aborts with `signal` or after `ms`. */
async function withTimeout<T>(ms: number, signal: AbortSignal, request: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const attempt = new AbortController()
  const abort = () => attempt.abort()
  signal.addEventListener('abort', abort)
  const timer = setTimeout(abort, ms)
  try {
    return await request(attempt.signal)
  } finally {
    clearTimeout(timer)
    signal.removeEventListener('abort', abort)
  }
}

interface LookupRun {
  /** The lookups still wanted: new ones join the queue, those gone from it are dropped. */
  want(lookups: Lookup[]): void
  stop(): void
}

/**
 * Looks titles up in one language, CONCURRENCY at a time, each key once: a title that arrives or a
 * torrent that comes doesn't stop or repeat the others. A lookup that fails or times out is asked
 * again after RETRY_DELAYS_MS; a 429 stops them all for its Retry-After, then puts its lookup back
 * in line. `onShow` is called as titles arrive, at most every SHOW_EVERY_MS, once they're cached.
 * Stopped, it sends nothing more.
 */
function startLookups(language: string, onShow: () => void): LookupRun {
  const controller = new AbortController()
  const { signal } = controller
  // Keys taken by a worker: in flight, found, or waiting to be asked again.
  const started = new Set<string>()
  const failures = new Map<string, number>()
  let wanted: Lookup[] = []
  let queue: Lookup[] = []
  let workers = 0
  let resumeAt = 0
  let resumeTimer: ReturnType<typeof setTimeout> | undefined
  let shownAt = 0
  let showTimer: ReturnType<typeof setTimeout> | undefined

  const show = () => {
    showTimer = undefined
    shownAt = Date.now()
    storeCache()
    onShow()
  }
  // One show for what arrives meanwhile, SHOW_EVERY_MS after the last one at the earliest.
  const arrived = () => {
    showTimer ??= setTimeout(show, Math.max(0, shownAt + SHOW_EVERY_MS - Date.now()))
  }

  const fill = () => {
    queue = wanted.filter((lookup) => !started.has(lookup.key))
    while (!signal.aborted && resumeTimer === undefined && workers < CONCURRENCY && queue.length > 0) void work()
  }
  const pause = (ms: number) => {
    if (Date.now() + ms <= resumeAt) return
    resumeAt = Date.now() + ms
    clearTimeout(resumeTimer)
    resumeTimer = setTimeout(() => {
      resumeTimer = undefined
      fill()
    }, ms)
  }
  const retryLater = (key: string) => {
    const count = (failures.get(key) ?? 0) + 1
    failures.set(key, count)
    setTimeout(() => {
      started.delete(key)
      fill()
    }, RETRY_DELAYS_MS[Math.min(count, RETRY_DELAYS_MS.length) - 1])
  }

  const work = async () => {
    workers++
    while (!signal.aborted && resumeTimer === undefined && queue.length > 0) {
      const lookup = queue.shift()!
      started.add(lookup.key)
      try {
        const match = await withTimeout(LOOKUP_TIMEOUT_MS, signal, (attempt) => resolve(lookup, language, attempt))
        cacheTitles({ [`${language}|${lookup.key}`]: match })
        arrived()
      } catch (error) {
        if (error instanceof TmdbError && error.status === 429) {
          // Not this title's failure: it goes back in line once TMDB takes requests again.
          started.delete(lookup.key)
          pause(error.retryAfterMs ?? RATE_LIMIT_WAIT_MS)
        } else {
          // Offline, no key, a timeout: asked again later, and until then left unknown.
          retryLater(lookup.key)
        }
      }
    }
    workers--
  }

  return {
    want(lookups) {
      wanted = lookups
      fill()
    },
    stop() {
      // A retry or a resume that falls due later finds the run stopped and sends nothing.
      controller.abort()
      if (showTimer === undefined) return
      // What arrived since the last show is kept for the next visit.
      clearTimeout(showTimer)
      storeCache()
    },
  }
}

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

  // One run per language, for as long as the list is shown, so lookups in flight carry on as the
  // pending keys change with every title that arrives.
  const run = useRef<LookupRun | null>(null)
  useEffect(() => {
    const current = startLookups(language, () => setVersion((n) => n + 1))
    run.current = current
    return () => current.stop()
  }, [language])

  useEffect(() => {
    const byKey = new Map(Object.values(lookupsRef.current).map((lookup) => [lookup.key, lookup]))
    run.current?.want(pendingKey ? pendingKey.split('\n').map((key) => byKey.get(key)!) : [])
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

/**
 * A title's torrents, newest first: those the user chose it for, tagged with it, or guessed to be it.
 * A tagged torrent counts right away; a guessed one once its guess is known.
 */
export function useTitleTorrents<T extends Pick<Torrent, 'hash' | 'name' | 'tags' | 'added_on'> & { category?: string }>(
  torrents: T[],
  type: MediaType,
  id: number,
): T[] {
  const server = useServerMatches()
  const matches = useTitleMatches(torrents)
  return torrents
    .filter((torrent) => {
      const title = lookupFor(torrent, server?.[torrent.hash]).tag ?? matches[torrent.hash]
      return title?.type === type && title.id === id
    })
    .sort((a, b) => b.added_on - a.added_on)
}
