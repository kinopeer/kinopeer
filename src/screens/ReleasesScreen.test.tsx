import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as prowlarr from '../api/prowlarr'
import * as qbt from '../api/qbittorrent'
import * as tmdb from '../api/tmdb'
import type { MovieDetails, TvDetails } from '../api/tmdb'
import { resetSettings, updateSettings } from '../settings/settings'
import { DUNE_RELEASES, release } from '../test/fixtures'
import { renderWithRouter, saying } from '../test/render'
import { ReleasesScreen } from './ReleasesScreen'

vi.mock('../api/tmdb', async (importOriginal) => {
  const actual = await importOriginal<typeof tmdb>()
  return { ...actual, getMovie: vi.fn(), getTv: vi.fn() }
})
vi.mock('../api/prowlarr', async (importOriginal) => {
  const actual = await importOriginal<typeof prowlarr>()
  return { ...actual, searchReleases: vi.fn(), getFailingIndexers: vi.fn(), fetchRelease: vi.fn() }
})
vi.mock('../api/qbittorrent', async (importOriginal) => ({
  ...(await importOriginal<typeof qbt>()),
  addTorrents: vi.fn(),
  getCategories: vi.fn(),
  getDefaultSavePath: vi.fn(),
  getMainData: vi.fn(),
}))

const getMovie = vi.mocked(tmdb.getMovie)
const getTv = vi.mocked(tmdb.getTv)
const searchReleases = vi.mocked(prowlarr.searchReleases)

const DUNE = { id: 693134, title: 'Dune: Part Two', original_title: 'Dune: Part Two', release_date: '2024-02-27' } as MovieDetails
const BB = { id: 1396, name: 'Breaking Bad', original_name: 'Breaking Bad', first_air_date: '2008-01-20' } as TvDetails

function renderAt(path: string) {
  return renderWithRouter(
    <Routes>
      <Route path="/title/:type/:id/releases" element={<ReleasesScreen />} />
      <Route path="/title/:type/:id" element={<h1>Title page</h1>} />
      <Route path="/" element={<h1>Downloads</h1>} />
    </Routes>,
    [path],
  )
}

// The name is the card's button that opens and closes it on a phone (ReleaseName).
const names = () => screen.getAllByRole('article').map((card) => within(card).getByRole('button', { expanded: false }).textContent)

beforeEach(() => {
  // Filters and the sort are remembered in the browser between searches.
  resetSettings()
  vi.resetAllMocks()
  getMovie.mockResolvedValue(DUNE)
  getTv.mockResolvedValue(BB)
  searchReleases.mockResolvedValue(DUNE_RELEASES)
  vi.mocked(prowlarr.getFailingIndexers).mockResolvedValue([])
})

afterEach(() => {
  vi.restoreAllMocks()
})

describe('ReleasesScreen', () => {
  it('searches by original title and year and lists releases by seeders', async () => {
    renderAt('/title/movie/693134/releases')
    expect(screen.getByRole('status', { name: saying('Searching releases') })).toBeInTheDocument()

    expect(await screen.findByText('3 of 3 releases')).toBeInTheDocument()
    expect(searchReleases).toHaveBeenCalledWith('Dune Part Two 2024', expect.not.objectContaining({ categories: expect.anything() }))
    expect(screen.getByText('Dune: Part Two · 2024')).toBeInTheDocument()
    expect(names()).toEqual([DUNE_RELEASES[1].title, DUNE_RELEASES[0].title, DUNE_RELEASES[2].title])

    const [top] = screen.getAllByRole('article')
    expect(within(top).getByText('Dubbed')).toBeInTheDocument()
    expect(within(top).getByText('9.40 GB')).toBeInTheDocument()
    expect(within(top).getByLabelText('2451 seeders')).toBeInTheDocument()
  })

  it('cycles the sort from its chip, and picks the sort and direction in the sheet', async () => {
    renderAt('/title/movie/693134/releases')
    await userEvent.click(await screen.findByRole('button', { name: 'Sort: Seeds, Descending' }))
    expect(names()).toEqual([DUNE_RELEASES[0].title, DUNE_RELEASES[1].title, DUNE_RELEASES[2].title])

    await userEvent.click(screen.getByRole('button', { name: 'Filters' }))
    const sheet = within(screen.getByRole('dialog', { name: 'Filters' }))
    expect(sheet.getByRole('radio', { name: 'Size', checked: true })).toBeInTheDocument()
    await userEvent.click(sheet.getByRole('button', { name: 'Descending' }))
    expect(sheet.getByRole('button', { name: 'Ascending' })).toBeInTheDocument()
    await userEvent.click(sheet.getByRole('radio', { name: 'Seeds' }))
    await userEvent.click(sheet.getByRole('button', { name: 'Show 3' }))
    expect(screen.getByRole('button', { name: 'Sort: Seeds, Ascending' })).toBeInTheDocument()
    expect(names()).toEqual([DUNE_RELEASES[2].title, DUNE_RELEASES[0].title, DUNE_RELEASES[1].title])
  })

  it('filters by indexer when the results come from more than one', async () => {
    renderAt('/title/movie/693134/releases')
    await userEvent.click(await screen.findByRole('button', { name: 'Filters' }))
    const sheet = within(screen.getByRole('dialog', { name: 'Filters' }))
    const indexers = within(sheet.getByRole('group', { name: 'Indexer' }))
    expect(indexers.getAllByRole('button').map((chip) => chip.textContent)).toEqual(['Indexer C', 'Indexer D'])
    await userEvent.click(indexers.getByRole('button', { name: 'Indexer D' }))
    await userEvent.click(sheet.getByRole('button', { name: 'Show 1' }))
    expect(names()).toEqual([DUNE_RELEASES[0].title])
    expect(screen.getByRole('button', { name: 'Remove filter Indexer D' })).toBeInTheDocument()
  })

  it('filters in the sheet and removes filters from the list', async () => {
    renderAt('/title/movie/693134/releases')
    await userEvent.click(await screen.findByRole('button', { name: 'Filters' }))
    const sheet = screen.getByRole('dialog', { name: 'Filters' })
    // Only values the results have are offered.
    const resolution = within(sheet).getByRole('group', { name: 'Resolution' })
    expect(within(resolution).getAllByRole('button').map((chip) => chip.textContent)).toEqual(['2160p', '1080p', '720p'])
    await userEvent.click(within(resolution).getByRole('button', { name: '2160p' }))
    await userEvent.click(within(sheet).getByRole('button', { name: 'Show 1' }))

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(screen.getByText('1 of 3 releases')).toBeInTheDocument()
    expect(names()).toEqual([DUNE_RELEASES[0].title])
    expect(screen.getByRole('button', { name: 'Filters 1' })).toHaveAttribute('aria-pressed', 'true')

    await userEvent.click(screen.getByRole('button', { name: 'Remove filter 2160p' }))
    expect(screen.getByText('3 of 3 releases')).toBeInTheDocument()
  })

  it('offers Not stated for releases whose name states no resolution, source or audio', async () => {
    const bare = release('d', 'Дюна 2 / Dune: Part Two (2024)', 3e9, 50)
    searchReleases.mockResolvedValue([...DUNE_RELEASES, bare])
    renderAt('/title/movie/693134/releases')
    await userEvent.click(await screen.findByRole('button', { name: 'Filters' }))
    const sheet = screen.getByRole('dialog', { name: 'Filters' })
    const options = (group: string) => within(within(sheet).getByRole('group', { name: group })).getAllByRole('button').map((chip) => chip.textContent)
    expect(options('Resolution')).toEqual(['2160p', '1080p', '720p', 'Resolution not stated'])
    expect(options('Source')).toEqual(['REMUX', 'BluRay', 'WEB-DL', 'Source not stated'])
    // The remux and the 720p rip name no voice-over either.
    expect(options('Audio')).toEqual(['Dubbed', 'Audio not stated'])

    await userEvent.click(within(sheet).getByRole('button', { name: 'Resolution not stated' }))
    await userEvent.click(within(sheet).getByRole('button', { name: '1080p' }))
    await userEvent.click(within(sheet).getByRole('button', { name: 'Source not stated' }))
    await userEvent.click(within(sheet).getByRole('button', { name: 'Show 1' }))
    expect(names()).toEqual([bare.title])
    expect(screen.getByRole('button', { name: 'Source not stated' })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByRole('button', { name: 'Resolution not stated +1' })).toHaveAttribute('aria-pressed', 'true')

    await userEvent.click(screen.getByRole('button', { name: 'Remove filter Source not stated' }))
    expect(screen.getByText('2 of 4 releases')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Remove filter Resolution not stated' }))
    expect(names()).toEqual([DUNE_RELEASES[1].title])
  })

  it('says when filters hide everything', async () => {
    renderAt('/title/movie/693134/releases')
    await userEvent.click(await screen.findByRole('button', { name: 'Filters' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '100+' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Show 2' }))
    await userEvent.click(screen.getByRole('button', { name: 'Filters 1' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Dubbed' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: '720p' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Show 0' }))
    expect(screen.getByRole('heading', { name: 'Nothing matches' })).toBeInTheDocument()
  })

  it('lists every release found, whatever its category', async () => {
    const other = (id: string, title: string) => ({ ...release(id, title, 1e9, 50, 'Indexer A'), categories: [8000] })
    searchReleases.mockResolvedValue([
      other('r', 'Дюна: Часть вторая / Dune: Part Two (2024) BDRemux 1080p'),
      other('o', 'Hans Zimmer - Dune: Part Two (Original Motion Picture Soundtrack) (2024) MP3'),
    ])
    renderAt('/title/movie/693134/releases')
    expect(await screen.findByText('2 of 2 releases')).toBeInTheDocument()
  })

  it('searches a series by name alone, without a category, and shows its seasons', async () => {
    searchReleases.mockResolvedValue([release('s', 'Breaking.Bad.S01-S05.COMPLETE.1080p.BluRay.x264-GRPC', 212e9, 486)])
    renderAt('/title/tv/1396/releases')
    expect(await screen.findByText('S01–S05')).toBeInTheDocument()
    expect(searchReleases).toHaveBeenCalledWith('Breaking Bad', expect.not.objectContaining({ categories: expect.anything() }))
  })

  it('explains a missing Prowlarr setup', async () => {
    searchReleases.mockRejectedValue(new prowlarr.ProwlarrSetupError(503, 'not-configured'))
    renderAt('/title/movie/693134/releases')
    expect(await screen.findByRole('heading', { name: 'Prowlarr isn’t connected' })).toBeInTheDocument()
  })

  it('lists the releases without waiting to hear which indexers failed, then names them', async () => {
    // The search starts at 1000 ms and answers at 4000 ms.
    let now = 1000
    vi.spyOn(performance, 'now').mockImplementation(() => now)
    searchReleases.mockImplementation(async () => {
      now = 4000
      return DUNE_RELEASES
    })
    let answer!: (names: string[]) => void
    vi.mocked(prowlarr.getFailingIndexers).mockReturnValue(new Promise((resolve) => (answer = resolve)))
    renderAt('/title/movie/693134/releases')
    expect(await screen.findAllByRole('article')).toHaveLength(DUNE_RELEASES.length)
    // The live region is there, empty, before the answer, so a screen reader announces the note.
    const note = screen.getByRole('status')
    expect(note).toBeEmptyDOMElement()
    // Asked once the search answered, with how long ago it started. The request starts in an effect,
    // which can run after the list shows, so wait for it.
    await waitFor(() => expect(prowlarr.getFailingIndexers).toHaveBeenCalledWith(3000, expect.any(AbortSignal)))

    // Indexer D's releases are in this search's results: its failure was another client's query.
    answer(['Indexer B', 'Indexer D'])
    await waitFor(() => expect(note).toHaveTextContent('Indexer B'))
    expect(note).not.toHaveTextContent('Indexer D')
  })

  it('still lists releases when it can’t tell which indexers failed', async () => {
    let fail!: (error: unknown) => void
    vi.mocked(prowlarr.getFailingIndexers).mockReturnValue(new Promise((_, reject) => (fail = reject)))
    renderAt('/title/movie/693134/releases')
    expect(await screen.findAllByRole('article')).toHaveLength(DUNE_RELEASES.length)
    // Failed only once it's asked: the request starts in an effect, which can run after the list
    // shows, and a promise rejected before anything handles it is an unhandled rejection.
    await waitFor(() => expect(prowlarr.getFailingIndexers).toHaveBeenCalled())

    await act(async () => fail(new prowlarr.ProwlarrError('down', 502, 'upstream')))
    expect(screen.getAllByRole('article')).toHaveLength(DUNE_RELEASES.length)
    expect(screen.getByRole('status')).toBeEmptyDOMElement()
  })

  it('says when Prowlarr fails', async () => {
    searchReleases.mockRejectedValue(new prowlarr.ProwlarrError('down', 502, 'unreachable'))
    renderAt('/title/movie/693134/releases')
    expect(await screen.findByRole('heading', { name: 'Prowlarr isn’t answering' })).toBeInTheDocument()
  })

  it('adds a release to qBittorrent tagged with the title and goes to downloads', async () => {
    vi.mocked(prowlarr.fetchRelease).mockResolvedValue({ kind: 'magnet', uri: 'magnet:?xt=urn:btih:abc' })
    vi.mocked(qbt.getCategories).mockResolvedValue([])
    vi.mocked(qbt.getDefaultSavePath).mockResolvedValue('/data')
    vi.mocked(qbt.getMainData).mockResolvedValue({ rid: 1 })
    renderAt('/title/movie/693134/releases')
    const [top] = await screen.findAllByRole('article')
    await userEvent.click(within(top).getByRole('button', { name: 'Add to downloads' }))
    const sheet = screen.getByRole('dialog', { name: 'Add to downloads' })
    expect(within(sheet).getByText(DUNE_RELEASES[1].title)).toBeInTheDocument()
    await userEvent.click(await within(sheet).findByRole('button', { name: /^Download/ }))

    expect(vi.mocked(qbt.addTorrents)).toHaveBeenCalledWith(
      expect.objectContaining({ urls: ['magnet:?xt=urn:btih:abc'], tags: ['tmdb:movie:693134'] }),
    )
    expect(await screen.findByRole('heading', { name: 'Downloads' })).toBeInTheDocument()
  })

  it('goes to the title page when opened directly', async () => {
    renderAt('/title/movie/693134/releases')
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByRole('heading', { name: 'Title page' })).toBeInTheDocument()
  })

  describe('remembering filters', () => {
    it('starts the next search from the filters and the sort picked last, but not the indexer', async () => {
      const first = renderAt('/title/movie/693134/releases')
      await userEvent.click(await screen.findByRole('button', { name: 'Filters' }))
      const sheet = within(screen.getByRole('dialog', { name: 'Filters' }))
      await userEvent.click(sheet.getByRole('button', { name: '2160p' }))
      await userEvent.click(sheet.getByRole('button', { name: '1080p' }))
      await userEvent.click(sheet.getByRole('button', { name: '100+' }))
      await userEvent.click(within(sheet.getByRole('group', { name: 'Indexer' })).getByRole('button', { name: 'Indexer D' }))
      await userEvent.click(sheet.getByRole('radio', { name: 'Size' }))
      first.unmount()

      renderAt('/title/tv/1396/releases')
      expect(await screen.findByText('2 of 3 releases')).toBeInTheDocument()
      for (const label of ['2160p', '1080p', '100+ seeds']) {
        expect(screen.getByRole('button', { name: `Remove filter ${label}` })).toBeInTheDocument()
      }
      expect(screen.queryByRole('button', { name: 'Remove filter Indexer D' })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Sort: Size, Descending' })).toBeInTheDocument()
      expect(names()).toEqual([DUNE_RELEASES[0].title, DUNE_RELEASES[1].title])
    })

    it('keeps a remembered value set aside through a pick in the same filter', async () => {
      // No 2160p release is a WEB-DL, so the source gives way and WEB-DL is set aside.
      updateSettings({ releaseFilters: { resolution: ['2160p'], audio: [], source: ['WEB-DL'], minSeeds: 0 } })
      const first = renderAt('/title/movie/693134/releases')
      expect(await screen.findByText('Remembered filters not applied: WEB-DL')).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Filters 1' }))
      await userEvent.click(within(screen.getByRole('group', { name: 'Source' })).getByRole('button', { name: 'BluRay' }))
      first.unmount()

      searchReleases.mockResolvedValue([DUNE_RELEASES[1], DUNE_RELEASES[2]])
      renderAt('/title/tv/1396/releases')
      expect(await screen.findByText('2 of 2 releases')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Remove filter WEB-DL' })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Remove filter BluRay' })).toBeInTheDocument()
    })

    it('forgets only the remembered filters set aside on Forget', async () => {
      updateSettings({ releaseFilters: { resolution: ['2160p'], audio: ['dub'], source: [], minSeeds: 0 } })
      searchReleases.mockResolvedValue([DUNE_RELEASES[1], DUNE_RELEASES[2]])
      const first = renderAt('/title/movie/693134/releases')
      expect(await screen.findByText('Remembered filters not applied: 2160p')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Remove filter Dubbed' })).toBeInTheDocument()
      await userEvent.click(screen.getByRole('button', { name: 'Forget' }))
      expect(screen.queryByText(/^Remembered filters not applied/)).not.toBeInTheDocument()
      first.unmount()

      searchReleases.mockResolvedValue(DUNE_RELEASES)
      renderAt('/title/tv/1396/releases')
      expect(await screen.findByText('1 of 3 releases')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Remove filter Dubbed' })).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: 'Remove filter 2160p' })).not.toBeInTheDocument()
    })

    it('forgets the filters on Clear all, and keeps the sort', async () => {
      updateSettings({ releaseFilters: { resolution: ['2160p'], audio: [], source: [], minSeeds: 0 }, releaseSort: { key: 'size', descending: false } })
      const first = renderAt('/title/movie/693134/releases')
      await userEvent.click(await screen.findByRole('button', { name: 'Clear all' }))
      first.unmount()

      renderAt('/title/tv/1396/releases')
      expect(await screen.findByText('3 of 3 releases')).toBeInTheDocument()
      expect(screen.queryByRole('button', { name: /^Remove filter/ })).not.toBeInTheDocument()
      expect(screen.getByRole('button', { name: 'Sort: Size, Ascending' })).toBeInTheDocument()
    })
  })
})
