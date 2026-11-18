import { getMovie, getTv, titleDetailsKey, TITLE_FRESH_MS, type MediaType } from '../api/tmdb'
import { useRequest, type RequestState } from '../lib/useRequest'
import type { TitleDetails } from '../releases/releaseQuery'

/**
 * A title's details in a language, shared on the page for `TITLE_FRESH_MS`: the title page and the
 * phone's releases screen show the same title, so a move between them, or back, asks TMDB nothing
 * again (#384). No type (an address that names no title) asks nothing.
 */
export function useTitleDetails(type: MediaType | undefined, id: number, language: string): RequestState<TitleDetails> {
  return useRequest<TitleDetails>(
    type ? titleDetailsKey(type, id, language) : null,
    async (signal) =>
      type === 'movie'
        ? { ...(await getMovie(id, { language, signal })), type: 'movie' }
        : { ...(await getTv(id, { language, signal })), type: 'tv' },
    { freshFor: TITLE_FRESH_MS },
  )
}
