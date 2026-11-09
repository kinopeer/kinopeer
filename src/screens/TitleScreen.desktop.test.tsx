import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as matchesApi from '../api/matches'
import * as prowlarr from '../api/prowlarr'
import * as qbt from '../api/qbittorrent'
import * as tmdb from '../api/tmdb'
import type { MovieDetails, TvDetails } from '../api/tmdb'
import { stubDesktop } from '../lib/stubDesktop'
import { restoreLayout, stubLayout } from '../lib/stubLayout'
import i18n from '../i18n'
import { resetSettings, updateSettings } from '../settings/settings'
import { DUNE_RELEASES, release } from '../test/fixtures'
import { Where, renderWithRouter, saying, where } from '../test/render'
import { resetServerMatches } from '../torrents/serverMatches'
import { clearTitleMatchCache } from '../torrents/titleMatches'
import { TitleRoute } from './TitleScreen'

vi.mock('../api/tmdb', async (importOriginal) => {
  const actual = await importOriginal<typeof tmdb>()
  return { ...actual, getMovie: vi.fn(), getTv: vi.fn(), searchTitles: vi.fn(), getRecommendations: vi.fn(), getSimilar: vi.fn() }
})
vi.mock('../api/prowlarr', async (importOriginal) => {
  const actual = await importOriginal<typeof prowlarr>()
  return { ...actual, searchReleases: vi.fn(), getFailingIndexers: vi.fn(), fetchRelease: vi.fn() }
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

function renderAt(path: string, history: string[] = []) {
  return renderWithRouter(
    <>
      <Routes>
        <Route path="/title/:type/:id" element={<TitleRoute onSessionLost={vi.fn()} />} />
        <Route path="/title/:type/:id/releases" element={<TitleRoute onSessionLost={vi.fn()} />} />
        <Route path="/search" element={<h1>Search page</h1>} />
      </Routes>
      <Where />
    </>,
    [...history, path],
  )
}

const table = () => screen.getByRole('table', { name: 'Releases' })
const names = () =>
  within(table())
    .getAllByRole('row')
    .slice(1)
    .map((row) => within(row).getByTitle(/./).textContent)

const scrollIntoView = vi.fn()

beforeEach(() => {
  // Filters and the sort are remembered in the browser between searches.
  resetSettings()
  vi.resetAllMocks()
  stubDesktop()
  Element.prototype.scrollIntoView = scrollIntoView
  clearTitleMatchCache()
  resetServerMatches()
  vi.mocked(matchesApi.getMatches).mockResolvedValue({})
  vi.mocked(qbt.getMainData).mockResolvedValue({ rid: 1, full_update: true, torrents: {}, server_state: {} })
  getMovie.mockResolvedValue(DUNE)
  getTv.mockResolvedValue(SHOGUN)
  searchReleases.mockResolvedValue(DUNE_RELEASES)
  vi.mocked(prowlarr.getFailingIndexers).mockResolvedValue([])
  vi.mocked(tmdb.getRecommendations).mockResolvedValue({ titles: [], page: 1, totalPages: 1 })
  vi.mocked(tmdb.getSimilar).mockResolvedValue({ titles: [], page: 1, totalPages: 1 })
})

afterEach(() => {
  vi.unstubAllGlobals()
  restoreLayout()
})

describe('TitleScreen on desktop', () => {
  it('shows the hero with a larger poster and searches no releases until Find releases is pressed', async () => {
    const { container } = renderAt('/title/movie/693134')
    await screen.findByRole('heading', { level: 1, name: 'Dune: Part Two' })
    // The poster is decorative and the backdrop the same image: only the frame's class tells them apart.
    expect(container.querySelector('.title-dposter img')).toHaveAttribute('src', '/tmdb-img/w500/dune.jpg')
    expect(screen.queryByRole('region', { name: 'Releases' })).not.toBeInTheDocument()
    expect(searchReleases).not.toHaveBeenCalled()

    await userEvent.click(screen.getByRole('button', { name: 'Find releases' }))
    expect(where()).toBe('/title/movie/693134/releases')
    expect(screen.getByRole('region', { name: 'Releases' })).toBeInTheDocument()
    expect(scrollIntoView).toHaveBeenCalledWith({ block: 'start', behavior: 'smooth' })
    expect(await screen.findByText('3 of 3 releases')).toBeInTheDocument()
    expect(searchReleases).toHaveBeenCalledWith('Dune Part Two 2024', expect.anything())
    expect(names()).toEqual([DUNE_RELEASES[1].title, DUNE_RELEASES[0].title, DUNE_RELEASES[2].title])
    // The page stays: the title isn't loaded again.
    expect(getMovie).toHaveBeenCalledTimes(1)
  })

  it('names the indexers that didn’t answer in the releases section', async () => {
    vi.mocked(prowlarr.getFailingIndexers).mockResolvedValue(['Indexer B'])
    renderAt('/title/movie/693134/releases')
    const section = await screen.findByRole('region', { name: 'Releases' })
    expect(await within(section).findByRole('status', { name: saying(/Indexer B/) })).toBeInTheDocument()
  })

  it('keeps the recommendations on the page with the releases searched', async () => {
    vi.mocked(tmdb.getRecommendations).mockResolvedValue({
      titles: [tmdb.toTitle({ ...DUNE, id: 438631, title: 'Dune' }, 'movie')],
      page: 1,
      totalPages: 1,
    })
    renderAt('/title/movie/693134/releases')

    expect(await screen.findByRole('region', { name: 'Releases' })).toBeInTheDocument()
    const row = await screen.findByRole('region', { name: 'Recommendations' })
    expect(within(row).getByRole('link', { name: /Dune/ })).toHaveAttribute('href', '/title/movie/438631')
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
    // Pressed again, it only scrolls: the releases already found aren't searched again.
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
    expect(names()).toEqual([DUNE_RELEASES[0].title])
    expect(screen.getByRole('button', { name: '2160p', expanded: true })).toHaveAttribute('aria-pressed', 'true')

    await userEvent.click(screen.getByRole('button', { name: 'Remove filter 2160p' }))
    expect(screen.getByText('3 of 3 releases')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('radio', { name: 'Size' }))
    expect(names()).toEqual([DUNE_RELEASES[0].title, DUNE_RELEASES[1].title, DUNE_RELEASES[2].title])
    await userEvent.click(screen.getByRole('button', { name: 'Descending' }))
    expect(names()).toEqual([DUNE_RELEASES[2].title, DUNE_RELEASES[1].title, DUNE_RELEASES[0].title])
  })

  it('offers Not stated in the popovers for releases whose name states no resolution, source or audio', async () => {
    const bare = release('d', 'Дюна 2 / Dune: Part Two (2024)', 3e9, 50)
    searchReleases.mockResolvedValue([...DUNE_RELEASES, bare])
    renderAt('/title/movie/693134/releases')
    await screen.findByText('4 of 4 releases')
    expect(screen.getByRole('button', { name: 'Resolution' })).toHaveAttribute('aria-pressed', 'false')
    expect(screen.getByRole('button', { name: 'Source' })).toHaveAttribute('aria-pressed', 'false')

    await userEvent.click(screen.getByRole('button', { name: 'Resolution' }))
    const resolution = screen.getByRole('group', { name: 'Resolution' })
    // The option says just Not stated under the filter's name; the filter's button names the filter.
    expect(within(resolution).getAllByRole('button').map((option) => option.textContent)).toEqual(['2160p', '1080p', '720p', 'Not stated'])
    await userEvent.click(within(resolution).getByRole('button', { name: 'Not stated' }))
    expect(screen.getByRole('button', { name: 'Resolution not stated', expanded: true })).toHaveAttribute('aria-pressed', 'true')

    await userEvent.click(screen.getByRole('button', { name: 'Source' }))
    const source = screen.getByRole('group', { name: 'Source' })
    expect(within(source).getAllByRole('button').map((option) => option.textContent)).toEqual(['REMUX', 'BluRay', 'WEB-DL', 'Not stated'])
    await userEvent.click(within(source).getByRole('button', { name: 'Not stated' }))
    expect(screen.getByRole('button', { name: 'Source not stated', expanded: true })).toHaveAttribute('aria-pressed', 'true')
    expect(screen.getByText('1 of 4 releases')).toBeInTheDocument()
    expect(names()).toEqual([bare.title])

    await userEvent.click(screen.getByRole('button', { name: 'Audio' }))
    const audio = screen.getByRole('group', { name: 'Audio' })
    expect(within(audio).getAllByRole('button').map((option) => option.textContent)).toEqual(['Dubbed', 'Not stated'])
    await userEvent.click(within(audio).getByRole('button', { name: 'Not stated' }))
    expect(screen.getByRole('button', { name: 'Audio not stated', expanded: true })).toHaveAttribute('aria-pressed', 'true')
    expect(names()).toEqual([bare.title])
  })

  it('opens one popover at a time', async () => {
    renderAt('/title/movie/693134/releases')
    await screen.findByText('3 of 3 releases')
    await userEvent.click(screen.getByRole('button', { name: 'Audio' }))
    expect(screen.getByRole('group', { name: 'Audio' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Min seeds' }))
    expect(screen.queryByRole('group', { name: 'Audio' })).not.toBeInTheDocument()
    await userEvent.click(within(screen.getByRole('group', { name: 'Min seeds' })).getByRole('button', { name: '100+' }))
    expect(screen.getByText('2 of 3 releases')).toBeInTheDocument()
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
  })

  it('names a remembered filter no release meets, and forgets it on Forget', async () => {
    updateSettings({ releaseFilters: { resolution: ['SD'], audio: [], source: [], minSeeds: 0 } })
    renderAt('/title/movie/693134/releases')
    expect(await screen.findByText('3 of 3 releases')).toBeInTheDocument()
    expect(screen.getByText('Remembered filters not applied: SD')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Forget' }))
    expect(screen.queryByText(/^Remembered filters not applied/)).not.toBeInTheDocument()
  })

  it('names a theater rip in the interface language, in the table, the source filter and the add sheet', async () => {
    await i18n.changeLanguage('ru')
    vi.mocked(prowlarr.fetchRelease).mockReturnValue(new Promise(() => {}))
    vi.mocked(qbt.getCategories).mockResolvedValue([])
    vi.mocked(qbt.getDefaultSavePath).mockResolvedValue('/data')
    const cam = release('d', 'Dune.Part.Two.2024.HDTS.x264-GRPA', 1.5e9, 5)
    searchReleases.mockResolvedValue([...DUNE_RELEASES, cam])
    renderAt('/title/movie/693134/releases')
    await screen.findByText('4 из 4 раздач')
    const row = within(screen.getByRole('table', { name: 'Раздачи' }))
      .getAllByRole('row')
      .find((tr) => tr.textContent?.includes(cam.title))!
    expect(within(row).getByText('Экранка')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Источник' }))
    const source = screen.getByRole('group', { name: 'Источник' })
    expect(within(source).getAllByRole('button').map((option) => option.textContent)).toEqual(['REMUX', 'BluRay', 'WEB-DL', 'Экранка'])

    await userEvent.click(within(row).getByRole('button', { name: 'Добавить в загрузки' }))
    expect(within(screen.getByRole('dialog', { name: 'Добавить в загрузки' })).getByText('Экранка')).toBeInTheDocument()
  })

  it('opens the add sheet for a release', async () => {
    vi.mocked(prowlarr.fetchRelease).mockReturnValue(new Promise(() => {}))
    vi.mocked(qbt.getCategories).mockResolvedValue([])
    vi.mocked(qbt.getDefaultSavePath).mockResolvedValue('/data')
    renderAt('/title/movie/693134/releases')
    await screen.findByText('3 of 3 releases')
    const [, top] = within(table()).getAllByRole('row')
    await userEvent.click(within(top).getByRole('button', { name: 'Add to downloads' }))
    expect(within(screen.getByRole('dialog', { name: 'Add to downloads' })).getByText(DUNE_RELEASES[1].title)).toBeInTheDocument()
  })

  it('shows a long overview in the hero, with Show more', async () => {
    const overview = 'Paul Atreides unites with Chani and the Fremen while seeking revenge. '.repeat(8).trim()
    getMovie.mockResolvedValue({ ...DUNE, overview })
    // A 10-line overview cut to 5: taller than it shows.
    stubLayout(130, 260)
    renderAt('/title/movie/693134')
    // How it cuts and opens is TitleOverview.test.tsx's; here, that the hero has it.
    const text = await screen.findByText(overview)
    expect(screen.getByRole('region', { name: 'Overview' })).toContainElement(text)
    expect(screen.getByRole('button', { name: 'Show more' })).toBeInTheDocument()
  })

  it('shows the series hint by the button and searches a series by name', async () => {
    renderAt('/title/tv/126308')
    expect(await screen.findByText(/Releases are searched by show name/)).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Find releases' }))
    expect(searchReleases).toHaveBeenCalledWith('Shōgun', expect.anything())
  })

  it('shows Prowlarr errors in the releases section, under the hero', async () => {
    searchReleases.mockRejectedValue(new prowlarr.ProwlarrError('down', 502, 'unreachable'))
    renderAt('/title/movie/693134/releases')
    expect(await screen.findByRole('heading', { name: 'Prowlarr isn’t answering' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 1, name: 'Dune: Part Two' })).toBeInTheDocument()
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
