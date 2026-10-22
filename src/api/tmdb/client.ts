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
    credentials: 'omit',
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

/** Movies and series matching the query; people are left out. */
export async function searchTitles(query: string, options: RequestOptions & { page?: number } = {}): Promise<TitlePage> {
  const data = await request<Paged<MovieResult | TvResult | PersonResult>>(
    '/search/multi',
    { query, page: options.page, include_adult: false },
    options,
  )
  return toTitlePage(data)
}

export async function getTrending(
  type: MediaType | 'all' = 'all',
  options: RequestOptions & { window?: 'day' | 'week' } = {},
): Promise<TitlePage> {
  const data = await request<Paged<MovieResult | TvResult | PersonResult>>(
    `/trending/${type}/${options.window ?? 'week'}`,
    {},
    options,
  )
  return toTitlePage(data)
}

export async function getPopular(type: MediaType, options: RequestOptions = {}): Promise<TitlePage> {
  const data = await request<Paged<MovieResult | TvResult>>(`/${type}/popular`, {}, options)
  // These endpoints omit media_type.
  return { titles: data.results.map((item) => toTitle(item, type)), page: data.page, totalPages: data.total_pages }
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
