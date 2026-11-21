import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as prowlarr from '../api/prowlarr'
import * as qbt from '../api/qbittorrent'
import type { MovieDetails } from '../api/tmdb'
import type { TitleDetails } from '../releases/releaseQuery'
import { SETTINGS_STORAGE_KEY, resetSettings } from '../settings/settings'
import { DUNE_RELEASES, torrent } from '../test/fixtures'
import { MainDataProvider } from '../torrents/MainDataProvider'
import { resetOneOffTorrents } from '../torrents/oneOffTorrents'
import { POLL_INTERVAL_MS } from '../torrents/pollIntervals'
import { useMainData } from '../torrents/useMainData'
import { useReleases } from './useReleases'

vi.mock('../api/prowlarr', async (importOriginal) => {
  const actual = await importOriginal<typeof prowlarr>()
  return { ...actual, searchReleases: vi.fn(), getFailingIndexers: vi.fn() }
})

vi.mock('../api/qbittorrent', async (importOriginal) => ({ ...(await importOriginal<typeof qbt>()), getTorrents: vi.fn(), getMainData: vi.fn() }))

const movie = (id: number, title: string): TitleDetails =>
  ({ type: 'movie', id, title, original_title: title, release_date: '2024-02-27' }) as { type: 'movie' } & MovieDetails

beforeEach(() => {
  vi.resetAllMocks()
  resetSettings()
  vi.mocked(prowlarr.searchReleases).mockResolvedValue(DUNE_RELEASES)
  vi.mocked(prowlarr.getFailingIndexers).mockResolvedValue([])
  resetOneOffTorrents()
  vi.mocked(qbt.getTorrents).mockResolvedValue([])
})

describe('useReleases', () => {
  it.each([
    ['not-configured', 'setup'],
    ['unauthorized', 'rejected'],
    // An answer without the server's code, a proxy's error page say: nothing to set up.
    [undefined, 'error'],
  ] as const)('tells Prowlarr not set up from a rejected key, and from neither: %s', async (code, status) => {
    vi.mocked(prowlarr.searchReleases).mockRejectedValue(new prowlarr.ProwlarrSetupError(code === 'unauthorized' ? 502 : 503, code))
    const { result } = renderHook(() => useReleases(movie(1, 'Dune')))
    await waitFor(() => expect(result.current.status).toBe(status))
  })

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

    describe('with the poll running', () => {
      beforeEach(() => {
        vi.useFakeTimers()
      })
      afterEach(() => {
        vi.useRealTimers()
      })

      it('renders the list again only when a poll changes which releases qBittorrent has', async () => {
        const [first, second] = DUNE_RELEASES
        const other = 'e'.repeat(40)
        vi.mocked(prowlarr.searchReleases).mockResolvedValue([{ ...first, infoHash: V1 }, second])
        const getMainData = vi.mocked(qbt.getMainData)
        getMainData.mockResolvedValue({ rid: 1, full_update: true, torrents: { [V1]: torrent(V1), [other]: torrent(other, { progress: 0.5 }) } })
        // Downloads' poll beside the releases, as the sidebar's on desktop.
        function Sidebar() {
          useMainData()
          return null
        }
        const wrapper = ({ children }: { children: ReactNode }) => (
          <MainDataProvider onUnauthorized={vi.fn()}>
            {children}
            <Sidebar />
          </MainDataProvider>
        )
        let renders = 0
        const { result } = renderHook(
          () => {
            renders++
            return useReleases(movie(1, 'Dune'))
          },
          { wrapper },
        )
        // The poll never runs out of timers, so the clock moves by hand here.
        await act(() => vi.advanceTimersByTimeAsync(0))
        await act(() => vi.advanceTimersByTimeAsync(0))
        expect(result.current.status).toBe('ready')
        expect(result.current.inDownloads(result.current.rows[0])).toBe(V1)
        const before = renders

        // A poll that changes another torrent, then one that changes nothing.
        getMainData.mockResolvedValueOnce({ rid: 2, torrents: { [other]: { progress: 0.6 } } }).mockResolvedValue({ rid: 3 })
        await act(() => vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS * 3))
        expect(getMainData.mock.calls.length).toBeGreaterThanOrEqual(4)
        expect(renders).toBe(before)

        // The torrent goes: the release is addable again.
        getMainData.mockResolvedValueOnce({ rid: 4, torrents_removed: [V1] })
        await act(() => vi.advanceTimersByTimeAsync(POLL_INTERVAL_MS))
        expect(renders).toBe(before + 1)
        expect(result.current.inDownloads(result.current.rows[0])).toBeUndefined()
      })
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
