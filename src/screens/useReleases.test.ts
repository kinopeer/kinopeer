import { act, renderHook, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as prowlarr from '../api/prowlarr'
import * as qbt from '../api/qbittorrent'
import type { MovieDetails } from '../api/tmdb'
import type { TitleDetails } from '../releases/releaseQuery'
import { SETTINGS_STORAGE_KEY, resetSettings } from '../settings/settings'
import { DUNE_RELEASES, torrent } from '../test/fixtures'
import { resetOneOffTorrents } from '../torrents/oneOffTorrents'
import { useReleases } from './useReleases'

vi.mock('../api/prowlarr', async (importOriginal) => {
  const actual = await importOriginal<typeof prowlarr>()
  return { ...actual, searchReleases: vi.fn() }
})

vi.mock('../api/qbittorrent', async (importOriginal) => ({ ...(await importOriginal<typeof qbt>()), getTorrents: vi.fn() }))

const movie = (id: number, title: string): TitleDetails =>
  ({ type: 'movie', id, title, original_title: title, release_date: '2024-02-27' }) as { type: 'movie' } & MovieDetails

beforeEach(() => {
  vi.resetAllMocks()
  resetSettings()
  vi.mocked(prowlarr.searchReleases).mockResolvedValue(DUNE_RELEASES)
  resetOneOffTorrents()
  vi.mocked(qbt.getTorrents).mockResolvedValue([])
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

  it('picks a sort in its usual direction, reverses it from its column or the direction button, and remembers it', async () => {
    const { result } = renderHook(() => useReleases(movie(1, 'Dune')))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.sort).toEqual({ key: 'seeds', descending: true })

    // A column's click reverses the current sort and takes another in its usual direction.
    act(() => result.current.clickSort('seeds'))
    expect(result.current.sort).toEqual({ key: 'seeds', descending: false })
    act(() => result.current.clickSort('size'))
    expect(result.current.sort).toEqual({ key: 'size', descending: true })
    expect(result.current.visible.map((row) => row.release.size)).toEqual(
      DUNE_RELEASES.map((release) => release.size).sort((a, b) => b - a),
    )

    act(() => result.current.reverseSort())
    expect(result.current.sort).toEqual({ key: 'size', descending: false })
    expect(JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY)!).releaseSort).toEqual({ key: 'size', descending: false })

    // A pick doesn't keep the reversed direction, for another sort or the current one.
    act(() => result.current.pickSort('date'))
    expect(result.current.sort).toEqual({ key: 'date', descending: true })
    act(() => result.current.reverseSort())
    act(() => result.current.pickSort('date'))
    expect(result.current.sort).toEqual({ key: 'date', descending: true })
  })

  it('walks the sorts from the chip: each one the other way, then the next in its usual direction', async () => {
    const { result } = renderHook(() => useReleases(movie(1, 'Dune')))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    const walked = []
    for (let press = 0; press < 6; press++) {
      act(() => result.current.cycleSort())
      walked.push(`${result.current.sort.key} ${result.current.sort.descending ? 'down' : 'up'}`)
    }
    expect(walked).toEqual(['seeds up', 'size down', 'size up', 'date down', 'date up', 'seeds down'])
    expect(JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY)!).releaseSort).toEqual({ key: 'seeds', descending: true })
  })

  describe('the releases qBittorrent has', () => {
    const V1 = 'c12fe1c06bba254a9dc9f519b335aa7c1367a88a'
    const V2 = 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f90'

    it('gives the torrent of each release qBittorrent has, by the release’s info hash', async () => {
      const [first, second, third] = DUNE_RELEASES
      vi.mocked(prowlarr.searchReleases).mockResolvedValue([
        { ...first, infoHash: V1.toUpperCase() },
        { ...second, infoHash: V2 },
        { ...third, infoHash: 'f'.repeat(40) },
        ...DUNE_RELEASES.slice(3),
      ])
      vi.mocked(qbt.getTorrents).mockResolvedValue([torrent(V1), torrent(V2.slice(0, 40)), torrent('e'.repeat(40))])
      const { result } = renderHook(() => useReleases(movie(1, 'Dune')))
      await waitFor(() => expect(result.current.inDownloads(result.current.rows[0])).toBe(V1))
      const held = result.current.rows.map((row) => result.current.inDownloads(row))
      // A v2-only torrent by its v2 hash cut to 40 digits; one it doesn't have, and one without a
      // hash, open nothing.
      expect(held).toEqual([V1, V2.slice(0, 40), ...DUNE_RELEASES.slice(2).map(() => undefined)])
    })

    it('gives none before the torrents are here', async () => {
      vi.mocked(prowlarr.searchReleases).mockResolvedValue([{ ...DUNE_RELEASES[0], infoHash: V1 }])
      vi.mocked(qbt.getTorrents).mockReturnValue(new Promise(() => {}))
      const { result } = renderHook(() => useReleases(movie(1, 'Dune')))
      await waitFor(() => expect(result.current.status).toBe('ready'))
      expect(result.current.inDownloads(result.current.rows[0])).toBeUndefined()
    })
  })
})
