import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as tmdb from '../api/tmdb'
import { title } from '../test/fixtures'
import { ChangeTitleSheet, type ChangeTitleSheetProps } from './ChangeTitleSheet'
import { saying } from '../test/render'

vi.mock('../api/tmdb', async (importOriginal) => ({
  ...(await importOriginal<typeof tmdb>()),
  searchTitles: vi.fn(),
}))

const searchTitles = vi.mocked(tmdb.searchTitles)

const MASTER_SERIES = title('tv', 94605, 'Мастер и Маргарита', 2005, { posterPath: null })
const MASTER_MOVIE = title('movie', 801688, 'Мастер и Маргарита', 2024, { originalTitle: 'The Master and Margarita', posterPath: null })
const TORRENT = { hash: 'a'.repeat(40), name: 'Master.i.Margarita.2005.S01.1080p.WEB-DL' }

const SERIES_MATCH = { type: 'tv' as const, id: 94605, title: 'Мастер и Маргарита', year: 2005, posterPath: null }

function renderSheet(current: ChangeTitleSheetProps['current'] = null, props: Partial<ChangeTitleSheetProps> = {}) {
  const handlers = { onPick: vi.fn(), onClose: vi.fn() }
  render(<ChangeTitleSheet torrent={TORRENT} current={current} failed={false} {...handlers} {...props} />)
  return handlers
}

beforeEach(() => {
  vi.resetAllMocks()
  searchTitles.mockResolvedValue({ titles: [MASTER_MOVIE, MASTER_SERIES], page: 1, totalPages: 1 })
})

describe('ChangeTitleSheet', () => {
  it('searches TMDB for the name guessed from the release, the current title first', async () => {
    renderSheet({ type: 'tv', id: 94605, title: 'Мастер и Маргарита', year: 2005, posterPath: null })
    expect(screen.getByRole('dialog', { name: 'Change title' })).toBeInTheDocument()
    expect(screen.getByText(TORRENT.name)).toBeInTheDocument()
    expect(screen.getByRole('searchbox', { name: 'Search TMDB' })).toHaveValue('Master i Margarita')

    const rows = await screen.findAllByRole('button', { name: /Мастер и Маргарита/ })
    expect(searchTitles).toHaveBeenCalledWith('Master i Margarita', { language: 'en-US', signal: expect.any(AbortSignal) })
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

  it('picks a title', async () => {
    const { onPick } = renderSheet(SERIES_MATCH)
    await userEvent.click(await screen.findByRole('button', { name: /Movie · 2024/ }))
    expect(onPick).toHaveBeenCalledWith(MASTER_MOVIE)
  })

  it('shows the title being saved busy, and every pick off meanwhile', async () => {
    const { onPick } = renderSheet(SERIES_MATCH, { saving: { type: 'movie', id: 801688 } })
    const movie = await screen.findByRole('button', { name: /Movie · 2024/ })
    const series = screen.getByRole('button', { name: /Series · 2005/ })
    expect(movie).toHaveAttribute('aria-busy', 'true')
    expect(movie).toBeDisabled()
    expect(series).not.toHaveAttribute('aria-busy')
    expect(series).toBeDisabled()
    await userEvent.click(series)
    expect(onPick).not.toHaveBeenCalled()
  })

  it('says when the choice couldn’t be saved, and can be picked again', async () => {
    renderSheet(null, { failed: true })
    expect(screen.getByRole('alert', { name: saying('Couldn’t save the choice. Try again.') })).toBeInTheDocument()
    expect(await screen.findByRole('button', { name: /Movie · 2024/ })).toBeEnabled()
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
