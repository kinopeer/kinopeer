import { act, render, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as matchesApi from '../api/matches'
import * as qbittorrent from '../api/qbittorrent'
import i18n from '../i18n'
import { title, tmdbTag, torrent } from '../test/fixtures'
import { MainDataProvider } from './MainDataProvider'
import { resetOneOffTorrents } from './oneOffTorrents'
import { POLL_INTERVAL_MS } from './pollIntervals'
import type { DownloadsMark } from './titleDownloads'
import { resetServerMatches } from './serverMatches'
import { GUESS_VERSION, lookupFor, slim } from './titleLookup'
import { clearTitleMatchCache } from './useTitleMatches'
import { useMainData } from './useMainData'
import { useTitlesInDownloads } from './useTitlesInDownloads'

vi.mock('../api/qbittorrent', async (importOriginal) => ({
  ...(await importOriginal<typeof qbittorrent>()),
  getTorrents: vi.fn(),
  getMainData: vi.fn(),
}))

vi.mock('../api/matches', async (importOriginal) => ({
  ...(await importOriginal<typeof matchesApi>()),
  getMatches: vi.fn(),
}))

const getTorrents = vi.mocked(qbittorrent.getTorrents)
const getMainData = vi.mocked(qbittorrent.getMainData)
const getMatches = vi.mocked(matchesApi.getMatches)

const TAGGED = torrent('a', { tags: tmdbTag('movie', 693134), progress: 0.5 })
const GUESSED = torrent('b', { name: 'Interstellar.2014.1080p', progress: 0 })

beforeEach(() => {
  vi.useFakeTimers()
  vi.resetAllMocks()
  resetOneOffTorrents()
  resetServerMatches()
  clearTitleMatchCache()
  getTorrents.mockResolvedValue([TAGGED, GUESSED])
})

afterEach(() => {
  vi.useRealTimers()
})

/** Lets the answers given so far arrive and be rendered. */
const settle = () => act(() => vi.runAllTimersAsync())

describe('useTitlesInDownloads', () => {
  it('is empty until the server’s matches are in, then files the torrents known by them', async () => {
    let answer!: (matches: matchesApi.Matches) => void
    getMatches.mockReturnValue(new Promise((resolve) => (answer = resolve)))
    const { result } = renderHook(() => useTitlesInDownloads())
    await settle()
    expect(result.current.size).toBe(0)

    answer({ b: { type: 'movie', id: 157336, source: 'guess', version: GUESS_VERSION } })
    await settle()
    expect(result.current).toEqual(
      new Map([
        ['movie:693134', { progress: 0.5 }],
        ['movie:157336', { progress: 0 }],
      ]),
    )
  })

  it('files the torrents once they come after the server’s matches', async () => {
    getMatches.mockResolvedValue({})
    let answer!: (torrents: qbittorrent.Torrent[]) => void
    getTorrents.mockReturnValue(new Promise((resolve) => (answer = resolve)))
    const { result } = renderHook(() => useTitlesInDownloads())
    await settle()
    expect(result.current.size).toBe(0)

    answer([TAGGED])
    await settle()
    expect(result.current).toEqual(new Map([['movie:693134', { progress: 0.5 }]]))
  })

  it('reads the guesses this browser cached in the TMDB language, not another', async () => {
    const other = torrent('c', { name: 'Oppenheimer.2023.1080p', progress: 1 })
    getTorrents.mockResolvedValue([GUESSED, other])
    getMatches.mockResolvedValue({})
    await i18n.changeLanguage('ru')
    const cached = { match: slim(title('movie', 157336, 'Interstellar', 2014)), at: Date.now() }
    localStorage.setItem(
      `kinopeer.titleMatches.v${GUESS_VERSION}`,
      JSON.stringify({ [`ru-RU|${lookupFor(GUESSED).key}`]: cached, [`en-US|${lookupFor(other).key}`]: cached }),
    )
    const { result } = renderHook(() => useTitlesInDownloads())
    await settle()
    expect(result.current).toEqual(new Map([['movie:157336', { progress: 0 }]]))

    // Another language reads its own guesses.
    await act(() => i18n.changeLanguage('en'))
    expect(result.current).toEqual(new Map([['movie:157336', { progress: 1 }]]))
  })

  it('goes by the tags and this browser’s guesses when the server doesn’t give its matches', async () => {
    getMatches.mockRejectedValue(new Error('offline'))
    const cached = { match: slim(title('movie', 157336, 'Interstellar', 2014)), at: Date.now() }
    localStorage.setItem(`kinopeer.titleMatches.v${GUESS_VERSION}`, JSON.stringify({ [`en-US|${lookupFor(GUESSED).key}`]: cached }))
    const { result } = renderHook(() => useTitlesInDownloads())
    await settle()
    expect(result.current).toEqual(
      new Map([
        ['movie:693134', { progress: 0.5 }],
        ['movie:157336', { progress: 0 }],
      ]),
    )
  })

  it('renders its screen only when a poll changes what a mark shows', async () => {
    getMatches.mockResolvedValue({})
    const tagged = { name: 'Dune.Part.Two.2024', tags: tmdbTag('movie', 693134), progress: 0.5 }
    getMainData.mockResolvedValue({ rid: 1, full_update: true, torrents: { a: tagged } })
    let renders = 0
    let shown: ReadonlyMap<string, DownloadsMark> | undefined
    function Search() {
      renders++
      shown = useTitlesInDownloads()
      return null
    }
    // Downloads' poll beside it, as the sidebar's on desktop.
    function Sidebar() {
      useMainData()
      return null
    }
    render(
      <MainDataProvider onUnauthorized={vi.fn()}>
        <Search />
        <Sidebar />
      </MainDataProvider>,
    )
    // The poll never runs out of timers, so the clock moves by hand here.
    await act(() => vi.advanceTimersByTimeAsync(0))
    expect(shown).toEqual(new Map([['movie:693134', { progress: 0.5 }]]))
    const before = renders

    // Polls that change the progress within the same whole percent, or nothing at all.
    getMainData.mockResolvedValueOnce({ rid: 2, torrents: { a: { progress: 0.504 } } }).mockResolvedValue({ rid: 3 })
    await act(() => vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3))
    expect(getMainData).toHaveBeenCalledTimes(4)
    expect(renders).toBe(before)

    getMainData.mockResolvedValueOnce({ rid: 4, torrents: { a: { progress: 0.51 } } })
    await act(() => vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS))
    expect(renders).toBe(before + 1)
    expect(shown).toEqual(new Map([['movie:693134', { progress: 0.51 }]]))
  })
})
