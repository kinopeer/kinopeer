import { act, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import * as matchesApi from '../api/matches'
import * as api from '../api/qbittorrent'
import type { Torrent } from '../api/qbittorrent'
import * as tmdb from '../api/tmdb'
import { DUNE_TORRENT, mainData, searchPage } from '../test/fixtures'
import { findToastOnPage, renderWithRouter, saying } from '../test/render'
import * as serverMatches from '../torrents/serverMatches'
import { clearTitleMatchCache } from '../torrents/titleMatches'
import { TorrentScreen } from './TorrentScreen'

/** Hides the page, which stops the poll until the test ends. */
function stopPolling() {
  const hidden = vi.spyOn(document, 'hidden', 'get').mockReturnValue(true)
  document.dispatchEvent(new Event('visibilitychange'))
  onTestFinished(() => hidden.mockRestore())
}

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
    getSaveLocations: vi.fn(),
    setTorrentLocation: vi.fn(),
    recheckTorrents: vi.fn(),
    setSpeedLimits: vi.fn(),
    reannounceTorrents: vi.fn(),
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

function renderScreen(hash = 'dune', from = '/') {
  return renderWithRouter(
    <Routes>
      <Route path="/" element={<p>Downloads list</p>} />
      <Route path="/search" element={<p>Search page</p>} />
      <Route path="/torrent/:hash" element={<TorrentScreen onSessionLost={vi.fn()} />} />
    </Routes>,
    [from, `/torrent/${hash}`],
  )
}

beforeEach(() => {
  vi.resetAllMocks()
  clearTitleMatchCache()
  serverMatches.resetServerMatches()
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
  getTorrentFiles.mockResolvedValue([
    { index: 0, name: 'Dune.Part.Two/Dune.Part.Two.mkv', size: 19_900_000_000, progress: 0.4, priority: 1 },
    { index: 1, name: 'Dune.Part.Two/Extras.mkv', size: 1_500_000_000, progress: 0, priority: 0 },
  ])
  setFilePriority.mockResolvedValue()
  startTorrents.mockResolvedValue()
  stopTorrents.mockResolvedValue()
  deleteTorrents.mockResolvedValue()
})

describe('TorrentScreen', () => {
  it('shows the TMDB title, status, progress and speeds', async () => {
    renderScreen()
    expect(await screen.findByRole('heading', { level: 1, name: 'Dune: Part Two' })).toBeInTheDocument()
    expect(screen.getByText('Dune.Part.Two.2024.2160p.WEB-DL')).toBeInTheDocument()
    expect(screen.getByText('Downloading')).toBeInTheDocument()
    expect(screen.getByText('42%')).toBeInTheDocument()
    expect(screen.getByText('ETA 12 min')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'Dune: Part Two: progress' })).toHaveAttribute('aria-valuenow', '42')
    expect(screen.getByRole('button', { name: 'Pause' })).toBeEnabled()
  })

  it('falls back to the release name before a TMDB match', async () => {
    getMainData.mockResolvedValue(snapshot({ tags: '', name: 'Some.Home.Video' }))
    vi.mocked(tmdb.searchTitles).mockResolvedValue(searchPage([]))
    renderScreen()
    expect(await screen.findByRole('heading', { level: 1, name: 'Some.Home.Video' })).toBeInTheDocument()
  })

  it('says when qBittorrent can’t be reached', async () => {
    getMainData.mockRejectedValueOnce(new TypeError('Failed to fetch'))
    renderScreen()
    expect(await screen.findByRole('heading', { name: 'Can’t reach qBittorrent' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(await screen.findByRole('heading', { level: 1, name: 'Dune: Part Two' })).toBeInTheDocument()
  })

  it('says when the torrent is gone', async () => {
    renderScreen('missing')
    expect(await screen.findByRole('heading', { name: 'Torrent not found' })).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Back to downloads' }))
    expect(screen.getByText(/Downloads list/)).toBeInTheDocument()
  })

  it('pauses a running torrent and resumes a stopped one', async () => {
    const { unmount } = renderScreen()
    await userEvent.click(await screen.findByRole('button', { name: 'Pause' }))
    expect(stopTorrents).toHaveBeenCalledWith(['dune'])
    unmount()

    getMainData.mockResolvedValue(snapshot({ state: 'stoppedDL' }))
    renderScreen()
    await userEvent.click(await screen.findByRole('button', { name: 'Resume' }))
    expect(startTorrents).toHaveBeenCalledWith(['dune'])
  })

  it('reports a failed action, and takes the failure back once it’s tried again', async () => {
    stopTorrents.mockRejectedValue(new Error('offline'))
    renderScreen()
    await userEvent.click(await screen.findByRole('button', { name: 'Pause' }))
    expect(await screen.findByRole('status', { name: saying('Couldn’t reach qBittorrent. Try again.') })).toBeInTheDocument()

    stopTorrents.mockReturnValue(new Promise(() => {}))
    await userEvent.click(screen.getByRole('button', { name: 'Pause' }))
    expect(screen.queryByRole('status', { name: saying('Couldn’t reach qBittorrent. Try again.') })).not.toBeInTheDocument()
  })

  it('explains an error state', async () => {
    getMainData.mockResolvedValue(snapshot({ state: 'missingFiles' }))
    renderScreen()
    expect(await screen.findByRole('alert', { name: saying(/The files are missing from the save path\./) })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Resume' })).toBeInTheDocument()
  })

  it('shows details and trackers when expanded', async () => {
    getTorrentTrackers.mockResolvedValue([
      { url: '** [DHT] **', status: 2, msg: '' },
      { url: 'http://bt.rutor.info:2710/announce', status: 2, msg: '' },
      { url: 'udp://opentor.net:6969', status: 4, msg: '' },
    ])
    renderScreen()
    const toggle = within(await screen.findByRole('region', { name: 'Details' })).getByRole('button', { name: 'Details' })
    expect(toggle).toHaveAttribute('aria-expanded', 'false')
    await userEvent.click(toggle)
    expect(toggle).toHaveAttribute('aria-expanded', 'true')

    const value = (label: string) => screen.getByText(label, { selector: 'dt' }).nextElementSibling
    expect(value('Seeds / peers')).toHaveTextContent('12 (340) · 3 (41)')
    expect(value('Save path')).toHaveTextContent('/data/movies')
    expect(value('Category')).toHaveTextContent('Movies')
    expect(value('Info hash')).toHaveTextContent('dune')
    expect(await screen.findByText('bt.rutor.info, opentor.net')).toBeInTheDocument()
    expect(getTorrentTrackers).toHaveBeenCalledWith('dune', expect.any(AbortSignal))
  })

  it.each([0, -1])('lists only the speed limits that are set among the details (no upload limit reported as %i)', async (none) => {
    getTorrentTrackers.mockResolvedValue([])
    getMainData.mockResolvedValue(snapshot({ dl_limit: 2_500_000, up_limit: none }))
    renderScreen()
    await userEvent.click(await screen.findByRole('button', { name: 'Details' }))
    // The download limit's row has rendered, so the upload limit's absence is a real one.
    expect(screen.getByText('Download limit', { selector: 'dt' }).nextElementSibling).toHaveTextContent('2.5 MB/s')
    expect(screen.queryByText('Upload limit', { selector: 'dt' })).not.toBeInTheDocument()
  })

  it('sets the speed limits from the More menu and lists them among the details right away', async () => {
    vi.mocked(api.setSpeedLimits).mockResolvedValue()
    getTorrentTrackers.mockResolvedValue([])
    renderScreen()
    await userEvent.click(await screen.findByRole('button', { name: 'Details' }))
    await userEvent.click(screen.getByRole('button', { name: 'More actions: Dune: Part Two' }))
    // A hidden page doesn't poll, so only the screen's own refresh can bring qBittorrent's next answer.
    stopPolling()
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Speed limits' }))
    const sheet = screen.getByRole('dialog', { name: 'Speed limits' })
    expect(within(sheet).getByText('Dune: Part Two')).toBeInTheDocument()
    await userEvent.type(within(sheet).getByRole('textbox', { name: 'Upload limit, MB/s' }), '0.5')
    getMainData.mockResolvedValue(snapshot({ up_limit: 500_000 }))
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save limits' }))
    // What the sheet sends is its own tests' business; here, that it's for this torrent.
    expect(vi.mocked(api.setSpeedLimits).mock.calls[0][0]).toEqual(['dune'])
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect((await screen.findByText('Upload limit', { selector: 'dt' })).nextElementSibling).toHaveTextContent('500 KB/s')
  })

  it('goes back to Downloads with a toast after deleting', async () => {
    renderScreen()
    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    const dialog = screen.getByRole('alertdialog', { name: 'Delete torrent?' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    expect(await screen.findByText('Downloads list')).toBeInTheDocument()
    expect(await findToastOnPage('Torrent deleted')).toBeInTheDocument()
  })

  it('stays where the user went when a delete settles after they left the page', async () => {
    let answer = () => {}
    deleteTorrents.mockReturnValue(new Promise((resolve) => (answer = resolve)))
    renderScreen('dune', '/search')
    await userEvent.click(await screen.findByRole('button', { name: 'Delete' }))
    const dialog = screen.getByRole('alertdialog', { name: 'Delete torrent?' })
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete' }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    await userEvent.click(screen.getByRole('button', { name: 'Back' }))
    expect(screen.getByText('Search page')).toBeInTheDocument()

    await act(async () => answer())
    expect(screen.getByRole('status', { name: saying('Torrent deleted') })).toBeInTheDocument()
    expect(screen.getByText('Search page')).toBeInTheDocument()
  })

  it('moves the files from the More menu', async () => {
    vi.mocked(api.getSaveLocations).mockResolvedValue({ defaultPath: '/downloads', categories: [], categoryPaths: false, subcategories: false })
    vi.mocked(api.setTorrentLocation).mockResolvedValue()
    getTorrentTrackers.mockResolvedValue([])
    renderScreen()
    await userEvent.click(await screen.findByRole('button', { name: 'Details' }))
    const savePath = screen.getByText('Save path', { selector: 'dt' }).nextElementSibling
    await userEvent.click(screen.getByRole('button', { name: 'More actions: Dune: Part Two' }))
    // A hidden page doesn't poll, so only the screen's own refresh can bring qBittorrent's next answer.
    stopPolling()
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Dune: Part Two' })).getByRole('button', { name: 'Move files…' }))
    const sheet = screen.getByRole('dialog', { name: 'Move files' })
    const field = within(sheet).getByRole('textbox', { name: 'Folder' })
    await userEvent.clear(field)
    await userEvent.type(field, '/media/movies')
    // The screen asks qBittorrent again right after the move, so the new folder shows without a poll.
    getMainData.mockResolvedValue(snapshot({ save_path: '/media/movies' }))
    await userEvent.click(within(sheet).getByRole('button', { name: 'Move' }))
    expect(api.setTorrentLocation).toHaveBeenCalledWith(['dune'], '/media/movies')
    expect(await findToastOnPage('Moving files to /media/movies')).toBeInTheDocument()
    await waitFor(() => expect(savePath).toHaveTextContent('/media/movies'))
  })

  it('says how a move went when the torrent is gone by the time qBittorrent answers', async () => {
    vi.mocked(api.getSaveLocations).mockResolvedValue({ defaultPath: '/downloads', categories: [], categoryPaths: false, subcategories: false })
    let fail = (_error: unknown) => {}
    vi.mocked(api.setTorrentLocation).mockReturnValue(new Promise<void>((_resolve, reject) => (fail = reject)))
    renderScreen()
    await userEvent.click(await screen.findByRole('button', { name: 'More actions: Dune: Part Two' }))
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Dune: Part Two' })).getByRole('button', { name: 'Move files…' }))
    const sheet = screen.getByRole('dialog', { name: 'Move files' })
    const field = within(sheet).getByRole('textbox', { name: 'Folder' })
    await userEvent.clear(field)
    await userEvent.type(field, '/media/movies')
    await userEvent.click(within(sheet).getByRole('button', { name: 'Move' }))

    getMainData.mockResolvedValue(mainData([]))
    window.dispatchEvent(new Event('online'))
    expect(await screen.findByText('Torrent not found')).toBeInTheDocument()
    fail(new api.QbittorrentError('conflict', 409))
    expect(await screen.findByRole('status', { name: saying('qBittorrent couldn’t create that folder.') })).toBeInTheDocument()
  })

  it('says the speed limits failed when the torrent is gone by the time qBittorrent answers', async () => {
    let refuse = () => {}
    vi.mocked(api.setSpeedLimits).mockReturnValue(new Promise<void>((_resolve, reject) => (refuse = () => reject(new Error('500')))))
    renderScreen()
    await userEvent.click(await screen.findByRole('button', { name: 'More actions: Dune: Part Two' }))
    await userEvent.click(within(screen.getByRole('dialog', { name: 'Dune: Part Two' })).getByRole('button', { name: 'Speed limits' }))
    const sheet = screen.getByRole('dialog', { name: 'Speed limits' })
    await userEvent.type(within(sheet).getByRole('textbox', { name: 'Download limit, MB/s' }), '2')
    await userEvent.click(within(sheet).getByRole('button', { name: 'Save limits' }))

    getMainData.mockResolvedValue(mainData([]))
    window.dispatchEvent(new Event('online'))
    expect(await screen.findByText('Torrent not found')).toBeInTheDocument()
    refuse()
    expect(await screen.findByRole('status')).toHaveTextContent(/^Couldn’t save the speed limits of .+, or saved only some/)
  })

  it('reannounces, and rechecks after a confirmation, from the More menu, each with a toast', async () => {
    vi.mocked(api.recheckTorrents).mockResolvedValue()
    vi.mocked(api.reannounceTorrents).mockResolvedValue()
    renderScreen()
    await userEvent.click(await screen.findByRole('button', { name: 'More actions: Dune: Part Two' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Reannounce' }))
    expect(api.reannounceTorrents).toHaveBeenCalledWith(['dune'])
    expect(await findToastOnPage('Announced to the trackers')).toBeInTheDocument()
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'More actions: Dune: Part Two' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Force recheck' }))
    const dialog = screen.getByRole('alertdialog', { name: 'Recheck the files?' })
    expect(dialog).toHaveTextContent('Dune: Part Two')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Force recheck' }))
    expect(api.recheckTorrents).toHaveBeenCalledWith(['dune'])
    expect(await findToastOnPage('Checking the files')).toBeInTheDocument()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('drops a recheck confirmation whose torrent went away, so it doesn’t open again when the torrent is back', async () => {
    renderScreen()
    await userEvent.click(await screen.findByRole('button', { name: 'More actions: Dune: Part Two' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Force recheck' }))
    expect(screen.getByRole('alertdialog', { name: 'Recheck the files?' })).toBeInTheDocument()

    getMainData.mockResolvedValue(mainData([]))
    window.dispatchEvent(new Event('online'))
    expect(await screen.findByText('Torrent not found')).toBeInTheDocument()

    getMainData.mockResolvedValue(snapshot())
    window.dispatchEvent(new Event('online'))
    expect(await screen.findByRole('button', { name: 'More actions: Dune: Part Two' })).toBeInTheDocument()
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
  })

  it('drops a recheck confirmation when another torrent with the same hash replaces its torrent between two polls', async () => {
    renderScreen()
    await userEvent.click(await screen.findByRole('button', { name: 'More actions: Dune: Part Two' }))
    await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Force recheck' }))
    expect(screen.getByRole('alertdialog', { name: 'Recheck the files?' })).toBeInTheDocument()

    getMainData.mockResolvedValue(snapshot({ added_on: DUNE_TORRENT.added_on + 60 }))
    window.dispatchEvent(new Event('online'))
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument())
    // The replaced torrent isn't taken for a missing one: the screen stays, not "Torrent not found".
    expect(screen.getByRole('button', { name: 'More actions: Dune: Part Two' })).toBeInTheDocument()
  })

  it.each<[string, () => Promise<void>, () => HTMLElement | null]>([
    [
      'the More menu',
      async () => userEvent.click(await screen.findByRole('button', { name: 'More actions: Dune: Part Two' })),
      () => screen.queryByRole('dialog', { name: 'Dune: Part Two' }),
    ],
    [
      'the delete confirmation',
      async () => userEvent.click(await screen.findByRole('button', { name: 'Delete' })),
      () => screen.queryByRole('alertdialog', { name: 'Delete torrent?' }),
    ],
    [
      'the title sheet',
      async () => {
        vi.mocked(tmdb.searchTitles).mockResolvedValue(searchPage([]))
        await userEvent.click(await screen.findByRole('button', { name: 'More actions: Dune: Part Two' }))
        await userEvent.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Change title' }))
      },
      () => screen.queryByRole('dialog', { name: 'Change title' }),
    ],
  ])('closes %s when another torrent with the same hash replaces its torrent between two polls', async (_overlay, open, overlay) => {
    renderScreen()
    await open()
    expect(overlay()).toBeInTheDocument()

    getMainData.mockResolvedValue(snapshot({ added_on: DUNE_TORRENT.added_on + 60 }))
    window.dispatchEvent(new Event('online'))
    // Confirming a delete then would delete the torrent that replaced it.
    await waitFor(() => expect(overlay()).not.toBeInTheDocument())
  })

  it('shows the torrent’s files', async () => {
    renderScreen()
    await userEvent.click(await screen.findByRole('button', { name: 'Files' }))
    const files = screen.getByRole('region', { name: /Files/ })
    expect(await within(files).findByRole('combobox', { name: 'Priority: Extras.mkv' })).toHaveValue('skip')
  })
})

describe('TorrentScreen title matching', () => {
  const GUESSED_DUNE: tmdb.Title = {
    type: 'movie',
    id: 693134,
    title: 'Dune: Part Two',
    originalTitle: 'Dune: Part Two',
    year: 2024,
    overview: '',
    posterPath: '/dune.jpg',
    backdropPath: null,
    rating: 8,
  }
  const DUNE_1984: tmdb.Title = { ...GUESSED_DUNE, id: 841, title: 'Dune', originalTitle: 'Dune', year: 1984 }

  it('asks whether a guessed title is right and saves the confirmation', async () => {
    getMainData.mockResolvedValue(snapshot({ tags: '' }))
    vi.mocked(tmdb.searchTitles).mockResolvedValue(searchPage([GUESSED_DUNE]))
    renderScreen()
    expect(await screen.findByRole('heading', { level: 1, name: 'Dune: Part Two' })).toBeInTheDocument()
    expect(await screen.findByText('Matched by the release name. Is it right?')).toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'Yes, right' }))
    expect(await screen.findByRole('status', { name: saying('Match confirmed') })).toBeInTheDocument()
    expect(screen.queryByText('Matched by the release name. Is it right?')).not.toBeInTheDocument()
  })

  it('changes a guessed title through the TMDB search', async () => {
    getMainData.mockResolvedValue(snapshot({ tags: '' }))
    vi.mocked(tmdb.searchTitles).mockImplementation(async (query) => searchPage(query === 'Dune Part Two' ? [GUESSED_DUNE, DUNE_1984] : []))
    renderScreen()
    await userEvent.click(await screen.findByRole('button', { name: 'Change' }))
    const sheet = screen.getByRole('dialog', { name: 'Change title' })
    await userEvent.click(await within(sheet).findByRole('button', { name: /^Dune Movie · 1984$/ }))
    expect(await findToastOnPage('Title changed')).toBeInTheDocument()
    expect(await screen.findByRole('heading', { level: 1, name: 'Dune' })).toBeInTheDocument()
    expect(screen.queryByText('Matched by the release name. Is it right?')).not.toBeInTheDocument()
  })

  it('doesn’t ask about a title Kinoseed tagged, and changes it from the More menu', async () => {
    vi.mocked(tmdb.searchTitles).mockResolvedValue(searchPage([GUESSED_DUNE, DUNE_1984]))
    renderScreen()
    expect(await screen.findByRole('heading', { level: 1, name: 'Dune: Part Two' })).toBeInTheDocument()
    expect(screen.queryByText('Matched by the release name. Is it right?')).not.toBeInTheDocument()

    await userEvent.click(screen.getByRole('button', { name: 'More actions: Dune: Part Two' }))
    const menu = screen.getByRole('dialog', { name: 'Dune: Part Two' })
    expect(within(menu).queryByRole('link', { name: 'Open details' })).not.toBeInTheDocument()
    expect(within(menu).getByRole('link', { name: 'Movie page' })).toHaveAttribute('href', '/title/movie/693134')
    await userEvent.click(within(menu).getByRole('button', { name: 'Change title' }))
    const sheet = screen.getByRole('dialog', { name: 'Change title' })
    expect(await within(sheet).findByRole('button', { name: /^Dune: Part Two/ })).toHaveAttribute('aria-current', 'true')
  })

  it('offers to pick a title when none was found', async () => {
    getMainData.mockResolvedValue(snapshot({ tags: '', name: 'Some.Home.Video' }))
    vi.mocked(tmdb.searchTitles).mockResolvedValue(searchPage([]))
    renderScreen()
    expect(await screen.findByText('No title found for this release.')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Pick title' }))
    expect(screen.getByRole('dialog', { name: 'Pick title' })).toBeInTheDocument()
  })
})
