import { act, fireEvent, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import * as matchesApi from '../api/matches'
import * as api from '../api/qbittorrent'
import type { Torrent } from '../api/qbittorrent'
import * as tmdb from '../api/tmdb'
import { stubDesktop } from '../lib/stubDesktop'
import { resetSettings, updateSettings } from '../settings/settings'
import { DUNE_TORRENT, mainData, searchPage, title } from '../test/fixtures'
import { findToastOnPage, renderWithRouter, saying, Where, where } from '../test/render'
import { MainDataProvider } from '../torrents/MainDataProvider'
import { TorrentRequestsProvider } from '../torrents/TorrentRequestsProvider'
import * as serverMatches from '../torrents/serverMatches'
import { clearTitleMatchCache } from '../torrents/titleMatches'
import { DownloadsWithDrawer } from './DownloadsWithDrawer'

vi.mock('../api/qbittorrent', async (importOriginal) => {
  const actual = await importOriginal<typeof api>()
  return {
    ...actual,
    getMainData: vi.fn(),
    getTorrentTrackers: vi.fn(),
    getTorrentFiles: vi.fn(),
    setFilePriority: vi.fn(),
    startTorrents: vi.fn(),
    stopTorrents: vi.fn(),
    deleteTorrents: vi.fn(),
    setSpeedLimits: vi.fn(),
    recheckTorrents: vi.fn(),
  }
})

vi.mock('../api/tmdb', async (importOriginal) => {
  const actual = await importOriginal<typeof tmdb>()
  return { ...actual, getMovie: vi.fn(), searchTitles: vi.fn() }
})

vi.mock('../api/matches', async (importOriginal) => ({
  ...(await importOriginal<typeof matchesApi>()),
  getMatches: vi.fn(),
  saveMatches: vi.fn(),
}))

vi.mock('../torrents/serverMatches', async (importOriginal) => ({
  ...(await importOriginal<typeof serverMatches>()),
  forgetMatches: vi.fn(),
}))

const getMainData = vi.mocked(api.getMainData)
const getTorrentTrackers = vi.mocked(api.getTorrentTrackers)
const getTorrentFiles = vi.mocked(api.getTorrentFiles)
const setFilePriority = vi.mocked(api.setFilePriority)
const startTorrents = vi.mocked(api.startTorrents)
const stopTorrents = vi.mocked(api.stopTorrents)
const deleteTorrents = vi.mocked(api.deleteTorrents)

const snapshot = (fields: Partial<Torrent> = {}) => mainData([{ ...DUNE_TORRENT, ...fields }])

/** The desktop routes as App sets them up, under the shared poll and requests. */
function renderApp(entries: string[]) {
  return renderWithRouter(
    <MainDataProvider onUnauthorized={vi.fn()}>
      <TorrentRequestsProvider>
        <Routes>
          <Route element={<DownloadsWithDrawer onSessionLost={vi.fn()} />}>
            <Route index />
            <Route path="torrent/:hash" />
          </Route>
          <Route path="title/:type/:id" element={<p>Title page</p>} />
        </Routes>
        <Where />
      </TorrentRequestsProvider>
    </MainDataProvider>,
    entries,
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  clearTitleMatchCache()
  serverMatches.resetServerMatches()
  resetSettings()
  updateSettings({ downloadsDesktopView: 'list' })
  vi.mocked(matchesApi.getMatches).mockResolvedValue({})
  vi.mocked(matchesApi.saveMatches).mockImplementation(async (changes) => changes as matchesApi.Matches)
  getMainData.mockResolvedValue(snapshot())
  vi.mocked(tmdb.getMovie).mockResolvedValue({
    id: 693134,
    title: 'Dune: Part Two',
    original_title: 'Dune: Part Two',
    release_date: '2024-02-27',
    poster_path: '/dune.jpg',
  } as Awaited<ReturnType<typeof tmdb.getMovie>>)
  getTorrentFiles.mockResolvedValue([])
  getTorrentTrackers.mockResolvedValue([])
  setFilePriority.mockResolvedValue()
  startTorrents.mockResolvedValue()
  stopTorrents.mockResolvedValue()
  deleteTorrents.mockResolvedValue()
  stubDesktop()
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('the details drawer on desktop', () => {
  it('shows the torrent in a modal drawer over Downloads, sharing one poll', async () => {
    renderApp(['/torrent/dune'])
    const drawer = await screen.findByRole('dialog', { name: 'Dune: Part Two' })
    expect(drawer).toHaveAttribute('aria-modal', 'true')
    expect(within(drawer).getByRole('heading', { level: 2, name: 'Dune: Part Two' })).toBeInTheDocument()
    expect(within(drawer).getByText('42%')).toBeInTheDocument()
    expect(within(drawer).getByRole('button', { name: 'Pause' })).toBeInTheDocument()
    expect(within(drawer).getByRole('button', { name: 'Close' })).toHaveFocus()
    expect(screen.getByRole('table', { name: 'Downloads' })).toBeInTheDocument()
    expect(getMainData).toHaveBeenCalledTimes(1)
  })

  it('opens from a row and goes back to the list on Escape, focus back on the row', async () => {
    renderApp(['/'])
    const link = await screen.findByRole('link', { name: /^Dune: Part Two/ })
    await userEvent.click(link)
    const drawer = await screen.findByRole('dialog', { name: 'Dune: Part Two' })
    expect(where()).toBe('/torrent/dune')

    fireEvent(drawer, new Event('cancel', { cancelable: true }))
    expect(await screen.findByText('/')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(link).toHaveFocus()
  })

  it('closes with the Close button and a click on the backdrop', async () => {
    renderApp(['/', '/torrent/dune'])
    await userEvent.click(await screen.findByRole('button', { name: 'Close' }))
    expect(where()).toBe('/')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('link', { name: /^Dune: Part Two/ }))
    await userEvent.click(await screen.findByRole('dialog'))
    expect(where()).toBe('/')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('opened from elsewhere, closes to Downloads', async () => {
    renderApp(['/title/movie/693134', '/torrent/dune'])
    await userEvent.click(await screen.findByRole('button', { name: 'Close' }))
    expect(where()).toBe('/')
    expect(screen.getByRole('table', { name: 'Downloads' })).toBeInTheDocument()
  })

  it('goes back to Downloads with a toast after deleting', async () => {
    renderApp(['/', '/torrent/dune'])
    const drawer = await screen.findByRole('dialog', { name: 'Dune: Part Two' })
    await userEvent.click(within(drawer).getByRole('button', { name: 'Delete' }))
    const confirm = screen.getByRole('alertdialog', { name: 'Delete torrent?' })
    await userEvent.click(within(confirm).getByRole('button', { name: 'Delete' }))
    expect(await findToastOnPage('Torrent deleted')).toBeInTheDocument()
    expect(where()).toBe('/')
  })

  it('shows a toast from Downloads inside the drawer, since the page behind it is inert', async () => {
    renderApp(['/', '/torrent/dune'])
    const drawer = await screen.findByRole('dialog', { name: 'Dune: Part Two' })
    getMainData.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    window.dispatchEvent(new Event('online'))
    expect(await within(drawer).findByRole('status', { name: saying('No connection to qBittorrent') })).toBeInTheDocument()

    window.dispatchEvent(new Event('online'))
    // Downloads says it, under the drawer.
    expect(await within(drawer).findByRole('status', { name: saying('Reconnected to qBittorrent') })).toBeInTheDocument()
  })

  it('shows speed limits sent from Downloads in the drawer’s sheet for that torrent, busy, and says there how they went', async () => {
    let refuse = () => {}
    vi.mocked(api.setSpeedLimits).mockReturnValue(new Promise((_resolve, reject) => (refuse = () => reject(new Error('500')))))
    renderApp(['/'])
    await userEvent.click(await screen.findByRole('button', { name: /^More actions: Dune/ }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Speed limits' }))
    const first = screen.getByRole('dialog', { name: 'Speed limits' })
    await userEvent.type(within(first).getByRole('textbox', { name: 'Download limit, MB/s' }), '2')
    await userEvent.click(within(first).getByRole('button', { name: 'Save limits' }))
    // Closed while it's sent, as Escape does.
    fireEvent(first, new Event('cancel', { cancelable: true }))

    await userEvent.click(screen.getByRole('link', { name: /^Dune: Part Two/ }))
    const drawer = await screen.findByRole('dialog', { name: 'Dune: Part Two' })
    await userEvent.click(within(drawer).getByRole('button', { name: 'More actions: Dune: Part Two' }))
    await userEvent.click(within(drawer).getByRole('menuitem', { name: 'Speed limits' }))
    const again = screen.getByRole('dialog', { name: 'Speed limits' })
    // Busy with what Downloads sends, so it can't go out a second time.
    expect(within(again).getByRole('textbox', { name: 'Download limit, MB/s' })).toHaveValue('2')
    expect(within(again).getByRole('button', { name: /Save limits/ })).toBeDisabled()

    refuse()
    expect(await within(again).findByRole('alert', { name: saying(/Couldn’t save the limits/) })).toBeInTheDocument()
    expect(screen.queryByRole('status', { name: saying(/Couldn’t save the speed limits of/) })).not.toBeInTheDocument()
    expect(api.setSpeedLimits).toHaveBeenCalledOnce()
  })

  it('shows a pause sent from a row busy in the drawer, then the torrent paused as soon as qBittorrent took it', async () => {
    let answer = () => {}
    stopTorrents.mockReturnValue(new Promise((resolve) => (answer = resolve)))
    renderApp(['/'])
    await userEvent.click(await screen.findByRole('button', { name: 'Pause: Dune: Part Two' }))
    await userEvent.click(screen.getByRole('link', { name: /^Dune: Part Two/ }))
    const drawer = await screen.findByRole('dialog', { name: 'Dune: Part Two' })
    // Busy with what the row sends, so it can't go out a second time.
    expect(within(drawer).getByRole('button', { name: 'Pause' })).toBeDisabled()
    expect(stopTorrents).toHaveBeenCalledOnce()

    // The poll asked for after it hasn't answered yet: the drawer and the row show it paused already.
    getMainData.mockReturnValue(new Promise(() => {}))
    await act(async () => answer())
    expect(within(drawer).getByRole('button', { name: 'Resume' })).toBeEnabled()
    expect(within(drawer).getByText('Paused')).toBeInTheDocument()
    expect(getMainData).toHaveBeenCalledTimes(2)
  })

  it('shows a recheck sent from Downloads busy in the drawer’s menu, then the torrent checking as soon as qBittorrent took it', async () => {
    let answer = () => {}
    vi.mocked(api.recheckTorrents).mockReturnValue(new Promise((resolve) => (answer = resolve)))
    renderApp(['/'])
    await userEvent.click(await screen.findByRole('button', { name: /^More actions: Dune/ }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Force recheck' }))
    const confirm = screen.getByRole('alertdialog', { name: 'Recheck the files?' })
    await userEvent.click(within(confirm).getByRole('button', { name: 'Force recheck' }))
    // Closed while it's sent, as Escape does.
    fireEvent(confirm, new Event('cancel', { cancelable: true }))

    await userEvent.click(screen.getByRole('link', { name: /^Dune: Part Two/ }))
    const drawer = await screen.findByRole('dialog', { name: 'Dune: Part Two' })
    await userEvent.click(within(drawer).getByRole('button', { name: 'More actions: Dune: Part Two' }))
    // Busy with what Downloads sends, so it can't go out a second time.
    expect(within(drawer).getByRole('menuitem', { name: 'Force recheck' })).toBeDisabled()
    expect(api.recheckTorrents).toHaveBeenCalledOnce()

    // The poll asked for after it hasn't answered yet: the drawer shows the torrent checking already.
    getMainData.mockReturnValue(new Promise(() => {}))
    await act(async () => answer())
    expect(within(drawer).getByText('Checking')).toBeInTheDocument()
    expect(within(drawer).getByRole('menuitem', { name: 'Force recheck' })).toHaveAccessibleDescription('Already being checked')
    expect(screen.getByRole('status', { name: saying('Checking the files') })).toBeInTheDocument()
  })

  it.each([
    ['downloading', undefined, 'Pause'],
    ['stopped', { state: 'stoppedDL' as const }, 'Resume'],
  ])('shows a delete sent from Downloads busy in the drawer, with nothing else to send, then the torrent gone as soon as qBittorrent took it (%s)', async (_state, fields, toggle) => {
    getMainData.mockResolvedValue(snapshot(fields))
    let answer = () => {}
    deleteTorrents.mockReturnValue(new Promise((resolve) => (answer = resolve)))
    renderApp(['/'])
    await userEvent.click(await screen.findByRole('button', { name: /^More actions: Dune/ }))
    await userEvent.click(screen.getByRole('menuitem', { name: 'Delete' }))
    const confirm = screen.getByRole('alertdialog', { name: 'Delete torrent?' })
    await userEvent.click(within(confirm).getByRole('button', { name: 'Delete' }))
    // Closed while it's sent, as Escape does.
    fireEvent(confirm, new Event('cancel', { cancelable: true }))

    await userEvent.click(screen.getByRole('link', { name: /^Dune: Part Two/ }))
    const drawer = await screen.findByRole('dialog', { name: 'Dune: Part Two' })
    // Busy with what Downloads sends, so it can't go out a second time, and nothing else is sent meanwhile.
    const remove = within(drawer).getByRole('button', { name: 'Delete' })
    expect(remove).toBeDisabled()
    expect(remove).toHaveAttribute('aria-busy', 'true')
    expect(within(drawer).getByRole('button', { name: toggle })).toBeDisabled()
    expect(within(drawer).getByRole('button', { name: toggle })).not.toHaveAttribute('aria-busy')
    await userEvent.click(within(drawer).getByRole('button', { name: 'More actions: Dune: Part Two' }))
    for (const name of [toggle, 'Speed limits', 'Move files…', 'Delete']) {
      expect(within(drawer).getByRole('menuitem', { name })).toBeDisabled()
    }
    expect(deleteTorrents).toHaveBeenCalledOnce()

    // The poll asked for after it hasn't answered yet: the torrent is gone from both already.
    getMainData.mockReturnValue(new Promise(() => {}))
    await act(async () => answer())
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(within(drawer).getByRole('heading', { name: 'Torrent not found' })).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /^Dune: Part Two/ })).not.toBeInTheDocument()
    expect(screen.getByRole('status', { name: saying('Torrent deleted') })).toBeInTheDocument()
  })

  it.each([
    ['a guessed title', {}, [title('movie', 693134, 'Dune: Part Two', 2024)], 'Dune: Part Two', ['Yes, right', 'Change']],
    ['no title', { name: 'Some.Home.Video' }, [], 'Some.Home.Video', ['Pick title']],
  ])('turns off the title prompt (%s) and the files of a torrent being deleted, so nothing is kept for it once it’s gone', async (_case, fields, titles, name, buttons) => {
    getMainData.mockResolvedValue(snapshot({ tags: '', ...fields }))
    vi.mocked(tmdb.searchTitles).mockResolvedValue(searchPage(titles))
    getTorrentFiles.mockResolvedValue([
      { index: 0, name: 'Dune.Part.Two/Dune.Part.Two.mkv', size: 19_900_000_000, progress: 0.4, priority: 1 },
      { index: 1, name: 'Dune.Part.Two/Extras.mkv', size: 1_500_000_000, progress: 0, priority: 0 },
    ])
    deleteTorrents.mockReturnValue(new Promise(() => {}))
    renderApp(['/', '/torrent/dune'])
    const drawer = await screen.findByRole('dialog', { name })
    expect(await within(drawer).findByRole('combobox', { name: 'Priority: Extras.mkv' })).toBeEnabled()
    for (const button of buttons) expect(await within(drawer).findByRole('button', { name: button })).toBeEnabled()
    await userEvent.click(within(drawer).getByRole('button', { name: 'Delete' }))
    const confirm = screen.getByRole('alertdialog', { name: 'Delete torrent?' })
    await userEvent.click(within(confirm).getByRole('button', { name: 'Delete' }))
    fireEvent(confirm, new Event('cancel', { cancelable: true }))

    for (const button of buttons) expect(within(drawer).getByRole('button', { name: button })).toBeDisabled()
    for (const file of within(drawer).getAllByRole('combobox', { name: /^Priority:/ })) expect(file).toBeDisabled()
  })

  it('shows a priority change sent before the drawer was closed busy when it opens again, then keeps it over an older poll', async () => {
    getTorrentFiles.mockResolvedValue([
      { index: 0, name: 'Dune.Part.Two/Dune.Part.Two.mkv', size: 19_900_000_000, progress: 0.4, priority: 1 },
      { index: 1, name: 'Dune.Part.Two/Extras.mkv', size: 1_500_000_000, progress: 0, priority: 0 },
    ])
    let answer = () => {}
    setFilePriority.mockReturnValue(new Promise((resolve) => (answer = resolve)))
    renderApp(['/', '/torrent/dune'])
    const first = await screen.findByRole('dialog', { name: 'Dune: Part Two' })
    await userEvent.selectOptions(await within(first).findByRole('combobox', { name: 'Priority: Extras.mkv' }), 'high')
    await userEvent.click(within(first).getByRole('button', { name: 'Close' }))

    await userEvent.click(await screen.findByRole('link', { name: /^Dune: Part Two/ }))
    const drawer = await screen.findByRole('dialog', { name: 'Dune: Part Two' })
    const extras = await within(drawer).findByRole('combobox', { name: 'Priority: Extras.mkv' })
    expect(extras).toHaveValue('high')
    expect(extras).toBeDisabled()
    expect(setFilePriority).toHaveBeenCalledOnce()

    // The drawer's poll went out before qBittorrent answered, so it still has the old priority.
    await act(async () => answer())
    expect(extras).toBeEnabled()
    expect(extras).toHaveValue('high')
  })

  it('stays open when Escape cancels its delete confirmation', async () => {
    renderApp(['/', '/torrent/dune'])
    const drawer = await screen.findByRole('dialog', { name: 'Dune: Part Two' })
    await userEvent.click(within(drawer).getByRole('button', { name: 'Delete' }))
    const confirm = screen.getByRole('alertdialog', { name: 'Delete torrent?' })

    // jsdom doesn't turn Escape into the dialog's cancel event, so it's sent the way a browser does.
    fireEvent(confirm, new Event('cancel', { cancelable: true }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(screen.getByRole('dialog', { name: 'Dune: Part Two' })).toBeInTheDocument()
    expect(where()).toBe('/torrent/dune')
    expect(deleteTorrents).not.toHaveBeenCalled()
  })

  describe('the More menu', () => {
    const openMenu = async (name = 'Dune: Part Two') => {
      const drawer = await screen.findByRole('dialog', { name })
      await userEvent.click(within(drawer).getByRole('button', { name: `More actions: ${name}` }))
      return within(drawer).getByRole('menu', { name: `More actions: ${name}` })
    }

    it('opens and closes from its More button, which says whether it’s open', async () => {
      renderApp(['/', '/torrent/dune'])
      await openMenu()
      const more = within(screen.getByRole('dialog', { name: 'Dune: Part Two' })).getByRole('button', { name: 'More actions: Dune: Part Two' })
      expect(more).toHaveAttribute('aria-expanded', 'true')
      await userEvent.click(more)
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
      expect(more).toHaveAttribute('aria-expanded', 'false')
    })

    it('deletes after confirming', async () => {
      renderApp(['/', '/torrent/dune'])
      const menu = await openMenu()
      await userEvent.click(within(menu).getByRole('menuitem', { name: 'Delete' }))
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
      const confirm = screen.getByRole('alertdialog', { name: 'Delete torrent?' })
      await userEvent.click(within(confirm).getByRole('button', { name: 'Delete' }))
      expect(await findToastOnPage('Torrent deleted')).toBeInTheDocument()
      expect(where()).toBe('/')
    })

    it('opens the title search from Change title, which Escape closes alone', async () => {
      vi.mocked(tmdb.searchTitles).mockResolvedValue(searchPage([title('movie', 693134, 'Dune: Part Two', 2024)]))
      renderApp(['/torrent/dune'])
      const menu = await openMenu()
      await userEvent.click(within(menu).getByRole('menuitem', { name: 'Change title' }))
      const sheet = screen.getByRole('dialog', { name: 'Change title' })
      expect(within(sheet).getByRole('searchbox', { name: 'Search TMDB' })).toHaveValue('Dune Part Two')
      expect(await within(sheet).findByRole('button', { name: /^Dune: Part Two/ })).toHaveAttribute('aria-current', 'true')

      fireEvent(sheet, new Event('cancel', { cancelable: true }))
      expect(screen.queryByRole('dialog', { name: 'Change title' })).not.toBeInTheDocument()
      expect(screen.getByRole('dialog', { name: 'Dune: Part Two' })).toBeInTheDocument()
      expect(where()).toBe('/torrent/dune')
    })

    it('confirms a guessed title with a toast', async () => {
      getMainData.mockResolvedValue(snapshot({ tags: '' }))
      vi.mocked(tmdb.searchTitles).mockResolvedValue(searchPage([title('movie', 693134, 'Dune: Part Two', 2024)]))
      renderApp(['/torrent/dune'])
      const menu = await openMenu()
      const guess = within(menu).getByRole('group', { name: 'Matched by the release name. Is it right?' })
      await userEvent.click(within(guess).getByRole('menuitem', { name: 'Yes, right' }))
      expect(await screen.findByRole('status', { name: saying('Match confirmed') })).toBeInTheDocument()
      expect(screen.queryByRole('menu')).not.toBeInTheDocument()
    })
  })

  it('shows "Yes, right" sent from a row’s menu busy in the drawer, then says it once', async () => {
    getMainData.mockResolvedValue(snapshot({ tags: '' }))
    vi.mocked(tmdb.searchTitles).mockResolvedValue(searchPage([title('movie', 693134, 'Dune: Part Two', 2024)]))
    let saved = () => {}
    vi.mocked(matchesApi.saveMatches).mockImplementation(
      (changes) => new Promise((resolve) => (saved = () => resolve(changes as matchesApi.Matches))),
    )
    renderApp(['/'])
    await userEvent.click(await screen.findByRole('button', { name: 'More actions: Dune: Part Two' }))
    const guess = screen.getByRole('group', { name: 'Matched by the release name. Is it right?' })
    await userEvent.click(within(guess).getByRole('menuitem', { name: 'Yes, right' }))
    await userEvent.keyboard('{Escape}')

    await userEvent.click(screen.getByRole('link', { name: /^Dune: Part Two/ }))
    const drawer = await screen.findByRole('dialog', { name: 'Dune: Part Two' })
    const confirm = within(drawer).getByRole('button', { name: 'Yes, right' })
    expect(confirm).toBeDisabled()
    expect(confirm).toHaveAttribute('aria-busy', 'true')
    expect(within(drawer).getByRole('button', { name: 'Change' })).toBeDisabled()
    expect(matchesApi.saveMatches).toHaveBeenCalledOnce()

    await act(async () => saved())
    expect(screen.getAllByRole('status', { name: saying('Match confirmed') })).toHaveLength(1)
    expect(within(drawer).queryByRole('button', { name: 'Yes, right' })).not.toBeInTheDocument()
  })
})
