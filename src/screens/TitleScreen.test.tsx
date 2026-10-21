import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as tmdb from '../api/tmdb'
import type { MovieDetails, TvDetails } from '../api/tmdb'
import i18n from '../i18n'
import { TitleScreen } from './TitleScreen'

vi.mock('../api/tmdb', async (importOriginal) => {
  const actual = await importOriginal<typeof tmdb>()
  return { ...actual, getMovie: vi.fn(), getTv: vi.fn() }
})

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

function renderAt(path: string, history: string[] = []) {
  return render(
    <MemoryRouter initialEntries={[...history, path]} initialIndex={history.length}>
      <Routes>
        <Route path="/title/:type/:id" element={<TitleScreen />} />
        <Route path="/title/:type/:id/releases" element={<h1>Releases page</h1>} />
        <Route path="/search" element={<h1>Search page</h1>} />
      </Routes>
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  getMovie.mockResolvedValue(DUNE)
  getTv.mockResolvedValue(SHOGUN)
})

describe('TitleScreen', () => {
  it('shows a movie', async () => {
    const { container } = renderAt('/title/movie/693134')
    expect(screen.getByRole('status')).toHaveTextContent('Loading title')

    expect(await screen.findByRole('heading', { level: 1, name: 'Dune: Part Two' })).toBeInTheDocument()
    expect(getMovie).toHaveBeenCalledWith(693134, expect.objectContaining({ language: 'en-US' }))
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

  it('opens the releases for the title', async () => {
    renderAt('/title/movie/693134')
    await userEvent.click(await screen.findByRole('button', { name: 'Find releases' }))
    expect(screen.getByRole('heading', { name: 'Releases page' })).toBeInTheDocument()
  })

  it('explains how series releases work', async () => {
    renderAt('/title/tv/126308')
    expect(await screen.findByRole('status')).toHaveTextContent('Releases are searched by show name')
  })
})
