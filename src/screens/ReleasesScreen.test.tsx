import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as prowlarr from '../api/prowlarr'
import type { Release } from '../api/prowlarr'
import * as qbt from '../api/qbittorrent'
import * as tmdb from '../api/tmdb'
import type { MovieDetails, TvDetails } from '../api/tmdb'
import { ReleasesScreen } from './ReleasesScreen'

vi.mock('../api/tmdb', async (importOriginal) => {
  const actual = await importOriginal<typeof tmdb>()
  return { ...actual, getMovie: vi.fn(), getTv: vi.fn() }
})
vi.mock('../api/prowlarr', async (importOriginal) => {
  const actual = await importOriginal<typeof prowlarr>()
  return { ...actual, searchReleases: vi.fn(), fetchRelease: vi.fn() }
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

function release(id: string, title: string, size: number, seeders: number, indexer = 'Kinozal'): Release {
  return { id, title, indexer, size, seeders, leechers: 3, categories: [2000], download: `1/download?link=${id}` }
}

const RELEASES = [
  release('a', 'Dune.Part.Two.2024.2160p.UHD.BluRay.REMUX.DV.HDR10.HEVC-FGT', 78e9, 214, 'RuTracker'),
  release('b', 'Дюна 2 / Dune: Part Two (2024) WEB-DL 1080p | Дубляж', 9.4e9, 2451),
  release('c', 'Dune.Part.Two.2024.720p.BluRay.x264-VARYG', 4.7e9, 12),
]

function renderAt(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/title/:type/:id/releases" element={<ReleasesScreen />} />
        <Route path="/title/:type/:id" element={<h1>Title page</h1>} />
        <Route path="/" element={<h1>Downloads</h1>} />
      </Routes>
    </MemoryRouter>,
  )
}

const names = () => screen.getAllByRole('article').map((card) => within(card).getAllByRole('button')[0].textContent)

beforeEach(() => {
  vi.resetAllMocks()
  getMovie.mockResolvedValue(DUNE)
  getTv.mockResolvedValue(BB)
  searchReleases.mockResolvedValue(RELEASES)
})

describe('ReleasesScreen', () => {
  it('searches by original title and year and lists releases by seeders', async () => {
    renderAt('/title/movie/693134/releases')
    expect(screen.getByRole('status')).toHaveTextContent('Searching releases')

    expect(await screen.findByText('3 of 3 releases')).toBeInTheDocument()
    expect(searchReleases).toHaveBeenCalledWith('Dune Part Two 2024', expect.not.objectContaining({ categories: expect.anything() }))
    expect(screen.getByText('Dune: Part Two · 2024')).toBeInTheDocument()
    expect(names()).toEqual([RELEASES[1].title, RELEASES[0].title, RELEASES[2].title])

    const [top] = screen.getAllByRole('article')
    expect(within(top).getByText('1080p')).toBeInTheDocument()
    expect(within(top).getByText('WEB-DL')).toBeInTheDocument()
    expect(within(top).getByText('Dubbed')).toBeInTheDocument()
    expect(within(top).getByText('9.40 GB')).toBeInTheDocument()
    expect(within(top).getByLabelText('2451 seeders')).toBeInTheDocument()
  })

  it('sorts by size and expands a long name', async () => {
    renderAt('/title/movie/693134/releases')
    await userEvent.click(await screen.findByRole('button', { name: /^Sort: Seeds/ }))
    expect(names()).toEqual([RELEASES[0].title, RELEASES[1].title, RELEASES[2].title])

    const name = screen.getByRole('button', { name: RELEASES[0].title })
    expect(name).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(name)
    expect(name).toHaveAttribute('aria-expanded', 'true')
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
    expect(names()).toEqual([RELEASES[0].title])
    expect(screen.getByRole('button', { name: 'Filters 1' })).toHaveAttribute('aria-pressed', 'true')

    await userEvent.click(screen.getByRole('button', { name: 'Remove filter 2160p' }))
    expect(screen.getByText('3 of 3 releases')).toBeInTheDocument()
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
    await userEvent.click(screen.getByRole('button', { name: 'Reset filters' }))
    expect(screen.getByText('3 of 3 releases')).toBeInTheDocument()
  })

  it('lists every release found, whatever its category', async () => {
    const other = (id: string, title: string) => ({ ...release(id, title, 1e9, 50, 'RuTor'), categories: [8000] })
    searchReleases.mockResolvedValue([
      other('r', 'Дюна: Часть вторая / Dune: Part Two (2024) BDRemux 1080p'),
      other('o', 'Hans Zimmer - Dune: Part Two (Original Motion Picture Soundtrack) (2024) MP3'),
    ])
    renderAt('/title/movie/693134/releases')
    expect(await screen.findByText('2 of 2 releases')).toBeInTheDocument()
  })

  it('searches a series by name in TV categories and shows its seasons', async () => {
    searchReleases.mockResolvedValue([release('s', 'Breaking.Bad.S01-S05.COMPLETE.1080p.BluRay.x264-ROVERS', 212e9, 486)])
    renderAt('/title/tv/1396/releases')
    expect(await screen.findByText('S01–S05')).toBeInTheDocument()
    expect(searchReleases).toHaveBeenCalledWith('Breaking Bad', expect.anything())
  })

  it('explains a missing Prowlarr setup', async () => {
    searchReleases.mockRejectedValue(new prowlarr.ProwlarrSetupError(503, 'not-configured'))
    renderAt('/title/movie/693134/releases')
    expect(await screen.findByRole('heading', { name: 'Prowlarr isn’t connected' })).toBeInTheDocument()
  })

  it('retries after Prowlarr fails, and says when nothing is found', async () => {
    searchReleases.mockRejectedValueOnce(new prowlarr.ProwlarrError('down', 502, 'unreachable')).mockResolvedValueOnce([])
    renderAt('/title/movie/693134/releases')
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { name: 'No releases found' })).toBeInTheDocument()
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
    expect(within(sheet).getByText(RELEASES[1].title)).toBeInTheDocument()
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
})
