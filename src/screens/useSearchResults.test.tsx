import { act, renderHook } from '@testing-library/react'
import type { ReactNode } from 'react'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { SearchPage } from '../api/tmdb'
import { KEPT_SEARCHES, forgetKeptResults, keepResults, keptResults } from '../search/searchResults'
import { searchPage, title } from '../test/fixtures'
import { useSearchResults } from './useSearchResults'

const DUNE = title('movie', 1, 'Dune')
const ALIEN = title('movie', 2, 'Alien')

const wrapper = ({ children }: { children: ReactNode }) => <MemoryRouter>{children}</MemoryRouter>

/** A load whose pages answer only when told to, in any order. */
function pendingLoad() {
  const answers: ((page: SearchPage) => void)[] = []
  const load = vi.fn((_page: number, _signal: AbortSignal) => new Promise<SearchPage>((resolve) => answers.push(resolve)))
  return { load, answers }
}

beforeEach(() => forgetKeptResults())

describe('useSearchResults', () => {
  it('asks for nothing without a search', () => {
    const load = vi.fn()
    const { result } = renderHook(() => useSearchResults(null, load), { wrapper })
    expect(result.current).toMatchObject({ loading: false, results: undefined })
    expect(load).not.toHaveBeenCalled()
  })

  it('drops a first page that answers after the search changed', async () => {
    const { load, answers } = pendingLoad()
    const { result, rerender } = renderHook(({ search }) => useSearchResults(search, load), {
      wrapper,
      initialProps: { search: 'dune' },
    })
    rerender({ search: 'alien' })

    await act(async () => answers[1](searchPage([ALIEN])))
    await act(async () => answers[0](searchPage([DUNE])))

    expect(result.current.results?.titles).toEqual([ALIEN])
  })

  it('drops the failure of a search that changed, as an aborted request fails', async () => {
    const load = vi.fn((_page: number, signal: AbortSignal) =>
      signal.aborted ? Promise.reject(new DOMException('Aborted', 'AbortError')) : Promise.resolve(searchPage([ALIEN])),
    )
    let fail = (_error: unknown) => {}
    load.mockImplementationOnce(() => new Promise((_resolve, reject) => (fail = reject)))
    const { result, rerender } = renderHook(({ search }) => useSearchResults(search, load), {
      wrapper,
      initialProps: { search: 'dune' },
    })
    rerender({ search: 'alien' })
    await act(async () => {})

    await act(async () => fail(new DOMException('Aborted', 'AbortError')))

    expect(result.current).toMatchObject({ error: undefined, results: { titles: [ALIEN] } })
    // Taken for the new search's state, the failure would drop its results and have them asked for again.
    expect(load).toHaveBeenCalledTimes(2)
  })

  it('asks again on every retry', async () => {
    const load = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'))
    const { result } = renderHook(() => useSearchResults('dune', load), { wrapper })
    await act(async () => {})

    await act(async () => result.current.retry())
    await act(async () => result.current.retry())

    expect(load).toHaveBeenCalledTimes(3)
  })

  it('asks for the next page once while it’s on its way', async () => {
    const { load, answers } = pendingLoad()
    const { result } = renderHook(() => useSearchResults('dune', load), { wrapper })
    await act(async () => answers[0](searchPage([DUNE], { totalPages: 3 })))

    act(() => result.current.showMore())
    act(() => result.current.showMore())

    // Two calls for page 2 would add it twice and skip page 3.
    expect(load.mock.calls.map(([page]) => page)).toEqual([1, 2])
  })

  it('keeps nothing for a search still loading, so it pushes no kept search out', () => {
    const kept = { titles: [DUNE], page: 1, totalPages: 1, totalResults: 1 }
    for (let n = 0; n < KEPT_SEARCHES; n++) keepResults(`entry-${n}`, `search-${n}`, kept)
    const { load } = pendingLoad()

    renderHook(() => useSearchResults('alien', load), { wrapper })

    expect(keptResults('entry-0', 'search-0')).toBeDefined()
  })
})
