import type { MovieDetails, TvDetails } from '../api/tmdb'

export type TitleDetails = ({ type: 'movie' } & MovieDetails) | ({ type: 'tv' } & TvDetails)

/** The language a title's English name is asked of TMDB in (`english` of `releaseQueries`). */
export const ENGLISH = 'en-US'

function originalName(details: TitleDetails): string {
  return details.type === 'movie' ? details.original_title || details.title : details.original_name || details.name
}

/** The name in `details`' own language (TMDB falls back to the original where it has none). */
function localName(details: TitleDetails): string {
  return details.type === 'movie' ? details.title : details.name
}

/** `name` as indexers are asked for it: punctuation out, with a movie's year. */
function queryOf(name: string, details: TitleDetails): string {
  const year = details.type === 'movie' ? details.release_date?.slice(0, 4) : undefined
  return [name.replace(/[:!?,.;"«»]+/g, ' '), year].filter(Boolean).join(' ').replace(/\s+/g, ' ').trim()
}

/**
 * What to ask the indexers for. Trackers list the original title (Russian ones next to the Russian
 * title), so that matches best; a movie's year narrows remakes, a series is searched by name only
 * because its releases carry season years.
 */
export function releaseQuery(details: TitleDetails): string {
  return queryOf(originalName(details), details)
}

/**
 * Whether the original title is in a script indexers don't list it by (Korean, Japanese, Chinese,
 * Thai…: letters, none of them Latin or Cyrillic), so the title is searched by its English name
 * too. Cyrillic counts as Latin does: the indexers that carry such a title list it under that name
 * (docs/SPEC.md's decision log, 2026-11-23).
 */
export function needsEnglishTitle(details: TitleDetails): boolean {
  const name = originalName(details)
  return /\p{L}/u.test(name) && !/[\p{Script=Latin}\p{Script=Cyrillic}]/u.test(name)
}

/**
 * The searches for a title: its `releaseQuery`, and, when `needsEnglishTitle`, its name in `english`
 * (the same title's details in `ENGLISH`) when that's another query. Without `english` (not asked
 * for, or TMDB didn't give it), the original alone.
 */
export function releaseQueries(details: TitleDetails, english?: TitleDetails): string[] {
  const original = releaseQuery(details)
  if (!english || !needsEnglishTitle(details)) return [original]
  const name = queryOf(localName(english), details)
  return name && name !== original ? [original, name] : [original]
}
