import type { Matches, StoredMatch } from '../src/api/matches/types.ts'
import type { NotifyLanguage } from '../src/api/settings/types.ts'

/** A TMDB title by its type and id. */
export interface TitleRef {
  type: 'movie' | 'tv'
  id: number
}

/** The tag Kinopeer adds with a release, as `tmdbTag` in src/torrents/parseName.ts reads it. */
const TAG = /^tmdb:(movie|tv):(\d+)$/

/**
 * A torrent's title when it's known without guessing, in the app's order (`knownTitle` in
 * src/torrents/titleLookup.ts): the user's choice, then the `tmdb:` tag, then a guess the server
 * keeps. A guess of any version counts: the server doesn't know which one the browsers make now.
 */
export function knownTitle(tags: string, match: StoredMatch | undefined): TitleRef | undefined {
  if (match?.source === 'user') return { type: match.type, id: match.id }
  for (const tag of tags.split(',')) {
    const found = TAG.exec(tag.trim())
    if (found) return { type: found[1] as TitleRef['type'], id: Number(found[2]) }
  }
  if (match?.source === 'guess') return { type: match.type, id: match.id }
  return undefined
}

const TMDB_LANGUAGE: Record<NotifyLanguage, string> = { en: 'en-US', ru: 'ru-RU' }

interface TmdbTitle {
  title?: unknown
  name?: unknown
  release_date?: unknown
  first_air_date?: unknown
}

export interface FinishedTitleDeps {
  /** The torrent-to-title matches the server keeps. */
  matches: () => Matches
  /** A TMDB API call by its path under /3/ (`tmdbJson`). */
  tmdb: (rest: string) => Promise<unknown>
}

/**
 * The title a notification names for a finished torrent, "Title (year)" in `language`, or
 * undefined when it isn't known or TMDB doesn't answer, so the message names the torrent instead.
 * TMDB is asked once: a notification isn't held back for it.
 */
export async function finishedTitle(
  torrent: { hash: string; tags: string },
  language: NotifyLanguage,
  deps: FinishedTitleDeps,
): Promise<string | undefined> {
  const ref = knownTitle(torrent.tags, deps.matches()[torrent.hash])
  if (!ref) return undefined
  const path = `${ref.type}/${ref.id}?language=${TMDB_LANGUAGE[language]}`
  let found: TmdbTitle
  try {
    found = ((await deps.tmdb(path)) ?? {}) as TmdbTitle
  } catch {
    return undefined
  }
  const name = ref.type === 'movie' ? found.title : found.name
  if (typeof name !== 'string' || !name.trim()) return undefined
  const date = ref.type === 'movie' ? found.release_date : found.first_air_date
  const year = typeof date === 'string' ? /^\d{4}/.exec(date)?.[0] : undefined
  return year ? `${name.trim()} (${year})` : name.trim()
}
