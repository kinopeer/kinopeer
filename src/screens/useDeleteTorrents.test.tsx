import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useSyncExternalStore, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../api/qbittorrent'
import type { Torrent } from '../api/qbittorrent'
import { ToastProvider } from '../components/Toast'
import { torrent } from '../test/fixtures'
import { saying } from '../test/render'
import * as serverMatches from '../torrents/serverMatches'
import { TorrentRequestsProvider } from '../torrents/TorrentRequestsProvider'
import { useTorrentRequests } from '../torrents/useTorrentRequests'
import { useDeleteTorrents } from './useDeleteTorrents'

vi.mock('../api/qbittorrent', async (importOriginal) => ({
  ...(await importOriginal<typeof api>()),
  deleteTorrents: vi.fn(),
}))
vi.mock('../torrents/serverMatches', async (importOriginal) => ({
  ...(await importOriginal<typeof serverMatches>()),
  forgetMatches: vi.fn(),
}))
const deleteTorrents = vi.mocked(api.deleteTorrents)
const forgetMatches = vi.mocked(serverMatches.forgetMatches)

const DUNE = torrent('dune', { name: 'Dune.Part.Two.2024.2160p', added_on: 1 })
const ALIEN = torrent('alien', { name: 'Alien.1979.1080p', added_on: 2 })
const TORRENTS = { dune: DUNE, alien: ALIEN }
const FAILED = 'Couldn’t reach qBittorrent. Try again.'

/** A screen with its own delete confirmation, for the torrents its button names. */
function Screen({ name, targets, onDeleted }: { name: string; targets: Torrent[]; onDeleted?: () => void }) {
  const remove = useDeleteTorrents({ torrents: TORRENTS, titleOf: (item) => item.name, onDeleted })
  return (
    <section aria-label={name}>
      <button type="button" onClick={() => remove.open(targets)}>
        Delete in {name}
      </button>
      {remove.element}
    </section>
  )
}

/** The torrents the requests expect gone once qBittorrent took a delete. */
function Expected() {
  const requests = useTorrentRequests()
  const expected = useSyncExternalStore(requests.subscribe, requests.getExpected)
  const gone = [...expected.values()].filter((item) => item.expect(TORRENTS[item.hash as keyof typeof TORRENTS]) === undefined)
  return <output aria-label="Gone">{gone.map((item) => item.hash).join()}</output>
}

function Providers({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <TorrentRequestsProvider>{children}</TorrentRequestsProvider>
    </ToastProvider>
  )
}

function renderScreens({ onDeleted = vi.fn(), downloads = true } = {}) {
  const screens = (shown: boolean) => (
    <>
      {shown && <Screen name="Downloads" targets={[DUNE]} onDeleted={onDeleted} />}
      <Screen name="Selection" targets={[DUNE, ALIEN]} />
      <Expected />
    </>
  )
  const view = render(screens(downloads), { wrapper: Providers })
  const open = async (name: string) => {
    await userEvent.click(screen.getByRole('button', { name: `Delete in ${name}` }))
    return within(screen.getByRole('region', { name })).getByRole('alertdialog')
  }
  return { open, onDeleted, leaveDownloads: () => view.rerender(screens(false)) }
}

const confirmIn = (dialog: HTMLElement) => userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))

beforeEach(() => {
  vi.resetAllMocks()
  forgetMatches.mockResolvedValue()
})

describe('useDeleteTorrents', () => {
  it('deletes the torrents asked, closes, says so, forgets their titles and takes them away once qBittorrent did', async () => {
    deleteTorrents.mockResolvedValue()
    const { open } = renderScreens()
    const dialog = await open('Selection')
    expect(dialog).toHaveAccessibleName('Delete torrents?')
    await userEvent.click(within(dialog).getByRole('checkbox', { name: /Also delete files/ }))
    expect(screen.getByRole('status', { name: 'Gone' })).toHaveTextContent(/^$/)

    await confirmIn(dialog)
    expect(deleteTorrents).toHaveBeenCalledWith(['dune', 'alien'], true)
    expect(await screen.findByRole('status', { name: saying('2 torrents and their files deleted') })).toBeInTheDocument()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(forgetMatches).toHaveBeenCalledWith(['dune', 'alien'])
    expect(screen.getByRole('status', { name: 'Gone' })).toHaveTextContent('dune,alien')
  })

  it('only says so, without telling the screen, once the screen that sent it is gone', async () => {
    let answer = () => {}
    deleteTorrents.mockReturnValueOnce(new Promise((resolve) => (answer = resolve))).mockResolvedValueOnce()
    const { open, onDeleted, leaveDownloads } = renderScreens()
    await confirmIn(await open('Downloads'))
    leaveDownloads()
    answer()
    expect(await screen.findByRole('status', { name: saying('Torrent deleted') })).toBeInTheDocument()
    expect(onDeleted).not.toHaveBeenCalled()
  })

  it('tells the screen that sent it after its confirmation was closed', async () => {
    let answer = () => {}
    deleteTorrents.mockReturnValue(new Promise((resolve) => (answer = resolve)))
    const { open, onDeleted } = renderScreens()
    const dialog = await open('Downloads')
    await confirmIn(dialog)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    answer()
    expect(await screen.findByRole('status', { name: saying('Torrent deleted') })).toBeInTheDocument()
    expect(onDeleted).toHaveBeenCalledOnce()
  })

  it('shows a delete sent from one place busy in another’s confirmation of it, and doesn’t send it again', async () => {
    let answer = () => {}
    deleteTorrents.mockReturnValue(new Promise((resolve) => (answer = resolve)))
    const { open } = renderScreens()
    const first = await open('Downloads')
    await confirmIn(first)
    await userEvent.click(within(first).getByRole('button', { name: 'Cancel' }))

    // The selection has Dune too.
    const selection = await open('Selection')
    const button = within(selection).getByRole('button', { name: 'Delete' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
    expect(deleteTorrents).toHaveBeenCalledOnce()

    // Then the confirmation keeps only what's left, wherever the delete was sent from.
    answer()
    expect(await screen.findByRole('status', { name: saying('Torrent deleted') })).toBeInTheDocument()
    expect(selection).toBeInTheDocument()
    expect(selection).toHaveAccessibleName('Delete torrent?')
    expect(selection).toHaveTextContent('“Alien.1979.1080p” will be removed from qBittorrent.')
    expect(within(selection).getByRole('button', { name: 'Delete' })).toBeEnabled()
  })

  it('closes a confirmation once a delete sent from elsewhere took all it shows', async () => {
    let answer = () => {}
    deleteTorrents.mockReturnValue(new Promise((resolve) => (answer = resolve)))
    const { open } = renderScreens()
    const selection = await open('Selection')
    await confirmIn(selection)
    await userEvent.click(within(selection).getByRole('button', { name: 'Cancel' }))
    await open('Downloads')
    answer()
    expect(await screen.findByRole('status', { name: saying('2 torrents deleted') })).toBeInTheDocument()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('keeps a failure in the confirmation that shows the torrents, not in a toast as well, until it’s tried again', async () => {
    deleteTorrents.mockRejectedValueOnce(new TypeError('Failed to fetch')).mockReturnValueOnce(new Promise(() => {}))
    const { open } = renderScreens()
    const dialog = await open('Selection')
    await confirmIn(dialog)
    expect(await within(dialog).findByRole('alert', { name: saying(FAILED) })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Delete' })).toBeEnabled()
    expect(screen.queryByRole('status', { name: saying(FAILED) })).not.toBeInTheDocument()
    expect(forgetMatches).not.toHaveBeenCalled()
    expect(screen.getByRole('status', { name: 'Gone' })).toHaveTextContent(/^$/)

    await confirmIn(dialog)
    expect(within(dialog).queryByRole('alert')).not.toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Delete' })).toHaveAttribute('aria-busy', 'true')
  })

  it('says a failure in a toast once its confirmation closed, which the next try takes back', async () => {
    let fail = (_error: unknown) => {}
    deleteTorrents
      .mockReturnValueOnce(new Promise<void>((_resolve, reject) => (fail = reject)))
      .mockReturnValueOnce(new Promise(() => {}))
    const { open, onDeleted } = renderScreens()
    const dialog = await open('Downloads')
    await confirmIn(dialog)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    fail(new TypeError('Failed to fetch'))
    expect(await screen.findByRole('status', { name: saying(FAILED) })).toBeInTheDocument()
    expect(onDeleted).not.toHaveBeenCalled()

    await confirmIn(await open('Selection'))
    expect(screen.queryByRole('status', { name: saying(FAILED) })).not.toBeInTheDocument()
  })
})
