import { renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as tmdb from '../api/tmdb'
import type { Title } from '../api/tmdb'
import { categoryType, clearTitleMatchCache, lookupFor, pickBest, useTitleMatches } from './titleMatches'

vi.mock('../api/tmdb', async (importOriginal) => {
  const actual = await importOriginal<typeof tmdb>()
  return { ...actual, searchTitles: vi.fn(), getMovie: vi.fn(), getTv: vi.fn() }
})

const searchTitles = vi.mocked(tmdb.searchTitles)
const getMovie = vi.mocked(tmdb.getMovie)

function title(type: Title['type'], id: number, name: string, year?: number): Title {
  return { type, id, title: name, originalTitle: name, year, overview: '', posterPath: `/${id}.jpg`, backdropPath: null, rating: 7 }
}

const DUNE_1984 = title('movie', 841, 'Dune', 1984)
const DUNE_2021 = title('movie', 438631, 'Dune', 2021)
const DUNE_SERIES = title('tv', 90228, 'Dune: Prophecy', 2024)

beforeEach(() => {
  vi.resetAllMocks()
  clearTitleMatchCache()
})

describe('pickBest', () => {
  it('prefers the release year for movies', () => {
    expect(pickBest([DUNE_1984, DUNE_2021], { title: 'Dune', year: 2021 })).toBe(DUNE_2021)
    expect(pickBest([DUNE_1984, DUNE_2021], { title: 'Dune', year: 2022 })).toBe(DUNE_2021)
  })

  it('refuses a movie from another year', () => {
    expect(pickBest([DUNE_1984], { title: 'Dune', year: 2021 })).toBeNull()
  })

  it('keeps a series whose name carries a later season’s year', () => {
    expect(pickBest([DUNE_SERIES], { title: 'Dune Prophecy', year: 2026, type: 'tv' })).toBe(DUNE_SERIES)
  })

  it('takes the top result without a year, of the right type', () => {
    expect(pickBest([DUNE_2021, DUNE_SERIES], { title: 'Dune', type: 'tv' })).toBe(DUNE_SERIES)
    expect(pickBest([DUNE_2021, DUNE_SERIES], { title: 'Dune' })).toBe(DUNE_2021)
    expect(pickBest([], { title: 'Dune' })).toBeNull()
  })

  it('prefers a movie near the year to a series of that exact year', () => {
    const series = title('tv', 1, 'Normal People', 2025)
    const movie = title('movie', 2, 'Normal', 2026)
    expect(pickBest([series, movie], { title: 'Normal', year: 2025 })).toBe(movie)
    expect(pickBest([series, movie], { title: 'Normal', year: 2025 }, 'tv')).toBe(series)
  })

  it('falls back to the other type when the hinted one has nothing', () => {
    expect(pickBest([DUNE_2021], { title: 'Dune', year: 2021 }, 'tv')).toBe(DUNE_2021)
    expect(pickBest([DUNE_2021, DUNE_SERIES], { title: 'Dune' }, 'tv')).toBe(DUNE_SERIES)
  })

  it('takes an exact name over a longer one', () => {
    const special = title('tv', 3, 'Air Crash Investigation: Special Report', 2018)
    const mayday = { ...title('tv', 4, 'Расследования авиакатастроф', 2003), originalTitle: 'Air Crash Investigation' }
    expect(pickBest([special, mayday], { title: 'Air Crash Investigation' })).toBe(mayday)
  })
})

describe('categoryType', () => {
  it('reads common category names', () => {
    expect(categoryType('Movies')).toBe('movie')
    expect(categoryType('Фильмы')).toBe('movie')
    expect(categoryType('Мультфильмы')).toBe('movie')
    expect(categoryType('TV Shows')).toBe('tv')
    expect(categoryType('tv')).toBe('tv')
    expect(categoryType('Сериалы')).toBe('tv')
    expect(categoryType('Music')).toBeUndefined()
    expect(categoryType('')).toBeUndefined()
  })
})

describe('lookupFor', () => {
  it('uses the TMDB tag before the name', () => {
    expect(lookupFor({ name: 'whatever', tags: 'tmdb:movie:438631' }).key).toBe('id:movie:438631')
    expect(lookupFor({ name: 'Dune.2021.1080p', tags: '' }).key).toBe('q::2021:dune')
  })

  it('takes a type hint from the category, but not over season markers', () => {
    expect(lookupFor({ name: 'Normal.2025.BDRemux', tags: '', category: 'Movies' })).toMatchObject({
      key: 'q:~movie:2025:normal',
      hint: 'movie',
    })
    expect(lookupFor({ name: 'Show.S01.1080p', tags: '', category: 'Movies' })).toMatchObject({ key: 'q:tv::show', hint: undefined })
  })
})

describe('useTitleMatches', () => {
  const torrents = [
    { hash: 'a', name: 'Dune.2021.2160p.WEB-DL', tags: '' },
    { hash: 'b', name: 'Dune (2021) BDRip', tags: '' },
    { hash: 'c', name: 'Unknown.Thing.1999.720p', tags: '' },
    { hash: 'd', name: 'Some.Release', tags: 'tmdb:movie:841' },
  ]

  it('looks each title up once and caches it', async () => {
    searchTitles.mockImplementation(async (query) => ({
      titles: query === 'Dune' ? [DUNE_1984, DUNE_2021] : [],
      page: 1,
      totalPages: 1,
    }))
    getMovie.mockResolvedValue({ ...DUNE_1984, title: 'Dune', original_title: 'Dune', release_date: '1984-12-14', poster_path: '/841.jpg' } as never)

    const { result, unmount } = renderHook(() => useTitleMatches(torrents))
    await waitFor(() => expect(result.current.c).toBeNull())
    await waitFor(() => expect(result.current.d).toMatchObject({ id: 841, year: 1984 }))
    expect(result.current.a).toMatchObject({ id: 438631, posterPath: '/438631.jpg' })
    expect(result.current.b).toEqual(result.current.a)
    expect(searchTitles).toHaveBeenCalledTimes(2)
    unmount()

    const again = renderHook(() => useTitleMatches(torrents))
    expect(again.result.current.a).toMatchObject({ id: 438631 })
    expect(searchTitles).toHaveBeenCalledTimes(2)
  })

  it('leaves titles unknown when TMDB is unavailable', async () => {
    searchTitles.mockRejectedValue(new tmdb.TmdbKeyError(404))
    const { result } = renderHook(() => useTitleMatches(torrents.slice(0, 1)))
    await waitFor(() => expect(searchTitles).toHaveBeenCalled())
    expect(result.current.a).toBeUndefined()
  })
})
