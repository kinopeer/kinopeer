import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useEffect, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../api/qbittorrent'
import type { SaveLocations, Torrent } from '../api/qbittorrent'
import { ToastProvider } from '../components/Toast'
import { findToastOnPage, saying } from '../test/render'
import { torrent } from '../test/fixtures'
import { REQUEST_KINDS } from '../torrents/requestKinds'
import { TorrentRequestsProvider } from '../torrents/TorrentRequestsProvider'
import { requestKey, type TorrentRequests } from '../torrents/torrentRequests'
import { useTorrentRequests } from '../torrents/useTorrentRequests'
import { useChangeCategory } from './useChangeCategory'

vi.mock('../api/qbittorrent', async (importOriginal) => ({
  ...(await importOriginal<typeof api>()),
  getSaveLocations: vi.fn(),
  setCategory: vi.fn(),
}))

const getSaveLocations = vi.mocked(api.getSaveLocations)
const setCategory = vi.mocked(api.setCategory)

const LOCATIONS: SaveLocations = {
  defaultPath: '/downloads',
  categories: [
    { name: 'Movies', savePath: '/downloads/movies' },
    { name: 'TV Shows', savePath: '/downloads/tv' },
  ],
  categoryPaths: true,
  subcategories: false,
  relocateOnCategoryChange: true,
  downloadPath: false,
}
const DUNE = torrent('dune', { name: 'Dune.Part.Two', category: 'Movies', save_path: '/downloads/movies', auto_tmm: true, added_on: 1 })
const ANDOR = torrent('andor', { name: 'Andor.S02', category: 'TV Shows', save_path: '/downloads/tv', auto_tmm: true, added_on: 1 })
const FAILED = 'Couldn’t reach qBittorrent. Try again.'

let requests: TorrentRequests | undefined

function Harness({ torrents = { dune: DUNE }, offline = false }: { torrents?: Record<string, Torrent>; offline?: boolean }) {
  const category = useChangeCategory({ torrents, offline })
  const store = useTorrentRequests()
  useEffect(() => {
    requests = store
  })
  return (
    <section aria-label="Screen">
      {Object.keys(torrents).map((hash) => (
        <div key={hash}>
          {/* Opens the sheet whatever is in flight, as another screen's would. */}
          <button type="button" onClick={() => category.open(hash)}>
            Open {hash}
          </button>
          {/* The page's Category row, off while a change is in flight. */}
          <button type="button" disabled={category.busy(hash)}>
            Row {hash}
          </button>
        </div>
      ))}
      {category.element}
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

function renderCategory(props: { torrents?: Record<string, Torrent>; offline?: boolean } = {}) {
  const view = render(<Harness {...props} />, { wrapper: Providers })
  const open = async (hash = 'dune') => {
    await userEvent.click(screen.getByRole('button', { name: `Open ${hash}` }))
    return screen.getByRole('dialog', { name: 'Category' })
  }
  const pick = async (sheet: HTMLElement, name: string) => {
    await userEvent.click(await within(sheet).findByRole('radio', { name }))
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }))
  }
  const rerender = (next: { torrents?: Record<string, Torrent>; offline?: boolean }) => view.rerender(<Harness {...props} {...next} />)
  return { open, pick, rerender }
}

/** A setCategory that answers when told. */
function held() {
  const answers: { resolve: () => void; reject: (error: unknown) => void }[] = []
  setCategory.mockImplementation(() => new Promise<void>((resolve, reject) => void answers.push({ resolve, reject })))
  return answers
}

beforeEach(() => {
  vi.resetAllMocks()
  getSaveLocations.mockResolvedValue(LOCATIONS)
  setCategory.mockResolvedValue()
})

describe('useChangeCategory', () => {
  it('sets the picked category, closes, and names the folder the files move to', async () => {
    const { open, pick } = renderCategory()
    await pick(await open(), 'TV Shows')
    expect(setCategory).toHaveBeenCalledWith(['dune'], 'TV Shows')
    expect(await findToastOnPage('Moving files to /downloads/tv')).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Category' })).not.toBeInTheDocument()
  })

  it('says only that the category changed when the files stay', async () => {
    const { open, pick } = renderCategory({ torrents: { dune: { ...DUNE, auto_tmm: false } } })
    await pick(await open(), 'TV Shows')
    expect(await findToastOnPage('Category changed')).toBeInTheDocument()
  })

  it('shows the new category and folder until a poll has them', async () => {
    const { open, pick } = renderCategory()
    await pick(await open(), 'TV Shows')
    await findToastOnPage('Moving files to /downloads/tv')
    const expected = requests?.getExpected().get(requestKey(REQUEST_KINDS.category, 'dune'))
    expect(expected?.expect(DUNE)).toEqual({ ...DUNE, category: 'TV Shows', save_path: '/downloads/tv' })
  })

  it('keeps the sheet open with the failure, which the next try takes back', async () => {
    const answers = held()
    const { open, pick } = renderCategory()
    const sheet = await open()
    await pick(sheet, 'TV Shows')
    answers[0].reject(new TypeError('Failed to fetch'))
    expect(await within(sheet).findByRole('alert', { name: saying(FAILED) })).toBeInTheDocument()
    expect(screen.queryByRole('status', { name: saying(FAILED) })).not.toBeInTheDocument()

    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }))
    expect(within(sheet).queryByRole('alert', { name: saying(FAILED) })).not.toBeInTheDocument()
  })

  it('says in a toast when a change fails after its sheet was closed', async () => {
    const answers = held()
    const { open, pick } = renderCategory()
    const sheet = await open()
    await pick(sheet, 'TV Shows')
    await userEvent.click(within(sheet).getByRole('button', { name: 'Cancel' }))
    answers[0].reject(new TypeError('Failed to fetch'))
    expect(await screen.findByRole('status', { name: saying(FAILED) })).toBeInTheDocument()
  })

  it('says in a toast when a change fails after its torrent went away', async () => {
    const answers = held()
    const { open, pick, rerender } = renderCategory()
    await pick(await open(), 'TV Shows')
    rerender({ torrents: {} })
    expect(screen.queryByRole('dialog', { name: 'Category' })).not.toBeInTheDocument()
    answers[0].reject(new TypeError('Failed to fetch'))
    expect(await screen.findByRole('status', { name: saying(FAILED) })).toBeInTheDocument()
  })

  it('sends the category once, however often Save is pressed while it’s being sent', async () => {
    held()
    const { open, pick } = renderCategory()
    const sheet = await open()
    await pick(sheet, 'TV Shows')
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }))
    expect(within(sheet).getByRole('button', { name: 'Save' })).toBeDisabled()
    // Each would move the files again.
    expect(setCategory).toHaveBeenCalledOnce()
  })

  it('says the torrent busy while its change is in flight, and not once it settles', async () => {
    const answers = held()
    const { open, pick } = renderCategory()
    const sheet = await open()
    await pick(sheet, 'TV Shows')
    await userEvent.click(within(sheet).getByRole('button', { name: 'Cancel' }))
    expect(screen.getByRole('button', { name: 'Row dune' })).toBeDisabled()

    answers[0].resolve()
    expect(await findToastOnPage('Moving files to /downloads/tv')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Row dune' })).toBeEnabled()
  })

  it('keeps a torrent’s change busy when another torrent’s earlier change settles', async () => {
    const answers = held()
    const { open, pick } = renderCategory({ torrents: { dune: DUNE, andor: ANDOR } })
    const dune = await open('dune')
    await pick(dune, 'TV Shows')
    await userEvent.click(within(dune).getByRole('button', { name: 'Cancel' }))
    const andor = await open('andor')
    await pick(andor, 'Movies')
    answers[0].resolve()
    expect(await screen.findByRole('status', { name: saying('Moving files to /downloads/tv') })).toBeInTheDocument()
    // A second tap would send andor's change again.
    expect(within(andor).getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Row andor', hidden: true })).toBeDisabled()
  })

  it('keeps a torrent’s change busy after another torrent’s change started, so it isn’t sent twice', async () => {
    held()
    const { open, pick } = renderCategory({ torrents: { dune: DUNE, andor: ANDOR } })
    const dune = await open('dune')
    await pick(dune, 'TV Shows')
    await userEvent.click(within(dune).getByRole('button', { name: 'Cancel' }))
    const andor = await open('andor')
    await pick(andor, 'Movies')
    await userEvent.click(within(andor).getByRole('button', { name: 'Cancel' }))
    const again = await open('dune')
    // At the category being sent, not the torrent's: Save is off only because dune's change is in flight.
    expect(await within(again).findByRole('radio', { name: 'TV Shows' })).toBeChecked()
    expect(within(again).getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(setCategory).toHaveBeenCalledTimes(2)
  })

  it('shows a change from a closed sheet in the one opened again for the same torrent, and closes that once sent', async () => {
    const answers = held()
    const { open, pick } = renderCategory()
    const first = await open()
    await pick(first, 'TV Shows')
    await userEvent.click(within(first).getByRole('button', { name: 'Cancel' }))
    const again = await open()
    expect(await within(again).findByRole('radio', { name: 'TV Shows' })).toBeChecked()
    expect(within(again).getByRole('button', { name: 'Save' })).toBeDisabled()
    answers[0].resolve()
    expect(await findToastOnPage('Moving files to /downloads/tv')).toBeInTheDocument()
    expect(screen.queryByRole('dialog', { name: 'Category' })).not.toBeInTheDocument()
  })

  it('says in the sheet opened again for the same torrent that the change from the closed one failed', async () => {
    const answers = held()
    const { open, pick } = renderCategory()
    const first = await open()
    await pick(first, 'TV Shows')
    await userEvent.click(within(first).getByRole('button', { name: 'Cancel' }))
    const again = await open()
    answers[0].reject(new TypeError('Failed to fetch'))
    expect(await within(again).findByRole('alert', { name: saying(FAILED) })).toBeInTheDocument()
    expect(screen.queryByRole('status', { name: saying(FAILED) })).not.toBeInTheDocument()
    // A retry sends the category that failed, which the sheet opened again started from.
    await userEvent.click(within(again).getByRole('button', { name: 'Save' }))
    expect(setCategory).toHaveBeenLastCalledWith(['dune'], 'TV Shows')
    expect(setCategory).toHaveBeenCalledTimes(2)
  })

  it('starts a sheet opened on another screen mid-change from the category being sent, which can’t be changed meanwhile', async () => {
    held()
    function TwoScreens() {
      const page = useChangeCategory({ torrents: { dune: DUNE }, offline: false })
      const drawer = useChangeCategory({ torrents: { dune: DUNE, andor: ANDOR }, offline: false })
      return (
        <>
          <button type="button" onClick={() => page.open('dune')}>
            Page
          </button>
          <button type="button" onClick={() => drawer.open('dune')}>
            Drawer
          </button>
          {page.element}
          {drawer.element}
        </>
      )
    }
    render(<TwoScreens />, { wrapper: Providers })
    await userEvent.click(screen.getByRole('button', { name: 'Page' }))
    const sheet = screen.getByRole('dialog', { name: 'Category' })
    await userEvent.click(await within(sheet).findByRole('radio', { name: 'TV Shows' }))
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save' }))
    await userEvent.click(within(sheet).getByRole('button', { name: 'Cancel' }))

    await userEvent.click(screen.getByRole('button', { name: 'Drawer' }))
    const again = screen.getByRole('dialog', { name: 'Category' })
    expect(await within(again).findByRole('radio', { name: 'TV Shows' })).toBeChecked()
    expect(within(again).getByRole('radio', { name: 'TV Shows' })).toBeDisabled()
    expect(within(again).getByRole('button', { name: 'Save' })).toBeDisabled()
    expect(setCategory).toHaveBeenCalledOnce()
  })

  it('can’t save while qBittorrent is unreachable', async () => {
    const { open } = renderCategory({ offline: true })
    const sheet = await open()
    await userEvent.click(await within(sheet).findByRole('radio', { name: 'TV Shows' }))
    expect(within(sheet).getByRole('button', { name: 'Save' })).toBeDisabled()
  })
})
