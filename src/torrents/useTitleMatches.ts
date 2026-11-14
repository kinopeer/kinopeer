import { useEffect, useMemo, useRef, useState } from 'react'
import type { Matches } from '../api/matches'
import type { Torrent } from '../api/qbittorrent'
import { TmdbError, getMovie, getTv, searchTitles, toTitle, type MediaType } from '../api/tmdb'
import { withTimeout } from '../lib/withTimeout'
import { useTmdbLanguage } from '../settings/settings'
import { chooseMatch, forgetServerGuesses, rememberMatches } from './serverMatches'
import { GUESS_VERSION, known, knownTitle, lookupFor, pickBest, slim, type Lookup, type TitleMatch } from './titleLookup'
import { useServerMatches } from './useServerMatches'

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
const CACHE_KEY = `kinopeer.titleMatches.v${GUESS_VERSION}`
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
 * Saves the user's choice of title for a torrent on the server (picking the title it shows pins
 * it, guessed or not). Its title is cached first, so every screen shows it without asking TMDB again.
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
/** How long a 429 without Retry-After stops the lookups; Kinopeer's proxy asks for 10 s. */
export const RATE_LIMIT_WAIT_MS = 10_000

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
 * Stopped, it sends nothing more and leaves no timer behind.
 */
function startLookups(language: string, onShow: () => void): LookupRun {
  const controller = new AbortController()
  const { signal } = controller
  // Keys taken by a worker: in flight, found, or waiting to be asked again.
  const started = new Set<string>()
  const failures = new Map<string, number>()
  const retries = new Map<string, ReturnType<typeof setTimeout>>()
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
    const delay = RETRY_DELAYS_MS[Math.min(count, RETRY_DELAYS_MS.length) - 1]
    retries.set(
      key,
      setTimeout(() => {
        started.delete(key)
        fill()
      }, delay),
    )
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
        // Stopped: not a failure, and nothing to ask again.
        if (signal.aborted) break
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
      controller.abort()
      clearTimeout(resumeTimer)
      for (const timer of retries.values()) clearTimeout(timer)
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
 * A torrent whose title is known (the user's choice, the tag, a saved guess) counts right away and
 * costs no request; only the others are guessed, and count once their guess is known (#381).
 */
export function useTitleTorrents<T extends Pick<Torrent, 'hash' | 'name' | 'tags' | 'added_on'> & { category?: string }>(
  torrents: T[],
  type: MediaType,
  id: number,
): T[] {
  const server = useServerMatches()
  const knownTitles = useMemo(() => {
    const byHash = new Map<string, Lookup['tag']>()
    for (const torrent of torrents) byHash.set(torrent.hash, knownTitle(torrent, server?.[torrent.hash]))
    return byHash
  }, [torrents, server])
  // A new array only when the torrents or what's known changes: useTitleMatches works over it.
  const unknown = useMemo(() => torrents.filter((torrent) => !knownTitles.get(torrent.hash)), [torrents, knownTitles])
  const matches = useTitleMatches(unknown)
  return torrents
    .filter((torrent) => {
      const title = knownTitles.get(torrent.hash) ?? matches[torrent.hash]
      return title?.type === type && title.id === id
    })
    .sort((a, b) => b.added_on - a.added_on)
}
