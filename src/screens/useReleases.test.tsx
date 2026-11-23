import { act, renderHook, waitFor } from '@testing-library/react'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as prowlarr from '../api/prowlarr'
import * as qbt from '../api/qbittorrent'
import * as tmdb from '../api/tmdb'
import type { MovieDetails } from '../api/tmdb'
import type { Release } from '../api/prowlarr'
import type { TitleDetails } from '../releases/releaseQuery'
import { SETTINGS_STORAGE_KEY, resetSettings } from '../settings/settings'
import { DUNE_RELEASES, PARASITE_RU, torrent } from '../test/fixtures'
import { MainDataProvider } from '../torrents/MainDataProvider'
import { resetOneOffTorrents } from '../torrents/oneOffTorrents'
import { POLL_INTERVAL_MS } from '../torrents/pollIntervals'
import { useMainData } from '../torrents/useMainData'
import { useReleases } from './useReleases'

vi.mock('../api/prowlarr', async (importOriginal) => {
  const actual = await importOriginal<typeof prowlarr>()
  return { ...actual, searchReleases: vi.fn(), getFailingIndexers: vi.fn() }
})

vi.mock('../api/tmdb', async (importOriginal) => ({ ...(await importOriginal<typeof tmdb>()), getMovie: vi.fn(), getTv: vi.fn() }))

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
  ] as const)('tells Prowlarr not set up from a rejected key: %s', async (code, status) => {
    vi.mocked(prowlarr.searchReleases).mockRejectedValue(new prowlarr.ProwlarrSetupError(code === 'unauthorized' ? 502 : 503, code))
    const { result } = renderHook(() => useReleases(movie(1, 'Dune')))
    await waitFor(() => expect(result.current.status).toBe(status))
    // Only the `error` status names who didn't answer.
    expect(result.current.unreachable).toBeUndefined()
  })

  it('keeps why Prowlarr didn’t answer the search, where the server could tell (#508)', async () => {
    vi.mocked(prowlarr.searchReleases).mockRejectedValue(new prowlarr.ProwlarrError('Prowlarr request failed (unreachable)', 502, 'unreachable', 'refused'))
    const { result } = renderHook(() => useReleases(movie(1, 'Dune')))
    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.failure).toBe('refused')
  })

  it.each([
    ['Kinopeer’s server, something in front of it answering', () => new qbt.KinopeerUnreachableError(502), 'kinopeer'],
    ['Kinopeer’s server, nothing answering', () => new TypeError('Failed to fetch'), 'unreached'],
    ['Prowlarr, behind the bridge', () => new prowlarr.ProwlarrError('down', 502, 'unreachable'), 'qbittorrent'],
  ] as const)('says who didn’t answer the search: %s (#566)', async (_name, error, who) => {
    vi.mocked(prowlarr.searchReleases).mockRejectedValue(error())
    const { result } = renderHook(() => useReleases(movie(1, 'Dune')))
    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.unreachable).toBe(who)
  })

  it.each([
    ["qBittorrent didn't give Prowlarr's address and key", () => new prowlarr.ProwlarrKeyReadError(new TypeError('Failed to fetch')), true],
    ["Prowlarr didn't answer", () => new TypeError('Failed to fetch'), false],
  ] as const)('tells in the WebUI build whether qBittorrent or Prowlarr failed the search: %s', async (_name, error, unread) => {
    vi.stubGlobal('__WEBUI__', true)
    vi.mocked(prowlarr.searchReleases).mockRejectedValue(error())
    const { result } = renderHook(() => useReleases(movie(1, 'Dune')))
    await waitFor(() => expect(result.current.status).toBe('error'))
    expect(result.current.unread).toBe(unread)
  })

  it('names no one who didn’t answer a search that was answered (#566)', async () => {
    vi.mocked(prowlarr.searchReleases).mockResolvedValue(DUNE_RELEASES)
    const { result } = renderHook(() => useReleases(movie(1, 'Dune')))
    await waitFor(() => expect(result.current.status).toBe('ready'))
    expect(result.current.unreachable).toBeUndefined()
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

  describe('a title whose original name isn’t in Latin script (#581)', () => {
    const parasite: TitleDetails = { type: 'movie', ...PARASITE_RU }
    const english: MovieDetails = { ...PARASITE_RU, title: 'Parasite' }
    const found = (id: string, more: Partial<Release> = {}): Release => ({ ...DUNE_RELEASES[0], id, title: `Parasite.2019.1080p.${id}-GRPA`, ...more })

    it('searches by the original and the English name, and lists a release both found once', async () => {
      vi.mocked(tmdb.getMovie).mockResolvedValue(english)
      const both = found('both', { infoHash: 'aa', indexer: 'Indexer A' })
      vi.mocked(prowlarr.searchReleases).mockImplementation(async (query) =>
        query === '기생충 2019' ? [both, found('original', { infoHash: 'bb' })] : [{ ...both, id: 'both-again' }, found('english', { infoHash: 'cc' })],
      )
      const { result } = renderHook(() => useReleases(parasite))
      await waitFor(() => expect(result.current.status).toBe('ready'))
      expect(tmdb.getMovie).toHaveBeenCalledWith(496243, { language: 'en-US', signal: expect.any(AbortSignal) })
      expect(vi.mocked(prowlarr.searchReleases).mock.calls.map(([query]) => query)).toEqual(['기생충 2019', 'Parasite 2019'])
      expect(result.current.rows.map((row) => row.release.id)).toEqual(['both', 'original', 'english'])
    })

    it('counts an indexer that answered either search as answered', async () => {
      vi.mocked(tmdb.getMovie).mockResolvedValue(english)
      vi.mocked(prowlarr.getFailingIndexers).mockResolvedValue(['Indexer B', 'Indexer C'])
      vi.mocked(prowlarr.searchReleases).mockImplementation(async (query) =>
        query === '기생충 2019' ? [] : [found('english', { infoHash: 'cc', indexer: 'Indexer B' })],
      )
      const { result } = renderHook(() => useReleases(parasite))
      await waitFor(() => expect(result.current.failing).toEqual(['Indexer C']))
      expect(prowlarr.getFailingIndexers).toHaveBeenCalledTimes(1)
    })

    it('waits for the English name before searching', async () => {
      vi.mocked(tmdb.getMovie).mockReturnValue(new Promise(() => {}))
      const { result } = renderHook(() => useReleases(parasite))
      await waitFor(() => expect(tmdb.getMovie).toHaveBeenCalled())
      expect(prowlarr.searchReleases).not.toHaveBeenCalled()
      expect(result.current.status).toBe('loading')
    })

    it('searches by the original alone when TMDB doesn’t give the English name', async () => {
      vi.mocked(tmdb.getMovie).mockRejectedValue(new tmdb.TmdbError('down', 503))
      const { result } = renderHook(() => useReleases(parasite))
      await waitFor(() => expect(result.current.status).toBe('ready'))
      expect(vi.mocked(prowlarr.searchReleases).mock.calls.map(([query]) => query)).toEqual(['기생충 2019'])
    })

    it('asks TMDB for the English name again on Try again, after it failed', async () => {
      vi.mocked(tmdb.getMovie).mockRejectedValueOnce(new tmdb.TmdbError('down', 503)).mockResolvedValue(english)
      vi.mocked(prowlarr.searchReleases).mockResolvedValue([])
      const { result } = renderHook(() => useReleases(parasite))
      await waitFor(() => expect(result.current.status).toBe('none'))
      expect(vi.mocked(prowlarr.searchReleases).mock.calls.map(([query]) => query)).toEqual(['기생충 2019'])

      act(() => result.current.retry())
      await waitFor(() => expect(vi.mocked(prowlarr.searchReleases).mock.calls.map(([query]) => query)).toEqual(['기생충 2019', '기생충 2019', 'Parasite 2019']))
      expect(tmdb.getMovie).toHaveBeenCalledTimes(2)
      await waitFor(() => expect(result.current.status).toBe('none'))
    })

    it('searches again by the original alone when the English name fails again on Try again', async () => {
      vi.mocked(tmdb.getMovie).mockRejectedValue(new tmdb.TmdbError('down', 503))
      vi.mocked(prowlarr.searchReleases).mockResolvedValue([])
      const { result } = renderHook(() => useReleases(parasite))
      await waitFor(() => expect(result.current.status).toBe('none'))
      act(() => result.current.retry())
      await waitFor(() => expect(prowlarr.searchReleases).toHaveBeenCalledTimes(2))
      expect(vi.mocked(prowlarr.searchReleases).mock.calls.map(([query]) => query)).toEqual(['기생충 2019', '기생충 2019'])
      expect(tmdb.getMovie).toHaveBeenCalledTimes(2)
    })

    it('fails the list when one of the searches fails, so it never shows part of it as all', async () => {
      vi.mocked(tmdb.getMovie).mockResolvedValue(english)
      vi.mocked(prowlarr.searchReleases).mockImplementation(async (query) => {
        if (query === '기생충 2019') return [found('original', { infoHash: 'bb' })]
        throw new prowlarr.ProwlarrError('down', 502, 'unreachable')
      })
      const { result } = renderHook(() => useReleases(parasite))
      await waitFor(() => expect(result.current.status).toBe('error'))
      expect(result.current.rows).toEqual([])
    })

    it('asks TMDB nothing for an original in Latin script', async () => {
      const { result } = renderHook(() => useReleases(movie(1, 'Dune')))
      await waitFor(() => expect(result.current.status).toBe('ready'))
      expect(tmdb.getMovie).not.toHaveBeenCalled()
      expect(prowlarr.searchReleases).toHaveBeenCalledTimes(1)
    })

    it.each([
      ['once the English name came', () => parasite, 2],
      ['for an original in Latin script', () => movie(1, 'Dune'), 1],
    ])('searches again on Try again %s', async (_case, details, searches) => {
      vi.mocked(tmdb.getMovie).mockResolvedValue(english)
      vi.mocked(prowlarr.searchReleases).mockResolvedValue([])
      const { result } = renderHook(() => useReleases(details()))
      await waitFor(() => expect(result.current.status).toBe('none'))
      expect(prowlarr.searchReleases).toHaveBeenCalledTimes(searches)
      act(() => result.current.retry())
      await waitFor(() => expect(prowlarr.searchReleases).toHaveBeenCalledTimes(2 * searches))
    })

    it('shows the new search on its way after Try again, not the last one’s outcome, when the English name fails again', async () => {
      vi.mocked(tmdb.getMovie).mockRejectedValue(new tmdb.TmdbError('down', 503))
      let answer: (releases: Release[]) => void = () => {}
      vi.mocked(prowlarr.searchReleases)
        .mockRejectedValueOnce(new prowlarr.ProwlarrError('down', 502, 'unreachable'))
        .mockReturnValueOnce(new Promise((resolve) => (answer = resolve)))
      const { result } = renderHook(() => useReleases(parasite))
      await waitFor(() => expect(result.current.status).toBe('error'))

      act(() => result.current.retry())
      await waitFor(() => expect(prowlarr.searchReleases).toHaveBeenCalledTimes(2))
      expect(tmdb.getMovie).toHaveBeenCalledTimes(2)
      expect(result.current.status).toBe('loading')
      act(() => answer([found('original', { infoHash: 'bb' })]))
      await waitFor(() => expect(result.current.status).toBe('ready'))
    })

    it('keeps the picks of the search through Try again', async () => {
      vi.mocked(tmdb.getMovie).mockRejectedValueOnce(new tmdb.TmdbError('down', 503)).mockResolvedValue(english)
      vi.mocked(prowlarr.searchReleases).mockResolvedValue([found('original', { infoHash: 'bb' })])
      const { result } = renderHook(() => useReleases(parasite))
      await waitFor(() => expect(result.current.status).toBe('ready'))
      act(() => result.current.updateFilters({ indexer: ['Indexer A'] }))
      act(() => result.current.retry())
      await waitFor(() => expect(prowlarr.searchReleases).toHaveBeenCalledTimes(3))
      expect(result.current.filters.indexer).toEqual(['Indexer A'])
    })

    it('asks nothing until enabled', async () => {
      renderHook(() => useReleases(parasite, false))
      await act(() => Promise.resolve())
      expect(tmdb.getMovie).not.toHaveBeenCalled()
      expect(prowlarr.searchReleases).not.toHaveBeenCalled()
    })
  })
})
