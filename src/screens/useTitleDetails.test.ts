import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as tmdb from '../api/tmdb'
import type { MovieDetails, TvDetails } from '../api/tmdb'
import { useTitleDetails } from './useTitleDetails'

vi.mock('../api/tmdb', async (importOriginal) => {
  const actual = await importOriginal<typeof tmdb>()
  return { ...actual, getMovie: vi.fn(), getTv: vi.fn() }
})

const getMovie = vi.mocked(tmdb.getMovie)
const getTv = vi.mocked(tmdb.getTv)
const DUNE = { id: 693134, title: 'Dune: Part Two' } as MovieDetails
const BB = { id: 1396, name: 'Breaking Bad' } as TvDetails

beforeEach(() => {
  vi.resetAllMocks()
  getMovie.mockResolvedValue(DUNE)
  getTv.mockResolvedValue(BB)
})

describe('useTitleDetails', () => {
  it('gives a movie’s and a series’ details with their type, and asks nothing without a type', async () => {
    const movie = renderHook(() => useTitleDetails('movie', 693134, 'en-US'))
    const series = renderHook(() => useTitleDetails('tv', 1396, 'en-US'))
    await waitFor(() => expect(movie.result.current.data).toEqual({ ...DUNE, type: 'movie' }))
    await waitFor(() => expect(series.result.current.data).toEqual({ ...BB, type: 'tv' }))
    expect(getMovie).toHaveBeenCalledWith(693134, expect.objectContaining({ language: 'en-US' }))
    expect(getTv).toHaveBeenCalledWith(1396, expect.objectContaining({ language: 'en-US' }))

    const none = renderHook(() => useTitleDetails(undefined, 0, 'en-US'))
    expect(none.result.current).toMatchObject({ data: undefined, loading: false })
    expect(getMovie).toHaveBeenCalledTimes(1)
    expect(getTv).toHaveBeenCalledTimes(1)
  })

  it('shares a title’s details on the page for an hour, by title and language (#384)', async () => {
    const now = Date.now()
    vi.spyOn(Date, 'now').mockReturnValue(now)
    const first = renderHook(() => useTitleDetails('movie', 693134, 'en-US'))
    await waitFor(() => expect(first.result.current.data).toBeDefined())
    first.unmount()

    // Another screen of the same title, as the releases after the title page, or the page on Back.
    vi.spyOn(Date, 'now').mockReturnValue(now + tmdb.TITLE_FRESH_MS - 1)
    const again = renderHook(() => useTitleDetails('movie', 693134, 'en-US'))
    expect(again.result.current).toMatchObject({ data: { ...DUNE, type: 'movie' }, loading: false })
    expect(getMovie).toHaveBeenCalledTimes(1)
    again.unmount()

    // Another language is another answer.
    renderHook(() => useTitleDetails('movie', 693134, 'ru-RU')).unmount()
    expect(getMovie).toHaveBeenCalledTimes(2)

    vi.spyOn(Date, 'now').mockReturnValue(now + tmdb.TITLE_FRESH_MS)
    const later = renderHook(() => useTitleDetails('movie', 693134, 'en-US'))
    expect(later.result.current.loading).toBe(true)
    await waitFor(() => expect(later.result.current.data).toBeDefined())
    expect(getMovie).toHaveBeenCalledTimes(3)
  })
})
