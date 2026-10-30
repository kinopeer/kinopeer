import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../api/qbittorrent'
import type { Torrent } from '../api/qbittorrent'
import { stubDesktop } from '../lib/stubDesktop'
import { renderWithRouter, saying } from '../test/render'
import * as titleMatches from '../torrents/titleMatches'
import { TorrentRequestsProvider } from '../torrents/TorrentRequestsProvider'
import { TorrentActionsSheet, type TorrentActionsSheetProps } from './TorrentActionsSheet'
import { usePauseResume } from './usePauseResume'

vi.mock('../api/qbittorrent', async (importOriginal) => ({
  ...(await importOriginal<typeof api>()),
  stopTorrents: vi.fn(),
  startTorrents: vi.fn(),
  reannounceTorrents: vi.fn(),
  recheckTorrents: vi.fn(),
}))

vi.mock('../torrents/titleMatches', async (importOriginal) => ({
  ...(await importOriginal<typeof titleMatches>()),
  chooseTitle: vi.fn(),
}))

const TORRENT = { hash: 'b1', name: 'Inception.2010.1080p', state: 'stoppedDL', progress: 0.3 } as Torrent
const MATCH: titleMatches.TitleMatch = { type: 'movie', id: 27205, title: 'Inception', year: 2010, posterPath: null }

/** Pauses or resumes the torrent from another place under the same requests, as a row's button does. */
function Elsewhere() {
  const pauseResume = usePauseResume()
  return (
    <button type="button" onClick={() => void pauseResume.toggle(TORRENT)}>
      Resume elsewhere
    </button>
  )
}

function renderActions(props: Partial<TorrentActionsSheetProps> = {}) {
  const anchor = document.createElement('button')
  document.body.append(anchor)
  const handlers = {
    onClose: vi.fn(),
    onDelete: vi.fn(),
    onMove: vi.fn(),
    onRecheck: vi.fn(),
    onSpeedLimits: vi.fn(),
    onReannounced: vi.fn(),
    onChangeTitle: vi.fn(),
    onConfirmed: vi.fn(),
  }
  const { unmount } = renderWithRouter(
    <TorrentRequestsProvider>
      <Elsewhere />
      <TorrentActionsSheet torrent={TORRENT} match={MATCH} offline={false} anchor={anchor} {...handlers} {...props} />
    </TorrentRequestsProvider>,
  )
  return { ...handlers, unmount }
}

beforeEach(() => {
  vi.resetAllMocks()
  stubDesktop()
})

afterEach(() => {
  vi.unstubAllGlobals()
  document.body.innerHTML = ''
})

describe('TorrentActionsSheet on desktop', () => {
  it('leaves the speed limits to the sheet its screen opens, even while a resume is in flight', async () => {
    vi.mocked(api.startTorrents).mockReturnValue(new Promise(() => {}))
    const handlers = renderActions()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Resume' }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Speed limits' }))
    expect(handlers.onSpeedLimits).toHaveBeenCalled()
  })

  it('turns the speed limits off while qBittorrent is unreachable', () => {
    renderActions({ offline: true })
    expect(screen.getByRole('menuitem', { name: 'Speed limits' })).toBeDisabled()
  })

  it('is a menu: resume, reannounce, recheck, speed limits, details, the title page, change title, move, delete', async () => {
    vi.mocked(api.startTorrents).mockResolvedValue()
    const handlers = renderActions()
    const menu = screen.getByRole('menu', { name: 'More actions: Inception' })
    const names = [
      'Resume',
      'Reannounce',
      'Force recheck',
      'Speed limits',
      'Open details',
      'Movie page',
      'Change title',
      'Move files…',
      'Delete',
    ]
    const items = within(menu).getAllByRole('menuitem')
    expect(items).toHaveLength(names.length)
    names.forEach((name, index) => expect(items[index]).toHaveAccessibleName(name))
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Resume' }))
    expect(api.startTorrents).toHaveBeenCalledWith(['b1'])
    expect(handlers.onClose).toHaveBeenCalled()
  })

  it('reannounces a running torrent right away', async () => {
    vi.mocked(api.reannounceTorrents).mockResolvedValue()
    const handlers = renderActions({ torrent: { ...TORRENT, state: 'stalledDL' } })
    await userEvent.click(screen.getByRole('menuitem', { name: 'Reannounce' }))
    expect(api.reannounceTorrents).toHaveBeenCalledWith(['b1'])
    expect(handlers.onReannounced).toHaveBeenCalled()
  })

  it('leaves the recheck to the confirmation its screen opens', async () => {
    const handlers = renderActions({ torrent: { ...TORRENT, state: 'stalledDL' } })
    await userEvent.click(screen.getByRole('menuitem', { name: 'Force recheck' }))
    expect(handlers.onRecheck).toHaveBeenCalled()
    expect(api.recheckTorrents).not.toHaveBeenCalled()
  })

  it('reannounces only a running torrent and rechecks only one with data that isn’t being checked, saying why not', () => {
    const { unmount } = renderActions()
    expect(screen.getByRole('menuitem', { name: 'Reannounce' })).toBeDisabled()
    expect(screen.getByRole('menuitem', { name: 'Reannounce' })).toHaveAccessibleDescription('Only while downloading or seeding')
    expect(screen.getByRole('menuitem', { name: 'Force recheck' })).toBeEnabled()
    expect(screen.getByRole('menuitem', { name: 'Force recheck' })).not.toHaveAccessibleDescription()
    unmount()

    const checking = renderActions({ torrent: { ...TORRENT, state: 'checkingDL' } })
    expect(screen.getByRole('menuitem', { name: 'Reannounce' })).toBeDisabled()
    expect(screen.getByRole('menuitem', { name: 'Force recheck' })).toBeDisabled()
    expect(screen.getByRole('menuitem', { name: 'Force recheck' })).toHaveAccessibleDescription('Already being checked')
    checking.unmount()

    // qBittorrent stops a torrent in error, so it isn't announcing; its data can be checked.
    const errored = renderActions({ torrent: { ...TORRENT, state: 'missingFiles' } })
    expect(screen.getByRole('menuitem', { name: 'Reannounce' })).toBeDisabled()
    expect(screen.getByRole('menuitem', { name: 'Force recheck' })).toBeEnabled()
    errored.unmount()

    // A magnet link added paused or queued has no metadata either, though its state doesn't say so.
    const stoppedMagnet = renderActions({ torrent: { ...TORRENT, state: 'stoppedDL', total_size: -1 } })
    expect(screen.getByRole('menuitem', { name: 'Force recheck' })).toBeDisabled()
    expect(screen.getByRole('menuitem', { name: 'Force recheck' })).toHaveAccessibleDescription('Once the magnet link has its metadata')
    stoppedMagnet.unmount()

    // A magnet still fetching its metadata has peers to find but no data to check.
    renderActions({ torrent: { ...TORRENT, state: 'metaDL', total_size: -1 } })
    expect(screen.getByRole('menuitem', { name: 'Reannounce' })).toBeEnabled()
    expect(screen.getByRole('menuitem', { name: 'Reannounce' })).not.toHaveAccessibleDescription()
    expect(screen.getByRole('menuitem', { name: 'Force recheck' })).toBeDisabled()
    expect(screen.getByRole('menuitem', { name: 'Force recheck' })).toHaveAccessibleDescription('Once the magnet link has its metadata')
  })

  it('turns reannounce and recheck off while qBittorrent is unreachable', () => {
    renderActions({ torrent: { ...TORRENT, state: 'stalledDL' }, offline: true })
    expect(screen.getByRole('menuitem', { name: 'Reannounce' })).toBeDisabled()
    expect(screen.getByRole('menuitem', { name: 'Force recheck' })).toBeDisabled()
  })

  it('turns the other items off while a reannounce is pending', async () => {
    vi.mocked(api.reannounceTorrents).mockReturnValue(new Promise(() => {}))
    renderActions({ torrent: { ...TORRENT, state: 'stalledDL' } })
    await userEvent.click(screen.getByRole('menuitem', { name: 'Reannounce' }))
    expect(screen.getByRole('menuitem', { name: 'Pause' })).toBeDisabled()
    expect(screen.getByRole('menuitem', { name: 'Reannounce' })).toBeDisabled()
    expect(screen.getByRole('menuitem', { name: 'Force recheck' })).toBeDisabled()
  })

  it('asks about a guessed title with Change and "Yes, right"', async () => {
    vi.mocked(titleMatches.chooseTitle).mockResolvedValue()
    const handlers = renderActions({ guessed: true })
    const group = screen.getByRole('group', { name: 'Matched by the release name. Is it right?' })
    expect(screen.queryByRole('menuitem', { name: 'Change title' })).not.toBeInTheDocument()
    await userEvent.click(within(group).getByRole('menuitem', { name: 'Change' }))
    expect(handlers.onChangeTitle).toHaveBeenCalled()
    await userEvent.click(within(group).getByRole('menuitem', { name: 'Yes, right' }))
    expect(titleMatches.chooseTitle).toHaveBeenCalledWith('b1', MATCH, expect.any(String))
    expect(handlers.onConfirmed).toHaveBeenCalled()
  })

  it('shows a failure under the items, not in a toast as well', async () => {
    vi.mocked(api.startTorrents).mockRejectedValue(new Error('500'))
    renderActions()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Resume' }))
    expect(await screen.findByRole('alert', { name: saying('Couldn’t reach qBittorrent. Try again.') })).toBeInTheDocument()
    expect(screen.queryByRole('status', { name: saying('Couldn’t reach qBittorrent. Try again.') })).not.toBeInTheDocument()
  })

  it('turns Resume off while one sent from elsewhere is in flight, then says how it went', async () => {
    let refuse = () => {}
    vi.mocked(api.startTorrents).mockReturnValue(new Promise((_resolve, reject) => (refuse = () => reject(new Error('500')))))
    renderActions()
    await userEvent.click(screen.getByRole('button', { name: 'Resume elsewhere' }))
    expect(screen.getByRole('menuitem', { name: 'Resume' })).toBeDisabled()
    expect(screen.getByRole('menuitem', { name: 'Force recheck' })).toBeDisabled()

    await act(async () => refuse())
    expect(screen.getByRole('alert', { name: saying('Couldn’t reach qBittorrent. Try again.') })).toBeInTheDocument()
    expect(screen.getByRole('menuitem', { name: 'Resume' })).toBeEnabled()
    expect(api.startTorrents).toHaveBeenCalledOnce()
  })

  it('opens Move files', async () => {
    const handlers = renderActions()
    await userEvent.click(screen.getByRole('menuitem', { name: 'Move files…' }))
    expect(handlers.onMove).toHaveBeenCalled()
  })

  it('needs qBittorrent to move files', () => {
    renderActions({ offline: true })
    expect(screen.getByRole('menuitem', { name: 'Move files…' })).toBeDisabled()
  })
})

describe('TorrentActionsSheet on a phone', () => {
  beforeEach(() => {
    vi.unstubAllGlobals()
  })

  it('is a sheet without an anchor or on a phone', async () => {
    const handlers = renderActions()
    expect(screen.getByRole('dialog', { name: 'Inception' })).toBeInTheDocument()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Move files…' }))
    expect(handlers.onMove).toHaveBeenCalled()
  })

  it('needs qBittorrent to move files on a phone too', () => {
    vi.unstubAllGlobals()
    renderActions({ offline: true })
    expect(screen.getByRole('button', { name: 'Move files…' })).toBeDisabled()
  })

  it('leaves the speed limits to the sheet its screen opens, and turns them off while qBittorrent is unreachable', async () => {
    const handlers = renderActions()
    await userEvent.click(screen.getByRole('button', { name: 'Speed limits' }))
    expect(handlers.onSpeedLimits).toHaveBeenCalled()
    handlers.unmount()

    renderActions({ offline: true })
    expect(screen.getByRole('button', { name: 'Speed limits' })).toBeDisabled()
  })

  it('says under a sheet row why it’s off', () => {
    vi.unstubAllGlobals()
    renderActions({ torrent: { ...TORRENT, state: 'queuedDL', total_size: -1 } })
    const sheet = screen.getByRole('dialog', { name: 'Inception' })
    const recheck = within(sheet).getByRole('button', { name: 'Force recheck' })
    expect(recheck).toBeDisabled()
    expect(recheck).toHaveAccessibleDescription('Once the magnet link has its metadata')
    expect(within(sheet).getByRole('button', { name: 'Reannounce' })).toHaveAccessibleDescription('Only while downloading or seeding')
  })

  it('a failed reannounce shows the error in the sheet and doesn’t report success', async () => {
    vi.unstubAllGlobals()
    vi.mocked(api.reannounceTorrents).mockRejectedValue(new Error('500'))
    const handlers = renderActions({ torrent: { ...TORRENT, state: 'uploading' } })
    const sheet = screen.getByRole('dialog', { name: 'Inception' })
    await userEvent.click(within(sheet).getByRole('button', { name: 'Reannounce' }))
    expect(api.reannounceTorrents).toHaveBeenCalledWith(['b1'])
    expect(await within(sheet).findByRole('alert', { name: saying('Couldn’t reach qBittorrent. Try again.') })).toBeInTheDocument()
    expect(handlers.onReannounced).not.toHaveBeenCalled()
  })
})
