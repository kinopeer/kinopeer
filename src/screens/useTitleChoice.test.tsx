import { act, fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { QbittorrentError } from '../api/qbittorrent'
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
    await userEvent.click(within(first).getByRole('button', { name: 'Close' }))

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
    await userEvent.click(within(sheet).getByRole('button', { name: 'Close' }))
    await save.fail()
    expect(screen.getByRole('status', { name: saying(FAILED) })).toBeInTheDocument()

    pendingSave()
    await userEvent.click(movieIn(await open('Drawer')))
    expect(screen.queryByRole('status', { name: saying(FAILED) })).not.toBeInTheDocument()
  })
})

describe('useChangeTitle in the WebUI build', () => {
  const STORE_FULL = 'Couldn’t save the choice. qBittorrent’s store for web interfaces is full: it holds 1 MiB for all of them. Another interface used with this qBittorrent may have filled it.'
  const storeFull = () => new QbittorrentError('qBittorrent responded 409', 409)

  it('says qBittorrent’s store had no room for the choice in the sheet that shows the torrent', async () => {
    vi.stubGlobal('__WEBUI__', true)
    chooseTitle.mockRejectedValueOnce(storeFull())
    const sheet = await renderScreens()('Downloads')
    await userEvent.click(movieIn(sheet))
    expect(await within(sheet).findByRole('alert', { name: saying(STORE_FULL) })).toBeInTheDocument()
  })

  it('says it in a toast once its sheet closed', async () => {
    vi.stubGlobal('__WEBUI__', true)
    let fail = () => {}
    chooseTitle.mockImplementationOnce(() => new Promise((_resolve, reject) => (fail = () => reject(storeFull()))))
    const sheet = await renderScreens()('Downloads')
    await userEvent.click(movieIn(sheet))
    await userEvent.click(within(sheet).getByRole('button', { name: 'Close' }))
    await act(async () => fail())
    expect(screen.getByRole('status', { name: saying(STORE_FULL) })).toBeInTheDocument()
  })

  it('says any other failure as the server build does', async () => {
    vi.stubGlobal('__WEBUI__', true)
    let fail = () => {}
    chooseTitle.mockImplementationOnce(() => new Promise((_resolve, reject) => (fail = () => reject(new QbittorrentError('qBittorrent responded 502', 502)))))
    const open = renderScreens()
    const sheet = await open('Downloads')
    await userEvent.click(movieIn(sheet))
    await act(async () => fail())
    expect(within(sheet).getByRole('alert', { name: saying(FAILED) })).toBeInTheDocument()
    await userEvent.click(within(sheet).getByRole('button', { name: 'Close' }))
    chooseTitle.mockImplementationOnce(() => new Promise((_resolve, reject) => (fail = () => reject(new QbittorrentError('qBittorrent responded 502', 502)))))
    const again = await open('Drawer')
    await userEvent.click(movieIn(again))
    await userEvent.click(within(again).getByRole('button', { name: 'Close' }))
    await act(async () => fail())
    expect(screen.getByRole('status', { name: saying(FAILED) })).toBeInTheDocument()
  })
})
