import type { MovieDetails, TvDetails } from '../api/tmdb'

export type TitleDetails = ({ type: 'movie' } & MovieDetails) | ({ type: 'tv' } & TvDetails)

/**
 * What to ask the indexers for. Trackers list the original title (Russian ones next to the Russian
 * title), so that matches best; a movie's year narrows remakes, a series is searched by name only
 * because its releases carry season years.
 */
export function releaseQuery(details: TitleDetails): string {
  const name =
    details.type === 'movie' ? details.original_title || details.title : details.original_name || details.name
  const year = details.type === 'movie' ? details.release_date?.slice(0, 4) : undefined
  return [name.replace(/[:!?,.;"«»]+/g, ' '), year].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
}
