import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Profiler, type ReactNode } from 'react'
import { MemoryRouter, Route, Routes } from 'react-router'
import { beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import * as prowlarr from '../api/prowlarr'
import { SERVER_SETTINGS_KEY, type ServerSettings } from '../api/settings'
import type { Release } from '../api/prowlarr'
import * as qbt from '../api/qbittorrent'
import * as adding from '../releases/addRelease'
import { sharedRequests } from '../logic/sharedRequests'
import { parseRelease } from '../releases/parseRelease'
import { resetSettings, updateSettings } from '../settings/settings'
import * as torrentFile from '../torrents/torrentFile'
import { MainDataContext, createMainDataStore, type MainDataStore } from '../torrents/useMainData'
import { AddReleaseSheet, type AddReleaseSheetProps } from './AddReleaseSheet'
import { namesTheFailedLink } from '../test/failedLinks'
import { torrent } from '../test/fixtures'
import { ROUTER_OPTIONS } from '../lib/routerOptions'
import { Opened, opened, qbittorrentDown, saying } from '../test/render'

vi.mock('../api/prowlarr', async (importOriginal) => ({
  ...(await importOriginal<typeof prowlarr>()),
  fetchRelease: vi.fn(),
}))
vi.mock('../api/qbittorrent', async (importOriginal) => ({
  ...(await importOriginal<typeof qbt>()),
  getSaveLocations: vi.fn(),
  getMainData: vi.fn(),
  getTorrents: vi.fn(),
}))
vi.mock('../releases/addRelease', async (importOriginal) => ({ ...(await importOriginal<typeof adding>()), addRelease: vi.fn() }))
vi.mock('../torrents/torrentFile', async (importOriginal) => ({
  ...(await importOriginal<typeof torrentFile>()),
  readTorrentFile: vi.fn(),
}))

const fetchRelease = vi.mocked(prowlarr.fetchRelease)
const getMainData = vi.mocked(qbt.getMainData)
const getTorrents = vi.mocked(qbt.getTorrents)
const commits = vi.fn()
const addRelease = vi.mocked(adding.addRelease)
const readTorrentFile = vi.mocked(torrentFile.readTorrentFile)

const RELEASE: Release = {
  id: 'bb',
  title: 'Breaking.Bad.S01-S02.1080p.BluRay.x264',
  indexer: 'Indexer C',
  size: 50e9,
  seeders: 486,
  categories: [5000],
  download: '1/download?link=bb',
  infoUrl: 'https://tracker.test/bb',
}
const FILE = new File([new Uint8Array([1])], 'bb.torrent')
const META = {
  infoHash: 'c12fe1c06bba254a9dc9f519b335aa7c1367a88a',
  name: 'Breaking Bad',
  files: [
    { path: 'Season 1/e01.mkv', size: 10e9 },
    { path: 'Season 2/e01.mkv', size: 20e9 },
    { path: 'Season 2/e02.mkv', size: 20e9 },
  ],
  totalSize: 50e9,
  multiFile: true,
}

/** The page's answer of the server's settings, with a channel to notify through or without. */
function serverHasChannel(notifications: boolean) {
  sharedRequests.set<ServerSettings>(SERVER_SETTINGS_KEY, {
    tmdb: { configured: true, source: 'env', fallback: 'env' },
    prowlarr: { configured: true, source: 'env', serverKey: true, address: { source: 'env' } },
    qbittorrent: { configured: true, source: 'env', address: { source: 'env' } },
    downloads: null,
    notifications,
  })
}

/** The app's shared poll, in use by a screen and answered once. */
async function runningPoll() {
  const store = createMainDataStore()
  onTestFinished(store.subscribe(() => {}))
  await waitFor(() => expect(store.getSnapshot().data).not.toBeNull())
  return store
}

const RELEASES_PAGE = '/title/tv/1396/releases'

const TV_TITLE = { type: 'tv', id: 1396, name: 'Breaking Bad', posterPath: null } as const
const MOVIE_TITLE = { type: 'movie', id: 329865, name: 'Arrival', year: 2016, posterPath: null } as const
const MOVIE_META = {
  infoHash: 'd4a8e0f6ba5bd0f53c3e2a3ba44a7a1e5d5e4f11',
  name: 'Arrival.2016.1080p.BluRay-GRPA',
  files: [
    { path: 'Arrival.2016.1080p.BluRay-GRPA.mkv', size: 9e9 },
    { path: 'Arrival.2016.1080p.BluRay-GRPA.en.srt', size: 1e5 },
  ],
  totalSize: 9.0001e9,
  multiFile: true,
}

function renderSheet(release = RELEASE, store?: MainDataStore, title: AddReleaseSheetProps['title'] = TV_TITLE) {
  const onAdded = vi.fn()
  const onClose = vi.fn()
  const page = (shown: AddReleaseSheetProps['title']) => (
    <MemoryRouter initialEntries={[RELEASES_PAGE]} {...ROUTER_OPTIONS}>
      <Routes>
        <Route
          path={RELEASES_PAGE}
          element={<AddReleaseSheet release={release} info={parseRelease(release.title)} title={shown} onClose={onClose} onAdded={onAdded} />}
        />
        <Route path="/torrent/:hash" element={<Opened />} />
      </Routes>
    </MemoryRouter>
  )
  const { rerender, unmount } = render(page(title), {
    wrapper:
      store &&
      (({ children }: { children: ReactNode }) => (
        <MainDataContext value={store}>
          <Profiler id="sheet" onRender={commits}>
            {children}
          </Profiler>
        </MainDataContext>
      )),
  })
  /** The sheet shown for another title, as the same sheet. */
  const retitle = (shown: AddReleaseSheetProps['title']) => rerender(page(shown))
  return { onAdded, onClose, unmount, retitle }
}

beforeEach(() => {
  vi.resetAllMocks()
  resetSettings()
  fetchRelease.mockResolvedValue({ kind: 'torrent', file: FILE })
  readTorrentFile.mockResolvedValue(META)
  vi.mocked(qbt.getSaveLocations).mockResolvedValue({
    categories: [
      { name: 'Movies', savePath: '/data/movies' },
      { name: 'TV', savePath: '/data/tv' },
    ],
    defaultPath: '/data',
    categoryPaths: true,
    subcategories: false,
    relocateOnCategoryChange: true,
    downloadPath: false,
  })
  getMainData.mockResolvedValue({ rid: 1, server_state: { free_space_on_disk: 40e9 } })
  addRelease.mockResolvedValue()
  getTorrents.mockResolvedValue([])
})

describe('AddReleaseSheet', () => {
  it('picks files by season and adds the release to its category with the title tag', async () => {
    const { onAdded } = renderSheet()
    const sheet = screen.getByRole('dialog', { name: 'Add to downloads' })
    expect(within(sheet).getByText('Breaking Bad')).toBeInTheDocument()
    expect(within(sheet).getByRole('link', { name: 'Open on Indexer C' })).toHaveAttribute('href', 'https://tracker.test/bb')
    expect(await within(sheet).findByText('TV → /data/tv')).toBeInTheDocument()
    // A .torrent's files can be picked, so the magnet link's note isn't there.
    expect(within(sheet).queryByText(/^Magnet link:/)).not.toBeInTheDocument()

    await userEvent.click(await within(sheet).findByRole('button', { name: /Files: all \(3\)/ }))
    const picker = screen.getByRole('dialog', { name: 'Select files' })
    await userEvent.click(within(picker).getByRole('checkbox', { name: 'Season 1' }))
    await userEvent.click(within(picker).getByRole('button', { name: /Season 2/ }))
    await userEvent.click(within(picker).getByRole('checkbox', { name: 'e02.mkv' }))
    await userEvent.click(within(picker).getByRole('button', { name: 'Done' }))

    const back = screen.getByRole('dialog', { name: 'Add to downloads' })
    expect(within(back).getByRole('button', { name: /Files: 1 of 3/ })).toBeInTheDocument()
    await userEvent.click(within(back).getByRole('button', { name: /^Download · 20\.0\sGB$/ }))

    expect(addRelease).toHaveBeenCalledWith(
      { kind: 'torrent', file: FILE },
      {
        tags: ['tmdb:tv:1396'],
        category: 'TV',
        savePath: undefined,
        paused: false,
        sequential: false,
        firstLastPieces: false,
        topOfQueue: false,
      },
      { meta: META, skip: [0, 2] },
    )
    expect(onAdded).toHaveBeenCalled()
  })

  it('applies the chosen options', async () => {
    renderSheet()
    const sheet = screen.getByRole('dialog', { name: 'Add to downloads' })
    await userEvent.click(await within(sheet).findByRole('button', { name: 'Options' }))
    await userEvent.click(await within(sheet).findByRole('button', { name: 'No category' }))
    // A path isn't a word, so the browser doesn't underline it.
    expect(within(sheet).getByLabelText('Folder')).toHaveAttribute('spellcheck', 'false')
    // Nor does iOS Safari correct it (#494).
    expect(within(sheet).getByLabelText('Folder')).toHaveAttribute('autocorrect', 'off')
    await userEvent.type(within(sheet).getByLabelText('Folder'), '/mnt/tv')
    await userEvent.click(within(sheet).getByRole('switch', { name: 'Start paused' }))
    await userEvent.click(within(sheet).getByRole('switch', { name: 'First and last pieces first' }))
    await userEvent.click(within(sheet).getByRole('switch', { name: 'Add to top of queue' }))
    expect(within(sheet).getByText('/mnt/tv')).toBeInTheDocument()
    await userEvent.click(await within(sheet).findByRole('button', { name: /^Download/ }))

    expect(addRelease).toHaveBeenCalledWith(
      expect.anything(),
      {
        tags: ['tmdb:tv:1396'],
        category: undefined,
        savePath: '/mnt/tv',
        paused: true,
        sequential: false,
        firstLastPieces: true,
        topOfQueue: true,
      },
      { meta: META, skip: [] },
    )
  })

  it('offers Notify when finished while the server has a channel, and tags the torrent for it', async () => {
    serverHasChannel(true)
    renderSheet()
    const sheet = screen.getByRole('dialog', { name: 'Add to downloads' })
    await userEvent.click(await within(sheet).findByRole('button', { name: 'Options' }))
    const notify = within(sheet).getByRole('switch', { name: 'Notify when finished' })
    expect(notify).not.toBeChecked()
    await userEvent.click(notify)
    await userEvent.click(await within(sheet).findByRole('button', { name: /^Download/ }))
    expect(addRelease).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ tags: ['tmdb:tv:1396', 'kinopeer:notify'] }), expect.anything())
  })

  it('starts Notify when finished from the default in Settings', async () => {
    serverHasChannel(true)
    updateSettings({ notify: true })
    renderSheet()
    const sheet = screen.getByRole('dialog', { name: 'Add to downloads' })
    await userEvent.click(await within(sheet).findByRole('button', { name: /^Download/ }))
    expect(addRelease).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ tags: ['tmdb:tv:1396', 'kinopeer:notify'] }), expect.anything())
  })

  it('neither offers Notify when finished nor applies its default without a channel to notify through', async () => {
    serverHasChannel(false)
    updateSettings({ notify: true })
    renderSheet()
    const sheet = screen.getByRole('dialog', { name: 'Add to downloads' })
    await userEvent.click(await within(sheet).findByRole('button', { name: 'Options' }))
    expect(within(sheet).getByRole('switch', { name: 'Add to top of queue' })).toBeInTheDocument()
    expect(within(sheet).queryByRole('switch', { name: 'Notify when finished' })).not.toBeInTheDocument()
    await userEvent.click(await within(sheet).findByRole('button', { name: /^Download/ }))
    expect(addRelease).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ tags: ['tmdb:tv:1396'] }), expect.anything())
  })

  it('marks the category the torrent goes to', async () => {
    renderSheet()
    const sheet = screen.getByRole('dialog', { name: 'Add to downloads' })
    await userEvent.click(await within(sheet).findByRole('button', { name: 'Options' }))
    // A series goes to the category named like its type.
    const tv = await within(sheet).findByRole('button', { name: 'TV' })
    const none = within(sheet).getByRole('button', { name: 'No category' })
    expect(tv).toHaveAttribute('aria-pressed', 'true')
    expect(none).toHaveAttribute('aria-pressed', 'false')

    await userEvent.click(none)
    expect(none).toHaveAttribute('aria-pressed', 'true')
    expect(tv).toHaveAttribute('aria-pressed', 'false')
  })

  it('starts from the defaults in Settings', async () => {
    updateSettings({ tvCategory: 'Movies', startPaused: true, sequential: true, firstLastPieces: true })
    renderSheet()
    const sheet = screen.getByRole('dialog', { name: 'Add to downloads' })
    expect(await within(sheet).findByText('Movies → /data/movies')).toBeInTheDocument()
    await userEvent.click(await within(sheet).findByRole('button', { name: /^Download/ }))
    expect(addRelease).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ category: 'Movies', paused: true, sequential: true, firstLastPieces: true }),
      expect.anything(),
    )
  })

  it('follows defaults that arrive after it opened, until the user flips them', async () => {
    renderSheet()
    const sheet = screen.getByRole('dialog', { name: 'Add to downloads' })
    await userEvent.click(await within(sheet).findByRole('button', { name: 'Options' }))
    const paused = within(sheet).getByRole('switch', { name: 'Start paused' })
    const sequential = within(sheet).getByRole('switch', { name: 'Sequential download' })
    const firstLast = within(sheet).getByRole('switch', { name: 'First and last pieces first' })
    expect(paused).not.toBeChecked()
    expect(firstLast).not.toBeChecked()

    // The server's defaults load while the sheet is open.
    act(() => updateSettings({ startPaused: true, firstLastPieces: true }))
    expect(paused).toBeChecked()
    expect(firstLast).toBeChecked()

    await userEvent.click(sequential)
    act(() => updateSettings({ sequential: false, startPaused: false }))
    expect(sequential).toBeChecked()
    expect(paused).not.toBeChecked()
  })

  it('retries getting the torrent and adds a magnet link without file selection', async () => {
    fetchRelease.mockRejectedValueOnce(new prowlarr.ProwlarrError('down', 502, 'upstream'))
    fetchRelease.mockResolvedValueOnce({ kind: 'magnet', uri: 'magnet:?xt=urn:btih:abc' })
    renderSheet()
    const sheet = screen.getByRole('dialog', { name: 'Add to downloads' })
    expect(within(sheet).getByRole('button', { name: /^Download/ })).toBeDisabled()
    await userEvent.click(await within(sheet).findByRole('button', { name: 'Try again' }))

    expect(await within(sheet).findByText(/Magnet link: all files/)).toBeInTheDocument()
    expect(within(sheet).queryByRole('button', { name: /Files:/ })).not.toBeInTheDocument()
    await userEvent.click(within(sheet).getByRole('button', { name: /^Download · 50\.0\sGB$/ }))
    expect(addRelease).toHaveBeenCalledWith({ kind: 'magnet', uri: 'magnet:?xt=urn:btih:abc' }, expect.anything(), undefined)
  })

  it('cancels asking for the folders when the sheet goes away', async () => {
    vi.mocked(qbt.getSaveLocations).mockReturnValue(new Promise(() => {}))
    const { unmount } = renderSheet()
    await waitFor(() => expect(vi.mocked(qbt.getSaveLocations).mock.lastCall?.[0]?.aborted).toBe(false))

    unmount()
    expect(vi.mocked(qbt.getSaveLocations).mock.lastCall?.[0]?.aborted).toBe(true)
  })

  it('shows the default save path for a category when qBittorrent doesn’t use category folders', async () => {
    vi.mocked(qbt.getSaveLocations).mockResolvedValue({
      categories: [{ name: 'TV', savePath: '/data/tv' }],
      defaultPath: '/data',
      categoryPaths: false,
      subcategories: false,
      relocateOnCategoryChange: true,
      downloadPath: false,
    })
    renderSheet()
    expect(await screen.findByText('TV → /data')).toBeInTheDocument()
  })

  it('works without categories, a default path or the free space from qBittorrent', async () => {
    // getSaveLocations turns qBittorrent's refusals into empty answers.
    vi.mocked(qbt.getSaveLocations).mockResolvedValue({ categories: [], defaultPath: '', categoryPaths: false, subcategories: false, relocateOnCategoryChange: true, downloadPath: false })
    getMainData.mockRejectedValue(new TypeError('Failed to fetch'))
    renderSheet()
    const sheet = screen.getByRole('dialog', { name: 'Add to downloads' })
    const files = await within(sheet).findByRole('button', { name: /Files: all \(3\)/ })
    expect(files).not.toHaveTextContent(/free/)
    expect(within(sheet).queryByText('Not enough free space')).not.toBeInTheDocument()
    expect(within(sheet).queryByText(/→/)).not.toBeInTheDocument()

    await userEvent.click(await within(sheet).findByRole('button', { name: 'Options' }))
    expect(within(sheet).queryByRole('group', { name: 'Category' })).not.toBeInTheDocument()
    expect(within(sheet).getByLabelText('Folder')).toHaveAttribute('placeholder', '')

    await userEvent.click(files)
    const picker = screen.getByRole('dialog', { name: 'Select files' })
    expect(within(picker).queryByText(/free/)).not.toBeInTheDocument()
    await userEvent.click(within(picker).getByRole('button', { name: 'Done' }))

    await userEvent.click(within(screen.getByRole('dialog', { name: 'Add to downloads' })).getByRole('button', { name: /^Download/ }))
    expect(addRelease).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ category: undefined, savePath: undefined }),
      { meta: META, skip: [] },
    )
  })

  it('warns while the selected files need more than the free space, without blocking the download', async () => {
    renderSheet()
    const sheet = screen.getByRole('dialog', { name: 'Add to downloads' })
    expect(await within(sheet).findByRole('status', { name: saying('Not enough free space') })).toBeInTheDocument()
    expect(
      within(sheet).getByRole('status', {
        name: saying(/^40\.0\sGB free on qBittorrent’s disk, 10\.0\sGB short of this download\. Skip some files/),
      }),
    ).toBeInTheDocument()
    // Once qBittorrent has said it doesn't have the torrent, which may come after the free space.
    await waitFor(() => expect(within(sheet).getByRole('button', { name: /^Download · 50\.0\sGB$/ })).toBeEnabled())

    await userEvent.click(within(sheet).getByRole('button', { name: /Files: all \(3\)/ }))
    const picker = screen.getByRole('dialog', { name: 'Select files' })
    await userEvent.click(within(picker).getByRole('checkbox', { name: 'Season 1' }))
    await userEvent.click(within(picker).getByRole('button', { name: 'Done' }))
    // 40 GB selected fits exactly.
    expect(within(screen.getByRole('dialog', { name: 'Add to downloads' })).queryByText('Not enough free space')).not.toBeInTheDocument()
  })

  it('takes the free space from the poll another screen runs, without asking qBittorrent for everything again', async () => {
    const store = await runningPoll()
    renderSheet(RELEASE, store)
    const sheet = screen.getByRole('dialog', { name: 'Add to downloads' })
    expect(await within(sheet).findByRole('status', { name: saying('Not enough free space') })).toBeInTheDocument()
    // rid 0 asks for every torrent, and it would make the poll's next answer a full one too.
    expect(getMainData.mock.calls.filter(([rid]) => rid === 0)).toHaveLength(1)
  })

  it('doesn’t wait for the free space: the warning comes with the poll’s first answer', async () => {
    let answer: (data: qbt.MainData) => void = () => {}
    getMainData.mockReturnValueOnce(new Promise((resolve) => (answer = resolve)))
    renderSheet()
    const sheet = screen.getByRole('dialog', { name: 'Add to downloads' })
    expect(await within(sheet).findByText('TV → /data/tv')).toBeInTheDocument()
    const files = await within(sheet).findByRole('button', { name: /Files: all \(3\)/ })
    expect(files).not.toHaveTextContent(/free/)
    expect(within(sheet).queryByRole('status', { name: saying('Not enough free space') })).not.toBeInTheDocument()

    answer({ rid: 1, server_state: { free_space_on_disk: 40e9 } })
    expect(await within(sheet).findByRole('status', { name: saying('Not enough free space') })).toBeInTheDocument()
    expect(files).toHaveTextContent(/40\.0\sGB free/)
  })

  it('keeps the warning and the file picker current with the poll while it’s open', async () => {
    const store = await runningPoll()
    renderSheet(RELEASE, store)
    const sheet = screen.getByRole('dialog', { name: 'Add to downloads' })
    await within(sheet).findByRole('status', { name: saying('Not enough free space') })
    await userEvent.click(await within(sheet).findByRole('button', { name: /Files: all \(3\)/ }))
    const picker = screen.getByRole('dialog', { name: 'Select files' })
    expect(within(picker).getByText('Not enough free space')).toBeInTheDocument()

    getMainData.mockResolvedValue({ rid: 2, server_state: { free_space_on_disk: 80e9 } })
    act(() => store.refresh())
    expect(await within(picker).findByText(/80\.0\sGB free/)).toBeInTheDocument()
    expect(within(picker).queryByText('Not enough free space')).not.toBeInTheDocument()

    await userEvent.click(within(picker).getByRole('button', { name: 'Done' }))
    const back = screen.getByRole('dialog', { name: 'Add to downloads' })
    expect(within(back).getByRole('button', { name: /Files: all \(3\)/ })).toHaveTextContent(/80\.0\sGB free/)
    expect(within(back).queryByRole('status', { name: saying('Not enough free space') })).not.toBeInTheDocument()
  })

  it('doesn’t render again, the file picker included, for a poll that leaves the free space as it was', async () => {
    const store = await runningPoll()
    renderSheet(RELEASE, store)
    const sheet = screen.getByRole('dialog', { name: 'Add to downloads' })
    await within(sheet).findByRole('status', { name: saying('Not enough free space') })
    await userEvent.click(await within(sheet).findByRole('button', { name: /Files: all \(3\)/ }))
    screen.getByRole('dialog', { name: 'Select files' })
    const settled = commits.mock.calls.length

    getMainData.mockResolvedValue({ rid: 2, server_state: { dl_info_speed: 1 } })
    act(() => store.refresh())
    await waitFor(() => expect(store.getSnapshot().data?.server.dl_info_speed).toBe(1))
    expect(commits).toHaveBeenCalledTimes(settled)
  })

  it('asks only to free up space for a one-file torrent, which has no files to skip', async () => {
    readTorrentFile.mockResolvedValue({ ...META, files: [{ path: 'Breaking Bad', size: 50e9 }] })
    renderSheet()
    const sheet = screen.getByRole('dialog', { name: 'Add to downloads' })
    expect(await within(sheet).findByRole('status', { name: saying(/10\.0\sGB short of this download\. Free up space before it finishes\.$/) })).toBeInTheDocument()
    expect(within(sheet).queryByText(/Skip some files/)).not.toBeInTheDocument()
    // Nor a list of files to pick from.
    expect(within(sheet).queryByRole('button', { name: /^Files/ })).not.toBeInTheDocument()
  })

  it('doesn’t send a torrent with every file skipped', async () => {
    renderSheet()
    await userEvent.click(await screen.findByRole('button', { name: /Files: all \(3\)/ }))
    const picker = screen.getByRole('dialog', { name: 'Select files' })
    await userEvent.click(within(picker).getByRole('button', { name: 'Deselect all' }))
    // Done waits for a file, but Back leaves with none.
    await userEvent.click(within(picker).getByRole('button', { name: 'Back' }))
    expect(within(screen.getByRole('dialog', { name: 'Add to downloads' })).getByRole('button', { name: /^Download/ })).toBeDisabled()
  })

  it('offers no form, the free space warning included, when the torrent can’t be fetched', async () => {
    fetchRelease.mockRejectedValue(new prowlarr.ProwlarrError('down', 502, 'upstream'))
    renderSheet(RELEASE, await runningPoll())
    const sheet = screen.getByRole('dialog', { name: 'Add to downloads' })
    expect(await within(sheet).findByRole('alert', { name: saying('Couldn’t get the torrent from Prowlarr.') })).toBeInTheDocument()
    // The folders and the poll's free space in, which the form would show.
    await waitFor(() => expect(vi.mocked(qbt.getSaveLocations)).toHaveBeenCalled())
    await act(async () => {})
    expect(within(sheet).queryByText('Not enough free space')).not.toBeInTheDocument()
    expect(within(sheet).queryByText('TV → /data/tv')).not.toBeInTheDocument()
    expect(within(sheet).queryByRole('button', { name: 'Options' })).not.toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: /^Download/ })).toBeDisabled()
  })

  it('doesn’t warn by the release size when the .torrent can’t be read', async () => {
    readTorrentFile.mockRejectedValue(new Error('not bencoded'))
    renderSheet(RELEASE, await runningPoll())
    const sheet = screen.getByRole('dialog', { name: 'Add to downloads' })
    expect(await within(sheet).findByText('TV → /data/tv')).toBeInTheDocument()
    await waitFor(() => expect(within(sheet).getByRole('button', { name: /^Download · 50\.0\sGB$/ })).toBeEnabled())
    expect(within(sheet).queryByText('Not enough free space')).not.toBeInTheDocument()
  })

  it.each([0, -1])('treats %s free as unknown: no warning and no free space shown', async (free) => {
    getMainData.mockResolvedValue({ rid: 1, server_state: { free_space_on_disk: free } })
    renderSheet(RELEASE, await runningPoll())
    const sheet = screen.getByRole('dialog', { name: 'Add to downloads' })
    expect(await within(sheet).findByText('TV → /data/tv')).toBeInTheDocument()
    const files = await within(sheet).findByRole('button', { name: /Files: all \(3\)/ })
    expect(files).not.toHaveTextContent(/free/)
    expect(within(sheet).queryByText('Not enough free space')).not.toBeInTheDocument()

    await userEvent.click(files)
    const picker = screen.getByRole('dialog', { name: 'Select files' })
    expect(within(picker).queryByText('Not enough free space')).not.toBeInTheDocument()
    expect(within(picker).queryByText(/free/)).not.toBeInTheDocument()
  })

  it('warns about a magnet link by the release size', async () => {
    fetchRelease.mockResolvedValue({ kind: 'magnet', uri: 'magnet:?xt=urn:btih:abc' })
    getMainData.mockResolvedValue({ rid: 1, server_state: { free_space_on_disk: 10e9 } })
    renderSheet()
    const sheet = screen.getByRole('dialog', { name: 'Add to downloads' })
    expect(await within(sheet).findByText(/Magnet link: all files/)).toBeInTheDocument()
    expect(
      await within(sheet).findByRole('status', { name: saying(/40\.0\sGB short of this download\. Free up space before it finishes\./) }),
    ).toBeInTheDocument()
    expect(within(sheet).getByRole('button', { name: /^Download/ })).toBeEnabled()
  })

  it('adds the link qBittorrent follows itself in the WebUI build, warned by the release size, with all its files', async () => {
    vi.stubGlobal('__WEBUI__', true)
    const link = 'http://192.168.1.20:9696/api/v1/indexer/1/download?link=abc&apikey=k'
    fetchRelease.mockResolvedValue({ kind: 'link', uri: link })
    getMainData.mockResolvedValue({ rid: 1, server_state: { free_space_on_disk: 10e9 } })
    const { onAdded } = renderSheet()
    const sheet = screen.getByRole('dialog', { name: 'Add to downloads' })
    expect(await within(sheet).findByText(/Prowlarr gave a link qBittorrent fetches itself, so all files are downloaded/)).toBeInTheDocument()
    expect(within(sheet).queryByText(/Magnet link: all files/)).not.toBeInTheDocument()
    expect(
      await within(sheet).findByRole('status', { name: saying(/40\.0\sGB short of this download\. Free up space before it finishes\./) }),
    ).toBeInTheDocument()
    await userEvent.click(within(sheet).getByRole('button', { name: /^Download/ }))
    await waitFor(() => expect(onAdded).toHaveBeenCalled())
    expect(addRelease).toHaveBeenCalledWith({ kind: 'link', uri: link }, expect.anything(), undefined)
  })

  it('says a magnet link’s files in the WebUI build as in the server build', async () => {
    vi.stubGlobal('__WEBUI__', true)
    fetchRelease.mockResolvedValue({ kind: 'magnet', uri: 'magnet:?xt=urn:btih:abc' })
    renderSheet()
    const sheet = screen.getByRole('dialog', { name: 'Add to downloads' })
    expect(await within(sheet).findByText(/Magnet link: all files/)).toBeInTheDocument()
    expect(within(sheet).queryByText(/Prowlarr gave a link/)).not.toBeInTheDocument()
  })

  it('neither notes the files of a .torrent it can’t read nor warns by the release size in the WebUI build', async () => {
    vi.stubGlobal('__WEBUI__', true)
    readTorrentFile.mockRejectedValue(new Error('not bencoded'))
    renderSheet(RELEASE, await runningPoll())
    const sheet = screen.getByRole('dialog', { name: 'Add to downloads' })
    expect(await within(sheet).findByText('TV → /data/tv')).toBeInTheDocument()
    await waitFor(() => expect(within(sheet).getByRole('button', { name: /^Download · 50\.0\sGB$/ })).toBeEnabled())
    expect(within(sheet).queryByText('Not enough free space')).not.toBeInTheDocument()
    expect(within(sheet).queryByText(/Magnet link: all files|Prowlarr gave a link/)).not.toBeInTheDocument()
  })

  it('says qBittorrent refused the torrent when it then doesn’t have it', async () => {
    addRelease.mockRejectedValue(new qbt.TorrentRefusedError(200))
    const { onAdded } = renderSheet()
    await userEvent.click(await screen.findByRole('button', { name: /^Download/ }))
    expect(await screen.findByRole('alert', { name: saying('qBittorrent didn’t add the torrent.') })).toBeInTheDocument()
    expect(getTorrents).toHaveBeenLastCalledWith({ hashes: [META.infoHash] }, undefined)
    expect(onAdded).not.toHaveBeenCalled()
  })

  it('says the torrent is already in downloads when qBittorrent refused it and has it', async () => {
    addRelease.mockRejectedValue(new qbt.TorrentRefusedError(409))
    // Added meanwhile, from another device: qBittorrent has it by the time it refuses it.
    getTorrents.mockResolvedValueOnce([]).mockResolvedValueOnce([torrent(META.infoHash)])
    const { onAdded } = renderSheet()
    await userEvent.click(await screen.findByRole('button', { name: /^Download/ }))
    expect(await screen.findByRole('status', { name: saying('Already in downloads') })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Open details' })).toHaveAttribute('href', `/torrent/${META.infoHash}`)
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(onAdded).not.toHaveBeenCalled()
  })

  it('says it may already be in downloads when qBittorrent refused it and can’t be asked then', async () => {
    addRelease.mockRejectedValue(new qbt.TorrentRefusedError(200))
    getTorrents.mockResolvedValueOnce([]).mockRejectedValueOnce(qbittorrentDown())
    renderSheet()
    await userEvent.click(await screen.findByRole('button', { name: /^Download/ }))
    expect(await screen.findByRole('alert', { name: saying('qBittorrent didn’t add the torrent. It may already be in your downloads.') })).toBeInTheDocument()
  })

  it('says qBittorrent refused a v1 magnet link when it then doesn’t have it', async () => {
    const hash = 'c9e15763f722f23e98a29decdfae341b98d53056'
    fetchRelease.mockResolvedValue({ kind: 'magnet', uri: `magnet:?xt=urn:btih:${hash}` })
    addRelease.mockRejectedValue(new qbt.TorrentRefusedError(200))
    renderSheet()
    await userEvent.click(await screen.findByRole('button', { name: /^Download/ }))
    expect(await screen.findByRole('alert', { name: saying('qBittorrent didn’t add the torrent.') })).toBeInTheDocument()
    expect(getTorrents).toHaveBeenLastCalledWith({ hashes: [hash] }, undefined)
  })

  it('says it may already be in downloads when qBittorrent refused a magnet link with only a v2 hash and doesn’t have it by that', async () => {
    // A hybrid torrent's ID is its v1 hash, which this link doesn't give.
    const v2 = 'ab'.repeat(32)
    fetchRelease.mockResolvedValue({ kind: 'magnet', uri: `magnet:?xt=urn:btmh:1220${v2}` })
    addRelease.mockRejectedValue(new qbt.TorrentRefusedError(200))
    renderSheet()
    await userEvent.click(await screen.findByRole('button', { name: /^Download/ }))
    expect(await screen.findByRole('alert', { name: saying('qBittorrent didn’t add the torrent. It may already be in your downloads.') })).toBeInTheDocument()
    expect(getTorrents).toHaveBeenLastCalledWith({ hashes: [v2.slice(0, 40)] }, undefined)
  })

  it.each([
    ['a v1 hash', 'c'.repeat(40), 'qBittorrent didn’t add the torrent.'],
    // A hybrid torrent's ID is its v1 hash, which a v2 hash alone doesn't give.
    ['only a v2 hash', 'cd'.repeat(32), 'qBittorrent didn’t add the torrent. It may already be in your downloads.'],
  ])('says whether a refused link may be in downloads by the hash Prowlarr gave, %s, in the WebUI build', async (_hash, infoHash, said) => {
    vi.stubGlobal('__WEBUI__', true)
    fetchRelease.mockResolvedValue({ kind: 'link', uri: 'http://192.168.1.20:9696/api/v1/indexer/1/download?link=abc&apikey=k' })
    addRelease.mockRejectedValue(new qbt.TorrentRefusedError(200))
    renderSheet({ ...RELEASE, infoHash })
    await userEvent.click(await screen.findByRole('button', { name: /^Download/ }))
    expect(await screen.findByRole('alert', { name: saying(said) })).toBeInTheDocument()
    expect(getTorrents).toHaveBeenLastCalledWith({ hashes: [infoHash.slice(0, 40)] }, undefined)
  })

  it('says it may already be in downloads when qBittorrent refused a torrent whose hash isn’t known', async () => {
    readTorrentFile.mockRejectedValue(new torrentFile.InvalidTorrentError())
    addRelease.mockRejectedValue(new qbt.TorrentRefusedError(200))
    renderSheet()
    await userEvent.click(await screen.findByRole('button', { name: /^Download/ }))
    expect(await screen.findByRole('alert', { name: saying('qBittorrent didn’t add the torrent. It may already be in your downloads.') })).toBeInTheDocument()
    expect(getTorrents).not.toHaveBeenCalled()
  })

  describe('naming a movie for a media server', () => {
    const openOptions = async () => {
      const sheet = screen.getByRole('dialog', { name: 'Add to downloads' })
      await userEvent.click(await within(sheet).findByRole('button', { name: 'Options' }))
      return sheet
    }

    it('offers it off by default for a movie, says the name once it’s on, and has the files named', async () => {
      readTorrentFile.mockResolvedValue(MOVIE_META)
      renderSheet(RELEASE, undefined, MOVIE_TITLE)
      const sheet = await openOptions()
      const names = within(sheet).getByRole('switch', { name: 'Name files for a media server' })
      expect(names).not.toBeChecked()
      expect(names).toBeEnabled()
      expect(names).not.toHaveAccessibleDescription()
      await userEvent.click(names)
      expect(names).toHaveAccessibleDescription('Folder and video: “Arrival (2016)”')
      await userEvent.click(within(sheet).getByRole('button', { name: /^Download/ }))
      expect(addRelease).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ mediaNames: { type: 'movie', title: 'Arrival', year: 2016, hint: RELEASE.title } }),
        { meta: MOVIE_META, skip: [] },
      )
    })

    it('starts from the default in Settings', async () => {
      updateSettings({ mediaNames: true })
      readTorrentFile.mockResolvedValue(MOVIE_META)
      renderSheet(RELEASE, undefined, MOVIE_TITLE)
      await userEvent.click(await screen.findByRole('button', { name: /^Download/ }))
      expect(addRelease).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ mediaNames: { type: 'movie', title: 'Arrival', year: 2016, hint: RELEASE.title } }), expect.anything())
    })

    it('can’t be turned on for a magnet link, whose files aren’t known, and names nothing whatever the default', async () => {
      updateSettings({ mediaNames: true })
      fetchRelease.mockResolvedValue({ kind: 'magnet', uri: 'magnet:?xt=urn:btih:abc' })
      renderSheet(RELEASE, undefined, MOVIE_TITLE)
      const sheet = await openOptions()
      const names = within(sheet).getByRole('switch', { name: 'Name files for a media server' })
      expect(names).not.toBeChecked()
      expect(names).toBeDisabled()
      expect(names).toHaveAccessibleDescription('The files aren’t known until the torrent starts. Name them from its page then.')
      await userEvent.click(within(sheet).getByRole('button', { name: /^Download/ }))
      expect(addRelease).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ mediaNames: undefined }), undefined)
    })

    it('says why a torrent’s files can’t be named, and names nothing', async () => {
      updateSettings({ mediaNames: true })
      readTorrentFile.mockResolvedValue({ ...MOVIE_META, files: [{ path: 'CD1.avi', size: 7e8 }, { path: 'CD2.avi', size: 7e8 }] })
      renderSheet(RELEASE, undefined, MOVIE_TITLE)
      const sheet = await openOptions()
      const names = within(sheet).getByRole('switch', { name: 'Name files for a media server' })
      expect(names).toBeDisabled()
      expect(names).toHaveAccessibleDescription(/^Several large videos/)
      await userEvent.click(within(sheet).getByRole('button', { name: /^Download/ }))
      expect(addRelease).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ mediaNames: undefined }), expect.anything())
    })

    it('offers it for a series, names the show’s folder, and has its episodes named', async () => {
      readTorrentFile.mockResolvedValue(META)
      renderSheet()
      const sheet = await openOptions()
      const names = within(sheet).getByRole('switch', { name: 'Name files for a media server' })
      expect(names).toBeEnabled()
      await userEvent.click(names)
      expect(names).toHaveAccessibleDescription('The show’s folder: “Breaking Bad”')
      await userEvent.click(within(sheet).getByRole('button', { name: /^Download/ }))
      expect(addRelease).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ mediaNames: { type: 'tv', title: 'Breaking Bad', year: undefined, hint: RELEASE.title } }), {
        meta: META,
        skip: [],
      })
    })

    it('names the show’s folder with the TMDB id with Settings’ switch on, and sends it', async () => {
      readTorrentFile.mockResolvedValue(META)
      const { retitle } = renderSheet()
      const sheet = await openOptions()
      const names = within(sheet).getByRole('switch', { name: 'Name files for a media server' })
      await userEvent.click(names)
      expect(names).toHaveAccessibleDescription('The show’s folder: “Breaking Bad”')
      // Settings' switch turned while the sheet is open (another tab, the server's defaults loading).
      act(() => updateSettings({ tmdbIds: true }))
      expect(names).toHaveAccessibleDescription('The show’s folder: “Breaking Bad {tmdb-1396}”')
      // The same sheet for a title of another id.
      retitle({ ...TV_TITLE, id: 1397 })
      expect(names).toHaveAccessibleDescription('The show’s folder: “Breaking Bad {tmdb-1397}”')
      retitle(TV_TITLE)
      expect(names).toHaveAccessibleDescription('The show’s folder: “Breaking Bad {tmdb-1396}”')
      await userEvent.click(within(sheet).getByRole('button', { name: /^Download/ }))
      expect(addRelease).toHaveBeenCalledWith(
        expect.anything(),
        expect.objectContaining({ mediaNames: { type: 'tv', title: 'Breaking Bad', year: undefined, tmdbId: 1396, hint: RELEASE.title } }),
        expect.anything(),
      )
    })

    it('reads the season of an episode in no folder from the release’s name', async () => {
      const release = { ...RELEASE, title: 'Breaking.Bad.S04.1080p-GRPA' }
      readTorrentFile.mockResolvedValue({ ...META, name: 'Episode 3.mkv', files: [{ path: 'Episode 3.mkv', size: 2e9 }], totalSize: 2e9, multiFile: false })
      renderSheet(release)
      const sheet = await openOptions()
      const names = within(sheet).getByRole('switch', { name: 'Name files for a media server' })
      expect(names).toBeEnabled()
      await userEvent.click(names)
      expect(names).toHaveAccessibleDescription('The show’s folder: “Breaking Bad”')
    })

    it('says why a series’ files can’t be named when no episode is read', async () => {
      readTorrentFile.mockResolvedValue({ ...META, files: [{ path: '01.mkv', size: 10e9 }, { path: '02.mkv', size: 10e9 }] })
      renderSheet()
      const sheet = await openOptions()
      const names = within(sheet).getByRole('switch', { name: 'Name files for a media server' })
      expect(names).toBeDisabled()
      expect(names).toHaveAccessibleDescription('No episode could be read from the videos’ names.')
    })

    it('says the torrent was added but its files weren’t named, and opens it', async () => {
      updateSettings({ mediaNames: true })
      readTorrentFile.mockResolvedValue(MOVIE_META)
      addRelease.mockRejectedValue(new adding.MediaNamesError(new qbt.QbittorrentError('The file already exists', 409)))
      getTorrents.mockResolvedValueOnce([]).mockResolvedValueOnce([torrent(MOVIE_META.infoHash)])
      const { onAdded } = renderSheet(RELEASE, undefined, MOVIE_TITLE)
      await userEvent.click(await screen.findByRole('button', { name: /^Download/ }))
      expect(await screen.findByRole('alert', { name: saying('Added, but its files weren’t named. Name them from the torrent’s More menu.') })).toBeInTheDocument()
      expect(screen.getByRole('link', { name: 'Open details' })).toHaveAttribute('href', `/torrent/${MOVIE_META.infoHash}`)
      expect(screen.queryByRole('status', { name: saying('Already in downloads') })).not.toBeInTheDocument()
      expect(onAdded).not.toHaveBeenCalled()
    })

    it('says which torrent is in the folder when that’s why the files weren’t named', async () => {
      updateSettings({ mediaNames: true })
      readTorrentFile.mockResolvedValue(MOVIE_META)
      addRelease.mockRejectedValue(new adding.MediaNamesError(undefined, { name: 'Arrival.2016.2160p', folder: 'Arrival (2016)' }))
      renderSheet(RELEASE, undefined, MOVIE_TITLE)
      await userEvent.click(await screen.findByRole('button', { name: /^Download/ }))
      expect(
        await screen.findByRole('alert', { name: saying('Added, but its files weren’t named. Another torrent, “Arrival.2016.2160p”, is in the folder “Arrival (2016)” already. Naming this one too would mix their files.') }),
      ).toBeInTheDocument()
    })

    it('says which torrent in the show’s folder may have files where a series’ would go', async () => {
      updateSettings({ mediaNames: true })
      readTorrentFile.mockResolvedValue(META)
      addRelease.mockRejectedValue(new adding.MediaNamesError(undefined, { name: 'Breaking Bad', folder: 'Breaking Bad', shared: true }))
      renderSheet()
      await userEvent.click(await screen.findByRole('button', { name: /^Download/ }))
      expect(
        await screen.findByRole('alert', {
          name: saying('Added, but its files weren’t named. Another torrent, “Breaking Bad”, is in the folder “Breaking Bad”, and its files may be where naming would put this one’s.'),
        }),
      ).toBeInTheDocument()
    })

    it('says so too when qBittorrent doesn’t answer whether it has the torrent, and offers no second Download', async () => {
      updateSettings({ mediaNames: true })
      readTorrentFile.mockResolvedValue(MOVIE_META)
      addRelease.mockRejectedValue(new adding.MediaNamesError(new qbt.QbittorrentError('The file already exists', 409)))
      getTorrents.mockResolvedValueOnce([]).mockRejectedValueOnce(new Error('no answer'))
      renderSheet(RELEASE, undefined, MOVIE_TITLE)
      await userEvent.click(await screen.findByRole('button', { name: /^Download/ }))
      expect(await screen.findByRole('alert', { name: saying('Added, but its files weren’t named. Name them from the torrent’s More menu.') })).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /^Download/ })).not.toHaveAttribute('aria-busy', 'true')
      // qBittorrent has the torrent: a second add would only be refused.
      expect(screen.getByRole('button', { name: /^Download/ })).toBeDisabled()
      expect(screen.queryByRole('button', { name: 'Options' })).not.toBeInTheDocument()
      expect(addRelease).toHaveBeenCalledOnce()
    })
  })

  describe('a torrent qBittorrent already has', () => {
    it('offers to open it in place of Download, over the page the sheet is on', async () => {
      getTorrents.mockResolvedValue([torrent(META.infoHash)])
      const { onClose } = renderSheet()
      const sheet = screen.getByRole('dialog', { name: 'Add to downloads' })
      expect(await within(sheet).findByRole('status', { name: saying('Already in downloads') })).toBeInTheDocument()
      expect(getTorrents).toHaveBeenCalledWith({ hashes: [META.infoHash] }, expect.any(AbortSignal))
      // Nothing to choose for a torrent that won't be added.
      expect(within(sheet).queryByRole('button', { name: /^Download/ })).not.toBeInTheDocument()
      expect(within(sheet).queryByRole('button', { name: /Files:/ })).not.toBeInTheDocument()
      expect(within(sheet).queryByRole('button', { name: 'Options' })).not.toBeInTheDocument()
      expect(within(sheet).queryByText('TV → /data/tv')).not.toBeInTheDocument()

      await userEvent.click(within(sheet).getByRole('link', { name: 'Open details' }))
      expect(onClose).toHaveBeenCalled()
      expect(opened()).toBe(`/torrent/${META.infoHash} over ${RELEASES_PAGE}`)
    })

    it('finds a magnet link’s torrent by the link’s hash', async () => {
      const hash = 'd'.repeat(40)
      fetchRelease.mockResolvedValue({ kind: 'magnet', uri: `magnet:?xt=urn:btih:${hash.toUpperCase()}` })
      getTorrents.mockResolvedValue([torrent(hash)])
      renderSheet()
      expect(await screen.findByRole('status', { name: saying('Already in downloads') })).toBeInTheDocument()
      expect(getTorrents).toHaveBeenCalledWith({ hashes: [hash] }, expect.any(AbortSignal))
      expect(screen.queryByText(/Magnet link: all files/)).not.toBeInTheDocument()
    })

    it('finds a magnet link’s torrent by the link’s hash in the WebUI build too, not by the one Prowlarr gave', async () => {
      vi.stubGlobal('__WEBUI__', true)
      const hash = 'd'.repeat(40)
      fetchRelease.mockResolvedValue({ kind: 'magnet', uri: `magnet:?xt=urn:btih:${hash}` })
      getTorrents.mockResolvedValue([torrent(hash)])
      renderSheet({ ...RELEASE, infoHash: 'e'.repeat(40) })
      expect(await screen.findByRole('status', { name: saying('Already in downloads') })).toBeInTheDocument()
      expect(getTorrents).toHaveBeenCalledWith({ hashes: [hash] }, expect.any(AbortSignal))
    })

    it('finds the torrent behind a link qBittorrent would follow by the hash Prowlarr gave with the release', async () => {
      vi.stubGlobal('__WEBUI__', true)
      const hash = 'f'.repeat(40)
      fetchRelease.mockResolvedValue({ kind: 'link', uri: 'http://192.168.1.20:9696/api/v1/indexer/1/download?link=abc&apikey=k' })
      getTorrents.mockResolvedValue([torrent(hash)])
      renderSheet({ ...RELEASE, infoHash: hash.toUpperCase() })
      expect(await screen.findByRole('status', { name: saying('Already in downloads') })).toBeInTheDocument()
      expect(getTorrents).toHaveBeenCalledWith({ hashes: [hash] }, expect.any(AbortSignal))
      expect(screen.queryByRole('button', { name: /^Download/ })).not.toBeInTheDocument()
    })

    it('keeps the free space warning away too', async () => {
      getMainData.mockResolvedValue({ rid: 1, server_state: { free_space_on_disk: 10e9 } })
      getTorrents.mockResolvedValue([torrent(META.infoHash)])
      renderSheet()
      expect(await screen.findByRole('status', { name: saying('Already in downloads') })).toBeInTheDocument()
      await waitFor(() => expect(getMainData).toHaveBeenCalled())
      expect(screen.queryByText('Not enough free space')).not.toBeInTheDocument()
    })
  })

  describe('a torrent qBittorrent doesn’t have', () => {
    it('waits for qBittorrent to say so before Download', async () => {
      let answer: (torrents: qbt.Torrent[]) => void = () => {}
      getTorrents.mockReturnValue(new Promise((resolve) => (answer = resolve)))
      renderSheet()
      const sheet = screen.getByRole('dialog', { name: 'Add to downloads' })
      await waitFor(() => expect(getTorrents).toHaveBeenCalled())
      expect(within(sheet).getByRole('status', { name: saying('Checking your downloads…') })).toBeInTheDocument()
      expect(within(sheet).getByRole('button', { name: /^Download/ })).toBeDisabled()
      // Nothing to open meanwhile that would go away if qBittorrent has it.
      expect(within(sheet).queryByRole('button', { name: /^Files/ })).not.toBeInTheDocument()
      expect(within(sheet).queryByRole('button', { name: 'Options' })).not.toBeInTheDocument()

      // Another torrent of the hashes asked for isn't this one.
      await act(async () => answer([torrent('e'.repeat(40))]))
      expect(within(sheet).getByRole('button', { name: /^Download/ })).toBeEnabled()
      expect(within(sheet).queryByRole('status', { name: saying('Checking your downloads…') })).not.toBeInTheDocument()
      expect(within(sheet).getByRole('button', { name: /^Files: all \(3\)/ })).toBeInTheDocument()
      expect(within(sheet).getByRole('button', { name: 'Options' })).toBeInTheDocument()
      expect(within(sheet).queryByRole('status', { name: saying('Already in downloads') })).not.toBeInTheDocument()
    })

    it('doesn’t offer the options while it gets the torrent either', async () => {
      let fetched: (source: { kind: 'magnet'; uri: string }) => void = () => {}
      fetchRelease.mockReturnValue(new Promise((resolve) => (fetched = resolve)))
      renderSheet()
      const sheet = screen.getByRole('dialog', { name: 'Add to downloads' })
      expect(await within(sheet).findByRole('status', { name: saying('Getting the torrent…') })).toBeInTheDocument()
      expect(within(sheet).queryByRole('button', { name: 'Options' })).not.toBeInTheDocument()

      await act(async () => fetched({ kind: 'magnet', uri: `magnet:?xt=urn:btih:${'e'.repeat(40)}` }))
      expect(await within(sheet).findByRole('button', { name: 'Options' })).toBeInTheDocument()
    })

    it('offers Download when qBittorrent can’t be asked', async () => {
      getTorrents.mockRejectedValue(qbittorrentDown())
      renderSheet()
      await waitFor(() => expect(getTorrents).toHaveBeenCalled())
      await waitFor(() => expect(screen.getByRole('button', { name: /^Download/ })).toBeEnabled())
      expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    })

    it('doesn’t ask qBittorrent when the hash isn’t known', async () => {
      readTorrentFile.mockRejectedValue(new torrentFile.InvalidTorrentError())
      renderSheet()
      await waitFor(() => expect(screen.getByRole('button', { name: /^Download/ })).toBeEnabled())
      expect(getTorrents).not.toHaveBeenCalled()
    })

    it('stops asking when the sheet goes away', async () => {
      getTorrents.mockReturnValue(new Promise(() => {}))
      const { unmount } = renderSheet()
      await waitFor(() => expect(getTorrents.mock.lastCall?.[1]?.aborted).toBe(false))
      unmount()
      expect(getTorrents.mock.lastCall?.[1]?.aborted).toBe(true)
    })
  })
})

namesTheFailedLink('The add sheet, when the torrent can’t be fetched', {
  service: 'prowlarr',
  show: async (error) => {
    fetchRelease.mockRejectedValue(error)
    renderSheet()
    await screen.findByRole('alert')
    return screen.getByRole('dialog', { name: 'Add to downloads' })
  },
  // A key refused between the search and the fetch names Prowlarr, as its failure does.
  says: { kinopeer: 'Couldn’t reach Kinopeer', service: 'Couldn’t get the torrent from Prowlarr', key: 'Couldn’t get the torrent from Prowlarr', store: 'Couldn’t reach qBittorrent' },
})

namesTheFailedLink('The add sheet, when the add fails', {
  service: 'qbittorrent',
  show: async (error) => {
    addRelease.mockRejectedValue(error)
    renderSheet()
    await userEvent.click(await screen.findByRole('button', { name: /^Download/ }))
    await screen.findByRole('alert')
    return screen.getByRole('dialog', { name: 'Add to downloads' })
  },
  says: { kinopeer: 'Couldn’t reach Kinopeer', service: 'Couldn’t reach qBittorrent' },
})
