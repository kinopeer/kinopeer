import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes, useNavigate } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as tmdb from '../api/tmdb'
import type { Title } from '../api/tmdb'
import i18n from '../i18n'
import { title } from '../test/fixtures'
import { renderWithRouter } from '../test/render'
import { SearchScreen } from './SearchScreen'

vi.mock('../api/tmdb', async (importOriginal) => {
  const actual = await importOriginal<typeof tmdb>()
  return { ...actual, searchTitles: vi.fn(), discoverTitles: vi.fn() }
})

const searchTitles = vi.mocked(tmdb.searchTitles)
const discoverTitles = vi.mocked(tmdb.discoverTitles)

const page = (titles: Title[]) => ({ titles, page: 1, totalPages: 1 })

const DUNE = title('movie', 1, 'Dune: Part Two', 2024)
const ANDOR = title('tv', 2, 'Andor', 2022)
const ALIEN = title('movie', 3, 'Alien: Romulus', 2024)
const SHOGUN = title('tv', 4, 'Shōgun')

function renderScreen(path = '/search') {
  return renderWithRouter(<SearchScreen />, [path])
}

beforeEach(() => {
  vi.resetAllMocks()
  discoverTitles.mockImplementation(async (type, params) =>
    page(type === 'tv' ? [ANDOR, SHOGUN] : params.sort_by === 'popularity.desc' ? [DUNE] : [ALIEN]),
  )
  searchTitles.mockResolvedValue(page([DUNE, ANDOR]))
})

afterEach(() => {
  // The scroll spy, so the setup's no-op scrollTo is back for the other files' screens.
  vi.restoreAllMocks()
})

function row(name: string) {
  return within(screen.getByRole('region', { name }))
}

describe('SearchScreen', () => {
  it('shows titles likely on torrents already before a search', async () => {
    renderScreen()
    expect(screen.getByRole('status')).toHaveTextContent('Loading')
    expect(await screen.findByRole('heading', { name: 'New on digital' })).toBeInTheDocument()

    expect(screen.getByRole('heading', { name: 'New episodes' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Best of the year' })).toBeInTheDocument()
    expect(row('New on digital').getByRole('link', { name: /Dune: Part Two/ })).toHaveAttribute('href', '/title/movie/1')
    expect(row('New episodes').getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'Andor',
      'Shōgun',
    ])
    expect(row('New episodes').getByText('Series')).toBeInTheDocument()
    expect(row('Best of the year').getByText('Movie · 2024')).toBeInTheDocument()
  })

  it('filters by type', async () => {
    renderScreen()
    await screen.findByRole('heading', { name: 'New on digital' })
    const types = within(screen.getByRole('group', { name: 'Type' }))
    expect(types.getByRole('button', { name: 'All', pressed: true })).toBeInTheDocument()

    await userEvent.click(types.getByRole('button', { name: 'Series' }))
    expect(screen.getByRole('heading', { name: 'New episodes' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'New on digital' })).not.toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Best of the year' })).not.toBeInTheDocument()

    await userEvent.click(types.getByRole('button', { name: 'Movies' }))
    expect(screen.getByRole('heading', { name: 'New on digital' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Best of the year' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'New episodes' })).not.toBeInTheDocument()
  })

  it('hides an empty row', async () => {
    const answer = discoverTitles.getMockImplementation()!
    discoverTitles.mockImplementation(async (type, params, options) =>
      type === 'tv' ? page([]) : answer(type, params, options),
    )
    renderScreen()
    expect(await screen.findByRole('heading', { name: 'New on digital' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'New episodes' })).not.toBeInTheDocument()
  })

  it('says so when the type picked has nothing to show, and tries again', async () => {
    const answer = discoverTitles.getMockImplementation()!
    discoverTitles.mockImplementation(async (type, params, options) =>
      type === 'tv' ? page([]) : answer(type, params, options),
    )
    renderScreen('/search?type=tv')
    expect(await screen.findByRole('heading', { name: 'Nothing to suggest right now' })).toBeInTheDocument()

    discoverTitles.mockImplementation(answer)
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { name: 'New episodes' })).toBeInTheDocument()
  })

  it('shows an error when the type picked has only failed rows', async () => {
    const answer = discoverTitles.getMockImplementation()!
    discoverTitles.mockImplementation(async (type, params, options) => {
      if (type === 'tv') throw new TypeError('Failed to fetch')
      return answer(type, params, options)
    })
    renderScreen('/search?type=tv')
    expect(await screen.findByRole('heading', { name: 'Couldn’t load from TMDB' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Nothing to suggest right now' })).not.toBeInTheDocument()
  })

  it('searches after typing stops', async () => {
    const { container } = renderScreen()
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search' }), 'dune')

    expect(await screen.findByText('2 results')).toBeInTheDocument()
    expect(searchTitles).toHaveBeenCalledTimes(1)
    expect(searchTitles).toHaveBeenCalledWith('dune', expect.anything())
    expect(screen.getByRole('link', { name: /Dune: Part Two/ })).toHaveAttribute('href', '/title/movie/1')
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
    const empty = await screen.findByRole('heading', { name: 'Nothing found for “zzzz”' })

    // The empty state's own Clear, not the search field's.
    await userEvent.click(within(empty.parentElement!).getByRole('button', { name: 'Clear' }))
    expect(screen.getByRole('searchbox')).toHaveValue('')
    expect(await screen.findByRole('heading', { name: 'New on digital' })).toBeInTheDocument()
  })

  it('explains a missing TMDB key', async () => {
    discoverTitles.mockRejectedValue(new tmdb.TmdbKeyError(401))
    renderScreen()
    expect(await screen.findByRole('heading', { name: 'TMDB isn’t set up' })).toBeInTheDocument()
  })

  it('explains a missing TMDB key when another row failed first for another reason', async () => {
    discoverTitles.mockRejectedValue(new tmdb.TmdbKeyError(401))
    discoverTitles.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    renderScreen()
    expect(await screen.findByRole('heading', { name: 'TMDB isn’t set up' })).toBeInTheDocument()
  })

  it('retries after a network error', async () => {
    const answer = discoverTitles.getMockImplementation()!
    discoverTitles.mockRejectedValue(new TypeError('Failed to fetch'))
    renderScreen()
    const retry = await screen.findByRole('button', { name: 'Try again' })
    discoverTitles.mockImplementation(answer)
    await userEvent.click(retry)
    expect(await screen.findByRole('heading', { name: 'New on digital' })).toBeInTheDocument()
  })

  it('leaves out a row whose query fails and shows the others', async () => {
    const answer = discoverTitles.getMockImplementation()!
    discoverTitles.mockImplementation(async (type, params, options) => {
      if (type === 'tv') throw new tmdb.TmdbError('TMDB responded 422', 422)
      return answer(type, params, options)
    })
    renderScreen()
    expect(await screen.findByRole('heading', { name: 'New on digital' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Best of the year' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'New episodes' })).not.toBeInTheDocument()
  })

  it('comes back from a title at the same scroll position', async () => {
    sessionStorage.clear()
    const scrollTo = vi.spyOn(window, 'scrollTo')
    const scrolledTo = (y: number) => Object.defineProperty(window, 'scrollY', { value: y, configurable: true })
    // The second search, on the way back, answers only when told to.
    let answer = () => {}
    searchTitles.mockImplementationOnce(async () => page([DUNE, ANDOR]))
    searchTitles.mockImplementationOnce(
      () => new Promise((resolve) => (answer = () => resolve(page([DUNE, ANDOR])))),
    )
    function TitlePage() {
      const navigate = useNavigate()
      return (
        <button type="button" onClick={() => void navigate(-1)}>
          Back
        </button>
      )
    }
    renderWithRouter(
      <Routes>
        <Route path="search" element={<SearchScreen />} />
        <Route path="title/:type/:id" element={<TitlePage />} />
      </Routes>,
      ['/search?q=dune'],
    )
    await screen.findByText('2 results')
    scrolledTo(720)
    await userEvent.click(screen.getByRole('link', { name: /Andor/ }))
    // The browser restores the scroll before the results are back, so it's clamped to the short page.
    scrolledTo(80)
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByRole('status')).toHaveTextContent('Loading')
    expect(scrollTo).not.toHaveBeenCalled()

    await act(async () => answer())
    expect(screen.getByText('2 results')).toBeInTheDocument()
    expect(scrollTo).toHaveBeenCalledWith(0, 720)
    scrolledTo(0)
  })

  it('asks TMDB in the app language', async () => {
    await i18n.changeLanguage('ru')
    renderScreen()
    expect(await screen.findByRole('heading', { name: 'Новинки в цифре' })).toBeInTheDocument()
    expect(discoverTitles).toHaveBeenCalledWith('movie', expect.anything(), expect.objectContaining({ language: 'ru-RU' }))
  })
})
