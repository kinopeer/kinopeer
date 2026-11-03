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
    for (let n = 0; n < KEPT_SEARCHES; n++) keepResults(`entry-${n}`, 'dune', { titles: [DUNE], page: 1, totalPages: 1, totalResults: 1 })
    const { load } = pendingLoad()

    renderHook(() => useSearchResults('alien', load), { wrapper })

    expect(keptResults('entry-0', 'dune')).toBeDefined()
  })
})
