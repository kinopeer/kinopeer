import { act, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as api from '../api/qbittorrent'
import type { Torrent } from '../api/qbittorrent'
import { stubDesktop } from '../lib/stubDesktop'
import { renderWithRouter, saying } from '../test/render'
import * as titleMatches from '../torrents/titleMatches'
import { REQUEST_KINDS } from '../torrents/requestKinds'
import { TorrentRequestsProvider } from '../torrents/TorrentRequestsProvider'
import { TorrentActionsSheet, type TorrentActionsSheetProps } from './TorrentActionsSheet'
import { usePauseResume } from './usePauseResume'
import { useReannounce } from './useReannounce'
import { useTorrentRequests } from '../torrents/useTorrentRequests'

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

/**
 * Sends the torrent's requests from another place under the same requests: a resume (a row's button),
 * a reannounce (the menu on another screen), a recheck and a delete (confirmations).
 */
function Elsewhere({ torrent = TORRENT }: { torrent?: Torrent }) {
  const pauseResume = usePauseResume()
  const reannounce = useReannounce()
  const requests = useTorrentRequests()
  return (
    <>
      <button type="button" onClick={() => void requests.send(REQUEST_KINDS.delete, torrent, false, () => new Promise(() => {}))}>
        Delete elsewhere
      </button>
      <button type="button" onClick={() => void pauseResume.toggle(torrent)}>
        Resume elsewhere
      </button>
      <button type="button" onClick={() => void reannounce.reannounce(torrent)}>
        Reannounce elsewhere
      </button>
      <button
        type="button"
        onClick={() => void requests.send(REQUEST_KINDS.recheck, torrent, true, (hashes) => api.recheckTorrents(hashes))}
      >
        Recheck elsewhere
      </button>
    </>
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
    onChangeTitle: vi.fn(),
  }
  const { unmount } = renderWithRouter(
    <TorrentRequestsProvider>
      <Elsewhere torrent={props.torrent} />
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

  it('says the torrent’s own limits under Speed limits, and nothing without them', () => {
    const { unmount } = renderActions({ torrent: { ...TORRENT, dl_limit: 5_000_000, up_limit: -1 } })
    expect(screen.getByRole('menuitem', { name: 'Speed limits' })).toHaveAccessibleDescription('Download up to 5.0\u00a0MB/s')
    unmount()

    renderActions({ torrent: { ...TORRENT, dl_limit: 0, up_limit: -1 } })
    expect(screen.getByRole('menuitem', { name: 'Speed limits' })).not.toHaveAccessibleDescription()
  })

  it('is a menu: resume, reannounce, recheck, speed limits, details, the title page, fix match, move, delete', async () => {
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
      'Fix match',
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

  it('reannounces a running torrent right away, then closes and says so', async () => {
    vi.mocked(api.reannounceTorrents).mockResolvedValue()
    const handlers = renderActions({ torrent: { ...TORRENT, state: 'stalledDL' } })
    await userEvent.click(screen.getByRole('menuitem', { name: 'Reannounce' }))
    expect(api.reannounceTorrents).toHaveBeenCalledWith(['b1'])
    expect(await screen.findByRole('status', { name: saying('Announced to the trackers') })).toBeInTheDocument()
    expect(handlers.onClose).toHaveBeenCalled()
  })

  it('turns the items off while a reannounce or a recheck sent from elsewhere is in flight, then says how a reannounce went', async () => {
    let refuse = () => {}
    vi.mocked(api.reannounceTorrents).mockReturnValue(new Promise((_resolve, reject) => (refuse = () => reject(new Error('500')))))
    let answer = () => {}
    vi.mocked(api.recheckTorrents).mockReturnValue(new Promise((resolve) => (answer = resolve)))
    renderActions({ torrent: { ...TORRENT, state: 'stalledDL' } })
    await userEvent.click(screen.getByRole('button', { name: 'Recheck elsewhere' }))
    expect(screen.getByRole('menuitem', { name: 'Force recheck' })).toBeDisabled()
    expect(screen.getByRole('menuitem', { name: 'Reannounce' })).toBeDisabled()
    await act(async () => answer())
    expect(screen.getByRole('menuitem', { name: 'Reannounce' })).toBeEnabled()

    await userEvent.click(screen.getByRole('button', { name: 'Reannounce elsewhere' }))
    expect(screen.getByRole('menuitem', { name: 'Reannounce' })).toBeDisabled()
    expect(screen.getByRole('menuitem', { name: 'Pause' })).toBeDisabled()
    await act(async () => refuse())
    expect(await screen.findByRole('alert', { name: saying('Couldn’t reach qBittorrent. Try again.') })).toBeInTheDocument()
    expect(screen.queryByRole('status', { name: saying('Couldn’t reach qBittorrent. Try again.') })).not.toBeInTheDocument()
    expect(api.reannounceTorrents).toHaveBeenCalledOnce()
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

  it('has one item for the match: Fix match with a title, Match title without one, each opening the title search', async () => {
    const handlers = renderActions()
    const menu = screen.getByRole('menu', { name: 'More actions: Inception' })
    await userEvent.click(within(menu).getByRole('menuitem', { name: 'Fix match' }))
    expect(handlers.onChangeTitle).toHaveBeenCalledOnce()
    expect(within(menu).queryByRole('menuitem', { name: 'Match title' })).not.toBeInTheDocument()
    handlers.unmount()

    const none = renderActions({ match: null })
    const unmatched = screen.getByRole('menu', { name: 'More actions: Inception.2010.1080p' })
    await userEvent.click(within(unmatched).getByRole('menuitem', { name: 'Match title' }))
    expect(none.onChangeTitle).toHaveBeenCalledOnce()
    expect(within(unmatched).queryByRole('menuitem', { name: 'Fix match' })).not.toBeInTheDocument()
  })

  it('turns off everything that sends something for a torrent being deleted', async () => {
    const { unmount } = renderActions({ torrent: { ...TORRENT, state: 'stalledDL' } })
    await userEvent.click(screen.getByRole('button', { name: 'Delete elsewhere' }))
    for (const name of ['Pause', 'Reannounce', 'Force recheck', 'Speed limits', 'Fix match', 'Move files…', 'Delete']) {
      expect(screen.getByRole('menuitem', { name })).toBeDisabled()
    }
    unmount()

    // A title saved after the delete would stay for a torrent that's gone.
    renderActions({ match: null })
    await userEvent.click(screen.getByRole('button', { name: 'Delete elsewhere' }))
    expect(screen.getByRole('menuitem', { name: 'Match title' })).toBeDisabled()
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
    stubDesktop(false)
  })

  it('is a sheet without an anchor or on a phone', async () => {
    const handlers = renderActions()
    expect(screen.getByRole('dialog', { name: 'Inception' })).toBeInTheDocument()
    expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Move files…' }))
    expect(handlers.onMove).toHaveBeenCalled()
  })

  it('turns off everything that sends something for a torrent being deleted on a phone too', async () => {
    const { unmount } = renderActions({ torrent: { ...TORRENT, state: 'stalledDL' } })
    await userEvent.click(screen.getByRole('button', { name: 'Delete elsewhere' }))
    const sheet = screen.getByRole('dialog', { name: 'Inception' })
    for (const name of ['Pause', 'Reannounce', 'Force recheck', 'Speed limits', 'Fix match', 'Move files…', 'Delete']) {
      expect(within(sheet).getByRole('button', { name })).toBeDisabled()
    }
    unmount()

    renderActions({ match: null })
    await userEvent.click(screen.getByRole('button', { name: 'Delete elsewhere' }))
    expect(within(screen.getByRole('dialog', { name: 'Inception.2010.1080p' })).getByRole('button', { name: 'Match title' })).toBeDisabled()
  })

  it('has one row for the match on a phone too: Fix match with a title, Match title without one', async () => {
    const handlers = renderActions()
    const sheet = screen.getByRole('dialog', { name: 'Inception' })
    await userEvent.click(within(sheet).getByRole('button', { name: 'Fix match' }))
    expect(handlers.onChangeTitle).toHaveBeenCalledOnce()
    expect(within(sheet).queryByRole('button', { name: 'Match title' })).not.toBeInTheDocument()
    handlers.unmount()

    const none = renderActions({ match: null })
    const unmatched = screen.getByRole('dialog', { name: 'Inception.2010.1080p' })
    await userEvent.click(within(unmatched).getByRole('button', { name: 'Match title' }))
    expect(none.onChangeTitle).toHaveBeenCalledOnce()
    expect(within(unmatched).queryByRole('button', { name: 'Fix match' })).not.toBeInTheDocument()
  })

  it('needs qBittorrent to move files on a phone too', () => {
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

  it('says the torrent’s own limits under Speed limits on a phone too, and nothing without them', () => {
    const { unmount } = renderActions({ torrent: { ...TORRENT, dl_limit: 0, up_limit: 500_000 } })
    expect(screen.getByRole('button', { name: 'Speed limits' })).toHaveAccessibleDescription('Upload up to 500\u00a0KB/s')
    unmount()

    renderActions({ torrent: { ...TORRENT, dl_limit: -1, up_limit: 0 } })
    expect(screen.getByRole('button', { name: 'Speed limits' })).not.toHaveAccessibleDescription()
  })

  it('says under a sheet row why it’s off', () => {
    renderActions({ torrent: { ...TORRENT, state: 'queuedDL', total_size: -1 } })
    const sheet = screen.getByRole('dialog', { name: 'Inception' })
    const recheck = within(sheet).getByRole('button', { name: 'Force recheck' })
    expect(recheck).toBeDisabled()
    expect(recheck).toHaveAccessibleDescription('Once the magnet link has its metadata')
    expect(within(sheet).getByRole('button', { name: 'Reannounce' })).toHaveAccessibleDescription('Only while downloading or seeding')
  })

  it('a failed reannounce shows the error in the sheet and doesn’t report success', async () => {
    vi.mocked(api.reannounceTorrents).mockRejectedValue(new Error('500'))
    const handlers = renderActions({ torrent: { ...TORRENT, state: 'uploading' } })
    const sheet = screen.getByRole('dialog', { name: 'Inception' })
    await userEvent.click(within(sheet).getByRole('button', { name: 'Reannounce' }))
    expect(api.reannounceTorrents).toHaveBeenCalledWith(['b1'])
    expect(await within(sheet).findByRole('alert', { name: saying('Couldn’t reach qBittorrent. Try again.') })).toBeInTheDocument()
    expect(handlers.onClose).not.toHaveBeenCalled()
    expect(screen.queryByRole('status', { name: saying('Couldn’t reach qBittorrent. Try again.') })).not.toBeInTheDocument()
  })
})
