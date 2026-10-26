import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as matchesApi from '../api/matches'
import * as prowlarr from '../api/prowlarr'
import type { Release } from '../api/prowlarr'
import * as qbt from '../api/qbittorrent'
import * as tmdb from '../api/tmdb'
import type { MovieDetails, TvDetails } from '../api/tmdb'
import { stubDesktop } from '../lib/stubDesktop'
import { resetServerMatches } from '../torrents/serverMatches'
import { clearTitleMatchCache } from '../torrents/titleMatches'
import { TitleRoute } from './TitleScreen'

vi.mock('../api/tmdb', async (importOriginal) => {
  const actual = await importOriginal<typeof tmdb>()
  return { ...actual, getMovie: vi.fn(), getTv: vi.fn(), searchTitles: vi.fn() }
})
vi.mock('../api/prowlarr', async (importOriginal) => {
  const actual = await importOriginal<typeof prowlarr>()
  return { ...actual, searchReleases: vi.fn(), fetchRelease: vi.fn() }
})
vi.mock('../api/qbittorrent', async (importOriginal) => ({
  ...(await importOriginal<typeof qbt>()),
  getMainData: vi.fn(),
  getCategories: vi.fn(),
  getDefaultSavePath: vi.fn(),
}))
vi.mock('../api/matches', async (importOriginal) => ({
  ...(await importOriginal<typeof matchesApi>()),
  getMatches: vi.fn(),
  saveMatches: vi.fn(),
}))

const getMovie = vi.mocked(tmdb.getMovie)
const getTv = vi.mocked(tmdb.getTv)
const searchReleases = vi.mocked(prowlarr.searchReleases)

const DUNE = {
  id: 693134,
  title: 'Dune: Part Two',
  original_title: 'Dune: Part Two',
  original_language: 'en',
  release_date: '2024-02-27',
  runtime: 166,
  overview: 'Paul Atreides unites with Chani and the Fremen.',
  poster_path: '/dune.jpg',
  vote_average: 8.153,
  vote_count: 6000,
  genres: [{ id: 878, name: 'Science Fiction' }],
} as MovieDetails

const SHOGUN = {
  id: 126308,
  name: 'Shōgun',
  original_name: 'Shōgun',
  first_air_date: '2024-02-27',
  number_of_seasons: 1,
  number_of_episodes: 10,
  overview: '',
  poster_path: null,
  vote_average: 8.6,
  vote_count: 900,
  genres: [],
} as unknown as TvDetails

function release(id: string, title: string, size: number, seeders: number, indexer = 'Kinozal'): Release {
  return { id, title, indexer, size, seeders, leechers: 3, categories: [2000], download: `1/download?link=${id}` }
}

const RELEASES = [
  release('a', 'Dune.Part.Two.2024.2160p.UHD.BluRay.REMUX.DV.HDR10.HEVC-FGT', 78e9, 214, 'RuTracker'),
  release('b', 'Дюна 2 / Dune: Part Two (2024) WEB-DL 1080p | Дубляж', 9.4e9, 2451),
  release('c', 'Dune.Part.Two.2024.720p.BluRay.x264-VARYG', 4.7e9, 12),
]

function Where() {
  return <p>at {useLocation().pathname}</p>
}

function renderAt(path: string, history: string[] = []) {
  return render(
    <MemoryRouter initialEntries={[...history, path]} initialIndex={history.length}>
      <Routes>
        <Route path="/title/:type/:id" element={<TitleRoute onSessionLost={vi.fn()} />} />
        <Route path="/title/:type/:id/releases" element={<TitleRoute onSessionLost={vi.fn()} />} />
        <Route path="/search" element={<h1>Search page</h1>} />
      </Routes>
      <Where />
    </MemoryRouter>,
  )
}

const table = () => screen.getByRole('table', { name: 'Releases' })
const names = () =>
  within(table())
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getAllByRole('button')[0].textContent)

const scrollIntoView = vi.fn()

beforeEach(() => {
  vi.resetAllMocks()
  stubDesktop()
  Element.prototype.scrollIntoView = scrollIntoView
  clearTitleMatchCache()
  resetServerMatches()
  vi.mocked(matchesApi.getMatches).mockResolvedValue({})
  vi.mocked(qbt.getMainData).mockResolvedValue({ rid: 1, full_update: true, torrents: {}, server_state: {} })
  getMovie.mockResolvedValue(DUNE)
  getTv.mockResolvedValue(SHOGUN)
  searchReleases.mockResolvedValue(RELEASES)
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('TitleScreen on desktop', () => {
  it('shows the hero and searches no releases until Find releases is pressed', async () => {
    const { container } = renderAt('/title/movie/693134')
    expect(await screen.findByRole('heading', { level: 1, name: 'Dune: Part Two' })).toBeInTheDocument()
    expect(screen.getByText('2024 · 2h 46m')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Overview' })).toHaveTextContent('Paul Atreides')
    expect(container.querySelector('.title-dposter img')).toHaveAttribute('src', '/tmdb-img/w500/dune.jpg')
    expect(screen.queryByRole('region', { name: 'Releases' })).not.toBeInTheDocument()
    expect(searchReleases).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Find releases' }))
    expect(screen.getByText('at /title/movie/693134/releases')).toBeInTheDocument()
    expect(screen.getByRole('region', { name: 'Releases' })).toBeInTheDocument()
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'smooth' })
    expect(await screen.findByText('3 of 3 releases')).toBeInTheDocument()
    expect(searchReleases).toHaveBeenCalledWith('Dune Part Two 2024', expect.anything())
    expect(names()).toEqual([RELEASES[1].title, RELEASES[0].title, RELEASES[2].title])
    // The page stays: the title isn't loaded again.
    expect(getMovie).toHaveBeenCalledTimes(1)
  })

  it('shows the releases already searched when opened at their link, starting at them', async () => {
    renderAt('/title/movie/693134/releases')
    expect(await screen.findByRole('heading', { level: 1, name: 'Dune: Part Two' })).toBeInTheDocument()
    // Opened at the releases, the page jumps to them (no scroll animation) as soon as it has the title.
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'auto' })
    expect(await screen.findByText('3 of 3 releases')).toBeInTheDocument()
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(within(table()).getAllByRole('row')[1]).toHaveTextContent('9.40 GB')
    expect(within(table()).getAllByRole('row')[1]).toHaveTextContent('Dubbed')
  })

  it('leaves the page on Back after the search, as before it', async () => {
    renderAt('/title/movie/693134', ['/search'])
    await userEvent.click(await screen.findByRole('button', { name: 'Find releases' }))
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByRole('heading', { name: 'Search page' })).toBeInTheDocument()
  })

  it('goes to search on Back when opened from a link, also after the search', async () => {
    renderAt('/title/movie/693134')
    await userEvent.click(await screen.findByRole('button', { name: 'Find releases' }))
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByRole('heading', { name: 'Search page' })).toBeInTheDocument()
  })

  it('scrolls back to the releases when pressed again', async () => {
    renderAt('/title/movie/693134/releases')
    await screen.findByText('3 of 3 releases')
    scrollIntoView.mockClear()
    await userEvent.click(screen.getByRole('button', { name: 'Find releases' }))
    expect(scrollIntoView).toHaveBeenCalledTimes(1)
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'smooth' })
    expect(searchReleases).toHaveBeenCalledTimes(1)
  })

  it('filters in popovers, removes filters and sorts', async () => {
    renderAt('/title/movie/693134/releases')
    await screen.findByText('3 of 3 releases')

    const chip = screen.getByRole('button', { name: 'Resolution' })
    expect(chip).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(chip)
    const popover = screen.getByRole('group', { name: 'Resolution' })
    expect(within(popover).getAllByRole('button').map((option) => option.textContent)).toEqual(['2160p', '1080p', '720p'])
    await userEvent.click(within(popover).getByRole('button', { name: '2160p' }))
    expect(screen.getByText('1 of 3 releases')).toBeInTheDocument()
    expect(names()).toEqual([RELEASES[0].title])
    expect(screen.getByRole('button', { name: '2160p', expanded: true })).toHaveAttribute('aria-pressed', 'true')

    // Escape closes it and gives the focus back to its chip.
    await userEvent.keyboard('{Escape}')
    expect(screen.queryByRole('group', { name: 'Resolution' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '2160p' })).toHaveFocus()

    await userEvent.click(screen.getByRole('button', { name: 'Remove filter 2160p' }))
    expect(screen.getByText('3 of 3 releases')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('radio', { name: 'Size' }))
    expect(names()).toEqual([RELEASES[0].title, RELEASES[1].title, RELEASES[2].title])
    await userEvent.click(screen.getByRole('button', { name: 'Descending' }))
    expect(names()).toEqual([RELEASES[2].title, RELEASES[1].title, RELEASES[0].title])
  })

  it('closes a popover on a click outside it and opens one at a time', async () => {
    renderAt('/title/movie/693134/releases')
    await screen.findByText('3 of 3 releases')
    await userEvent.click(screen.getByRole('button', { name: 'Audio' }))
    expect(screen.getByRole('group', { name: 'Audio' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Min seeds' }))
    expect(screen.queryByRole('group', { name: 'Audio' })).not.toBeInTheDocument()
    await userEvent.click(within(screen.getByRole('group', { name: 'Min seeds' })).getByRole('button', { name: '100+' }))
    expect(screen.getByText('2 of 3 releases')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('heading', { level: 1 }))
    expect(screen.queryByRole('group', { name: 'Min seeds' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: '100+ seeds' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('says when filters hide everything', async () => {
    renderAt('/title/movie/693134/releases')
    await screen.findByText('3 of 3 releases')
    await userEvent.click(screen.getByRole('button', { name: 'Resolution' }))
    await userEvent.click(screen.getByRole('button', { name: '720p' }))
    await userEvent.click(screen.getByRole('button', { name: 'Audio' }))
    await userEvent.click(screen.getByRole('button', { name: 'Dubbed' }))
    expect(screen.getByRole('heading', { name: 'Nothing matches' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Reset filters' }))
    expect(screen.getByText('3 of 3 releases')).toBeInTheDocument()
  })

  it('opens the add sheet for a release', async () => {
    vi.mocked(prowlarr.fetchRelease).mockReturnValue(new Promise(() => {}))
    vi.mocked(qbt.getCategories).mockResolvedValue([])
    vi.mocked(qbt.getDefaultSavePath).mockResolvedValue('/data')
    renderAt('/title/movie/693134/releases')
    await screen.findByText('3 of 3 releases')
    const [, top] = within(table()).getAllByRole('row')
    await userEvent.click(within(top).getByRole('button', { name: 'Add to downloads' }))
    expect(within(screen.getByRole('dialog', { name: 'Add to downloads' })).getByText(RELEASES[1].title)).toBeInTheDocument()
  })

  it('shows the series hint by the button and searches a series by name', async () => {
    renderAt('/title/tv/126308')
    expect(await screen.findByText(/Releases are searched by show name/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Find releases' }))
    expect(searchReleases).toHaveBeenCalledWith('Shōgun', expect.anything())
  })

  it('shows Prowlarr errors in the releases section and retries', async () => {
    searchReleases.mockRejectedValueOnce(new prowlarr.ProwlarrError('down', 502, 'unreachable')).mockResolvedValueOnce([])
    renderAt('/title/movie/693134/releases')
    expect(await screen.findByRole('heading', { name: 'Couldn’t reach Prowlarr' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Dune: Part Two' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { name: 'No releases found' })).toBeInTheDocument()
  })
})

describe('TitleRoute on a phone', () => {
  it('opens the releases screen at the releases link', async () => {
    vi.unstubAllGlobals()
    renderAt('/title/movie/693134/releases')
    expect(screen.getByRole('heading', { level: 1, name: 'Releases' })).toBeInTheDocument()
    expect(await screen.findAllByRole('article')).toHaveLength(3)
  })
})
