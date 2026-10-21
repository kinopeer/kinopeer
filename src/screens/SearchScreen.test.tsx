import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as tmdb from '../api/tmdb'
import type { Title } from '../api/tmdb'
import i18n from '../i18n'
import { SearchScreen } from './SearchScreen'

vi.mock('../api/tmdb', async (importOriginal) => {
  const actual = await importOriginal<typeof tmdb>()
  return { ...actual, searchTitles: vi.fn(), getTrending: vi.fn(), getPopular: vi.fn() }
})

const searchTitles = vi.mocked(tmdb.searchTitles)
const getTrending = vi.mocked(tmdb.getTrending)
const getPopular = vi.mocked(tmdb.getPopular)

function title(type: Title['type'], id: number, name: string, year?: number): Title {
  return { type, id, title: name, originalTitle: name, year, overview: '', posterPath: `/${id}.jpg`, backdropPath: null, rating: 7 }
}

const page = (titles: Title[]) => ({ titles, page: 1, totalPages: 1 })

const DUNE = title('movie', 1, 'Dune: Part Two', 2024)
const ANDOR = title('tv', 2, 'Andor', 2022)
const ALIEN = title('movie', 3, 'Alien: Romulus', 2024)
const SHOGUN = title('tv', 4, 'Shōgun')

function renderScreen(path = '/search') {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <SearchScreen />
    </MemoryRouter>,
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  getTrending.mockResolvedValue(page([DUNE, ANDOR]))
  getPopular.mockImplementation(async (type) => page(type === 'movie' ? [ALIEN] : [SHOGUN]))
  searchTitles.mockResolvedValue(page([DUNE, ANDOR]))
})

function row(name: string) {
  return within(screen.getByRole('region', { name }))
}

describe('SearchScreen', () => {
  it('shows trending and popular titles before a search', async () => {
    renderScreen()
    expect(screen.getByRole('status')).toHaveTextContent('Loading')
    expect(await screen.findByRole('heading', { name: 'Trending this week' })).toBeInTheDocument()

    expect(row('Trending this week').getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'Dune: Part Two',
      'Andor',
    ])
    expect(row('Popular movies').getByText('Movie · 2024')).toBeInTheDocument()
    expect(row('Popular series').getByText('Series')).toBeInTheDocument()
    expect(getTrending).toHaveBeenCalledWith('all', expect.objectContaining({ language: 'en-US' }))
  })

  it('filters by type', async () => {
    renderScreen()
    await screen.findByRole('heading', { name: 'Trending this week' })
    const types = within(screen.getByRole('group', { name: 'Type' }))
    expect(types.getByRole('button', { name: 'All', pressed: true })).toBeInTheDocument()

    await userEvent.click(types.getByRole('button', { name: 'Series' }))
    expect(screen.queryByRole('heading', { name: 'Popular movies' })).not.toBeInTheDocument()
    expect(row('Trending this week').queryByText('Dune: Part Two')).not.toBeInTheDocument()
    expect(row('Trending this week').getByText('Andor')).toBeInTheDocument()
  })

  it('searches after typing stops', async () => {
    const { container } = renderScreen()
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search' }), 'dune')

    expect(await screen.findByText('2 results')).toBeInTheDocument()
    expect(searchTitles).toHaveBeenCalledTimes(1)
    expect(searchTitles).toHaveBeenCalledWith('dune', expect.objectContaining({ language: 'en-US' }))
    expect(screen.getByRole('heading', { name: 'Dune: Part Two' })).toBeInTheDocument()
    // Posters are decorative (alt="") and load through the same-origin image proxy.
    expect(container.querySelector('img[src="/tmdb-img/w342/1.jpg"]')).toHaveAttribute('alt', '')
  })

  it('restores the query from the URL', async () => {
    renderScreen('/search?q=dune&type=movie')
    expect(screen.getByRole('searchbox')).toHaveValue('dune')
    expect(await screen.findByText('1 result')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Andor' })).not.toBeInTheDocument()
  })

  it('offers to clear a search without results', async () => {
    searchTitles.mockResolvedValue(page([]))
    renderScreen('/search?q=zzzz')
    expect(await screen.findByRole('heading', { name: 'Nothing found for “zzzz”' })).toBeInTheDocument()

    await userEvent.click(screen.getAllByRole('button', { name: 'Clear' })[1])
    expect(screen.getByRole('searchbox')).toHaveValue('')
    expect(await screen.findByRole('heading', { name: 'Trending this week' })).toBeInTheDocument()
  })

  it('explains a missing TMDB key', async () => {
    getTrending.mockRejectedValue(new tmdb.TmdbKeyError(401))
    renderScreen()
    expect(await screen.findByRole('heading', { name: 'TMDB isn’t set up' })).toBeInTheDocument()
  })

  it('retries after a network error', async () => {
    getTrending.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    renderScreen()
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { name: 'Trending this week' })).toBeInTheDocument()
  })

  it('asks TMDB in the app language', async () => {
    await i18n.changeLanguage('ru')
    renderScreen()
    expect(await screen.findByRole('heading', { name: 'В тренде на этой неделе' })).toBeInTheDocument()
    expect(getPopular).toHaveBeenCalledWith('movie', expect.objectContaining({ language: 'ru-RU' }))
  })
})
