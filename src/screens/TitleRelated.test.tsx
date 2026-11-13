import { act, screen, within } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as tmdb from '../api/tmdb'
import type { Title } from '../api/tmdb'
import { renderWithRouter } from '../test/render'
import { TitleRelated } from './TitleRelated'

vi.mock('../api/tmdb', async (importOriginal) => {
  const actual = await importOriginal<typeof tmdb>()
  return { ...actual, getRecommendations: vi.fn(), getSimilar: vi.fn() }
})

const getRecommendations = vi.mocked(tmdb.getRecommendations)
const getSimilar = vi.mocked(tmdb.getSimilar)

function title(id: number, name: string, fields: Partial<Title> = {}): Title {
  return { type: 'movie', id, title: name, originalTitle: name, overview: '', posterPath: `/${id}.jpg`, backdropPath: null, rating: 7, ...fields }
}

function page(...titles: Title[]): tmdb.TitlePage {
  return { titles, page: 1, totalPages: 1 }
}

/** Lets the mocked answers arrive and be rendered: they're all settled promises, done within a macrotask. */
async function answered() {
  await act(() => new Promise((resolve) => setTimeout(resolve, 0)))
}

function renderRelated(id = 693134) {
  return renderWithRouter(<TitleRelated type="movie" id={id} language="en-US" />)
}

beforeEach(() => {
  vi.resetAllMocks()
  getRecommendations.mockResolvedValue(page())
  getSimilar.mockResolvedValue(page())
})

describe('TitleRelated', () => {
  it("shows TMDB's recommendations as links to their titles, without asking for similar ones", async () => {
    getRecommendations.mockResolvedValue(page(title(438631, 'Dune', { year: 2021 }), title(157336, 'Interstellar')))
    renderRelated()

    const row = await screen.findByRole('region', { name: 'Recommendations' })
    const links = within(row).getAllByRole('link')
    expect(links.map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['DuneMovie · 2021', '/title/movie/438631'],
      ['InterstellarMovie', '/title/movie/157336'],
    ])
    expect(getRecommendations).toHaveBeenCalledWith('movie', 693134, expect.objectContaining({ language: 'en-US' }))
    // A call count is the only way to see that no second request goes out.
    expect(getSimilar).not.toHaveBeenCalled()
  })

  it('falls back to similar titles when nothing is recommended', async () => {
    getSimilar.mockResolvedValue(page(title(438631, 'Dune')))
    renderRelated()

    const row = await screen.findByRole('region', { name: 'Similar titles' })
    expect(within(row).getByRole('link', { name: /Dune/ })).toHaveAttribute('href', '/title/movie/438631')
    expect(getSimilar).toHaveBeenCalledWith('movie', 693134, expect.objectContaining({ language: 'en-US' }))
  })

  it('leaves the title itself out of the row', async () => {
    getRecommendations.mockResolvedValue(page(title(693134, 'Dune: Part Two'), title(438631, 'Dune')))
    renderRelated(693134)

    const row = await screen.findByRole('region', { name: 'Recommendations' })
    expect(within(row).getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual(['/title/movie/438631'])
  })

  it('falls back to similar titles when the only recommendation is the title itself', async () => {
    getRecommendations.mockResolvedValue(page(title(693134, 'Dune: Part Two')))
    getSimilar.mockResolvedValue(page(title(438631, 'Dune')))
    renderRelated(693134)

    const row = await screen.findByRole('region', { name: 'Similar titles' })
    expect(within(row).getAllByRole('link').map((link) => link.getAttribute('href'))).toEqual(['/title/movie/438631'])
  })

  it('shows nothing when both lists are empty', async () => {
    const { container } = renderRelated()
    // Both answers are in and applied, so this checks the empty lists, not the loading state.
    await answered()
    expect(getSimilar).toHaveBeenCalled()
    expect(container).toBeEmptyDOMElement()
  })

  it('shows nothing when TMDB fails, since the page works without it', async () => {
    getRecommendations.mockRejectedValue(new TypeError('Failed to fetch'))
    const { container } = renderRelated()
    // The failure is in and applied, so this checks the error state, not the loading state.
    await answered()
    expect(container).toBeEmptyDOMElement()
    // A call count is the only way to see that no fallback request goes out after a failure.
    expect(getSimilar).not.toHaveBeenCalled()
  })

  describe('what goes under the row', () => {
    const renderWithAfter = () => renderWithRouter(<TitleRelated type="movie" id={693134} language="en-US" after={<p>Under the row</p>} />)

    it('waits for the row while it loads, then shows under it', async () => {
      let answer!: (titles: tmdb.TitlePage) => void
      getRecommendations.mockReturnValue(new Promise((resolve) => (answer = resolve)))
      renderWithAfter()
      expect(screen.queryByText('Under the row')).not.toBeInTheDocument()

      await act(async () => answer(page(title(438631, 'Dune'))))
      const row = screen.getByRole('region', { name: 'Recommendations' })
      const under = screen.getByText('Under the row')
      expect(row.compareDocumentPosition(under) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
    })

    it('shows alone when both lists are empty', async () => {
      renderWithAfter()
      await answered()
      expect(screen.getByText('Under the row')).toBeInTheDocument()
      expect(screen.queryByRole('region')).not.toBeInTheDocument()
    })

    it('shows alone when TMDB fails', async () => {
      getRecommendations.mockRejectedValue(new TypeError('Failed to fetch'))
      renderWithAfter()
      await answered()
      expect(screen.getByText('Under the row')).toBeInTheDocument()
      expect(screen.queryByRole('region')).not.toBeInTheDocument()
    })
  })
})
