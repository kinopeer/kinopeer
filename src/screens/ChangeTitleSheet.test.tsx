import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as matchesApi from '../api/matches'
import * as tmdb from '../api/tmdb'
import type { Title } from '../api/tmdb'
import { resetServerMatches } from '../torrents/serverMatches'
import { clearTitleMatchCache } from '../torrents/titleMatches'
import { ChangeTitleSheet } from './ChangeTitleSheet'

vi.mock('../api/tmdb', async (importOriginal) => ({
  ...(await importOriginal<typeof tmdb>()),
  searchTitles: vi.fn(),
}))

vi.mock('../api/matches', async (importOriginal) => ({
  ...(await importOriginal<typeof matchesApi>()),
  getMatches: vi.fn(),
  saveMatches: vi.fn(),
}))

const searchTitles = vi.mocked(tmdb.searchTitles)
const saveMatches = vi.mocked(matchesApi.saveMatches)

function title(type: Title['type'], id: number, name: string, year?: number, originalTitle = name): Title {
  return { type, id, title: name, originalTitle, year, overview: '', posterPath: null, backdropPath: null, rating: 7 }
}

const MASTER_SERIES = title('tv', 94605, 'Мастер и Маргарита', 2005)
const MASTER_MOVIE = title('movie', 801688, 'Мастер и Маргарита', 2024, 'The Master and Margarita')
const TORRENT = { hash: 'a'.repeat(40), name: 'Master.i.Margarita.2005.S01.1080p.WEB-DL' }

function renderSheet(current: Parameters<typeof ChangeTitleSheet>[0]['current'] = null) {
  const onChosen = vi.fn()
  const onClose = vi.fn()
  render(<ChangeTitleSheet torrent={TORRENT} current={current} onClose={onClose} onChosen={onChosen} />)
  return { onChosen, onClose }
}

beforeEach(() => {
  vi.resetAllMocks()
  clearTitleMatchCache()
  resetServerMatches()
  searchTitles.mockResolvedValue({ titles: [MASTER_MOVIE, MASTER_SERIES], page: 1, totalPages: 1 })
  saveMatches.mockImplementation(async (changes) => changes as matchesApi.Matches)
})

describe('ChangeTitleSheet', () => {
  it('searches TMDB for the name guessed from the release, the current title first', async () => {
    renderSheet({ type: 'tv', id: 94605, title: 'Мастер и Маргарита', year: 2005, posterPath: null })
    expect(screen.getByRole('heading', { name: 'Change title' })).toBeInTheDocument()
    expect(screen.getByText(TORRENT.name)).toBeInTheDocument()
    expect(screen.getByRole('searchbox', { name: 'Search TMDB' })).toHaveValue('Master i Margarita')

    const rows = await screen.findAllByRole('button', { name: /Мастер и Маргарита/ })
    expect(searchTitles).toHaveBeenCalledWith('Master i Margarita', expect.objectContaining({ language: 'en-US' }))
    expect(rows[0]).toHaveAttribute('aria-current', 'true')
    expect(rows[0]).toHaveAccessibleName('Мастер и Маргарита Series · 2005 Current')
    expect(rows[0]).toHaveTextContent('Current')
    expect(rows[1]).not.toHaveAttribute('aria-current')
    expect(rows[1]).toHaveTextContent('Movie · 2024 · The Master and Margarita')
    expect(screen.getByText('Your choice is saved on the Kinoseed server and shows on every device.')).toBeInTheDocument()
  })

  it('narrows the results to movies or series', async () => {
    renderSheet()
    expect(screen.getByRole('heading', { name: 'Pick title' })).toBeInTheDocument()
    await screen.findAllByRole('button', { name: /Мастер и Маргарита/ })
    await userEvent.click(screen.getByRole('radio', { name: 'Movies' }))
    const rows = screen.getAllByRole('button', { name: /Мастер и Маргарита/ })
    expect(rows).toHaveLength(1)
    expect(rows[0]).toHaveTextContent('Movie · 2024')
  })

  it('saves the picked title as the user’s choice', async () => {
    const { onChosen } = renderSheet({ type: 'tv', id: 94605, title: 'Мастер и Маргарита', year: 2005, posterPath: null })
    await userEvent.click((await screen.findAllByRole('button', { name: /Мастер и Маргарита/ }))[1])
    expect(saveMatches).toHaveBeenCalledWith({ [TORRENT.hash]: { type: 'movie', id: 801688, source: 'user' } })
    expect(onChosen).toHaveBeenCalledWith('changed')
  })

  it('confirms the current title when it is picked', async () => {
    const { onChosen } = renderSheet({ type: 'tv', id: 94605, title: 'Мастер и Маргарита', year: 2005, posterPath: null })
    await userEvent.click((await screen.findAllByRole('button', { name: /Мастер и Маргарита/ }))[0])
    expect(saveMatches).toHaveBeenCalledWith({ [TORRENT.hash]: { type: 'tv', id: 94605, source: 'user' } })
    expect(onChosen).toHaveBeenCalledWith('confirmed')
  })

  it('says when the choice couldn’t be saved and lets the user try again', async () => {
    saveMatches.mockRejectedValueOnce(new matchesApi.MatchesError(500))
    const { onChosen } = renderSheet()
    const row = (await screen.findAllByRole('button', { name: /Мастер и Маргарита/ }))[0]
    await userEvent.click(row)
    expect(await screen.findByText('Couldn’t save the choice. Try again.')).toBeInTheDocument()
    expect(onChosen).not.toHaveBeenCalled()
    expect(row).toBeEnabled()
    await userEvent.click(row)
    await waitFor(() => expect(onChosen).toHaveBeenCalledWith('changed'))
  })

  it('searches again as the user types, and says when nothing is found', async () => {
    searchTitles.mockResolvedValue({ titles: [], page: 1, totalPages: 1 })
    renderSheet()
    const field = screen.getByRole('searchbox', { name: 'Search TMDB' })
    await userEvent.click(screen.getByRole('button', { name: 'Clear' }))
    expect(field).toHaveValue('')
    await userEvent.type(field, 'Nonexistent')
    expect(await screen.findByText('Nothing found')).toBeInTheDocument()
    expect(searchTitles).toHaveBeenLastCalledWith('Nonexistent', expect.anything())
  })

  it('offers a retry when TMDB doesn’t answer', async () => {
    searchTitles.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    renderSheet()
    const retry = await screen.findByRole('button', { name: 'Try again' })
    await userEvent.click(retry)
    expect(await screen.findAllByRole('button', { name: /Мастер и Маргарита/ })).toHaveLength(2)
  })

  it('closes from its close button', async () => {
    const { onClose } = renderSheet()
    const dialog = screen.getByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(onClose).toHaveBeenCalled()
  })
})
