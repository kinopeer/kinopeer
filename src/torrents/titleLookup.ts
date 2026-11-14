import type { StoredMatch } from '../api/matches'
import type { Torrent } from '../api/qbittorrent'
import type { MediaType, Title } from '../api/tmdb'
import { parseName, tmdbTag, type ParsedName } from './parseName'

/** What a download row needs from TMDB. */
export type TitleMatch = Pick<Title, 'type' | 'id' | 'title' | 'year' | 'posterPath'>

/** Whether two titles are the same TMDB title. */
export const sameTitle = (a: Pick<Title, 'type' | 'id'> | null | undefined, b: Pick<Title, 'type' | 'id'> | null | undefined) =>
  !!a && !!b && a.type === b.type && a.id === b.id

/** How a torrent's title is looked up: by a title already known, or by a guess from its name. */
export interface Lookup {
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

export function known(type: MediaType, id: number): Lookup {
  return { key: `id:${type}:${id}`, tag: { type, id } }
}

/** A torrent's title when it's known without TMDB: the user's choice, the `tmdb:` tag or a saved guess. */
export function knownTitle(torrent: Pick<Torrent, 'tags'>, stored?: StoredMatch): Lookup['tag'] {
  if (stored?.source === 'user') return { type: stored.type, id: stored.id }
  const tag = tmdbTag(torrent.tags ?? '')
  if (tag) return { type: tag.type, id: tag.id }
  if (stored?.source === 'guess' && stored.version === GUESS_VERSION) return { type: stored.type, id: stored.id }
  return undefined
}

/**
 * How to find a torrent's title: the user's choice first, then the `tmdb:` tag Kinopeer adds with a
 * release, then a guess the server keeps, and only then a new guess from the release name.
 */
export function lookupFor(
  torrent: Pick<Torrent, 'name' | 'tags'> & { category?: string },
  stored?: StoredMatch,
): Lookup {
  const title = knownTitle(torrent, stored)
  if (title) return known(title.type, title.id)
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

/** Only what a row shows, so the cache keeps no more. */
export function slim(title: TitleMatch): TitleMatch {
  return { type: title.type, id: title.id, title: title.title, year: title.year, posterPath: title.posterPath }
}
