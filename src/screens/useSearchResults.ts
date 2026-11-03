import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation } from 'react-router'
import type { SearchPage } from '../api/tmdb'
import { appendPage, firstResults, hasMorePages, keepResults, keptResults, type SearchResults } from '../search/searchResults'

export interface SearchResultsState {
  results?: SearchResults
  /** Why the first page failed. */
  error?: unknown
  loading: boolean
  /** Asks for the first page again. */
  retry: () => void
  hasMore: boolean
  loadingMore: boolean
  /** Why the next page failed; what's loaded stays. */
  moreError?: unknown
  /** Loads the next page and adds it to the results, or tries a failed one again. */
  showMore: () => void
}

/** A search's pages, or why its first one failed. */
interface Loaded {
  results?: SearchResults
  error?: unknown
}

/** What this screen loaded for a query, per type tab. */
interface Tabs {
  query: string
  types: Partial<Record<string, Loaded>>
}

/** A next page on its way, or failed, for one search: it doesn't outlive the search. */
interface More {
  search: string
  failed: boolean
  error?: unknown
}

/**
 * A search's results, a page at a time. `query` names the search without its type tab (null runs none), and
 * `load` asks for one of its pages. A tab picked again shows what it loaded while the query stays; a query
 * typed again asks again. The results are also kept for the history entry, so Back to it shows the pages
 * loaded before at once, without asking again, and the scroll can be brought back over them.
 */
export function useSearchResults(
  query: string | null,
  type: string,
  load: (page: number, signal: AbortSignal) => Promise<SearchPage>,
): SearchResultsState {
  // Nothing is kept for no query: a query has its language and is never "null".
  const search = `${query}|${type}`
  const { key: entry } = useLocation()
  const loadRef = useRef(load)
  const [tabs, setTabs] = useState<Tabs | null>(null)
  const [more, setMore] = useState<More | null>(null)
  const [attempt, setAttempt] = useState(0)
  const moreRequest = useRef<AbortController | null>(null)

  useEffect(() => {
    loadRef.current = load
  })

  const kept = keptResults(entry, search)
  const current = (tabs?.query === query ? tabs.types[type] : undefined) ?? (kept && { results: kept })
  const results = current?.results
  const loaded = results !== undefined

  // A tab's pages go with the query's other tabs; another query starts them over.
  const setTab = useCallback(
    (query: string, type: string, tab: Loaded | undefined) =>
      setTabs((tabs) => ({ query, types: { ...(tabs?.query === query ? tabs.types : {}), [type]: tab } })),
    [],
  )

  useEffect(() => {
    if (query === null || loaded) return
    const controller = new AbortController()
    loadRef.current(1, controller.signal).then(
      (page) => {
        if (!controller.signal.aborted) setTab(query, type, { results: firstResults(page) })
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setTab(query, type, { error })
      },
    )
    return () => controller.abort()
  }, [query, type, attempt, loaded, setTab])

  // A next page belongs to its search: another one, or leaving the screen, cancels it.
  useEffect(() => () => moreRequest.current?.abort(), [search])
  // And it's forgotten as soon as another search shows, so coming back to this one starts it afresh.
  if (more !== null && more.search !== search) setMore(null)

  useEffect(() => {
    if (results) keepResults(entry, search, results)
  }, [entry, search, results])

  // Only a query's failure offers it.
  const retry = useCallback(() => {
    setTab(query!, type, undefined)
    setAttempt((n) => n + 1)
  }, [query, type, setTab])

  const loadingMore = more !== null && !more.failed

  const showMore = () => {
    if (!results || loadingMore) return
    const controller = new AbortController()
    moreRequest.current = controller
    setMore({ search, failed: false })
    loadRef.current(results.page + 1, controller.signal).then(
      (page) => {
        if (controller.signal.aborted) return
        setTab(query!, type, { results: appendPage(results, page) })
        setMore(null)
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setMore({ search, failed: true, error })
      },
    )
  }

  return {
    results,
    error: current?.error,
    loading: query !== null && current === undefined,
    retry,
    hasMore: results !== undefined && hasMorePages(results),
    loadingMore,
    moreError: more?.error,
    showMore,
  }
}
