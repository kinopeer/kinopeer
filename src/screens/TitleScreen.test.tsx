import { screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes, useLocation, useParams } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as matchesApi from '../api/matches'
import * as qbt from '../api/qbittorrent'
import type { Torrent } from '../api/qbittorrent'
import * as tmdb from '../api/tmdb'
import type { MovieDetails, TvDetails } from '../api/tmdb'
import i18n from '../i18n'
import { mainData, torrent } from '../test/fixtures'
import { renderWithRouter } from '../test/render'
import { resetServerMatches } from '../torrents/serverMatches'
import { GUESS_VERSION, clearTitleMatchCache } from '../torrents/titleMatches'
import { TitleScreen } from './TitleScreen'

vi.mock('../api/tmdb', async (importOriginal) => {
  const actual = await importOriginal<typeof tmdb>()
  return { ...actual, getMovie: vi.fn(), getTv: vi.fn(), searchTitles: vi.fn() }
})

vi.mock('../api/qbittorrent', async (importOriginal) => ({
  ...(await importOriginal<typeof qbt>()),
  getMainData: vi.fn(),
}))

vi.mock('../api/matches', async (importOriginal) => ({
  ...(await importOriginal<typeof matchesApi>()),
  getMatches: vi.fn(),
  saveMatches: vi.fn(),
}))

const getMainData = vi.mocked(qbt.getMainData)
const getMatches = vi.mocked(matchesApi.getMatches)

const getMovie = vi.mocked(tmdb.getMovie)
const getTv = vi.mocked(tmdb.getTv)

const DUNE = {
  id: 693134,
  title: 'Dune: Part Two',
  original_title: 'Dune: Part Two',
  original_language: 'en',
  release_date: '2024-02-27',
  runtime: 166,
  overview: 'Paul Atreides unites with Chani and the Fremen.',
  poster_path: '/dune.jpg',
  backdrop_path: null,
  vote_average: 8.153,
  vote_count: 6000,
  popularity: 1,
  genres: [
    { id: 878, name: 'Science Fiction' },
    { id: 12, name: 'Adventure' },
  ],
  tagline: '',
  imdb_id: null,
  status: 'Released',
} as MovieDetails

const SHOGUN = {
  id: 126308,
  name: 'Сёгун',
  original_name: 'Shōgun',
  original_language: 'en',
  first_air_date: '2024-02-27',
  last_air_date: '2024-04-23',
  in_production: true,
  number_of_seasons: 1,
  number_of_episodes: 10,
  overview: '',
  poster_path: null,
  backdrop_path: null,
  vote_average: 8.6,
  vote_count: 900,
  popularity: 1,
  genres: [],
  episode_run_time: [],
  seasons: [],
  status: 'Returning Series',
  tagline: '',
} as TvDetails

/** A downloading torrent of the Shōgun series, as the title's "In downloads" block lists it. */
function download(hash: string, name: string, fields: Partial<Torrent> = {}): Torrent {
  return torrent(hash, { name, progress: 0.41, size: 14_800_000_000, dlspeed: 6_200_000, tags: 'tmdb:tv:126308', added_on: 1_760_000_000, ...fields })
}

function torrents(...list: Torrent[]) {
  getMainData.mockResolvedValue(mainData(list))
}

function ReleasesPage() {
  const { type, id } = useParams()
  return <h1>Releases page {`${type}/${id}`}</h1>
}

function SettingsPage() {
  return <h1>Settings page {JSON.stringify(useLocation().state)}</h1>
}

function renderAt(path: string, history: string[] = []) {
  return renderWithRouter(
    <Routes>
      <Route path="/title/:type/:id" element={<TitleScreen onSessionLost={vi.fn()} />} />
      <Route path="/torrent/:hash" element={<h1>Torrent page</h1>} />
      <Route path="/title/:type/:id/releases" element={<ReleasesPage />} />
      <Route path="/search" element={<h1>Search page</h1>} />
      <Route path="/settings" element={<SettingsPage />} />
    </Routes>,
    [...history, path],
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  clearTitleMatchCache()
  resetServerMatches()
  getMatches.mockResolvedValue({})
  vi.mocked(matchesApi.saveMatches).mockImplementation(async (changes) => changes as matchesApi.Matches)
  torrents()
  getMovie.mockResolvedValue(DUNE)
  getTv.mockResolvedValue(SHOGUN)
})

describe('TitleScreen', () => {
  it('shows a movie', async () => {
    const { container } = renderAt('/title/movie/693134')
    expect(screen.getByRole('status')).toHaveTextContent('Loading title')

    expect(await screen.findByRole('heading', { level: 1, name: 'Dune: Part Two' })).toBeInTheDocument()
    expect(screen.getByText('2024 · 2h 46m')).toBeInTheDocument()
    expect(screen.getByText('Rating').parentElement).toHaveTextContent('8.2TMDB')
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual(['Science Fiction', 'Adventure'])
    expect(screen.getByRole('region', { name: 'Overview' })).toHaveTextContent('Paul Atreides')
    expect(container.querySelector('.title-poster img')).toHaveAttribute('src', '/tmdb-img/w342/dune.jpg')
  })

  it('shows a series with its original name, years and counts', async () => {
    await i18n.changeLanguage('ru')
    renderAt('/title/tv/126308')
    expect(await screen.findByRole('heading', { level: 1, name: 'Сёгун' })).toBeInTheDocument()
    expect(getTv).toHaveBeenCalledWith(126308, expect.objectContaining({ language: 'ru-RU' }))
    expect(screen.getByText('Shōgun')).toHaveAttribute('lang', 'en')
    expect(screen.getByText('2024– · 1 сезон · 10 серий')).toBeInTheDocument()
    expect(screen.queryByRole('region', { name: 'Описание' })).not.toBeInTheDocument()
  })

  it('goes back in history when opened from the app', async () => {
    renderAt('/title/movie/693134', ['/search'])
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByRole('heading', { name: 'Search page' })).toBeInTheDocument()
  })

  it('goes to search when opened directly', async () => {
    renderAt('/title/movie/693134')
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByRole('heading', { name: 'Search page' })).toBeInTheDocument()
  })

  it('reports an unknown title', async () => {
    getMovie.mockRejectedValue(new tmdb.TmdbError('TMDB responded 404', 404))
    renderAt('/title/movie/1')
    expect(await screen.findByRole('heading', { name: 'Title not found' })).toBeInTheDocument()
  })

  it('rejects a malformed link without asking TMDB', () => {
    renderAt('/title/person/abc')
    expect(screen.getByRole('heading', { name: 'Title not found' })).toBeInTheDocument()
    expect(getMovie).not.toHaveBeenCalled()
  })

  it('retries after a network error', async () => {
    getMovie.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    renderAt('/title/movie/693134')
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Dune: Part Two' })).toBeInTheDocument()
  })

  it('explains a missing TMDB key and sends the user to enter it in Settings', async () => {
    getMovie.mockRejectedValue(new tmdb.TmdbKeyError(401))
    renderAt('/title/movie/693134')
    expect(await screen.findByRole('heading', { name: 'TMDB isn’t set up' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Enter key' }))
    expect(screen.getByRole('heading', { name: /^Settings page/ })).toHaveTextContent('{"editTmdbKey":true}')
  })

  it('opens the releases for the title', async () => {
    renderAt('/title/movie/693134')
    await userEvent.click(await screen.findByRole('button', { name: 'Find releases' }))
    expect(screen.getByRole('heading', { name: 'Releases page movie/693134' })).toBeInTheDocument()
  })

  it('opens the releases of a series although TMDB has its own type field', async () => {
    getTv.mockResolvedValue({ ...SHOGUN, type: 'Scripted' } as typeof SHOGUN)
    renderAt('/title/tv/126308')
    await userEvent.click(await screen.findByRole('button', { name: 'Find releases' }))
    expect(screen.getByRole('heading', { name: 'Releases page tv/126308' })).toBeInTheDocument()
  })

  it('explains how series releases work', async () => {
    renderAt('/title/tv/126308')
    expect(await screen.findByRole('status')).toHaveTextContent('Releases are searched by show name')
  })

  describe('In downloads', () => {
    it("lists the title's torrents, newest first, each opening its torrent screen", async () => {
      torrents(
        download('s1', 'Shogun.S01.1080p.DSNP.WEB-DL', { state: 'uploading', progress: 1, upspeed: 900_000, added_on: 1_750_000_000 }),
        download('e1', 'Shogun.S01E01-E05.2160p.DSNP.WEB-DL', { added_on: 1_760_000_000 }),
        download('dune', 'Dune.Part.Two.2024.2160p.WEB-DL', { tags: 'tmdb:movie:693134' }),
      )
      renderAt('/title/tv/126308')

      const block = await screen.findByRole('region', { name: 'In downloads 2' })
      const links = within(block).getAllByRole('link')
      expect(links.map((link) => link.getAttribute('href'))).toEqual(['/torrent/e1', '/torrent/s1'])
      expect(links[0]).toHaveAccessibleName('S01 E01–05, 2160p, Shogun.S01E01-E05.2160p.DSNP.WEB-DL, Downloading, 41%')
      expect(links[0]).toHaveTextContent('↓ 6.2 MB/s')
      expect(links[0]).toHaveTextContent('6.07 GB / 14.8 GB')
      expect(links[1]).toHaveAccessibleName('S01, 1080p, Shogun.S01.1080p.DSNP.WEB-DL, Seeding, 100%')
      expect(links[1]).toHaveTextContent('↑ 900 KB/s')
      expect(within(links[1]).getByRole('progressbar', { name: 'Shogun.S01.1080p.DSNP.WEB-DL: progress' })).toHaveAttribute(
        'aria-valuenow',
        '100',
      )
      expect(screen.getByText('In downloads · 2')).toBeInTheDocument()

      await userEvent.click(links[0])
      expect(screen.getByRole('heading', { name: 'Torrent page' })).toBeInTheDocument()
    })

    it("shows a single torrent's progress in the header", async () => {
      torrents(download('dune', 'Dune.Part.Two.2024.2160p.WEB-DL', { tags: 'tmdb:movie:693134', progress: 0.64 }))
      renderAt('/title/movie/693134')
      expect(await screen.findByText('In downloads · 64%')).toBeInTheDocument()
      expect(screen.getByRole('region', { name: 'In downloads' })).toBeInTheDocument()
    })

    it('includes torrents guessed or chosen for the title, not those chosen for another', async () => {
      getMatches.mockResolvedValue({
        guessed: { type: 'tv', id: 126308, source: 'guess', version: GUESS_VERSION },
        chosen: { type: 'tv', id: 126308, source: 'user' },
        moved: { type: 'tv', id: 1, source: 'user' },
      })
      vi.mocked(tmdb.getTv).mockImplementation(async (id) => ({ ...SHOGUN, id }))
      torrents(
        download('guessed', 'Shogun.S01.720p', { tags: '' }),
        download('chosen', 'Some.Release', { tags: '' }),
        download('moved', 'Shogun.S02.1080p'),
      )
      renderAt('/title/tv/126308')
      const block = await screen.findByRole('region', { name: 'In downloads 2' })
      expect(within(block).getAllByRole('link').map((link) => link.getAttribute('href')).sort()).toEqual([
        '/torrent/chosen',
        '/torrent/guessed',
      ])
    })

    it('stays hidden without torrents or when qBittorrent is unreachable', async () => {
      torrents(download('other', 'Other.Show.S01', { tags: 'tmdb:tv:1' }))
      const { unmount } = renderAt('/title/tv/126308')
      expect(await screen.findByRole('heading', { level: 1, name: 'Сёгун' })).toBeInTheDocument()
      expect(screen.queryByRole('region', { name: /In downloads/ })).not.toBeInTheDocument()
      unmount()

      getMainData.mockRejectedValue(new TypeError('Failed to fetch'))
      renderAt('/title/tv/126308')
      expect(await screen.findByRole('heading', { level: 1, name: 'Сёгун' })).toBeInTheDocument()
      expect(screen.queryByRole('region', { name: /In downloads/ })).not.toBeInTheDocument()
    })
  })
})
