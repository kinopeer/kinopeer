import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes, useNavigate } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as tmdb from '../api/tmdb'
import type { Title } from '../api/tmdb'
import i18n from '../i18n'
import { title } from '../test/fixtures'
import { renderWithRouter, saying } from '../test/render'
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
    expect(screen.getByRole('status', { name: saying('Loading') })).toBeInTheDocument()
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
    // The movie rows fail: only the picked type's rows decide between the note and the error.
    discoverTitles.mockImplementation(async (type) => {
      if (type === 'movie') throw new TypeError('Failed to fetch')
      return page([])
    })
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

    discoverTitles.mockImplementation(answer)
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { name: 'New episodes' })).toBeInTheDocument()
  })

  it('searches after typing stops', async () => {
    const { container } = renderScreen()
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search' }), 'dune')

    expect(await screen.findByText('2 results')).toBeInTheDocument()
    // One search for the whole word, not one per key typed.
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

  it('searches once by a typed year', async () => {
    searchTitles.mockResolvedValue(page([DUNE, ANDOR]))
    renderScreen('/search?q=star&type=tv')
    await screen.findByText('1 result')

    await userEvent.type(screen.getByRole('textbox', { name: 'Release year' }), '20x22')
    // The old results go while the year waits for the debounce.
    expect(screen.getByRole('status', { name: saying('Loading') })).toBeInTheDocument()

    expect(await screen.findByText('1 result')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Release year' })).toHaveValue('2022')
    // Typing the digits doesn't search for 2, 20 and 202 on the way.
    expect(searchTitles.mock.calls.map(([query, options]) => [query, options?.year])).toEqual([
      ['star', undefined],
      ['star', 2022],
    ])
  })

  it('switches the type of a search by year without searching again', async () => {
    searchTitles.mockResolvedValue(page([DUNE, ANDOR]))
    renderScreen('/search?q=star&year=2022&type=tv')
    expect(await screen.findByRole('heading', { name: 'Andor' })).toBeInTheDocument()

    await userEvent.click(within(screen.getByRole('group', { name: 'Type' })).getByRole('button', { name: 'Movies' }))

    expect(screen.getByRole('heading', { name: 'Dune: Part Two' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Andor' })).not.toBeInTheDocument()
    // With a year both types come in one search, so a tab switch filters them instead of asking TMDB again.
    expect(searchTitles).toHaveBeenCalledTimes(1)
  })

  it('marks a year out of range and searches without it', async () => {
    renderScreen('/search?q=dune&year=1850')
    await screen.findByText('2 results')

    expect(screen.getByRole('textbox', { name: 'Release year' })).toBeInvalid()
    expect(searchTitles).toHaveBeenCalledWith('dune', expect.objectContaining({ year: undefined }))
  })

  it('restores the year from the URL, shows it only while searching and clears it with the query', async () => {
    renderScreen('/search?q=dune&year=2024')
    expect(screen.getByRole('textbox', { name: 'Release year' })).toHaveValue('2024')
    await screen.findByText('2 results')
    expect(searchTitles).toHaveBeenCalledWith('dune', expect.objectContaining({ year: 2024 }))

    await userEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(await screen.findByRole('heading', { name: 'New on digital' })).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Release year' })).not.toBeInTheDocument()

    // Clearing the query starts over, so the next search has no year.
    await userEvent.type(screen.getByRole('searchbox'), 'alien')
    expect(screen.getByRole('textbox', { name: 'Release year' })).toHaveValue('')
  })

  it('drops the year when the query is deleted by hand', async () => {
    renderScreen('/search?q=it&year=2024')
    await screen.findByText('2 results')

    await userEvent.clear(screen.getByRole('searchbox'))
    await userEvent.type(screen.getByRole('searchbox'), 'alien')

    expect(screen.getByRole('textbox', { name: 'Release year' })).toHaveValue('')
  })

  it('offers to clear the year when nothing came out that year', async () => {
    searchTitles.mockImplementation(async (_query, options) => page(options?.year ? [] : [DUNE]))
    renderScreen('/search?q=dune&year=1950')
    const empty = await screen.findByRole('heading', { name: 'Nothing found for “dune”' })
    expect(within(empty.parentElement!).getByText('Nothing from 1950. Try another year or clear it.')).toBeInTheDocument()

    await userEvent.click(within(empty.parentElement!).getByRole('button', { name: 'Clear the year' }))
    expect(await screen.findByText('1 result')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Release year' })).toHaveValue('')
  })

  it('explains a missing TMDB key', async () => {
    discoverTitles.mockRejectedValue(new tmdb.TmdbKeyError(401))
    renderScreen()
    expect(await screen.findByRole('heading', { name: 'TMDB isn’t set up' })).toBeInTheDocument()
  })

  it('explains a missing TMDB key even when another row loads', async () => {
    const answer = discoverTitles.getMockImplementation()!
    discoverTitles.mockImplementation(async (type, params, options) => {
      if (type === 'tv') throw new tmdb.TmdbKeyError(401)
      return answer(type, params, options)
    })
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
    expect(screen.getByRole('status', { name: saying('Loading') })).toBeInTheDocument()
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
