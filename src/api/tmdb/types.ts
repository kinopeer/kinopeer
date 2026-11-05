/** The subset of TMDB API v3 fields Kinopeer uses. */

export type MediaType = 'movie' | 'tv'

interface MediaBase {
  id: number
  overview: string
  poster_path: string | null
  backdrop_path: string | null
  vote_average: number
  vote_count: number
  popularity: number
  genre_ids?: number[]
  original_language: string
}

export interface MovieResult extends MediaBase {
  media_type?: 'movie'
  title: string
  original_title: string
  /** YYYY-MM-DD, or empty when unknown. */
  release_date?: string
}

export interface TvResult extends MediaBase {
  media_type?: 'tv'
  name: string
  original_name: string
  /** YYYY-MM-DD, or empty when unknown. */
  first_air_date?: string
}

export interface PersonResult {
  media_type: 'person'
  id: number
  name: string
}

export interface Paged<T> {
  page: number
  results: T[]
  total_pages: number
  total_results: number
}

export interface Genre {
  id: number
  name: string
}

export interface MovieDetails extends MovieResult {
  genres: Genre[]
  /** Minutes. */
  runtime: number | null
  tagline: string
  imdb_id: string | null
  status: string
}

export interface Season {
  id: number
  season_number: number
  name: string
  episode_count: number
  air_date: string | null
  poster_path: string | null
}

export interface TvDetails extends TvResult {
  genres: Genre[]
  episode_run_time: number[]
  last_air_date: string | null
  in_production: boolean
  number_of_seasons: number
  number_of_episodes: number
  seasons: Season[]
  status: string
  tagline: string
}

/** A movie or series reduced to what lists and cards need. */
export interface Title {
  type: MediaType
  id: number
  title: string
  originalTitle: string
  /** Release year (movies) or first air year (series); undefined when unknown. */
  year?: number
  overview: string
  posterPath: string | null
  backdropPath: string | null
  /** 0–10 */
  rating: number
}
