import { act, renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as matchesApi from '../api/matches'
import * as qbittorrent from '../api/qbittorrent'
import i18n from '../i18n'
import { title, tmdbTag, torrent } from '../test/fixtures'
import { resetOneOffTorrents } from './oneOffTorrents'
import { resetServerMatches } from './serverMatches'
import { GUESS_VERSION, lookupFor, slim } from './titleLookup'
import { clearTitleMatchCache } from './useTitleMatches'
import { useTitlesInDownloads } from './useTitlesInDownloads'

vi.mock('../api/qbittorrent', async (importOriginal) => ({
  ...(await importOriginal<typeof qbittorrent>()),
  getTorrents: vi.fn(),
}))

vi.mock('../api/matches', async (importOriginal) => ({
  ...(await importOriginal<typeof matchesApi>()),
  getMatches: vi.fn(),
}))

const getTorrents = vi.mocked(qbittorrent.getTorrents)
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
    const { result } = renderHook(() => useTitlesInDownloads())
    await settle()
    expect(result.current).toEqual(new Map([['movie:693134', { progress: 0.5 }]]))
  })

  it('gives the same marks again while what they show stays, so the cards don’t render again', async () => {
    getTorrents.mockResolvedValue([TAGGED])
    getMatches.mockResolvedValue({})
    await i18n.changeLanguage('ru')
    const { result } = renderHook(() => useTitlesInDownloads())
    await settle()
    const shown = result.current
    expect(shown).toEqual(new Map([['movie:693134', { progress: 0.5 }]]))

    // Filed again in another language: the tag names the same title.
    await act(() => i18n.changeLanguage('en'))
    expect(result.current).toBe(shown)
  })
})
