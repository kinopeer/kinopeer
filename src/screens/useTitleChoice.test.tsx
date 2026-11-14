import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as tmdb from '../api/tmdb'
import { ToastProvider } from '../components/Toast'
import { searchPage, title, torrent } from '../test/fixtures'
import { findToastOnPage, saying } from '../test/render'
import type { TitleMatch } from '../torrents/titleLookup'
import { TorrentRequestsProvider } from '../torrents/TorrentRequestsProvider'
import * as titleMatches from '../torrents/useTitleMatches'
import { useChangeTitle } from './useTitleChoice'

vi.mock('../api/tmdb', async (importOriginal) => ({
  ...(await importOriginal<typeof tmdb>()),
  searchTitles: vi.fn(),
}))
vi.mock('../torrents/useTitleMatches', async (importOriginal) => ({
  ...(await importOriginal<typeof titleMatches>()),
  chooseTitle: vi.fn(),
}))
const chooseTitle = vi.mocked(titleMatches.chooseTitle)

const SERIES = title('tv', 94605, 'Мастер и Маргарита', 2005, { posterPath: null })
const MOVIE = title('movie', 801688, 'Мастер и Маргарита', 2024, { originalTitle: 'The Master and Margarita', posterPath: null })
const GUESS: TitleMatch = { type: 'tv', id: 94605, title: 'Мастер и Маргарита', year: 2005, posterPath: null }
const MASTER = torrent('master', { name: 'Master.i.Margarita.2005.S01.1080p.WEB-DL', added_on: 1 })
const TORRENTS = { master: MASTER }
const FAILED = 'Couldn’t save the choice. Try again.'

/** A screen with its own title search, as Downloads and the torrent's details have. */
function Screen({ name }: { name: string }) {
  const retitle = useChangeTitle({ torrents: TORRENTS, matchOf: () => GUESS })
  return (
    <section aria-label={name}>
      <button type="button" onClick={() => retitle.open('master')}>
        Fix match in {name}
      </button>
      {retitle.element}
    </section>
  )
}

function Providers({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <TorrentRequestsProvider>{children}</TorrentRequestsProvider>
    </ToastProvider>
  )
}

function renderScreens() {
  render(
    <>
      <Screen name="Downloads" />
      <Screen name="Drawer" />
    </>,
    { wrapper: Providers },
  )
  return async (name: string) => {
    await userEvent.click(screen.getByRole('button', { name: `Fix match in ${name}` }))
    const sheet = within(screen.getByRole('region', { name })).getByRole('dialog', { name: 'Title match' })
    await within(sheet).findAllByRole('button', { name: /Мастер и Маргарита/ })
    return sheet
  }
}

/** A save that answers when the test says so. */
function pendingSave() {
  let answer = () => {}
  let fail = () => {}
  chooseTitle.mockImplementationOnce(
    () =>
      new Promise((resolve, reject) => {
        answer = () => resolve()
        fail = () => reject(new Error('500'))
      }),
  )
  return { answer: () => act(async () => answer()), fail: () => act(async () => fail()) }
}

const movieIn = (sheet: HTMLElement) => within(sheet).getByRole('button', { name: /Movie · 2024/ })

beforeEach(() => {
  vi.resetAllMocks()
  vi.mocked(tmdb.searchTitles).mockResolvedValue(searchPage([MOVIE, SERIES]))
  chooseTitle.mockResolvedValue()
})

describe('useChangeTitle', () => {
  it('saves the picked title as the user’s choice, closes and says it’s saved', async () => {
    const open = renderScreens()
    await userEvent.click(movieIn(await open('Downloads')))
    expect(chooseTitle).toHaveBeenCalledWith('master', MOVIE, 'en-US')
    expect(await findToastOnPage('Match saved')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('saves the current title as the user’s choice too, which keeps a guess that was right', async () => {
    const open = renderScreens()
    const sheet = await open('Downloads')
    await userEvent.click(within(sheet).getByRole('button', { name: /Series · 2005 Current/ }))
    expect(chooseTitle).toHaveBeenCalledWith('master', SERIES, 'en-US')
    expect(await findToastOnPage('Match saved')).toBeInTheDocument()
  })

  it('shows a pick sent from one screen busy in another’s sheet, and doesn’t send another', async () => {
    const save = pendingSave()
    const open = renderScreens()
    const first = await open('Downloads')
    await userEvent.click(movieIn(first))
    await userEvent.click(within(first).getByRole('button', { name: 'Cancel' }))

    const drawer = await open('Drawer')
    expect(movieIn(drawer)).toHaveAttribute('aria-busy', 'true')
    for (const row of within(drawer).getAllByRole('button', { name: /Мастер и Маргарита/ })) expect(row).toBeDisabled()
    expect(chooseTitle).toHaveBeenCalledOnce()

    await save.answer()
    expect(screen.getByRole('status', { name: saying('Match saved') })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('sends one save when two screens’ sheets pick at once, and says it once', async () => {
    const save = pendingSave()
    const open = renderScreens()
    const first = await open('Downloads')
    const second = await open('Drawer')
    // In one go, before either sheet shows the other's save: the second pick finds it in flight.
    act(() => {
      fireEvent.click(movieIn(first))
      fireEvent.click(movieIn(second))
    })
    expect(chooseTitle).toHaveBeenCalledOnce()

    await save.answer()
    expect(screen.getAllByRole('status', { name: saying('Match saved') })).toHaveLength(1)
  })

  it('keeps a failure in the sheet that shows the torrent, not in a toast as well, until it’s tried again', async () => {
    const save = pendingSave()
    const open = renderScreens()
    const sheet = await open('Downloads')
    await userEvent.click(movieIn(sheet))
    await save.fail()
    expect(within(sheet).getByRole('alert', { name: saying(FAILED) })).toBeInTheDocument()
    expect(movieIn(sheet)).toBeEnabled()
    expect(screen.queryByRole('status', { name: saying(FAILED) })).not.toBeInTheDocument()

    pendingSave()
    await userEvent.click(movieIn(sheet))
    expect(within(sheet).queryByRole('alert')).not.toBeInTheDocument()
    expect(movieIn(sheet)).toHaveAttribute('aria-busy', 'true')
  })

  it('says a failure in a toast once its sheet closed, which the next try takes back', async () => {
    const save = pendingSave()
    const open = renderScreens()
    const sheet = await open('Downloads')
    await userEvent.click(movieIn(sheet))
    await userEvent.click(within(sheet).getByRole('button', { name: 'Cancel' }))
    await save.fail()
    expect(screen.getByRole('status', { name: saying(FAILED) })).toBeInTheDocument()

    pendingSave()
    await userEvent.click(movieIn(await open('Drawer')))
    expect(screen.queryByRole('status', { name: saying(FAILED) })).not.toBeInTheDocument()
  })
})
