import { MOVIE_CATEGORY, OTHER_CATEGORY, TV_CATEGORY, type Release } from '../api/prowlarr'
import type { MediaType } from '../api/tmdb'
import type { ReleaseInfo } from './parseRelease'

const mainCategory = (type: MediaType) => (type === 'tv' ? TV_CATEGORY : MOVIE_CATEGORY)

/** Prowlarr categories to search a title in: its own, plus "Other" for indexers that put everything there. */
export function searchCategories(type: MediaType): number[] {
  return [mainCategory(type), OTHER_CATEGORY]
}

/**
 * Whether a release found for a title of this type belongs in the list. Releases in the type's own
 * category (or a subcategory like 2040) always do. Others (in practice "Other") stay when the name
 * reads like video (soundtracks and books don't), and for a movie, when it doesn't name seasons.
 */
export function fitsType(release: Pick<Release, 'categories'>, info: ReleaseInfo, type: MediaType): boolean {
  const main = mainCategory(type)
  if (release.categories.some((category) => category >= main && category < main + 1000)) return true
  const video = info.resolution !== undefined || info.source !== undefined || info.codec !== undefined
  return video && (type === 'tv' || info.seasons.length === 0)
}
