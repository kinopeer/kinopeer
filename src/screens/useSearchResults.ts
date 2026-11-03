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

interface State {
  search: string
  results?: SearchResults
  error?: unknown
  loadingMore?: boolean
  moreError?: unknown
}

function kept(entry: string, search: string | null): State | null {
  const results = search === null ? undefined : keptResults(entry, search)
  return results ? { search: search!, results } : null
}

/**
 * A search's results, a page at a time. `search` names the search (null runs none) and `load` asks for one of
 * its pages. The results are kept for the history entry, so Back to it shows the pages loaded before at once,
 * without asking again, and the scroll can be brought back over them.
 */
export function useSearchResults(
  search: string | null,
  load: (page: number, signal: AbortSignal) => Promise<SearchPage>,
): SearchResultsState {
  const { key: entry } = useLocation()
  const loadRef = useRef(load)
  const [state, setState] = useState(() => kept(entry, search))
  const [attempt, setAttempt] = useState(0)
  const more = useRef<AbortController | null>(null)

  useEffect(() => {
    loadRef.current = load
  })

  const current = search !== null && state?.search === search ? state : null
  const loaded = current?.results !== undefined

  useEffect(() => {
    if (search === null || loaded) return
    const controller = new AbortController()
    loadRef.current(1, controller.signal).then(
      (page) => {
        if (!controller.signal.aborted) setState({ search, results: firstResults(page) })
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setState({ search, error })
      },
    )
    return () => controller.abort()
  }, [search, attempt, loaded])

  // A page on its way belongs to this search: another one, or leaving the screen, drops it.
  useEffect(() => () => more.current?.abort(), [search])

  const results = current?.results
  useEffect(() => {
    if (results) keepResults(entry, search!, results)
  }, [entry, search, results])

  const retry = useCallback(() => {
    setState(null)
    setAttempt((n) => n + 1)
  }, [])

  const showMore = () => {
    if (!results || current?.loadingMore) return
    const controller = new AbortController()
    more.current = controller
    const update = (change: (state: State) => State) =>
      setState((state) => (!controller.signal.aborted && state?.search === search ? change(state) : state))
    setState({ search: search!, results, loadingMore: true })
    loadRef.current(results.page + 1, controller.signal).then(
      (page) => update((state) => ({ search: state.search, results: appendPage(state.results!, page) })),
      (error: unknown) => update((state) => ({ ...state, loadingMore: false, moreError: error })),
    )
  }

  return {
    results,
    error: current?.error,
    loading: search !== null && current === null,
    retry,
    hasMore: results !== undefined && hasMorePages(results),
    loadingMore: current?.loadingMore ?? false,
    moreError: current?.moreError,
    showMore,
  }
}
