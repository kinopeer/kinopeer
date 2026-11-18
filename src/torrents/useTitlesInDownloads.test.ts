import { act, renderHook } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
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
const GUESSED = torrent('b', { name: 'Interstellar.2014.1080p' })

beforeEach(() => {
  vi.resetAllMocks()
  resetOneOffTorrents()
  resetServerMatches()
  clearTitleMatchCache()
  getTorrents.mockResolvedValue([TAGGED, GUESSED])
})

const settle = () => act(() => new Promise((resolve) => setTimeout(resolve, 0)))

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
        ['movie:693134', [TAGGED]],
        ['movie:157336', [GUESSED]],
      ]),
    )
  })

  it('reads the guesses this browser cached in the TMDB language, not another', async () => {
    const other = torrent('c', { name: 'Oppenheimer.2023.1080p' })
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
    expect(result.current).toEqual(new Map([['movie:157336', [GUESSED]]]))
  })
})
