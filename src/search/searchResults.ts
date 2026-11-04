import { TMDB_MAX_PAGE, type SearchPage, type Title } from '../api/tmdb'

/** The pages of a search loaded so far, as one list. */
export interface SearchResults {
  titles: Title[]
  /** The last page loaded. */
  page: number
  totalPages: number
  /** TMDB's count for the whole search, from the last page loaded. */
  totalResults: number
}

export function firstResults({ titles, page, totalPages, totalResults }: SearchPage): SearchResults {
  return { titles, page, totalPages, totalResults }
}

const titleKey = (title: Title) => `${title.type}-${title.id}`

/** The next page added to the list, without the titles already in it: results can shift between pages. */
export function appendPage(results: SearchResults, next: SearchPage): SearchResults {
  const seen = new Set(results.titles.map(titleKey))
  return {
    titles: [...results.titles, ...next.titles.filter((title) => !seen.has(titleKey(title)))],
    page: next.page,
    totalPages: next.totalPages,
    totalResults: next.totalResults,
  }
}

export function hasMorePages({ page, totalPages }: SearchResults): boolean {
  return page < Math.min(totalPages, TMDB_MAX_PAGE)
}

/**
 * Searches kept for Back, by history entry. A few are enough (Back returns to the latest ones), and the limit
 * keeps a long session from holding every search it made.
 */
export const KEPT_SEARCHES = 10

const kept = new Map<string, { search: string; results: SearchResults }>()

/**
 * Keeps a search's results for the history entry that shows them, replacing what that entry had. A search
 * takes one place: kept under a new entry (typing replaces the entry before the search changes), it leaves the
 * old one.
 */
export function keepResults(entry: string, search: string, results: SearchResults): void {
  for (const [other, found] of kept) if (found.search === search) kept.delete(other)
  kept.delete(entry)
  kept.set(entry, { search, results })
  if (kept.size > KEPT_SEARCHES) kept.delete(kept.keys().next().value!)
}

/** The results kept for the entry, if they are of this search. */
export function keptResults(entry: string, search: string): SearchResults | undefined {
  const found = kept.get(entry)
  return found?.search === search ? found.results : undefined
}

/** The results kept for this search under whichever entry holds them (a search takes one place). */
export function keptSearch(search: string): SearchResults | undefined {
  for (const found of kept.values()) if (found.search === search) return found.results
  return undefined
}

/** Forgets every kept search (tests start from none). */
export function forgetKeptResults(): void {
  kept.clear()
}
