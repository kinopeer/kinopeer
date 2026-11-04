import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as matchesApi from '../api/matches'
import type { Matches } from '../api/matches'
import * as tmdb from '../api/tmdb'
import { SETTINGS_STORAGE_KEY, resetSettings, updateSettings } from '../settings/settings'
import { searchPage, title } from '../test/fixtures'
import { SAVE_DELAY_MS, resetServerMatches } from './serverMatches'
import {
  GUESS_VERSION,
  LOOKUP_TIMEOUT_MS,
  RATE_LIMIT_WAIT_MS,
  RETRY_DELAYS_MS,
  SHOW_EVERY_MS,
  categoryType,
  chooseTitle,
  clearTitleMatchCache,
  clearTitleMatches,
  isGuessed,
  lookupFor,
  pickBest,
  sameTitle,
  titleType,
  useTitleMatches,
  useTitleTorrents,
} from './titleMatches'

vi.mock('../api/tmdb', async (importOriginal) => {
  const actual = await importOriginal<typeof tmdb>()
  return { ...actual, searchTitles: vi.fn(), getMovie: vi.fn(), getTv: vi.fn() }
})

vi.mock('../api/matches', async (importOriginal) => ({
  ...(await importOriginal<typeof matchesApi>()),
  getMatches: vi.fn(),
  saveMatches: vi.fn(),
  clearGuesses: vi.fn(),
}))

const searchTitles = vi.mocked(tmdb.searchTitles)
const getMovie = vi.mocked(tmdb.getMovie)
const getMatches = vi.mocked(matchesApi.getMatches)
const saveMatches = vi.mocked(matchesApi.saveMatches)

/** What the fake Kinoseed server keeps. */
let server: Matches

const DUNE_1984 = title('movie', 841, 'Dune', 1984)
const DUNE_2021 = title('movie', 438631, 'Dune', 2021)
const DUNE_SERIES = title('tv', 90228, 'Dune: Prophecy', 2024)

beforeEach(() => {
  vi.resetAllMocks()
  clearTitleMatchCache()
  resetServerMatches()
  server = {}
  getMatches.mockImplementation(async () => ({ ...server }))
  saveMatches.mockImplementation(async (changes) => {
    server = { ...server, ...(changes as Matches) }
    return { ...server }
  })
})

afterEach(() => {
  vi.useRealTimers()
})

/** Where this browser keeps titles and guesses for the next page load. */
const CACHE_KEY = `kinoseed.titleMatches.v${GUESS_VERSION}`
/** The keys in that cache, sorted. */
const storedKeys = () => Object.keys(JSON.parse(localStorage.getItem(CACHE_KEY) ?? '{}') as object).sort()

/** Runs the batched save of the guesses made so far (serverMatches waits SAVE_DELAY_MS for more). */
const flushSave = () => act(() => vi.advanceTimersByTimeAsync(SAVE_DELAY_MS))

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
    const special = title('tv', 3, 'Dune: Special Report', 2018)
    const dune = { ...title('tv', 4, 'Дюна', 2000), originalTitle: 'Dune' }
    expect(pickBest([special, dune], { title: 'Dune' })).toBe(dune)
  })

  it('takes an exact name a year off over another title of the exact year', () => {
    const woman = title('movie', 5, 'A Normal Woman', 2025)
    const normal = { ...title('movie', 6, 'Нормал', 2026), originalTitle: 'Normal' }
    expect(pickBest([normal, woman], { title: 'Normal', year: 2025 }, 'movie')).toBe(normal)
  })

  it('ranks a "<name>: Subtitle" spin-off last', () => {
    const special = title('tv', 3, 'Air Crash Investigation: Special Report', 2018)
    const mayday = { ...title('tv', 4, 'Расследования авиакатастроф', 2003), originalTitle: 'Mayday' }
    expect(pickBest([special, mayday], { title: 'Air Crash Investigation' }, 'tv')).toBe(mayday)
    expect(pickBest([special], { title: 'Air Crash Investigation' }, 'tv')).toBe(special)
  })
})

describe('sameTitle', () => {
  it('is the same TMDB title by type and id, and never a missing one', () => {
    expect(sameTitle({ type: 'tv', id: 1 }, { type: 'tv', id: 1 })).toBe(true)
    expect(sameTitle({ type: 'tv', id: 1 }, { type: 'movie', id: 1 })).toBe(false)
    expect(sameTitle({ type: 'tv', id: 1 }, { type: 'tv', id: 2 })).toBe(false)
    expect(sameTitle(null, null)).toBe(false)
    expect(sameTitle({ type: 'tv', id: 1 }, undefined)).toBe(false)
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
  it('takes the user’s choice, then the tag, then a current guess, then the name', () => {
    const torrent = { name: 'Dune.2021.1080p', tags: 'tmdb:movie:438631' }
    expect(lookupFor(torrent, { type: 'tv', id: 1, source: 'user' }).key).toBe('id:tv:1')
    expect(lookupFor(torrent, { type: 'tv', id: 2, source: 'guess', version: GUESS_VERSION }).key).toBe('id:movie:438631')
    const untagged = { ...torrent, tags: '' }
    expect(lookupFor(untagged, { type: 'tv', id: 2, source: 'guess', version: GUESS_VERSION }).key).toBe('id:tv:2')
    expect(lookupFor(untagged, { type: 'tv', id: 2, source: 'guess', version: GUESS_VERSION - 1 }).key).toBe('q::2021:dune')
    expect(lookupFor(untagged).key).toBe('q::2021:dune')
  })

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

describe('titleType', () => {
  const movie = { type: 'movie', id: 438631, title: 'Dune', year: 2021, posterPath: null } as const

  it('takes the matched title’s type first', () => {
    expect(titleType({ name: 'Dune.S01.1080p', tags: '' }, undefined, movie)).toBe('movie')
  })

  it('knows the type of a chosen, tagged or guessed title before TMDB answers', () => {
    expect(titleType({ name: 'Dune.2021', tags: '' }, { type: 'tv', id: 1, source: 'user' })).toBe('tv')
    expect(titleType({ name: 'Dune.2021', tags: 'tmdb:movie:438631' })).toBe('movie')
    expect(titleType({ name: 'Dune.2021', tags: '' }, { type: 'tv', id: 2, source: 'guess', version: GUESS_VERSION })).toBe('tv')
  })

  it('falls back to season markers in the name, then the category', () => {
    expect(titleType({ name: 'Andor.S02.1080p', tags: '' }, undefined, null)).toBe('tv')
    expect(titleType({ name: 'Normal.2025.BDRemux', tags: '', category: 'Movies' }, undefined, null)).toBe('movie')
    expect(titleType({ name: 'Andor.S02.1080p', tags: '', category: 'Movies' })).toBe('tv')
  })

  it('is unknown when nothing says', () => {
    expect(titleType({ name: 'Alien.Romulus.2024.1080p', tags: '' }, undefined, null)).toBeUndefined()
    expect(titleType({ name: 'Some.Program.v2', tags: '', category: 'Software' })).toBeUndefined()
  })
})

describe('isGuessed', () => {
  it('is a guess unless the user chose the title or Kinoseed tagged the torrent', () => {
    expect(isGuessed({ tags: '' })).toBe(true)
    expect(isGuessed({ tags: '' }, { type: 'movie', id: 1, source: 'guess', version: GUESS_VERSION })).toBe(true)
    expect(isGuessed({ tags: '' }, { type: 'movie', id: 1, source: 'user' })).toBe(false)
    expect(isGuessed({ tags: 'hd, tmdb:movie:1' })).toBe(false)
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
    searchTitles.mockImplementation(async (query) => searchPage(query === 'Dune' ? [DUNE_1984, DUNE_2021] : []))
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

  it('shows the server’s guess without guessing again', async () => {
    server = { a: { type: 'movie', id: 841, source: 'guess', version: GUESS_VERSION } }
    getMovie.mockResolvedValue({ ...DUNE_1984, title: 'Dune', original_title: 'Dune', release_date: '1984-12-14', poster_path: '/841.jpg' } as never)
    const { result } = renderHook(() => useTitleMatches(torrents.slice(0, 1)))
    await waitFor(() => expect(result.current.a).toMatchObject({ id: 841, year: 1984 }))
    expect(searchTitles).not.toHaveBeenCalled()
  })

  it('saves new guesses on the server, and then shows them without asking TMDB again', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    searchTitles.mockResolvedValue(searchPage([DUNE_2021]))
    const { result } = renderHook(() => useTitleMatches(torrents.slice(0, 2)))
    await waitFor(() => expect(result.current.a).toMatchObject({ id: 438631 }))
    await flushSave()
    expect(server).toEqual({
      a: { type: 'movie', id: 438631, source: 'guess', version: GUESS_VERSION },
      b: { type: 'movie', id: 438631, source: 'guess', version: GUESS_VERSION },
    })
    expect(result.current.a).toMatchObject({ id: 438631 })
    expect(saveMatches).toHaveBeenCalledTimes(1)
    expect(searchTitles).toHaveBeenCalledTimes(1)
    expect(getMovie).not.toHaveBeenCalled()
  })

  it('saves guesses this browser made before, and none for tagged torrents', async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true })
    searchTitles.mockResolvedValue(searchPage([DUNE_2021]))
    getMovie.mockResolvedValue({ ...DUNE_1984, title: 'Dune', original_title: 'Dune', release_date: '1984-12-14', poster_path: '/841.jpg' } as never)
    getMatches.mockRejectedValueOnce(new matchesApi.MatchesError(502))
    saveMatches.mockRejectedValueOnce(new matchesApi.MatchesError(502))
    const offline = renderHook(() => useTitleMatches([torrents[0], torrents[3]]))
    await waitFor(() => expect(offline.result.current.a).toMatchObject({ id: 438631 }))
    await flushSave()
    expect(saveMatches).toHaveBeenCalledTimes(1)
    offline.unmount()

    resetServerMatches()
    const { result } = renderHook(() => useTitleMatches([torrents[0], torrents[3]]))
    await waitFor(() => expect(result.current.a).toMatchObject({ id: 438631 }))
    await flushSave()
    expect(server).toEqual({ a: { type: 'movie', id: 438631, source: 'guess', version: GUESS_VERSION } })
    expect(searchTitles).toHaveBeenCalledTimes(1)
  })

  it('keeps a title for the next visit as it shows', async () => {
    getMovie.mockResolvedValue({ ...DUNE_1984, title: 'Dune', original_title: 'Dune', release_date: '1984-12-14', poster_path: '/841.jpg' } as never)
    const { result } = renderHook(() => useTitleMatches([torrents[3]]))
    await waitFor(() => expect(result.current.d).toMatchObject({ id: 841 }))
    expect(storedKeys()).toContain('en-US|id:movie:841')
  })

  it('waits for the server’s matches before guessing', async () => {
    getMatches.mockReturnValue(new Promise(() => {}))
    getMovie.mockResolvedValue({ ...DUNE_1984, title: 'Dune', original_title: 'Dune', release_date: '1984-12-14', poster_path: '/841.jpg' } as never)
    const { result } = renderHook(() => useTitleMatches([torrents[0], torrents[3]]))
    await waitFor(() => expect(result.current.d).toMatchObject({ id: 841 }))
    expect(result.current.a).toBeUndefined()
    expect(searchTitles).not.toHaveBeenCalled()
  })

  describe('with more torrents to guess than lookups at a time', () => {
    const NAMES = ['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo']
    const many = NAMES.map((name, i) => ({ hash: name, name: `${name}.${2000 + i}.1080p.WEB-DL`, tags: '' }))
    const found = (i: number) => [title('movie', i + 1, NAMES[i], 2000 + i)]

    /** The guesses by name in localStorage, which the next page load starts from. */
    const storedGuesses = () => storedKeys().filter((key) => key.startsWith('en-US|q:'))
    const guessKeys = (count: number) => NAMES.slice(0, count).map((name, i) => `en-US|q::${2000 + i}:${name.toLowerCase()}`)

    afterEach(() => {
      localStorage.removeItem(SETTINGS_STORAGE_KEY)
      resetSettings()
    })

    interface Held {
      query: string
      language?: string
      signal: AbortSignal
      answer: (titles: ReturnType<typeof title>[]) => void
      fail: (error: Error) => void
    }

    /** TMDB searches that wait for the test to answer; like `fetch`, an aborted one rejects. */
    function holdSearches(): Held[] {
      const held: Held[] = []
      searchTitles.mockImplementation(
        (query, options) =>
          new Promise((resolve, reject) => {
            const signal = options!.signal!
            signal.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')))
            held.push({ query, language: options!.language, signal, answer: (titles) => resolve(searchPage(titles)), fail: reject })
          }),
      )
      return held
    }

    /** The names searched so far, in order. */
    const queries = (held: Held[]) => held.map((search) => search.query)
    /** The latest search for `NAMES[i]`. */
    const latest = (held: Held[], i: number) => held.findLast((search) => search.query === NAMES[i])!
    const searchesFor = (held: Held[], i: number) => held.filter((search) => search.query === NAMES[i]).length
    /** Lets the fake clock run `ms`, and whatever it starts settle. */
    const pass = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms))

    /** Answers the search for `NAMES[i]` once it's sent. */
    async function answer(held: Held[], i: number) {
      await waitFor(() => expect(held.some((search) => search.query === NAMES[i] && !search.signal.aborted)).toBe(true))
      await act(async () => held.findLast((search) => search.query === NAMES[i])!.answer(found(i)))
    }

    it('looks each one up once, and a title that arrives doesn’t stop the others', async () => {
      const held = holdSearches()
      const { result } = renderHook(() => useTitleMatches(many))
      await waitFor(() => expect(held).toHaveLength(3))

      await answer(held, 0)
      await waitFor(() => expect(result.current.Alpha).toMatchObject({ id: 1 }))
      expect(held.map((search) => search.signal.aborted)).toEqual([false, false, false, false])

      for (let i = 1; i < NAMES.length; i++) await answer(held, i)
      await waitFor(() => expect(result.current.Echo).toMatchObject({ id: 5 }))
      expect(held.map((search) => search.query)).toEqual(NAMES)
      expect(held.some((search) => search.signal.aborted)).toBe(false)
    })

    it('looks up torrents that come while others are in flight, once each', async () => {
      const held = holdSearches()
      const { result, rerender } = renderHook(({ list }) => useTitleMatches(list), { initialProps: { list: many.slice(0, 3) } })
      await waitFor(() => expect(held).toHaveLength(3))

      rerender({ list: many })
      for (let i = 0; i < NAMES.length; i++) await answer(held, i)
      await waitFor(() => expect(result.current.Echo).toMatchObject({ id: 5 }))
      expect(held.map((search) => search.query)).toEqual(NAMES)
      expect(held.some((search) => search.signal.aborted)).toBe(false)
    })

    it('skips a torrent that went away before its turn', async () => {
      const held = holdSearches()
      const { result, rerender } = renderHook(({ list }) => useTitleMatches(list), { initialProps: { list: many } })
      await waitFor(() => expect(held).toHaveLength(3))

      rerender({ list: many.filter((torrent) => torrent.hash !== 'Delta') })
      for (const i of [0, 1, 2, 4]) await answer(held, i)
      await waitFor(() => expect(result.current.Echo).toMatchObject({ id: 5 }))
      expect(held.map((search) => search.query)).toEqual(['Alpha', 'Bravo', 'Charlie', 'Echo'])
    })

    it('stops the lookups in flight when the list goes away', async () => {
      const held = holdSearches()
      const { unmount } = renderHook(() => useTitleMatches(many))
      await waitFor(() => expect(held).toHaveLength(3))
      unmount()
      expect(held.map((search) => search.signal.aborted)).toEqual([true, true, true])
    })

    it('starts over in another language, stopping the lookups in flight', async () => {
      const held = holdSearches()
      renderHook(() => useTitleMatches(many))
      await waitFor(() => expect(held).toHaveLength(3))

      act(() => updateSettings({ tmdbLanguage: 'ru-RU' }))
      expect(held.slice(0, 3).map((search) => search.signal.aborted)).toEqual([true, true, true])
      expect(held).toHaveLength(6)
      expect(held.slice(3).map((search) => [search.query, search.language])).toEqual([
        ['Alpha', 'ru-RU'],
        ['Bravo', 'ru-RU'],
        ['Charlie', 'ru-RU'],
      ])
    })

    it('asks a failed lookup again later, waiting longer each time, not with every change to the list', async () => {
      vi.useFakeTimers()
      const held = holdSearches()
      const { result, rerender } = renderHook(({ list }) => useTitleMatches(list), { initialProps: { list: many.slice(0, 4) } })
      await pass(0)
      await act(async () => held[0].fail(new tmdb.TmdbError('TMDB responded 500', 500)))

      // A torrent comes and the others' titles arrive: Alpha isn't asked again for that.
      rerender({ list: many })
      for (const i of [1, 2, 3, 4]) await act(async () => latest(held, i).answer(found(i)))
      expect(queries(held)).toEqual(NAMES)

      await pass(RETRY_DELAYS_MS[0] - 1)
      expect(searchesFor(held, 0)).toBe(1)
      await pass(1)
      expect(searchesFor(held, 0)).toBe(2)

      await act(async () => latest(held, 0).fail(new tmdb.TmdbError('TMDB responded 500', 500)))
      await pass(RETRY_DELAYS_MS[1] - 1)
      expect(searchesFor(held, 0)).toBe(2)
      await pass(1)
      expect(searchesFor(held, 0)).toBe(3)
      await act(async () => latest(held, 0).answer(found(0)))
      await pass(SHOW_EVERY_MS)
      expect(result.current.Alpha).toMatchObject({ id: 1 })
    })

    it('sends nothing while TMDB asks to wait (429), then asks again and goes on', async () => {
      vi.useFakeTimers()
      const held = holdSearches()
      renderHook(() => useTitleMatches(many))
      await pass(0)
      await act(async () => held[0].fail(new tmdb.TmdbError('TMDB responded 429', 429, 5_000)))
      await act(async () => held[1].answer(found(1)))
      expect(queries(held)).toEqual(['Alpha', 'Bravo', 'Charlie'])

      await pass(4_999)
      expect(queries(held)).toEqual(['Alpha', 'Bravo', 'Charlie'])
      await pass(1)
      expect(queries(held)).toEqual(['Alpha', 'Bravo', 'Charlie', 'Alpha', 'Delta'])
    })

    it('waits for the longest a 429 asks: a later, longer one extends the wait, a shorter one doesn’t cut it', async () => {
      vi.useFakeTimers()
      const held = holdSearches()
      renderHook(() => useTitleMatches(many))
      await pass(0)
      await act(async () => held[0].fail(new tmdb.TmdbError('TMDB responded 429', 429, 5_000)))
      await pass(1_000)
      await act(async () => held[1].fail(new tmdb.TmdbError('TMDB responded 429', 429, 10_000)))
      await pass(1_000)
      await act(async () => held[2].fail(new tmdb.TmdbError('TMDB responded 429', 429, 2_000)))

      // Paused until 11 s, what the second asked for.
      await pass(8_999)
      expect(queries(held)).toEqual(['Alpha', 'Bravo', 'Charlie'])
      await pass(1)
      expect(queries(held)).toEqual(['Alpha', 'Bravo', 'Charlie', 'Alpha', 'Bravo', 'Charlie'])
    })

    it('sends nothing more once the list goes away, even when a retry falls due', async () => {
      vi.useFakeTimers()
      const held = holdSearches()
      const { unmount } = renderHook(() => useTitleMatches(many))
      await pass(0)
      await act(async () => held[0].fail(new tmdb.TmdbError('TMDB responded 500', 500)))
      await act(async () => held[1].fail(new tmdb.TmdbError('TMDB responded 429', 429, 5_000)))
      unmount()

      await pass(RETRY_DELAYS_MS[0])
      expect(queries(held)).toEqual(['Alpha', 'Bravo', 'Charlie', 'Delta'])
    })

    it('waits RATE_LIMIT_WAIT_MS after a 429 that doesn’t say how long', async () => {
      vi.useFakeTimers()
      const held = holdSearches()
      renderHook(() => useTitleMatches(many))
      await pass(0)
      await act(async () => held[0].fail(new tmdb.TmdbError('TMDB responded 429', 429)))

      await pass(RATE_LIMIT_WAIT_MS - 1)
      expect(searchesFor(held, 0)).toBe(1)
      await pass(1)
      expect(searchesFor(held, 0)).toBe(2)
    })

    it('gives up on a search TMDB doesn’t answer in LOOKUP_TIMEOUT_MS, and asks again later', async () => {
      vi.useFakeTimers()
      const held = holdSearches()
      renderHook(() => useTitleMatches(many))
      await pass(LOOKUP_TIMEOUT_MS - 1)
      expect(held.some((search) => search.signal.aborted)).toBe(false)

      await pass(1)
      expect(held.slice(0, 3).map((search) => search.signal.aborted)).toEqual([true, true, true])
      expect(queries(held)).toEqual(['Alpha', 'Bravo', 'Charlie', 'Delta', 'Echo'])
      await act(async () => latest(held, 3).answer(found(3)))
      await act(async () => latest(held, 4).answer(found(4)))

      await pass(RETRY_DELAYS_MS[0])
      expect(queries(held).slice(5)).toEqual(['Alpha', 'Bravo', 'Charlie'])
    })

    it('shows the titles that keep coming together, at most every SHOW_EVERY_MS', async () => {
      vi.useFakeTimers()
      const held = holdSearches()
      let renders = 0
      const { result, unmount } = renderHook(() => {
        renders++
        return useTitleMatches(many)
      })
      await pass(0)
      expect(held).toHaveLength(3)

      // The first title shows right away, the next ones together once SHOW_EVERY_MS has passed.
      await act(async () => held[0].answer(found(0)))
      await pass(0)
      expect(result.current.Alpha).toMatchObject({ id: 1 })
      const rendered = renders
      await act(async () => held[1].answer(found(1)))
      await act(async () => held[2].answer(found(2)))
      await pass(SHOW_EVERY_MS - 1)
      expect(result.current.Bravo).toBeUndefined()
      // Each show renders the whole list, so both titles come in one render.
      await pass(1)
      expect(result.current.Bravo).toMatchObject({ id: 2 })
      expect(result.current.Charlie).toMatchObject({ id: 3 })
      expect(renders - rendered).toBe(1)

      // One that arrives as the list goes away is still kept for the next visit.
      await act(async () => held[3].answer(found(3)))
      expect(storedGuesses()).toEqual(guessKeys(3))
      unmount()
      expect(storedGuesses()).toEqual(guessKeys(4))
    })
  })
})

describe('chooseTitle', () => {
  it('saves the user’s choice and shows its title everywhere without asking TMDB', async () => {
    searchTitles.mockResolvedValue(searchPage([DUNE_2021]))
    const torrent = { hash: 'a', name: 'Dune.2021.2160p.WEB-DL', tags: '' }
    const { result } = renderHook(() => useTitleMatches([torrent]))
    await waitFor(() => expect(result.current.a).toMatchObject({ id: 438631 }))

    await chooseTitle('a', DUNE_1984, 'en-US')
    expect(server.a).toEqual({ type: 'movie', id: 841, source: 'user' })
    expect(storedKeys()).toContain('en-US|id:movie:841')
    await waitFor(() =>
      expect(result.current.a).toEqual({ type: 'movie', id: 841, title: 'Dune', year: 1984, posterPath: '/841.jpg' }),
    )
    expect(getMovie).not.toHaveBeenCalled()
  })

  it('fails when the server doesn’t save it', async () => {
    saveMatches.mockRejectedValue(new matchesApi.MatchesError(500))
    await expect(chooseTitle('a', DUNE_1984, 'en-US')).rejects.toThrow()
  })
})

describe('clearTitleMatches', () => {
  it('forgets this browser’s cache and the server’s guesses', async () => {
    localStorage.setItem(CACHE_KEY, '{}')
    vi.mocked(matchesApi.clearGuesses).mockResolvedValue({})
    await clearTitleMatches()
    expect(localStorage.getItem(CACHE_KEY)).toBeNull()
    expect(matchesApi.clearGuesses).toHaveBeenCalled()
  })
})

describe('useTitleTorrents', () => {
  const torrent = (hash: string, name: string, tags: string, added_on: number) => ({ hash, name, tags, added_on })

  it("finds a title's torrents by tag, the user's choice and guesses, newest first", async () => {
    server = {
      chosen: { type: 'movie', id: 438631, source: 'user' },
      moved: { type: 'movie', id: 841, source: 'user' },
    }
    searchTitles.mockResolvedValue(searchPage([DUNE_2021]))
    getMovie.mockResolvedValue({ id: 438631, title: 'Dune', release_date: '2021-09-15', poster_path: null } as Awaited<
      ReturnType<typeof tmdb.getMovie>
    >)
    const torrents = [
      torrent('tagged', 'Dune.2021.2160p', 'tmdb:movie:438631', 1),
      torrent('chosen', 'Home.Video', '', 3),
      torrent('guessed', 'Dune.2021.1080p.BluRay', '', 2),
      torrent('moved', 'Dune.2021.720p', 'tmdb:movie:438631', 4),
      torrent('other', 'Dune.Prophecy.S01', 'tmdb:tv:90228', 5),
    ]
    const { result } = renderHook(() => useTitleTorrents(torrents, 'movie', 438631))
    // Tagged torrents count before any TMDB answer.
    expect(result.current.map((t) => t.hash)).toContain('tagged')
    await waitFor(() => expect(result.current.map((t) => t.hash)).toEqual(['chosen', 'guessed', 'tagged']))
  })
})
