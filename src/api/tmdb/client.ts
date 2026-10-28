import type {
  MediaType,
  MovieDetails,
  MovieResult,
  Paged,
  PersonResult,
  Title,
  TvDetails,
  TvResult,
} from './types'

/** Same-origin prefix proxied to the TMDB API; the proxy adds the API key. */
export const TMDB_BASE = '/tmdb'
/** Same-origin prefix proxied to TMDB's image CDN. */
export const TMDB_IMAGE_BASE = '/tmdb-img'

export type PosterSize = 'w92' | 'w154' | 'w185' | 'w342' | 'w500' | 'w780' | 'original'
export type BackdropSize = 'w300' | 'w780' | 'w1280' | 'original'

export class TmdbError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'TmdbError'
    this.status = status
  }
}

/** No TMDB_API_KEY on the proxy (the route doesn't exist), or TMDB rejected it. */
export class TmdbKeyError extends TmdbError {
  constructor(status: number) {
    super('The TMDB API key is missing or invalid', status)
    this.name = 'TmdbKeyError'
  }
}

/** TMDB language tag for an app language: "ru" → "ru-RU". */
export function tmdbLanguage(language: string): string {
  return language.startsWith('ru') ? 'ru-RU' : 'en-US'
}

export interface RequestOptions {
  /** TMDB language tag, e.g. "en-US" or "ru-RU". */
  language?: string
  signal?: AbortSignal
}

type Params = Record<string, string | number | boolean | undefined>

async function request<T>(path: string, params: Params, { language, signal }: RequestOptions): Promise<T> {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries({ ...params, language })) {
    if (value !== undefined) search.set(key, String(value))
  }
  const query = search.toString()
  const response = await fetch(`${TMDB_BASE}${path}${query ? `?${query}` : ''}`, {
    credentials: 'same-origin',
    headers: { Accept: 'application/json' },
    signal,
  })
  // 404 from the dev server itself (no /tmdb proxy configured) is not JSON.
  if (response.status === 401 || (response.status === 404 && !isJson(response))) {
    throw new TmdbKeyError(response.status)
  }
  if (!response.ok) throw new TmdbError(`TMDB responded ${response.status}`, response.status)
  return (await response.json()) as T
}

function isJson(response: Response): boolean {
  return response.headers.get('content-type')?.includes('application/json') ?? false
}

function yearOf(date: string | null | undefined): number | undefined {
  const year = date ? Number.parseInt(date.slice(0, 4), 10) : Number.NaN
  return Number.isFinite(year) ? year : undefined
}

export function toTitle(item: MovieResult | TvResult, type: MediaType = item.media_type ?? 'movie'): Title {
  const isMovie = type === 'movie'
  const movie = item as MovieResult
  const tv = item as TvResult
  return {
    type,
    id: item.id,
    title: isMovie ? movie.title : tv.name,
    originalTitle: isMovie ? movie.original_title : tv.original_name,
    year: yearOf(isMovie ? movie.release_date : tv.first_air_date),
    overview: item.overview,
    posterPath: item.poster_path,
    backdropPath: item.backdrop_path,
    rating: item.vote_average,
  }
}

function isTitle(item: MovieResult | TvResult | PersonResult): item is MovieResult | TvResult {
  return item.media_type === 'movie' || item.media_type === 'tv'
}

export interface TitlePage {
  titles: Title[]
  page: number
  totalPages: number
}

function toTitlePage(data: Paged<MovieResult | TvResult | PersonResult>): TitlePage {
  return {
    titles: data.results.filter(isTitle).map((item) => toTitle(item)),
    page: data.page,
    totalPages: data.total_pages,
  }
}

/** A page from an endpoint that lists one type and omits media_type (discover, similar). */
function toTypedPage(data: Paged<MovieResult | TvResult>, type: MediaType): TitlePage {
  return { titles: data.results.map((item) => toTitle(item, type)), page: data.page, totalPages: data.total_pages }
}

export interface SearchOptions extends RequestOptions {
  page?: number
  /** Only titles released (movies) or first aired (series) that year. */
  year?: number
}

/**
 * Two lists in TMDB's order made one: the more popular of the two heads goes first, so each list keeps its own
 * order (relevance to the query, which an exact title with few views still tops) and only their interleaving
 * follows popularity.
 */
function interleaveByPopularity<T extends { popularity: number }>(a: T[], b: T[]): T[] {
  const merged: T[] = []
  let i = 0
  let j = 0
  while (i < a.length && j < b.length) merged.push(a[i].popularity >= b[j].popularity ? a[i++] : b[j++])
  return [...merged, ...a.slice(i), ...b.slice(j)]
}

/**
 * Movies and series matching the query; people are left out. `/search/multi` has no year filter, so with a year
 * it searches movies and series apart, each with its own year parameter, and interleaves the two lists.
 */
export async function searchTitles(query: string, options: SearchOptions = {}): Promise<TitlePage> {
  const { year, page } = options
  if (year === undefined) {
    const data = await request<Paged<MovieResult | TvResult | PersonResult>>(
      '/search/multi',
      { query, page, include_adult: false },
      options,
    )
    return toTitlePage(data)
  }
  const [movies, series] = await Promise.all([
    request<Paged<MovieResult>>('/search/movie', { query, page, include_adult: false, primary_release_year: year }, options),
    request<Paged<TvResult>>('/search/tv', { query, page, include_adult: false, first_air_date_year: year }, options),
  ])
  // These endpoints omit media_type.
  const titles = interleaveByPopularity(
    movies.results.map((item) => ({ popularity: item.popularity, title: toTitle(item, 'movie') })),
    series.results.map((item) => ({ popularity: item.popularity, title: toTitle(item, 'tv') })),
  )
  return {
    titles: titles.map(({ title }) => title),
    page: page ?? 1,
    totalPages: Math.max(movies.total_pages, series.total_pages),
  }
}

/** TMDB Discover's filters, e.g. `{ sort_by: 'popularity.desc', 'release_date.gte': '2026-09-01' }`. */
export type DiscoverParams = Record<string, string | number | boolean>

/** Movies or series matching Discover's filters. */
export async function discoverTitles(
  type: MediaType,
  params: DiscoverParams,
  options: RequestOptions = {},
): Promise<TitlePage> {
  const data = await request<Paged<MovieResult | TvResult>>(`/discover/${type}`, params, options)
  return toTypedPage(data, type)
}

/** Titles TMDB recommends to people who liked this one, of the same type. */
export function getRecommendations(type: MediaType, id: number, options: RequestOptions = {}): Promise<TitlePage> {
  return getRelated(type, id, 'recommendations', options)
}

/** Titles of the same type with similar genres and keywords; a fallback when nothing is recommended. */
export function getSimilar(type: MediaType, id: number, options: RequestOptions = {}): Promise<TitlePage> {
  return getRelated(type, id, 'similar', options)
}

async function getRelated(
  type: MediaType,
  id: number,
  list: 'recommendations' | 'similar',
  options: RequestOptions,
): Promise<TitlePage> {
  // Both lists hold only the title's own type.
  return toTypedPage(await request<Paged<MovieResult | TvResult>>(`/${type}/${id}/${list}`, {}, options), type)
}

export function getMovie(id: number, options: RequestOptions = {}): Promise<MovieDetails> {
  return request<MovieDetails>(`/movie/${id}`, {}, options)
}

export function getTv(id: number, options: RequestOptions = {}): Promise<TvDetails> {
  return request<TvDetails>(`/tv/${id}`, {}, options)
}

/** Checks the connection and the key with TMDB's cheapest call. */
export async function checkTmdb(signal?: AbortSignal): Promise<void> {
  await request('/configuration', {}, { signal })
}

export function posterUrl(path: string | null, size: PosterSize = 'w342'): string | undefined {
  return path ? `${TMDB_IMAGE_BASE}/${size}${path}` : undefined
}

export function backdropUrl(path: string | null, size: BackdropSize = 'w1280'): string | undefined {
  return path ? `${TMDB_IMAGE_BASE}/${size}${path}` : undefined
}
