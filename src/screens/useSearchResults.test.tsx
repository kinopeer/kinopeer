import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter, useNavigate } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SearchPage } from '../api/tmdb'
import { KEPT_SEARCHES, forgetKeptResults, keepResults, keptResults } from '../search/searchResults'
import { searchPage, title } from '../test/fixtures'
import { useSearchResults } from './useSearchResults'

const DUNE = title('movie', 1, 'Dune')
const ALIEN = title('movie', 2, 'Alien')

const wrapper = ({ children }: { children: ReactNode }) => <MemoryRouter>{children}</MemoryRouter>

/** A load whose pages answer or fail only when told to, in any order. */
function pendingLoad() {
  const answers: ((page: SearchPage) => void)[] = []
  const failures: ((error: unknown) => void)[] = []
  const load = vi.fn(
    (_page: number, _signal: AbortSignal) =>
      new Promise<SearchPage>((resolve, reject) => {
        answers.push(resolve)
        failures.push(reject)
      }),
  )
  return { load, answers, failures }
}

/**
 * Dune's query changed to Alien's before its first page came. Alien's All and Series tabs came, and Series is
 * picked: All is held only by what this screen loaded, since its history entry now keeps Series.
 */
async function queryChanged() {
  const pending = pendingLoad()
  const hook = renderHook(({ query, type }) => useSearchResults(query, type, pending.load), {
    wrapper,
    initialProps: { query: 'dune', type: 'all' },
  })
  hook.rerender({ query: 'alien', type: 'all' })
  await act(async () => pending.answers[1](searchPage([ALIEN])))
  hook.rerender({ query: 'alien', type: 'tv' })
  await act(async () => pending.answers[2](searchPage([])))
  return { ...pending, ...hook }
}

beforeEach(() => forgetKeptResults())

describe('useSearchResults', () => {
  it('asks for nothing without a search', () => {
    const load = vi.fn()
    const { result } = renderHook(() => useSearchResults(null, 'all', load), { wrapper })
    expect(result.current).toMatchObject({ loading: false, results: undefined })
    expect(load).not.toHaveBeenCalled()
  })

  it.each([
    ['answers', (pending: Awaited<ReturnType<typeof queryChanged>>) => pending.answers[0](searchPage([DUNE]))],
    // As an aborted request does.
    ['fails', (pending: Awaited<ReturnType<typeof queryChanged>>) => pending.failures[0](new DOMException('Aborted', 'AbortError'))],
  ])('keeps a query’s tabs when the first page of the query before %s late', async (_case, settle) => {
    const pending = await queryChanged()
    await act(async () => settle(pending))

    pending.rerender({ query: 'alien', type: 'all' })

    expect(pending.result.current).toMatchObject({ error: undefined, results: { titles: [ALIEN] } })
    expect(pending.load).toHaveBeenCalledTimes(3)
  })

  it('asks again on every retry', async () => {
    const load = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    const { result } = renderHook(() => useSearchResults('dune', 'all', load), { wrapper })
    await act(async () => {})

    await act(async () => result.current.retry())
    await act(async () => result.current.retry())

    expect(load).toHaveBeenCalledTimes(3)
  })

  it('asks for the next page once while it’s on its way', async () => {
    const { load, answers } = pendingLoad()
    const { result } = renderHook(() => useSearchResults('dune', 'all', load), { wrapper })
    await act(async () => answers[0](searchPage([DUNE], { totalPages: 3 })))

    act(() => result.current.showMore())
    act(() => result.current.showMore())

    // Two calls for page 2 would add it twice and skip page 3.
    expect(load.mock.calls.map(([page]) => page)).toEqual([1, 2])
  })

  it('starts a search left with its next page on its way afresh when it’s picked again', async () => {
    const { load, answers } = pendingLoad()
    const { result, rerender } = renderHook(
      ({ type }) => ({ results: useSearchResults('star', type, load), navigate: useNavigate() }),
      { wrapper, initialProps: { type: 'all' } },
    )
    // A tab picked replaces the history entry, as the screen does.
    const pick = async (type: string) => {
      await act(async () => result.current.navigate(`/?type=${type}`, { replace: true }))
      rerender({ type })
    }
    await act(async () => answers[0](searchPage([DUNE], { totalPages: 3 })))
    await pick('tv')
    await act(async () => answers[1](searchPage([ALIEN])))
    await pick('all')
    act(() => result.current.results.showMore())

    await pick('tv')
    await pick('all')

    expect(result.current.results.loadingMore).toBe(false)
    act(() => result.current.results.showMore())
    // The page left behind was dropped, so it's asked for again.
    expect(load.mock.calls.map(([page]) => page)).toEqual([1, 1, 2, 2])
  })

  it('asks TMDB again for a search typed again', async () => {
    const load = vi.fn().mockResolvedValue(searchPage([DUNE]))
    const { result, rerender } = renderHook(
      ({ query }) => ({ results: useSearchResults(query, 'all', load), navigate: useNavigate() }),
      { wrapper, initialProps: { query: 'dune' } },
    )
    await act(async () => {})
    // Typing replaces the history entry each time.
    for (const query of ['alien', 'dune']) {
      await act(async () => result.current.navigate(`/?q=${query}`, { replace: true }))
      rerender({ query })
      await act(async () => {})
    }
    expect(load).toHaveBeenCalledTimes(3)
  })

  it('keeps a search once while typing replaces its history entry', async () => {
    const kept = { titles: [DUNE], page: 1, totalPages: 1, totalResults: 1 }
    for (let n = 0; n < KEPT_SEARCHES - 1; n++) keepResults(`entry-${n}`, `search-${n}`, kept)
    const load = vi.fn().mockResolvedValue(searchPage([DUNE]))
    const { result } = renderHook(() => ({ results: useSearchResults('dune', 'all', load), navigate: useNavigate() }), {
      wrapper,
    })
    await act(async () => {})

    // Keystrokes the search hasn't caught up with yet.
    for (const query of ['dune ', 'dune p', 'dune pa']) {
      await act(async () => result.current.navigate(`/?q=${query}`, { replace: true }))
    }

    expect(keptResults('entry-0', 'search-0')).toBeDefined()
  })

  it('keeps nothing for a search still loading, so it pushes no kept search out', () => {
    const kept = { titles: [DUNE], page: 1, totalPages: 1, totalResults: 1 }
    for (let n = 0; n < KEPT_SEARCHES; n++) keepResults(`entry-${n}`, `search-${n}`, kept)
    const { load } = pendingLoad()

    renderHook(() => useSearchResults('alien', 'all', load), { wrapper })

    expect(keptResults('entry-0', 'search-0')).toBeDefined()
  })
})
