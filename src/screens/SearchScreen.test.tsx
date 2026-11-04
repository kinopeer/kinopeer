import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Link, Route, Routes, useNavigate } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest'
import * as tmdb from '../api/tmdb'
import i18n from '../i18n'
import { TAB_RETURN, forgetTabPlaces, tabPlace } from '../lib/tabPlaces'
import { forgetKeptResults } from '../search/searchResults'
import { searchPage as page, title } from '../test/fixtures'
import { renderWithRouter, saying } from '../test/render'
import { SearchScreen } from './SearchScreen'

vi.mock('../api/tmdb', async (importOriginal) => {
  const actual = await importOriginal<typeof tmdb>()
  return { ...actual, searchTitles: vi.fn(), discoverTitles: vi.fn() }
})

const searchTitles = vi.mocked(tmdb.searchTitles)
const discoverTitles = vi.mocked(tmdb.discoverTitles)

const DUNE = title('movie', 1, 'Dune: Part Two', 2024)
const ANDOR = title('tv', 2, 'Andor', 2022)
const ALIEN = title('movie', 3, 'Alien: Romulus', 2024)
const SHOGUN = title('tv', 4, 'Shōgun')

function renderScreen(path = '/search') {
  return renderWithRouter(<SearchScreen />, [path])
}

beforeEach(() => {
  vi.resetAllMocks()
  // Every test's router starts at the same history entry.
  forgetKeptResults()
  discoverTitles.mockImplementation(async (type, params) =>
    page(type === 'tv' ? [ANDOR, SHOGUN] : params.sort_by === 'popularity.desc' ? [DUNE] : [ALIEN]),
  )
  searchTitles.mockResolvedValue(page([DUNE, ANDOR]))
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
    expect(types.getByRole('button', { name: 'Series', pressed: true })).toBeInTheDocument()
    expect(types.getByRole('button', { name: 'All', pressed: false })).toBeInTheDocument()
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

    expect(await screen.findByText('About 2 results')).toBeInTheDocument()
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
    expect(await screen.findByRole('heading', { name: 'Dune: Part Two' })).toBeInTheDocument()
    expect(searchTitles).toHaveBeenCalledWith('dune', expect.objectContaining({ type: 'movie' }))
  })

  it('shows TMDB’s count for the whole search, as an estimate', async () => {
    // TMDB's multi search also counts the people it finds, which aren't shown.
    searchTitles.mockResolvedValue(page([DUNE, ANDOR], { totalPages: 65, totalResults: 1296 }))
    renderScreen('/search?q=dune')
    expect(await screen.findByText('About 1,296 results')).toBeInTheDocument()
  })

  it('searches TMDB for the type picked, so its count and pages are of that type', async () => {
    searchTitles.mockImplementation(async (_query, options) =>
      options?.type === 'tv' ? page([ANDOR], { totalResults: 7 }) : page([DUNE, ANDOR], { totalResults: 40 }),
    )
    renderScreen('/search?q=star')
    await screen.findByText('About 40 results')

    await userEvent.click(within(screen.getByRole('group', { name: 'Type' })).getByRole('button', { name: 'Series' }))

    expect(await screen.findByText('About 7 results')).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Dune: Part Two' })).not.toBeInTheDocument()
    expect(searchTitles.mock.calls.map(([, options]) => options?.type)).toEqual([undefined, 'tv'])
  })

  it('shows a tab picked again from what it loaded, without searching again', async () => {
    searchTitles.mockImplementation(async (_query, options) =>
      options?.type === 'tv' ? page([ANDOR], { totalResults: 7 }) : page([DUNE, ANDOR], { totalResults: 40 }),
    )
    renderScreen('/search?q=star')
    await screen.findByText('About 40 results')
    const types = within(screen.getByRole('group', { name: 'Type' }))
    await userEvent.click(types.getByRole('button', { name: 'Series' }))
    await screen.findByText('About 7 results')

    await userEvent.click(types.getByRole('button', { name: 'All' }))

    expect(screen.getByText('About 40 results')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Dune: Part Two' })).toBeInTheDocument()
    expect(searchTitles).toHaveBeenCalledTimes(2)
  })

  it('adds the next page under the results, until the last one', async () => {
    searchTitles.mockImplementation(async (_query, options) =>
      options?.page === 2
        ? page([ALIEN], { page: 2, totalPages: 2, totalResults: 3 })
        : page([DUNE, ANDOR], { totalPages: 2, totalResults: 4 }),
    )
    renderScreen('/search?q=star&year=2024')
    await screen.findByText('About 4 results')

    await userEvent.click(screen.getByRole('button', { name: 'Show more' }))

    expect(await screen.findByRole('heading', { name: 'Alien: Romulus' })).toBeInTheDocument()
    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
      'Dune: Part Two',
      'Andor',
      'Alien: Romulus',
    ])
    expect(screen.getByText('About 3 results')).toBeInTheDocument()
    expect(searchTitles).toHaveBeenLastCalledWith('star', expect.objectContaining({ page: 2, year: 2024 }))
    expect(screen.queryByRole('button', { name: 'Show more' })).not.toBeInTheDocument()
  })

  it('shows the next page loading and its failure under what’s loaded, and tries again', async () => {
    let fail = (_error: unknown) => {}
    searchTitles.mockResolvedValueOnce(page([DUNE], { totalPages: 3 }))
    searchTitles.mockImplementationOnce(() => new Promise((_resolve, reject) => (fail = reject)))
    searchTitles.mockResolvedValueOnce(page([ALIEN], { page: 2, totalPages: 3 }))
    renderScreen('/search?q=dune')
    await userEvent.click(await screen.findByRole('button', { name: 'Show more' }))

    const more = screen.getByRole('button', { name: 'Show more' })
    expect(more).toHaveAttribute('aria-busy', 'true')
    expect(more).toBeDisabled()

    await act(async () => fail(new TypeError('Failed to fetch')))
    const failure = screen.getByRole('alert', { name: saying('Couldn’t load more') })
    expect(screen.getByRole('heading', { name: 'Dune: Part Two' })).toBeInTheDocument()

    await userEvent.click(within(failure).getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { name: 'Alien: Romulus' })).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(searchTitles.mock.calls.map(([, options]) => options?.page)).toEqual([1, 2, 2])
    // Page 3 is still to come.
    expect(screen.getByRole('button', { name: 'Show more' })).toBeEnabled()
  })

  it('explains a missing TMDB key when the next page finds it', async () => {
    searchTitles.mockResolvedValueOnce(page([DUNE], { totalPages: 2 }))
    searchTitles.mockRejectedValueOnce(new tmdb.TmdbKeyError(401))
    renderScreen('/search?q=dune')
    await userEvent.click(await screen.findByRole('button', { name: 'Show more' }))
    expect(await screen.findByRole('heading', { name: 'TMDB isn’t set up' })).toBeInTheDocument()
  })

  it('says when a search fails, and tries again', async () => {
    let answer = () => {}
    searchTitles.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    searchTitles.mockImplementationOnce(() => new Promise((resolve) => (answer = () => resolve(page([DUNE, ANDOR])))))
    renderScreen('/search?q=dune')
    await userEvent.click(await screen.findByRole('button', { name: 'Try again' }))
    expect(screen.getByRole('status', { name: saying('Loading') })).toBeInTheDocument()

    await act(async () => answer())
    expect(screen.getByText('About 2 results')).toBeInTheDocument()
  })

  it.each([
    ['answers', (settle: { resolve: (page: tmdb.SearchPage) => void }) => settle.resolve(page([ALIEN], { page: 2, totalPages: 2 }))],
    // As an aborted request does.
    ['fails', (settle: { reject: (error: unknown) => void }) => settle.reject(new DOMException('Aborted', 'AbortError'))],
  ] as const)('drops a next page that %s after the tab changed and changed back', async (_case, finish) => {
    const settle = { resolve: (_page: tmdb.SearchPage) => {}, reject: (_error: unknown) => {} }
    searchTitles.mockResolvedValueOnce(page([DUNE], { totalPages: 2 }))
    searchTitles.mockImplementationOnce(
      () => new Promise((resolve, reject) => Object.assign(settle, { resolve, reject })),
    )
    searchTitles.mockResolvedValueOnce(page([SHOGUN]))
    renderScreen('/search?q=dune')
    await userEvent.click(await screen.findByRole('button', { name: 'Show more' }))
    const types = within(screen.getByRole('group', { name: 'Type' }))
    await userEvent.click(types.getByRole('button', { name: 'Series' }))
    await screen.findByRole('heading', { name: 'Shōgun' })

    await userEvent.click(types.getByRole('button', { name: 'All' }))
    await act(async () => finish(settle))

    expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual(['Dune: Part Two'])
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Show more' })).toBeEnabled()
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
    renderScreen('/search?q=star')
    await screen.findByText('About 2 results')

    // A fifth digit isn't taken.
    await userEvent.type(screen.getByRole('textbox', { name: 'Release year' }), '20x225')
    // The old results go while the year waits for the debounce.
    expect(screen.getByRole('status', { name: saying('Loading') })).toBeInTheDocument()

    expect(await screen.findByText('About 2 results')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Release year' })).toHaveValue('2022')
    // Typing the digits doesn't search for 2, 20 and 202 on the way.
    expect(searchTitles.mock.calls.map(([query, options]) => [query, options?.year])).toEqual([
      ['star', undefined],
      ['star', 2022],
    ])
  })

  it('marks a year out of range and searches without it', async () => {
    renderScreen('/search?q=dune&year=1850')
    await screen.findByText('About 2 results')

    expect(screen.getByRole('textbox', { name: 'Release year' })).toBeInvalid()
    expect(searchTitles).toHaveBeenCalledWith('dune', expect.objectContaining({ year: undefined }))
  })

  it('restores the year from the URL, shows it only while searching and clears it with the query', async () => {
    renderScreen('/search?q=dune&year=2024')
    expect(screen.getByRole('textbox', { name: 'Release year' })).toHaveValue('2024')
    await screen.findByText('About 2 results')
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
    await screen.findByText('About 2 results')

    await userEvent.clear(screen.getByRole('searchbox'))
    await userEvent.type(screen.getByRole('searchbox'), 'alien')

    expect(screen.getByRole('textbox', { name: 'Release year' })).toHaveValue('')
  })

  it('drops the year when the query is left blank', async () => {
    renderScreen('/search?q=it&year=2024')
    await screen.findByText('About 2 results')

    // Spaces in place of the query count as no query.
    await userEvent.type(screen.getByRole('searchbox'), ' ', { initialSelectionStart: 0, initialSelectionEnd: 2 })
    await userEvent.type(screen.getByRole('searchbox'), 'alien')

    expect(screen.getByRole('textbox', { name: 'Release year' })).toHaveValue('')
  })

  it('offers to clear the year when nothing came out that year', async () => {
    searchTitles.mockImplementation(async (_query, options) => page(options?.year ? [] : [DUNE]))
    renderScreen('/search?q=dune&year=1950')
    const empty = await screen.findByRole('heading', { name: 'Nothing found for “dune”' })
    expect(within(empty.parentElement!).getByText('Nothing from 1950. Try another year or clear it.')).toBeInTheDocument()

    await userEvent.click(within(empty.parentElement!).getByRole('button', { name: 'Clear the year' }))
    expect(await screen.findByText('About 1 result')).toBeInTheDocument()
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

  it('cancels a next page on its way when the screen is left', async () => {
    searchTitles.mockResolvedValueOnce(page([DUNE], { totalPages: 2 }))
    searchTitles.mockImplementationOnce(() => new Promise(() => {}))
    const { unmount } = renderScreen('/search?q=dune')
    await userEvent.click(await screen.findByRole('button', { name: 'Show more' }))

    unmount()

    expect(searchTitles.mock.calls[1][1]?.signal?.aborted).toBe(true)
  })

  describe('back from a title', () => {
    const scrolledTo = (y: number) => Object.defineProperty(window, 'scrollY', { value: y, configurable: true })

    function TitlePage() {
      const navigate = useNavigate()
      return (
        <>
          <button type="button" onClick={() => void navigate(-1)}>
            Back
          </button>
          {/* As the tab bar's Search tab links to the search it was left on. */}
          <Link to="/search?q=dune" state={TAB_RETURN}>
            Search tab
          </Link>
          <Link to="/search?q=dune">Same search</Link>
        </>
      )
    }

    function renderWithTitle() {
      renderWithRouter(
        <Routes>
          <Route path="search" element={<SearchScreen />} />
          <Route path="title/:type/:id" element={<TitlePage />} />
        </Routes>,
        ['/search?q=dune'],
      )
    }

    let scrollTo: MockInstance<typeof window.scrollTo>

    beforeEach(() => {
      sessionStorage.clear()
      forgetTabPlaces()
      scrollTo = vi.spyOn(window, 'scrollTo')
    })

    afterEach(() => {
      scrolledTo(0)
      // The setup's no-op scrollTo is back for the other tests and files.
      scrollTo.mockRestore()
    })

    it('shows the pages loaded before at once, at the same scroll position', async () => {
      searchTitles.mockImplementation(async (_query, options) =>
        options?.page === 2 ? page([ALIEN], { page: 2, totalPages: 3 }) : page([DUNE, ANDOR], { totalPages: 3 }),
      )
      renderWithTitle()
      await userEvent.click(await screen.findByRole('button', { name: 'Show more' }))
      await screen.findByRole('heading', { name: 'Alien: Romulus' })
      scrolledTo(1400)
      await userEvent.click(screen.getByRole('link', { name: /Alien: Romulus/ }))
      scrolledTo(80)
      await userEvent.click(screen.getByRole('button', { name: 'Back' }))

      expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
        'Dune: Part Two',
        'Andor',
        'Alien: Romulus',
      ])
      expect(scrollTo).toHaveBeenCalledWith(0, 1400)
      // Nothing is asked again, and Show more goes on from the third page.
      expect(searchTitles).toHaveBeenCalledTimes(2)
      await userEvent.click(screen.getByRole('button', { name: 'Show more' }))
      expect(searchTitles).toHaveBeenLastCalledWith('dune', expect.objectContaining({ page: 3 }))
    })

    it('comes back through the Search tab with the pages loaded before, where the tab was left', async () => {
      searchTitles.mockImplementation(async (_query, options) =>
        options?.page === 2 ? page([ALIEN], { page: 2, totalPages: 3 }) : page([DUNE, ANDOR], { totalPages: 3 }),
      )
      renderWithTitle()
      await userEvent.click(await screen.findByRole('button', { name: 'Show more' }))
      await screen.findByRole('heading', { name: 'Alien: Romulus' })
      scrolledTo(1400)
      await userEvent.click(screen.getByRole('link', { name: /Alien: Romulus/ }))
      // Kept as the Search tab's place, which its link goes to.
      expect(tabPlace('/search')).toEqual({ search: '?q=dune', y: 1400 })
      scrolledTo(80)
      await userEvent.click(screen.getByRole('link', { name: 'Search tab' }))

      expect(screen.getAllByRole('heading', { level: 3 }).map((h) => h.textContent)).toEqual([
        'Dune: Part Two',
        'Andor',
        'Alien: Romulus',
      ])
      expect(scrollTo).toHaveBeenCalledWith(0, 1400)
      // Nothing is asked again: a new history entry, but the search the tab was left on.
      expect(searchTitles).toHaveBeenCalledTimes(2)
    })

    it('asks again for a search opened afresh, rather than showing the pages kept for another entry', async () => {
      searchTitles.mockResolvedValue(page([DUNE, ANDOR]))
      renderWithTitle()
      await screen.findByText('About 2 results')
      await userEvent.click(screen.getByRole('link', { name: /Andor/ }))
      await userEvent.click(screen.getByRole('link', { name: 'Same search' }))
      expect(await screen.findByText('About 2 results')).toBeInTheDocument()
      expect(searchTitles).toHaveBeenCalledTimes(2)
    })

    it('searches again when the results weren’t kept, and scrolls back once they’re in', async () => {
      // The second search, on the way back, answers only when told to.
      let answer = () => {}
      searchTitles.mockImplementationOnce(async () => page([DUNE, ANDOR]))
      searchTitles.mockImplementationOnce(
        () => new Promise((resolve) => (answer = () => resolve(page([DUNE, ANDOR])))),
      )
      renderWithTitle()
      await screen.findByText('About 2 results')
      scrolledTo(720)
      await userEvent.click(screen.getByRole('link', { name: /Andor/ }))
      // As after a reload, which empties the memory the results were kept in.
      forgetKeptResults()
      // The browser restores the scroll before the results are back, so it's clamped to the short page.
      scrolledTo(80)
      await userEvent.click(screen.getByRole('button', { name: 'Back' }))
      expect(screen.getByRole('status', { name: saying('Loading') })).toBeInTheDocument()
      expect(scrollTo).not.toHaveBeenCalled()

      await act(async () => answer())
      expect(screen.getByText('About 2 results')).toBeInTheDocument()
      expect(scrollTo).toHaveBeenCalledWith(0, 720)
    })
  })

  it('asks TMDB in the app language', async () => {
    await i18n.changeLanguage('ru')
    renderScreen()
    expect(await screen.findByRole('heading', { name: 'Новинки в цифре' })).toBeInTheDocument()
    expect(discoverTitles).toHaveBeenCalledWith('movie', expect.anything(), expect.objectContaining({ language: 'ru-RU' }))
  })
})
