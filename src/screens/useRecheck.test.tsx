import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useSyncExternalStore, type ReactNode } from 'react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../api/qbittorrent'
import type { Torrent } from '../api/qbittorrent'
import { ToastProvider } from '../components/Toast'
import { torrent } from '../test/fixtures'
import { saying } from '../test/render'
import { TorrentRequestsProvider } from '../torrents/TorrentRequestsProvider'
import { useTorrentRequests } from '../torrents/useTorrentRequests'
import { useRecheck } from './useRecheck'

vi.mock('../api/qbittorrent', async (importOriginal) => ({
  ...(await importOriginal<typeof api>()),
  recheckTorrents: vi.fn(),
}))
const recheckTorrents = vi.mocked(api.recheckTorrents)

const DUNE = torrent('dune', { name: 'Dune.Part.Two.2024.2160p', state: 'stoppedDL', progress: 0.4, added_on: 1 })
const FAILED = 'Couldn’t reach qBittorrent. Try again.'
const CHECKING = 'Checking the files'

/** A screen with its own recheck confirmation, as Downloads and the torrent's details have. */
function Screen({ name, torrents }: { name: string; torrents: Record<string, Torrent> }) {
  const recheck = useRecheck({ torrents, titleOf: (item) => item.name })
  return (
    <section aria-label={name}>
      <button type="button" onClick={() => recheck.open('dune')}>
        Recheck in {name}
      </button>
      {recheck.element}
    </section>
  )
}

/** The state the requests keep for Dune once qBittorrent took one. */
function Expected() {
  const requests = useTorrentRequests()
  const expected = useSyncExternalStore(requests.subscribe, requests.getExpected)
  return <output aria-label="Expected">{[...expected.values()].map((item) => item.expect(DUNE).state).join()}</output>
}

function Providers({ children }: { children: ReactNode }) {
  return (
    <ToastProvider>
      <TorrentRequestsProvider>{children}</TorrentRequestsProvider>
    </ToastProvider>
  )
}

function renderScreens(torrents: Record<string, Torrent> = { dune: DUNE }) {
  const view = render(
    <>
      <Screen name="Downloads" torrents={torrents} />
      <Screen name="Drawer" torrents={torrents} />
      <Expected />
    </>,
    { wrapper: Providers },
  )
  const open = async (name: string) => {
    await userEvent.click(screen.getByRole('button', { name: `Recheck in ${name}` }))
    return within(screen.getByRole('region', { name })).getByRole('alertdialog', { name: 'Recheck the files?' })
  }
  return { ...view, open }
}

const confirmIn = (dialog: HTMLElement) => userEvent.click(within(dialog).getByRole('button', { name: 'Force recheck' }))

beforeEach(() => {
  vi.resetAllMocks()
})

describe('useRecheck', () => {
  it('asks first, then rechecks, closes, says so and shows the torrent checking once qBittorrent took it', async () => {
    recheckTorrents.mockResolvedValue()
    const { open } = renderScreens()
    const dialog = await open('Downloads')
    expect(dialog).toHaveTextContent('Dune.Part.Two.2024.2160p')
    expect(screen.getByRole('status', { name: 'Expected' })).toHaveTextContent(/^$/)

    await confirmIn(dialog)
    expect(recheckTorrents).toHaveBeenCalledWith(['dune'])
    expect(await screen.findByRole('status', { name: saying(CHECKING) })).toBeInTheDocument()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Expected' })).toHaveTextContent('checkingDL')
  })

  it('shows a recheck sent from one screen busy in another’s confirmation, and doesn’t send it again', async () => {
    let answer = () => {}
    recheckTorrents.mockReturnValue(new Promise((resolve) => (answer = resolve)))
    const { open } = renderScreens()
    const first = await open('Downloads')
    await confirmIn(first)
    await userEvent.click(within(first).getByRole('button', { name: 'Cancel' }))

    const drawer = await open('Drawer')
    const button = within(drawer).getByRole('button', { name: 'Force recheck' })
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('aria-busy', 'true')
    expect(recheckTorrents).toHaveBeenCalledOnce()

    // The confirmation that shows the torrent then closes, wherever the recheck was sent from.
    answer()
    expect(await screen.findByRole('status', { name: saying(CHECKING) })).toBeInTheDocument()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('keeps a failure in the confirmation that shows the torrent, not in a toast as well', async () => {
    recheckTorrents.mockRejectedValue(new TypeError('Failed to fetch'))
    const { open } = renderScreens()
    const dialog = await open('Downloads')
    await confirmIn(dialog)
    expect(await within(dialog).findByRole('alert', { name: saying(FAILED) })).toBeInTheDocument()
    expect(within(dialog).getByRole('button', { name: 'Force recheck' })).toBeEnabled()
    expect(screen.queryByRole('status', { name: saying(FAILED) })).not.toBeInTheDocument()
    expect(screen.getByRole('status', { name: 'Expected' })).toHaveTextContent(/^$/)
  })

  it('says a failure in a toast once its confirmation closed, which the next try takes back', async () => {
    let fail = (_error: unknown) => {}
    recheckTorrents
      .mockReturnValueOnce(new Promise<void>((_resolve, reject) => (fail = reject)))
      .mockReturnValueOnce(new Promise(() => {}))
    const { open } = renderScreens()
    const dialog = await open('Downloads')
    await confirmIn(dialog)
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    fail(new TypeError('Failed to fetch'))
    expect(await screen.findByRole('status', { name: saying(FAILED) })).toBeInTheDocument()

    await confirmIn(await open('Drawer'))
    expect(screen.queryByRole('status', { name: saying(FAILED) })).not.toBeInTheDocument()
  })
})
