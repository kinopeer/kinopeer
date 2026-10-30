import { act, render, renderHook, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { Torrent } from '../api/qbittorrent'
import * as tmdb from '../api/tmdb'
import { ToastProvider } from '../components/Toast'
import { title, torrent } from '../test/fixtures'
import { saying } from '../test/render'
import * as titleMatches from '../torrents/titleMatches'
import type { TitleMatch } from '../torrents/titleMatches'
import { TorrentRequestsProvider } from '../torrents/TorrentRequestsProvider'
import type { ActionWatcher } from './useTorrentAction'
import { useChangeTitle, useConfirmTitle } from './useTitleChoice'

vi.mock('../api/tmdb', async (importOriginal) => ({
  ...(await importOriginal<typeof tmdb>()),
  searchTitles: vi.fn(),
}))
vi.mock('../torrents/titleMatches', async (importOriginal) => ({
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

/** A screen with its own Change title sheet and "Yes, right", as Downloads and the torrent's details have. */
function Screen({ name }: { name: string }) {
  const retitle = useChangeTitle({ torrents: TORRENTS, matchOf: () => GUESS })
  const confirm = useConfirmTitle()
  return (
    <section aria-label={name}>
      <button type="button" onClick={() => retitle.open('master')}>
        Change title in {name}
      </button>
      <button type="button" disabled={confirm.busy('master')} onClick={() => void confirm.confirm(MASTER, GUESS)}>
        Yes, right in {name}
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
    await userEvent.click(screen.getByRole('button', { name: `Change title in ${name}` }))
    const sheet = within(screen.getByRole('region', { name })).getByRole('dialog', { name: 'Change title' })
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
  vi.mocked(tmdb.searchTitles).mockResolvedValue({ titles: [MOVIE, SERIES], page: 1, totalPages: 1 })
  chooseTitle.mockResolvedValue()
})

describe('useChangeTitle', () => {
  it('saves the picked title as the user’s choice, closes and says it changed', async () => {
    const open = renderScreens()
    await userEvent.click(movieIn(await open('Downloads')))
    expect(chooseTitle).toHaveBeenCalledWith('master', MOVIE, 'en-US')
    expect(await screen.findByRole('status', { name: saying('Title changed') })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('says a match is confirmed when the current title is picked', async () => {
    const open = renderScreens()
    const sheet = await open('Downloads')
    await userEvent.click(within(sheet).getByRole('button', { name: /Series · 2005 Current/ }))
    expect(await screen.findByRole('status', { name: saying('Match confirmed') })).toBeInTheDocument()
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
    // "Yes, right" is the same save.
    expect(screen.getByRole('button', { name: 'Yes, right in Downloads' })).toBeDisabled()
    expect(chooseTitle).toHaveBeenCalledOnce()

    await save.answer()
    expect(screen.getByRole('status', { name: saying('Title changed') })).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
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

describe('useConfirmTitle', () => {
  it('keeps the guessed title as the user’s choice and says so, busy everywhere until it’s saved', async () => {
    const save = pendingSave()
    const { result } = renderHook(() => ({ menu: useConfirmTitle(), details: useConfirmTitle() }), { wrapper: Providers })
    let sent!: Promise<unknown>
    act(() => {
      sent = result.current.menu.confirm(MASTER, GUESS)
    })
    expect(result.current.details.busy('master')).toBe(true)
    await expect(result.current.details.confirm(MASTER, GUESS)).resolves.toBeUndefined()
    expect(chooseTitle).toHaveBeenCalledOnce()
    expect(chooseTitle).toHaveBeenCalledWith('master', GUESS, 'en-US')

    await save.answer()
    await sent
    expect(screen.getByRole('status', { name: saying('Match confirmed') })).toBeInTheDocument()
    expect(result.current.details.busy('master')).toBe(false)
  })

  it('leaves how it went to the place that shows the torrent, else says a failure in a toast', async () => {
    const settled = vi.fn<ActionWatcher['settled']>()
    const watcher: ActionWatcher = { torrents: [MASTER as Torrent], settled }
    const { result } = renderHook(() => ({ menu: useConfirmTitle(watcher), details: useConfirmTitle() }), {
      wrapper: Providers,
    })
    chooseTitle.mockRejectedValueOnce(new Error('500'))
    await act(async () => void (await result.current.details.confirm(MASTER, GUESS)))
    expect(settled).toHaveBeenLastCalledWith({ ok: false, error: expect.any(Error) }, [MASTER])
    expect(screen.queryByRole('status', { name: saying(FAILED) })).not.toBeInTheDocument()

    const { result: alone } = renderHook(() => useConfirmTitle(), { wrapper: Providers })
    chooseTitle.mockRejectedValueOnce(new Error('500'))
    await act(async () => void (await alone.current.confirm(MASTER, GUESS)))
    expect(screen.getByRole('status', { name: saying(FAILED) })).toBeInTheDocument()
  })
})
