import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as prowlarr from '../api/prowlarr'
import type { MovieDetails } from '../api/tmdb'
import type { TitleDetails } from '../releases/releaseQuery'
import { SETTINGS_STORAGE_KEY, resetSettings } from '../settings/settings'
import { DUNE_RELEASES } from '../test/fixtures'
import { useReleases } from './useReleases'

vi.mock('../api/prowlarr', async (importOriginal) => {
  const actual = await importOriginal<typeof prowlarr>()
  return { ...actual, searchReleases: vi.fn() }
})

const movie = (id: number, title: string): TitleDetails =>
  ({ type: 'movie', id, title, original_title: title, release_date: '2024-02-27' }) as { type: 'movie' } & MovieDetails

beforeEach(() => {
  vi.resetAllMocks()
  resetSettings()
  vi.mocked(prowlarr.searchReleases).mockResolvedValue(DUNE_RELEASES)
})

describe('useReleases', () => {
  it("starts another title's search without the last one's picks", async () => {
    const { result, rerender } = renderHook(({ details }) => useReleases(details), { initialProps: { details: movie(1, 'Dune') } })
    await waitFor(() => expect(result.current.status).toBe('ready'))
    act(() => result.current.updateFilters({ indexer: ['Indexer D'] }))
    expect(result.current.filters.indexer).toEqual(['Indexer D'])

    rerender({ details: movie(2, 'Arrival') })
    await waitFor(() => expect(prowlarr.searchReleases).toHaveBeenCalledWith('Arrival 2024', { signal: expect.any(AbortSignal) }))
    expect(result.current.filters.indexer).toEqual([])
  })

  it('leaves the stored settings alone on an indexer pick, which isn\'t remembered', async () => {
    const { result } = renderHook(() => useReleases(movie(1, 'Dune')))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    act(() => result.current.updateFilters({ indexer: ['Indexer D'] }))
    expect(result.current.filters.indexer).toEqual(['Indexer D'])
    expect(localStorage.getItem(SETTINGS_STORAGE_KEY)).toBeNull()
  })
})
