import type { DiscoverParams, MediaType } from '../api/tmdb'

/**
 * The rows the Search screen shows before a search: titles that are likely on torrents already,
 * in good quality. A movie's WEB-DL appears with its digital release and a Blu-ray rip with the
 * disc, so the movie rows go by those release dates rather than by what's trending or in
 * cinemas. Series episodes appear within hours of airing, so the series row is what aired lately.
 *
 * No region is passed: TMDB then matches a release of that type in any country, and the first
 * one anywhere is what puts a release on the trackers.
 */
export interface BrowseRowQuery {
  key: 'newOnDigital' | 'newEpisodes' | 'bestOfYear'
  type: MediaType
  params: DiscoverParams
}

/** TMDB's release types: 4 is digital, 5 physical (DVD, Blu-ray). `|` means either. */
const DIGITAL_OR_PHYSICAL = '4|5'
/** TMDB's series types: 2 is a miniseries, 4 scripted; talk shows, news and reality are left out. */
const SCRIPTED = '2|4'

/** A digital or disc release this recent counts as new. */
const NEW_ON_DIGITAL_DAYS = 60
/** A series with an episode aired this recently has new episodes. */
const NEW_EPISODES_DAYS = 14
/**
 * A film first released longer ago than this isn't new, though a reissue gives it a fresh disc
 * date. The first release is often a festival premiere, a year or more before digital.
 */
const NEW_FILM_DAYS = 540
/** Best of the year: released on digital or disc within this many days… */
const BEST_OF_YEAR_DAYS = 365
/** …and rated by enough people for the average to mean something. */
const BEST_OF_YEAR_MIN_VOTES = 300

/** `YYYY-MM-DD` of the UTC day `days` before `today`. */
function daysBefore(today: Date, days: number): string {
  return new Date(today.getTime() - days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

/** The Discover queries for the rows, in the order they show, for the given day. */
export function browseRowQueries(today: Date): BrowseRowQuery[] {
  // Up to tomorrow in UTC: east of UTC it's already the next day there, and a release dated today
  // there should show.
  const now = daysBefore(today, -1)
  return [
    {
      key: 'newOnDigital',
      type: 'movie',
      params: {
        with_release_type: DIGITAL_OR_PHYSICAL,
        'release_date.gte': daysBefore(today, NEW_ON_DIGITAL_DAYS),
        'release_date.lte': now,
        'primary_release_date.gte': daysBefore(today, NEW_FILM_DAYS),
        sort_by: 'popularity.desc',
        include_adult: false,
      },
    },
    {
      key: 'newEpisodes',
      type: 'tv',
      params: {
        with_type: SCRIPTED,
        'air_date.gte': daysBefore(today, NEW_EPISODES_DAYS),
        'air_date.lte': now,
        sort_by: 'popularity.desc',
        include_adult: false,
      },
    },
    {
      key: 'bestOfYear',
      type: 'movie',
      params: {
        with_release_type: DIGITAL_OR_PHYSICAL,
        'release_date.gte': daysBefore(today, BEST_OF_YEAR_DAYS),
        'release_date.lte': now,
        'primary_release_date.gte': daysBefore(today, NEW_FILM_DAYS),
        'vote_count.gte': BEST_OF_YEAR_MIN_VOTES,
        sort_by: 'vote_average.desc',
        include_adult: false,
      },
    },
  ]
}
